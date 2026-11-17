'use strict';

const test = require('node:test');

const assert = require('node:assert/strict');

const fs = require('node:fs/promises');

const path = require('node:path');

const os = require('node:os');

const crypto = require('node:crypto');

const {
  PNG
} = require('pngjs');

const jpeg = require('jpeg-js');

const {
  fixtures
} = require('./exchange-fixtures.cjs');

const {
  selectionId,
  selectionFingerprints
} = require('../scripts/lib/exchange-fingerprints.cjs');

const {
  stageExchangeSnapshot,
  loadExchangeSnapshot,
  EXCHANGE_SNAPSHOT_LIMITS: L
} = require('../scripts/lib/exchange-snapshot.cjs');

const {
  stageSnapshot,
  loadSnapshot
} = require('../scripts/lib/media-snapshot.cjs');

const hash = b => crypto.createHash('sha256').update(b).digest('hex');

const copy = v => JSON.parse(JSON.stringify(v));

function image(format = 'png', red = 255) {
  const data = Buffer.from([ red, 0, 0, 255, red, 0, 0, 255 ]);
  return format === 'png' ? PNG.sync.write({
    width: 2,
    height: 1,
    data: data
  }) : jpeg.encode({
    width: 2,
    height: 1,
    data: data
  }, 90).data;
}

function seal(m) {
  m.selectionId = selectionId(m.identityTuple);
  Object.assign(m, selectionFingerprints(m));
  delete m.scope;
  delete m.ready;
  delete m.semanticValidation;
  m.generation = 'e' + m.epoch + '-g' + String(m.generationSequence).padStart(10, '0') + '-' + m.metadataFingerprint.slice(0, 12);
  return m;
}

function source(blobs = [ image(), image('jpeg') ], order = [ 1, 0, 1 ]) {
  const m = fixtures().selection;
  m.manifestState = 'complete';
  m.assets = blobs.map((b, i) => ({
    assetKey: 'a' + (i + 1),
    originalDriveId: 'synthetic-drive-' + i,
    viaShortcutId: null,
    sourceRevision: {
      md5: null,
      size: null,
      modifiedTime: null,
      headRevisionId: null
    },
    mimeType: b[0] === 255 ? 'image/jpeg' : 'image/png',
    deliveryPath: 'assets/' + hash(b) + (b[0] === 255 ? '.jpg' : '.png'),
    byteLength: b.length,
    sha256: hash(b),
    width: 2,
    height: 1
  }));
  m.occurrences = order.map((n, i) => ({
    position: i + 1,
    occurrenceKey: 'row-' + i,
    fileKey: 'FILE-' + i,
    assetKey: 'a' + (n + 1),
    problem: null,
    sourceName: 'Synthetic',
    lineage: null
  }));
  return seal(m);
}

let reportedTemporaryAlias = false;

async function fixture(t, blobs, order) {
  const rawParent = await fs.mkdtemp(path.join(os.tmpdir(), 'PiRaiders exchange cache '));
  // Windows TEMP may use an 8.3 alias while production captures resolve the
  // source root to its long form. Hooks must observe that same actual path.
  const parent = await fs.realpath(rawParent), sourceRoot = path.join(parent, 'To Engine'), cacheDir = path.join(parent, 'cache');
  if (!reportedTemporaryAlias) {
    t.diagnostic('Temporary parent alias normalized: ' + (rawParent !== parent));
    reportedTemporaryAlias = true;
  }
  await fs.mkdir(path.join(sourceRoot, 'assets'), {
    recursive: true
  });
  assert.equal(sourceRoot === await fs.realpath(sourceRoot), true, 'fault hooks use the canonical source root');
  const media = blobs || [ image(), image('jpeg') ], manifest = source(media, order);
  for (let i = 0; i < manifest.assets.length; i++) await fs.writeFile(path.join(sourceRoot, manifest.assets[i].deliveryPath), media[i]);
  t.after(() => fs.rm(parent, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100
  }));
  return {
    parent: parent,
    sourceRoot: sourceRoot,
    cacheDir: cacheDir,
    manifest: manifest,
    blobs: media
  };
}

function request(f, extra = {}) {
  return {
    sourceRoot: f.sourceRoot,
    cacheDir: f.cacheDir,
    manifest: f.manifest,
    ...extra
  };
}

async function rejects(p, code) {
  await assert.rejects(p, e => e.code === code);
}

async function disk(s) {
  return JSON.parse(await fs.readFile(path.join(s.snapshotDir, 'manifest.json'), 'utf8'));
}

async function alter(s, fn) {
  const m = await disk(s);
  fn(m);
  await fs.writeFile(path.join(s.snapshotDir, 'manifest.json'), JSON.stringify(m));
}

test('source occurrence order and repeated bytes survive unique physical staging and public offline loading', async t => {
  const f = await fixture(t), s = await stageExchangeSnapshot(request(f));
  assert.equal(s.manifest.schemaVersion, 2);
  assert.equal(s.manifest.files.length, 2);
  assert.equal(s.deck.slides.length, 3);
  assert.equal(s.deck.slides[0].src, s.deck.slides[2].src);
  assert.notEqual(s.deck.slides[0].id, s.deck.slides[2].id);
  assert.deepEqual(s.manifest.occurrences.map(o => o.fileKey), [ 'FILE-0', 'FILE-1', 'FILE-2' ]);
  const bySha = new Map(s.manifest.files.map(x => [ x.sha256, x.src ]));
  assert.equal(s.deck.slides[0].src, bySha.get(f.manifest.assets[1].sha256));
  assert.equal(Object.isFrozen(s.deck.slides), true);
  await fs.rm(f.sourceRoot, {
    recursive: true
  });
  const cached = await loadSnapshot(s.snapshotDir);
  assert.deepEqual(cached, s);
});

test('matching physical aliases read once but count distinct asset rows against quota', async t => {
  const b = image(), f = await fixture(t, [ b, b ], [ 0, 1, 0 ]), open = fs.open;
  let count = 0;
  fs.open = async (file, ...args) => {
    if (file === path.join(f.sourceRoot, f.manifest.assets[0].deliveryPath)) count++;
    return open.call(fs, file, ...args);
  };
  try {
    await rejects(stageExchangeSnapshot(request(f, {
      maxTotalBytes: b.length
    })), 'TOTAL_LIMIT');
    assert.equal(count, 0);
    const s = await stageExchangeSnapshot(request(f, {
      maxTotalBytes: 2 * b.length
    }));
    assert.equal(count, 1);
    assert.equal(s.manifest.files.length, 1);
    assert.equal(s.manifest.assets.length, 2);
    assert.equal((await loadSnapshot(s.snapshotDir)).deck.slides.length, 3);
  } finally {
    fs.open = open;
  }
});

test('occurrence-derived IDs remain stable when bytes change while playback and content identities change', async t => {
  const f = await fixture(t, [ image() ], [ 0 ]), a = await stageExchangeSnapshot(request(f)), next = image('png', 64);
  f.manifest = source([ next ], [ 0 ]);
  await fs.writeFile(path.join(f.sourceRoot, f.manifest.assets[0].deliveryPath), next);
  const b = await stageExchangeSnapshot(request(f));
  assert.equal(a.deck.slides[0].id, b.deck.slides[0].id);
  assert.notEqual(a.deck.slides[0].src, b.deck.slides[0].src);
  assert.notEqual(a.manifest.contentHash, b.manifest.contentHash);
  assert.notEqual(a.manifest.source.playbackFingerprint, b.manifest.source.playbackFingerprint);
});

test('human event metadata-only generation retains playback and cache content identity', async t => {
  const f = await fixture(t), a = await stageExchangeSnapshot(request(f));
  f.manifest.generationSequence++;
  f.manifest.event.displayName = 'Updated human metadata';
  seal(f.manifest);
  const b = await stageExchangeSnapshot(request(f));
  assert.equal(a.manifest.source.playbackFingerprint, b.manifest.source.playbackFingerprint);
  assert.equal(a.manifest.contentHash, b.manifest.contentHash);
  assert.notEqual(a.manifest.id, b.manifest.id);
});

test('source unrelated files are ignored and cache/source overlap rejects before cache creation', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.sourceRoot, 'unrelated.tmp'), 'other generation');
  const scan = fs.opendir;
  fs.opendir = async () => {
    throw Error('NO_SOURCE_SCAN');
  };
  try {
    await stageExchangeSnapshot(request(f));
  } finally {
    fs.opendir = scan;
  }
  const overlapping = path.join(f.sourceRoot, 'newcache');
  await rejects(stageExchangeSnapshot(request(f, {
    cacheDir: overlapping
  })), 'OVERLAPPING_ROOTS');
  await assert.rejects(fs.stat(overlapping), {
    code: 'ENOENT'
  });
});

test('input snapshot is owned before asynchronous source reads and getters never run', async t => {
  const f = await fixture(t), open = fs.lstat;
  let enter, release;
  const entered = new Promise(r => enter = r), block = new Promise(r => release = r);
  fs.lstat = async (file, ...args) => {
    if (file === f.sourceRoot) {
      enter();
      await block;
    }
    return open.call(fs, file, ...args);
  };
  try {
    const pending = stageExchangeSnapshot(request(f));
    await entered;
    f.manifest.assets[0].deliveryPath = '../private';
    release();
    const s = await pending;
    assert.equal(s.deck.slides.length, 3);
  } finally {
    release();
    fs.lstat = open;
  }
  let calls = 0;
  const bad = source();
  Object.defineProperty(bad, 'assets', {
    enumerable: true,
    get() {
      calls++;
      return [];
    }
  });
  await rejects(stageExchangeSnapshot(request(f, {
    manifest: bad
  })), 'INVALID_SOURCE_MANIFEST');
  assert.equal(calls, 0);
});

for (const failure of [ 'length', 'hash', 'dimension', 'mime', 'missing', 'decode' ]) test('actual ' + failure + ' rejects whole candidate without replacing an earlier snapshot', async t => {
  const f = await fixture(t), good = await stageExchangeSnapshot(request(f));
  const a = f.manifest.assets[0], file = path.join(f.sourceRoot, a.deliveryPath);
  let expected;
  if (failure === 'length') {
    await fs.writeFile(file, Buffer.alloc(1));
    expected = 'LENGTH_MISMATCH';
  }
  if (failure === 'hash') {
    await fs.writeFile(file, Buffer.alloc(a.byteLength));
    expected = 'HASH_MISMATCH';
  }
  if (failure === 'dimension') {
    a.width = 3;
    seal(f.manifest);
    expected = 'IMAGE_METADATA_MISMATCH';
  }
  if (failure === 'mime') {
    const b = image();
    a.mimeType = 'image/jpeg';
    a.deliveryPath = 'assets/' + hash(b) + '.jpg';
    a.sha256 = hash(b);
    a.byteLength = b.length;
    seal(f.manifest);
    await fs.writeFile(path.join(f.sourceRoot, a.deliveryPath), b);
    expected = 'IMAGE_FORMAT_MISMATCH';
  }
  if (failure === 'missing') {
    await fs.unlink(file);
    expected = 'SNAPSHOT_IO';
  }
  if (failure === 'decode') {
    const b = Buffer.from('invalid-image');
    a.sha256 = hash(b);
    a.byteLength = b.length;
    a.deliveryPath = 'assets/' + a.sha256 + '.png';
    seal(f.manifest);
    await fs.writeFile(path.join(f.sourceRoot, a.deliveryPath), b);
    expected = 'INVALID_IMAGE';
  }
  await rejects(stageExchangeSnapshot(request(f)), expected);
  assert.deepEqual((await fs.readdir(f.cacheDir)).sort(), [ good.manifest.id ]);
  assert.equal((await loadSnapshot(good.snapshotDir)).deck.slides.length, 3);
});

test('complete nonempty state and all hard/lower bounds are enforced without partial filtering', async t => {
  const f = await fixture(t);
  for (const opts of [ {
    maxFiles: 501
  }, {
    maxOccurrences: 501
  }, {
    maxTotalBytes: L.maxTotalBytes + 1
  }, {
    maxFileBytes: L.maxFileBytes + 1
  }, {
    timeoutMs: 10001
  } ]) await rejects(stageExchangeSnapshot(request(f, opts)), 'INVALID_OPTIONS');
  await rejects(stageExchangeSnapshot(request(f, {
    maxOccurrences: 2
  })), 'FILE_COUNT_LIMIT');
  await rejects(stageExchangeSnapshot(request(f, {
    maxFiles: 1
  })), 'FILE_COUNT_LIMIT');
  const empty = fixtures().selection;
  seal(empty);
  await rejects(stageExchangeSnapshot(request(f, {
    manifest: empty
  })), 'NOT_PLAYABLE');
  const malformed = copy(f.manifest);
  malformed.occurrences.reverse();
  seal(malformed);
  await rejects(stageExchangeSnapshot(request(f, {
    manifest: malformed
  })), 'INVALID_SOURCE_MANIFEST');
});

test('abort before admission and during real asset read settles cleanup and keeps prior content', async t => {
  const f = await fixture(t), good = await stageExchangeSnapshot(request(f)), controller = new AbortController();
  controller.abort();
  await rejects(stageExchangeSnapshot(request(f, {
    signal: controller.signal
  })), 'IMAGE_ABORTED');
  const second = new AbortController(), open = fs.open;
  let injectedRead = false;
  fs.open = async (file, ...args) => {
    const h = await open.call(fs, file, ...args);
    if (file === path.join(f.sourceRoot, f.manifest.assets[0].deliveryPath)) {
      const read = h.read.bind(h);
      h.read = async (...values) => {
        const result = await read(...values);
        injectedRead = true;
        second.abort();
        return result;
      };
    }
    return h;
  };
  try {
    await rejects(stageExchangeSnapshot(request(f, {
      signal: second.signal
    })), 'IMAGE_ABORTED');
  } finally {
    fs.open = open;
    assert.equal(injectedRead, true, 'abort hook reached an actual source read');
    assert.equal(second.signal.aborted, true, 'read hook delivered cancellation');
  }
  assert.deepEqual(await fs.readdir(f.cacheDir), [ good.manifest.id ]);
});

test('growth and replacement during actual asset read reject bounded captures', async t => {
  for (const mode of [ 'grow', 'replace' ]) {
    const f = await fixture(t), open = fs.open, file = path.join(f.sourceRoot, f.manifest.assets[0].deliveryPath);
    let changed = false, mutated = false;
    fs.open = async (target, ...args) => {
      const h = await open.call(fs, target, ...args);
      if (target === file) {
        const read = h.read.bind(h);
        h.read = async (...values) => {
          const out = await read(...values);
          if (!changed) {
            changed = true;
            if (mode === 'grow') await fs.appendFile(file, 'x'); else {
              await fs.rename(file, file + '.old');
              await fs.writeFile(file, f.blobs[0]);
            }
            mutated = true;
          }
          return out;
        };
      }
      return h;
    };
    try {
      await rejects(stageExchangeSnapshot(request(f)), 'SOURCE_CHANGED');
    } finally {
      fs.open = open;
      assert.equal(changed, true, mode + ' hook reached an actual source read');
      assert.equal(mutated, true, mode + ' filesystem mutation completed');
    }
    assert.deepEqual(await fs.readdir(f.cacheDir), []);
  }
});

test('source and cache symlink/junction ancestors are rejected', async t => {
  const f = await fixture(t), alias = path.join(f.parent, 'alias');
  await fs.symlink(f.sourceRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await rejects(stageExchangeSnapshot(request(f, {
    sourceRoot: alias
  })), 'UNSAFE_SOURCE');
  const outside = path.join(f.parent, 'outside');
  await fs.mkdir(outside);
  const cacheAlias = path.join(f.parent, 'cacheAlias');
  await fs.symlink(outside, cacheAlias, process.platform === 'win32' ? 'junction' : 'dir');
  await rejects(stageExchangeSnapshot(request(f, {
    cacheDir: path.join(cacheAlias, 'new')
  })), 'UNSAFE_SOURCE');
});

test('publication failure cleans only owned pending state, retaining previously published snapshots', async t => {
  const f = await fixture(t), good = await stageExchangeSnapshot(request(f)), rename = fs.rename;
  fs.rename = async () => {
    throw Error('private');
  };
  try {
    await rejects(stageExchangeSnapshot(request(f)), 'SNAPSHOT_IO');
  } finally {
    fs.rename = rename;
  }
  assert.deepEqual(await fs.readdir(f.cacheDir), [ good.manifest.id ]);
});

for (const mode of [ 'order', 'ref', 'hash', 'extra', 'media', 'source' ]) test('offline schema2 ' + mode + ' tampering fails closed', async t => {
  const f = await fixture(t), s = await stageExchangeSnapshot(request(f));
  if (mode === 'order') await alter(s, m => m.occurrences.reverse());
  if (mode === 'ref') await alter(s, m => m.occurrences[0].assetKey = 'a999');
  if (mode === 'hash') await fs.writeFile(path.join(s.snapshotDir, s.manifest.files[0].src), Buffer.alloc(s.manifest.files[0].bytes));
  if (mode === 'extra') await fs.writeFile(path.join(s.snapshotDir, 'extra'), 'bad');
  if (mode === 'media') await fs.writeFile(path.join(s.snapshotDir, 'media', 'extra'), 'bad');
  if (mode === 'source') await alter(s, m => m.source.playbackFingerprint = 'f'.repeat(64));
  await assert.rejects(loadSnapshot(s.snapshotDir));
});

test('cache2 rejects earlier-file replacement during later file validation', async t => {
  const f = await fixture(t), s = await stageExchangeSnapshot(request(f)), first = path.join(s.snapshotDir, s.manifest.files[0].src), second = path.join(s.snapshotDir, s.manifest.files[1].src), open = fs.open;
  let changed = false;
  fs.open = async (file, ...args) => {
    if (file === second && !changed) {
      changed = true;
      await fs.rename(first, first + '.old');
      await fs.writeFile(first, await fs.readFile(first + '.old'));
      await fs.unlink(first + '.old');
    }
    return open.call(fs, file, ...args);
  };
  try {
    await rejects(loadSnapshot(s.snapshotDir), 'CACHE_CHANGED');
  } finally {
    fs.open = open;
    assert.equal(changed, true, 'earlier cached file replacement hook was admitted');
  }
});

test('legacy stage/load remains schema1 and preserves lexical folder order', async t => {
  const f = await fixture(t), legacySource = path.join(f.parent, 'legacy');
  await fs.mkdir(legacySource);
  await fs.writeFile(path.join(legacySource, 'z.png'), image());
  await fs.writeFile(path.join(legacySource, 'a.jpg'), image('jpeg'));
  const s = await stageSnapshot({
    sourceDir: legacySource,
    cacheDir: f.cacheDir,
    quietMs: 0
  });
  assert.equal(s.manifest.schemaVersion, 1);
  assert.equal(s.manifest.files.length, 2);
  assert.deepEqual(await loadSnapshot(s.snapshotDir), s);
});

test('cache loader preserves caller maxEntries and public schema2 error codes', async t => {
  const f = await fixture(t), s = await stageExchangeSnapshot(request(f));
  await rejects(loadSnapshot(s.snapshotDir, {
    maxEntries: 1
  }), 'UNEXPECTED_CONTENT');
  await alter(s, m => m.occurrences.reverse());
  await rejects(loadSnapshot(s.snapshotDir), 'INVALID_MANIFEST');
});

test('source root identity change during actual handle close is rejected after capture', async t => {
  const f = await fixture(t), open = fs.open, file = path.join(f.sourceRoot, f.manifest.assets[0].deliveryPath);
  let changed = false, mutated = false;
  fs.open = async (target, ...args) => {
    const h = await open.call(fs, target, ...args);
    if (target === file) {
      const close = h.close.bind(h);
      h.close = async () => {
        await close();
        if (!changed) {
          changed = true;
          await fs.rename(f.sourceRoot, f.sourceRoot + '.old');
          await fs.mkdir(f.sourceRoot);
          mutated = true;
        }
      };
    }
    return h;
  };
  try {
    await rejects(stageExchangeSnapshot(request(f)), 'SOURCE_CHANGED');
  } finally {
    fs.open = open;
    assert.equal(changed, true, 'source-root replacement hook was admitted');
    assert.equal(mutated, true, 'source-root replacement filesystem mutation completed');
  }
  assert.deepEqual(await fs.readdir(f.cacheDir), []);
});

test('late abort after publication never acknowledges a prepared candidate or deletes the committed cache', async t => {
  const f = await fixture(t), controller = new AbortController(), rename = fs.rename;
  fs.rename = async (...args) => {
    await rename.call(fs, ...args);
    controller.abort();
  };
  try {
    await rejects(stageExchangeSnapshot(request(f, {
      signal: controller.signal
    })), 'IMAGE_ABORTED');
  } finally {
    fs.rename = rename;
  }
  const names = await fs.readdir(f.cacheDir);
  assert.equal(names.length, 1);
  assert.match(names[0], /^[0-9a-f-]{36}$/);
  assert.equal((await loadSnapshot(path.join(f.cacheDir, names[0]))).deck.slides.length, 3);
});

test('cache root replacement during source read fails before private writes', async t => {
  const f = await fixture(t), open = fs.open, file = path.join(f.sourceRoot, f.manifest.assets[0].deliveryPath);
  let changed = false, mutated = false;
  fs.open = async (target, ...args) => {
    const h = await open.call(fs, target, ...args);
    if (target === file) {
      const read = h.read.bind(h);
      h.read = async (...values) => {
        const result = await read(...values);
        if (!changed) {
          changed = true;
          await fs.rename(f.cacheDir, f.cacheDir + '.old');
          await fs.mkdir(f.cacheDir);
          mutated = true;
        }
        return result;
      };
    }
    return h;
  };
  try {
    await rejects(stageExchangeSnapshot(request(f)), 'SOURCE_CHANGED');
  } finally {
    fs.open = open;
    assert.equal(changed, true, 'cache-root replacement hook was admitted');
    assert.equal(mutated, true, 'cache-root replacement filesystem mutation completed');
  }
  assert.deepEqual(await fs.readdir(f.cacheDir), []);
});

test('large ordered Unicode occurrence metadata uses schema2 budget and remains offline-valid', async t => {
  const f = await fixture(t);
  f.manifest.occurrences = Array.from({
    length: 500
  }, (_, i) => ({
    position: i + 1,
    occurrenceKey: '😀'.repeat(197) + String(i).padStart(3, '0'),
    fileKey: '😀'.repeat(64),
    assetKey: i % 2 ? 'a1' : 'a2',
    problem: null,
    sourceName: 'Synthetic',
    lineage: null
  }));
  seal(f.manifest);
  const s = await stageExchangeSnapshot(request(f));
  const stat = await fs.stat(path.join(s.snapshotDir, 'manifest.json'));
  assert.ok(stat.size > 500 * 1024 + 1024);
  assert.ok(stat.size < L.manifestBytes);
  assert.equal((await loadSnapshot(s.snapshotDir)).deck.slides.length, 500);
});

test('owned pending-name collision never removes preexisting cache data', async t => {
  const f = await fixture(t), id = '11111111-1111-4111-8111-111111111111';
  await fs.mkdir(path.join(f.cacheDir, '.pending-' + id), {
    recursive: true
  });
  await fs.writeFile(path.join(f.cacheDir, '.pending-' + id, 'owned-by-other'), 'keep');
  const uuid = crypto.randomUUID;
  crypto.randomUUID = () => id;
  try {
    await rejects(stageExchangeSnapshot(request(f)), 'SNAPSHOT_IO');
  } finally {
    crypto.randomUUID = uuid;
  }
  assert.equal(await fs.readFile(path.join(f.cacheDir, '.pending-' + id, 'owned-by-other'), 'utf8'), 'keep');
});

test('actual media handler and controller preserve repeated ordered occurrences and wrap', async t => {
  const f = await fixture(t), s = await stageExchangeSnapshot(request(f));
  await fs.rm(f.sourceRoot, {
    recursive: true
  });
  const http = require('node:http'), {
    createSnapshotMediaHandler
  } = require('../scripts/lib/snapshot-media-handler.cjs'), {
    SlideshowController
  } = require('../scripts/lib/slideshow-controller.cjs');
  const handler = await createSnapshotMediaHandler({
    snapshotDir: s.snapshotDir,
    authorize: req => req.headers.authorization === 'Bearer synthetic-test'
  });
  const server = http.createServer((req, res) => {
    handler.handle(req, res).catch(() => res.destroy());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const shown = [], controller = new SlideshowController({
    deck: handler.deck,
    mode: 'manual',
    renderer: {
      show: async frame => shown.push(frame.slide.id),
      black: async () => {}
    }
  });
  t.after(async () => {
    await controller.close();
    handler.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  assert.equal(handler.deck.slides.length, 3);
  assert.equal(handler.deck.slides[0].src, handler.deck.slides[2].src);
  for (const [ index, blob ] of [ [ 0, f.blobs[1] ], [ 1, f.blobs[0] ], [ 2, f.blobs[1] ] ]) {
    const data = await new Promise((resolve, reject) => {
      http.get({
        host: '127.0.0.1',
        port: server.address().port,
        path: handler.deck.slides[index].src,
        headers: {
          authorization: 'Bearer synthetic-test'
        }
      }, res => {
        assert.equal(res.statusCode, 200);
        const chunks = [];
        res.on('data', b => chunks.push(b));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    });
    assert.deepEqual(data, blob);
  }
  for (const [ target, authorized, status ] of [ [ handler.deck.slides[0].src, false, 403 ], [ handler.deck.slides[0].src + '?x=1', true, 404 ], [ '/piraiders/media/' + s.manifest.id + '/%2e%2e/manifest.json', true, 404 ] ]) {
    const denied = await new Promise((resolve, reject) => http.get({
      host: '127.0.0.1',
      port: server.address().port,
      path: target,
      headers: authorized ? {
        authorization: 'Bearer synthetic-test'
      } : {}
    }, res => {
      const chunks = [];
      res.on('data', b => chunks.push(b));
      res.on('end', () => resolve({
        status: res.statusCode,
        bytes: Buffer.concat(chunks)
      }));
      res.on('error', reject);
    }).on('error', reject));
    assert.equal(denied.status, status);
    assert.equal(denied.bytes.length, 0);
  }
  for (const action of [ 'launch', 'next', 'next', 'next', 'previous' ]) assert.equal((await controller.dispatch(action)).ok, true);
  assert.deepEqual(shown, [ 0, 1, 2, 0, 2 ].map(i => handler.deck.slides[i].id));
});

test('valid-signature PNG with bad CRC is rejected by the actual worker after source hash verification', async t => {
  const b = Buffer.from(image());
  b[b.length - 1] ^= 1;
  const f = await fixture(t, [ b ], [ 0 ]);
  await rejects(stageExchangeSnapshot(request(f)), 'INVALID_IMAGE');
  assert.deepEqual(await fs.readdir(f.cacheDir), []);
});

test('source assets and cached media directory junctions cannot redirect reads', async t => {
  const f = await fixture(t), s = await stageExchangeSnapshot(request(f));
  const assets = path.join(f.sourceRoot, 'assets'), outside = path.join(f.parent, 'outside-assets');
  await fs.rename(assets, outside);
  await fs.symlink(outside, assets, process.platform === 'win32' ? 'junction' : 'dir');
  await rejects(stageExchangeSnapshot(request(f)), 'UNSAFE_SOURCE');
  const media = path.join(s.snapshotDir, 'media'), saved = path.join(f.parent, 'saved-media');
  await fs.rename(media, saved);
  await fs.symlink(saved, media, process.platform === 'win32' ? 'junction' : 'dir');
  await rejects(loadSnapshot(s.snapshotDir), 'UNSAFE_CACHE');
});

test('inconsistent alias metadata rejects before asset I/O and offline aliases cannot lower quota', async t => {
  const b = image(), f = await fixture(t, [ b, b ], [ 0, 1 ]);
  const s = await stageExchangeSnapshot(request(f));
  await rejects(loadSnapshot(s.snapshotDir, {
    maxTotalBytes: b.length
  }), 'TOTAL_LIMIT');
  f.manifest.assets[1].width = 3;
  seal(f.manifest);
  const open = fs.open;
  let reads = 0;
  fs.open = async (...args) => {
    reads++;
    return open.call(fs, ...args);
  };
  try {
    await rejects(stageExchangeSnapshot(request(f)), 'ALIAS_MISMATCH');
    assert.equal(reads, 0);
  } finally {
    fs.open = open;
  }
});

for (const mode of [ 'abort', 'timeout' ]) test('controlled ' + mode + ' after real decoder worker start propagates only after worker cleanup', {
  timeout: 1e4
}, async t => {
  const f = await fixture(t), controller = new AbortController(), snapshotFile = require.resolve('../scripts/lib/exchange-snapshot.cjs'), validator = require('../scripts/lib/image-validator-session.cjs'), real = validator.createImageValidationSession, previous = require.cache[snapshotFile];
  let calls = 0, callback, timer;
  if (mode === 'timeout') {
    const schedule = global.setTimeout;
    t.mock.method(global, 'setTimeout', (fn, ms, ...args) => {
      if (!(ms > 4000 && ms <= 4321)) return schedule(fn, ms, ...args);
      assert.equal(callback, undefined);
      callback = () => fn(...args);
      timer = schedule(() => {}, 36e5);
      timer.unref();
      return timer;
    });
    t.after(() => clearTimeout(timer));
  }
  validator.createImageValidationSession = () => {
    const session = real();
    return {...session, validate(buffer, options) {
      assert.equal(options.signal.aborted, false);
      const pending = session.validate(buffer, options);
      calls++;
      if (mode === 'abort') controller.abort(); else {
        assert.equal(typeof callback, 'function', 'real worker session installed its original deadline');
        callback();
      }
      return pending;
    }};
  };
  delete require.cache[snapshotFile];
  let candidate;
  try {
    candidate = require(snapshotFile).stageExchangeSnapshot;
  } finally {
    validator.createImageValidationSession = real;
  }
  try {
    await rejects(candidate(request(f, {
      signal: controller.signal,
      timeoutMs: 4321
    })), mode === 'abort' ? 'IMAGE_ABORTED' : 'IMAGE_TIMEOUT');
    assert.equal(calls, 1);
    assert.deepEqual(await fs.readdir(f.cacheDir), []);
  } finally {
    require.cache[snapshotFile] = previous;
    validator.createImageValidationSession = real;
  }
});

test('public schema dispatch retains the originally captured abort signal across async manifest I/O', async t => {
  const f = await fixture(t), s = await stageExchangeSnapshot(request(f)), original = new AbortController(), replacement = new AbortController(), options = {
    signal: original.signal
  }, open = fs.open, manifestFile = path.join(s.snapshotDir, 'manifest.json');
  let changed = false;
  fs.open = async (file, ...args) => {
    const h = await open.call(fs, file, ...args);
    if (file === manifestFile && !changed) {
      const close = h.close.bind(h);
      h.close = async () => {
        await close();
        changed = true;
        options.signal = replacement.signal;
        original.abort();
      };
    }
    return h;
  };
  try {
    await rejects(loadSnapshot(s.snapshotDir, options), 'IMAGE_ABORTED');
  } finally {
    fs.open = open;
  }
  assert.equal(changed, true);
});

test('cleanup preserves a foreign pending directory after the cache root is replaced', async t => {
  const f = await fixture(t), open = fs.open;
  const asset = path.join(f.sourceRoot, f.manifest.assets[0].deliveryPath);
  let replaced = false, foreign;
  fs.open = async (target, ...args) => {
    const handle = await open.call(fs, target, ...args);
    if (target === asset) {
      const read = handle.read.bind(handle);
      handle.read = async (...values) => {
        const out = await read(...values);
        if (!replaced) {
          replaced = true;
          const pending = (await fs.readdir(f.cacheDir)).filter(name => name.startsWith('.pending-'));
          assert.equal(pending.length, 1);
          await fs.rename(f.cacheDir, f.cacheDir + '.old');
          await fs.mkdir(f.cacheDir);
          foreign = path.join(f.cacheDir, pending[0]);
          await fs.mkdir(foreign);
          await fs.writeFile(path.join(foreign, 'keep.txt'), 'other writer');
        }
        return out;
      };
    }
    return handle;
  };
  try {
    await rejects(stageExchangeSnapshot(request(f)), 'SOURCE_CHANGED');
    assert.equal(replaced, true, 'the real source read reached the replacement barrier');
    assert.equal(await fs.readFile(path.join(foreign, 'keep.txt'), 'utf8'), 'other writer');
  } finally {
    fs.open = open;
  }
});

test('a replaced pending directory is neither written, published nor deleted', async t => {
  const f = await fixture(t), open = fs.open;
  const asset = path.join(f.sourceRoot, f.manifest.assets[0].deliveryPath);
  let replaced = false, foreign;
  fs.open = async (target, ...args) => {
    const handle = await open.call(fs, target, ...args);
    if (target === asset) {
      const read = handle.read.bind(handle);
      handle.read = async (...values) => {
        const out = await read(...values);
        if (!replaced) {
          replaced = true;
          const names = (await fs.readdir(f.cacheDir)).filter(name => name.startsWith('.pending-'));
          assert.equal(names.length, 1);
          foreign = path.join(f.cacheDir, names[0]);
          await fs.rename(foreign, foreign + '.moved');
          await fs.mkdir(path.join(foreign, 'media'), {recursive: true});
          await fs.writeFile(path.join(foreign, 'keep.txt'), 'other writer');
        }
        return out;
      };
    }
    return handle;
  };
  try {
    await rejects(stageExchangeSnapshot(request(f)), 'SOURCE_CHANGED');
    assert.equal(replaced, true);
    assert.equal(await fs.readFile(path.join(foreign, 'keep.txt'), 'utf8'), 'other writer');
    assert.deepEqual(await fs.readdir(path.join(foreign, 'media')), []);
    assert.equal((await fs.readdir(f.cacheDir)).some(name => /^[0-9a-f-]{36}$/.test(name)), false);
  } finally {
    fs.open = open;
  }
});

test('idle real decoder fault after final decode blocks publication and cleans owned pending tree', {timeout:15000},async t=>{
 const {Worker}=require('node:worker_threads');
 const f=await fixture(t),good=await stageExchangeSnapshot(request(f)),post=Worker.prototype.postMessage,write=fs.writeFile;
 let worker,mediaWrites=0;
 t.mock.method(Worker.prototype,'postMessage',function(...args){worker=this;return post.apply(this,args);});
 t.mock.method(fs,'writeFile',async(file,...args)=>{const result=await write.call(fs,file,...args);if(String(file).includes('.pending-')&&String(file).includes(path.sep+'media'+path.sep)&&++mediaWrites===2)worker.emit('message',{id:999,ok:true,format:'png',width:2,height:1});return result;});
 await rejects(stageExchangeSnapshot(request(f)),'IMAGE_DECODE_FAILED');
 assert.equal(mediaWrites,2);assert.equal(worker.threadId,-1);assert.deepEqual(await fs.readdir(f.cacheDir),[good.manifest.id]);await fs.access(good.snapshotDir);
});

test('failed actual terminate holds staging cleanup until real exit then removes only owned pending tree',{timeout:15000},async t=>{
 const {Worker}=require('node:worker_threads'),{once}=require('node:events');
 const f=await fixture(t,[image()],[0]),good=await stageExchangeSnapshot(request(f)),controller=new AbortController();
 const terminate=Worker.prototype.terminate,remove=fs.rm;
 let entered;const start=new Promise(resolve=>entered=resolve);let worker,removeCalls=0;
 t.mock.method(Worker.prototype,'postMessage',function(){worker=this;entered();});
 t.mock.method(Worker.prototype,'terminate',()=>Promise.reject(Error('PRIVATE_TERMINATION_FAILURE')));
 t.mock.method(fs,'rm',async(file,...args)=>{if(path.basename(String(file)).startsWith('.pending-')){removeCalls++;assert.equal(worker.threadId,-1,'owned cleanup requires actual worker exit');}return remove.call(fs,file,...args);});
 const pending=stageExchangeSnapshot(request(f,{signal:controller.signal}));const failure=assert.rejects(pending,e=>e.code==='IMAGE_DECODE_FAILED');
 t.after(async()=>{if(worker?.threadId!==-1)await terminate.call(worker);await pending.catch(()=>{});});
 await start;await once(worker,'online');controller.abort();
 let settled=false;void pending.then(()=>settled=true,()=>settled=true);await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(settled,false);assert.equal(removeCalls,0);assert.notEqual(worker.threadId,-1);assert.equal((await fs.readdir(f.cacheDir)).filter(n=>n.startsWith('.pending-')).length,1);
 await terminate.call(worker);await failure;
 assert.equal(removeCalls,1);assert.deepEqual(await fs.readdir(f.cacheDir),[good.manifest.id]);await fs.access(good.snapshotDir);
});

for(const mode of ['stage','load'])test('schema2 '+mode+' waits real session close before publication or final acknowledgement',{timeout:15000},async t=>{
 const {Worker}=require('node:worker_threads');
 const f=await fixture(t),good=await stageExchangeSnapshot(request(f)),terminate=Worker.prototype.terminate,rename=fs.rename;
 let enter,release;const entered=new Promise(resolve=>enter=resolve),held=new Promise(resolve=>release=resolve);let worker,renames=0;
 t.mock.method(Worker.prototype,'terminate',function(){worker=this;return terminate.call(this).then(async code=>{enter();await held;return code;});});
 t.mock.method(fs,'rename',(...args)=>{renames++;return rename.apply(fs,args);});
 const pending=mode==='stage'?stageExchangeSnapshot(request(f)):loadExchangeSnapshot(good.snapshotDir);
 let acknowledged=false;void pending.then(()=>acknowledged=true,()=>acknowledged=true);
 t.after(async()=>{release();await pending.catch(()=>{});});
 await entered;await new Promise(resolve=>setImmediate(resolve));assert.equal(worker.threadId,-1,'native worker actually exited');assert.equal(acknowledged,false);assert.equal(renames,0);
 if(mode==='stage')assert.equal((await fs.readdir(f.cacheDir)).filter(n=>n.startsWith('.pending-')).length,1);
 release();const complete=await pending;assert.equal(renames,mode==='stage'?1:0);assert.equal(complete.deck.slides.length,3);if(mode==='load')assert.equal(complete.snapshotDir,good.snapshotDir);
});
