'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const vm=require('node:vm');
const {createGameDayManager}=require('../scripts/lib/game-day-manager.cjs');
const BASE=Date.parse('2026-11-17T12:00:00Z');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
async function until(check){for(let n=0;n<100;n++){if(check())return;await tick();}throw Error('TEST_ENTRY_NOT_REACHED');}
function profile(id){const root=path.join(path.parse(process.cwd()).root,'manager-admission-fixture');return{
  schemaVersion:1,provider:'local-manual',eventId:id,
  productionWindow:{start:new Date(BASE+3600000).toISOString(),end:new Date(BASE+7200000).toISOString()},
  spx:{executable:path.join(root,'node.exe'),args:[path.join(root,'server.js')],cwd:path.join(root,'app')},
  caspar:{executable:path.join(root,'caspar.exe'),cwd:path.join(root,'component'),runtimeDir:path.join(root,'runtime',id)},
  media:{provider:'local-lexical-v1',sourceDir:path.join(root,'media',id),cacheDir:path.join(root,'cache',id),startup:{mode:'source'}},
  rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}}};}
function fixture(t,admitCandidate){
  const runtimes=[],catalog={list:async()=>[],read:async id=>Object.freeze({profile:profile(id),
    descriptor:Object.freeze({eventId:id,displayName:id}),revision:(id==='alpha'?'a':'b').repeat(64)})};
  let now=BASE,clockHook=null;
  const manager=createGameDayManager({catalog,clock:()=>clockHook?clockHook():now,...(admitCandidate===undefined?{}:{admitCandidate}),runtimeFactory:async p=>{
    const r={startCalls:0,closeCalls:0,actions:[],preparing:false,closed:false,ready:false,startHook:null,closeHook:null};
    const api={start(){r.startCalls++;return Promise.resolve().then(()=>r.startHook?.()).then(()=>{if(!r.closed)r.ready=true;});},
      close(){r.closeCalls++;return Promise.resolve().then(()=>r.closeHook?.()).then(()=>{r.closed=true;r.ready=false;});},
      snapshot:()=>({state:r.closed?'closed':r.ready?'ready':'prepared',preparing:r.preparing,ready:r.ready,windowAllowed:false}),
      dispatch:async action=>{r.actions.push(action);return{ok:true};}};
    runtimes.push(r);return api;}});
  const request=extra=>{const s=manager.snapshot();return{expectedEventId:s.expectedEventId,expectedSelection:s.expectedSelection,...extra};};
  const prepare=async id=>{const r=await manager.prepare(id,request());assert.equal(r.ok,true,JSON.stringify(r));return r;};
  const activate=async id=>{const p=await prepare(id);const r=await manager.activate(request({candidateId:p.candidateId}));assert.equal(r.ok,true,JSON.stringify(r));return runtimes.at(-1);};
  t.after(async()=>{for(const r of runtimes){r.closeHook=null;r.startHook=null;r.preparing=false;}await manager.close();});
  return{manager,runtimes,request,prepare,activate,setNow:value=>{now=value;},setClockHook:value=>{clockHook=value;}};
}

test('candidate admission accepts only literal synchronous true and consumes rejected Promises',async t=>{
  for(const decision of [()=>false,()=>undefined,()=>1,()=>({then(){throw Error('MUST_NOT_ASSIMILATE');}}),
    ()=>Promise.resolve(true),()=>Promise.reject(Error('PRIVATE_FAILURE')),()=>vm.runInNewContext('Promise.reject(new Error("PRIVATE_REALM"))'),
    ()=>{throw Error('PRIVATE_THROW');}]){
    const f=fixture(t,decision),r=await f.manager.prepare('alpha',f.request());
    assert.deepEqual(r,{ok:false,code:'ADMISSION_DENIED'});assert.equal(f.runtimes[0].startCalls,0);
    assert.equal(f.runtimes[0].closeCalls,1);assert.equal(f.manager.snapshot().candidate,null);
    assert.ok(!JSON.stringify(f.manager.snapshot()).includes('PRIVATE'));await tick();
  }
});

test('admission dependency is validated without executing accessors',()=>{
  for(const admitCandidate of [false,1,{},null])assert.throws(()=>createGameDayManager({admitCandidate}),{code:'MANAGER_OPTIONS_INVALID'});
  let calls=0;const options={};Object.defineProperty(options,'admitCandidate',{enumerable:true,get(){calls++;return()=>true;}});
  assert.throws(()=>createGameDayManager(options),{code:'MANAGER_OPTIONS_INVALID'});assert.equal(calls,0);
});

test('successful trusted checks receive frozen private context and do not enter public state',async t=>{
  const contexts=[],f=fixture(t,c=>{contexts.push(c);return true;});
  await f.activate('alpha');assert.ok(contexts.length>=5);assert.ok(contexts.every(Object.isFrozen));
  assert.ok(contexts.every(c=>Object.isFrozen(c.profile)&&Object.isFrozen(c.descriptor)&&c.admissionToken===null));
  const publicState=JSON.stringify(f.manager.snapshot());assert.ok(!publicState.includes('admissionToken'));assert.ok(!publicState.includes('executable'));
});

test('denial before activation retains active ownership and does not reserve a new epoch',async t=>{
  let allowed=true;const f=fixture(t,()=>allowed),old=await f.activate('alpha'),p=await f.prepare('beta');
  const epoch=f.manager.snapshot().expectedSelection;allowed=false;
  assert.equal((await f.manager.activate(f.request({candidateId:p.candidateId}))).code,'ADMISSION_DENIED');
  assert.equal(f.manager.snapshot().expectedSelection,epoch);assert.equal(f.manager.snapshot().active.eventId,'alpha');
  assert.equal(old.closeCalls,0);assert.equal(f.runtimes[1].startCalls,0);
});

test('invalidation during awaited old close prevents new start without inventing rollback',async t=>{
  let allowed=true;const f=fixture(t,()=>allowed),old=await f.activate('alpha'),p=await f.prepare('beta'),held=deferred();
  old.closeHook=()=>held.promise;const pending=f.manager.activate(f.request({candidateId:p.candidateId}));
  await until(()=>old.closeCalls===1);allowed=false;held.resolve();
  assert.equal((await pending).code,'ADMISSION_DENIED');assert.equal(f.runtimes[1].startCalls,0);
  assert.equal(old.closed,true);assert.equal(old.startCalls,1);assert.equal(f.manager.snapshot().active,null);
  assert.equal(f.manager.snapshot().candidate.eventId,'beta');
});

test('invalidation during awaited start closes the candidate before any active acknowledgement',async t=>{
  let allowed=true;const f=fixture(t,()=>allowed),p=await f.prepare('alpha'),next=f.runtimes[0],held=deferred();
  next.startHook=()=>held.promise;const pending=f.manager.activate(f.request({candidateId:p.candidateId}));
  await until(()=>next.startCalls===1);allowed=false;held.resolve();
  assert.equal((await pending).code,'ADMISSION_DENIED');assert.equal(next.closeCalls,1);assert.equal(next.closed,true);
  assert.equal(f.manager.snapshot().active,null);assert.equal(f.manager.snapshot().candidate,null);
});

test('failed cleanup after denied start retains the owned failed candidate',async t=>{
  let allowed=true;const f=fixture(t,()=>allowed),p=await f.prepare('alpha'),next=f.runtimes[0];
  next.startHook=()=>{allowed=false;};next.closeHook=()=>Promise.reject(Error('PRIVATE_CLOSE'));
  assert.equal((await f.manager.activate(f.request({candidateId:p.candidateId}))).code,'CLOSE_FAILED');
  assert.equal(f.manager.snapshot().state,'faulted');assert.equal(f.manager.snapshot().candidate.cleanup,'failed');
  assert.equal(f.manager.snapshot().active,null);assert.equal(next.startCalls,1);
});

test('fresh source policy is not consulted by already active playback or Stop',async t=>{
  let allowed=true,calls=0;const f=fixture(t,()=>{calls++;return allowed;}),active=await f.activate('alpha');
  allowed=false;const before=calls;
  assert.equal((await f.manager.dispatch('next',f.request())).ok,true);assert.equal((await f.manager.dispatch('stop',f.request())).ok,true);
  assert.deepEqual(active.actions,['next','stop']);assert.equal(active.closeCalls,0);assert.equal(calls,before);
});

test('active confirmed-window replacement protection remains ahead of candidate admission',async t=>{
  let allowed=true;const f=fixture(t,()=>allowed),active=await f.activate('alpha'),p=await f.prepare('beta');
  f.setNow(BASE+45*60000);allowed=false;
  assert.equal((await f.manager.activate(f.request({candidateId:p.candidateId}))).code,'WINDOW_ACTIVE');
  assert.equal(active.closeCalls,0);assert.equal(f.runtimes[1].startCalls,0);
});

test('synchronous reentrant close from admission cannot publish or start a candidate',async t=>{
  let manager;const f=fixture(t,()=>{void manager.close();return true;});manager=f.manager;
  assert.equal((await manager.prepare('alpha',f.request())).code,'CLOSED');
  assert.equal(f.runtimes[0].startCalls,0);assert.equal(f.runtimes[0].closeCalls,1);assert.equal(manager.snapshot().candidate,null);
});

test('close reentered by final policy check cannot publish a closed candidate',async t=>{
  let armed=false;const f=fixture(t,()=>{armed=true;return true;});
  f.setClockHook(()=>{if(armed){armed=false;void f.manager.close();}return BASE;});
  assert.equal((await f.manager.prepare('alpha',f.request())).code,'CLOSED');
  await until(()=>!f.manager.snapshot().preparing);
  assert.equal(f.manager.snapshot().closed,true);assert.equal(f.manager.snapshot().candidate,null);
  assert.equal(f.runtimes[0].startCalls,0);assert.equal(f.runtimes[0].closed,true);
});

test('crossing active prewarm during admission cannot retire the protected sender',async t=>{
  let armed=false,calls=0,f;
  f=fixture(t,()=>{if(armed&&++calls===2)f.setNow(BASE+45*60000);return true;});
  const active=await f.activate('alpha'),prepared=await f.prepare('beta');armed=true;
  assert.equal((await f.manager.activate(f.request({candidateId:prepared.candidateId}))).code,'WINDOW_ACTIVE');
  assert.equal(active.closeCalls,0);assert.equal(active.closed,false);assert.equal(f.runtimes[1].startCalls,0);
});

// Real source/journal/cache and branded provider token; only native runtime is synthetic.
test('mandatory source admission is rechecked after optional callback closes its owner',async t=>{
  const {fixture:sourceFixture,source,profileFor,providerFor}=require('./exchange-provider-fixtures.cjs');
  const {admitExchangeCandidate}=require('../scripts/lib/exchange-source-provider.cjs');
  const f=await sourceFixture(t),m=source();await f.publish(m);
  const provider=providerFor(t,f),raw=profileFor(f,m);let driver,started=false,closeCalls=0;
  const manager=createGameDayManager({clock:()=>BASE,catalog:{list:async()=>[],read:async()=>Object.freeze({
    profile:raw,descriptor:Object.freeze({eventId:raw.eventId,displayName:'Synthetic source'}),revision:'a'.repeat(64)})},
    admitCandidate:()=>{if(started)driver.close();return true;},
    runtimeFactory:async profile=>{driver=provider.createPreparedMedia(profile);await driver.initial();return{
      candidateAdmissionToken:()=>driver.admissionToken(),start:async()=>{started=true;},
      close:async()=>{closeCalls++;driver.close();},snapshot:()=>({preparing:false,state:'prepared',ready:false,windowAllowed:false}),
      dispatch:async()=>({ok:true})};}});
  t.after(()=>manager.close());
  const request=extra=>{const s=manager.snapshot();return{expectedEventId:s.expectedEventId,expectedSelection:s.expectedSelection,...extra};};
  const prepared=await manager.prepare(raw.eventId,request());assert.equal(prepared.ok,true,JSON.stringify(prepared));
  assert.equal(admitExchangeCandidate(driver.admissionToken()),true);
  const result=await manager.activate(request({candidateId:prepared.candidateId}));
  assert.equal(admitExchangeCandidate(driver.admissionToken()),false);
  assert.equal(result.code,'ADMISSION_DENIED');assert.equal(result.ok,false);
  assert.equal(manager.snapshot().active,null);assert.equal(manager.snapshot().candidate,null);assert.equal(closeCalls,1);
});

for(const invalidateAfterActivation of [false,true])test(`real source cancellation ${invalidateAfterActivation?'retains active control':'denies new activation'}`,async t=>{
  const {fixture:sourceFixture,source,profileFor,providerFor,copy,seal}=require('./exchange-provider-fixtures.cjs');
  const f=await sourceFixture(t),m=source();await f.publish(m);const provider=providerFor(t,f),raw=profileFor(f,m);
  let starts=0;const actions=[];
  const manager=createGameDayManager({clock:()=>BASE,catalog:{list:async()=>[],read:async()=>Object.freeze({profile:raw,
    descriptor:Object.freeze({eventId:raw.eventId,displayName:'Synthetic source'}),revision:'b'.repeat(64)})},
    runtimeFactory:async profile=>{const driver=provider.createPreparedMedia(profile);await driver.initial();return{
      candidateAdmissionToken:()=>driver.admissionToken(),start:async()=>{starts++;},close:async()=>{driver.close();},
      snapshot:()=>({preparing:false,state:'prepared',ready:false,windowAllowed:false}),dispatch:async a=>{actions.push(a);return{ok:true};}};}});
  t.after(()=>manager.close());const request=extra=>{const s=manager.snapshot();return{expectedEventId:s.expectedEventId,expectedSelection:s.expectedSelection,...extra};};
  const prepared=await manager.prepare(raw.eventId,request());assert.equal(prepared.ok,true);
  if(invalidateAfterActivation)assert.equal((await manager.activate(request({candidateId:prepared.candidateId}))).ok,true);
  const cancelled=copy(m);cancelled.generationSequence++;cancelled.event.eligibility={eligible:false,reasonCodes:['CANCELLED']};seal(cancelled);
  await f.publish(cancelled);assert.equal((await provider.refreshCatalog()).ok,true);
  if(invalidateAfterActivation){
    assert.equal((await manager.dispatch('next',request())).ok,true);assert.equal((await manager.dispatch('stop',request())).ok,true);
    assert.deepEqual(actions,['next','stop']);assert.equal(manager.snapshot().active.eventId,raw.eventId);assert.equal(starts,1);
  }else{assert.equal((await manager.activate(request({candidateId:prepared.candidateId}))).code,'ADMISSION_DENIED');assert.equal(starts,0);assert.equal(manager.snapshot().active,null);}
});
