'use strict';
// BE-006 slice 3b: the source catalog service built from a loader-made source
// machine. All identities, paths, labels and selections are synthetic.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {loadGameDayMachineConfig}=require('../scripts/lib/game-day-catalog.cjs');
const {createExchangeApprovalStore}=require('../scripts/lib/exchange-approval-store.cjs');
const {createExchangeSourceService}=require('../scripts/lib/exchange-source-service.cjs');
const {isExchangePreparedMedia,admitExchangeCandidate}=require('../scripts/lib/exchange-source-provider.cjs');
const {createExchangeSourceCoordinator}=require('../scripts/lib/exchange-source-coordinator.cjs');
const {fixture,source,seal,profileFor,latch,copy}=require('./exchange-provider-fixtures.cjs');

async function machineFor(f,{mediaRoot=f.config.sourceRoot,expectedCanonicalRoot=f.config.sourceRoot,edit=raw=>raw}={}){
  const raw={schemaVersion:1,spxConfigFile:'config/spx.json',catalogDirectory:path.join(f.parent,'catalog'),
    mediaRoot,cacheRoot:f.config.cacheDir,runtimeRoot:path.join(f.parent,'runtime'),
    caspar:{executable:path.join(f.parent,'components','casparcg.exe'),cwd:path.join(f.parent,'components')},output:{type:'none'},
    rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}},
    source:{providerId:'approved-feed',journalDirectory:f.config.journalDir,journalStoreId:f.config.storeId,
      approvalDirectory:path.join(f.parent,'private','approvals'),approvalStoreId:crypto.randomUUID(),
      expectedCanonicalRoot,binding:copy(f.config.binding)}};
  const file=path.join(f.parent,'machine-'+crypto.randomUUID()+'.json');
  await fs.writeFile(file,JSON.stringify(edit(raw)));
  return loadGameDayMachineConfig(file,{appRoot:f.parent,nodeExecutable:process.execPath});
}
function serviceFor(t,machine,trusted){const service=createExchangeSourceService(machine,trusted);t.after(()=>service.close());return service;}
async function approvals(machine){
  const store=createExchangeApprovalStore();await fs.mkdir(path.dirname(machine.source.approvalDirectory),{recursive:true});
  const head=await store.initialize(machine.source.approvalDirectory,machine.source.approvalStoreId);assert.equal(head.ok,true,head.code);
  return async approval=>{const h=await store.open(machine.source.approvalDirectory,machine.source.approvalStoreId);assert.equal(h.ok,true);
    const next=await store.append(machine.source.approvalDirectory,{expectedStoreId:machine.source.approvalStoreId,expectedRevision:h.revision,expectedHeadSha256:h.headSha256,approval});
    assert.equal(next.ok,true,next.code);};
}
function confirmFor(service,machine,profile,extra={}){return{type:'confirm',providerId:'approved-feed',machinePolicyFingerprint:service.policyFingerprint,
  binding:copy(machine.source.binding),identityTuple:[...profile.media.identityTuple],productionWindow:copy(profile.productionWindow),offline:null,confirmation:true,...extra};}
function noPaths(value,f){const text=JSON.stringify(value);for(const p of [f.parent,f.config.sourceRoot,f.config.cacheDir,f.config.journalDir])assert.equal(text.includes(p),false,'no private path');}

test('the service is built only from a loader-made source machine and owns one provider per machine',async t=>{
  const f=await fixture(t),machine=await machineFor(f);
  assert.throws(()=>createExchangeSourceService({...machine}),{code:'SOURCE_SERVICE_MACHINE_INVALID'});
  assert.throws(()=>createExchangeSourceService(JSON.parse(JSON.stringify(machine))),{code:'SOURCE_SERVICE_MACHINE_INVALID'});
  const local=await machineFor(f,{edit:raw=>{const copyRaw={...raw};delete copyRaw.source;return copyRaw;}});
  assert.throws(()=>createExchangeSourceService(local),{code:'SOURCE_SERVICE_MACHINE_INVALID'});
  assert.throws(()=>createExchangeSourceService(machine,{createCoordinator:()=>null}),{code:'SOURCE_SERVICE_OPTIONS_INVALID'});
  assert.throws(()=>createExchangeSourceService(machine,{realpath:'no'}),{code:'SOURCE_SERVICE_OPTIONS_INVALID'});
  const first=serviceFor(t,machine);
  assert.match(first.policyFingerprint,/^[0-9a-f]{64}$/);
  assert.throws(()=>createExchangeSourceService(machine),{code:'PROVIDER_ALREADY_OPEN'},'one live owner per private boundary');
  const status=first.status();
  assert.deepEqual(JSON.parse(JSON.stringify(status)),{scope:'exchange-source-service',ready:false,providerId:'approved-feed',closed:false,
    catalog:{available:false,code:'CATALOG_NOT_READ'},provider:{busy:false,closed:false,observationRevision:0},
    approvals:{read:false,revision:null,code:'APPROVAL_NOT_READ',rolledBack:false,closed:false},preparation:{code:null}});
  first.close();first.close();
  assert.equal(first.status().closed,true);assert.equal(first.status().approvals.closed,true);
  const second=serviceFor(t,machine);assert.equal(second.status().closed,false,'closing the first frees the boundary');
  assert.deepEqual(await first.refreshCatalog(),{ok:false,ready:false,code:'SOURCE_SERVICE_CLOSED'});
  await assert.rejects(first.preparedMedia(profileFor(f,source())),{code:'SOURCE_SERVICE_CLOSED'});
});

test('catalog pages exist only after this service refreshed against the retained source root',async t=>{
  const f=await fixture(t),m=source();await f.publish(m);
  const service=serviceFor(t,await machineFor(f));
  assert.equal(service.catalogEventsPage({revision:'0'.repeat(64)}).code,'CATALOG_UNAVAILABLE');
  assert.deepEqual(service.catalogState(),{available:false,catalog:null});
  assert.equal((await service.refreshCatalog({signal:'not a signal'})).code,'SOURCE_SERVICE_OPTIONS_INVALID');
  assert.equal((await service.refreshCatalog({extra:true})).code,'SOURCE_SERVICE_OPTIONS_INVALID');
  const refreshed=await service.refreshCatalog();
  assert.equal(refreshed.ok,true,refreshed.code);assert.equal(refreshed.ready,false);
  const revision=refreshed.catalog.revision;assert.match(revision,/^[0-9a-f]{64}$/);
  const events=service.catalogEventsPage({revision});assert.equal(events.ok,true);assert.equal(events.ready,false);
  assert.equal(events.events.length,1);assert.equal(events.events[0].eventKey,m.event.eventKey);
  const selections=service.catalogSelectionsPage({revision,eventKey:m.event.eventKey});
  assert.equal(selections.ok,true);assert.deepEqual(selections.selections.map(s=>s.identityTuple),[m.identityTuple]);
  assert.equal(selections.selections[0].displayLabel,m.button.displayLabel,'full source label');
  assert.equal(service.catalogState().available,true);assert.equal(service.status().catalog.available,true);
  assert.equal(service.catalogEventsPage({revision:'1'.repeat(64)}).code,'CATALOG_REVISION_STALE');
  assert.equal(service.catalogEventsPage({revision,limit:65}).code,'CATALOG_QUERY_INVALID');
  noPaths([refreshed,events,selections,service.status()],f);
  const inspected=await service.inspectSelection(m.identityTuple);
  assert.equal(inspected.ok,true,inspected.code);assert.equal(inspected.inspection.ready,false);
  assert.equal(inspected.inspection.selection.displayLabel,m.button.displayLabel);noPaths(inspected,f);
  assert.equal((await service.inspectSelection(m.identityTuple,{signal:1})).code,'SOURCE_SERVICE_OPTIONS_INVALID');
  assert.equal((await service.inspectSelection(['not','a','tuple'])).ok,false,'a malformed tuple is a denial, not a throw');
  service.close();
  assert.equal(service.catalogEventsPage({revision}).code,'SOURCE_SERVICE_CLOSED');assert.deepEqual(service.catalogState(),{available:false,catalog:null});
  assert.equal((await service.inspectSelection(m.identityTuple)).code,'SOURCE_SERVICE_CLOSED');
});

test('a source folder that no longer resolves to the retained spelling is refused before any source read',async t=>{
  const f=await fixture(t),m=source();await f.publish(m);
  const elsewhere=path.join(f.parent,'retained elsewhere');
  const wrong=serviceFor(t,await machineFor(f,{expectedCanonicalRoot:elsewhere}),{provider:{createCoordinator:()=>{throw Error('SOURCE_MUST_NOT_BE_READ');}}});
  assert.deepEqual(await wrong.refreshCatalog(),{ok:false,ready:false,code:'SOURCE_ROOT_MISMATCH'});
  assert.equal(wrong.status().catalog.code,'SOURCE_ROOT_MISMATCH');
  assert.deepEqual(await wrong.inspectSelection(m.identityTuple),{ok:false,ready:false,code:'SOURCE_ROOT_MISMATCH'});
  await assert.rejects(wrong.preparedMedia(profileFor(f,m)),{code:'SOURCE_ROOT_MISMATCH'});
  wrong.close();
  // A good view is withdrawn the moment a later refresh sees another folder.
  let redirect=null;const service=serviceFor(t,await machineFor(f),{realpath:async p=>redirect??fs.realpath(p)});
  assert.equal((await service.refreshCatalog()).ok,true);const revision=service.catalogState().catalog.revision;
  redirect=elsewhere;
  assert.equal((await service.refreshCatalog()).code,'SOURCE_ROOT_MISMATCH');
  assert.equal(service.catalogEventsPage({revision}).code,'CATALOG_UNAVAILABLE','the provider still holds a view; the service does not hand it out');
  redirect=null;assert.equal((await service.refreshCatalog()).ok,true);
  await fs.rename(f.config.sourceRoot,path.join(f.parent,'disconnected-source'));
  assert.equal((await service.refreshCatalog()).code,'SOURCE_UNAVAILABLE');
  assert.equal(service.catalogState().available,false);
});

// 5b-2 (SOURCE_MACHINE_POLICY.md › Linked source root): a configured alias
// that resolves to the retained spelling is read through that spelling.
test('a linked alias that resolves to the retained spelling is read through that spelling',async t=>{
  const f=await fixture(t),m=source();await f.publish(m);
  const alias=path.join(f.parent,'source alias');await fs.symlink(f.config.sourceRoot,alias,'junction');
  let seen=null;const machine=await machineFor(f,{mediaRoot:alias});await approvals(machine);
  const service=serviceFor(t,machine,{realpath:async p=>(seen=await fs.realpath(p))});
  const refreshed=await service.refreshCatalog();
  assert.equal(seen,f.config.sourceRoot,'the alias resolves to the retained spelling');
  assert.equal(refreshed.ok,true,refreshed.code);assert.equal(service.catalogState().available,true);
  const review=await service.reviewSelection([...m.identityTuple]);noPaths(review,f);
  assert.equal(review.ok,true,review.code);
  const driver=await service.preparedMedia(profileFor(f,m));
  try{const prepared=await driver.initial();assert.equal(typeof prepared.snapshotDir,'string','media are staged through the canonical spelling');}finally{driver.close();}
  // The root check still runs on the alias: pointed elsewhere, it refuses.
  const elsewhere=path.join(f.parent,'other source');await fs.mkdir(elsewhere);
  await fs.unlink(alias);await fs.symlink(elsewhere,alias,'junction');
  assert.equal((await service.refreshCatalog()).code,'SOURCE_ROOT_MISMATCH');
  assert.equal(service.catalogState().available,false);
});
test('an alias does not weaken the reader\'s no-link rule inside the source',async t=>{
  const f=await fixture(t),m=source();await f.publish(m);
  const alias=path.join(f.parent,'source alias');await fs.symlink(f.config.sourceRoot,alias,'junction');
  const catalog=path.join(f.config.sourceRoot,'catalog.json'),moved=path.join(f.parent,'catalog-elsewhere.json');
  await fs.rename(catalog,moved);await fs.symlink(moved,catalog,'file');
  const service=serviceFor(t,await machineFor(f,{mediaRoot:alias}));
  assert.deepEqual(await service.refreshCatalog(),{ok:false,ready:false,code:'UNSAFE_INPUT'});
  assert.equal(service.catalogState().available,false);
});

test('only the newest refresh grants browsing; close withdraws it at once',async t=>{
  const f=await fixture(t),m=source();await f.publish(m);
  const holds=[];let holdNext=false;
  let reads=0;const createCoordinator=config=>{const real=createExchangeSourceCoordinator(config);
    return Object.freeze({...real,refreshCatalog:options=>{reads++;return real.refreshCatalog(options);}});};
  const service=serviceFor(t,await machineFor(f),{provider:{createCoordinator},realpath:async p=>{if(holdNext){const l=latch();holds.push(l);await l.promise;}return fs.realpath(p);}});
  holdNext=true;const older=service.refreshCatalog();holdNext=false;
  const newer=await service.refreshCatalog();assert.equal(newer.ok,true,newer.code);
  holds[0].release();assert.equal((await older).code,'CATALOG_REFRESH_SUPERSEDED');
  assert.equal(reads,1,'an overtaken refresh stops before reading the source');
  assert.equal(service.catalogState().available,true,'the older result does not take away the newer view');
  // An older refresh that is already inside the provider and succeeds after a
  // newer one began grants nothing.
  const done=service.refreshCatalog();holdNext=true;const pending=service.refreshCatalog();holdNext=false;
  assert.equal((await done).code,'CATALOG_REFRESH_SUPERSEDED');assert.equal(service.catalogState().available,false);
  holds[1].release();assert.equal((await pending).ok,true);assert.equal(service.catalogState().available,true);
  holdNext=true;const closing=service.refreshCatalog();holdNext=false;service.close();holds[2].release();
  assert.equal((await closing).code,'SOURCE_SERVICE_CLOSED');assert.equal(service.status().catalog.available,false);
});

test('a refresh overtaken while the provider is reading grants nothing when it finishes',async t=>{
  const f=await fixture(t),m=source();await f.publish(m);
  let gate=null;const entered=latch();
  const createCoordinator=config=>{const real=createExchangeSourceCoordinator(config);
    return Object.freeze({...real,refreshCatalog:async options=>{if(gate){entered.release();await gate.promise;}return real.refreshCatalog(options);}});};
  const holds=[];let holdNext=false;
  const service=serviceFor(t,await machineFor(f),{provider:{createCoordinator},
    realpath:async p=>{if(holdNext){const l=latch();holds.push(l);await l.promise;}return fs.realpath(p);}});
  gate=latch();const older=service.refreshCatalog();await entered.promise;
  holdNext=true;const newer=service.refreshCatalog();holdNext=false;
  const held=gate;gate=null;held.release();
  assert.equal((await older).code,'CATALOG_REFRESH_SUPERSEDED');
  assert.equal(service.catalogState().available,false,'the provider has a view; the service does not grant it');
  holds[0].release();assert.equal((await newer).ok,true);assert.equal(service.catalogState().available,true);
});

test('a refresh that overtakes one still inside the provider waits for it and then reads; one of the two succeeds',async t=>{
  // Q-005: the newer refresh reached the provider while the older held its one
  // slot; the provider answered BUSY, the older then found itself overtaken,
  // and neither granted a catalog.
  const f=await fixture(t),m=source();await f.publish(m);
  let gate=null,reads=0,entered=latch();
  const createCoordinator=config=>{const real=createExchangeSourceCoordinator(config);
    return Object.freeze({...real,refreshCatalog:async options=>{reads++;if(gate){entered.release();await gate.promise;}return real.refreshCatalog(options);}});};
  const service=serviceFor(t,await machineFor(f),{provider:{createCoordinator}});
  gate=latch();const older=service.refreshCatalog();await entered.promise;
  const newer=service.refreshCatalog();
  for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads,1,'the newer refresh does not reach the provider while the older holds it');
  const held=gate;gate=null;held.release();
  const answers=[await older,await newer];
  assert.deepEqual(answers.map(a=>a.ok?'ok':a.code),['CATALOG_REFRESH_SUPERSEDED','ok']);
  assert.equal(reads,2,'the newer refresh read the source itself');
  assert.equal(service.catalogState().available,true);assert.equal(service.status().catalog.code,null);
  // A third refresh that arrives while the second waits overtakes it before it reads.
  gate=latch();entered=latch();const first=service.refreshCatalog();await entered.promise;
  const second=service.refreshCatalog();for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
  const third=service.refreshCatalog();
  const g=gate;gate=null;g.release();
  assert.deepEqual([await first,await second,await third].map(a=>a.ok?'ok':a.code),['CATALOG_REFRESH_SUPERSEDED','CATALOG_REFRESH_SUPERSEDED','ok']);
  assert.equal(reads,4,'the overtaken waiting refresh never read the source');
  // Close while a refresh waits: it stops with the closed code and reads nothing.
  gate=latch();entered=latch();const running=service.refreshCatalog();await entered.promise;
  const waiting=service.refreshCatalog();for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
  service.close();const g2=gate;gate=null;g2.release();
  assert.equal((await waiting).code,'SOURCE_SERVICE_CLOSED');
  assert.equal((await running).code,'SOURCE_SERVICE_CLOSED');
  assert.equal(reads,5,'the waiting refresh read nothing after close');assert.equal(service.status().catalog.available,false);
});

test('manager hooks and prepared media use this machine\'s approvals, reread every time',async t=>{
  const f=await fixture(t),m=source();await f.publish(m);
  const machine=await machineFor(f),append=await approvals(machine),service=serviceFor(t,machine);
  const profile=profileFor(f,m),context=Object.freeze({profile});
  assert.equal(service.admission.admitCandidate(context),false,'nothing read yet');
  assert.equal(await service.admission.refreshAdmission(context),false,'no approval');
  await append(confirmFor(service,machine,profile));
  assert.equal(await service.admission.refreshAdmission(context),true);assert.equal(service.admission.admitCandidate(context),true);
  assert.equal(service.status().approvals.read,true);
  const driver=await service.preparedMedia(profile);assert.equal(isExchangePreparedMedia(driver,profile),true);
  await driver.initial();assert.equal(admitExchangeCandidate(driver.admissionToken(),profile),true);
  await append({type:'revoke',providerId:'approved-feed',binding:copy(machine.source.binding),identityTuple:[...m.identityTuple],confirmation:true});
  assert.equal(await service.refreshApprovals(),true);assert.equal(service.admission.admitCandidate(context),false,'revocation reaches the manager hook');
  await assert.rejects(service.preparedMedia({...profile,provider:'local-manual'}),{code:'SOURCE_SERVICE_PROFILE_INVALID'});
  driver.close();
});

test('cached startup through the service rereads approvals and never touches the source',async t=>{
  const f=await fixture(t),m=source();await f.publish(m);
  const staged=await f.coordinator.prepareSelection(m.identityTuple);assert.equal(staged.ok,true);f.coordinator.close();
  const machine=await machineFor(f),append=await approvals(machine);
  const service=serviceFor(t,machine,{provider:{createCoordinator:()=>{throw Error('OFFLINE_SOURCE_FORBIDDEN');}},
    realpath:async()=>{throw Error('OFFLINE_SOURCE_FORBIDDEN');}});
  const snapshotId=path.basename(staged.prepared.snapshotDir),profile=profileFor(f,m);
  profile.media.startup={mode:'cached',snapshotId,playbackFingerprint:m.playbackFingerprint};
  await fs.rename(f.config.sourceRoot,path.join(f.parent,'disconnected-source'));
  await append(confirmFor(service,machine,profile));
  await assert.rejects((await service.preparedMedia(profile)).initial(),{code:'OFFLINE_AUTHORIZATION_REQUIRED'},'online-only approval');
  await append(confirmFor(service,machine,profile,{offline:{snapshotId,playbackFingerprint:m.playbackFingerprint}}));
  // No explicit refreshApprovals(): preparedMedia rereads the store itself.
  const driver=await service.preparedMedia(profile),prepared=await driver.initial();
  assert.equal(prepared.snapshotDir,staged.prepared.snapshotDir);assert.equal(admitExchangeCandidate(driver.admissionToken(),profile),true);
  driver.close();
});

// Item 4c: the PC confirmation writes through the service and the manager
// hooks see it; review, confirm and revoke are path-free.
test('confirm and revoke write this machine\'s approval store and reach the manager hooks',async t=>{
  const f=await fixture(t),m=source();await f.publish(m);
  const machine=await machineFor(f);await approvals(machine);const service=serviceFor(t,machine);
  const profile=profileFor(f,m),context=Object.freeze({profile}),tuple=[...m.identityTuple];
  const review=await service.reviewSelection(tuple);noPaths(review,f);
  assert.equal(review.ok,true,review.code);assert.equal(review.ready,false);assert.equal(review.admissionEligible,true);
  assert.deepEqual(JSON.parse(JSON.stringify(review.approval)),{read:true,code:null,revision:0,record:null});
  const revision=review.inspection.revision;
  // Requests are exact; a bad window or an old inspection writes nothing.
  for(const bad of [undefined,{identityTuple:tuple,inspectionRevision:revision},{identityTuple:tuple.slice(0,4),inspectionRevision:revision,productionWindow:profile.productionWindow},
    {identityTuple:tuple,inspectionRevision:'X',productionWindow:profile.productionWindow},{identityTuple:tuple,inspectionRevision:revision,productionWindow:profile.productionWindow,extra:1}])
    assert.equal((await service.confirmSelection(bad)).code,'APPROVAL_REQUEST_INVALID');
  for(const window of [{start:profile.productionWindow.end,end:profile.productionWindow.start,prewarmMinutes:15},{start:'2026-11-17T00:00:00Z',end:'2026-11-18T00:00:01Z',prewarmMinutes:15},
    {start:'2026-11-17 00:00',end:'2026-11-17T23:00:00Z'},{...profile.productionWindow,prewarmMinutes:61},{...profile.productionWindow,other:1}])
    assert.equal((await service.confirmSelection({identityTuple:tuple,inspectionRevision:revision,productionWindow:window})).code,'APPROVAL_WINDOW_INVALID');
  assert.equal((await service.confirmSelection({identityTuple:tuple,inspectionRevision:'0'.repeat(64),productionWindow:profile.productionWindow})).code,'APPROVAL_INSPECTION_STALE');
  assert.equal((await service.reviewSelection(tuple)).approval.revision,0,'nothing was written');
  assert.equal(await service.admission.refreshAdmission(context),false);
  // A window given with an offset is saved in normal form and still matches.
  const confirmed=await service.confirmSelection({identityTuple:tuple,inspectionRevision:revision,productionWindow:{start:'2026-11-16T18:00:00-06:00',end:'2026-11-17T17:00:00-06:00',prewarmMinutes:15}});
  assert.equal(confirmed.ok,true,confirmed.code);assert.equal(confirmed.changed,true);assert.equal(confirmed.revision,1);noPaths(confirmed,f);
  assert.deepEqual(JSON.parse(JSON.stringify(confirmed.approval)),{productionWindow:{start:'2026-11-17T00:00:00.000Z',end:'2026-11-17T23:00:00.000Z',prewarmMinutes:15},current:true,offlinePinned:false});
  assert.equal(service.admission.admitCandidate(context),true,'the write was reread at once');
  assert.equal(await service.admission.refreshAdmission(context),true);
  assert.equal(await service.admission.refreshAdmission({profile:{...profile,productionWindow:{...profile.productionWindow,prewarmMinutes:10}}}),false,'only the confirmed window');
  const again=await service.confirmSelection({identityTuple:tuple,inspectionRevision:revision,productionWindow:profile.productionWindow});
  assert.equal(again.ok,true);assert.equal(again.changed,false,'the same confirmation adds no record');assert.equal(again.revision,1);
  assert.equal((await service.reviewSelection(tuple)).approval.record.current,true);
  // Revoke never reads the source: it works with the folder gone.
  await fs.rename(f.config.sourceRoot,path.join(f.parent,'disconnected-source'));
  assert.equal((await service.reviewSelection(tuple)).code,'SOURCE_UNAVAILABLE');
  assert.equal((await service.confirmSelection({identityTuple:tuple,inspectionRevision:revision,productionWindow:profile.productionWindow})).code,'SOURCE_UNAVAILABLE');
  const revoked=await service.revokeSelection({identityTuple:tuple});
  assert.equal(revoked.ok,true,revoked.code);assert.equal(revoked.changed,true);assert.equal(revoked.approval,null);assert.equal(revoked.revision,2);
  assert.equal(service.admission.admitCandidate(context),false,'revocation withdraws admission at once');
  assert.equal((await service.revokeSelection({identityTuple:tuple})).changed,false,'nothing left to revoke');
  assert.equal((await service.revokeSelection({identityTuple:tuple,extra:1})).code,'APPROVAL_REQUEST_INVALID');
  service.close();
  for(const value of [await service.reviewSelection(tuple),await service.confirmSelection({identityTuple:tuple,inspectionRevision:revision,productionWindow:profile.productionWindow}),await service.revokeSelection({identityTuple:tuple})])
    assert.equal(value.code,'SOURCE_SERVICE_CLOSED');
});

test('confirmation refuses an ineligible event, a missing store, a moved machine policy and a second writer',async t=>{
  const f=await fixture(t),m=source();m.event.eligibility={eligible:false,reasonCodes:['CANCELLED']};seal(m);await f.publish(m);
  const machine=await machineFor(f),tuple=[...m.identityTuple],profile=profileFor(f,m);
  const entered=latch(),release=latch(),store=createExchangeApprovalStore();
  const slow={open:(...a)=>store.open(...a),append:async(...a)=>{entered.release();await release.promise;return store.append(...a);}};
  const service=serviceFor(t,machine,{approvalStore:slow});
  const missing=await service.reviewSelection(tuple);assert.equal(missing.ok,true);
  assert.deepEqual(JSON.parse(JSON.stringify(missing.approval)),{read:false,code:'APPROVAL_MISSING',record:null},'the store is set up explicitly, never by the screen');
  assert.equal((await service.revokeSelection({identityTuple:tuple})).code,'APPROVAL_MISSING');
  await fs.mkdir(path.dirname(machine.source.approvalDirectory),{recursive:true});
  assert.equal((await store.initialize(machine.source.approvalDirectory,machine.source.approvalStoreId)).ok,true);
  const revision=missing.inspection.revision;
  assert.equal((await service.confirmSelection({identityTuple:tuple,inspectionRevision:revision,productionWindow:profile.productionWindow})).code,'APPROVAL_SELECTION_INELIGIBLE');
  // A record saved under another machine policy is shown as not current and admits nothing.
  const head=await store.open(machine.source.approvalDirectory,machine.source.approvalStoreId);
  assert.equal((await store.append(machine.source.approvalDirectory,{expectedStoreId:machine.source.approvalStoreId,expectedRevision:head.revision,expectedHeadSha256:head.headSha256,
    approval:confirmFor(service,machine,profile,{machinePolicyFingerprint:'e'.repeat(64)})})).ok,true);
  assert.equal((await service.reviewSelection(tuple)).approval.record.current,false);
  assert.equal(await service.admission.refreshAdmission({profile}),false);
  // One write at a time: the second waits for nothing and changes nothing.
  const first=service.revokeSelection({identityTuple:tuple});await entered.promise;
  assert.equal((await service.revokeSelection({identityTuple:tuple})).code,'BUSY');
  release.release();const done=await first;assert.equal(done.ok,true,done.code);assert.equal(done.changed,true);
  assert.equal((await service.reviewSelection(tuple)).approval.record,null);
});

// Item 4d: approved selections become the playback manager's catalog, and
// each runtime gets this service's prepared-media driver.
test('approved selections are the manager catalog and prepare, start and stop through the service',async t=>{
  const f=await fixture(t),m=source();await f.publish(m);
  const machine=await machineFor(f),append=await approvals(machine),service=serviceFor(t,machine),tuple=[...m.identityTuple];
  const {createGameDayManager}=require('../scripts/lib/game-day-manager.cjs');
  assert.deepEqual(await service.playbackCatalog.list(),[],'nothing approved yet');
  // A confirmation for another machine policy is never listed.
  await append(confirmFor(service,machine,profileFor(f,m),{machinePolicyFingerprint:'e'.repeat(64)}));
  assert.deepEqual(await service.playbackCatalog.list(),[],'another machine policy');
  const review=await service.reviewSelection(tuple),window={start:'2026-11-17T00:00:00Z',end:'2026-11-17T23:00:00Z',prewarmMinutes:15};
  assert.equal((await service.confirmSelection({identityTuple:tuple,inspectionRevision:review.inspection.revision,productionWindow:window})).ok,true);
  const listed=await service.playbackCatalog.list();noPaths(listed,f);
  assert.equal(listed.length,1);assert.match(listed[0].eventId,/^sel-[a-f0-9]{40}$/);assert.equal(listed[0].status,'available');
  assert.equal(listed[0].displayName,[tuple[4],tuple[1],tuple[2]].filter(Boolean).join(' · '));
  const id=listed[0].eventId,entry=await service.playbackCatalog.read(id);
  assert.equal(Object.isFrozen(entry),true);assert.match(entry.revision,/^[a-f0-9]{64}$/);
  assert.equal(entry.profile.provider,'exchange-v1');assert.equal(entry.profile.eventId,id);
  assert.deepEqual(entry.profile.media.identityTuple,tuple);assert.deepEqual(entry.profile.media.startup,{mode:'source'},'online startup only');
  assert.equal(entry.profile.media.cacheDir,machine.cacheRoot);assert.equal(entry.profile.caspar.runtimeDir,path.join(machine.runtimeRoot,id));
  assert.deepEqual(JSON.parse(JSON.stringify(entry.profile.productionWindow)),{start:'2026-11-17T00:00:00.000Z',end:'2026-11-17T23:00:00.000Z',prewarmMinutes:15});
  assert.deepEqual(entry.profile.rossTalk,machine.rossTalk,'transport from machine policy');
  await assert.rejects(service.playbackCatalog.read('sel-'+'0'.repeat(40)),{code:'CATALOG_INVALID'});
  await assert.rejects(service.playbackCatalog.read('../'+id),{code:'CATALOG_INVALID'});
  // A real manager over the service: the runtime gets the service's driver.
  const seen={media:null,starts:0,closes:0,actions:[]};
  const base=async(profile,options)=>{
    assert.equal(isExchangePreparedMedia(options.preparedMedia,profile),true,'the service driver for this exact profile');
    assert.equal(options.manageSpx,false);seen.media=options.preparedMedia;await options.preparedMedia.initial({privateRoots:options.privateRoots});
    return{candidateAdmissionToken:()=>options.preparedMedia.admissionToken(),start:async()=>{seen.starts++;},close:async()=>{seen.closes++;options.preparedMedia.close();},
      snapshot:()=>({preparing:false,state:'prepared',ready:false,windowAllowed:false}),dispatch:async action=>{seen.actions.push(action);return{ok:true};}};
  };
  const manager=createGameDayManager({catalog:service.playbackCatalog,runtimeFactory:service.preparedRuntimeFactory(base),clock:()=>Date.parse('2026-11-16T12:00:00Z'),
    sourceRoot:machine.mediaRoot,privateRoots:[machine.runtimeRoot,machine.catalogDirectory,machine.source.approvalDirectory],...service.admission});
  t.after(()=>manager.close());
  const request=extra=>{const s=manager.snapshot();return{expectedEventId:s.expectedEventId,expectedSelection:s.expectedSelection,...extra};};
  const events=await manager.listEvents();assert.equal(events.ok,true);assert.deepEqual(events.events.map(e=>e.eventId),[id]);
  const prepared=await manager.prepare(id,request());assert.equal(prepared.ok,true,prepared.code);
  assert.equal((await manager.activate(request({candidateId:prepared.candidateId}))).ok,true);
  assert.equal(manager.snapshot().active.eventId,id);
  assert.equal((await manager.dispatch('next',request())).ok,true);assert.equal((await manager.dispatch('stop',request())).ok,true);
  assert.deepEqual(seen.actions,['next','stop']);assert.equal(seen.starts,1);
  // A changed window keeps the selection's id and changes its revision.
  const moved={start:'2026-11-17T01:00:00Z',end:'2026-11-17T23:00:00Z',prewarmMinutes:15};
  assert.equal((await service.confirmSelection({identityTuple:tuple,inspectionRevision:review.inspection.revision,productionWindow:moved})).ok,true);
  const after=await service.playbackCatalog.read(id);assert.notEqual(after.revision,entry.revision);assert.equal(after.profile.productionWindow.start,'2026-11-17T01:00:00.000Z');
  // Revocation removes it from the list; preparing it is refused.
  assert.equal((await service.revokeSelection({identityTuple:tuple})).ok,true);
  assert.deepEqual(await service.playbackCatalog.list(),[]);
  assert.equal((await manager.prepare(id,request())).code,'CATALOG_INVALID');
  assert.equal((await manager.dispatch('stop',request())).ok,true,'Stop never waits on approvals');
  service.close();await assert.rejects(service.playbackCatalog.list(),{code:'SOURCE_SERVICE_CLOSED'});
});

test('a runtime that is never built closes the service driver it was given',async t=>{
  const f=await fixture(t),m=source();await f.publish(m);
  const machine=await machineFor(f),append=await approvals(machine),service=serviceFor(t,machine);
  const profile=profileFor(f,m);await append(confirmFor(service,machine,profile));
  assert.throws(()=>service.preparedRuntimeFactory(null),{code:'SOURCE_SERVICE_OPTIONS_INVALID'});
  let media=null;
  const factory=service.preparedRuntimeFactory(async(normalized,options)=>{media=options.preparedMedia;await media.initial();
    assert.equal(admitExchangeCandidate(media.admissionToken(),normalized),true);throw Object.assign(Error('PROFILE_PATHS'),{code:'PROFILE_PATHS'});});
  await assert.rejects(factory(profile,{}),{code:'PROFILE_PATHS'},'the factory error is kept');
  assert.equal(admitExchangeCandidate(media.admissionToken(),profile),false,'the driver was closed');
  // The source root is checked before a driver exists.
  await fs.rename(f.config.sourceRoot,path.join(f.parent,'disconnected-source'));media=null;
  await assert.rejects(factory(profile,{}),{code:'SOURCE_UNAVAILABLE'});assert.equal(media,null);
});
