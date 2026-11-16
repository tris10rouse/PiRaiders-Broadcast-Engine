'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {canonicalExchangeJSON, selectionId, selectionFingerprints} = require('../scripts/lib/exchange-fingerprints.cjs');
const sha = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
function manifest() {
 return {
  manifestState: 'complete', generation: 'first', generationSequence: 1,
  generatedAt: '2026-10-23T12:00:00Z', playbackFingerprint: 'untrusted', metadataFingerprint: 'untrusted',
  button: {displayLabel: 'Sponsors', generation: 'nested-kept'}, sourceTicks: {onBoardAll: false},
  occurrences: [
   {occurrenceKey: 'one', assetKey: 'a', problem: null},
   {occurrenceKey: 'two', assetKey: 'a', problem: null},
   {occurrenceKey: 'three', assetKey: null, problem: {code: 'MISSING', detail: 'metadata'}}
  ], assets: [{assetKey: 'a', sha256: 'a'.repeat(64)}]
 };
}
const invalid = action => assert.throws(action, {message: 'FINGERPRINT_INPUT_INVALID'});

test('canonical bytes use UTF16 key order, Unicode without normalization and JSON escapes', () => {
 const value = {'\ue000': 5, '\ud83d\ude00': 4, '\u20ac': 3, '1': 2, '\r': 1};
 assert.equal(canonicalExchangeJSON(value), '{"\\r":1,"1":2,"€":3,"😀":4,"":5}');
 assert.equal(canonicalExchangeJSON({'10': 10, '2': 2}), '{"10":10,"2":2}');
 assert.equal(canonicalExchangeJSON(['é', 'e\u0301', '\u0000\b\f\n\r\t"\\']), '["é","é","\\u0000\\b\\f\\n\\r\\t\\\"\\\\"]');
 assert.equal(canonicalExchangeJSON([-0, -9007199254740991, 9007199254740991]), '[0,-9007199254740991,9007199254740991]');
});

test('selection identity hashes the exact five string array bytes; no label normalization occurs here', () => {
 const tuple = ['2026-2027', 'EV0001', 'BD0001', 'event', 'senior night'];
 assert.equal(selectionId(tuple), 'sel_3b6e804167dd7442d2309b168ace265c');
 const changed = [...tuple]; changed[4] = 'Senior Night';
 assert.notEqual(selectionId(changed), selectionId(tuple));
 const unicodeTuple = [...tuple.slice(0,4), '😀'.repeat(200)];
 assert.equal(selectionId(unicodeTuple), 'sel_' + sha(JSON.stringify(unicodeTuple)).slice(0,32));
 for (const bad of [[], [...tuple, 'extra'], [1, ...tuple.slice(1)], [...tuple.slice(0,4), 'x'.repeat(1048576)]]) invalid(() => selectionId(bad));
});

test('playback hashes ordered occurrence triples resolved through assets, retaining repeated media', () => {
 const source = manifest(), before = clone(source), actual = selectionFingerprints(source);
 assert.equal(actual.playbackFingerprint, sha('{"occurrences":[["one","'+ 'a'.repeat(64) +'",null],["two","'+ 'a'.repeat(64) +'",null],["three",null,"MISSING"]],"state":"complete"}'));
 const projection = clone(source);
 for (const name of ['generation', 'generationSequence', 'generatedAt', 'playbackFingerprint', 'metadataFingerprint']) delete projection[name];
 assert.equal(actual.metadataFingerprint, sha(canonicalExchangeJSON(projection)));
 assert.deepEqual(source, before);
 assert.ok(Object.isFrozen(actual)); assert.equal(actual.ready, false); assert.equal(actual.semanticValidation, 'pending');
});

test('root generation fields do not alter fingerprints; metadata changes preserve playback hash', () => {
 const source = manifest(), original = selectionFingerprints(source);
 for (const field of ['generation','generationSequence','generatedAt','playbackFingerprint','metadataFingerprint']) {
  const changed = clone(source); changed[field] = field === 'generationSequence' ? 999 : 'changed';
  assert.deepEqual(selectionFingerprints(changed), original);
 }
 for (const mutate of [x => x.button.displayLabel = 'New label', x => x.sourceTicks.onBoardAll = true,
  x => x.button.generation = 'nested-changed', x => x.occurrences[2].problem.detail = 'new detail',
  x => x.assets[0].deliveryPath = 'new metadata']) {
  const changed = clone(source); mutate(changed); const actual = selectionFingerprints(changed);
  assert.equal(actual.playbackFingerprint, original.playbackFingerprint);
  assert.notEqual(actual.metadataFingerprint, original.metadataFingerprint);
 }
});

test('content, occurrence order, problem code and state changes affect playback independently', () => {
 const source = manifest(), original = selectionFingerprints(source);
 for (const mutate of [x => x.assets[0].sha256 = 'b'.repeat(64), x => x.occurrences.reverse(),
  x => x.occurrences.pop(), x => x.occurrences[2].problem.code = 'OTHER', x => x.manifestState = 'incomplete']) {
  const changed = clone(source); mutate(changed);
  assert.notEqual(selectionFingerprints(changed).playbackFingerprint, original.playbackFingerprint);
 }
 for (const state of ['empty', 'removed']) {
  const result = selectionFingerprints({manifestState: state, occurrences: [], assets: []});
  assert.equal(result.playbackFingerprint, sha('{"occurrences":[],"state":"'+state+'"}'));
  assert.equal(result.ready, false); // Neither state is an output Stop instruction.
 }
});

test('asset table order is metadata only and missing/duplicate references fail closed', () => {
 const source = manifest(); source.assets.push({assetKey: 'b', sha256: 'b'.repeat(64)});
 const original = selectionFingerprints(source); source.assets.reverse();
 assert.equal(selectionFingerprints(source).playbackFingerprint, original.playbackFingerprint);
 assert.notEqual(selectionFingerprints(source).metadataFingerprint, original.metadataFingerprint);
 for (const mutate of [x => x.assets.push(clone(x.assets[0])), x => x.assets[0].sha256 = 'A'.repeat(64),
  x => x.occurrences[0].assetKey = 'missing', x => delete x.occurrences[0].assetKey,
  x => delete x.occurrences[0].problem, x => x.occurrences[0].problem = {}]) {
  const changed = clone(manifest()); mutate(changed); invalid(() => selectionFingerprints(changed));
 }
});

test('non-JSON values, unsafe integers and malformed Unicode are rejected with fixed diagnostics', () => {
 for (const value of [undefined, 1n, NaN, Infinity, 0.5, 9007199254740992, -9007199254740992,
  new Date(), /x/, () => {}, '\ud800', '\udc00', {'\ud800': 1}]) invalid(() => canonicalExchangeJSON(value));
 const cyclic = {}; cyclic.self = cyclic; invalid(() => canonicalExchangeJSON(cyclic));
 const shared = {x: 1}; assert.equal(canonicalExchangeJSON([shared, shared]), '[{"x":1},{"x":1}]');
 const nullPrototype = Object.create(null); nullPrototype.__proto__ = 'data';
 assert.equal(canonicalExchangeJSON(nullPrototype), '{"__proto__":"data"}');
});

test('accessors, custom toJSON, sparse arrays and extra properties cannot hide hash input', () => {
 let called = false;
 const accessor = Object.defineProperty({}, 'secret', {enumerable: true, get() {called = true; return 'private';}});
 invalid(() => canonicalExchangeJSON(accessor)); assert.equal(called, false);
 invalid(() => canonicalExchangeJSON({toJSON() {called = true; return {};}})); assert.equal(called, false);
 for (const value of [Array(1), Object.assign([], {extra: 1}), Object.defineProperty({}, 'hidden', {value: 1}), {[Symbol('key')]: 1}]) invalid(() => canonicalExchangeJSON(value));
 const source = manifest(); source.generation = accessor; invalid(() => selectionFingerprints(source));
});

test('depth, node and UTF8 serialized byte limits apply before computing any fingerprints', () => {
 let deep = null; for (let i = 0; i < 33; i++) deep = [deep]; invalid(() => canonicalExchangeJSON(deep));
 invalid(() => canonicalExchangeJSON(Array(300000).fill(null)));
 assert.equal(Buffer.byteLength(canonicalExchangeJSON('x'.repeat(1048574))), 1048576);
 invalid(() => canonicalExchangeJSON('x'.repeat(1048575)));
 invalid(() => canonicalExchangeJSON('é'.repeat(524288)));
 const source = manifest(); source.generation = 'x'.repeat(1048576); invalid(() => selectionFingerprints(source));
});
