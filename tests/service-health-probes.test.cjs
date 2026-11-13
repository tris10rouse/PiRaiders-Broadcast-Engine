'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { normalizeHealthConfig, probeServiceHealth } = require('../scripts/lib/service-health-probes.cjs');

async function listen(t, server) {
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket); socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  return { port: server.address().port, sockets };
}
const spxConfig = port => normalizeHealthConfig('spx', { protocol: 'spx-http', port, timeoutMs: 1000 });
const amcpConfig = port => normalizeHealthConfig('casparcg', { protocol: 'casparcg-amcp', port, timeoutMs: 1000 });
const spxBody = { vendor: 'SPX Graphics', product: 'SPX Solo', version: '1.4.1' };

test('health config is strict, loopback-only, bounded and service-specific', () => {
  assert.equal(normalizeHealthConfig('spx', undefined), null);
  assert.equal(normalizeHealthConfig('casparcg', undefined), null);
  const valid = { protocol: 'spx-http', port: 5656 };
  assert.deepEqual(normalizeHealthConfig('spx', valid), { ...valid, host: '127.0.0.1', timeoutMs: 1000 });
  assert.ok(Object.isFrozen(normalizeHealthConfig('spx', valid)));
  assert.equal(normalizeHealthConfig('spx', { ...valid, host: '::1' }).host, '::1');
  for (const config of [null, [], {}, { ...valid, host: 'localhost' }, { ...valid, host: '192.0.2.1' },
    { ...valid, host: '127.0.0.1.attacker.invalid' }, { ...valid, url: 'http://127.0.0.1/' },
    { ...valid, headers: { Authorization: 'secret' } }, { ...valid, path: '/?key=secret' },
    { ...valid, port: 0 }, { ...valid, port: 65536 }, { ...valid, port: '5656' },
    { ...valid, timeoutMs: 49 }, { ...valid, timeoutMs: 5001 }, { ...valid, timeoutMs: NaN },
    { ...valid, protocol: 'casparcg-amcp' }]) assert.throws(() => normalizeHealthConfig('spx', config));
  assert.throws(() => normalizeHealthConfig('unknown', undefined));
});
test('invalid or pre-aborted probe opens no remote connection', async () => {
  assert.deepEqual(await probeServiceHealth({ protocol: 'spx-http', port: 80, host: '192.0.2.1' }), { healthy: false, code: 'INVALID_CONFIG' });
  assert.deepEqual(await probeServiceHealth(null), { healthy: false, code: 'INVALID_CONFIG' });
  const controller = new AbortController(); controller.abort();
  assert.deepEqual(await probeServiceHealth(spxConfig(1), { signal: controller.signal }), { healthy: false, code: 'ABORTED' });
});
test('SPX HTTP health validates fixed GET endpoint and identity', async t => {
  let request;
  const { port } = await listen(t, http.createServer((req, res) => {
    request = { method: req.method, url: req.url, authorization: req.headers.authorization };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(spxBody));
  }));
  assert.deepEqual(await probeServiceHealth(spxConfig(port)), { healthy: true, version: '1.4.1' });
  assert.deepEqual(request, { method: 'GET', url: '/api/v1/version', authorization: undefined });
});
test('SPX HTTP health rejects unrelated identity without exposing body', async t => {
  const { port } = await listen(t, http.createServer((_req, res) => res.end(JSON.stringify({ vendor: 'secret-vendor', version: 'token-value' }))));
  assert.deepEqual(await probeServiceHealth(spxConfig(port)), { healthy: false, code: 'IDENTITY_MISMATCH' });
});
test('SPX HTTP health never follows redirects', async t => {
  let destinationRequests = 0;
  const target = await listen(t, http.createServer((_req, res) => { destinationRequests++; res.end(JSON.stringify(spxBody)); }));
  const { port } = await listen(t, http.createServer((_req, res) => {
    res.writeHead(302, { Location: 'http://127.0.0.1:' + target.port + '/api/v1/version' }); res.end();
  }));
  assert.deepEqual(await probeServiceHealth(spxConfig(port)), { healthy: false, code: 'HTTP_STATUS' });
  assert.equal(destinationRequests, 0);
});
test('SPX HTTP health rejects malformed JSON and unbounded/control-character versions', async t => {
  const replies = ['not JSON', JSON.stringify({ ...spxBody, version: '' }), JSON.stringify({ ...spxBody, version: 'v'.repeat(129) }),
    JSON.stringify({ ...spxBody, version: '1.4.1\r\nsecret' }), JSON.stringify({ ...spxBody, version: 141 })];
  const { port } = await listen(t, http.createServer((_req, res) => res.end(replies.shift())));
  for (let index = 0; index < 5; index++) assert.deepEqual(await probeServiceHealth(spxConfig(port)), { healthy: false, code: 'INVALID_RESPONSE' });
});
test('SPX HTTP health rejects oversized bodies and headers', async t => {
  const bodyServer = await listen(t, http.createServer((_req, res) => res.end('x'.repeat(16 * 1024 + 1))));
  assert.deepEqual(await probeServiceHealth(spxConfig(bodyServer.port)), { healthy: false, code: 'RESPONSE_TOO_LARGE' });
  const headerServer = await listen(t, http.createServer((_req, res) => { res.setHeader('X-Too-Large', 'x'.repeat(20 * 1024)); res.end(); }));
  assert.deepEqual(await probeServiceHealth(spxConfig(headerServer.port)), { healthy: false, code: 'RESPONSE_TOO_LARGE' });
});
test('SPX HTTP partial response close fails without reporting ready', async t => {
  const { port } = await listen(t, net.createServer(socket => socket.once('data', () => {
    socket.end('HTTP/1.1 200 OK\r\nContent-Length: 200\r\n\r\n{"vendor":"SPX Graphics"');
  })));
  assert.deepEqual(await probeServiceHealth(spxConfig(port)), { healthy: false, code: 'INVALID_RESPONSE' });
});
test('SPX HTTP absolute deadline includes dribbling bodies', async t => {
  const { port } = await listen(t, http.createServer((_req, res) => {
    res.writeHead(200); res.write('{');
    const timer = setInterval(() => res.write(' '), 10);
    res.once('close', () => clearInterval(timer));
  }));
  assert.deepEqual(await probeServiceHealth({ ...spxConfig(port), timeoutMs: 100 }), { healthy: false, code: 'TIMEOUT' });
});
test('SPX HTTP abort closes an in-flight silent response', async t => {
  const { port } = await listen(t, http.createServer(() => {}));
  const controller = new AbortController();
  const result = probeServiceHealth(spxConfig(port), { signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  assert.deepEqual(await result, { healthy: false, code: 'ABORTED' });
});
test('AMCP health sends only VERSION and accepts fragmented two-line response', async t => {
  let command = '';
  const { port } = await listen(t, net.createServer(socket => socket.on('data', async data => {
    command += data.toString();
    if (command !== 'VERSION\r\n') return;
    socket.write('201 VER'); await delay(10);
    if (!socket.destroyed) socket.write('SION OK\r\n2.4.0 Stable\r\n');
  })));
  assert.deepEqual(await probeServiceHealth(amcpConfig(port)), { healthy: true, version: '2.4.0 Stable' });
  assert.equal(command, 'VERSION\r\n');
});
test('AMCP health accepts coalesced response and closes its socket', async t => {
  let peerClosed;
  const closed = new Promise(resolve => { peerClosed = resolve; });
  const { port } = await listen(t, net.createServer(socket => {
    socket.once('close', peerClosed);
    socket.once('data', () => socket.write('201 VERSION OK\r\n2.3.3\r\n'));
  }));
  assert.deepEqual(await probeServiceHealth(amcpConfig(port)), { healthy: true, version: '2.3.3' });
  await closed;
});
test('AMCP health rejects malformed framing, status and version', async t => {
  const replies = ['200 OK\r\n2.4.0\r\n', '201 VERSION OK\r\n\r\n', '201 VERSION OK\r\nsecret-value\r\n',
    '201 VERSION OK\r\n2.4.0\r\nEXTRA', '201 VERSION OK\r\n' + '2.4.0 '.repeat(30) + '\r\n'];
  const { port } = await listen(t, net.createServer(socket => socket.once('data', () => socket.end(replies.shift()))));
  for (let index = 0; index < 5; index++) assert.deepEqual(await probeServiceHealth(amcpConfig(port)), { healthy: false, code: 'INVALID_RESPONSE' });
});
test('AMCP partial response close fails without reporting ready', async t => {
  const { port } = await listen(t, net.createServer(socket => socket.once('data', () => socket.end('201 VERSION OK\r\n2.4.0'))));
  assert.deepEqual(await probeServiceHealth(amcpConfig(port)), { healthy: false, code: 'INVALID_RESPONSE' });
});
test('AMCP oversized response is bounded', async t => {
  const { port } = await listen(t, net.createServer(socket => socket.once('data', () => socket.write('x'.repeat(16 * 1024 + 1)))));
  assert.deepEqual(await probeServiceHealth(amcpConfig(port)), { healthy: false, code: 'RESPONSE_TOO_LARGE' });
});
test('AMCP timeout is absolute despite continuous dribble', async t => {
  const { port } = await listen(t, net.createServer(socket => {
    const timer = setInterval(() => socket.write('2'), 10);
    socket.once('close', () => clearInterval(timer));
  }));
  assert.deepEqual(await probeServiceHealth({ ...amcpConfig(port), timeoutMs: 100 }), { healthy: false, code: 'TIMEOUT' });
});
test('AMCP abort closes an in-flight silent connection', async t => {
  const { port } = await listen(t, net.createServer(() => {}));
  const controller = new AbortController();
  const result = probeServiceHealth(amcpConfig(port), { signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  assert.deepEqual(await result, { healthy: false, code: 'ABORTED' });
});
test('connection refusal has a sanitized stable result for both protocols', async () => {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve));
  for (const config of [spxConfig(port), amcpConfig(port)]) {
    assert.deepEqual(await probeServiceHealth(config), { healthy: false, code: 'CONNECTION_FAILED' });
  }
});
