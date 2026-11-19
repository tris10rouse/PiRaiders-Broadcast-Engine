'use strict';
// BE-006 exact approval revalidation. All identities, paths and selections
// below are synthetic test data.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {loadGameDayMachineConfig}=require('../scripts/lib/game-day-catalog.cjs');
const {createExchangeApprovalStore}=require('../scripts/lib/exchange-approval-store.cjs');
const {compileMachinePolicyFingerprint,approvalMatches,createApprovalRevalidator}=require('../scripts/lib/exchange-approval-policy.cjs');
const {fixture,source,profileFor,providerFor,latch,until,copy}=require('./exchange-provider-fixtures.cjs');
const {admitExchangeCandidate}=require('../scripts/lib/exchange-source-provider.cjs');
const {createGameDayManager}=require('../scripts/lib/game-day-manager.cjs');

const TUPLE=['2026-2027','synthetic-feed','synthetic-season','event','Synthetic selection'];
const WINDOW={start:'2026-11-17T00:00:00Z',end:'2026-11-17T23:00:00Z',prewarmMinutes:15};
async function machineFor(t,{binding={feedId:crypto.randomUUID(),epoch:1},journalStoreId=crypto.randomUUID(),approvalDirectory,edit=raw=>raw}={}){
  const parent=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders approval policy ')));
  t.after(()=>fs.rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const raw={schemaVersion:1,spxConfigFile:'config/spx.json',catalogDirectory:path.join(parent,'catalog'),
    mediaRoot:path.join(parent,'offline Drive'),cacheRoot:path.join(parent,'cache'),runtimeRoot:path.join(parent,'runtime'),
    caspar:{executable:path.join(parent,'components','casparcg.exe'),cwd:path.join(parent,'components')},output:{type:'none'},
    rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}},
    source:{providerId:'approved-feed',journalDirectory:path.join(parent,'private','journal'),journalStoreId,
      approvalDirectory:approvalDirectory??path.join(parent,'private','approvals'),approvalStoreId:crypto.randomUUID(),
      expectedCanonicalRoot:path.join(parent,'offline Drive'),binding}};
  const file=path.join(parent,'machine.json');
  async function load(value=raw){await fs.writeFile(file,JSON.stringify(edit(value)));return loadGameDayMachineConfig(file,{appRoot:parent,nodeExecutable:process.execPath});}
  return{parent,raw,load,machine:await load()};
}
function confirm(m,policy,extra={}){return{type:'confirm',providerId:'approved-feed',machinePolicyFingerprint:policy,binding:copy(m.source.binding),
  identityTuple:[...TUPLE],productionWindow:copy(WINDOW),offline:null,confirmation:true,...extra};}
function revoke(m,tuple=TUPLE){return{type:'revoke',providerId:'approved-feed',binding:copy(m.source.binding),identityTuple:[...tuple],confirmation:true};}
async function appendTo(store,m,approval){
  const head=await store.open(m.source.approvalDirectory,m.source.approvalStoreId);assert.equal(head.ok,true);
  const next=await store.append(m.source.approvalDirectory,{expectedStoreId:m.source.approvalStoreId,expectedRevision:head.revision,expectedHeadSha256:head.headSha256,approval});
  assert.equal(next.ok,true,next.code);return next;
}
async function initialized(m){const store=createExchangeApprovalStore();await fs.mkdir(path.dirname(m.source.approvalDirectory),{recursive:true});
  const head=await store.initialize(m.source.approvalDirectory,m.source.approvalStoreId);assert.equal(head.ok,true,head.code);return store;}
function contextFor(m,{startup={mode:'source'},window=WINDOW,tuple=TUPLE}={}){
  return Object.freeze({profile:{provider:'exchange-v1',productionWindow:copy(window),media:{provider:'exchange-ordered-v1',providerId:'approved-feed',
    binding:copy(m.source.binding),identityTuple:[...tuple],startup}}});
}

test('machine policy fingerprint needs a genuine source machine and changes with every retained source fact',async t=>{
  const f=await machineFor(t),a=compileMachinePolicyFingerprint(f.machine);
  assert.match(a,/^[0-9a-f]{64}$/);assert.equal(compileMachinePolicyFingerprint(await f.load()),a,'same machine file, same fingerprint');
  assert.throws(()=>compileMachinePolicyFingerprint({...f.machine}),{code:'APPROVAL_POLICY_MACHINE_INVALID'});
  assert.throws(()=>compileMachinePolicyFingerprint(JSON.parse(JSON.stringify(f.machine))),{code:'APPROVAL_POLICY_MACHINE_INVALID'});
  const legacy=copy(f.raw);delete legacy.source;
  const legacyMachine=await f.load(legacy);
  assert.throws(()=>compileMachinePolicyFingerprint(legacyMachine),{code:'APPROVAL_POLICY_MACHINE_INVALID'});
  const variants=[r=>{r.source.approvalStoreId=crypto.randomUUID();},r=>{r.source.journalStoreId=crypto.randomUUID();},
    r=>{r.source.binding.epoch=2;},r=>{r.source.binding.feedId=crypto.randomUUID();},r=>{r.source.providerId='other-feed';},
    r=>{r.source.approvalDirectory=r.source.approvalDirectory+'-moved';},r=>{r.source.expectedCanonicalRoot=r.source.expectedCanonicalRoot+' 2';r.mediaRoot=r.source.expectedCanonicalRoot;},
    r=>{r.cacheRoot=r.cacheRoot+'-2';}];
  const seen=new Set([a]);
  for(const change of variants){const raw=copy(f.raw);change(raw);const fp=compileMachinePolicyFingerprint(await f.load(raw));assert.equal(seen.has(fp),false);seen.add(fp);}
});

test('approval matching is exact on policy, source, selection, window and the cached snapshot pin',()=>{
  const policy='a'.repeat(64),binding={feedId:crypto.randomUUID(),epoch:1},snapshotId=crypto.randomUUID(),pf='c'.repeat(64);
  const base={type:'confirm',providerId:'approved-feed',machinePolicyFingerprint:policy,binding,identityTuple:[...TUPLE],productionWindow:copy(WINDOW),offline:null,confirmation:true};
  const expect=(extra={})=>({policyFingerprint:policy,providerId:'approved-feed',binding:copy(binding),identityTuple:[...TUPLE],productionWindow:copy(WINDOW),offline:null,...extra});
  assert.equal(approvalMatches([base],expect()),true);
  assert.equal(approvalMatches([base],expect({productionWindow:{start:'2026-11-17T00:00:00.000Z',end:'2026-11-17T23:00:00.000Z',prewarmMinutes:15}})),true,'same instant, other spelling');
  assert.equal(approvalMatches([{...base,productionWindow:{start:WINDOW.start,end:WINDOW.end}}],expect()),true,'default prewarm is 15');
  for(const changed of [expect({policyFingerprint:'b'.repeat(64)}),expect({providerId:'other-feed'}),expect({binding:{...binding,epoch:2}}),
    expect({identityTuple:[...TUPLE.slice(0,4),'Synthetic selection 2']}),expect({productionWindow:{...WINDOW,end:'2026-11-17T23:01:00Z'}}),
    expect({productionWindow:{...WINDOW,prewarmMinutes:10}}),expect({offline:{snapshotId,playbackFingerprint:pf}})])
    assert.equal(approvalMatches([base],changed),false,JSON.stringify(changed));
  const cached={...base,offline:{snapshotId,playbackFingerprint:pf}};
  assert.equal(approvalMatches([cached],expect({offline:{snapshotId,playbackFingerprint:pf}})),true);
  assert.equal(approvalMatches([cached],expect()),true,'an offline pin does not take away the online confirmation');
  assert.equal(approvalMatches([cached],expect({offline:{snapshotId:crypto.randomUUID(),playbackFingerprint:pf}})),false);
  assert.equal(approvalMatches([cached],expect({offline:{snapshotId,playbackFingerprint:'d'.repeat(64)}})),false);
  assert.equal(approvalMatches([],expect()),false);assert.equal(approvalMatches([base,base],expect()),false,'ambiguous history denies');
  assert.equal(approvalMatches([{...base,confirmation:false}],expect()),false);assert.equal(approvalMatches([{...base,type:'revoke'}],expect()),false);
  for(const bad of [null,undefined,{},expect({policyFingerprint:'x'}),expect({productionWindow:{start:'later',end:'never'}}),expect({offline:{snapshotId:'x',playbackFingerprint:pf}})])
    assert.equal(approvalMatches([base],bad),false);
  assert.equal(approvalMatches(null,expect()),false);
});

test('the revalidator grants nothing before a read and rereads the store at every refresh',async t=>{
  const f=await machineFor(t),store=await initialized(f.machine),gate=createApprovalRevalidator({machine:f.machine});
  const ctx=contextFor(f.machine);
  assert.equal(gate.admitCandidate(ctx),false,'no read yet');assert.equal(await gate.refreshAdmission(ctx),false,'no approval yet');
  await appendTo(store,f.machine,confirm(f.machine,gate.policyFingerprint));
  assert.equal(gate.admitCandidate(ctx),false,'a write is not seen until the next refresh');
  assert.equal(await gate.refreshAdmission(ctx),true);assert.equal(gate.admitCandidate(ctx),true);
  assert.equal(gate.admitCandidate(contextFor(f.machine,{window:{...WINDOW,end:'2026-11-17T22:00:00Z'}})),false);
  assert.equal(gate.admitCandidate(contextFor(f.machine,{startup:{mode:'cached',snapshotId:crypto.randomUUID(),playbackFingerprint:'c'.repeat(64)}})),false,'online approval is not an offline pin');
  assert.equal(gate.admitCandidate({profile:{...ctx.profile,provider:'local-manual'}}),false);
  assert.equal(gate.admitCandidate({profile:{...ctx.profile,media:{...ctx.profile.media,binding:{...ctx.profile.media.binding,epoch:2}}}}),false,'another binding than the machine policy');
  for(const bad of [null,undefined,{},{profile:null},{profile:{provider:'exchange-v1'}}])assert.equal(gate.admitCandidate(bad),false);
  const foreign={feedId:crypto.randomUUID(),epoch:2};
  await appendTo(store,f.machine,confirm(f.machine,gate.policyFingerprint,{binding:foreign}));assert.equal(await gate.refresh(),true);
  assert.equal(gate.admitCandidate({profile:{...ctx.profile,media:{...ctx.profile.media,binding:foreign}}}),false,'a stored approval for a feed this machine is not bound to');
  await appendTo(store,f.machine,revoke(f.machine));
  assert.equal(gate.admitCandidate(ctx),true,'synchronous checks keep the last completed read');
  assert.equal(await gate.refreshAdmission(ctx),false,'revocation is seen on the next refresh');
  await appendTo(store,f.machine,confirm(f.machine,'e'.repeat(64)));
  assert.equal(await gate.refreshAdmission(ctx),false,'an approval made under another machine policy');
  assert.equal(gate.status().read,true);assert.equal(gate.status().ready,false);
});

test('a missing or broken store denies, and a later good read is a fresh decision',async t=>{
  const f=await machineFor(t),store=await initialized(f.machine),gate=createApprovalRevalidator({machine:f.machine}),ctx=contextFor(f.machine);
  await appendTo(store,f.machine,confirm(f.machine,gate.policyFingerprint));assert.equal(await gate.refreshAdmission(ctx),true);
  const away=f.machine.source.approvalDirectory+'-away';await fs.rename(f.machine.source.approvalDirectory,away);
  assert.equal(await gate.refreshAdmission(ctx),false);assert.equal(gate.admitCandidate(ctx),false,'a failed read clears the old decision');
  assert.equal(gate.status().code,'APPROVAL_MISSING');
  await fs.rename(away,f.machine.source.approvalDirectory);assert.equal(await gate.refreshAdmission(ctx),true);
  await fs.writeFile(path.join(f.machine.source.approvalDirectory,'stray.txt'),'x');
  assert.equal(await gate.refreshAdmission(ctx),false);assert.equal(gate.status().code,'APPROVAL_INVALID');
  const thrower=createApprovalRevalidator({machine:f.machine,store:{open:async()=>{throw Error('disk');}}});
  assert.equal(await thrower.refreshAdmission(ctx),false);assert.equal(thrower.status().code,'APPROVAL_IO_FAILED');
  assert.throws(()=>createApprovalRevalidator({machine:f.machine,extra:1}),{code:'APPROVAL_POLICY_OPTIONS_INVALID'});
  assert.throws(()=>createApprovalRevalidator({machine:{...f.machine}}),{code:'APPROVAL_POLICY_MACHINE_INVALID'});
});

test('a restored older approval store is a rollback and denies until restart',async t=>{
  const f=await machineFor(t),store=await initialized(f.machine),gate=createApprovalRevalidator({machine:f.machine}),ctx=contextFor(f.machine);
  await appendTo(store,f.machine,confirm(f.machine,gate.policyFingerprint));
  const saved=f.machine.source.approvalDirectory+'-saved';await fs.cp(f.machine.source.approvalDirectory,saved,{recursive:true});
  await appendTo(store,f.machine,revoke(f.machine));assert.equal(await gate.refreshAdmission(ctx),false);
  await fs.rm(f.machine.source.approvalDirectory,{recursive:true});await fs.rename(saved,f.machine.source.approvalDirectory);
  assert.equal(await gate.refreshAdmission(ctx),false,'the old copy still holds the confirmation, but it is a rollback');
  assert.equal(gate.status().code,'APPROVAL_ROLLBACK');assert.equal(gate.status().rolledBack,true);
  await appendTo(store,f.machine,revoke(f.machine));await appendTo(store,f.machine,confirm(f.machine,gate.policyFingerprint));
  assert.equal(await gate.refreshAdmission(ctx),false,'sticky for this revalidator');
  assert.equal(await createApprovalRevalidator({machine:f.machine}).refreshAdmission(ctx),true,'a restart reads afresh');
});

test('a same-revision store with a different head is a rollback too',async t=>{
  const policyMachine=await machineFor(t);let head={ok:true,storeId:policyMachine.machine.source.approvalStoreId,revision:1,headSha256:'1'.repeat(64),approvals:[]};
  const gate=createApprovalRevalidator({machine:policyMachine.machine,store:{open:async()=>head}});
  assert.equal(await gate.refresh(),true);head={...head,headSha256:'2'.repeat(64)};
  assert.equal(await gate.refresh(),false);assert.equal(gate.status().code,'APPROVAL_ROLLBACK');
  const other=createApprovalRevalidator({machine:policyMachine.machine,store:{open:async()=>({...head,storeId:crypto.randomUUID()})}});
  assert.equal(await other.refresh(),false,'another store identity');
});

test('an overtaken or closed refresh grants nothing',async t=>{
  const f=await machineFor(t),store=await initialized(f.machine),ctx=contextFor(f.machine);
  const reads=[];const slow={open:(...args)=>{const l=latch();reads.push(l);return l.promise.then(()=>store.open(...args));}};
  const gate=createApprovalRevalidator({machine:f.machine,store:slow});
  await appendTo(store,f.machine,confirm(f.machine,gate.policyFingerprint));
  const first=gate.refreshAdmission(ctx),second=gate.refreshAdmission(ctx);
  reads[0].release();assert.equal(await first,false,'overtaken');assert.equal(gate.admitCandidate(ctx),false);
  reads[1].release();assert.equal(await second,true);assert.equal(gate.admitCandidate(ctx),true);
  const third=gate.refreshAdmission(ctx);assert.equal(gate.admitCandidate(ctx),false,'a refresh in flight withdraws the old decision');
  gate.close();reads[2].release();assert.equal(await third,false);assert.equal(gate.admitCandidate(ctx),false);
  assert.equal(await gate.refreshAdmission(ctx),false);assert.equal(gate.status().closed,true);
});

test('cached startup needs the exact offline pin and the retained journal identity',async t=>{
  const f=await fixture(t),m=source();await f.publish(m);
  const staged=await f.coordinator.prepareSelection(m.identityTuple);assert.equal(staged.ok,true);
  const pm=await machineFor(t,{binding:copy(f.config.binding),journalStoreId:f.config.storeId});
  const store=await initialized(pm.machine),gate=createApprovalRevalidator({machine:pm.machine});
  const profile=profileFor(f,m),snapshotId=path.basename(staged.prepared.snapshotDir);
  profile.media.startup={mode:'cached',snapshotId,playbackFingerprint:m.playbackFingerprint};
  const approval={...confirm(pm.machine,gate.policyFingerprint),identityTuple:[...m.identityTuple],productionWindow:copy(profile.productionWindow)};
  await appendTo(store,pm.machine,{...approval,offline:null});assert.equal(await gate.refresh(),true);
  await fs.rename(f.config.sourceRoot,path.join(f.parent,'disconnected-source'));
  const provider=providerFor(t,f,{createCoordinator:()=>{throw Error('OFFLINE_SOURCE_FORBIDDEN');}});
  await assert.rejects(provider.createPreparedMedia(profile,{authorizeOffline:gate.authorizeOffline}).initial(),{code:'OFFLINE_AUTHORIZATION_REQUIRED'},'online-only approval');
  await appendTo(store,pm.machine,{...approval,offline:{snapshotId,playbackFingerprint:m.playbackFingerprint}});assert.equal(await gate.refresh(),true);
  const driver=provider.createPreparedMedia(profile,{authorizeOffline:gate.authorizeOffline}),prepared=await driver.initial();
  assert.equal(prepared.snapshotDir,staged.prepared.snapshotDir);assert.equal(admitExchangeCandidate(driver.admissionToken(),profile),true);
  await appendTo(store,pm.machine,revoke(pm.machine,m.identityTuple));assert.equal(await gate.refresh(),true);
  assert.equal(admitExchangeCandidate(driver.admissionToken(),profile),false,'revocation reaches the offline admission');
  const wrongJournal=await machineFor(t,{binding:copy(f.config.binding),approvalDirectory:pm.machine.source.approvalDirectory,
    edit:raw=>({...raw,source:{...raw.source,approvalStoreId:pm.machine.source.approvalStoreId}})});
  const other=createApprovalRevalidator({machine:wrongJournal.machine});await appendTo(store,pm.machine,{...approval,machinePolicyFingerprint:other.policyFingerprint,offline:{snapshotId,playbackFingerprint:m.playbackFingerprint}});
  assert.equal(await other.refresh(),true);
  assert.equal(other.authorizeOffline({providerId:'approved-feed',storeId:f.config.storeId,binding:copy(f.config.binding),identityTuple:[...m.identityTuple],
    startup:{...profile.media.startup},productionWindow:copy(profile.productionWindow)}),false,'journal store identity differs from this machine');
});

test('manager integration: revocation written during start is reread before activation',async t=>{
  const f=await fixture(t),m=source();await f.publish(m);const profile=profileFor(f,m),provider=providerFor(t,f);
  const pm=await machineFor(t,{binding:copy(f.config.binding),journalStoreId:f.config.storeId});
  const store=await initialized(pm.machine),gate=createApprovalRevalidator({machine:pm.machine});
  await appendTo(store,pm.machine,{...confirm(pm.machine,gate.policyFingerprint),identityTuple:[...m.identityTuple],productionWindow:copy(profile.productionWindow)});
  const held=latch(),state={starts:0,closes:0};let hold=true;
  const manager=createGameDayManager({clock:()=>Date.parse('2026-11-17T12:00:00Z'),catalog:{list:async()=>[],read:async()=>Object.freeze({profile,
    descriptor:Object.freeze({eventId:profile.eventId,displayName:'Synthetic approval policy'}),revision:'b'.repeat(64)})},
    refreshAdmission:gate.refreshAdmission,admitCandidate:gate.admitCandidate,
    runtimeFactory:async normalized=>{const driver=provider.createPreparedMedia(normalized);await driver.initial();return{
      candidateAdmissionToken:()=>driver.admissionToken(),start:async()=>{state.starts++;if(hold)await held.promise;},
      close:async()=>{state.closes++;driver.close();},snapshot:()=>({preparing:false,state:'prepared',ready:false,windowAllowed:false}),
      dispatch:async()=>({ok:true})};}});
  t.after(async()=>{held.release();await manager.close();});
  const request=extra=>{const s=manager.snapshot();return{expectedEventId:s.expectedEventId,expectedSelection:s.expectedSelection,...extra};};
  const prepared=await manager.prepare(profile.eventId,request());assert.equal(prepared.ok,true,prepared.code);
  const pending=manager.activate(request({candidateId:prepared.candidateId}));await until(()=>state.starts===1);
  await appendTo(store,pm.machine,revoke(pm.machine,m.identityTuple));held.release();
  const outcome=await pending;assert.equal(outcome.ok,false);assert.equal(outcome.code,'ADMISSION_DENIED');
  assert.equal(manager.snapshot().active,null);assert.equal(state.closes,1);
  await appendTo(store,pm.machine,{...confirm(pm.machine,gate.policyFingerprint),identityTuple:[...m.identityTuple],productionWindow:copy(profile.productionWindow)});
  hold=false;const again=await manager.prepare(profile.eventId,request());assert.equal(again.ok,true,again.code);
  const active=await manager.activate(request({candidateId:again.candidateId}));assert.equal(active.ok,true,active.code);
});
