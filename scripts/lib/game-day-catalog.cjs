'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');
const { normalizeRendererProfile } = require('./caspar-renderer.cjs');
const { normalizePreparedEventProfile } = require('./prepared-event-profile.cjs');
const { normalizeRendererSetting } = require('./graphics-check.cjs');
const MAX_BYTES = 64 * 1024, MAX_ENTRIES = 128;
const machines = new WeakSet();
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fail(code) { throw Object.assign(Error(code), { code }); }
function object(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key)) ||
      required.some(key => !Object.hasOwn(value, key))) throw Error('invalid');
  for (const entry of Object.values(Object.getOwnPropertyDescriptors(value))) if (!Object.hasOwn(entry, 'value') || !entry.enumerable) throw Error('invalid');
  return value;
}
function freeze(value) { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; }
function text(value, maximum = 4096) { if (typeof value !== 'string' || !value || value.length > maximum || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) throw Error('invalid'); return value; }
function eventId(value) { return typeof value === 'string' && value.length <= 64 && ID.test(value); }
function relative(value) {
  text(value);
  if (path.isAbsolute(value) || /[\\:<>"|?*]/.test(value) || value.split('/').some(part => {
    // Compile portable Win32 paths even when validating on Linux. Win32 strips
    // trailing dots/spaces and recognizes device names with extensions.
    const basename = part.split('.')[0].trim();
    return !part || part === '.' || part === '..' || /[. ]$/.test(part) ||
      /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(basename);
  })) throw Error('invalid');
  return value;
}
function absolute(value) { text(value); if (!path.isAbsolute(value)) throw Error('invalid'); return path.resolve(value); }
function machinePath(root, value) { text(value); return path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, relative(value)); }
function within(root, file) { const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const rel = path.relative(normalize(root), normalize(file)); return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep); }
function signature(stat) { return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':'); }
async function noLinks(file) {
  let cursor = path.parse(file).root;
  for (const segment of path.relative(cursor, file).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment); const stat = await fs.lstat(cursor, { bigint: true });
    if (stat.isSymbolicLink()) throw Error('invalid');
    if (cursor !== file && !stat.isDirectory()) throw Error('invalid');
  }
}
// Bound bytes before parsing and compare both the open file and pathname after
// reading. This detects observed replacement/mutation; it is not an OS-atomic
// filesystem snapshot or protection against a malicious local administrator.
async function readJSON(file, root) {
  await noLinks(file);
  if (root && !within(await fs.realpath(root), await fs.realpath(file))) throw Error('invalid');
  const before = await fs.lstat(file, { bigint: true });
  if (!before.isFile() || before.size > BigInt(MAX_BYTES)) throw Error('invalid');
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    if (signature(await handle.stat({ bigint: true })) !== signature(before)) throw Error('invalid');
    const bytes = Buffer.alloc(MAX_BYTES + 1); let size = 0;
    for (;;) { const part = await handle.read(bytes, size, bytes.length - size, size); size += part.bytesRead;
      if (size > MAX_BYTES) throw Error('invalid'); if (!part.bytesRead) break; }
    await noLinks(file);
    if (root && !within(await fs.realpath(root), await fs.realpath(file))) throw Error('invalid');
    const opened = await handle.stat({ bigint: true }), after = await fs.lstat(file, { bigint: true });
    if (!after.isFile() || signature(before) !== signature(opened) || signature(before) !== signature(after) || BigInt(size) !== before.size) throw Error('invalid');
    const raw = bytes.subarray(0, size), decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
    return { value: JSON.parse(decoded), revision: crypto.createHash('sha256').update(raw).digest('hex') };
  } finally { await handle?.close(); }
}
function compile(machine, raw, selected) {
  object(raw, ['schemaVersion', 'provider', 'eventId', 'displayName', 'productionWindow', 'relativeSourcePath', 'playback', 'startup'],
    ['schemaVersion', 'provider', 'eventId', 'displayName', 'productionWindow', 'relativeSourcePath', 'startup']);
  if (raw.schemaVersion !== 1 || raw.provider !== 'local-manual' || !eventId(raw.eventId) || raw.eventId !== selected) throw Error('invalid');
  const descriptor = { eventId: raw.eventId, displayName: text(raw.displayName, 128) };
  const sourceDir = path.join(machine.mediaRoot, ...relative(raw.relativeSourcePath).split('/'));
  const cacheDir = path.join(machine.cacheRoot, selected), runtimeDir = path.join(machine.runtimeRoot, selected);
  object(raw.startup, ['mode', 'snapshotId'], ['mode']);
  let startup;
  if (raw.startup.mode === 'source') { if (Object.hasOwn(raw.startup, 'snapshotId')) throw Error('invalid'); startup = { mode: 'source' }; }
  else if (raw.startup.mode === 'cached') { if (typeof raw.startup.snapshotId !== 'string' || !UUID.test(raw.startup.snapshotId)) throw Error('invalid'); startup = { mode: 'cached', snapshotDir: path.join(cacheDir, raw.startup.snapshotId) }; }
  else throw Error('invalid');
  const profile = normalizePreparedEventProfile({ schemaVersion: 1, provider: 'local-manual', eventId: selected,
    productionWindow: raw.productionWindow, spx: machine.spx, caspar: { ...machine.caspar, runtimeDir },
    media: { provider: 'local-lexical-v1', sourceDir, cacheDir, startup },
    ...(Object.hasOwn(raw, 'playback') ? { playback: raw.playback } : {}), presentation: machine.presentation,
    rossTalk: machine.rossTalk, output: machine.output });
  return { profile, descriptor };
}
async function loadGameDayMachineConfig(file, { appRoot, nodeExecutable } = {}) {
  try {
    appRoot = absolute(appRoot); nodeExecutable = absolute(nodeExecutable); file = absolute(file);
    const { value: raw } = await readJSON(file);
    object(raw, ['schemaVersion', 'spxConfigFile', 'catalogDirectory', 'mediaRoot', 'cacheRoot', 'runtimeRoot', 'caspar', 'output', 'presentation', 'rossTalk', 'source', 'renderer'],
      ['schemaVersion', 'spxConfigFile', 'catalogDirectory', 'mediaRoot', 'cacheRoot', 'runtimeRoot', 'caspar', 'output', 'rossTalk']);
    if (raw.schemaVersion !== 1) throw Error('invalid');
    object(raw.caspar, ['executable', 'cwd', 'rendererProfile'], ['executable', 'cwd']);
    const rendererProfile=normalizeRendererProfile(raw.caspar.rendererProfile);
    const machine = { schemaVersion: 1, appRoot, nodeExecutable, spxConfigFile: relative(raw.spxConfigFile),
      catalogDirectory: machinePath(appRoot, raw.catalogDirectory), mediaRoot: machinePath(appRoot, raw.mediaRoot),
      cacheRoot: machinePath(appRoot, raw.cacheRoot), runtimeRoot: machinePath(appRoot, raw.runtimeRoot),
      caspar: { executable: machinePath(appRoot, raw.caspar.executable), cwd: machinePath(appRoot, raw.caspar.cwd), ...(rendererProfile===undefined?{}:{rendererProfile}) },
      output: raw.output, presentation: raw.presentation === undefined ? {} : raw.presentation, rossTalk: raw.rossTalk,
      // Q-019: auto (default), gpu or software; anything else refuses the file.
      renderer: normalizeRendererSetting(raw.renderer) };
    const roots = [machine.mediaRoot, machine.cacheRoot, machine.runtimeRoot, machine.catalogDirectory];
    if (Object.hasOwn(raw, 'source')) {
      const source = raw.source;
      object(source, ['providerId', 'journalDirectory', 'journalStoreId', 'approvalDirectory', 'approvalStoreId', 'expectedCanonicalRoot', 'binding'],
        ['providerId', 'journalDirectory', 'journalStoreId', 'approvalDirectory', 'approvalStoreId', 'expectedCanonicalRoot', 'binding']);
      object(source.binding, ['feedId', 'epoch'], ['feedId', 'epoch']);
      if (typeof source.providerId !== 'string' || source.providerId.length > 64 || !ID.test(source.providerId) ||
          typeof source.journalStoreId !== 'string' || !UUID.test(source.journalStoreId) ||
          typeof source.approvalStoreId !== 'string' || !UUID.test(source.approvalStoreId) || source.journalStoreId === source.approvalStoreId ||
          typeof source.binding.feedId !== 'string' || !UUID.test(source.binding.feedId) ||
          !Number.isSafeInteger(source.binding.epoch) || source.binding.epoch < 1 || source.binding.epoch > 999999) throw Error('invalid');
      const expectedCanonicalRoot = absolute(source.expectedCanonicalRoot);
      if (expectedCanonicalRoot !== source.expectedCanonicalRoot) throw Error('invalid');
      machine.source = {providerId: source.providerId,
        journalDirectory: machinePath(appRoot, source.journalDirectory), journalStoreId: source.journalStoreId,
        approvalDirectory: machinePath(appRoot, source.approvalDirectory), approvalStoreId: source.approvalStoreId,
        expectedCanonicalRoot, binding: {...source.binding}};
      roots.push(machine.source.journalDirectory, machine.source.approvalDirectory);
      // The retained canonical source spelling is machine policy, not a reason
      // to contact an absent Drive mount during configuration loading.
      for (const privateRoot of roots.slice(1)) if (within(expectedCanonicalRoot, privateRoot) || within(privateRoot, expectedCanonicalRoot)) throw Error('invalid');
      for (const config of [file, path.join(appRoot, machine.spxConfigFile)]) {
        for (const root of [...roots, expectedCanonicalRoot]) if (within(root, config)) throw Error('invalid');
      }
    }
    for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++) if (within(roots[i], roots[j]) || within(roots[j], roots[i])) throw Error('invalid');
    machine.spx = { executable: nodeExecutable, args: [path.join(appRoot, 'server.js'), machine.spxConfigFile], cwd: appRoot };
    // Reuse established playback/window/transport/output validators without
    // reading source paths or requiring an attached Drive mount at startup.
    const checked = compile(machine, { schemaVersion: 1, provider: 'local-manual', eventId: 'validation', displayName: 'Validation',
      productionWindow: { start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z' }, relativeSourcePath: 'validation', startup: { mode: 'source' } }, 'validation').profile;
    machine.output = checked.output; machine.presentation = checked.presentation; machine.rossTalk = checked.rossTalk;
    freeze(machine); machines.add(machine); return machine;
  } catch { fail('MACHINE_CONFIG_INVALID'); }
}
function createLocalEventCatalog(machine) {
  // The loader is the trusted constructor. Copy only normalized machine policy,
  // never derive executable/output policy from a catalog entry.
  if (!machine || !machines.has(machine) || Object.hasOwn(machine,'source')) fail('MACHINE_CONFIG_INVALID');
  async function inventory() {
    await noLinks(machine.catalogDirectory); if (!(await fs.lstat(machine.catalogDirectory)).isDirectory()) throw Error('invalid');
    const directory = await fs.opendir(machine.catalogDirectory), names = [];
    try { for await (const entry of directory) { names.push(entry.name); if (names.length > MAX_ENTRIES) throw Error('invalid'); } }
    finally { await directory.close().catch(error => { if (error.code !== 'ERR_DIR_CLOSED') throw error; }); }
    const folded = new Set();
    for (const name of names) { const key = name.toLowerCase(); if (folded.has(key)) throw Error('invalid'); folded.add(key); }
    return names;
  }
  async function selectedRecord(selected, names) {
    const filename = selected + '.json';
    // Windows path lookup is case-insensitive; only an exact catalog entry is
    // selectable. An uppercase-only name must not bypass the listing policy.
    if (!names.includes(filename)) throw Error('invalid');
    const file = path.join(machine.catalogDirectory, filename);
    const { value, revision } = await readJSON(file, machine.catalogDirectory);
    if (path.basename(await fs.realpath(file)) !== filename) throw Error('invalid');
    return freeze({ ...compile(machine, value, selected), revision });
  }
  async function read(selected) {
    if (!eventId(selected)) fail('INVALID_EVENT_ID');
    try { return await selectedRecord(selected, await inventory()); }
    catch { fail('CATALOG_INVALID'); }
  }
  async function list() {
    try {
      const names = await inventory();
      const result = [];
      for (const name of names.sort()) {
        const selected = name.endsWith('.json') ? name.slice(0, -5) : null;
        const id = eventId(selected) ? selected : null;
        try { if (!id) throw Error('invalid'); const value = await selectedRecord(id, names); result.push({ ...value.descriptor, status: 'available' }); }
        catch { result.push({ eventId: id, displayName: 'Unavailable event', status: 'invalid', code: 'CATALOG_INVALID' }); }
      }
      return freeze(result);
    } catch { fail('CATALOG_INVALID'); }
  }
  return Object.freeze({ list, read });
}
function isGameDayMachineConfig(machine) { return machines.has(machine); }
module.exports = { loadGameDayMachineConfig, createLocalEventCatalog, isGameDayMachineConfig };
