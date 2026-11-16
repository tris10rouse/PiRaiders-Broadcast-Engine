'use strict';
// Detached raw catalog admission only. No source/media/network I/O or actions.
const crypto = require('node:crypto');
const {parseExchangeJSON} = require('./exchange-json.cjs');
const {createExchangeSchemaGate} = require('./exchange-schema-gate.cjs');
const {selectionId, canonicalExchangeJSON} = require('./exchange-fingerprints.cjs');
const LIMITS = Object.freeze({feedBytes: 65536, catalogBytes: 5242880});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INPUT = 'CATALOG_RECEIPT_INPUT_INVALID';
const CODES = new Set([INPUT, 'CATALOG_RECEIPT_SCHEMA_INVALID',
  'CATALOG_RECEIPT_BINDING_MISMATCH', 'CATALOG_RECEIPT_CONTEXT_INVALID']);
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(typedArray, 'byteLength').get;
const byteOffset = Object.getOwnPropertyDescriptor(typedArray, 'byteOffset').get;
const backingBuffer = Object.getOwnPropertyDescriptor(typedArray, 'buffer').get;
function fail(code) { throw Error(code); }
function shape(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(INPUT);
  const fields = Object.getOwnPropertyDescriptors(value);
  const own = Reflect.ownKeys(fields);
  if (own.length !== keys.length || keys.some(key => !Object.hasOwn(fields, key)) ||
      own.some(key => typeof key !== 'string' || !keys.includes(key) ||
        !fields[key].enumerable || !Object.hasOwn(fields[key], 'value'))) fail(INPUT);
  return fields;
}
function copyBytes(raw, maximum) {
  if (!Buffer.isBuffer(raw)) fail(INPUT);
  // Read actual TypedArray slots, never caller length/buffer/byteOffset getters,
  // copy/toJSON methods or enumerable properties. Ordinary Buffers are the API
  // boundary; this is not a sandbox for hostile proxies/compromised globals.
  const length = byteLength.call(raw);
  if (length > maximum) fail(INPUT);
  const owned = Buffer.alloc(length);
  Uint8Array.prototype.set.call(owned,
    new Uint8Array(backingBuffer.call(raw), byteOffset.call(raw), length));
  return owned;
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function context(catalog) {
  const seen = new Map();
  for (const event of catalog.events) {
    for (const entry of event.selections) {
      const tuple = entry.identityTuple;
      if (entry.selectionId !== selectionId(tuple) ||
          tuple[0] !== catalog.schoolYear || tuple[1] !== event.eventKey ||
          tuple[2] !== (entry.targetBoardKey === null ? '' : entry.targetBoardKey) ||
          tuple[3] !== entry.origin) fail('CATALOG_RECEIPT_CONTEXT_INVALID');
      // Repeated identical data is unambiguous. Conflicting descriptors for one
      // identity are not; canonicalize only this small schema-bounded entry.
      const entryJSON = canonicalExchangeJSON(entry);
      if (seen.has(entry.selectionId) && seen.get(entry.selectionId) !== entryJSON) fail('CATALOG_RECEIPT_CONTEXT_INVALID');
      seen.set(entry.selectionId, entryJSON);
      if (entry.origin === 'event') {
        // displayLabel is not normalizedLabel. Its spelling is not an identity
        // check; tuple[4] stays opaque until the selected manifest is verified.
        if (entry.targetBoardKey !== event.eventBoard.boardKey) fail('CATALOG_RECEIPT_CONTEXT_INVALID');
      } else if (tuple[4] !== entry.templateButtonKey || !tuple[2]) fail('CATALOG_RECEIPT_CONTEXT_INVALID');
      const generation = /^e([1-9][0-9]{0,5})-g([0-9]{10})-([0-9a-f]{12})$/.exec(entry.generation);
      if (!generation || Number(generation[1]) !== catalog.epoch ||
          Number(generation[2]) !== entry.generationSequence ||
          generation[3] !== entry.metadataFingerprint.slice(0, 12) ||
          entry.manifestPath !== 'selections/' + entry.selectionId + '/generations/' + entry.generation + '/manifest.json') {
        fail('CATALOG_RECEIPT_CONTEXT_INVALID');
      }
    }
  }
}
function createExchangeCatalogReceiptGate() {
  let schemas;
  try { schemas = createExchangeSchemaGate(); }
  catch { throw Error('CATALOG_RECEIPT_BACKEND_UNAVAILABLE'); }
  return Object.freeze({validate(raw) {
    try {
      const fields = shape(raw, ['feedBytes', 'catalogBytes', 'expectedBinding']);
      const bindingFields = shape(fields.expectedBinding.value, ['feedId', 'epoch']);
      const expected = {feedId: bindingFields.feedId.value, epoch: bindingFields.epoch.value};
      if (typeof expected.feedId !== 'string' || !UUID.test(expected.feedId) ||
          !Number.isSafeInteger(expected.epoch) || expected.epoch < 1 || expected.epoch > 999999) fail(INPUT);
      // Own both raw documents synchronously before parsing/backend calls.
      const feedBytes = copyBytes(fields.feedBytes.value, LIMITS.feedBytes);
      const catalogBytes = copyBytes(fields.catalogBytes.value, LIMITS.catalogBytes);
      const feed = parseExchangeJSON(feedBytes), catalog = parseExchangeJSON(catalogBytes);
      if (!schemas.validate('feed', feed).ok || !schemas.validate('catalog', catalog).ok) fail('CATALOG_RECEIPT_SCHEMA_INVALID');
      if (feed.feedId !== expected.feedId || feed.epoch !== expected.epoch ||
          catalog.feedId !== expected.feedId || catalog.epoch !== expected.epoch) fail('CATALOG_RECEIPT_BINDING_MISMATCH');
      context(catalog);
      return freeze({ok: true, code: 'CATALOG_RECEIPT_VALID', scope: 'catalog-receipt',
        ready: false, semanticValidation: 'pending', receipt: {
          scope: 'validated-catalog-metadata', ready: false,
          feedId: expected.feedId, epoch: expected.epoch, catalogSequence: catalog.catalogSequence,
          documentDigests: {feed: digest(feedBytes), catalog: digest(catalogBytes)}, feed, catalog
        }});
    } catch (error) {
      return Object.freeze({ok: false, code: CODES.has(error?.message) ? error.message : INPUT,
        scope: 'catalog-receipt', ready: false, semanticValidation: 'pending'});
    }
  }});
}
module.exports = {createExchangeCatalogReceiptGate, EXCHANGE_CATALOG_RECEIPT_LIMITS: LIMITS};
