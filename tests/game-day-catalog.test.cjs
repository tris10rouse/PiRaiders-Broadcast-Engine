'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { loadGameDayMachineConfig, createLocalEventCatalog } = require('../scripts/lib/game-day-catalog.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'PiRaiders local catalog '));
  const cleanups=[];
  t.after(async () => { for(const cleanup of cleanups)await cleanup();await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const catalogDirectory = path.join(root, 'catalog'); await fs.mkdir(catalogDirectory);
  const file = path.join(root, 'machine.json');
  const raw = { schemaVersion: 1, spxConfigFile: 'config/spx.json', catalogDirectory,
    mediaRoot: path.join(root, 'offline Drive'), cacheRoot: path.join(root, 'cache'), runtimeRoot: path.join(root, 'runtime'),
    caspar: { executable: path.join(root, 'components/casparcg.exe'), cwd: path.join(root, 'components') },
    output: { type: 'none' }, rossTalk: { host: '127.0.0.1', port: 7788, allowedSenders: ['127.0.0.1'], commandMap: { 1: 'launch', 8: 'stop' } } };
  const event = { schemaVersion: 1, provider: 'local-manual', eventId: 'football', displayName: 'Football vs Visitors',
    productionWindow: { start: '2026-11-15T18:00:00-06:00', end: '2026-11-15T21:00:00-06:00' },
    relativeSourcePath: '2026/Football', startup: { mode: 'source' } };
  async function load() { await fs.writeFile(file, JSON.stringify(raw)); return loadGameDayMachineConfig(file, { appRoot: root, nodeExecutable: process.execPath }); }
  async function write(value = event, bytes = JSON.stringify(value)) { await fs.writeFile(path.join(catalogDirectory, value.eventId + '.json'), bytes); return bytes; }
  return { root, file, raw, event, catalogDirectory, load, write, cleanup:fn=>cleanups.push(fn) };
}

test('strict machine policy compiles immutable local profiles and hashes exact selected bytes', async t => {
  const f = await fixture(t), machine = await f.load(), bytes = await f.write();
  const catalog = createLocalEventCatalog(machine), record = await catalog.read('football');
  assert.equal(record.revision, hash(bytes)); assert.deepEqual(record.descriptor, { eventId: 'football', displayName: 'Football vs Visitors' });
  assert.deepEqual(record.profile.spx, { executable: process.execPath, args: [path.join(f.root, 'server.js'), 'config/spx.json'], cwd: f.root });
  assert.equal(record.profile.media.sourceDir, path.join(f.raw.mediaRoot, '2026', 'Football'));
  assert.equal(record.profile.media.cacheDir, path.join(f.raw.cacheRoot, 'football'));
  assert.equal(record.profile.caspar.runtimeDir, path.join(f.raw.runtimeRoot, 'football'));
  assert.equal(record.profile.productionWindow.prewarmMinutes, 15); assert.equal(record.profile.playback.intervalMs, 10000);
  assert.ok(Object.isFrozen(machine)); assert.ok(Object.isFrozen(machine.rossTalk.commandMap));
  assert.ok(Object.isFrozen(record)); assert.ok(Object.isFrozen(record.descriptor)); assert.ok(Object.isFrozen(record.profile.media.startup));
  f.event.displayName = 'Changed on disk'; const edited = await f.write();
  assert.equal(record.descriptor.displayName, 'Football vs Visitors'); assert.equal(record.revision, hash(bytes));
  assert.equal((await catalog.read('football')).revision, hash(edited));
  assert.deepEqual(await catalog.list(), [{ eventId: 'football', displayName: 'Changed on disk', status: 'available' }]);
});

test('cached compilation never reads source or mediaRoot and keeps only an event-owned UUID cache reference', async t => {
  const f = await fixture(t); f.event.startup = { mode: 'cached', snapshotId: 'b95e324f-4960-4116-a6ea-9955535ce966' }; await f.write();
  const originals = new Map(); let sourceReads = 0;
  for (const name of ['stat', 'lstat', 'realpath', 'open', 'opendir']) { const original = fs[name]; originals.set(name, original);
    fs[name] = async function (value, ...args) { if (typeof value === 'string' && (value === f.raw.mediaRoot || value.startsWith(f.raw.mediaRoot + path.sep))) { sourceReads++; throw Error('unmounted source provider'); } return original.call(fs, value, ...args); }; }
  try { const machine = await f.load(), catalog = createLocalEventCatalog(machine), record = await catalog.read('football');
    assert.equal(record.profile.media.startup.snapshotDir, path.join(f.raw.cacheRoot, 'football', f.event.startup.snapshotId));
    assert.equal((await catalog.list())[0].status, 'available'); assert.equal(sourceReads, 0);
  } finally { for (const [name, original] of originals) fs[name] = original; }
});

test('catalog rejects source traversal, cache paths and machine-policy overrides before any runtime', async t => {
  const f = await fixture(t), catalog = createLocalEventCatalog(await f.load());
  for (const relativeSourcePath of ['../private', '2026/../private', '/absolute', 'C:/private', '2026\\Football', '.', '2026//Football', '2026/']) {
    await f.write({ ...f.event, relativeSourcePath }); await assert.rejects(catalog.read('football'), { code: 'CATALOG_INVALID' });
  }
  for (const extra of [{ caspar: { executable: process.execPath } }, { output: { type: 'ndi', name: 'untrusted' } }, { manageSpx: false }, { sourceRoot: f.root }, { rossTalk: {} }, { presentation: {} }]) {
    await f.write({ ...f.event, ...extra }); await assert.rejects(catalog.read('football'), { code: 'CATALOG_INVALID' });
  }
  for (const startup of [{ mode: 'cached', snapshotId: '../other' }, { mode: 'cached', snapshotDir: f.root }, { mode: 'source', snapshotId: 'unexpected' }]) {
    await f.write({ ...f.event, startup }); await assert.rejects(catalog.read('football'), { code: 'CATALOG_INVALID' });
  }
  for (const id of ['../private', 'Football', '/private', '', null, 7, 'a'.repeat(65)]) await assert.rejects(catalog.read(id), { code: 'INVALID_EVENT_ID' });
});

test('portable Win32 aliases are rejected in source and SPX config paths without source reads', async t => {
  const f = await fixture(t), catalog = createLocalEventCatalog(await f.load());
  const aliases = ['.. /outside', 'folder/.. /config.json', 'folder./media', 'folder /media',
    'CON', 'con.png', 'PRN.txt', 'AUX/data', 'NUL.json', 'COM1.jpg', 'COM9/cache', 'LPT1.png', 'lpt9.txt', 'COM¹', 'COM².png', 'LPT³',
    'folder/CON .txt', 'folder/COM3./data', 'folder/LPT4 .json', 'folder/file?.json', 'folder/<bad>.json'];
  const originals = new Map(); let sourceReads = 0;
  for (const name of ['stat', 'lstat', 'realpath', 'open', 'opendir']) { const original = fs[name]; originals.set(name, original);
    fs[name] = async function (value, ...args) { if (typeof value === 'string' && (value === f.raw.mediaRoot || value.startsWith(f.raw.mediaRoot + path.sep))) { sourceReads++; throw Error('must not read source'); } return original.call(fs, value, ...args); }; }
  try {
    for (const relativeSourcePath of aliases) {
      await f.write({ ...f.event, relativeSourcePath });
      await assert.rejects(catalog.read('football'), error => error.code === 'CATALOG_INVALID' && error.message === 'CATALOG_INVALID');
    }
    for (const spxConfigFile of aliases) {
      f.raw.spxConfigFile = spxConfigFile;
      await assert.rejects(f.load(), error => error.code === 'MACHINE_CONFIG_INVALID' && error.message === 'MACHINE_CONFIG_INVALID');
    }
    assert.equal(sourceReads, 0);
  } finally { for (const [name, original] of originals) fs[name] = original; }
});

test('list isolates corrupt/nonregular/unsafe entries using fixed sanitized descriptors', async t => {
  const f = await fixture(t), catalog = createLocalEventCatalog(await f.load()); await f.write();
  await fs.writeFile(path.join(f.catalogDirectory, 'broken.json'), '{private source-path');
  await fs.writeFile(path.join(f.catalogDirectory, 'PRIVATE-unsafe.json'), 'private credentials');
  await fs.mkdir(path.join(f.catalogDirectory, 'directory.json'));
  const rows = await catalog.list(); assert.equal(rows.length, 4);
  assert.deepEqual(rows.find(row => row.eventId === 'football'), { eventId: 'football', displayName: 'Football vs Visitors', status: 'available' });
  assert.deepEqual(rows.filter(row => row.status === 'invalid').map(row => [row.eventId, row.displayName, row.code]), [[null, 'Unavailable event', 'CATALOG_INVALID'], ['broken', 'Unavailable event', 'CATALOG_INVALID'], ['directory', 'Unavailable event', 'CATALOG_INVALID']]);
  const text = JSON.stringify(rows); assert.ok(!text.includes(f.root)); assert.ok(!text.includes('credentials')); assert.ok(!text.includes('PRIVATE-unsafe'));
  await assert.rejects(catalog.read('private-unsafe'), { code: 'CATALOG_INVALID' });
  await assert.rejects(catalog.read('broken'), error => error.code === 'CATALOG_INVALID' && error.message === 'CATALOG_INVALID');
});

test('catalog symlink and directory-junction ancestry never selects outside catalog files', async t => {
  const f = await fixture(t), machine = await f.load(), outside = path.join(f.root, 'outside'); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'football.json'), JSON.stringify(f.event));
  const linkedRoot = path.join(f.root, 'linked-catalog'); await fs.symlink(outside, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  f.raw.catalogDirectory = linkedRoot; const linkedCatalog = createLocalEventCatalog(await f.load());
  await assert.rejects(linkedCatalog.list(), { code: 'CATALOG_INVALID' }); await assert.rejects(linkedCatalog.read('football'), { code: 'CATALOG_INVALID' });
  const catalog = createLocalEventCatalog(machine);
  try { await fs.symlink(path.join(outside, 'football.json'), path.join(f.catalogDirectory, 'football.json'), 'file'); }
  catch (error) { if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) { t.diagnostic('Leaf symlink creation unavailable; directory-junction escape assertions already passed.'); return; } throw error; }
  await assert.rejects(catalog.read('football'), { code: 'CATALOG_INVALID' }); assert.equal((await catalog.list())[0].status, 'invalid');
});

test('catalog bounds exact 64KiB reads, malformed UTF8, names and event identity', async t => {
  const f = await fixture(t), catalog = createLocalEventCatalog(await f.load());
  const base = JSON.stringify(f.event), exact = base + ' '.repeat(65536 - Buffer.byteLength(base)); await f.write(f.event, exact);
  assert.equal((await catalog.read('football')).revision, hash(exact)); await f.write(f.event, exact + ' '); await assert.rejects(catalog.read('football'), { code: 'CATALOG_INVALID' });
  await f.write(f.event, Buffer.from([0xff, 0xfe])); await assert.rejects(catalog.read('football'), { code: 'CATALOG_INVALID' });
  for (const raw of [{ ...f.event, eventId: 'baseball' }, { ...f.event, displayName: 'x'.repeat(129) }, { ...f.event, displayName: 'Unsafe\nName' }, { ...f.event, provider: 'apps-script' }]) {
    await fs.writeFile(path.join(f.catalogDirectory, 'football.json'), JSON.stringify(raw)); await assert.rejects(catalog.read('football'), { code: 'CATALOG_INVALID' });
  }
});

test('catalog refuses more than128 directory entries, including invalid names', async t => {
  const f = await fixture(t), catalog = createLocalEventCatalog(await f.load());
  await Promise.all(Array.from({ length: 129 }, (_, i) => fs.writeFile(path.join(f.catalogDirectory, 'entry-' + i + '.json'), '{}')));
  await assert.rejects(catalog.list(), { code: 'CATALOG_INVALID' });
});

test('case-colliding catalog names are refused on case-sensitive filesystems', async t => {
  const f = await fixture(t), catalog = createLocalEventCatalog(await f.load()); await f.write();
  await fs.writeFile(path.join(f.catalogDirectory, 'FOOTBALL.json'), JSON.stringify(f.event));
  if ((await fs.readdir(f.catalogDirectory)).length !== 2) { t.skip('Filesystem cannot represent the case-collision fixture.'); return; }
  await assert.rejects(catalog.list(), { code: 'CATALOG_INVALID' });
  await assert.rejects(catalog.read('football'), { code: 'CATALOG_INVALID' });
});

test('machine strict policy refuses unknown fields, invalid transport, aliases and executable overrides', async t => {
  const f = await fixture(t), original = structuredClone(f.raw);
  for (const edit of [raw => raw.schemaVersion = 2, raw => raw.nodeExecutable = process.execPath, raw => raw.spx = {}, raw => raw.spxConfigFile = '../config.json', raw => raw.cacheRoot = raw.mediaRoot,
    raw => raw.runtimeRoot = path.join(raw.cacheRoot, 'nested'), raw => raw.catalogDirectory = raw.cacheRoot, raw => raw.cacheRoot = path.join(raw.mediaRoot, 'private-cache'), raw => raw.caspar.args = [], raw => raw.rossTalk.allowedSenders = ['hostname.invalid'], raw => raw.output = { type: 'none', name: 'hidden' }, raw => raw.presentation = { port: -1 }]) {
    const raw = structuredClone(original); edit(raw); await fs.writeFile(f.file, JSON.stringify(raw));
    await assert.rejects(loadGameDayMachineConfig(f.file, { appRoot: f.root, nodeExecutable: process.execPath }), { code: 'MACHINE_CONFIG_INVALID' });
  }
  await fs.writeFile(f.file, ' '.repeat(65537)); await assert.rejects(loadGameDayMachineConfig(f.file, { appRoot: f.root, nodeExecutable: process.execPath }), { code: 'MACHINE_CONFIG_INVALID' });
  await assert.rejects(loadGameDayMachineConfig(f.file, { appRoot: '.', nodeExecutable: process.execPath }), { code: 'MACHINE_CONFIG_INVALID' });
  assert.throws(() => createLocalEventCatalog(Object.freeze({ schemaVersion: 1, catalogDirectory: f.catalogDirectory })), { code: 'MACHINE_CONFIG_INVALID' });
});

test('concurrent real file rewrites fail closed or yield one complete validated revision', { timeout: 15000 }, async t => {
  const f = await fixture(t), catalog = createLocalEventCatalog(await f.load());
  const a = JSON.stringify(f.event), b = JSON.stringify({ ...f.event, displayName: 'Another football event' });
  const versions = [a + ' '.repeat(65536 - Buffer.byteLength(a)), b + '\t'.repeat(65536 - Buffer.byteLength(b))];
  await f.write(f.event, versions[0]); const target = path.join(f.catalogDirectory, 'football.json'), script = path.join(f.root, 'writer.cjs');
  const versionsFile = path.join(f.root, 'writer-input.json'); await fs.writeFile(versionsFile, JSON.stringify(versions));
  await fs.writeFile(script, "const fs=require('node:fs');let i=0;const values=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));function write(){fs.writeFileSync(process.argv[2],values[i++%2]);if(i%20)setImmediate(write);else setTimeout(write,5);}process.send('ready',write);");
  const child = fork(script, [target, versionsFile], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  f.cleanup(async () => { if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } }); await once(child, 'message');
  // The writer rewrites in untimed bursts of 20 with short pauses between, so reads both overlap rewrites (refused) and
  // fall between them (accepted). Reads go on until both have been seen or a bounded time passes, so a slow runner cannot
  // pass without a race; every accepted read must still be one whole version.
  const hashes = new Set(versions.map(hash)), deadline = Date.now() + 10000; let refused = 0, accepted = 0, reads = 0;
  while (reads < 30 || ((refused === 0 || accepted === 0) && Date.now() < deadline)) { reads++; try { const result = await catalog.read('football'); assert.ok(hashes.has(result.revision), 'accepted a mixed revision'); accepted++; } catch (error) { assert.equal(error.code, 'CATALOG_INVALID'); refused++; } }
  assert.ok(refused > 0, 'concurrent write race was not exercised in ' + reads + ' reads over 10 s');
  assert.ok(accepted > 0, 'no read fell between rewrites in ' + reads + ' reads over 10 s');
});


test('machine owns the fixed renderer selection and catalog rows cannot supply or override it',async t=>{
 const f=await fixture(t);f.raw.caspar.rendererProfile='mesa-llvmpipe-compat';const machine=await f.load();await f.write();
 const catalog=createLocalEventCatalog(machine),record=await catalog.read('football');
 assert.equal(machine.caspar.rendererProfile,'mesa-llvmpipe-compat');assert.equal(Object.isFrozen(machine.caspar),true);assert.equal(record.profile.caspar.rendererProfile,'mesa-llvmpipe-compat');
 f.raw.caspar.rendererProfile='unknown';assert.equal(record.profile.caspar.rendererProfile,'mesa-llvmpipe-compat');
 await assert.rejects(f.load(),error=>error.code==='MACHINE_CONFIG_INVALID');
 f.raw.caspar.rendererProfile='mesa-llvmpipe-compat';f.raw.caspar.env={GALLIUM_DRIVER:'arbitrary'};await assert.rejects(f.load(),error=>error.code==='MACHINE_CONFIG_INVALID');delete f.raw.caspar.env;
 await f.write({...f.event,caspar:{rendererProfile:'mesa-llvmpipe-compat'}});await assert.rejects(catalog.read('football'),error=>error.code==='CATALOG_INVALID');
});
