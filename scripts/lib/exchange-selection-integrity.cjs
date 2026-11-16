'use strict';
// Detached draft0.3.1 subset only. Never source acceptance, content readiness or arming.
const {createExchangeSchemaGate} = require('./exchange-schema-gate.cjs');
const {canonicalExchangeJSON, selectionId, selectionFingerprints} = require('./exchange-fingerprints.cjs');
const RULES = Object.freeze(['V1', 'V2', 'V3', 'V4', 'V6', 'V7', 'V18']);
const PENDING = Object.freeze(['problem-state', 'calendar-window', 'asset-bytes', 'durable-ledger', 'eligibility-admission', 'descriptor-context']);
const CODES = new Set([
  'SELECTION_INPUT_INVALID', 'SELECTION_SCHEMA_INVALID', 'SELECTION_IDENTITY_INVALID',
  'SELECTION_ORDER_INVALID', 'SELECTION_REFERENCES_INVALID', 'SELECTION_ASSET_PATH_INVALID',
  'SELECTION_FINGERPRINT_INVALID'
]);
function fail(code) { throw Error(code); }
function result(code) {
  return Object.freeze({
    ok: code === 'SELECTION_INTEGRITY_VALID', code, scope: 'selection-integrity',
    ready: false, semanticValidation: 'pending',
    verifiedRules: code === 'SELECTION_INTEGRITY_VALID' ? RULES : Object.freeze([]),
    pending: PENDING
  });
}
function verifyIdentity(manifest) {
  const {identityTuple, board, button} = manifest;
  const expected = [manifest.schoolYear, manifest.event.eventKey,
    board.boardKey === null ? '' : board.boardKey, button.origin,
    button.origin === 'event' ? button.normalizedLabel : button.templateButtonKey];
  if (identityTuple.some((value, index) => value !== expected[index]) ||
      manifest.selectionId !== selectionId(identityTuple)) fail('SELECTION_IDENTITY_INVALID');
}
function verifyOrderAndAssets(manifest) {
  const keys = new Set(), assets = new Map(), referenced = new Set();
  for (const asset of manifest.assets) {
    if (assets.has(asset.assetKey)) fail('SELECTION_REFERENCES_INVALID');
    assets.set(asset.assetKey, asset);
    const extension = asset.mimeType === 'image/png' ? '.png' : '.jpg';
    if (asset.deliveryPath !== 'assets/' + asset.sha256 + extension) fail('SELECTION_ASSET_PATH_INVALID');
  }
  for (const [index, occurrence] of manifest.occurrences.entries()) {
    if (occurrence.position !== index + 1 || keys.has(occurrence.occurrenceKey)) fail('SELECTION_ORDER_INVALID');
    keys.add(occurrence.occurrenceKey);
    if (occurrence.assetKey !== null) {
      if (!assets.has(occurrence.assetKey)) fail('SELECTION_REFERENCES_INVALID');
      referenced.add(occurrence.assetKey);
    }
  }
  // Multiple occurrences may reference one asset; do not deduplicate the deck.
  if (referenced.size !== assets.size) fail('SELECTION_REFERENCES_INVALID');
}
function createExchangeSelectionIntegrityGate() {
  let schema;
  try { schema = createExchangeSchemaGate(); }
  catch { throw Error('SELECTION_INTEGRITY_BACKEND_UNAVAILABLE'); }
  return Object.freeze({validate(value) {
    try {
      // Own detached JSON snapshot before Ajv: bounded bytes/depth/nodes, no
      // accessors/toJSON, malformed Unicode or non-JSON/unsafe numeric values.
      let manifest;
      try { manifest = JSON.parse(canonicalExchangeJSON(value)); }
      catch { fail('SELECTION_INPUT_INVALID'); }
      if (!schema.validate('selection', manifest).ok) fail('SELECTION_SCHEMA_INVALID');
      verifyIdentity(manifest);
      verifyOrderAndAssets(manifest);
      const computed = selectionFingerprints(manifest);
      if (manifest.playbackFingerprint !== computed.playbackFingerprint ||
          manifest.metadataFingerprint !== computed.metadataFingerprint) fail('SELECTION_FINGERPRINT_INVALID');
      return result('SELECTION_INTEGRITY_VALID');
    } catch (error) {
      return result(CODES.has(error?.message) ? error.message : 'SELECTION_INPUT_INVALID');
    }
  }});
}
module.exports = {createExchangeSelectionIntegrityGate};
