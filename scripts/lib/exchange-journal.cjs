'use strict';
// Detached local journal; trusted validated facts only, never output readiness.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {canonicalExchangeJSON} = require('./exchange-fingerprints.cjs');
const {initialExchangeLedgerState, proposeExchangeLedgerEvent} = require('./exchange-ledger.cjs');
const LIMITS = Object.freeze({records: 10000, recordBytes: 98304, totalBytes: 67108864, temporaryFiles: 32});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const RECORD = /^([0-9]{12})\.json$/;
const TEMP = /^\.tmp-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CODES = new Set(['JOURNAL_ARGUMENT_INVALID', 'JOURNAL_EXISTS', 'JOURNAL_MISSING', 'JOURNAL_INVALID',
  'JOURNAL_CAPACITY_EXCEEDED', 'JOURNAL_CONFLICT', 'JOURNAL_EVENT_REJECTED', 'JOURNAL_IO_FAILED', 'JOURNAL_COMMIT_UNCERTAIN']);
function fail(code) { throw Error(code); }
function frozen(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
function shape(value, keys, code = 'JOURNAL_ARGUMENT_INVALID') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code);
  const fields = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(fields);
  if (names.length !== keys.length || keys.some(key => !Object.hasOwn(fields, key)) ||
      names.some(key => typeof key !== 'string' || !keys.includes(key) || !fields[key].enumerable || !Object.hasOwn(fields[key], 'value'))) fail(code);
}
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function filename(revision) { return String(revision).padStart(12, '0') + '.json'; }
function encoded(record) { return Buffer.from(canonicalExchangeJSON(record) + '\n', 'utf8'); }
function createExchangeJournal({io = fs.promises, phase = async () => {}, limits = LIMITS} = {}) {
  shape(limits, Object.keys(LIMITS));
  for (const name of Object.keys(LIMITS)) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] < 1 || limits[name] > LIMITS[name]) fail('JOURNAL_ARGUMENT_INVALID');
  }
  const bounds = {...limits};
  if (typeof phase !== 'function') fail('JOURNAL_ARGUMENT_INVALID');
  async function root(directory) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) !== directory) fail('JOURNAL_ARGUMENT_INVALID');
    const parsed = path.parse(directory);
    if (process.platform === 'win32' && parsed.root.startsWith('\\\\')) fail('JOURNAL_ARGUMENT_INVALID');
    let current = parsed.root;
    for (const component of ['', ...directory.slice(parsed.root.length).split(path.sep).filter(Boolean)]) {
      if (component) current = path.join(current, component);
      let stat;
      try { stat = await io.lstat(current); } catch (error) { if (error.code === 'ENOENT') fail('JOURNAL_MISSING'); throw error; }
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('JOURNAL_INVALID');
    }
  }
  async function readRecord(directory, name) {
    const target = path.join(directory, name), before = await io.lstat(target);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > bounds.recordBytes) fail('JOURNAL_INVALID');
    const handle = await io.open(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) fail('JOURNAL_INVALID');
      const bytes = Buffer.alloc(before.size + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const result = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!result.bytesRead) break; offset += result.bytesRead;
      }
      const after = await handle.stat();
      if (offset !== before.size || after.size !== before.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) fail('JOURNAL_INVALID');
      const delivered = bytes.subarray(0, offset);
      let record;
      try { record = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(delivered)); } catch { fail('JOURNAL_INVALID'); }
      shape(record, ['schemaVersion', 'kind', 'storeId', 'revision', 'parentSha256', 'event'], 'JOURNAL_INVALID');
      let canonical; try { canonical = encoded(record); } catch { fail('JOURNAL_INVALID'); }
      if (!canonical.equals(delivered)) fail('JOURNAL_INVALID');
      return {record, digest: sha(delivered), bytes: delivered.length};
    } finally { await handle.close(); }
  }
  async function replay(directory, expectedStoreId) {
    if (typeof expectedStoreId !== 'string' || !UUID.test(expectedStoreId)) fail('JOURNAL_ARGUMENT_INVALID');
    await root(directory);
    const names = [], iterator = await io.opendir(directory); let temporary = 0;
    for await (const entry of iterator) {
      if (RECORD.test(entry.name)) {
        if (!entry.isFile()) fail('JOURNAL_INVALID');
        if (names.length >= bounds.records) fail('JOURNAL_CAPACITY_EXCEEDED');
        names.push(entry.name);
      } else if (TEMP.test(entry.name)) {
        if (!entry.isFile() || ++temporary > bounds.temporaryFiles) fail('JOURNAL_CAPACITY_EXCEEDED');
        const temporaryStat = await io.lstat(path.join(directory, entry.name));
        if (!temporaryStat.isFile() || temporaryStat.isSymbolicLink() || temporaryStat.size > bounds.recordBytes) fail('JOURNAL_INVALID');
      } else fail('JOURNAL_INVALID');
    }
    names.sort(); if (!names.length) fail('JOURNAL_INVALID');
    let state = initialExchangeLedgerState(), digest = null, storeId = null, totalBytes = 0;
    for (let revision = 0; revision < names.length; revision++) {
      if (names[revision] !== filename(revision)) fail('JOURNAL_INVALID');
      const next = await readRecord(directory, names[revision]); totalBytes += next.bytes;
      if (totalBytes > bounds.totalBytes) fail('JOURNAL_CAPACITY_EXCEEDED');
      const record = next.record;
      if (record.schemaVersion !== 1 || record.revision !== revision || record.parentSha256 !== digest ||
          typeof record.storeId !== 'string' || !UUID.test(record.storeId)) fail('JOURNAL_INVALID');
      if (revision === 0) {
        if (record.kind !== 'genesis' || record.event !== null) fail('JOURNAL_INVALID'); storeId = record.storeId; if (storeId !== expectedStoreId) fail('JOURNAL_INVALID');
      } else {
        if (record.kind !== 'event' || record.storeId !== storeId) fail('JOURNAL_INVALID');
        const plan = proposeExchangeLedgerEvent(state, record.event);
        if (!plan.ok || !plan.changed || plan.nextRevision !== revision) fail('JOURNAL_INVALID'); state = plan.state;
      }
      digest = next.digest;
    }
    return {storeId, revision: state.revision, headSha256: digest, state, totalBytes, records: names.length};
  }
  function snapshot(head, extra = {}) {
    return frozen({ok: true, scope: 'exchange-journal', ready: false, storeId: head.storeId,
      revision: head.revision, headSha256: head.headSha256, state: head.state, ...extra});
  }
  async function publication(directory, record) {
    const bytes = encoded(record);
    if (bytes.length > bounds.recordBytes) fail('JOURNAL_CAPACITY_EXCEEDED');
    const temp = path.join(directory, '.tmp-' + crypto.randomUUID()), target = path.join(directory, filename(record.revision));
    let handle, owned = false, published = false;
    try {
      handle = await io.open(temp, 'wx', 0o600); owned = true; await phase('created');
      await handle.writeFile(bytes); await phase('written');
      await handle.sync(); await phase('synced');
      await handle.close(); handle = null; await phase('before-link');
      try { await io.link(temp, target); } catch (error) { if (error.code === 'EEXIST') fail('JOURNAL_CONFLICT'); fail('JOURNAL_COMMIT_UNCERTAIN'); }
      published = true; await phase('published');
      const verified = await readRecord(directory, filename(record.revision));
      if (verified.digest !== sha(bytes)) fail('JOURNAL_COMMIT_UNCERTAIN');
      return verified.digest;
    } catch (error) {
      if (published) fail('JOURNAL_COMMIT_UNCERTAIN'); throw error;
    } finally {
      if (handle) await handle.close().catch(() => {});
      // Only this invocation's private temporary name; committed files are never unlinked.
      if (owned) await io.unlink(temp).catch(() => {});
    }
  }
  async function result(operation) {
    try { return await operation(); } catch (error) {
      return frozen({ok: false, scope: 'exchange-journal', ready: false, code: CODES.has(error?.message) ? error.message : 'JOURNAL_IO_FAILED'});
    }
  }
  return Object.freeze({
    initialize(directory, storeId) { return result(async () => {
      if (typeof storeId !== 'string' || !UUID.test(storeId)) fail('JOURNAL_ARGUMENT_INVALID');
      if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) !== directory) fail('JOURNAL_ARGUMENT_INVALID');
      await root(path.dirname(directory));
      try { await io.mkdir(directory, {mode: 0o700}); } catch (error) { if (error.code === 'EEXIST') fail('JOURNAL_EXISTS'); throw error; }
      const record = {schemaVersion: 1, kind: 'genesis', storeId, revision: 0, parentSha256: null, event: null};
      if (encoded(record).length > bounds.totalBytes) fail('JOURNAL_CAPACITY_EXCEEDED');
      await publication(directory, record);
      try { return snapshot(await replay(directory, storeId), {committed: true, changed: true}); } catch { fail('JOURNAL_COMMIT_UNCERTAIN'); }
    }); },
    open(directory, expectedStoreId) { return result(async () => snapshot(await replay(directory, expectedStoreId), {committed: false, changed: false})); },
    append(directory, request) { return result(async () => {
      shape(request, ['expectedStoreId', 'expectedRevision', 'expectedHeadSha256', 'event']);
      if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0 || typeof request.expectedHeadSha256 !== 'string' || !SHA.test(request.expectedHeadSha256)) fail('JOURNAL_ARGUMENT_INVALID');
      // Capture the entire request before the first asynchronous boundary. A later
      // caller mutation cannot replace a checked data property with an accessor.
      const expectedRevision = request.expectedRevision, expectedHeadSha256 = request.expectedHeadSha256,
        expectedStoreId = request.expectedStoreId;
      let event;
      try {
        const eventBytes = canonicalExchangeJSON(request.event);
        if (Buffer.byteLength(eventBytes, 'utf8') > 65536) fail('JOURNAL_EVENT_REJECTED');
        event = JSON.parse(eventBytes);
      } catch { fail('JOURNAL_EVENT_REJECTED'); }
      const head = await replay(directory, expectedStoreId);
      if (head.revision !== expectedRevision || head.headSha256 !== expectedHeadSha256) fail('JOURNAL_CONFLICT');
      const plan = proposeExchangeLedgerEvent(head.state, event);
      if (!plan.ok) fail('JOURNAL_EVENT_REJECTED');
      if (!plan.changed) return snapshot(head, {committed: false, changed: false});
      const record = {schemaVersion: 1, kind: 'event', storeId: head.storeId, revision: plan.nextRevision, parentSha256: head.headSha256, event: plan.event};
      if (head.records >= bounds.records || head.totalBytes + encoded(record).length > bounds.totalBytes) fail('JOURNAL_CAPACITY_EXCEEDED');
      const digest = await publication(directory, record);
      return snapshot({...head, revision: plan.nextRevision, headSha256: digest, state: plan.state}, {committed: true, changed: true});
    }); }
  });
}
module.exports = {createExchangeJournal, EXCHANGE_JOURNAL_LIMITS: LIMITS};
