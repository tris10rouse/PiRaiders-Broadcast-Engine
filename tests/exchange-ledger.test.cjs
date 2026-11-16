'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {selectionId, canonicalExchangeJSON} = require('../scripts/lib/exchange-fingerprints.cjs');
const {initialExchangeLedgerState, proposeExchangeLedgerEvent, EXCHANGE_LEDGER_LIMITS: LIMITS} = require('../scripts/lib/exchange-ledger.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const feedId = number => '00000000-0000-4000-8000-' + number.toString(16).padStart(12, '0');
const binding = (number = 1, epoch = 1) => ({feedId: feedId(number), epoch});
function confirmation(state, target = binding()) {
  return {type: 'confirm-binding', expectedRevision: state.revision, confirm: true, expectedBinding: state.binding, binding: target};
}
function catalog(state, sequence = 1, sha = 'a'.repeat(64)) {
  return {type: 'catalog', expectedRevision: state.revision, ...state.binding, catalogSequence: sequence, digest: sha};
}
function manifest(state, key = 'EV-SYNTHETIC', sequence = 1, sha = 'b'.repeat(64)) {
  const identityTuple = ['2026-2027', key, 'BOARD-SYNTHETIC', 'event', 'synthetic'];
  return {type: 'manifest', expectedRevision: state.revision, ...state.binding,
    selectionId: selectionId(identityTuple), identityTuple, generationSequence: sequence, digest: sha};
}
function proposed(state, event, changed = true) {
  const before = clone(state), beforeEvent = clone(event), plan = proposeExchangeLedgerEvent(state, event);
  assert.equal(plan.ok, true, plan.code); assert.equal(plan.changed, changed); assert.equal(plan.ready, false); assert.equal(plan.committed, false);
  assert.equal(plan.expectedRevision, state.revision); assert.equal(plan.nextRevision, state.revision + (changed ? 1 : 0));
  assert.equal(plan.state.revision, plan.nextRevision); assert.deepEqual(state, before); assert.deepEqual(event, beforeEvent);
  assert.equal(Object.isFrozen(plan), true); assert.equal(Object.isFrozen(plan.event), true); assert.equal(Object.isFrozen(plan.state), true);
  return plan.state;
}
function bound(target = binding()) {
  const state = initialExchangeLedgerState(); return proposed(state, confirmation(state, target));
}
function rejected(state, event, code) {
  const before = clone(state), plan = proposeExchangeLedgerEvent(state, event);
  assert.deepEqual(plan, {ok: false, code, scope: 'ledger-transition', ready: false, committed: false});
  assert.deepEqual(state, before); assert.equal(Object.isFrozen(plan), true);
}

test('initial state and proposals are deterministic, immutable and explicitly uncommitted', () => {
  const first = initialExchangeLedgerState(), second = initialExchangeLedgerState();
  assert.deepEqual(first, {schemaVersion: 1, revision: 0, binding: null, feeds: []}); assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true); assert.equal(Object.isFrozen(first.feeds), true);
  const event = confirmation(first), left = proposeExchangeLedgerEvent(first, event), right = proposeExchangeLedgerEvent(second, clone(event));
  assert.equal(JSON.stringify(left), JSON.stringify(right)); assert.equal(left.committed, false); assert.equal(left.ready, false);
  assert.equal(Object.isFrozen(left.state.binding), true); assert.equal(Object.isFrozen(left.state.feeds[0].selections), true);
});

test('facts never bind automatically and confirmation requires literal intent plus old binding and revision', () => {
  const initial = initialExchangeLedgerState(), fact = {type: 'catalog', expectedRevision: 0, ...binding(), catalogSequence: 1, digest: 'a'.repeat(64)};
  rejected(initial, fact, 'LEDGER_REBIND_REQUIRED');
  for (const confirm of [false, 1, 'true', null]) rejected(initial, {...confirmation(initial), confirm}, 'LEDGER_CONFIRMATION_REQUIRED');
  const state = bound(); rejected(state, confirmation(initial, binding(2)), 'LEDGER_REVISION_CONFLICT');
  rejected(state, {...confirmation(state, binding(2)), expectedBinding: null}, 'LEDGER_BINDING_CONFLICT');
  proposed(state, confirmation(state), false);
});

test('catalog fact is independent of selected manifest or asset arrival and never advances a selection', () => {
  let state = bound(); state = proposed(state, catalog(state, 2));
  assert.equal(state.feeds[0].catalog.sequence, 2); assert.deepEqual(state.feeds[0].selections, []);
  const invalidManifest = manifest(state); invalidManifest.selectionId = 'sel_' + 'f'.repeat(32);
  rejected(state, invalidManifest, 'LEDGER_EVENT_INVALID');
  rejected(state, catalog(state, 2, 'c'.repeat(64)), 'LEDGER_CONTENT_CONFLICT');
  state = proposed(state, manifest(state)); assert.equal(state.feeds[0].catalog.sequence, 2); assert.equal(state.feeds[0].selections.length, 1);
  // This is a trusted validated-fact API, not evidence that any input bytes,
  // metadata reader, selected manifest, asset or publisher was actually verified.
});

test('ordinary event/button changes retain per-selection floors without feed rebinding', () => {
  let state = bound(); const original = clone(state.binding);
  state = proposed(state, manifest(state, 'EVENT-A', 5)); state = proposed(state, manifest(state, 'EVENT-B', 1));
  const third = manifest(state, 'EVENT-A'); third.identityTuple[4] = 'another button'; third.selectionId = selectionId(third.identityTuple);
  state = proposed(state, third); assert.equal(state.feeds.length, 1); assert.equal(state.feeds[0].selections.length, 3);
  assert.deepEqual(state.binding, original); rejected(state, manifest(state, 'EVENT-A', 4), 'LEDGER_STALE');
});

test('catalog and manifest repeat identically, conflict on exact bytes, and reject lower counters', () => {
  let state = bound(); state = proposed(state, catalog(state, 3)); state = proposed(state, manifest(state, 'EVENT-A', 4));
  proposed(state, catalog(state, 3), false); proposed(state, manifest(state, 'EVENT-A', 4), false);
  rejected(state, catalog(state, 3, 'b'.repeat(64)), 'LEDGER_CONTENT_CONFLICT');
  rejected(state, manifest(state, 'EVENT-A', 4, 'c'.repeat(64)), 'LEDGER_CONTENT_CONFLICT');
  rejected(state, catalog(state, 2), 'LEDGER_STALE'); rejected(state, manifest(state, 'EVENT-A', 3), 'LEDGER_STALE');
  state = proposed(state, catalog(state, 4, 'c'.repeat(64))); state = proposed(state, manifest(state, 'EVENT-A', 5, 'd'.repeat(64)));
  assert.equal(state.feeds[0].catalog.sequence, 4); assert.equal(state.feeds[0].selections[0].sequence, 5);
});

test('catalog whitespace changes conflict on raw-byte digest; current document bytes have no invented fact type', () => {
  let state = bound(); state = proposed(state, catalog(state, 1, digest('{"synthetic":true}')));
  rejected(state, catalog(state, 1, digest('{"synthetic":true}\n')), 'LEDGER_CONTENT_CONFLICT');
  rejected(state, {...catalog(state), type: 'current'}, 'LEDGER_EVENT_INVALID');
});

test('approved epoch increase keeps known floors and forbids any same-sequence reuse across epochs', () => {
  let state = bound(); state = proposed(state, catalog(state, 5)); state = proposed(state, manifest(state, 'EVENT-A', 7));
  state = proposed(state, confirmation(state, binding(1, 2)));
  assert.equal(state.feeds[0].catalog.epoch, 1); assert.equal(state.feeds[0].selections[0].sequence, 7);
  rejected(state, catalog(state, 5), 'LEDGER_SEQUENCE_REUSED'); rejected(state, manifest(state, 'EVENT-A', 7), 'LEDGER_SEQUENCE_REUSED');
  rejected(state, catalog(state, 4), 'LEDGER_STALE'); rejected(state, manifest(state, 'EVENT-A', 6), 'LEDGER_STALE');
  state = proposed(state, catalog(state, 6)); state = proposed(state, manifest(state, 'EVENT-A', 8));
  state = proposed(state, manifest(state, 'NEW-EVENT', 1));
  assert.equal(state.feeds[0].catalog.epoch, 2); assert.equal(state.feeds[0].selections.length, 2);
  rejected(state, confirmation(state, binding(1, 1)), 'LEDGER_EPOCH_STALE');
  rejected(state, {...catalog(state, 9), epoch: 1}, 'LEDGER_REBIND_REQUIRED');
});

test('explicit feed switches use independent namespaces and switching back preserves all facts', () => {
  let state = bound(); state = proposed(state, catalog(state, 100)); state = proposed(state, manifest(state, 'EVENT-A', 100));
  state = proposed(state, confirmation(state, binding(2))); state = proposed(state, catalog(state)); state = proposed(state, manifest(state, 'EVENT-A'));
  assert.equal(state.feeds.length, 2); assert.equal(state.feeds[0].selections[0].sequence, 100); assert.equal(state.feeds[1].selections[0].sequence, 1);
  state = proposed(state, confirmation(state, binding(1))); rejected(state, catalog(state, 99), 'LEDGER_STALE');
  rejected(state, {...manifest(state), feedId: feedId(2)}, 'LEDGER_REBIND_REQUIRED');
});

test('old proposals cannot apply after another event; pure siblings themselves do not claim atomic exclusion', () => {
  const parent = bound(), firstEvent = catalog(parent), secondEvent = manifest(parent);
  const first = proposeExchangeLedgerEvent(parent, firstEvent), second = proposeExchangeLedgerEvent(parent, secondEvent);
  assert.equal(first.ok, true); assert.equal(second.ok, true); assert.equal(first.nextRevision, second.nextRevision);
  assert.equal(first.committed, false); assert.equal(second.committed, false);
  rejected(first.state, second.event, 'LEDGER_REVISION_CONFLICT');
});

test('JSON rehydration/replay retains deterministic floors without claiming filesystem durability', () => {
  let state = bound(); state = proposed(state, catalog(state, 2)); state = proposed(state, manifest(state, 'EVENT-A', 3));
  const hydrated = clone(state); rejected(hydrated, catalog(hydrated, 2, 'f'.repeat(64)), 'LEDGER_CONTENT_CONFLICT');
  rejected(hydrated, manifest(hydrated, 'EVENT-A', 2), 'LEDGER_STALE');
  const event = catalog(state, 3, 'c'.repeat(64));
  assert.deepEqual(proposeExchangeLedgerEvent(state, event), proposeExchangeLedgerEvent(hydrated, clone(event)));
});

test('strict state/fact shapes, safe counter domains and exact tuple hash reject malformed data', () => {
  const state = bound(), base = manifest(state);
  for (const mutate of [x => x.digest = 'A'.repeat(64), x => x.feedId = feedId(10).toUpperCase(),
    x => x.epoch = 0, x => x.epoch = 1000000, x => x.generationSequence = 0,
    x => x.generationSequence = 10000000000, x => x.generationSequence = 1.5,
    x => x.expectedRevision = Number.MAX_SAFE_INTEGER + 1, x => x.selectionId = 'sel_' + 'f'.repeat(32),
    x => x.identityTuple[0] = '2026', x => x.identityTuple[1] = '', x => x.identityTuple[4] = '\ud800',
    x => x.identityTuple[4] = 'x'.repeat(401), x => x.unexpected = true]) {
    const event = clone(base); mutate(event); rejected(state, event, 'LEDGER_EVENT_INVALID');
  }
  for (const mutate of [x => x.schemaVersion = 2, x => x.revision = -1, x => x.binding.epoch = 2,
    x => x.feeds[0].approvedEpoch = 0, x => x.feeds.push(clone(x.feeds[0])), x => x.unexpected = true]) {
    const invalid = clone(state); mutate(invalid); rejected(invalid, catalog(state), 'LEDGER_STATE_INVALID');
  }
});

test('Unicode code-point tuple bounds preserve opaque identity without normalization', () => {
  let state = bound(); const event = manifest(state); event.identityTuple[4] = '😀'.repeat(200); event.selectionId = selectionId(event.identityTuple);
  state = proposed(state, event); assert.equal(state.feeds[0].selections[0].identityTuple[4], '😀'.repeat(200));
  const tooLong = manifest(state); tooLong.identityTuple[4] = '😀'.repeat(201); tooLong.selectionId = selectionId(tooLong.identityTuple);
  rejected(state, tooLong, 'LEDGER_EVENT_INVALID');
  const decomposed = manifest(state); decomposed.identityTuple[4] = 'e\u0301'; decomposed.selectionId = selectionId(decomposed.identityTuple);
  state = proposed(state, decomposed); const composed = manifest(state); composed.identityTuple[4] = 'é'; composed.selectionId = selectionId(composed.identityTuple);
  state = proposed(state, composed); assert.equal(state.feeds[0].selections.length, 3);
});

test('no input getter/toJSON runs and diagnostics do not echo source values or stacks', () => {
  const state = bound(); let called = false;
  const event = Object.defineProperty({}, 'type', {enumerable: true, get() {called = true; return 'catalog';}});
  const failure = proposeExchangeLedgerEvent(state, event); assert.equal(failure.code, 'LEDGER_EVENT_INVALID'); assert.equal(called, false);
  const invalidState = Object.defineProperty({}, 'schemaVersion', {enumerable: true, get() {called = true; return 1;}});
  assert.equal(proposeExchangeLedgerEvent(invalidState, catalog(state)).code, 'LEDGER_STATE_INVALID'); assert.equal(called, false);
  const hidden = {...catalog(state), toJSON() {called = true; return {};}};
  assert.equal(proposeExchangeLedgerEvent(state, hidden).code, 'LEDGER_EVENT_INVALID'); assert.equal(called, false);
  const privateEvent = {...catalog(state), digest: 'private-source-path'};
  assert.doesNotMatch(JSON.stringify(proposeExchangeLedgerEvent(state, privateEvent)), /private-source-path|digest|stack/);
});

test('revision exhaustion rejects a change while exact idempotent facts remain legal', () => {
  let state = bound(); state = proposed(state, catalog(state)); state = clone(state); state.revision = Number.MAX_SAFE_INTEGER;
  proposed(state, catalog(state), false); rejected(state, catalog(state, 2), 'LEDGER_REVISION_EXHAUSTED');
});

test('feed namespace capacity fails without evicting old binding or facts', () => {
  let state = initialExchangeLedgerState();
  for (let n = 1; n <= LIMITS.feeds; n++) state = proposed(state, confirmation(state, binding(n)));
  const before = clone(state); rejected(state, confirmation(state, binding(LIMITS.feeds + 1)), 'LEDGER_CAPACITY_EXCEEDED'); assert.deepEqual(state, before);
  state = proposed(state, confirmation(state, binding(1))); assert.equal(state.feeds.length, LIMITS.feeds);
});

function largeState(perFeed = LIMITS.selectionsPerFeed, feedCount = 1) {
  const rows = [];
  for (let n = 0; n < perFeed; n++) {
    const identityTuple = ['2026-2027', 'EVENT-' + n, 'BOARD-SYNTHETIC', 'event', 'x'.repeat(200)];
    rows.push({selectionId: selectionId(identityTuple), identityTuple, epoch: 1, sequence: 1, digest: 'a'.repeat(64)});
  }
  rows.sort((left, right) => left.selectionId < right.selectionId ? -1 : left.selectionId > right.selectionId ? 1 : 0);
  return {schemaVersion: 1, revision: perFeed * feedCount + feedCount, binding: binding(feedCount),
    feeds: Array.from({length: feedCount}, (_, index) => ({feedId: feedId(index + 1), approvedEpoch: 1, catalog: null, selections: clone(rows)}))};
}

test('selection capacities preserve all floors; bounded ledger snapshots may exceed the source JSON budget', () => {
  const fullFeed = largeState(); rejected(fullFeed, manifest(fullFeed, 'NEW-EVENT'), 'LEDGER_CAPACITY_EXCEEDED');
  const existing = fullFeed.feeds[0].selections[0], update = {type: 'manifest', expectedRevision: fullFeed.revision, ...fullFeed.binding,
    selectionId: existing.selectionId, identityTuple: existing.identityTuple, generationSequence: 2, digest: 'b'.repeat(64)};
  const updated = proposed(fullFeed, update); assert.equal(updated.feeds[0].selections.length, LIMITS.selectionsPerFeed);
  let total = largeState(LIMITS.selectionsPerFeed, 2);
  assert.equal(total.feeds.reduce((sum, feed) => sum + feed.selections.length, 0), LIMITS.selectionsTotal);
  assert.ok(Buffer.byteLength(JSON.stringify(total)) > 1048576); assert.ok(Buffer.byteLength(JSON.stringify(total)) < LIMITS.stateBytes);
  assert.throws(() => canonicalExchangeJSON(total), {message: 'FINGERPRINT_INPUT_INVALID'}, 'source JSON limit remains unchanged');
  total = proposed(total, confirmation(total, binding(3))); rejected(total, manifest(total, 'NEW-EVENT'), 'LEDGER_CAPACITY_EXCEEDED');
});

test('no absence, cache, tombstone or activation event can reset stored sequence facts', () => {
  let state = bound(); state = proposed(state, manifest(state, 'EVENT-A', 10));
  for (const type of ['absent', 'empty', 'removed', 'activate', 'delete', 'reset', 'cache-ready']) {
    rejected(state, {type, expectedRevision: state.revision}, 'LEDGER_EVENT_INVALID');
  }
  assert.equal(state.feeds[0].selections[0].sequence, 10);
  assert.deepEqual(Object.keys(state).sort(), ['binding', 'feeds', 'revision', 'schemaVersion']);
});

test('unresolved event board is an opaque legal tuple while season selection requires its board', () => {
  let state = bound(); const event = manifest(state); event.identityTuple[2] = '';
  event.selectionId = selectionId(event.identityTuple); state = proposed(state, event);
  const season = manifest(state); season.identityTuple[2] = ''; season.identityTuple[3] = 'season';
  season.selectionId = selectionId(season.identityTuple); rejected(state, season, 'LEDGER_EVENT_INVALID');
});

test('returning to an epoch-increased feed retains catalog and every selection floor', () => {
  let state = bound(); state = proposed(state, catalog(state, 9)); state = proposed(state, manifest(state, 'EVENT-A', 12));
  state = proposed(state, confirmation(state, binding(1, 2)));
  state = proposed(state, manifest(state, 'EVENT-B', 1));
  state = proposed(state, confirmation(state, binding(2)));
  state = proposed(state, confirmation(state, binding(1, 2)));
  rejected(state, catalog(state, 9), 'LEDGER_SEQUENCE_REUSED');
  rejected(state, manifest(state, 'EVENT-A', 11), 'LEDGER_STALE');
  proposed(state, manifest(state, 'EVENT-B', 1), false);
  rejected(state, confirmation(state, binding(1, 1)), 'LEDGER_EPOCH_STALE');
});

test('nested accessors, sparse arrays and unexpected hidden properties fail without invoking getters', () => {
  const state = bound(); let calls = 0;
  const event = manifest(state);
  Object.defineProperty(event.identityTuple, '1', {enumerable: true, get() {calls++; return 'secret';}});
  assert.equal(proposeExchangeLedgerEvent(state, event).code, 'LEDGER_EVENT_INVALID');
  const sparse = manifest(state); delete sparse.identityTuple[1];
  assert.equal(proposeExchangeLedgerEvent(state, sparse).code, 'LEDGER_EVENT_INVALID');
  const nested = clone(state);
  Object.defineProperty(nested.feeds[0], 'catalog', {enumerable: true, get() {calls++; return null;}});
  assert.equal(proposeExchangeLedgerEvent(nested, catalog(state)).code, 'LEDGER_STATE_INVALID');
  const hidden = catalog(state); Object.defineProperty(hidden, 'secret', {value: true});
  assert.equal(proposeExchangeLedgerEvent(state, hidden).code, 'LEDGER_EVENT_INVALID');
  const symbol = catalog(state); symbol[Symbol('private')] = true;
  assert.equal(proposeExchangeLedgerEvent(state, symbol).code, 'LEDGER_EVENT_INVALID');
  assert.equal(calls, 0);
});
