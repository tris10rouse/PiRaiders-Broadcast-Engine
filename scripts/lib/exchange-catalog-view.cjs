'use strict';
// Metadata-only projection for the PC selector. No persistence or admission.
const {createHash} = require('node:crypto');
const {isExchangeCatalogReceipt} = require('./exchange-catalog-receipt.cjs');
const {canonicalExchangeJSON} = require('./exchange-fingerprints.cjs');
const PAGE_LIMIT = 64;
function fail(code) { throw Object.assign(Error(code), {code}); }
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function fields(raw, allowed, required) {
  if (!raw || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) fail('CATALOG_QUERY_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(raw), keys = Reflect.ownKeys(descriptors);
  if (required.some(key => !Object.hasOwn(descriptors, key)) || keys.some(key => typeof key !== 'string' ||
      !allowed.includes(key) || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail('CATALOG_QUERY_INVALID');
}
function createExchangeCatalogView(receipt) {
  if (!isExchangeCatalogReceipt(receipt)) fail('CATALOG_VIEW_RECEIPT_INVALID');
  const catalog = receipt.catalog;
  const revision = createHash('sha256').update(JSON.stringify([receipt.feedId, receipt.epoch,
    receipt.catalogSequence, receipt.documentDigests.feed, receipt.documentDigests.catalog])).digest('hex');
  const events = [], byKey = new Map();
  for (const event of catalog.events) {
    const {selections, ...metadata} = event;
    const key = canonicalExchangeJSON(metadata);
    let item = byKey.get(event.eventKey);
    if (item && item.metadataKey !== key) fail('CATALOG_VIEW_AMBIGUOUS');
    if (!item) {
      item = {metadataKey: key, selections: [], byId: new Map(), event: {
        eventKey: event.eventKey, displayName: event.displayName, eventDate: event.eventDate,
        eventType: event.eventType, homeSchool: event.homeSchool, venue: event.venue,
        playbackArea: event.playbackArea, boardOnly: event.boardOnly, eventBoard: event.eventBoard,
        eligibility: event.eligibility, timingProposal: event.timing
      }};
      byKey.set(event.eventKey, item); events.push(item.event);
    }
    for (const entry of selections) {
      const identity = canonicalExchangeJSON(entry);
      if (item.byId.has(entry.selectionId)) {
        if (item.byId.get(entry.selectionId) !== identity) fail('CATALOG_VIEW_AMBIGUOUS');
        continue;
      }
      if (item.selections.length >= 100) fail('CATALOG_VIEW_CAPACITY');
      item.byId.set(entry.selectionId, identity);
      item.selections.push({selectionId: entry.selectionId, identityTuple: entry.identityTuple,
        origin: entry.origin, targetBoardKey: entry.targetBoardKey, displayLabel: entry.displayLabel,
        templateButtonKey: entry.templateButtonKey, labelShared: entry.labelShared,
        generation: entry.generation, generationSequence: entry.generationSequence,
        playbackFingerprint: entry.playbackFingerprint, metadataFingerprint: entry.metadataFingerprint,
        manifestState: entry.manifestState, occurrenceCount: entry.occurrenceCount});
    }
    item.event.selectionCount = item.selections.length;
  }
  freeze(events);
  for (const item of byKey.values()) freeze(item.selections);
  const summary = freeze({scope: 'source-catalog-metadata', ready: false, revision,
    feedId: receipt.feedId, epoch: receipt.epoch, schoolYear: catalog.schoolYear,
    catalogSequence: receipt.catalogSequence, eventCount: events.length});
  function page(raw, selected) {
    try {
      fields(raw, selected ? ['revision','eventKey','offset','limit'] : ['revision','offset','limit'],
        selected ? ['revision','eventKey'] : ['revision']);
      if (typeof raw.revision !== 'string' || !/^[a-f0-9]{64}$/.test(raw.revision)) fail('CATALOG_QUERY_INVALID');
      if (raw.revision !== revision) fail('CATALOG_REVISION_STALE');
      const offset = raw.offset === undefined ? 0 : raw.offset, limit = raw.limit === undefined ? 50 : raw.limit;
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_LIMIT) fail('CATALOG_QUERY_INVALID');
      if (selected && (typeof raw.eventKey !== 'string' || !raw.eventKey || Array.from(raw.eventKey).length > 64 || /[\x00-\x1f\x7f]/.test(raw.eventKey))) fail('CATALOG_QUERY_INVALID');
      const rows = selected ? byKey.get(raw.eventKey)?.selections : events;
      if (!rows) fail('CATALOG_EVENT_MISSING');
      if (offset > rows.length) fail('CATALOG_QUERY_INVALID');
      return freeze({ok: true, ...summary, offset, limit, total: rows.length,
        nextOffset: offset + limit < rows.length ? offset + limit : null,
        ...(selected ? {eventKey: raw.eventKey, selections: rows.slice(offset, offset + limit)} : {events: rows.slice(offset, offset + limit)})});
    } catch (error) {
      return Object.freeze({ok: false, ready: false, code: ['CATALOG_QUERY_INVALID','CATALOG_REVISION_STALE','CATALOG_EVENT_MISSING'].includes(error.code) ? error.code : 'CATALOG_QUERY_INVALID'});
    }
  }
  return Object.freeze({summary: () => summary, eventsPage: raw => page(raw, false), selectionsPage: raw => page(raw, true)});
}
module.exports = {createExchangeCatalogView, EXCHANGE_CATALOG_PAGE_LIMIT: PAGE_LIMIT};
