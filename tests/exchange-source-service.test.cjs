'use strict';
// BE-006 slice 3b: the source catalog service built from a loader-made source
// machine. All identities, paths, labels and selections are synthetic.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {loadGameDayMachineConfig}=require('../scripts/lib/game-day-catalog.cjs');
const {createExchangeApprovalStore}=require('../scripts/lib/exchange-approval-store.cjs');
const {createExchangeSourceService}=require('../scripts/lib/exchange-source-service.cjs');
const {isExchangePreparedMedia,admitExchangeCandidate}=require('../scripts/lib/exchange-source-provider.cjs');
const {createExchangeSourceCoordinator}=require('../scripts/lib/exchange-source-coordinator.cjs');
const {fixture,source,profileFor,latch,copy}=require('./exchange-provider-fixtures.cjs');

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
    approvals:{read:false,revision:null,code:'APPROVAL_NOT_READ',rolledBack:false,closed:false}});
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

test('a linked alias passes the root check but the source reader still refuses links',async t=>{
  const f=await fixture(t),m=source();await f.publish(m);
  const alias=path.join(f.parent,'source alias');await fs.symlink(f.config.sourceRoot,alias,'junction');
  let seen=null;const service=serviceFor(t,await machineFor(f,{mediaRoot:alias}),{realpath:async p=>(seen=await fs.realpath(p))});
  const refreshed=await service.refreshCatalog();
  assert.equal(seen,f.config.sourceRoot,'the alias resolves to the retained spelling');
  assert.deepEqual(refreshed,{ok:false,ready:false,code:'UNSAFE_INPUT'},'the service does not weaken the reader\'s no-link rule');
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
