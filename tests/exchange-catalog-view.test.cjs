'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path');
const {createExchangeCatalogReceiptGate, isExchangeCatalogReceipt} = require('../scripts/lib/exchange-catalog-receipt.cjs');
const {createExchangeCatalogView} = require('../scripts/lib/exchange-catalog-view.cjs');
const {selectionId} = require('../scripts/lib/exchange-fingerprints.cjs');
const {fixture,source,providerFor,profileFor,latch,until} = require('./exchange-provider-fixtures.cjs');
const {fixtures} = require('./exchange-fixtures.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const gate = createExchangeCatalogReceiptGate();
function entry(eventKey, n = 0, origin = 'event') {
  const identityTuple = ['2026-2027',eventKey,'BOARD-SYNTHETIC',origin,'button-'+n], id = selectionId(identityTuple);
  return {selectionId:id,identityTuple,origin,targetBoardKey:'BOARD-SYNTHETIC',displayLabel:'Same display label',
    templateButtonKey:origin==='season'?'button-'+n:null,labelShared:false,generation:'e1-g0000000001-'+'b'.repeat(12),
    generationSequence:1,manifestPath:'selections/'+id+'/generations/e1-g0000000001-'+'b'.repeat(12)+'/manifest.json',
    manifestSha256:'c'.repeat(64),playbackFingerprint:'d'.repeat(64),metadataFingerprint:'b'.repeat(64),occurrenceCount:0,manifestState:'empty'};
}
function event(key, count = 1) {
  return {...fixtures().selection.event,eventKey:key,displayName:'Same event label',eventType:'Synthetic',homeSchool:'Synthetic',
    venue:'Synthetic',playbackArea:'Stadium Playback',boardOnly:true,eventBoard:{boardKey:'BOARD-SYNTHETIC',displayName:'Synthetic board'},
    selections:Array.from({length:count},(_,i)=>entry(key,i))};
}
function documents(events = [event('EVENT-SYNTHETIC')]) { const f=fixtures(); return {feed:f.feed,catalog:{...f.catalog,events}}; }
function validate(d = documents(), tail = '') {return gate.validate({feedBytes:Buffer.from(JSON.stringify(d.feed)),
  catalogBytes:Buffer.from(JSON.stringify(d.catalog)+tail),expectedBinding:{feedId:d.feed.feedId,epoch:d.feed.epoch}});}
function view(d = documents()) {const r=validate(d);assert.equal(r.ok,true,r.code);return createExchangeCatalogView(r.receipt);}

test('only an owned validated receipt constructs a metadata-only view',()=>{
  const r=validate();assert.equal(r.ok,true);assert.equal(isExchangeCatalogReceipt(r.receipt),true);
  let calls=0;const accessor={};Object.defineProperty(accessor,'catalog',{get(){calls++;throw Error('PRIVATE');}});
  for(const raw of [null,{},clone(r.receipt),{...r.receipt},accessor])assert.throws(()=>createExchangeCatalogView(raw),{code:'CATALOG_VIEW_RECEIPT_INVALID'});
  assert.equal(calls,0);assert.equal(isExchangeCatalogReceipt(clone(r.receipt)),false);
  const v=createExchangeCatalogView(r.receipt),s=v.summary();assert.equal(s.ready,false);assert.ok(Object.isFrozen(s));
  const p=v.eventsPage({revision:s.revision});assert.equal(p.ok,true);assert.equal(p.events[0].timingProposal.operatingWindow,null);
  assert.equal(Object.hasOwn(p.events[0],'productionWindow'),false);
});

test('800 events and100 selections page without truncating200-codepoint labels or flattening identities',()=>{
  const d=documents(Array.from({length:800},(_,i)=>event('EVENT-'+i,i===0?100:1)));
  d.catalog.events[0].displayName='😀'.repeat(200);d.catalog.events[0].selections[0].displayLabel='🚀'.repeat(200);
  assert.ok(Buffer.byteLength(JSON.stringify(d.catalog))>1024*1024,'exercise catalog larger than canonicalizer whole-document cap');
  const v=view(d),revision=v.summary().revision,all=[];
  for(let offset=0;offset!==null;){const p=v.eventsPage({revision,offset,limit:64});assert.equal(p.ok,true);assert.ok(p.events.length<=64);all.push(...p.events);offset=p.nextOffset;}
  assert.equal(all.length,800);assert.equal(new Set(all.map(e=>e.eventKey)).size,800);assert.equal(all[0].displayName,d.catalog.events[0].displayName);
  const a=v.selectionsPage({revision,eventKey:'EVENT-0',limit:64}),b=v.selectionsPage({revision,eventKey:'EVENT-0',offset:a.nextOffset,limit:64});
  assert.equal(a.selections.length,64);assert.equal(b.selections.length,36);assert.equal(b.nextOffset,null);
  assert.equal(a.selections[0].displayLabel,d.catalog.events[0].selections[0].displayLabel);
  assert.deepEqual(a.selections[0].identityTuple,d.catalog.events[0].selections[0].identityTuple);
  const serialized=JSON.stringify(a);for(const key of ['manifestPath','manifestSha256','executable','sourceRoot','cacheDir'])assert.equal(serialized.includes('"'+key+'"'),false);
  assert.equal(a.ready,false);assert.ok(Object.isFrozen(a.selections[0].identityTuple));
});

test('same labels and event/season origins remain distinct and exact special event keys are safe',()=>{
  const e=event('__proto__');e.selections.push(entry(e.eventKey,0,'season'));
  const v=view(documents([e,event('SECOND')])),revision=v.summary().revision;
  assert.equal(v.eventsPage({revision}).events.length,2);
  const p=v.selectionsPage({revision,eventKey:'__proto__'});assert.equal(p.ok,true);assert.equal(p.selections.length,2);
  assert.notEqual(p.selections[0].selectionId,p.selections[1].selectionId);
  assert.equal(v.selectionsPage({revision,eventKey:'constructor'}).code,'CATALOG_EVENT_MISSING');
});

test('duplicate event headers must agree and merged selections remain bounded',()=>{
  const e=event('ONE'),d=documents([e,clone(e)]),v=view(d);assert.equal(v.summary().eventCount,1);
  assert.equal(v.eventsPage({revision:v.summary().revision}).events[0].selectionCount,1);
  for(const mutate of [x=>x.displayName='Conflicting',x=>x.eligibility={eligible:false,reasonCodes:['CANCELLED']},x=>x.eventBoard.displayName='Conflicting']){
    const changed=clone(d);mutate(changed.catalog.events[1]);assert.equal(validate(changed).code,'CATALOG_RECEIPT_CONTEXT_INVALID');
  }
  const first=event('ONE',100),second=event('ONE');second.selections=[entry('ONE',100)];
  assert.equal(validate(documents([first,second])).code,'CATALOG_RECEIPT_CONTEXT_INVALID');
});

test('revisions bind exact delivered bytes and all page inputs reject without accessors',()=>{
  const d=documents(),one=validate(d),two=validate(d,' '),a=createExchangeCatalogView(one.receipt),b=createExchangeCatalogView(two.receipt);
  assert.notEqual(a.summary().revision,b.summary().revision);
  assert.equal(b.eventsPage({revision:a.summary().revision}).code,'CATALOG_REVISION_STALE');
  const revision=a.summary().revision;
  for(const bad of [null,{},[],{revision,limit:0},{revision,limit:65},{revision,limit:1.5},{revision,offset:-1},
    {revision,offset:2},{revision,offset:Number.MAX_SAFE_INTEGER+1},{revision,extra:true},{revision,limit:Infinity}])assert.equal(a.eventsPage(bad).code,'CATALOG_QUERY_INVALID');
  let calls=0;const raw={revision};Object.defineProperty(raw,'limit',{enumerable:true,get(){calls++;return 1;}});
  assert.equal(a.eventsPage(raw).code,'CATALOG_QUERY_INVALID');assert.equal(calls,0);
  assert.equal(a.eventsPage({revision,offset:1}).events.length,0);
});

test('provider browse refresh needs catalog only, page reads are local, failure and close revoke the view',async t=>{
  const f=await fixture(t),m=source();await f.publish(m,{manifest:false,current:false,assets:false});const provider=providerFor(t,f);
  assert.equal(provider.catalogEventsPage({}).code,'CATALOG_UNAVAILABLE');
  const r=await provider.refreshCatalog();assert.equal(r.ok,true);assert.equal(r.catalog.ready,false);const revision=r.catalog.revision;
  await fs.rename(f.config.sourceRoot,path.join(f.parent,'offline-source'));
  assert.equal(provider.catalogEventsPage({revision}).events[0].eventKey,m.event.eventKey);
  assert.equal(provider.catalogSelectionsPage({revision,eventKey:m.event.eventKey}).selections[0].selectionId,m.selectionId);
  await assert.rejects(provider.refreshCatalog());assert.equal(provider.catalogState().available,false);
  assert.equal(provider.catalogEventsPage({revision}).code,'CATALOG_UNAVAILABLE');
  await fs.rename(path.join(f.parent,'offline-source'),f.config.sourceRoot);
  const recovered=await provider.refreshCatalog();assert.equal(recovered.ok,true);
  provider.close();assert.equal(provider.catalogEventsPage({revision:recovered.catalog.revision}).code,'PROVIDER_CLOSED');
});

test('provider busy and aborted refresh cannot expose a retained successful view',async t=>{
  const f=await fixture(t),m=source();await f.publish(m);const provider=providerFor(t,f);
  const first=await provider.refreshCatalog();const abort=new AbortController();abort.abort();
  await assert.rejects(provider.refreshCatalog({signal:abort.signal}));
  assert.equal(provider.catalogEventsPage({revision:first.catalog.revision}).code,'CATALOG_UNAVAILABLE');
  await provider.refreshCatalog();
  const held=latch(),open=fs.open;let entered=false;
  fs.open=async(file,...args)=>{if(file===path.join(f.config.sourceRoot,'catalog.json')){entered=true;await held.promise;}return open.call(fs,file,...args);};
  t.after(()=>{held.release();fs.open=open;});
  const controller=new AbortController(),pending=provider.refreshCatalog({signal:controller.signal});
  try{
    await until(()=>entered);
    assert.equal(provider.catalogEventsPage({revision:first.catalog.revision}).code,'BUSY');
    assert.equal(provider.catalogState().available,false);
    controller.abort();held.release();await assert.rejects(pending);
    assert.equal(provider.catalogEventsPage({revision:first.catalog.revision}).code,'CATALOG_UNAVAILABLE');
  }finally{held.release();fs.open=open;}
});

test('64-codepoint supplementary event keys remain selectable',()=>{
  const key='😀'.repeat(64),v=view(documents([event(key)])),revision=v.summary().revision;
  assert.equal(v.eventsPage({revision}).events[0].eventKey,key);
  const selected=v.selectionsPage({revision,eventKey:key});assert.equal(selected.ok,true,JSON.stringify(selected));
  assert.equal(selected.selections[0].identityTuple[1],key);
});

test('invalid refresh arguments revoke old browse authority without running getters',async t=>{
  for(const kind of ['null','getter'])await t.test(kind,async t=>{
    const f=await fixture(t),m=source();await f.publish(m,{manifest:false,current:false,assets:false});const provider=providerFor(t,f);
    await provider.refreshCatalog();let calls=0;const raw=kind==='null'?null:{};
    if(raw)Object.defineProperty(raw,'signal',{enumerable:true,get(){calls++;throw Error('PRIVATE_GETTER');}});
    await assert.rejects(Promise.resolve().then(()=>provider.refreshCatalog(raw)),{code:'PROVIDER_OPTIONS_INVALID'});
    assert.equal(calls,0);assert.equal(provider.catalogState().available,false);
  });
});

test('an earlier held refresh cannot restore a view after a newer rejected refresh',async t=>{
  const f=await fixture(t),m=source();await f.publish(m);const provider=providerFor(t,f),open=fs.open,held=latch();let entered=false;
  fs.open=async(file,...args)=>{if(file===path.join(f.config.sourceRoot,'catalog.json')){entered=true;await held.promise;}return open.call(fs,file,...args);};
  t.after(()=>{held.release();fs.open=open;});
  const first=provider.refreshCatalog().then(value=>({value}),error=>({error}));
  try{
    await until(()=>entered);await assert.rejects(provider.refreshCatalog(),{code:'BUSY'});
    held.release();const result=await first;
    assert.equal(result.error?.code,'CATALOG_REFRESH_SUPERSEDED');
    assert.equal(provider.catalogState().available,false);assert.equal(provider.catalogEventsPage({}).code,'CATALOG_UNAVAILABLE');
  }finally{held.release();fs.open=open;}
});
