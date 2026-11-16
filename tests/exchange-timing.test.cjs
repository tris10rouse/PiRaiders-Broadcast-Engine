'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {fixtures} = require('./exchange-fixtures.cjs');
const {selectionId, selectionFingerprints} = require('../scripts/lib/exchange-fingerprints.cjs');
const {createExchangeProblemStateGate} = require('../scripts/lib/exchange-problem-state.cjs');
const {createExchangeSchemaGate} = require('../scripts/lib/exchange-schema-gate.cjs');
const {createExchangeMetadataReader} = require('../scripts/lib/exchange-metadata-reader.cjs');
const {createExchangeTimingGate} = require('../scripts/lib/exchange-timing.cjs');
const prerequisite = createExchangeProblemStateGate(), gate = createExchangeTimingGate(), schema = createExchangeSchemaGate();
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function seal(manifest) {
  manifest.selectionId = selectionId(manifest.identityTuple);
  const {playbackFingerprint, metadataFingerprint} = selectionFingerprints(manifest);
  Object.assign(manifest, {playbackFingerprint, metadataFingerprint});
  manifest.generation = 'e' + manifest.epoch + '-g' + String(manifest.generationSequence).padStart(10, '0') + '-' + metadataFingerprint.slice(0,12);
  return manifest;
}
function valid() {
  const manifest = fixtures().selection;
  manifest.event.eventDate = '2026-10-23';
  manifest.event.timing = {timeZone: 'America/Chicago',
    eventStartsAt: '2026-10-23T19:00:00-05:00', startSource: 'typed',
    eventEndsAt: '2026-10-23T22:00:00-05:00', endSource: 'typed',
    broadcastWindow: {startsAt: '2026-10-23T18:00:00-05:00', endsAt: '2026-10-23T23:45:00-05:00',
      startSource: 'event_type_lead_tail', endSource: 'event_type_fixed_end'},
    operatingWindow: null, unavailableReasons: []};
  return manifest;
}
function checked(manifest) {
  seal(manifest); assert.equal(prerequisite.validate(manifest).ok, true, 'earlier gates pass'); return manifest;
}
function reject(manifest, code) {
  checked(manifest); const before = clone(manifest), result = gate.validate(manifest);
  assert.equal(result.ok, false); assert.equal(result.code, code); assert.equal(result.ready, false);
  assert.equal(result.timingAvailable, false); assert.equal(result.operatorConfirmationRequired, true);
  assert.deepEqual(result.verifiedRules, []); assert.deepEqual(manifest, before);
}
function oneInstant(wire) {
  const manifest = valid(), timing = manifest.event.timing;
  manifest.event.eventDate = wire.slice(0,10); timing.eventStartsAt = wire;
  timing.eventEndsAt = null; timing.endSource = 'missing';
  timing.broadcastWindow = {startsAt: null, endsAt: null, startSource: 'missing', endSource: 'missing'};
  return manifest;
}

test('valid timing is immutable informational metadata, never a confirmed operating window or arming authority', () => {
  const manifest = checked(valid()), before = clone(manifest), result = gate.validate(manifest);
  assert.equal(result.ok, true); assert.equal(result.code, 'TIMING_VALID'); assert.equal(result.timingAvailable, true);
  assert.equal(result.ready, false); assert.equal(result.semanticValidation, 'pending'); assert.equal(result.operatorConfirmationRequired, true);
  assert.deepEqual(result.reviewFlags, []); assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.reviewFlags), true);
  assert.equal(Object.isFrozen(result.pending), true); assert.equal(Object.isFrozen(result.verifiedRules), true);
  assert.equal(manifest.event.timing.operatingWindow, null); assert.deepEqual(manifest, before);
});

test('the eight supplied local-instant vectors retain unique, missing and ambiguous distinctions', () => {
  // Data-only dates/expectations; no publisher conversion code is used.
  const vectors = [
    ['2026-11-01T01:30', 'AMBIGUOUS_LOCAL_TIME'],
    ['2026-11-01T00:59', '-05:00'], ['2026-11-01T02:00', '-06:00'],
    ['2026-03-08T02:30', 'NONEXISTENT_LOCAL_TIME'], ['2026-03-08T03:00', '-05:00'],
    ['2027-03-14T02:30', 'NONEXISTENT_LOCAL_TIME'],
    ['2026-10-23T19:00', '-05:00'], ['2026-12-05T19:00', '-06:00']
  ];
  for (const [local, expected] of vectors) {
    if (expected.startsWith('-')) {
      const result = gate.validate(checked(oneInstant(local + ':00' + expected)));
      assert.equal(result.ok, true); assert.equal(result.reviewFlags.includes('AMBIGUOUS_LOCAL_TIME'), false);
    } else for (const offset of ['-05:00','-06:00']) {
      const manifest = checked(oneInstant(local + ':00' + offset)), result = gate.validate(manifest);
      if (expected === 'NONEXISTENT_LOCAL_TIME') assert.equal(result.code, 'TIMING_INSTANT_INVALID');
      else { assert.equal(result.ok, true); assert.ok(result.reviewFlags.includes(expected)); assert.equal(result.timingAvailable, false); }
    }
  }
});

test('both correct fall-fold offsets preserve metadata but prevent unreviewed automatic timing availability', () => {
  for (const offset of ['-05:00','-06:00']) {
    const manifest = valid(); manifest.event.eventDate = '2026-11-01';
    const timing = manifest.event.timing;
    timing.eventStartsAt = '2026-11-01T01:30:00' + offset; timing.eventEndsAt = '2026-11-01T03:00:00-06:00';
    timing.broadcastWindow.startsAt = '2026-11-01T00:30:00-05:00'; timing.broadcastWindow.endsAt = '2026-11-01T04:00:00-06:00';
    const source = checked(manifest), before = clone(source), result = gate.validate(source);
    assert.equal(result.ok, true); assert.equal(result.timingAvailable, false);
    assert.deepEqual(result.reviewFlags, ['AMBIGUOUS_LOCAL_TIME']);
    assert.deepEqual(source.event.timing.unavailableReasons, []); assert.deepEqual(source, before);
  }
});

test('wrong seasonal offsets and explicit spring-gap instants fail after earlier schema/integrity gates', () => {
  for (const wire of ['2026-10-23T19:00:00-06:00','2026-12-05T19:00:00-05:00',
    '2026-03-08T02:30:00-05:00','2026-03-08T02:30:00-06:00']) reject(oneInstant(wire), 'TIMING_INSTANT_INVALID');
});

test('pattern-valid impossible eventDate remains accepted unavailable metadata without a new wire constraint', () => {
  for (const date of ['2026-02-29','2100-02-29','2026-04-31','2026-00-01']) {
    const manifest = valid(); manifest.event.eventDate = date;
    const before = clone(checked(manifest)), result = gate.validate(manifest);
    assert.equal(result.ok, true); assert.equal(result.code, 'TIMING_VALID');
    assert.equal(result.timingAvailable, false); assert.equal(result.ready, false); assert.equal(result.operatorConfirmationRequired, true);
    assert.deepEqual(result.reviewFlags, ['EVENT_DATE_INVALID']); assert.deepEqual(manifest, before);
    assert.deepEqual(manifest.event.timing.unavailableReasons, []);
  }
  for (const date of ['2028-02-29','2000-02-29','0000-02-29','0096-02-29']) {
    const manifest = valid(); manifest.event.eventDate = date;
    const result = gate.validate(checked(manifest)); assert.equal(result.ok, true); assert.equal(result.timingAvailable, true);
  }
  const malformed = valid(); malformed.event.eventDate = '2026-2-03'; seal(malformed);
  assert.equal(prerequisite.validate(malformed).ok, false); assert.equal(gate.validate(malformed).code, 'TIMING_PREREQUISITE_INVALID');
});

test('year0 through99 UTC construction is not remapped into the twentieth century', t => {
  const Original = Intl.DateTimeFormat, seen = [];
  t.mock.method(Intl, 'DateTimeFormat', function(...args) {
    const real = new Original(...args);
    return {resolvedOptions: () => real.resolvedOptions(), formatToParts(epoch) {seen.push(new Date(epoch).getUTCFullYear()); return real.formatToParts(epoch);}};
  });
  const localGate = createExchangeTimingGate();
  const result = localGate.validate(checked(oneInstant('0099-07-01T19:00:00-05:00')));
  // Historical Chicago local-mean time is not either permitted source offset;
  // the important regression is that Intl receives year99, never1999.
  assert.equal(result.ok, false); assert.ok(seen.length > 0); assert.ok(seen.every(year => year === 99));
});

test('event intervals must be positive; broadcast intervals must be positive and at most24 elapsed hours', () => {
  for (const mutate of [x => x.event.timing.eventEndsAt = x.event.timing.eventStartsAt,
    x => x.event.timing.eventEndsAt = '2026-10-23T18:00:00-05:00',
    x => x.event.timing.broadcastWindow.endsAt = x.event.timing.broadcastWindow.startsAt,
    x => x.event.timing.broadcastWindow.endsAt = '2026-10-23T17:00:00-05:00',
    x => x.event.timing.broadcastWindow.endsAt = '2026-10-24T18:00:01-05:00']) {
    const manifest = valid(); mutate(manifest); reject(manifest, 'TIMING_INTERVAL_INVALID');
  }
  const exactly = valid(); exactly.event.timing.broadcastWindow.endsAt = '2026-10-24T18:00:00-05:00';
  assert.equal(gate.validate(checked(exactly)).ok, true);
  const longEvent = valid(); longEvent.event.timing.eventEndsAt = '2026-10-25T22:00:00-05:00';
  assert.equal(gate.validate(checked(longEvent)).ok, true, 'no unstated event-duration cap or containment rule');
});

test('midnight, lead/tail and DST crossings use elapsed instant duration rather than wall-hour arithmetic', () => {
  const cases = [
    ['2026-10-23T23:00:00-05:00','2026-10-24T01:00:00-05:00',true],
    ['2026-03-07T18:00:00-06:00','2026-03-08T18:00:00-05:00',true], //23h
    ['2026-10-31T18:00:00-05:00','2026-11-01T18:00:00-06:00',false], //25h
    ['2026-10-31T18:00:00-05:00','2026-11-01T17:00:00-06:00',true] //24h
  ];
  for (const [start,end,ok] of cases) {
    const manifest = valid(); manifest.event.timing.broadcastWindow.startsAt = start; manifest.event.timing.broadcastWindow.endsAt = end;
    checked(manifest); const result = gate.validate(manifest); assert.equal(result.ok, ok);
    if (!ok) assert.equal(result.code, 'TIMING_INTERVAL_INVALID');
  }
});

test('fall-fold event and broadcast order follow UTC even when wall-clock order is reversed', () => {
  const positive = valid(), timing = positive.event.timing;
  positive.event.eventDate = '2026-11-01';
  timing.eventStartsAt = '2026-11-01T01:45:00-05:00'; timing.eventEndsAt = '2026-11-01T01:15:00-06:00';
  timing.broadcastWindow.startsAt = timing.eventStartsAt; timing.broadcastWindow.endsAt = timing.eventEndsAt;
  const accepted = gate.validate(checked(positive));
  assert.equal(accepted.ok, true); assert.equal(accepted.timingAvailable, false);
  assert.deepEqual(accepted.reviewFlags, ['AMBIGUOUS_LOCAL_TIME']); assert.equal(accepted.ready, false);
  const eventNegative = clone(positive);
  eventNegative.event.timing.eventStartsAt = '2026-11-01T01:15:00-06:00';
  eventNegative.event.timing.eventEndsAt = '2026-11-01T01:45:00-05:00';
  reject(eventNegative, 'TIMING_INTERVAL_INVALID');
  const broadcastNegative = clone(positive);
  broadcastNegative.event.timing.broadcastWindow.startsAt = '2026-11-01T01:15:00-06:00';
  broadcastNegative.event.timing.broadcastWindow.endsAt = '2026-11-01T01:45:00-05:00';
  reject(broadcastNegative, 'TIMING_INTERVAL_INVALID');
});

test('nullable dates/partial event times and source unavailable reasons remain honest accepted metadata', () => {
  const manifest = valid(); manifest.event.eventDate = null; manifest.event.timing.unavailableReasons = ['DATE_INVALID'];
  const before = clone(checked(manifest)), result = gate.validate(manifest);
  assert.equal(result.ok, true); assert.equal(result.timingAvailable, false); assert.deepEqual(manifest,before);
  for (const absent of ['eventStartsAt','eventEndsAt']) {
    const source = valid(); source.event.timing[absent] = null;
    source.event.timing[absent === 'eventStartsAt' ? 'startSource' : 'endSource'] = 'missing';
    source.event.timing.unavailableReasons = [absent === 'eventStartsAt' ? 'START_NOT_DEFINED' : 'END_NOT_DEFINED'];
    const supplied = clone(checked(source)), actual = gate.validate(source);
    assert.equal(actual.ok, true); assert.equal(actual.timingAvailable, false); assert.deepEqual(source,supplied);
    assert.notEqual(source.event.timing.broadcastWindow.startsAt,null); assert.notEqual(source.event.timing.broadcastWindow.endsAt,null);
  }
  const all = fixtures().selection; all.event.eventDate = null;
  assert.equal(gate.validate(checked(all)).ok,true); assert.equal(gate.validate(all).timingAvailable,false);
});

test('source-declared timing unavailability is preserved even when every instant is present and valid', () => {
  const source = valid(); source.event.timing.unavailableReasons = ['AMBIGUOUS_LOCAL_TIME'];
  const before = clone(checked(source)), result = gate.validate(source);
  assert.equal(result.ok,true); assert.equal(result.timingAvailable,false);
  assert.deepEqual(result.reviewFlags,['SOURCE_TIMING_UNAVAILABLE']); assert.deepEqual(source,before);
});

test('generic publication/revision timestamps keep their own RFC3339 grammar, not Chicago instant restrictions', () => {
  const manifest = valid(); manifest.generatedAt = '2026-10-23T19:00:00.123456+09:30';
  assert.equal(gate.validate(checked(manifest)).ok,true);
  // Include a referenced asset to exercise nullable revision date-time metadata.
  const withAsset = valid(); withAsset.manifestState = 'complete';
  withAsset.assets = [{assetKey:'a1',originalDriveId:'synthetic-id-0001',viaShortcutId:null,
    sourceRevision:{md5:null,size:null,modifiedTime:'2026-10-23T19:00:00.123456+09:30',headRevisionId:null},
    mimeType:'image/png',deliveryPath:'assets/'+'a'.repeat(64)+'.png',byteLength:1,sha256:'a'.repeat(64),width:1,height:1}];
  withAsset.occurrences = [{position:1,occurrenceKey:'ROW1',fileKey:'FILE1',assetKey:'a1',problem:null,sourceName:'Synthetic',lineage:null}];
  assert.equal(gate.validate(checked(withAsset)).ok,true);
});

test('schema continues to reject noncanonical source timestamp syntax, impossible instant calendars and non-null operating windows', () => {
  for (const wire of ['2026-10-23t19:00:00-05:00','2026-10-23T19:00-05:00','2026-10-23T19:00:00.1-05:00',
    '2026-10-23T19:00:00Z','2026-10-23T24:00:00-05:00','2026-10-23T19:60:00-05:00',
    '2026-10-23T19:00:60-05:00','2026-02-30T19:00:00-06:00']) {
    const manifest = oneInstant(wire); seal(manifest);
    assert.equal(prerequisite.validate(manifest).ok,false); assert.equal(gate.validate(manifest).code,'TIMING_PREREQUISITE_INVALID');
  }
  const confirmed = valid(); confirmed.event.timing.operatingWindow = {start:'2026-10-23T18:00:00-05:00',end:'2026-10-23T23:45:00-05:00'}; seal(confirmed);
  assert.equal(gate.validate(confirmed).code,'TIMING_PREREQUISITE_INVALID');
});

test('backend initialization/runtime failure is fixed, closed and never falls back to the host timezone', t => {
  const Original = Intl.DateTimeFormat;
  const constructorMock = t.mock.method(Intl,'DateTimeFormat',function(){throw Error('private-backend-path');});
  assert.throws(()=>createExchangeTimingGate(),{message:'TIMING_BACKEND_UNAVAILABLE'}); constructorMock.mock.restore();
  t.mock.method(Intl,'DateTimeFormat',function(...args){const real = new Original(...args);return {resolvedOptions:()=>real.resolvedOptions(),formatToParts(){throw Error('private-zone-data');}};});
  const broken = createExchangeTimingGate(), result = broken.validate(checked(valid()));
  assert.equal(result.code,'TIMING_BACKEND_UNAVAILABLE'); assert.equal(result.ready,false); assert.equal(result.timingAvailable,false);
  assert.doesNotMatch(JSON.stringify(result),/private-backend-path|private-zone-data|stack/);
});

test('one formatter is reused per gate and input/backend prerequisites fail without leaking source values', t => {
  const Original = Intl.DateTimeFormat; let constructions=0;
  t.mock.method(Intl,'DateTimeFormat',function(...args){constructions++;return new Original(...args);});
  const localGate = createExchangeTimingGate(); assert.equal(constructions,1);
  const source = checked(valid()); for(let n=0;n<3;n++)assert.equal(localGate.validate(source).ok,true); assert.equal(constructions,1);
  let called=false;const accessor=Object.defineProperty({},'private-source-value',{enumerable:true,get(){called=true;return'private';}});
  for(const value of [accessor,undefined,NaN,'\ud800']){const result=localGate.validate(value);assert.equal(result.code,'TIMING_INPUT_INVALID');assert.doesNotMatch(JSON.stringify(result),/private-source-value|stack/);}
  assert.equal(called,false); const forged=clone(source);forged.metadataFingerprint='f'.repeat(64);
  assert.equal(localGate.validate(forged).code,'TIMING_PREREQUISITE_INVALID');assert.equal(localGate.validate(source).ok,true);
});

async function capture(t, manifest) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders timing fixture '));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const base=fixtures(),bytes=Buffer.from(JSON.stringify(manifest,null,2)),current={...base.current};
  for(const key of ['feedId','epoch','selectionId','identityTuple','generation','generationSequence','manifestState','playbackFingerprint','metadataFingerprint'])current[key]=manifest[key];
  current.manifestPath='selections/'+manifest.selectionId+'/generations/'+manifest.generation+'/manifest.json';current.manifestSha256=hash(bytes);
  const descriptor={selectionId:manifest.selectionId,identityTuple:manifest.identityTuple,origin:manifest.button.origin,targetBoardKey:manifest.board.boardKey,
    displayLabel:manifest.button.displayLabel,templateButtonKey:manifest.button.templateButtonKey,labelShared:false,occurrenceCount:manifest.occurrences.length};
  for(const key of ['generation','generationSequence','manifestPath','manifestSha256','playbackFingerprint','metadataFingerprint','manifestState'])descriptor[key]=current[key];
  base.feed.createdAt='2026-10-01T12:00:00.123456+09:30';
  base.catalog.events=[{...manifest.event,eventType:'Synthetic type',homeSchool:'Synthetic school',venue:'Synthetic venue',playbackArea:'Stadium Playback',boardOnly:true,eventBoard:manifest.board,selections:[descriptor]}];
  for(const [relative,value]of [['feed.json',base.feed],['catalog.json',base.catalog],['selections/'+manifest.selectionId+'/current.json',current],[current.manifestPath,bytes]]){
    const file=path.join(root,...relative.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.isBuffer(value)?value:JSON.stringify(value));
  }
  const reader=createExchangeMetadataReader({root,binding:{feedId:manifest.feedId,epoch:manifest.epoch,identityTuple:manifest.identityTuple}});t.after(()=>reader.close());return{reader,bytes};
}

test('actual captured pin composes all four schemas through timing without confirming a window or opening assets',async t=>{
  const manifest=checked(valid()),fixture=await capture(t,manifest),captured=await fixture.reader.capture();assert.equal(captured.ok,true);
  for(const[kind,key]of [['feed','feed'],['catalog','catalog'],['current','current'],['selection','manifest']])assert.equal(schema.validate(kind,captured.pin[key]).ok,true,kind);
  assert.equal(captured.pin.documentDigests.manifest,hash(fixture.bytes));const result=gate.validate(captured.pin.manifest);
  assert.equal(result.ok,true);assert.equal(result.timingAvailable,true);assert.equal(result.ready,false);assert.equal(result.operatorConfirmationRequired,true);
  assert.equal(captured.pin.manifest.event.timing.operatingWindow,null);assert.equal(fixture.reader.lastPin(),captured.pin);
});
