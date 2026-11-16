'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {fixtures} = require('./exchange-fixtures.cjs');
const {createExchangeSchemaGate} = require('../scripts/lib/exchange-schema-gate.cjs');
const {createExchangeMetadataReader} = require('../scripts/lib/exchange-metadata-reader.cjs');
const {selectionId, selectionFingerprints} = require('../scripts/lib/exchange-fingerprints.cjs');
const {createExchangeSelectionIntegrityGate} = require('../scripts/lib/exchange-selection-integrity.cjs');
const schema = createExchangeSchemaGate(), gate = createExchangeSelectionIntegrityGate();
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function asset(key = 'a1', sha = 'a'.repeat(64)) {
  return {assetKey: key, originalDriveId: 'synthetic-id-0001', viaShortcutId: null,
    sourceRevision: {md5: null, size: null, modifiedTime: null, headRevisionId: null},
    mimeType: 'image/png', deliveryPath: 'assets/' + sha + '.png', byteLength: 1, sha256: sha, width: 1, height: 1};
}
function seal(manifest) {
  manifest.selectionId = selectionId(manifest.identityTuple);
  const {playbackFingerprint, metadataFingerprint} = selectionFingerprints(manifest);
  Object.assign(manifest, {playbackFingerprint, metadataFingerprint});
  manifest.generation = 'e' + manifest.epoch + '-g' + String(manifest.generationSequence).padStart(10, '0') + '-' + manifest.metadataFingerprint.slice(0, 12);
  return manifest;
}
function valid() {
  const manifest = fixtures().selection;
  manifest.manifestState = 'complete'; manifest.assets = [asset()];
  manifest.occurrences = [1, 2].map(position => ({position, occurrenceKey: 'row-' + position, fileKey: 'FILE-' + position,
    assetKey: 'a1', problem: null, sourceName: 'Synthetic image', lineage: null}));
  return seal(manifest);
}
function expectInvalid(manifest, code, {resign = true} = {}) {
  // Re-sign other semantic mutations so the rule under test, not an unrelated
  // stale fingerprint, determines the rejection. Broken references cannot hash.
  if (resign) seal(manifest);
  assert.equal(schema.validate('selection', manifest).ok, true, 'negative remains structurally valid');
  const result = gate.validate(manifest);
  assert.equal(result.code, code); assert.equal(result.ok, false); assert.equal(result.ready, false);
  assert.equal(result.semanticValidation, 'pending'); assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(result.verifiedRules, []);
}

test('valid selection integrity remains partial, immutable and does not mutate repeated ordered media', () => {
  const source = valid(), before = clone(source), result = gate.validate(source);
  assert.equal(schema.validate('selection', source).ok, true);
  assert.equal(result.ok, true); assert.equal(result.code, 'SELECTION_INTEGRITY_VALID');
  assert.equal(result.ready, false); assert.equal(result.semanticValidation, 'pending');
  assert.deepEqual(result.verifiedRules, ['V1', 'V2', 'V3', 'V4', 'V6', 'V7', 'V18']);
  assert.deepEqual(result.pending, ['problem-state', 'calendar-window', 'asset-bytes', 'durable-ledger', 'eligibility-admission', 'descriptor-context']);
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.pending), true);
  assert.equal(Object.isFrozen(result.verifiedRules), true); assert.deepEqual(source, before);
  assert.deepEqual(source.occurrences.map(row => row.assetKey), ['a1', 'a1']);
});

test('event/season identity, unresolved event board and supplementary Unicode bind to exact tuple fields', () => {
  const unicode = valid(); unicode.button.normalizedLabel = '😀'.repeat(200); unicode.identityTuple[4] = unicode.button.normalizedLabel;
  assert.equal(gate.validate(seal(unicode)).ok, true);
  const season = valid(); season.button.origin = 'season'; season.button.templateButtonKey = 'SEASON-1';
  season.identityTuple[3] = 'season'; season.identityTuple[4] = 'SEASON-1';
  season.sourceTicks.onBoardAll = null; season.sourceTicks.loadedForYear = true;
  for (const row of season.occurrences) row.fileKey = null;
  assert.equal(gate.validate(seal(season)).ok, true);
  const unresolved = valid(); unresolved.board = {boardKey: null, displayName: null}; unresolved.identityTuple[2] = '';
  unresolved.manifestState = 'incomplete'; unresolved.assets = [];
  unresolved.problems = [{code: 'BOARD_UNRESOLVED', detail: null, occurrenceKey: null}];
  for (const row of unresolved.occurrences) { row.assetKey = null; row.problem = {code: 'BOARD_UNRESOLVED', detail: null, occurrenceKey: row.occurrenceKey}; }
  assert.equal(gate.validate(seal(unresolved)).ok, true);
});

test('schema-valid forged ID and each manifest-internal tuple context mismatch are rejected', () => {
  const forged = valid(); forged.selectionId = 'sel_' + 'f'.repeat(32);
  expectInvalid(forged, 'SELECTION_IDENTITY_INVALID', {resign: false});
  for (const mutate of [x => x.schoolYear = '2027-2028', x => x.event.eventKey = 'OTHER-EVENT',
    x => x.board.boardKey = 'OTHER-BOARD', x => x.button.normalizedLabel = 'other label']) {
    const source = valid(); mutate(source); expectInvalid(source, 'SELECTION_IDENTITY_INVALID');
  }
  const wrongNull = valid(); wrongNull.board.boardKey = null; expectInvalid(wrongNull, 'SELECTION_IDENTITY_INVALID');
  const season = valid(); season.button.origin = 'season'; season.button.templateButtonKey = 'SEASON-1';
  season.identityTuple[3] = 'season'; season.identityTuple[4] = 'WRONG-KEY';
  season.sourceTicks.onBoardAll = null; season.sourceTicks.loadedForYear = true;
  for (const row of season.occurrences) row.fileKey = null;
  expectInvalid(season, 'SELECTION_IDENTITY_INVALID');
});

test('positions must be one-based and ordered; occurrence keys are unique even for repeated media', () => {
  for (const mutate of [x => x.occurrences.reverse(), x => x.occurrences[1].position = 3,
    x => x.occurrences[1].position = 1, x => x.occurrences[1].occurrenceKey = x.occurrences[0].occurrenceKey]) {
    const source = valid(); mutate(source); expectInvalid(source, 'SELECTION_ORDER_INVALID');
  }
});

test('every nonnull reference resolves exactly once and every asset is used', () => {
  const missing = valid(); missing.occurrences[0].assetKey = 'a2';
  expectInvalid(missing, 'SELECTION_REFERENCES_INVALID', {resign: false});
  const duplicate = valid(); duplicate.assets.push(clone(duplicate.assets[0]));
  expectInvalid(duplicate, 'SELECTION_REFERENCES_INVALID', {resign: false});
  const orphan = valid(); orphan.assets.push(asset('a2', 'b'.repeat(64)));
  expectInvalid(orphan, 'SELECTION_REFERENCES_INVALID');
});

test('asset path must match its exact SHA and MIME extension without normalization', () => {
  const pngAsJpeg = valid(); pngAsJpeg.assets[0].deliveryPath = 'assets/' + 'a'.repeat(64) + '.jpg';
  expectInvalid(pngAsJpeg, 'SELECTION_ASSET_PATH_INVALID');
  const wrongSha = valid(); wrongSha.assets[0].deliveryPath = 'assets/' + 'b'.repeat(64) + '.png';
  expectInvalid(wrongSha, 'SELECTION_ASSET_PATH_INVALID');
  const jpeg = valid(); jpeg.assets[0].mimeType = 'image/jpeg'; jpeg.assets[0].deliveryPath = 'assets/' + 'a'.repeat(64) + '.jpg';
  assert.equal(gate.validate(seal(jpeg)).ok, true);
});

test('advertised fingerprints must be independently recomputed; metadata-only updates preserve playback', () => {
  for (const field of ['playbackFingerprint', 'metadataFingerprint']) {
    const source = valid(); source[field] = 'f'.repeat(64);
    expectInvalid(source, 'SELECTION_FINGERPRINT_INVALID', {resign: false});
  }
  const source = valid(), originalPlayback = source.playbackFingerprint;
  source.button.displayLabel = 'Updated title'; source.sourceTicks.onBoardAll = true;
  expectInvalid(source, 'SELECTION_FINGERPRINT_INVALID', {resign: false});
  seal(source); assert.equal(source.playbackFingerprint, originalPlayback); assert.equal(gate.validate(source).ok, true);
  source.occurrences.reverse(); source.occurrences.forEach((row, index) => row.position = index + 1);
  expectInvalid(source, 'SELECTION_FINGERPRINT_INVALID', {resign: false});
  seal(source); assert.notEqual(source.playbackFingerprint, originalPlayback); assert.equal(gate.validate(source).ok, true);
});

test('empty/removed metadata is never output Stop or readiness; unverified bytes remain pending', () => {
  for (const manifestState of ['empty', 'removed']) {
    const source = fixtures().selection; source.manifestState = manifestState;
    const result = gate.validate(seal(source)); assert.equal(result.ok, true); assert.equal(result.ready, false);
  }
  // byteLength=1 for a purported PNG is schema-valid metadata; no actual bytes
  // are read or accepted here. A later byte/decode gate must reject it.
  const result = gate.validate(valid()); assert.equal(result.ok, true); assert.ok(result.pending.includes('asset-bytes'));
});

test('bounded JSON precedes schema evaluation and failures contain no source values or paths', () => {
  let called = false;
  const accessor = Object.defineProperty({}, 'private-test', {enumerable: true, get() {called = true; return 'private-value';}});
  const oversized = valid(); oversized.button.displayLabel = 'x'.repeat(1048576);
  let depth = null; for (let n = 0; n < 33; n++) depth = [depth];
  for (const input of [accessor, oversized, depth, undefined, NaN, '\ud800', {private: () => 'private'}]) {
    const result = gate.validate(input); assert.equal(result.code, 'SELECTION_INPUT_INVALID');
    assert.equal(result.ready, false); assert.doesNotMatch(JSON.stringify(result), /private-test|private-value|deliveryPath|stack/);
  }
  assert.equal(called, false);
  const structurallyBad = valid(); structurallyBad.generationSequence = -1;
  assert.equal(gate.validate(structurallyBad).code, 'SELECTION_SCHEMA_INVALID');
  assert.equal(gate.validate(valid()).ok, true, 'invalid candidate does not poison later validation');
});

async function captureFixture(t, manifest) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'PiRaiders integrity fixture '));
  t.after(() => fs.rm(root, {recursive: true, force: true, maxRetries: 10, retryDelay: 100}));
  const base = fixtures(), bytes = Buffer.from(JSON.stringify(manifest, null, 2));
  const current = {...base.current};
  for (const name of ['feedId', 'epoch', 'selectionId', 'identityTuple', 'generation', 'generationSequence',
    'manifestState', 'playbackFingerprint', 'metadataFingerprint']) current[name] = manifest[name];
  current.manifestPath = 'selections/' + manifest.selectionId + '/generations/' + manifest.generation + '/manifest.json';
  current.manifestSha256 = hash(bytes);
  const descriptor = {selectionId: current.selectionId, identityTuple: current.identityTuple,
    origin: manifest.button.origin, targetBoardKey: manifest.board.boardKey, displayLabel: manifest.button.displayLabel,
    templateButtonKey: manifest.button.templateButtonKey, labelShared: false, occurrenceCount: manifest.occurrences.length};
  for (const name of ['generation', 'generationSequence', 'manifestPath', 'manifestSha256', 'playbackFingerprint', 'metadataFingerprint', 'manifestState']) descriptor[name] = current[name];
  base.catalog.events = [{...manifest.event, eventType: 'Synthetic event', homeSchool: 'Synthetic school',
    venue: 'Synthetic venue', playbackArea: 'Stadium Playback', boardOnly: true, eventBoard: manifest.board, selections: [descriptor]}];
  for (const [relative, value] of [['feed.json', base.feed], ['catalog.json', base.catalog],
    ['selections/' + manifest.selectionId + '/current.json', current], [current.manifestPath, bytes]]) {
    const file = path.join(root, ...relative.split('/')); await fs.mkdir(path.dirname(file), {recursive: true});
    await fs.writeFile(file, Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)));
  }
  const reader = createExchangeMetadataReader({root, binding: {feedId: manifest.feedId, epoch: manifest.epoch, identityTuple: manifest.identityTuple}});
  t.after(() => reader.close());
  return {reader, bytes};
}

test('actual captured metadata composes with all four schema gates and selection integrity without assets', async t => {
  const source = valid(), {reader, bytes} = await captureFixture(t, source), captured = await reader.capture();
  assert.equal(captured.ok, true); assert.equal(captured.ready, false);
  for (const [kind, name] of [['feed', 'feed'], ['catalog', 'catalog'], ['current', 'current'], ['selection', 'manifest']]) {
    assert.equal(schema.validate(kind, captured.pin[name]).ok, true, kind);
  }
  assert.equal(captured.pin.documentDigests.manifest, hash(bytes));
  assert.equal(gate.validate(captured.pin.manifest).ok, true); assert.equal(gate.validate(captured.pin.manifest).ready, false);
  const forged = clone(captured.pin.manifest); forged.playbackFingerprint = 'f'.repeat(64);
  assert.equal(gate.validate(forged).code, 'SELECTION_FINGERPRINT_INVALID');
  assert.equal(reader.lastPin(), captured.pin, 'downstream rejection does not replace metadata pin');
});
