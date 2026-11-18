'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {fixture,source,seal,copy,providerFor}=require('./exchange-provider-fixtures.cjs');
function timed(){const m=source();m.event.eventDate='2026-10-23';m.event.timing={timeZone:'America/Chicago',
  eventStartsAt:'2026-10-23T19:00:00-05:00',startSource:'typed',eventEndsAt:'2026-10-23T22:00:00-05:00',endSource:'typed',
  broadcastWindow:{startsAt:'2026-10-23T18:00:00-05:00',endsAt:'2026-10-23T23:45:00-05:00',startSource:'event_type_lead_tail',endSource:'event_type_fixed_end'},
  operatingWindow:null,unavailableReasons:[]};return seal(m);}
test('selected inspection returns frozen verified timing and identity without staging or source assets',async t=>{
  const f=await fixture(t),m=timed();await f.publish(m,{assets:false});const p=providerFor(t,f),open=fs.open;let assetReads=0;
  fs.open=async(file,...args)=>{if(typeof file==='string'&&file.startsWith(path.join(f.config.sourceRoot,'assets')+path.sep)){assetReads++;throw Error('ASSET_READ_FORBIDDEN');}return open.call(fs,file,...args);};
  t.after(()=>{fs.open=open;});
  const r=await p.inspectSelection(m.identityTuple),i=r.inspection;assert.equal(r.ok,true);assert.equal(r.admissionEligible,true);
  assert.equal(i.ready,false);assert.match(i.revision,/^[a-f0-9]{64}$/);assert.equal(i.timingProposal.available,true);
  assert.equal(i.timingProposal.operatorConfirmationRequired,true);assert.deepEqual(i.timingProposal.reviewFlags,[]);
  assert.deepEqual(i.timingProposal.broadcastWindow,m.event.timing.broadcastWindow);assert.equal(i.timeZone,'America/Chicago');
  assert.deepEqual(i.selection.identityTuple,m.identityTuple);assert.notEqual(i.selection.identityTuple,m.identityTuple);
  assert.deepEqual(i.sourceTicks,m.sourceTicks);assert.equal(i.selection.occurrenceCount,3);assert.equal(assetReads,0);
  for(const field of ['manifestPath','deliveryPath','sourceRoot','cacheDir','snapshotDir','executable','productionWindow'])assert.equal(JSON.stringify(i).includes('"'+field+'"'),false);
  assert.ok(Object.isFrozen(i)&&Object.isFrozen(i.selection)&&Object.isFrozen(i.selection.identityTuple)&&Object.isFrozen(i.timingProposal.reviewFlags));
  assert.throws(()=>{i.selection.identityTuple[1]='changed';},TypeError);
  assert.equal((await p.inspectSelection(m.identityTuple)).inspection.revision,i.revision);
  await assert.rejects(fs.stat(f.config.cacheDir),{code:'ENOENT'});
});
test('current-ahead inspection uses selected manifest timing and version rather than catalog summary',async t=>{
  const f=await fixture(t),a=timed(),published=await f.publish(a,{assets:false}),p=providerFor(t,f);
  const before=await p.inspectSelection(a.identityTuple),b=copy(a);b.generationSequence++;
  b.event.timing.broadcastWindow.startsAt='2026-10-23T17:00:00-05:00';b.event.displayName='New selected event';b.sourceTicks.onBoardAll=true;seal(b);
  await f.publish(b,{assets:false});await f.write('catalog.json',published.catalog);
  const refreshed=await p.refreshCatalog();assert.equal(refreshed.ok,true);
  const page=p.catalogEventsPage({revision:refreshed.catalog.revision});assert.equal(page.events[0].timingProposal.broadcastWindow.startsAt,a.event.timing.broadcastWindow.startsAt);
  const r=await p.inspectSelection(a.identityTuple);assert.equal(r.ok,true);assert.equal(r.inspection.selection.generationSequence,2);
  assert.equal(r.inspection.timingProposal.broadcastWindow.startsAt,b.event.timing.broadcastWindow.startsAt);
  assert.equal(r.inspection.event.displayName,b.event.displayName);assert.equal(r.inspection.sourceTicks.onBoardAll,true);
  assert.notEqual(r.inspection.revision,before.inspection.revision);assert.equal(r.inspection.selection.metadataFingerprint,b.metadataFingerprint);
});
test('missing timing stays an explicit review requirement and ineligibility is separate',async t=>{
  const f=await fixture(t),m=source();m.event.eligibility={eligible:false,reasonCodes:['CANCELLED']};seal(m);await f.publish(m,{assets:false});const p=providerFor(t,f);
  const r=await p.inspectSelection(m.identityTuple);assert.equal(r.ok,true);assert.equal(r.admissionEligible,false);
  assert.equal(r.inspection.ready,false);assert.equal(r.inspection.timingProposal.available,false);
  assert.equal(r.inspection.timingProposal.operatorConfirmationRequired,true);
  assert.ok(r.inspection.timingProposal.reviewFlags.includes('INSTANTS_UNAVAILABLE'));
  assert.equal(r.inspection.timingProposal.broadcastWindow.startsAt,null);
});
test('failed selected capture never exposes a stale inspection object or private exception',async t=>{
  const f=await fixture(t),m=timed();await f.publish(m,{assets:false});const p=providerFor(t,f);await p.inspectSelection(m.identityTuple);
  await fs.rename(f.config.sourceRoot,path.join(f.parent,'offline'));
  await assert.rejects(p.inspectSelection(m.identityTuple),error=>typeof error.code==='string'&&!error.message.includes(f.parent));
  const state=JSON.stringify(p.snapshot());assert.equal(state.includes('inspection'),false);assert.equal(state.includes(f.parent),false);
});

test('selected ambiguous fold timing carries its verified review flag without truncating full source labels',async t=>{
  const f=await fixture(t),m=timed();m.event.eventDate='2026-11-01';m.event.displayName='😀'.repeat(200);m.button.displayLabel='🚀'.repeat(200);
  m.event.timing.eventStartsAt='2026-11-01T01:30:00-05:00';m.event.timing.eventEndsAt='2026-11-01T03:00:00-06:00';
  m.event.timing.broadcastWindow.startsAt='2026-11-01T01:00:00-05:00';m.event.timing.broadcastWindow.endsAt='2026-11-01T03:30:00-06:00';seal(m);
  await f.publish(m,{assets:false});const r=await providerFor(t,f).inspectSelection(m.identityTuple);
  assert.equal(r.inspection.timingProposal.available,false);assert.ok(r.inspection.timingProposal.reviewFlags.includes('AMBIGUOUS_LOCAL_TIME'));
  assert.equal(r.inspection.event.displayName,m.event.displayName);assert.equal(r.inspection.selection.displayLabel,m.button.displayLabel);
  assert.equal(r.inspection.timingProposal.operatorConfirmationRequired,true);assert.equal(r.inspection.ready,false);
});
