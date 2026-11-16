'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {createExchangeCatalogReceiptGate, EXCHANGE_CATALOG_RECEIPT_LIMITS: LIMITS} = require('../scripts/lib/exchange-catalog-receipt.cjs');
const {selectionId, canonicalExchangeJSON} = require('../scripts/lib/exchange-fingerprints.cjs');
const gate = createExchangeCatalogReceiptGate();
const FEED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
function entry(eventKey = 'EVENT-SYNTHETIC', label = 'synthetic', board = 'BOARD-SYNTHETIC', origin = 'event') {
  const identityTuple = ['2026-2027', eventKey, board === null ? '' : board, origin, label];
  const id = selectionId(identityTuple), generation = 'e1-g0000000001-' + 'b'.repeat(12);
  return {selectionId: id, identityTuple, origin, targetBoardKey: board, displayLabel: 'Original Display Label',
    templateButtonKey: origin === 'season' ? label : null, labelShared: false, generation, generationSequence: 1,
    manifestPath: 'selections/' + id + '/generations/' + generation + '/manifest.json', manifestSha256: 'c'.repeat(64),
    playbackFingerprint: 'd'.repeat(64), metadataFingerprint: 'b'.repeat(64), occurrenceCount: 0, manifestState: 'empty'};
}
function event(key = 'EVENT-SYNTHETIC', selections = [entry(key)]) {
  return {eventKey: key, displayName: 'Synthetic event', eventDate: '2026-11-16', eventType: 'Synthetic', homeSchool: 'Synthetic school',
    venue: 'Synthetic venue', playbackArea: 'Stadium Playback', boardOnly: true,
    eventBoard: {boardKey: 'BOARD-SYNTHETIC', displayName: 'Synthetic board'}, eligibility: {eligible: true, reasonCodes: []},
    timing: {timeZone: 'America/Chicago', eventStartsAt: null, startSource: 'missing', eventEndsAt: null, endSource: 'missing',
      broadcastWindow: {startsAt: null, endsAt: null, startSource: 'missing', endSource: 'missing'}, operatingWindow: null,
      unavailableReasons: ['START_NOT_DEFINED', 'END_NOT_DEFINED']}, selections};
}
function documents() {
  return {feed: {contractVersion: 'piraiders-event-feed/1', feedId: FEED, epoch: 1, createdAt: '2026-11-16T00:00:00Z', publisher: 'PiRaiders Scheduler'},
    catalog: {contractVersion: 'piraiders-event-catalog/1', feedId: FEED, epoch: 1, catalogSequence: 1,
      generatedAt: '2026-11-16T00:00:00Z', sourceVersion: '0.0.0', schoolYear: '2026-2027', events: [event()]}};
}
function input(docs = documents()) {return {feedBytes: Buffer.from(JSON.stringify(docs.feed)), catalogBytes: Buffer.from(JSON.stringify(docs.catalog)), expectedBinding: {feedId: FEED, epoch: 1}};}
function accepted(raw) {
  const result = gate.validate(raw); assert.equal(result.ok, true, result.code); assert.equal(result.ready, false); assert.equal(result.semanticValidation, 'pending');
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.receipt), true); assert.equal(Object.isFrozen(result.receipt.catalog.events), true);
  assert.equal(result.receipt.documentDigests.feed, digest(raw.feedBytes)); assert.equal(result.receipt.documentDigests.catalog, digest(raw.catalogBytes));
  return result.receipt;
}
function rejected(raw, code) {
  assert.deepEqual(gate.validate(raw), {ok: false, code, scope: 'catalog-receipt', ready: false, semanticValidation: 'pending'});
}
test('complete raw documents produce immutable exact-byte catalog metadata without manifest or asset I/O', () => {
  const raw = input(), receipt = accepted(raw);
  assert.equal(receipt.feedId, FEED); assert.equal(receipt.epoch, 1); assert.equal(receipt.catalogSequence, 1); assert.equal(receipt.ready, false);
  assert.equal(receipt.scope, 'validated-catalog-metadata'); assert.equal(Object.getPrototypeOf(receipt.catalog), null);
  assert.equal(Object.hasOwn(receipt, 'operatingWindow'), false); assert.equal(Object.hasOwn(receipt, 'manifest'), false);
  assert.equal(Object.hasOwn(receipt, 'committed'), false); assert.equal(Object.hasOwn(receipt, 'journalEvent'), false);
});
test('empty catalogs and changed active school years require no selected event or manifest', () => {
  const docs = documents(); docs.catalog.events = []; docs.catalog.schoolYear = '2027-2028';
  const receipt = accepted(input(docs)); assert.deepEqual(receipt.catalog.events, []); assert.equal(receipt.catalog.schoolYear, '2027-2028');
});
test('whitespace stays in raw digests and caller Buffer mutation cannot change returned receipt', () => {
  const first = input(), second = {...first, catalogBytes: Buffer.from(first.catalogBytes.toString() + '\n')};
  const a = accepted(first), b = accepted(second); assert.deepEqual(a.catalog, b.catalog); assert.notEqual(a.documentDigests.catalog, b.documentDigests.catalog);
  const saved = JSON.stringify(a); first.feedBytes.fill(0); first.catalogBytes.fill(0); assert.equal(JSON.stringify(a), saved);
});
test('input and binding accessors, unexpected fields and claimed digests are rejected without execution', () => {
  let calls = 0;
  for (const key of ['feedBytes', 'catalogBytes', 'expectedBinding']) {
    const raw = input(); Object.defineProperty(raw, key, {enumerable: true, get() {calls++; throw Error('private');}});
    rejected(raw, 'CATALOG_RECEIPT_INPUT_INVALID');
  }
  const raw = input(); Object.defineProperty(raw.expectedBinding, 'epoch', {enumerable: true, get() {calls++; return 1;}});
  rejected(raw, 'CATALOG_RECEIPT_INPUT_INVALID');
  rejected({...input(), documentDigests: {catalog: 'f'.repeat(64)}}, 'CATALOG_RECEIPT_INPUT_INVALID');
  rejected({...input(), toJSON() {calls++; return {}; }}, 'CATALOG_RECEIPT_INPUT_INVALID'); assert.equal(calls, 0);
});
test('ordinary Buffer own accessors and methods cannot alter the actual byte snapshot', () => {
  const raw = input(), expected = digest(raw.catalogBytes); let calls = 0;
  for (const key of ['length', 'buffer', 'byteOffset', 'byteLength']) Object.defineProperty(raw.catalogBytes, key, {get() {calls++; throw Error('private');}});
  raw.catalogBytes.copy = raw.catalogBytes.toJSON = () => {calls++; throw Error('private');};
  const result = gate.validate(raw); assert.equal(result.ok, true, result.code); assert.equal(result.receipt.documentDigests.catalog, expected); assert.equal(calls, 0);
});
test('non-Buffer inputs, byte limits and explicit binding domains fail with fixed diagnostics', () => {
  for (const raw of [{...input(), feedBytes: new Uint8Array([1])}, {...input(), catalogBytes: '{}'},
    {...input(), feedBytes: Buffer.alloc(LIMITS.feedBytes + 1)}, {...input(), catalogBytes: Buffer.alloc(LIMITS.catalogBytes + 1)},
    {...input(), expectedBinding: {feedId: FEED.toUpperCase(), epoch: 1}}, {...input(), expectedBinding: {feedId: FEED, epoch: 0}},
    {...input(), expectedBinding: {feedId: FEED, epoch: 1000000}}]) rejected(raw, 'CATALOG_RECEIPT_INPUT_INVALID');
});
test('foreign feed or epoch in either complete document never produces a receipt', () => {
  for (const document of ['feed', 'catalog']) for (const field of ['feedId', 'epoch']) {
    const docs = documents(); docs[document][field] = field === 'feedId' ? FOREIGN : 2;
    rejected(input(docs), 'CATALOG_RECEIPT_BINDING_MISMATCH');
  }
});
test('full schemas reject header-only documents and nested structural defects', () => {
  for (const mutate of [x => delete x.feed.createdAt, x => delete x.catalog.generatedAt,
    x => x.catalog.events = [{eventKey: 'EVENT-SYNTHETIC', selections: []}], x => x.catalog.extra = 'private-value',
    x => x.catalog.events[0].eligibility = {eligible: false, reasonCodes: []}, x => x.catalog.events[0].selections[0].templateButtonKey = 'not-event-null',
    x => x.catalog.events[0].selections[0].generationSequence = 10000000000]) {
    const docs = documents(); mutate(docs); rejected(input(docs), 'CATALOG_RECEIPT_SCHEMA_INVALID');
  }
});
test('all catalog entries must match tuple hash and available school-year/event/board/origin context', () => {
  for (const mutate of [x => x.selectionId = 'sel_' + 'f'.repeat(32), x => x.identityTuple[0] = '2027-2028',
    x => x.identityTuple[1] = 'OTHER-EVENT', x => x.identityTuple[2] = 'OTHER-BOARD', x => x.targetBoardKey = 'OTHER-BOARD']) {
    const docs = documents(), row = docs.catalog.events[0].selections[0]; mutate(row);
    // Keep a valid hash for context mutations, so hash agreement alone cannot admit them.
    if (row.selectionId !== 'sel_' + 'f'.repeat(32)) {row.selectionId = selectionId(row.identityTuple); row.manifestPath = 'selections/' + row.selectionId + '/generations/' + row.generation + '/manifest.json';}
    rejected(input(docs), 'CATALOG_RECEIPT_CONTEXT_INVALID');
  }
  const docs = documents(); docs.catalog.events[0].selections.push(clone(docs.catalog.events[0].selections[0]));
  accepted(input(docs));
  docs.catalog.events[0].selections[1].occurrenceCount = 1;
  rejected(input(docs), 'CATALOG_RECEIPT_CONTEXT_INVALID');
});
test('generation epoch, sequence, fingerprint prefix and exact path are checked before any future read', () => {
  for (const mutate of [x => x.generation = 'e2-g0000000001-' + 'b'.repeat(12), x => x.generationSequence = 2,
    x => x.metadataFingerprint = 'f'.repeat(64), x => x.manifestPath = x.manifestPath.replace('g0000000001', 'g0000000002')]) {
    const docs = documents(); mutate(docs.catalog.events[0].selections[0]); rejected(input(docs), 'CATALOG_RECEIPT_CONTEXT_INVALID');
  }
  const docs = documents(); docs.catalog.events[0].selections[0].manifestPath = '../private'; rejected(input(docs), 'CATALOG_RECEIPT_SCHEMA_INVALID');
});
test('season buttons retain their own board and template identity while event display labels stay opaque', () => {
  const docs = documents(); docs.catalog.events[0].selections.push(entry('EVENT-SYNTHETIC', 'SEASON-BUTTON', 'OTHER-BOARD', 'season'));
  accepted(input(docs)); const bad = clone(docs); bad.catalog.events[0].selections[1].templateButtonKey = 'OTHER-TEMPLATE';
  rejected(input(bad), 'CATALOG_RECEIPT_CONTEXT_INVALID');
  docs.catalog.events[0].selections[0].displayLabel = '  DIFFERENT Display  '; accepted(input(docs));
});
test('unresolved event boards, Unicode identities and permitted summary states remain metadata', () => {
  const docs = documents(); docs.catalog.events[0].eventBoard = {boardKey: null, displayName: null};
  docs.catalog.events[0].selections = [entry('EVENT-SYNTHETIC', '😀'.repeat(200), null)];
  for (const state of ['complete', 'incomplete', 'empty', 'removed']) {
    docs.catalog.events[0].selections[0].manifestState = state; docs.catalog.events[0].selections[0].occurrenceCount = state === 'removed' ? 4 : 0;
    accepted(input(docs));
  }
  // This raw catalog subset does not invent state/count/calendar/eligibility relationships.
  docs.catalog.events[0].eventDate = '2026-02-30'; accepted(input(docs));
});
test('strict raw parsing rejects BOM, duplicates, invalid UTF8, surrogates and unsafe numeric values without leakage', () => {
  const raw = input();
  for (const catalogBytes of [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), raw.catalogBytes]), Buffer.from([0xff]),
    Buffer.from('{"private":1,"private":2}'), Buffer.from('{"private":"\\ud800"}'), Buffer.from('{"private":9007199254740992}'),
    Buffer.from('{"private":-1}'), Buffer.from('{"private":0.5}')]) {
    const result = gate.validate({...raw, catalogBytes}); assert.equal(result.ok, false); assert.equal(result.code, 'CATALOG_RECEIPT_INPUT_INVALID');
    assert.doesNotMatch(JSON.stringify(result), /private|stack|raw|path/);
  }
});
test('parser depth and node ceilings remain unchanged within otherwise bounded raw input', () => {
  const raw = input();
  rejected({...raw, catalogBytes: Buffer.from('['.repeat(34) + '0' + ']'.repeat(34))}, 'CATALOG_RECEIPT_INPUT_INVALID');
  const nodes = Buffer.from('[' + '0,'.repeat(300000) + '0]'); assert.ok(nodes.length < LIMITS.catalogBytes);
  rejected({...raw, catalogBytes: nodes}, 'CATALOG_RECEIPT_INPUT_INVALID');
});
test('real catalog data over1MiB is accepted under its5MiB budget without widening source canonicalization', () => {
  const docs = documents(); docs.catalog.events = [];
  for (let e = 0; e < 100; e++) {
    const key = 'EVENT-' + e, rows = [];
    for (let s = 0; s < 20; s++) rows.push(entry(key, 'x'.repeat(190) + String(s).padStart(3, '0')));
    docs.catalog.events.push(event(key, rows));
  }
  const raw = input(docs); assert.ok(raw.catalogBytes.length > 1048576); assert.ok(raw.catalogBytes.length < LIMITS.catalogBytes);
  assert.throws(() => canonicalExchangeJSON(docs.catalog), {message: 'FINGERPRINT_INPUT_INVALID'});
  const receipt = accepted(raw); assert.equal(receipt.catalog.events.length, 100); assert.equal(receipt.catalog.events[99].selections.length, 20);
});
test('inclusive raw document limits admit valid padded bytes at exactly their separate bounds', () => {
  const raw = input();
  for (const [key, length] of [['feedBytes', LIMITS.feedBytes], ['catalogBytes', LIMITS.catalogBytes]]) {
    const bytes = Buffer.alloc(length, 0x20); raw[key].copy(bytes); raw[key] = bytes;
  }
  const receipt = accepted(raw); assert.equal(receipt.catalogSequence, 1);
});
test('actual missing-manifest capture does not prevent a catalog fact, whose reopened floor rejects a same-sequence fork', async t => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
  const {createExchangeMetadataReader} = require('../scripts/lib/exchange-metadata-reader.cjs');
  const {createExchangeJournal} = require('../scripts/lib/exchange-journal.cjs');
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'PiRaiders catalog receipt '));
  const source = path.join(parent, 'To Engine'), directory = path.join(parent, 'private-journal');
  let reader;
  t.after(async () => {reader?.close(); await fs.rm(parent, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});});
  await fs.mkdir(source); const raw = input();
  await fs.writeFile(path.join(source, 'feed.json'), raw.feedBytes); await fs.writeFile(path.join(source, 'catalog.json'), raw.catalogBytes);
  reader = createExchangeMetadataReader({root: source, binding: {...raw.expectedBinding, identityTuple: documents().catalog.events[0].selections[0].identityTuple}});
  const failedCapture = await reader.capture(); assert.equal(failedCapture.code, 'INPUT_UNAVAILABLE'); assert.equal(reader.lastPin(), null);
  const receipt = accepted({...raw, feedBytes: await fs.readFile(path.join(source, 'feed.json')), catalogBytes: await fs.readFile(path.join(source, 'catalog.json'))});
  const journal = createExchangeJournal(), storeId = '11111111-1111-4111-8111-111111111111';
  let head = await journal.initialize(directory, storeId); assert.equal(head.ok, true, head.code);
  async function append(event) {
    return journal.append(directory, {expectedStoreId: storeId, expectedRevision: head.revision, expectedHeadSha256: head.headSha256, event});
  }
  head = await append({type: 'confirm-binding', expectedRevision: 0, confirm: true, expectedBinding: null, binding: raw.expectedBinding});
  assert.equal(head.ok, true, head.code);
  head = await append({type: 'catalog', expectedRevision: head.revision, feedId: receipt.feedId, epoch: receipt.epoch,
    catalogSequence: receipt.catalogSequence, digest: receipt.documentDigests.catalog});
  assert.equal(head.ok, true, head.code); assert.equal(head.revision, 2); assert.deepEqual(head.state.feeds[0].selections, []);
  head = await journal.open(directory, storeId); assert.equal(head.ok, true, head.code);
  const previous = head.headSha256, docs = documents(); docs.catalog.generatedAt = '2026-11-17T00:00:00Z';
  const fork = accepted(input(docs)); assert.equal(fork.catalogSequence, receipt.catalogSequence); assert.notEqual(fork.documentDigests.catalog, receipt.documentDigests.catalog);
  const conflict = await append({type: 'catalog', expectedRevision: head.revision, feedId: fork.feedId, epoch: fork.epoch,
    catalogSequence: fork.catalogSequence, digest: fork.documentDigests.catalog});
  assert.equal(conflict.code, 'JOURNAL_EVENT_REJECTED'); assert.equal(conflict.ready, false);
  const retained = await journal.open(directory, storeId); assert.equal(retained.headSha256, previous); assert.equal(retained.revision, 2);
  assert.equal(retained.state.feeds[0].catalog.digest, receipt.documentDigests.catalog); assert.equal(reader.lastPin(), null);
});
