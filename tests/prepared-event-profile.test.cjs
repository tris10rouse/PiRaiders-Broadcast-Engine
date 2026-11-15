'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { normalizePreparedEventProfile } = require('../scripts/lib/prepared-event-profile.cjs');
const base = path.resolve(os.tmpdir(), 'piraiders-profile-tests');
const abs = value => path.join(base, value);
function profile() {
  return {
    schemaVersion: 1, provider: 'local-manual', eventId: 'local-game-01',
    productionWindow: { start: '2026-11-15T19:00:00-06:00', end: '2026-11-15T22:00:00-06:00' },
    spx: { executable: process.execPath, args: ['server.js'], cwd: abs('app') },
    caspar: { executable: abs('components/caspar/casparcg.exe'), cwd: abs('components/caspar'), runtimeDir: abs('runtime/game') },
    media: { provider: 'local-lexical-v1', sourceDir: abs('source/game'), cacheDir: abs('cache/game'), startup: { mode: 'source' } },
    rossTalk: { allowedSenders: ['127.0.0.1'], commandMap: { 1: 'launch', 2: 'next', 3: 'previous', 4: 'toggle-auto', 5: 'reload', 8: 'stop' } }
  };
}
function rejects(raw) {
  assert.throws(() => normalizePreparedEventProfile(raw), error => {
    assert.equal(error.code, 'PROFILE_INVALID'); assert.equal(error.message, 'PROFILE_INVALID');
    assert.deepEqual(Object.keys(error), ['code']); return true;
  });
}
function deeplyFrozen(value) {
  if (value && typeof value === 'object') {
    assert.equal(Object.isFrozen(value), true);
    for (const item of Object.values(value)) deeplyFrozen(item);
  }
}

test('normalizes a local/manual profile with existing playback/window defaults without input mutation', () => {
  const raw = profile(), before = JSON.stringify(raw), normalized = normalizePreparedEventProfile(raw);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(normalized.productionWindow.start, '2026-11-16T01:00:00.000Z');
  assert.equal(normalized.productionWindow.end, '2026-11-16T04:00:00.000Z');
  assert.equal(normalized.productionWindow.prewarmMinutes, 15);
  assert.deepEqual(normalized.playback, { mode: 'auto', intervalMs: 10000, transition: { type: 'cut', durationMs: 0 } });
  assert.deepEqual(normalized.presentation, { port: 0 });
  assert.deepEqual(normalized.output, { type: 'none' });
  assert.equal(normalized.rossTalk.port, 7788);
  deeplyFrozen(normalized);
});

test('copies all mutable values and returns only the minimal RossTalk profile keys so session derives its budget', () => {
  const raw = profile(), normalized = normalizePreparedEventProfile(raw);
  assert.deepEqual(Object.keys(normalized.rossTalk).sort(), ['acknowledgements', 'allowedSenders', 'commandMap', 'host', 'port']);
  assert.equal(Object.hasOwn(normalized.rossTalk, 'handlerTimeoutMs'), false);
  raw.spx.args.push('private-user-config.json'); raw.rossTalk.allowedSenders.push('192.0.2.9');
  raw.rossTalk.commandMap[1] = 'stop'; raw.productionWindow.prewarmMinutes = 60;
  assert.deepEqual(normalized.spx.args, ['server.js']);
  assert.deepEqual(normalized.rossTalk.allowedSenders, ['127.0.0.1']);
  assert.equal(normalized.rossTalk.commandMap[1], 'launch');
  assert.equal(normalized.productionWindow.prewarmMinutes, 15);
});

test('rejects unknown fields, schema/provider confusion, and invalid event identity with fixed diagnostics', () => {
  for (const raw of [null, [], Object.create({}), { ...profile(), schemaVersion: 2 }, { ...profile(), provider: 'apps-script' },
    { ...profile(), feedId: 'must-not-be-accepted' }, { ...profile(), eventId: '' }, { ...profile(), eventId: 'Game Student Name' },
    { ...profile(), eventId: 'a'.repeat(65) }, { ...profile(), eventId: '-leading' }]) rejects(raw);
  const media = profile(); media.media.provider = 'drive-id'; rejects(media);
});

test('rejects hidden/accessor/symbol fields rather than accepting executable profile hooks', () => {
  const accessor = profile(); Object.defineProperty(accessor, 'eventId', { enumerable: true, get() { throw Error('/private/profile/secret'); } }); rejects(accessor);
  const hidden = profile(); Object.defineProperty(hidden, 'injected', { value: 'secret', enumerable: false }); rejects(hidden);
  const symbol = profile(); symbol[Symbol('hook')] = () => {}; rejects(symbol);
  const arrayHook = profile(); arrayHook.spx.args[Symbol.iterator] = function* () { yield 'hidden'; }; rejects(arrayHook);
  const senderHook = profile(); senderHook.rossTalk.allowedSenders[Symbol.iterator] = function* () { yield '127.0.0.1'; }; rejects(senderHook);
  let read = false; const mapping = profile();
  Object.defineProperty(mapping.rossTalk.commandMap, '1', { enumerable: true, get() { read = true; return 'launch'; } });
  rejects(mapping); assert.equal(read, false);
});

test('window uses existing bounded timezone/calendar rules and rejects extra schedule fields', () => {
  const changes = [
    { start: '2026-11-15T19:00:00' }, { end: '2026-11-15T19:00:00-06:00' },
    { start: '2026-02-30T19:00:00Z' }, { end: '2026-11-18T19:00:00Z' },
    { prewarmMinutes: 61 }, { timezone: 'America/Chicago' }
  ];
  for (const change of changes) { const raw = profile(); Object.assign(raw.productionWindow, change); rejects(raw); }
});

test('requires explicit absolute process/source/cache/runtime paths and rejects sparse or controlled arguments', () => {
  const mutations = [raw => { raw.spx.executable = 'node'; }, raw => { raw.spx.cwd = '.'; },
    raw => { raw.caspar.executable = 'casparcg.exe'; }, raw => { raw.caspar.runtimeDir = 'runtime'; },
    raw => { raw.caspar.cwd += '\n'; }, raw => { raw.media.sourceDir = 'source'; }, raw => { raw.media.cacheDir = ''; },
    raw => { raw.spx.args = Array(1); }, raw => { raw.spx.args = ['bad\0argument']; },
    raw => { raw.caspar.args = ['--log-enable']; }];
  for (const mutate of mutations) { const raw = profile(); mutate(raw); rejects(raw); }
});

test('rejects source/cache/runtime overlap in either direction while retaining sibling paths', () => {
  const pairs = [
    raw => { raw.media.cacheDir = raw.media.sourceDir; },
    raw => { raw.media.cacheDir = path.join(raw.media.sourceDir, 'cache'); },
    raw => { raw.media.sourceDir = path.dirname(raw.media.cacheDir); raw.media.cacheDir = path.join(raw.media.sourceDir, 'nested'); },
    raw => { raw.caspar.runtimeDir = path.join(raw.media.sourceDir, 'native'); },
    raw => { raw.caspar.runtimeDir = path.dirname(raw.media.cacheDir); },
    raw => { raw.media.sourceDir = path.join(raw.caspar.runtimeDir, 'source'); }
  ];
  for (const mutate of pairs) { const raw = profile(); mutate(raw); rejects(raw); }
  const siblings = profile(); siblings.media.sourceDir = abs('media'); siblings.media.cacheDir = abs('media-cache');
  assert.doesNotThrow(() => normalizePreparedEventProfile(siblings));
});

test('Windows path equality is case-insensitive without inventing case folding on POSIX', () => {
  const raw = profile(); raw.media.sourceDir = abs('Media'); raw.media.cacheDir = abs('media');
  if (process.platform === 'win32') rejects(raw);
  else assert.doesNotThrow(() => normalizePreparedEventProfile(raw));
});

test('cached startup is explicit and must be lexically below its declared cache', () => {
  const raw = profile(); raw.media.startup = { mode: 'cached', snapshotDir: path.join(raw.media.cacheDir, 'e1010101-1010-4010-8010-101010101010') };
  const normalized = normalizePreparedEventProfile(raw);
  assert.equal(normalized.media.startup.mode, 'cached');
  assert.equal(normalized.media.startup.snapshotDir, raw.media.startup.snapshotDir);
  for (const startup of [{ mode: 'cached' }, { mode: 'cached', snapshotDir: raw.media.cacheDir },
    { mode: 'cached', snapshotDir: abs('elsewhere/snapshot') }, { mode: 'source', snapshotDir: raw.media.startup.snapshotDir },
    { mode: 'fallback' }]) { const invalid = profile(); invalid.media.startup = startup; rejects(invalid); }
});

test('reuses slideshow validation for manual/Auto timing and configurable fades', () => {
  const raw = profile(); raw.playback = { mode: 'manual', intervalMs: 2500, transition: { type: 'fade', durationMs: 10000 } };
  const normalized = normalizePreparedEventProfile(raw);
  assert.deepEqual(normalized.playback, raw.playback); assert.notStrictEqual(normalized.playback, raw.playback);
  for (const playback of [{ intervalMs: 0 }, { mode: 'automatic' }, { intervalMs: 3600001 },
    { transition: { type: 'cut', durationMs: 1 } }, { transition: { type: 'fade', durationMs: 10001 } },
    { transition: { type: 'fade', durationMs: 1000, callback() {} } }, { renderer: {} }]) rejects({ ...profile(), playback });
});

test('presentation and allowlisted RossTalk use existing production validation and reject advanced knobs', () => {
  assert.equal(normalizePreparedEventProfile({ ...profile(), presentation: { port: 65535 } }).presentation.port, 65535);
  for (const presentation of [{ port: -1 }, { port: 65536 }, { port: 1.5 }, { host: '0.0.0.0' }]) rejects({ ...profile(), presentation });
  for (const change of [{ port: 0 }, { allowedSenders: [] }, { host: 'localhost' }, { commandMap: { 1: 'PLAY' } },
    { handlerTimeoutMs: 100000 }, { maxQueue: 100 }]) { const raw = profile(); Object.assign(raw.rossTalk, change); rejects(raw); }
  const raw = profile(); raw.rossTalk.allowedSenders = ['127.0.0.1', '::ffff:127.0.0.1'];
  assert.deepEqual(normalizePreparedEventProfile(raw).rossTalk.allowedSenders, ['127.0.0.1']);
});

test('NDI output remains explicit, bounded printable ASCII and separate from opaque runtime installation paths', () => {
  const raw = profile(); raw.output = { type: 'ndi', name: 'PiRaiders "A" & B', runtimeDirectory: abs('components/ndi') };
  const normalized = normalizePreparedEventProfile(raw);
  assert.deepEqual(normalized.output, raw.output); deeplyFrozen(normalized.output);
  for (const output of [{ type: 'none', name: 'unexpected' }, { type: 'ndi', name: 'N', runtimeDirectory: 'relative' },
    { type: 'ndi', name: 'a'.repeat(65), runtimeDirectory: abs('ndi') },
    { type: 'ndi', name: ' bad ', runtimeDirectory: abs('ndi') },
    { type: 'ndi', name: 'é', runtimeDirectory: abs('ndi') },
    { type: 'ndi', name: 'N\n', runtimeDirectory: abs('ndi') }, { type: 'tcp-amcp' }]) rejects({ ...profile(), output });
});
