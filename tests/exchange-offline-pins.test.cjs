'use strict';
// BE-006 item 5b part 3: offline pins written by the setup command and cached
// startup of the same button with the exchange folder gone. Real loader,
// reader, journal, approval store, cache and source service on temporary
// folders; synthetic exchange documents from the activation fixture. The
// runtime is a stand-in that records what it is given: Caspar, NDI and
// Windows are not here.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {loadGameDayMachineConfig}=require('../scripts/lib/game-day-catalog.cjs');
const {setupSourceMachine,pinOfflineApprovals}=require('../scripts/lib/exchange-setup.cjs');
const {main}=require('../scripts/piraiders-setup.cjs');
const {createExchangeApprovalStore}=require('../scripts/lib/exchange-approval-store.cjs');
const {createExchangeSourceService}=require('../scripts/lib/exchange-source-service.cjs');
const {createGameDayManager}=require('../scripts/lib/game-day-manager.cjs');
const {exchangeDocuments}=require('../scripts/exchange-activation-fixture.cjs');

const WINDOW={start:'2026-10-01T00:00:00Z',end:'2026-10-01T23:00:00Z',prewarmMinutes:15};
const NOON=Date.parse('2026-10-01T12:00:00Z');

async function machineFile(t,{eligible=true}={}){
  const parent=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders pins ')));
  t.after(()=>fs.rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const appRoot=path.join(parent,'app'),exchange=path.join(parent,'exchange'),docs=exchangeDocuments({eligible});
  await fs.mkdir(path.join(appRoot,'config'),{recursive:true});await fs.writeFile(path.join(appRoot,'config','spx.json'),'{}');
  for(const [relative,bytes] of docs.files){const file=path.join(exchange,...relative.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}
  for(const dir of ['cache','runtime','catalog'])await fs.mkdir(path.join(parent,dir));
  const raw={schemaVersion:1,spxConfigFile:'config/spx.json',catalogDirectory:path.join(parent,'catalog'),mediaRoot:exchange,cacheRoot:path.join(parent,'cache'),runtimeRoot:path.join(parent,'runtime'),
    caspar:{executable:path.join(appRoot,'components','casparcg.exe'),cwd:path.join(appRoot,'components')},output:{type:'none'},
    rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}},
    source:{providerId:'pin-test',journalDirectory:path.join(parent,'private','journal'),journalStoreId:crypto.randomUUID(),
      approvalDirectory:path.join(parent,'private','approvals'),approvalStoreId:crypto.randomUUID(),expectedCanonicalRoot:exchange,binding:{...docs.binding}}};
  const file=path.join(parent,'machine.json');await fs.writeFile(file,JSON.stringify(raw));
  const m={parent,appRoot,file,raw,exchange,docs,tuple:[...docs.identityTuple]};
  m.load=()=>loadGameDayMachineConfig(file,{appRoot,nodeExecutable:process.execPath});
  m.away=()=>fs.rename(exchange,path.join(parent,'exchange-away'));
  m.back=()=>fs.rename(path.join(parent,'exchange-away'),exchange);
  return m;
}
// The pictures' content hashes in play order, from the fixture's own manifest.
function expectedOrder(docs){
  const [,bytes]=[...docs.files].find(([name])=>name.endsWith('/manifest.json')),m=JSON.parse(bytes);
  const sha=new Map(m.assets.map(a=>[a.assetKey,a.sha256]));return m.occurrences.map(o=>sha.get(o.assetKey));
}
function playedOrder(prepared){
  const m=prepared.manifest,file=new Map(m.assets.map(a=>[a.assetKey,a.fileId])),sha=new Map(m.files.map(f=>[f.id,f.sha256]));
  return m.occurrences.map(o=>sha.get(file.get(o.assetKey)));
}
async function approvalsOf(m){
  const s=m.raw.source,head=await createExchangeApprovalStore().open(s.approvalDirectory,s.approvalStoreId);
  assert.equal(head.ok,true,head.code);return head;
}
async function appendRaw(m,approval){
  const s=m.raw.source,store=createExchangeApprovalStore(),head=await store.open(s.approvalDirectory,s.approvalStoreId);
  const next=await store.append(s.approvalDirectory,{expectedStoreId:s.approvalStoreId,expectedRevision:head.revision,expectedHeadSha256:head.headSha256,approval});
  assert.equal(next.ok,true,next.code);
}
// A stand-in runtime: it prepares through the service's driver and records
// the deck and the actions it is given.
function recorder(){
  const seen={prepared:[],actions:[]};
  const base=async(profile,options)=>{
    const prepared=await options.preparedMedia.initial({privateRoots:options.privateRoots});seen.prepared.push({mode:profile.media.startup.mode,prepared});
    return{candidateAdmissionToken:()=>options.preparedMedia.admissionToken(),start:async()=>{},close:async()=>{options.preparedMedia.close();},
      snapshot:()=>({preparing:false,state:'prepared',ready:false,windowAllowed:false}),dispatch:async action=>{seen.actions.push(action);return{ok:true};}};
  };
  return{seen,base};
}
function managerFor(t,service,machine,base){
  const manager=createGameDayManager({catalog:service.playbackCatalog,runtimeFactory:service.preparedRuntimeFactory(base),clock:()=>NOON,
    sourceRoot:machine.mediaRoot,privateRoots:[machine.runtimeRoot,machine.catalogDirectory,machine.source.approvalDirectory],...service.admission});
  t.after(()=>manager.close());return manager;
}
const request=(manager,extra)=>{const s=manager.snapshot();return{expectedEventId:s.expectedEventId,expectedSelection:s.expectedSelection,...extra};};
// Setup, one PC confirmation, and one online preparation of that button
// through the manager (which fills the cache).
async function approvedAndPrepared(t,m){
  assert.equal((await setupSourceMachine(await m.load())).ok,true);
  const machine=await m.load(),service=createExchangeSourceService(machine);
  try{
    const review=await service.reviewSelection(m.tuple);assert.equal(review.ok,true,review.code);
    const confirmed=await service.confirmSelection({identityTuple:m.tuple,inspectionRevision:review.inspection.revision,productionWindow:WINDOW});
    assert.equal(confirmed.ok,true,confirmed.code);
    const {seen,base}=recorder(),manager=managerFor(t,service,machine,base);
    const [listed]=(await manager.listEvents()).events,prepared=await manager.prepare(listed.eventId,request(manager));
    assert.equal(prepared.ok,true,prepared.code);assert.equal(seen.prepared[0].mode,'source');
    await manager.close();
    return{eventId:listed.eventId,snapshotDir:seen.prepared[0].prepared.snapshotDir};
  }finally{service.close();}
}

test('the setup command pins a prepared confirmation; the same button then starts from the cache with the exchange folder gone',async t=>{
  const m=await machineFile(t),{eventId,snapshotDir}=await approvedAndPrepared(t,m);
  const before=await approvalsOf(m);assert.equal(before.approvals[0].offline,null,'online confirmation only so far');

  const options={appRoot:m.appRoot,nodeExecutable:process.execPath};
  const pinned=await main(['--machine',m.file,'--pin-offline'],options);
  assert.equal(pinned.exitCode,0,JSON.stringify(pinned.answer));
  const {graphics,vcRuntime,...answer}=JSON.parse(JSON.stringify(pinned.answer));
  assert.deepEqual(answer,{ok:true,step:'done',code:null,
    done:{machine:'checked',source:'direct',feed:'checked',journal:'present',approvals:'present',offline:{pinned:1,unchanged:0,notPrepared:0,ineligible:0}}});
  // Q-019: the OpenGL check is reported beside the steps (its own tests: graphics-check.test.cjs).
  assert.deepEqual(Object.keys(graphics),['check','probe','setting','renderer']);assert.equal(graphics.setting,'auto');
  // Q-027: the VC++ runtime check; --pin-offline never asks (its own tests: vc-runtime.test.cjs).
  assert.deepEqual(Object.keys(vcRuntime),['check','probe','install','after']);assert.equal(vcRuntime.install,'not-asked');
  const printed=JSON.stringify(pinned.answer);
  for(const secret of [m.parent,path.basename(snapshotDir),m.docs.playbackFingerprint,m.raw.source.approvalStoreId])assert.equal(printed.includes(secret),false,'no path or id printed');

  const after=await approvalsOf(m),[a]=after.approvals,[b]=before.approvals;
  assert.equal(after.revision,before.revision+1);assert.equal(after.approvals.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(a.offline)),{snapshotId:path.basename(snapshotDir),playbackFingerprint:m.docs.playbackFingerprint});
  assert.equal(a.machinePolicyFingerprint,b.machinePolicyFingerprint);assert.deepEqual(a.productionWindow,b.productionWindow);
  assert.equal(a.confirmation,true);assert.equal(a.type,'confirm');

  // Run again: nothing changes.
  const again=await main(['--machine',m.file,'--pin-offline'],options);
  assert.deepEqual({...again.answer.done.offline},{pinned:0,unchanged:1,notPrepared:0,ineligible:0});
  assert.equal((await approvalsOf(m)).revision,after.revision);

  // The confirmation is still good online: with the folder there it starts from the source.
  let machine=await m.load(),service=createExchangeSourceService(machine);
  const online=await service.playbackCatalog.read(eventId);
  assert.deepEqual({...online.profile.media.startup},{mode:'source'});
  service.close();

  // The exchange folder is gone: the same button starts in cached mode and plays the cached pictures in order.
  await m.away();
  machine=await m.load();service=createExchangeSourceService(machine);t.after(()=>service.close());
  const {seen,base}=recorder(),manager=managerFor(t,service,machine,base);
  const events=await manager.listEvents();assert.equal(events.ok,true);assert.deepEqual(events.events.map(e=>e.eventId),[eventId]);
  const entry=await service.playbackCatalog.read(eventId);
  assert.deepEqual({...entry.profile.media.startup},{mode:'cached',snapshotId:path.basename(snapshotDir),playbackFingerprint:m.docs.playbackFingerprint});
  assert.notEqual(entry.revision,online.revision,'a cached startup is another catalog revision');
  const prepared=await manager.prepare(eventId,request(manager));assert.equal(prepared.ok,true,prepared.code);
  assert.equal(seen.prepared[0].mode,'cached');assert.equal(seen.prepared[0].prepared.snapshotDir,snapshotDir);
  assert.deepEqual(playedOrder(seen.prepared[0].prepared),expectedOrder(m.docs),'the cached pictures, in the source order');
  assert.equal(seen.prepared[0].prepared.deck.slides.length,3);
  assert.equal((await manager.activate(request(manager,{candidateId:prepared.candidateId}))).ok,true);
  for(const action of ['next','next','stop'])assert.equal((await manager.dispatch(action,request(manager))).ok,true);
  assert.deepEqual(seen.actions,['next','next','stop']);
});

test('a revoked or changed approval, another snapshot or a missing pin refuses cached startup',async t=>{
  const m=await machineFile(t),{eventId,snapshotDir}=await approvedAndPrepared(t,m),snapshotId=path.basename(snapshotDir);
  // Missing pin: with the folder gone the button is a source startup and is refused.
  await m.away();
  let machine=await m.load(),service=createExchangeSourceService(machine);
  let entry=await service.playbackCatalog.read(eventId);
  assert.deepEqual({...entry.profile.media.startup},{mode:'source'},'no pin, no cached startup');
  await assert.rejects(service.preparedMedia(entry.profile),{code:'SOURCE_UNAVAILABLE'});
  // A cached profile without a pin in the approval is refused by the revalidator.
  const cached=JSON.parse(JSON.stringify(entry.profile));cached.media.startup={mode:'cached',snapshotId,playbackFingerprint:m.docs.playbackFingerprint};
  await assert.rejects((await service.preparedMedia(cached)).initial(),{code:'OFFLINE_AUTHORIZATION_REQUIRED'});
  service.close();

  // Pinning needs the source: refused with the folder gone, nothing written.
  const head=await approvalsOf(m);
  const offline=await pinOfflineApprovals(await m.load());
  assert.equal(offline.ok,false);assert.equal(offline.step,'source');assert.equal(offline.code,'SETUP_SOURCE_UNAVAILABLE');
  assert.equal((await approvalsOf(m)).revision,head.revision);
  await m.back();assert.equal((await pinOfflineApprovals(await m.load())).ok,true);await m.away();

  machine=await m.load();service=createExchangeSourceService(machine);t.after(()=>service.close());
  entry=await service.playbackCatalog.read(eventId);assert.equal(entry.profile.media.startup.mode,'cached');
  // A different snapshot id or playback than the pin.
  for(const startup of [{mode:'cached',snapshotId:crypto.randomUUID(),playbackFingerprint:m.docs.playbackFingerprint},{mode:'cached',snapshotId,playbackFingerprint:'f'.repeat(64)}]){
    const other=JSON.parse(JSON.stringify(entry.profile));other.media.startup=startup;
    await assert.rejects((await service.preparedMedia(other)).initial(),{code:'OFFLINE_AUTHORIZATION_REQUIRED'});
  }
  const good=await service.preparedMedia(entry.profile);assert.equal((await good.initial()).snapshotDir,snapshotDir);good.close();

  // A changed approval (a new window, confirmed online): the pin is gone, the old cached profile is refused.
  const [current]=(await approvalsOf(m)).approvals;
  await appendRaw(m,{...JSON.parse(JSON.stringify(current)),productionWindow:{start:'2026-10-01T01:00:00Z',end:'2026-10-01T23:00:00Z',prewarmMinutes:15},offline:null});
  await assert.rejects((await service.preparedMedia(entry.profile)).initial(),{code:'OFFLINE_AUTHORIZATION_REQUIRED'});
  assert.deepEqual({...(await service.playbackCatalog.read(eventId)).profile.media.startup},{mode:'source'});

  // Pinned again, then revoked: nothing to list, and the cached profile is refused.
  await appendRaw(m,JSON.parse(JSON.stringify(current)));
  assert.equal((await service.playbackCatalog.read(eventId)).profile.media.startup.mode,'cached');
  assert.equal((await service.revokeSelection({identityTuple:m.tuple})).ok,true,'revoke works with the folder gone');
  assert.deepEqual(await service.playbackCatalog.list(),[]);
  await assert.rejects(service.playbackCatalog.read(eventId),{code:'CATALOG_INVALID'});
  await assert.rejects((await service.preparedMedia(entry.profile)).initial(),{code:'OFFLINE_AUTHORIZATION_REQUIRED'});
});

test('nothing is pinned for a button not prepared online, a cache of an older playback or another machine\'s confirmation',async t=>{
  const m=await machineFile(t);
  assert.equal((await setupSourceMachine(await m.load())).ok,true);
  let service=createExchangeSourceService(await m.load());
  const review=await service.reviewSelection(m.tuple);
  assert.equal((await service.confirmSelection({identityTuple:m.tuple,inspectionRevision:review.inspection.revision,productionWindow:WINDOW})).ok,true);
  const [confirmed]=(await approvalsOf(m)).approvals;service.close();
  // Confirmed, never prepared: the cache is empty.
  let r=await pinOfflineApprovals(await m.load());
  assert.equal(r.ok,true,r.code);assert.deepEqual({...r.done.offline},{pinned:0,unchanged:0,notPrepared:1,ineligible:0});
  const head=await approvalsOf(m);assert.equal(head.approvals[0].offline,null);

  // Prepared online, then the source republishes the button with another
  // playback: the cached snapshot is of the old playback and is not pinned.
  await (async()=>{
    const machine=await m.load(),s=createExchangeSourceService(machine);
    try{const {base}=recorder(),manager=managerFor(t,s,machine,base);const [e]=(await manager.listEvents()).events;
      assert.equal((await manager.prepare(e.eventId,request(manager))).ok,true);await manager.close();}finally{s.close();}
  })();
  const second=exchangeDocuments({generation:2});assert.notEqual(second.playbackFingerprint,m.docs.playbackFingerprint);
  for(const [relative,bytes] of second.files){const file=path.join(m.exchange,...relative.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}
  r=await pinOfflineApprovals(await m.load());
  assert.equal(r.ok,true,r.code);
  assert.deepEqual({...r.done.offline},{pinned:0,unchanged:0,notPrepared:1,ineligible:0},'a snapshot of another playback is not this button\'s');

  // Another machine policy's confirmation is not this machine's: skipped.
  await appendRaw(m,{...JSON.parse(JSON.stringify(confirmed)),machinePolicyFingerprint:'e'.repeat(64)});
  r=await pinOfflineApprovals(await m.load());
  assert.deepEqual({...r.done.offline},{pinned:0,unchanged:0,notPrepared:0,ineligible:0});
  await appendRaw(m,JSON.parse(JSON.stringify(confirmed)));

  // Prepared online again (the new playback): now the same command pins it.
  await (async()=>{
    const machine=await m.load(),s=createExchangeSourceService(machine);
    try{const {base}=recorder(),manager=managerFor(t,s,machine,base);const [e]=(await manager.listEvents()).events;
      assert.equal((await manager.prepare(e.eventId,request(manager))).ok,true);await manager.close();}finally{s.close();}
  })();
  r=await pinOfflineApprovals(await m.load());
  assert.deepEqual({...r.done.offline},{pinned:1,unchanged:0,notPrepared:0,ineligible:0});
  assert.equal((await approvalsOf(m)).approvals[0].offline.playbackFingerprint,second.playbackFingerprint);
  // While another owner holds this machine's source boundary, pinning is refused.
  service=createExchangeSourceService(await m.load());t.after(()=>service.close());
  r=await pinOfflineApprovals(await m.load());assert.equal(r.code,'SETUP_SOURCE_IN_USE');assert.equal(r.step,'offline');
});

test('a cache with more snapshot folders than the scan bound is refused with its own code',async t=>{
  const m=await machineFile(t);
  assert.equal((await setupSourceMachine(await m.load())).ok,true);
  const service=createExchangeSourceService(await m.load()),review=await service.reviewSelection(m.tuple);
  assert.equal((await service.confirmSelection({identityTuple:m.tuple,inspectionRevision:review.inspection.revision,productionWindow:WINDOW})).ok,true);service.close();
  for(let i=0;i<513;i++)await fs.mkdir(path.join(m.raw.cacheRoot,crypto.randomUUID()));
  const r=await pinOfflineApprovals(await m.load());
  assert.equal(r.ok,false);assert.equal(r.step,'offline');assert.equal(r.code,'OFFLINE_PIN_CACHE_TOO_LARGE');
  assert.equal((await approvalsOf(m)).approvals[0].offline,null);
});

test('a button the source marks ineligible is not pinned',async t=>{
  const m=await machineFile(t,{eligible:false});
  assert.equal((await setupSourceMachine(await m.load())).ok,true);
  const service=createExchangeSourceService(await m.load()),review=await service.reviewSelection(m.tuple);
  assert.equal(review.ok,true,review.code);assert.equal(review.admissionEligible,false);
  const policy=service.policyFingerprint;service.close();
  // A confirmation saved earlier, while the event was still on.
  await appendRaw(m,{type:'confirm',providerId:'pin-test',binding:{...m.docs.binding},identityTuple:m.tuple,confirmation:true,
    machinePolicyFingerprint:policy,productionWindow:WINDOW,offline:null});
  const r=await pinOfflineApprovals(await m.load());
  assert.equal(r.ok,true,r.code);assert.deepEqual({...r.done.offline},{pinned:0,unchanged:0,notPrepared:0,ineligible:1});
  assert.equal((await approvalsOf(m)).approvals[0].offline,null);
});

test('a confirmation changed while pinning wins: nothing is pinned over it',async t=>{
  const m=await machineFile(t);await approvedAndPrepared(t,m);
  const s=m.raw.source,store=createExchangeApprovalStore();let revoked=false;
  // A store that revokes the confirmation right after the pin step first reads it.
  const racing=Object.freeze({open:async(dir,id)=>{const head=await store.open(dir,id);
      if(!revoked&&head.ok&&head.approvals.length){revoked=true;
        const [a]=head.approvals,next=await store.append(dir,{expectedStoreId:id,expectedRevision:head.revision,expectedHeadSha256:head.headSha256,
          approval:{type:'revoke',providerId:a.providerId,binding:{...a.binding},identityTuple:[...a.identityTuple],confirmation:true}});
        assert.equal(next.ok,true);}
      return head;},
    append:(dir,req)=>store.append(dir,req)});
  const r=await pinOfflineApprovals(await m.load(),{service:{approvalStore:racing}});
  assert.equal(r.ok,false);assert.equal(r.code,'APPROVAL_CONFLICT');assert.equal(r.step,'offline');
  const head=await store.open(s.approvalDirectory,s.approvalStoreId);assert.deepEqual([...head.approvals],[],'the revoke stands');
});
