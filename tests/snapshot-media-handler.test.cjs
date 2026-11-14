'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const { stageSnapshot } = require('../scripts/lib/media-snapshot.cjs');
const { createSnapshotMediaHandler } = require('../scripts/lib/snapshot-media-handler.cjs');
function image() {
  const data = Buffer.alloc(4 * 3 * 4, 255);
  for (let offset = 0; offset < data.length; offset += 4) data[offset + 1] = 20;
  return { width: 4, height: 3, data };
}
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'piraiders-media-http-')));
  const cleanup = new Set();
  let handler, server; const sockets = new Set(), pending = new Set();
  t.after(async () => {
    for (const unblock of cleanup) unblock();
    handler?.close();
    for (const socket of sockets) socket.destroy();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await Promise.allSettled([...pending]);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const sourceDir = path.join(root, 'source'), cacheDir = path.join(root, 'cache');
  await fs.mkdir(sourceDir);
  const png = PNG.sync.write(image()), jpg = jpeg.encode(image(), 90).data;
  await fs.writeFile(path.join(sourceDir, 'a.png'), png); await fs.writeFile(path.join(sourceDir, 'b.jpg'), jpg);
  const snapshot = await stageSnapshot({ sourceDir, cacheDir, quietMs: 0 });
  let auth = req => req.headers.authorization === 'Bearer fixture-only';
  handler = await createSnapshotMediaHandler({ snapshotDir: snapshot.snapshotDir, authorize: req => auth(req), maxConcurrentReads: 1 });
  server = http.createServer((req, res) => {
    if (req.headers['x-fixture-peer']) req = { headers: req.headers, method: req.method, url: req.url, socket: { remoteAddress: req.headers['x-fixture-peer'] } };
    const operation = handler.handle(req, res).catch(() => res.destroy());
    pending.add(operation); operation.finally(() => pending.delete(operation));
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  function request(url = handler.deck.slides[0].src, { method = 'GET', headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path: url, method,
        headers: { authorization: 'Bearer fixture-only', ...headers } }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
      });
      req.on('error', reject); req.end();
    });
  }
  return { root, sourceDir, snapshot, handler, request, png, jpg, cleanup, setAuth(value) { auth = value; } };
}
function blockRead(t, absolute, f) {
  const original = fs.open;
  let unblock, entered, completed;
  const gate = new Promise(resolve => { unblock = resolve; });
  const paused = new Promise(resolve => { entered = resolve; });
  const settled = new Promise(resolve => { completed = resolve; });
  let intercepted = false;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await original(...args);
    if (args[0] === absolute && !intercepted) {
      intercepted = true;
      const close = handle.close.bind(handle);
      handle.close = async () => { try { return await close(); } finally { completed(); } };
      const read = handle.read.bind(handle); let first = true;
      handle.read = async (...values) => {
        if (first) { first = false; entered(); await gate; }
        return read(...values);
      };
    }
    return handle;
  });
  f.cleanup.add(unblock);
  return { paused, unblock, settled };
}

test('fully verified offline PNG/JPEG serve only registered bytes, with private headers and immutable deck', async t => {
  const f = await fixture(t);
  await fs.rm(f.sourceDir, { recursive: true });
  assert.ok(Object.isFrozen(f.handler)); assert.ok(Object.isFrozen(f.handler.deck.slides[0]));
  assert.equal(f.handler.deck.id, f.snapshot.deck.id);
  assert.deepEqual(f.handler.deck.slides.map(slide => slide.id), f.snapshot.deck.slides.map(slide => slide.id));
  assert.ok(f.handler.deck.slides.every(slide => slide.src.startsWith('/piraiders/media/' + f.snapshot.deck.id + '/media/')));
  assert.ok(!JSON.stringify(f.handler.deck).includes(f.root));
  for (const [index, bytes, type] of [[0, f.png, 'image/png'], [1, f.jpg, 'image/jpeg']]) {
    const response = await f.request(f.handler.deck.slides[index].src);
    assert.equal(response.status, 200); assert.deepEqual(response.bytes, bytes);
    assert.equal(response.headers['content-type'], type);
    assert.equal(response.headers['content-length'], String(bytes.length));
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin');
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    assert.equal(response.headers.etag, undefined);
  }
  const head = await f.request(undefined, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.bytes.length, 0); assert.equal(head.headers['content-length'], String(f.png.length));
});

test('authorization is mandatory, literal synchronous true only, and never trusts forwarded peers', async t => {
  const f = await fixture(t);
  for (const headers of [{ authorization: '' }, { 'sec-fetch-site': 'cross-site' },
    { 'x-fixture-peer': '192.0.2.1', 'x-forwarded-for': '127.0.0.1' }]) {
    const result = await f.request(undefined, { headers }); assert.equal(result.status, 403); assert.equal(result.bytes.length, 0);
  }
  for (const authorize of [() => false, () => 'true', () => 1, () => ({}), () => { throw Error('private secret path'); },
    async () => true, async () => { throw Error('private secret'); }]) {
    f.setAuth(authorize);
    const result = await f.request(); assert.equal(result.status, 403); assert.equal(result.bytes.length, 0);
  }
  f.setAuth(() => true); assert.equal((await f.request()).status, 200);
});

test('exact raw path allowlist rejects manifest, arbitrary files, encoded traversal, queries and external URLs', async t => {
  const f = await fixture(t), src = f.handler.deck.slides[0].src;
  const prefix = '/piraiders/media/' + f.snapshot.deck.id + '/';
  await fs.writeFile(path.join(f.snapshot.snapshotDir, 'media', 'private.png'), f.png);
  for (const url of [prefix, prefix + 'manifest.json', prefix + 'media/private.png', src + '?token=anything', src + '#fragment',
    src.replace('/media/', '/%6dedia/'), prefix + '../manifest.json', prefix + '%2e%2e/manifest.json',
    prefix + 'media%2f' + path.basename(src), prefix + 'media\\' + path.basename(src), 'http://example.invalid' + src,
    src.toUpperCase(), src + '/', '/piraiders/media/missing.png']) {
    const response = await f.request(url); assert.equal(response.status, 404, url); assert.equal(response.bytes.length, 0);
  }
  const response = await f.request(src, { method: 'POST' });
  assert.equal(response.status, 405); assert.equal(response.headers.allow, 'GET, HEAD'); assert.equal(response.bytes.length, 0);
  assert.equal((await f.request(src, { headers: { range: 'bytes=0-3', 'if-none-match': '*' } })).status, 200);
});

test('corruption, length changes and deletion return zero image bytes; restoring original bytes recovers', async t => {
  const f = await fixture(t), file = path.join(f.snapshot.snapshotDir, f.snapshot.manifest.files[0].src);
  const changed = Buffer.from(f.png); changed[changed.length - 1] ^= 1;
  for (const bytes of [changed, f.png.subarray(0, 20), Buffer.concat([f.png, Buffer.from('extra')])]) {
    await fs.writeFile(file, bytes);
    for (const method of ['GET', 'HEAD']) {
      const response = await f.request(undefined, { method }); assert.equal(response.status, 503); assert.equal(response.bytes.length, 0);
      assert.equal(response.headers['content-type'], undefined);
    }
    await fs.writeFile(file, f.png); assert.deepEqual((await f.request()).bytes, f.png);
  }
  await fs.rm(file); assert.equal((await f.request()).status, 503);
  await fs.writeFile(file, f.png); assert.equal((await f.request()).status, 200);
});

test('media-directory symlink or junction substitution is rejected even when bytes match', async t => {
  const f = await fixture(t), media = path.join(f.snapshot.snapshotDir, 'media'), moved = path.join(f.root, 'moved');
  await fs.rename(media, moved); await fs.symlink(moved, media, 'junction');
  const denied = await f.request(); assert.equal(denied.status, 503); assert.equal(denied.bytes.length, 0);
  await fs.unlink(media); await fs.rename(moved, media);
  assert.equal((await f.request()).status, 200);
});

test('mutation during a descriptor read cannot return partially verified bytes', async t => {
  const f = await fixture(t), file = path.join(f.snapshot.snapshotDir, f.snapshot.manifest.files[0].src);
  const gate = blockRead(t, file, f), pending = f.request(); await gate.paused;
  const changed = Buffer.from(f.png); changed[0] ^= 1; await fs.writeFile(file, changed); gate.unblock();
  const result = await pending; assert.equal(result.status, 503); assert.equal(result.bytes.length, 0);
  await fs.writeFile(file, f.png); assert.equal((await f.request()).status, 200);
});

test('concurrent reads are bounded and overload recovers after the outstanding read settles', async t => {
  const f = await fixture(t), file = path.join(f.snapshot.snapshotDir, f.snapshot.manifest.files[0].src);
  const gate = blockRead(t, file, f), pending = f.request(); await gate.paused;
  const overloaded = await f.request(); assert.equal(overloaded.status, 503); assert.equal(overloaded.bytes.length, 0);
  gate.unblock(); assert.equal((await pending).status, 200); assert.equal((await f.request()).status, 200);
});

test('close immediately revokes a blocked in-flight response and all future access', async t => {
  const f = await fixture(t), file = path.join(f.snapshot.snapshotDir, f.snapshot.manifest.files[0].src);
  const gate = blockRead(t, file, f), pending = f.request(); await gate.paused;
  f.handler.close(); f.handler.close();
  const result = await pending; assert.equal(result.status, 503); assert.equal(result.bytes.length, 0);
  assert.equal((await f.request()).status, 503);
  gate.unblock();
  // Revocation completes HTTP immediately; descriptor ownership ends separately.
  await gate.settled;
});

test('registration rejects corrupt snapshots and invalid authorization/concurrency options', async t => {
  const f = await fixture(t);
  for (const options of [{}, { snapshotDir: f.snapshot.snapshotDir }, { snapshotDir: f.snapshot.snapshotDir, authorize: true },
    ...[0, 17, 1.5, NaN].map(maxConcurrentReads => ({ snapshotDir: f.snapshot.snapshotDir, authorize: () => true, maxConcurrentReads })),
    { snapshotDir: f.snapshot.snapshotDir, authorize: () => true, arbitrary: true }]) {
    await assert.rejects(createSnapshotMediaHandler(options), { code: 'INVALID_OPTIONS' });
  }
  await fs.writeFile(path.join(f.snapshot.snapshotDir, f.snapshot.manifest.files[0].src), Buffer.from('broken'));
  await assert.rejects(createSnapshotMediaHandler({ snapshotDir: f.snapshot.snapshotDir, authorize: () => true }), { code: 'CACHE_CHANGED' });
});

class BackpressuredResponse extends EventEmitter {
  constructor() { super(); this.headers = {}; this.destroyed = false; this.writableEnded = false; this.writableFinished = false; this.headersSent = false; }
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  end(bytes) { this.headersSent = true; this.writableEnded = true; this.bytes = bytes; }
  finish() { this.writableFinished = true; this.bytes = undefined; this.emit('finish'); }
  destroy() { this.destroyed = true; this.bytes = undefined; this.emit('close'); }
}
function localRequest(url) { return { url, method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { authorization: 'Bearer fixture-only' } }; }

test('response backpressure retains its slot until finish; close destroys queued image buffers', async t => {
  const f = await fixture(t), req = localRequest(f.handler.deck.slides[0].src);
  const first = new BackpressuredResponse(); await f.handler.handle(req, first);
  assert.equal(first.statusCode, 200); assert.deepEqual(first.bytes, f.png);
  const busy = new BackpressuredResponse(); await f.handler.handle(req, busy);
  assert.equal(busy.statusCode, 503); assert.equal(busy.bytes, undefined);
  first.finish();
  const next = new BackpressuredResponse(); await f.handler.handle(req, next);
  assert.equal(next.statusCode, 200);
  f.handler.close(); assert.equal(next.destroyed, true); assert.equal(next.bytes, undefined);
});

test('a disconnected response releases only after its descriptor settles, without late image writes', async t => {
  const f = await fixture(t), file = path.join(f.snapshot.snapshotDir, f.snapshot.manifest.files[0].src);
  const gate = blockRead(t, file, f), req = localRequest(f.handler.deck.slides[0].src), disconnected = new BackpressuredResponse();
  const pending = f.handler.handle(req, disconnected); await gate.paused;
  disconnected.destroy();
  const busy = new BackpressuredResponse(); await f.handler.handle(req, busy); assert.equal(busy.statusCode, 503);
  gate.unblock(); await pending; await gate.settled;
  assert.equal(disconnected.bytes, undefined); assert.equal(disconnected.headersSent, false);
  const next = new BackpressuredResponse(); await f.handler.handle(req, next);
  assert.equal(next.statusCode, 200); next.finish();
});

test('authorization revoked while reading prevents image bytes from being emitted', async t => {
  const f = await fixture(t), file = path.join(f.snapshot.snapshotDir, f.snapshot.manifest.files[0].src);
  const gate = blockRead(t, file, f), pending = f.request(); await gate.paused;
  f.setAuth(() => false); gate.unblock();
  const response = await pending; assert.equal(response.status, 403); assert.equal(response.bytes.length, 0);
  f.setAuth(() => true); assert.equal((await f.request()).status, 200);
});

test('snapshot registration validates and forwards abort signals before any route can be returned',async t=>{
  const f=await fixture(t), abort=new AbortController();abort.abort();
  await assert.rejects(createSnapshotMediaHandler({snapshotDir:f.snapshot.snapshotDir,authorize:()=>true,signal:{}}),{code:'INVALID_OPTIONS'});
  await assert.rejects(createSnapshotMediaHandler({snapshotDir:f.snapshot.snapshotDir,authorize:()=>true,signal:abort.signal}),{code:'IMAGE_ABORTED'});
});

test('registration abort during actual worker validation waits for the decoder thread to terminate',async t=>{
  const f=await fixture(t), abort=new AbortController(),{Worker}=require('node:worker_threads');
  const once=Worker.prototype.once;let worker;
  t.mock.method(Worker.prototype,'once',function(event,listener){
    if(event==='message'&&!worker){worker=this;queueMicrotask(()=>abort.abort());}
    return once.call(this,event,listener);
  });
  await assert.rejects(createSnapshotMediaHandler({snapshotDir:f.snapshot.snapshotDir,authorize:()=>true,signal:abort.signal}),{code:'IMAGE_ABORTED'});
  assert.ok(worker,'a real decoder worker was created');assert.equal(worker.threadId,-1,'abort is actual decoder settlement, not an ignored late result');
});
