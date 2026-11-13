'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const { stageSnapshot, loadSnapshot } = require('../scripts/lib/media-snapshot.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function png(red = 120) { const image = new PNG({ width: 2, height: 2 }); image.data.fill(255); image.data[0] = red; return PNG.sync.write(image); }
function jpg() { return jpeg.encode({ width: 2, height: 2, data: Buffer.from([255, 0, 0, 255].flatMap(value => [value, value, value, value])) }, 80).data; }
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'piraiders-staging-')));
  const sourceDir = path.join(root, 'source'), cacheDir = path.join(root, 'cache');
  await fs.mkdir(sourceDir); t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, sourceDir, cacheDir, config: { sourceDir, cacheDir, quietMs: 0 } };
}
async function one(t) {
  const f = await fixture(t); const file = path.join(f.sourceDir, 'slide.png'); await fs.writeFile(file, png());
  return { ...f, file };
}
async function noPending(cacheDir) { assert.ok((await fs.readdir(cacheDir)).every(name => !name.startsWith('.pending-'))); }
function raceOnRead(t, target, mutate) {
  const original = fs.open;
  let installed = false;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await original(...args);
    if (!installed && args[0] === target) {
      installed = true; const originalRead = handle.read.bind(handle); let changed = false;
      handle.read = async (...readArgs) => {
        const value = await originalRead(...readArgs);
        if (!changed) { changed = true; await mutate(); }
        return value;
      };
    }
    return handle;
  });
}

test('actual nested JPG/PNG decode produces deterministic immutable snapshots without source paths', async t => {
  const f = await fixture(t); await fs.mkdir(path.join(f.sourceDir, 'nested'));
  await fs.writeFile(path.join(f.sourceDir, '2.JPG'), jpg());
  await fs.writeFile(path.join(f.sourceDir, '10.png'), png());
  await fs.writeFile(path.join(f.sourceDir, 'nested', 'a.PNG'), png(33));
  await fs.writeFile(path.join(f.sourceDir, 'notes.txt'), 'not an image');
  const first = await stageSnapshot(f.config), second = await stageSnapshot(f.config);
  assert.notEqual(first.snapshotDir, second.snapshotDir); assert.notEqual(first.deck.id, second.deck.id);
  assert.equal(first.manifest.contentHash, second.manifest.contentHash);
  assert.deepEqual(first.deck.slides.map(slide => slide.id), ['10.png', '2.JPG', 'nested/a.PNG'].map(sha));
  assert.deepEqual(first.manifest.files.map(file => [file.width, file.height, file.format]), [[2, 2, 'png'], [2, 2, 'jpeg'], [2, 2, 'png']]);
  assert.ok(!JSON.stringify(first.manifest).includes(f.sourceDir));
  assert.ok(Object.isFrozen(first)); assert.ok(Object.isFrozen(first.deck.slides[0]));
  assert.ok(Object.isFrozen(first.manifest.files)); assert.ok(Object.isFrozen(first.manifest.files[0]));
  assert.deepEqual((await loadSnapshot(first.snapshotDir)).manifest, first.manifest);
  await noPending(f.cacheDir);
});

test('offline load requires no source and later preparations never mutate the previous package', async t => {
  const f = await one(t); const first = await stageSnapshot(f.config);
  const original = await fs.readFile(path.join(first.snapshotDir, 'manifest.json'));
  await fs.writeFile(f.file, png(1)); const second = await stageSnapshot(f.config);
  assert.notEqual(first.manifest.contentHash, second.manifest.contentHash);
  assert.equal(first.deck.slides[0].id, second.deck.slides[0].id);
  await fs.rm(f.sourceDir, { recursive: true });
  assert.deepEqual((await loadSnapshot(first.snapshotDir)).manifest, first.manifest);
  assert.deepEqual(await fs.readFile(path.join(first.snapshotDir, 'manifest.json')), original);
});

test('corrupt candidate and failed source do not replace a last good snapshot', async t => {
  const f = await one(t), first = await stageSnapshot(f.config);
  await fs.writeFile(path.join(f.sourceDir, 'broken.png'), png().subarray(0, 24));
  await assert.rejects(stageSnapshot(f.config), error => ['INVALID_IMAGE', 'IMAGE_DECODE_FAILED'].includes(error.code));
  await noPending(f.cacheDir);
  assert.deepEqual((await loadSnapshot(first.snapshotDir)).deck, first.deck);
  await fs.rm(f.sourceDir, { recursive: true }); await assert.rejects(stageSnapshot(f.config), { code: 'SNAPSHOT_IO' });
  assert.deepEqual((await loadSnapshot(first.snapshotDir)).deck, first.deck);
});

test('empty, oversized, entry, depth, count, total and image dimension limits fail closed', async t => {
  const f = await fixture(t); await assert.rejects(stageSnapshot(f.config), { code: 'EMPTY_DECK' });
  await fs.writeFile(path.join(f.sourceDir, 'empty.png'), Buffer.alloc(0));
  await assert.rejects(stageSnapshot(f.config), { code: 'EMPTY_IMAGE' }); await fs.rm(path.join(f.sourceDir, 'empty.png'));
  const bytes = png(); await fs.writeFile(path.join(f.sourceDir, 'a.png'), bytes);
  await assert.rejects(stageSnapshot({ ...f.config, maxFileBytes: bytes.length - 1 }), { code: 'FILE_LIMIT' });
  await assert.rejects(stageSnapshot({ ...f.config, maxTotalBytes: bytes.length - 1 }), { code: 'TOTAL_LIMIT' });
  await assert.rejects(stageSnapshot({ ...f.config, maxPixels: 3 }), { code: 'IMAGE_DIMENSION_LIMIT' });
  await fs.writeFile(path.join(f.sourceDir, 'b.png'), bytes);
  await assert.rejects(stageSnapshot({ ...f.config, maxFiles: 1 }), { code: 'FILE_COUNT_LIMIT' });
  await assert.rejects(stageSnapshot({ ...f.config, maxEntries: 1 }), { code: 'ENTRY_LIMIT' });
  await fs.mkdir(path.join(f.sourceDir, 'nested'));
  await assert.rejects(stageSnapshot({ ...f.config, maxDepth: 0 }), { code: 'DEPTH_LIMIT' }); await noPending(f.cacheDir);
});

test('source/cache overlap and invalid configuration are rejected before staging', async t => {
  const f = await one(t);
  await assert.rejects(stageSnapshot({ ...f.config, cacheDir: path.join(f.sourceDir, 'cache') }), { code: 'OVERLAPPING_ROOTS' });
  await assert.rejects(fs.stat(path.join(f.sourceDir, 'cache')), { code: 'ENOENT' });
  await assert.rejects(stageSnapshot({ ...f.config, cacheDir: f.root }), { code: 'OVERLAPPING_ROOTS' });
  for (const options of [{ quietMs: -1 }, { maxFileBytes: 21 * 1024 * 1024 }, { maxFiles: 1.5 }, { signal: {} }, { maxFileCount: 5 }, { sourceDir: 'relative' }]) {
    await assert.rejects(stageSnapshot({ ...f.config, ...options }), { code: 'INVALID_OPTIONS' });
  }
  await assert.rejects(stageSnapshot(), { code: 'INVALID_OPTIONS' });
  await assert.rejects(loadSnapshot(path.join(f.root, '.pending-test')), { code: 'INVALID_SNAPSHOT' });
});

test('case-fold collisions reject names that cannot coexist on ordinary Windows volumes', { skip: process.platform === 'win32' ? 'Ordinary Windows case-insensitive filesystem cannot represent this fixture' : false }, async t => {
  const f = await one(t); await fs.writeFile(path.join(f.sourceDir, 'SLIDE.PNG'), png());
  await assert.rejects(stageSnapshot(f.config), { code: 'AMBIGUOUS_NAMES' });
});

test('Unicode-normalized collisions reject ambiguous source names on both operating systems', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.sourceDir, '\u00e9.png'), png()); await fs.writeFile(path.join(f.sourceDir, 'e\u0301.png'), png());
  await assert.rejects(stageSnapshot(f.config), { code: 'AMBIGUOUS_NAMES' });
});

test('actual source symlink or Windows junction and prospective cache overlap are rejected', async t => {
  const f = await one(t), outside = path.join(f.root, 'outside'); await fs.mkdir(outside);
  await fs.symlink(outside, path.join(f.sourceDir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(stageSnapshot(f.config), { code: 'UNSAFE_SOURCE' });
  await fs.rm(path.join(f.sourceDir, 'linked'), { recursive: true });
  const cacheAlias = path.join(f.root, 'cache-alias');
  await fs.symlink(f.sourceDir, cacheAlias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(stageSnapshot({ ...f.config, cacheDir: path.join(cacheAlias, 'new-cache') }), { code: 'OVERLAPPING_ROOTS' });
});

test('bounded read detects concurrent growth and cleans its own partial package', async t => {
  const f = await one(t); raceOnRead(t, f.file, () => fs.appendFile(f.file, Buffer.alloc(1024)));
  await assert.rejects(stageSnapshot(f.config), { code: 'SOURCE_CHANGED' });
  await noPending(f.cacheDir); assert.deepEqual(await fs.readdir(f.cacheDir), []);
});

test('replacement or deletion after a real read rejects the whole candidate', async t => {
  for (const change of ['replace', 'delete']) {
    const f = await one(t);
    raceOnRead(t, f.file, async () => {
      if (change === 'replace') { await fs.rename(f.file, path.join(f.sourceDir, 'old.data')); await fs.writeFile(f.file, png()); }
      else await fs.rm(f.file);
    });
    await assert.rejects(stageSnapshot(f.config), error => ['SOURCE_CHANGED', 'SNAPSHOT_IO'].includes(error.code));
    await noPending(f.cacheDir); t.mock.restoreAll();
  }
});

test('abort and interrupted atomic rename clean only their candidate, preserving prior versions', async t => {
  const f = await one(t), previous = await stageSnapshot(f.config), abort = new AbortController();
  raceOnRead(t, f.file, async () => abort.abort());
  await assert.rejects(stageSnapshot({ ...f.config, signal: abort.signal }), { code: 'IMAGE_ABORTED' });
  t.mock.restoreAll(); await noPending(f.cacheDir);
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (...args) => { if (path.basename(args[0]).startsWith('.pending-')) throw Object.assign(Error('private path'), { code: 'EACCES' }); return rename(...args); });
  await assert.rejects(stageSnapshot(f.config), error => error.code === 'SNAPSHOT_IO' && !error.message.includes('private path'));
  t.mock.restoreAll(); await noPending(f.cacheDir);
  assert.deepEqual((await loadSnapshot(previous.snapshotDir)).manifest, previous.manifest);
});

test('concurrent preparations publish separate complete snapshots with identical content identity', async t => {
  const f = await one(t);
  const [first, second] = await Promise.all([stageSnapshot(f.config), stageSnapshot(f.config)]);
  assert.notEqual(first.snapshotDir, second.snapshotDir); assert.equal(first.manifest.contentHash, second.manifest.contentHash);
  assert.deepEqual((await loadSnapshot(first.snapshotDir)).manifest, first.manifest);
  assert.deepEqual((await loadSnapshot(second.snapshotDir)).manifest, second.manifest); await noPending(f.cacheDir);
});

test('offline verification rejects corrupt/missing/extra cache content and malformed unsafe manifests', async t => {
  const f = await one(t);
  let staged = await stageSnapshot(f.config);
  await fs.appendFile(path.join(staged.snapshotDir, staged.manifest.files[0].src), Buffer.from('changed'));
  await assert.rejects(loadSnapshot(staged.snapshotDir), { code: 'CACHE_CHANGED' });
  staged = await stageSnapshot(f.config); await fs.rm(path.join(staged.snapshotDir, staged.manifest.files[0].src));
  await assert.rejects(loadSnapshot(staged.snapshotDir), { code: 'UNEXPECTED_CONTENT' });
  staged = await stageSnapshot(f.config); await fs.writeFile(path.join(staged.snapshotDir, 'extra.txt'), 'extra');
  await assert.rejects(loadSnapshot(staged.snapshotDir), { code: 'UNEXPECTED_CONTENT' });
  staged = await stageSnapshot(f.config); const manifest = JSON.parse(await fs.readFile(path.join(staged.snapshotDir, 'manifest.json')));
  manifest.files[0].src = '../escape.png'; await fs.writeFile(path.join(staged.snapshotDir, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(loadSnapshot(staged.snapshotDir), { code: 'INVALID_MANIFEST' });
  staged = await stageSnapshot(f.config); await fs.writeFile(path.join(staged.snapshotDir, 'manifest.json'), '{broken');
  await assert.rejects(loadSnapshot(staged.snapshotDir), { code: 'INVALID_MANIFEST' });
});

test('offline full decode rejects a consistently rehashed corrupt image rather than trusting hashes alone', async t => {
  const f = await one(t), staged = await stageSnapshot(f.config);
  const manifest = JSON.parse(await fs.readFile(path.join(staged.snapshotDir, 'manifest.json'))), file = manifest.files[0];
  const originalPath = path.join(staged.snapshotDir, file.src), invalid = Buffer.from('not a PNG');
  file.sha256 = sha(invalid); file.bytes = invalid.length; file.src = 'media/' + file.id + '-' + file.sha256 + '.png';
  await fs.rename(originalPath, path.join(staged.snapshotDir, file.src)); await fs.writeFile(path.join(staged.snapshotDir, file.src), invalid);
  manifest.contentHash = sha(JSON.stringify(manifest.files)); await fs.writeFile(path.join(staged.snapshotDir, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(loadSnapshot(staged.snapshotDir), error => ['INVALID_IMAGE', 'IMAGE_DECODE_FAILED'].includes(error.code));
});


test('the quiet-period inventory rejects a source change before capture', async t => {
  const f = await one(t), original = fs.opendir; let scans = 0;
  t.mock.method(fs, 'opendir', async (...args) => {
    if (args[0] === f.sourceDir && ++scans === 2) await fs.writeFile(f.file, png(9));
    return original(...args);
  });
  await assert.rejects(stageSnapshot({ ...f.config, quietMs: 10 }), { code: 'SOURCE_CHANGED' });
  await noPending(f.cacheDir);
});

test('directory enumeration stops at the entry budget without materializing every name', async t => {
  const f = await fixture(t); for (let i = 0; i < 10; i++) await fs.writeFile(path.join(f.sourceDir, i + '.png'), png());
  const original = fs.opendir; let yielded = 0;
  t.mock.method(fs, 'opendir', async (...args) => {
    const dir = await original(...args);
    if (args[0] === f.sourceDir) {
      const iterator = dir[Symbol.asyncIterator].bind(dir);
      dir[Symbol.asyncIterator] = async function* () { for await (const entry of iterator()) { yielded++; yield entry; } };
    }
    return dir;
  });
  await assert.rejects(stageSnapshot({ ...f.config, maxEntries: 2 }), { code: 'ENTRY_LIMIT' });
  assert.equal(yielded, 3);
});

test('offline load catches modification of an earlier file during later decode and rejects option typos', async t => {
  const f = await one(t); await fs.writeFile(path.join(f.sourceDir, 'second.png'), png(7));
  const staged = await stageSnapshot(f.config);
  await assert.rejects(loadSnapshot(staged.snapshotDir, { maxFileCount: 5 }), { code: 'INVALID_OPTIONS' });
  const first = path.join(staged.snapshotDir, staged.manifest.files[0].src), second = path.join(staged.snapshotDir, staged.manifest.files[1].src);
  raceOnRead(t, second, () => fs.appendFile(first, Buffer.from('change')));
  await assert.rejects(loadSnapshot(staged.snapshotDir), { code: 'CACHE_CHANGED' });
});


test('strict manifest types reject coercible arrays/objects instead of returning mutable slide IDs', async t => {
  const f = await one(t);
  for (const [key, wrap] of [['id', value => [value]], ['sha256', value => [value]], ['src', value => [value]], ['format', value => [value]]]) {
    const staged = await stageSnapshot(f.config), manifestPath = path.join(staged.snapshotDir, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath));
    manifest.files[0][key] = wrap(manifest.files[0][key]); manifest.contentHash = sha(JSON.stringify(manifest.files));
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(loadSnapshot(staged.snapshotDir), { code: 'INVALID_MANIFEST' });
  }
});
