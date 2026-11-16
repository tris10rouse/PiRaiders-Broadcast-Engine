'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {fixtures} = require('./exchange-fixtures.cjs');
const {selectionId, selectionFingerprints} = require('../scripts/lib/exchange-fingerprints.cjs');
const {createExchangeSchemaGate} = require('../scripts/lib/exchange-schema-gate.cjs');
const {createExchangeSelectionIntegrityGate} = require('../scripts/lib/exchange-selection-integrity.cjs');
const {createExchangeMetadataReader} = require('../scripts/lib/exchange-metadata-reader.cjs');
const {createExchangeProblemStateGate} = require('../scripts/lib/exchange-problem-state.cjs');
const schema = createExchangeSchemaGate(), integrity = createExchangeSelectionIntegrityGate(), gate = createExchangeProblemStateGate();
const clone = value => JSON.parse(JSON.stringify(value));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const caps = {occurrences: 500, assets: 500, total_bytes: 536870912};
function seal(manifest) {
  manifest.selectionId = selectionId(manifest.identityTuple);
  const {playbackFingerprint, metadataFingerprint} = selectionFingerprints(manifest);
  Object.assign(manifest, {playbackFingerprint, metadataFingerprint});
  manifest.generation = 'e' + manifest.epoch + '-g' + String(manifest.generationSequence).padStart(10, '0') + '-' + metadataFingerprint.slice(0, 12);
  return manifest;
}
function complete() {
  const manifest = fixtures().selection; manifest.manifestState = 'complete';
  manifest.assets = [{assetKey: 'a1', originalDriveId: 'synthetic-binary-1', viaShortcutId: null,
    sourceRevision: {md5: null, size: null, modifiedTime: null, headRevisionId: null},
    mimeType: 'image/png', deliveryPath: 'assets/' + 'a'.repeat(64) + '.png', byteLength: 1, sha256: 'a'.repeat(64), width: 1, height: 1}];
  manifest.occurrences = [1, 2, 3].map(position => ({position, occurrenceKey: 'ROW-' + position,
    fileKey: 'FILE-' + position, assetKey: 'a1', problem: null, sourceName: 'Synthetic media', lineage: null}));
  return manifest;
}
const missing = occurrenceKey => ({code: 'MISSING_FILE', detail: 'not_found', occurrenceKey});
function incomplete() {
  const manifest = complete(); manifest.manifestState = 'incomplete';
  manifest.occurrences[1].assetKey = null; manifest.occurrences[1].problem = missing('ROW-2');
  manifest.occurrences[2].assetKey = null; manifest.occurrences[2].problem = null;
  // ROW-2 is represented inline only; ROW-3 is listed only. V20 allows OR.
  manifest.problems = [missing('ROW-3')];
  return manifest;
}
function unresolved() {
  const manifest = complete(); manifest.manifestState = 'incomplete';
  manifest.board = {boardKey: null, displayName: null}; manifest.identityTuple[2] = ''; manifest.assets = [];
  manifest.problems = [{code: 'BOARD_UNRESOLVED', detail: null, occurrenceKey: null}];
  for (const row of manifest.occurrences) { row.assetKey = null; row.problem = {code: 'BOARD_UNRESOLVED', detail: null, occurrenceKey: row.occurrenceKey}; }
  return manifest;
}
function diagnostic(detail = 'occurrences', observed = caps[detail] + 1, limit = caps[detail]) {
  const manifest = fixtures().selection; manifest.manifestState = 'incomplete';
  manifest.problems = [{code: 'LIMIT_EXCEEDED', detail, occurrenceKey: null, observed, limit}];
  return manifest;
}
function validSubset(manifest) {
  seal(manifest);
  assert.equal(schema.validate('selection', manifest).ok, true, 'source passes existing structural schema');
  assert.equal(integrity.validate(manifest).ok, true, 'source passes existing integrity subset');
  return manifest;
}
function reject(manifest, code) {
  const source = validSubset(manifest), before = clone(source), result = gate.validate(source);
  assert.equal(result.ok, false); assert.equal(result.code, code); assert.equal(result.ready, false);
  assert.equal(result.semanticValidation, 'pending'); assert.deepEqual(result.verifiedRules, []);
  assert.equal(Object.isFrozen(result), true); assert.deepEqual(source, before);
}

test('state success is immutable, scoped and never makes purported media ready', () => {
  const source = validSubset(complete()), before = clone(source), result = gate.validate(source);
  assert.equal(result.ok, true); assert.equal(result.code, 'PROBLEM_STATE_VALID'); assert.equal(result.ready, false);
  assert.equal(result.semanticValidation, 'pending'); assert.equal(result.scope, 'selection-problem-state');
  assert.deepEqual(result.verifiedRules, ['V5', 'V20-selection-null-problem-scope', '5.2-board-unresolved', '5.2-selection-limit']);
  assert.deepEqual(result.pending, ['calendar-window', 'asset-bytes', 'durable-ledger', 'eligibility-admission', 'descriptor-context']);
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.pending), true); assert.equal(Object.isFrozen(result.verifiedRules), true);
  assert.deepEqual(source, before); // Fake one-byte PNG metadata is not byte verification.
});

test('ordinary incomplete permits inline OR listed problems and repeated/unsorted summaries', () => {
  const source = incomplete(); assert.equal(gate.validate(validSubset(source)).ok, true);
  source.problems.push(missing('ROW-2'), missing('ROW-3')); source.problems.reverse();
  assert.equal(gate.validate(validSubset(source)).ok, true);
});

test('ordinary incomplete requires a null-asset occurrence associated with a problem', () => {
  const allGood = complete(); allGood.manifestState = 'incomplete'; allGood.problems = [missing('ROW-2')];
  reject(allGood, 'PROBLEM_STATE_INVALID');
  const unassociated = complete(); unassociated.manifestState = 'incomplete'; unassociated.occurrences[1].assetKey = null;
  unassociated.problems = [missing('OTHER-ROW')]; reject(unassociated, 'PROBLEM_STATE_INVALID');
});

test('BOARD_UNRESOLVED is an event-only, all-row diagnostic with one null-key summary', () => {
  assert.equal(gate.validate(validSubset(unresolved())).ok, true);
  const season = unresolved(); season.button.origin = 'season'; season.button.templateButtonKey = 'SEASON-1';
  season.board = {boardKey: 'BOARD-SYNTHETIC', displayName: 'Synthetic board'};
  season.identityTuple[2] = season.board.boardKey; season.identityTuple[3] = 'season'; season.identityTuple[4] = 'SEASON-1';
  season.sourceTicks.onBoardAll = null; season.sourceTicks.loadedForYear = true;
  for (const row of season.occurrences) row.fileKey = null;
  reject(season, 'PROBLEM_BOARD_INVALID');
  const duplicate = unresolved(); duplicate.problems.push(clone(duplicate.problems[0])); reject(duplicate, 'PROBLEM_BOARD_INVALID');
  const rowSummary = unresolved(); rowSummary.problems[0].occurrenceKey = 'ROW-1'; reject(rowSummary, 'PROBLEM_BOARD_INVALID');
  const missingInline = unresolved(); missingInline.occurrences[0].problem = null; reject(missingInline, 'PROBLEM_BOARD_INVALID');
  const otherInline = unresolved(); otherInline.occurrences[0].problem = missing('ROW-1'); reject(otherInline, 'PROBLEM_BOARD_INVALID');
});

test('a blank active event board cannot bypass BOARD semantics using valid media or another problem', () => {
  const playable = complete(); playable.board = {boardKey: null, displayName: null}; playable.identityTuple[2] = '';
  reject(playable, 'PROBLEM_BOARD_INVALID');
  const otherProblem = incomplete(); otherProblem.board = {boardKey: null, displayName: null}; otherProblem.identityTuple[2] = '';
  reject(otherProblem, 'PROBLEM_BOARD_INVALID');
  const mixed = unresolved(), image = complete().assets[0]; mixed.assets = [image]; mixed.occurrences[0].assetKey = 'a1'; mixed.occurrences[0].problem = null;
  reject(mixed, 'PROBLEM_BOARD_INVALID');
});

test('all three bounded diagnostic details use their exact cap and any larger safe observed value', () => {
  for (const detail of ['occurrences', 'assets', 'total_bytes']) {
    for (const observed of [caps[detail] + 1, caps[detail] + 100, Number.MAX_SAFE_INTEGER]) {
      const source = validSubset(diagnostic(detail, observed)); assert.equal(gate.validate(source).ok, true); assert.equal(gate.validate(source).ready, false);
    }
    reject(diagnostic(detail, caps[detail]), 'PROBLEM_LIMIT_INVALID');
    reject(diagnostic(detail, caps[detail] - 1), 'PROBLEM_LIMIT_INVALID');
    reject(diagnostic(detail, caps[detail] + 100, caps[detail] + 1), 'PROBLEM_LIMIT_INVALID');
  }
});

test('bounded limit exception remains valid with no rows and does not impose source limit precedence', () => {
  const assets = validSubset(diagnostic('assets', 501)); assert.equal(gate.validate(assets).ok, true);
  const blank = diagnostic('occurrences', 501); blank.board = {boardKey: null, displayName: null}; blank.identityTuple[2] = '';
  assert.equal(gate.validate(validSubset(blank)).ok, true, 'no inferred source priority between limit and board diagnostics');
});

test('selection-level null problems are restricted; per-image limits remain row-level', () => {
  const missingNull = incomplete(); missingNull.problems[0].occurrenceKey = null; reject(missingNull, 'PROBLEM_SCOPE_INVALID');
  for (const detail of ['dimensions', 'pixels']) {
    const imageLimit = incomplete(); imageLimit.problems = [{code: 'LIMIT_EXCEEDED', detail, occurrenceKey: 'ROW-3'}];
    imageLimit.occurrences[1].problem = {code: 'LIMIT_EXCEEDED', detail, occurrenceKey: 'ROW-2'};
    assert.equal(gate.validate(validSubset(imageLimit)).ok, true);
    imageLimit.problems[0].occurrenceKey = null; reject(imageLimit, 'PROBLEM_SCOPE_INVALID');
  }
});

test('selection-limit details cannot be hidden inline on a row', () => {
  for (const detail of ['occurrences', 'assets', 'total_bytes']) {
    const source = incomplete(); source.occurrences[1].problem = {code: 'LIMIT_EXCEEDED', detail, occurrenceKey: null, observed: caps[detail] + 1, limit: caps[detail]};
    reject(source, 'PROBLEM_SCOPE_INVALID');
  }
});

test('empty and removed retain their schema shape without Stop, deletion or board-priority inference', () => {
  for (const manifestState of ['empty', 'removed']) {
    const source = fixtures().selection; source.manifestState = manifestState; source.board = {boardKey: null, displayName: null}; source.identityTuple[2] = '';
    const result = gate.validate(validSubset(source)); assert.equal(result.ok, true); assert.equal(result.ready, false);
    assert.deepEqual(Object.keys(result).sort(), ['code', 'ok', 'pending', 'ready', 'scope', 'semanticValidation', 'verifiedRules'].sort());
  }
});

test('schema/integrity constraints remain prerequisites and are not rebuilt as problem code logic', () => {
  const unknown = incomplete(); unknown.problems[0].code = 'PRIVATE-UNKNOWN-CODE'; seal(unknown);
  assert.equal(gate.validate(unknown).code, 'PROBLEM_PREREQUISITE_INVALID');
  const badPair = incomplete(); badPair.problems[0].detail = 'pixels'; seal(badPair);
  assert.equal(gate.validate(badPair).code, 'PROBLEM_PREREQUISITE_INVALID');
  const malformed = diagnostic(); malformed.occurrences = complete().occurrences; malformed.assets = complete().assets; seal(malformed);
  assert.equal(gate.validate(malformed).code, 'PROBLEM_PREREQUISITE_INVALID', 'schema already enforces bounded diagnostic arrays');
  const forged = validSubset(incomplete()); forged.metadataFingerprint = 'f'.repeat(64);
  assert.equal(gate.validate(forged).code, 'PROBLEM_PREREQUISITE_INVALID');
  const invalidNumber = diagnostic(); invalidNumber.problems[0].observed = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(gate.validate(invalidNumber).code, 'PROBLEM_INPUT_INVALID');
});

test('bounded input fails with redacted codes and cannot poison subsequent validation', () => {
  let called = false;
  const getter = Object.defineProperty({}, 'private-test-value', {enumerable: true, get() {called = true; return 'private-path';}});
  const large = complete(); large.button.displayLabel = 'x'.repeat(1048576);
  for (const value of [getter, large, undefined, NaN, '\ud800']) {
    const result = gate.validate(value); assert.equal(result.code, 'PROBLEM_INPUT_INVALID'); assert.equal(result.ready, false);
    assert.doesNotMatch(JSON.stringify(result), /private-test-value|private-path|stack|manifestPath/);
  }
  assert.equal(called, false); assert.equal(gate.validate(validSubset(incomplete())).ok, true);
});

async function capture(t, manifest) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'PiRaiders problem fixture '));
  t.after(() => fs.rm(root, {recursive: true, force: true, maxRetries: 10, retryDelay: 100}));
  const base = fixtures(), bytes = Buffer.from(JSON.stringify(manifest, null, 2)), current = {...base.current};
  for (const key of ['feedId', 'epoch', 'selectionId', 'identityTuple', 'generation', 'generationSequence', 'manifestState', 'playbackFingerprint', 'metadataFingerprint']) current[key] = manifest[key];
  current.manifestPath = 'selections/' + manifest.selectionId + '/generations/' + manifest.generation + '/manifest.json'; current.manifestSha256 = sha(bytes);
  const descriptor = {selectionId: manifest.selectionId, identityTuple: manifest.identityTuple, origin: manifest.button.origin,
    targetBoardKey: manifest.board.boardKey, displayLabel: manifest.button.displayLabel, templateButtonKey: manifest.button.templateButtonKey,
    labelShared: false, occurrenceCount: manifest.occurrences.length};
  for (const key of ['generation', 'generationSequence', 'manifestPath', 'manifestSha256', 'playbackFingerprint', 'metadataFingerprint', 'manifestState']) descriptor[key] = current[key];
  base.catalog.events = [{...manifest.event, eventType: 'Synthetic type', homeSchool: 'Synthetic school', venue: 'Synthetic venue',
    playbackArea: 'Stadium Playback', boardOnly: true, eventBoard: manifest.board, selections: [descriptor]}];
  for (const [relative, value] of [['feed.json', base.feed], ['catalog.json', base.catalog], ['selections/' + manifest.selectionId + '/current.json', current], [current.manifestPath, bytes]]) {
    const file = path.join(root, ...relative.split('/')); await fs.mkdir(path.dirname(file), {recursive: true});
    await fs.writeFile(file, Buffer.isBuffer(value) ? value : JSON.stringify(value));
  }
  const reader = createExchangeMetadataReader({root, binding: {feedId: manifest.feedId, epoch: manifest.epoch, identityTuple: manifest.identityTuple}});
  t.after(() => reader.close()); return {reader, bytes};
}

test('real captured pin composes all four schemas, integrity and problem-state with no asset bytes', async t => {
  for (const source of [incomplete(), unresolved(), diagnostic('total_bytes')]) {
    const manifest = validSubset(source), fixture = await capture(t, manifest), captured = await fixture.reader.capture();
    assert.equal(captured.ok, true); assert.equal(captured.pin.documentDigests.manifest, sha(fixture.bytes));
    for (const [kind, key] of [['feed', 'feed'], ['catalog', 'catalog'], ['current', 'current'], ['selection', 'manifest']]) assert.equal(schema.validate(kind, captured.pin[key]).ok, true, kind);
    const result = gate.validate(captured.pin.manifest); assert.equal(result.ok, true); assert.equal(result.ready, false);
    assert.equal(fixture.reader.lastPin(), captured.pin);
  }
});

test('ordinary incomplete may associate every failed occurrence through the summary alone', () => {
  const source = incomplete();
  source.occurrences[1].problem = null;
  source.problems = [missing('ROW-2'), missing('ROW-3')];
  assert.equal(source.occurrences.every(row => row.problem === null), true);
  assert.equal(gate.validate(validSubset(source)).ok, true);
});

test('advertised BOARD diagnostic does not imply the converse that its event board key must be null', () => {
  const source = unresolved();
  source.board = {boardKey: 'BOARD-SYNTHETIC', displayName: 'Synthetic board'};
  source.identityTuple[2] = source.board.boardKey;
  assert.equal(gate.validate(validSubset(source)).ok, true);
});
