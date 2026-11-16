'use strict';
// Pure proposals only. No I/O, durable commit, authentication or source validation.
const {selectionId} = require('./exchange-fingerprints.cjs');
const LIMITS = Object.freeze({feeds: 8, selectionsPerFeed: 2048, selectionsTotal: 4096,
  stateBytes: 8 * 1048576, eventBytes: 65536});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const ID = /^sel_[0-9a-f]{32}$/;
const MAX_SEQUENCE = 9999999999, MAX_EPOCH = 999999;
const CODES = new Set(['LEDGER_STATE_INVALID', 'LEDGER_EVENT_INVALID', 'LEDGER_REVISION_CONFLICT',
  'LEDGER_BINDING_CONFLICT', 'LEDGER_CONFIRMATION_REQUIRED', 'LEDGER_REBIND_REQUIRED',
  'LEDGER_EPOCH_STALE', 'LEDGER_STALE', 'LEDGER_SEQUENCE_REUSED', 'LEDGER_CONTENT_CONFLICT',
  'LEDGER_CAPACITY_EXCEEDED', 'LEDGER_REVISION_EXHAUSTED']);
function fail(code) { throw Error(code); }
function freeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function record(value, keys, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(descriptors);
  if (own.length !== keys.length || keys.some(key => !Object.hasOwn(descriptors, key)) ||
      own.some(key => typeof key !== 'string' || !keys.includes(key) ||
        !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail(code);
}
function array(value, maximum, code) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum ||
      Reflect.ownKeys(value).length !== value.length + 1) fail(code);
  for (let index = 0; index < value.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(value, String(index));
    if (!entry || !entry.enumerable || !Object.hasOwn(entry, 'value')) fail(code);
  }
}
function integer(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(code);
}
function binding(value, code) {
  record(value, ['feedId', 'epoch'], code);
  if (typeof value.feedId !== 'string' || value.feedId.length !== 36 || !UUID.test(value.feedId)) fail(code);
  integer(value.epoch, 1, MAX_EPOCH, code);
}
function sameBinding(left, right) {
  return left === null || right === null ? left === right : left.feedId === right.feedId && left.epoch === right.epoch;
}
function tuple(value, id, code) {
  array(value, 5, code);
  if (value.length !== 5 || value.some(item => typeof item !== 'string') ||
      !/^\d{4}-\d{4}$/.test(value[0]) || !value[1] || !['event', 'season'].includes(value[3]) || !value[4] ||
      value[3] === 'season' && !value[2] ||
      value.some((item, index) => item.length > 2 * [9, 64, 64, 6, 200][index] || Array.from(item).length > [9, 64, 64, 6, 200][index]) ||
      typeof id !== 'string' || id.length !== 36 || !ID.test(id)) fail(code);
  try { if (selectionId(value) !== id) fail(code); }
  catch { fail(code); }
}
function fact(value, code) {
  integer(value.epoch, 1, MAX_EPOCH, code);
  integer(value.sequence, 1, MAX_SEQUENCE, code);
  if (typeof value.digest !== 'string' || value.digest.length !== 64 || !SHA.test(value.digest)) fail(code);
}
function boundedJSON(value, maximum, code) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > maximum) fail(code);
  return JSON.parse(json);
}
function checkedState(raw) {
  const code = 'LEDGER_STATE_INVALID';
  record(raw, ['schemaVersion', 'revision', 'binding', 'feeds'], code);
  if (raw.schemaVersion !== 1) fail(code);
  integer(raw.revision, 0, Number.MAX_SAFE_INTEGER, code);
  array(raw.feeds, LIMITS.feeds, code);
  if (raw.binding !== null) binding(raw.binding, code);
  if (raw.binding === null && (raw.feeds.length !== 0 || raw.revision !== 0) ||
      raw.revision === 0 && (raw.binding !== null || raw.feeds.length !== 0)) fail(code);
  let priorFeed = '', total = 0;
  for (const feed of raw.feeds) {
    record(feed, ['feedId', 'approvedEpoch', 'catalog', 'selections'], code);
    binding({feedId: feed.feedId, epoch: feed.approvedEpoch}, code);
    if (feed.feedId <= priorFeed) fail(code); priorFeed = feed.feedId;
    array(feed.selections, LIMITS.selectionsPerFeed, code);
    total += feed.selections.length; if (total > LIMITS.selectionsTotal) fail(code);
    if (feed.catalog !== null) {
      record(feed.catalog, ['epoch', 'sequence', 'digest'], code); fact(feed.catalog, code);
      if (feed.catalog.epoch > feed.approvedEpoch) fail(code);
    }
    let priorSelection = '';
    for (const selection of feed.selections) {
      record(selection, ['selectionId', 'identityTuple', 'epoch', 'sequence', 'digest'], code);
      tuple(selection.identityTuple, selection.selectionId, code); fact(selection, code);
      if (selection.selectionId <= priorSelection || selection.epoch > feed.approvedEpoch) fail(code);
      priorSelection = selection.selectionId;
    }
  }
  if (raw.binding !== null && !raw.feeds.some(feed => feed.feedId === raw.binding.feedId && feed.approvedEpoch === raw.binding.epoch)) fail(code);
  return boundedJSON(raw, LIMITS.stateBytes, code);
}
function checkedEvent(raw) {
  const code = 'LEDGER_EVENT_INVALID';
  // Check all properties before reading the discriminator: accessors never run.
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !descriptors[key].enumerable ||
      !Object.hasOwn(descriptors[key], 'value')) || !Object.hasOwn(descriptors, 'type')) fail(code);
  const type = descriptors.type.value;
  const keys = type === 'confirm-binding' ? ['type', 'expectedRevision', 'confirm', 'expectedBinding', 'binding'] :
    type === 'catalog' ? ['type', 'expectedRevision', 'feedId', 'epoch', 'catalogSequence', 'digest'] :
      type === 'manifest' ? ['type', 'expectedRevision', 'feedId', 'epoch', 'selectionId', 'identityTuple', 'generationSequence', 'digest'] : null;
  if (!keys) fail(code); record(raw, keys, code);
  integer(raw.expectedRevision, 0, Number.MAX_SAFE_INTEGER, code);
  if (type === 'confirm-binding') {
    if (raw.confirm !== true) fail('LEDGER_CONFIRMATION_REQUIRED');
    if (raw.expectedBinding !== null) binding(raw.expectedBinding, code);
    binding(raw.binding, code);
  } else {
    binding({feedId: raw.feedId, epoch: raw.epoch}, code);
    fact({epoch: raw.epoch, sequence: type === 'catalog' ? raw.catalogSequence : raw.generationSequence, digest: raw.digest}, code);
    if (type === 'manifest') tuple(raw.identityTuple, raw.selectionId, code);
  }
  return boundedJSON(raw, LIMITS.eventBytes, code);
}
function checkCapacity(state) {
  if (state.feeds.length > LIMITS.feeds || state.feeds.some(feed => feed.selections.length > LIMITS.selectionsPerFeed) ||
      state.feeds.reduce((total, feed) => total + feed.selections.length, 0) > LIMITS.selectionsTotal ||
      Buffer.byteLength(JSON.stringify(state), 'utf8') > LIMITS.stateBytes) fail('LEDGER_CAPACITY_EXCEEDED');
}
function compareFact(previous, incoming) {
  if (!previous) return true;
  if (incoming.sequence < previous.sequence) fail('LEDGER_STALE');
  if (incoming.sequence === previous.sequence) {
    if (incoming.epoch !== previous.epoch) fail('LEDGER_SEQUENCE_REUSED');
    if (incoming.digest !== previous.digest) fail('LEDGER_CONTENT_CONFLICT');
    return false;
  }
  return true;
}
function initialExchangeLedgerState() {
  return freeze({schemaVersion: 1, revision: 0, binding: null, feeds: []});
}
function proposeExchangeLedgerEvent(rawState, rawEvent) {
  try {
    const state = checkedState(rawState), event = checkedEvent(rawEvent), parentRevision = state.revision;
    if (event.expectedRevision !== parentRevision) fail('LEDGER_REVISION_CONFLICT');
    let changed = false;
    if (event.type === 'confirm-binding') {
      if (!sameBinding(event.expectedBinding, state.binding)) fail('LEDGER_BINDING_CONFLICT');
      const known = state.feeds.find(feed => feed.feedId === event.binding.feedId);
      if (known && event.binding.epoch < known.approvedEpoch) fail('LEDGER_EPOCH_STALE');
      if (!sameBinding(event.binding, state.binding)) {
        if (known) known.approvedEpoch = event.binding.epoch;
        else state.feeds.push({feedId: event.binding.feedId, approvedEpoch: event.binding.epoch, catalog: null, selections: []});
        state.feeds.sort((left, right) => left.feedId < right.feedId ? -1 : left.feedId > right.feedId ? 1 : 0);
        state.binding = event.binding; changed = true;
      }
    } else {
      if (!sameBinding(state.binding, {feedId: event.feedId, epoch: event.epoch})) fail('LEDGER_REBIND_REQUIRED');
      const feed = state.feeds.find(value => value.feedId === event.feedId);
      const incoming = {epoch: event.epoch, sequence: event.type === 'catalog' ? event.catalogSequence : event.generationSequence, digest: event.digest};
      if (event.type === 'catalog') {
        if (compareFact(feed.catalog, incoming)) { feed.catalog = incoming; changed = true; }
      } else {
        const previous = feed.selections.find(value => value.selectionId === event.selectionId);
        if (previous && previous.identityTuple.some((item, index) => item !== event.identityTuple[index])) fail('LEDGER_CONTENT_CONFLICT');
        if (compareFact(previous, incoming)) {
          const next = {selectionId: event.selectionId, identityTuple: event.identityTuple, ...incoming};
          if (previous) feed.selections[feed.selections.indexOf(previous)] = next; else feed.selections.push(next);
          feed.selections.sort((left, right) => left.selectionId < right.selectionId ? -1 : left.selectionId > right.selectionId ? 1 : 0); changed = true;
        }
      }
    }
    if (changed) {
      if (parentRevision === Number.MAX_SAFE_INTEGER) fail('LEDGER_REVISION_EXHAUSTED');
      state.revision++; checkCapacity(state);
    }
    return freeze({ok: true, code: changed ? 'LEDGER_CHANGE_PROPOSED' : 'LEDGER_NO_CHANGE', scope: 'ledger-transition',
      ready: false, committed: false, changed, expectedRevision: parentRevision, nextRevision: state.revision, event, state});
  } catch (error) {
    return Object.freeze({ok: false, code: CODES.has(error?.message) ? error.message : 'LEDGER_EVENT_INVALID',
      scope: 'ledger-transition', ready: false, committed: false});
  }
}
module.exports = {initialExchangeLedgerState, proposeExchangeLedgerEvent, EXCHANGE_LEDGER_LIMITS: LIMITS};
