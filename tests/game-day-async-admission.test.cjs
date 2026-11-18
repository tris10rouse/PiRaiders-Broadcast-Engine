'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createGameDayManager}=require('../scripts/lib/game-day-manager.cjs');
const BASE=Date.parse('2026-11-17T12:00:00Z');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function latch(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}
async function until(check){for(let n=0;n<1000;n++){if(check())return;await tick();}throw Error('TEST_BOUNDARY_NOT_REACHED');}
function profile(id){const root=path.join(path.parse(process.cwd()).root,'async-admission-fixture');return{
 schemaVersion:1,provider:'local-manual',eventId:id,productionWindow:{start:new Date(BASE+3600000).toISOString(),end:new Date(BASE+7200000).toISOString()},
 spx:{executable:path.join(root,'node.exe'),args:[path.join(root,'server.js')],cwd:path.join(root,'app')},
 caspar:{executable:path.join(root,'caspar.exe'),cwd:path.join(root,'component'),runtimeDir:path.join(root,'runtime',id)},
 media:{provider:'local-lexical-v1',sourceDir:path.join(root,'source',id),cacheDir:path.join(root,'cache',id),startup:{mode:'source'}},
 rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}}};}
function fixture(t,{refresh=async()=>true,admit,label=id=>id}={}){
 let now=BASE,clockHook=null,hook=refresh,calls=0;const contexts=[],runtimes=[];
 const manager=createGameDayManager({clock:()=>clockHook?clockHook():now,catalog:{list:async()=>[],read:async id=>Object.freeze({profile:profile(id),descriptor:Object.freeze({eventId:id,displayName:label(id)}),revision:'a'.repeat(64)})},
  refreshAdmission:async context=>{calls++;contexts.push(context);return hook(context);},...(admit===undefined?{}:{admitCandidate:admit}),runtimeFactory:async()=>{
   const r={startCalls:0,closeCalls:0,actions:[],closed:false,ready:false,startHook:null,closeHook:null};
   r.api={start:async()=>{r.startCalls++;await r.startHook?.();r.ready=!r.closed;},close:async()=>{r.closeCalls++;await r.closeHook?.();r.closed=true;r.ready=false;},snapshot:()=>({preparing:false,state:r.closed?'closed':r.ready?'ready':'prepared',ready:r.ready,windowAllowed:false}),dispatch:async action=>{r.actions.push(action);return{ok:true};}};
   runtimes.push(r);return r.api;}});
 const request=extra=>{const s=manager.snapshot();return{expectedEventId:s.expectedEventId,expectedSelection:s.expectedSelection,...extra};};
 const prepare=async id=>{const r=await manager.prepare(id,request());assert.equal(r.ok,true,JSON.stringify(r));return r;};
 const activate=async id=>{const p=await prepare(id);const r=await manager.activate(request({candidateId:p.candidateId}));assert.equal(r.ok,true,JSON.stringify(r));return runtimes.at(-1);};
 t.after(async()=>{for(const r of runtimes){r.closeHook=null;r.startHook=null;}await manager.close();});
 return{manager,runtimes,request,prepare,activate,contexts,get calls(){return calls;},setRefresh:value=>{hook=value;},setNow:value=>{now=value;},setClockHook:value=>{clockHook=value;}};
}

test('async admission option rejects wrong types and accessors without running getters',()=>{
 for(const value of [null,false,1,{}])assert.throws(()=>createGameDayManager({refreshAdmission:value}),{code:'MANAGER_OPTIONS_INVALID'});
 let calls=0;const raw={};Object.defineProperty(raw,'refreshAdmission',{enumerable:true,get(){calls++;return async()=>true;}});
 assert.throws(()=>createGameDayManager(raw),{code:'MANAGER_OPTIONS_INVALID'});assert.equal(calls,0);
});

test('only resolved literal true permits refreshed candidate publication',async t=>{
 for(const answer of [false,undefined,1,{},()=>{throw Error('PRIVATE_THROW');},()=>Promise.reject(Error('PRIVATE_REJECT'))])await t.test(typeof answer,async t=>{
  const f=fixture(t,{refresh:typeof answer==='function'?answer:async()=>answer});const r=await f.manager.prepare('alpha',f.request());
  assert.deepEqual(r,{ok:false,code:'ADMISSION_DENIED'});assert.equal(f.runtimes[0].startCalls,0);assert.equal(f.runtimes[0].closeCalls,1);
  assert.equal(f.manager.snapshot().candidate,null);assert.equal(f.manager.snapshot().physicalBarrier,false);assert.equal(JSON.stringify(f.manager.snapshot()).includes('PRIVATE'),false);
 });
});

test('successful refreshes expose frozen private context while active controls never refresh',async t=>{
 const f=fixture(t),r=await f.activate('alpha');assert.equal(f.calls,4);
 for(const context of f.contexts){assert.ok(Object.isFrozen(context)&&Object.isFrozen(context.profile)&&Object.isFrozen(context.descriptor));assert.equal(context.admissionToken,null);}
 f.setRefresh(async()=>{throw Error('ACTIVE_MUST_NOT_REFRESH');});const before=f.calls;
 assert.equal((await f.manager.dispatch('next',f.request())).ok,true);assert.equal((await f.manager.dispatch('stop',f.request())).ok,true);
 assert.equal(f.calls,before);assert.deepEqual(r.actions,['next','stop']);assert.equal(JSON.stringify(f.manager.snapshot()).includes('admissionToken'),false);
});

test('resolved async approval cannot override the existing synchronous policy',async t=>{
 let allowed=true;const f=fixture(t,{admit:()=>allowed,refresh:async()=>{await tick();allowed=false;return true;}});
 assert.equal((await f.manager.prepare('alpha',f.request())).code,'ADMISSION_DENIED');assert.equal(f.runtimes[0].closeCalls,1);assert.equal(f.manager.snapshot().candidate,null);
});

test('active Stop remains immediate while a new candidate refresh is physically pending',async t=>{
 const f=fixture(t),old=await f.activate('alpha'),p=await f.prepare('beta'),held=latch();f.setRefresh(()=>held.promise);
 const pending=f.manager.activate(f.request({candidateId:p.candidateId}));await until(()=>f.manager.snapshot().physicalBarrier);const calls=f.calls;
 assert.equal((await f.manager.dispatch('stop',f.request())).ok,true);assert.deepEqual(old.actions,['stop']);assert.equal(f.calls,calls);assert.equal(old.closeCalls,0);
 held.resolve(false);assert.equal((await pending).code,'ADMISSION_DENIED');assert.equal(f.manager.snapshot().active.eventId,'alpha');
});

test('held factory refresh remains physical ownership after prompt logical close',async t=>{
 const held=latch(),f=fixture(t,{refresh:()=>held.promise});const pending=f.manager.prepare('alpha',f.request());
 await until(()=>f.calls===1);assert.equal(f.manager.snapshot().physicalBarrier,true);
 assert.equal((await f.manager.prepare('beta',f.request())).code,'BUSY');
 const closing=f.manager.close();assert.equal(f.runtimes[0].closeCalls,1);assert.equal((await closing).ok,true);assert.equal((await pending).code,'CLOSED');
 assert.equal(f.manager.snapshot().physicalBarrier,true);assert.equal(f.manager.snapshot().preparing,true);
 held.resolve(true);await until(()=>!f.manager.snapshot().physicalBarrier&&!f.manager.snapshot().preparing);
 assert.equal(f.manager.snapshot().candidate,null);assert.equal(f.runtimes[0].startCalls,0);
});

test('synchronous close reentered by async refresh cannot publish candidate',async t=>{
 let f;f=fixture(t,{refresh:()=>{void f.manager.close();return true;}});
 assert.equal((await f.manager.prepare('alpha',f.request())).code,'CLOSED');assert.equal(f.runtimes[0].closeCalls,1);assert.equal(f.manager.snapshot().candidate,null);
});

test('prewarm crossing while refresh is held cannot retire the protected old sender',async t=>{
 const f=fixture(t),old=await f.activate('alpha'),p=await f.prepare('beta'),held=latch();f.setRefresh(()=>held.promise);
 const pending=f.manager.activate(f.request({candidateId:p.candidateId}));await until(()=>f.manager.snapshot().physicalBarrier);
 f.setNow(BASE+3600000-15*60000);held.resolve(true);const r=await pending;
 assert.equal(r.code,'WINDOW_ACTIVE');assert.equal(old.closeCalls,0);assert.equal(f.runtimes[1].startCalls,0);assert.equal(f.manager.snapshot().active.eventId,'alpha');
});

test('revocation after awaited old close prevents new start and does not invent rollback',async t=>{
 const f=fixture(t),old=await f.activate('alpha'),p=await f.prepare('beta');let allowed=true;
 f.setRefresh(async()=>allowed);old.closeHook=()=>{allowed=false;};
 assert.equal((await f.manager.activate(f.request({candidateId:p.candidateId}))).code,'ADMISSION_DENIED');
 assert.equal(old.closed,true);assert.equal(f.runtimes[1].startCalls,0);assert.equal(f.manager.snapshot().active,null);assert.equal(f.manager.snapshot().candidate.eventId,'beta');
});

test('close reentered by policy after old shutdown cannot mutate the closed manager active pointer',async t=>{
 const f=fixture(t),old=await f.activate('alpha'),p=await f.prepare('beta');let entered=false;
 f.setClockHook(()=>{if(old.closed&&!entered){entered=true;void f.manager.close();}return BASE;});
 assert.equal((await f.manager.activate(f.request({candidateId:p.candidateId}))).code,'CLOSED');
 assert.equal(entered,true);assert.equal(f.manager.snapshot().active?.eventId,'alpha');assert.equal(f.runtimes[1].startCalls,0);
});

test('a new refresh await after retirement still fences the retired event prewarm',async t=>{
 const f=fixture(t),old=await f.activate('alpha'),p=await f.prepare('beta');let calls=0;
 f.setRefresh(async()=>{if(++calls===2)f.setNow(BASE+3600000-15*60000);return true;});
 assert.equal((await f.manager.activate(f.request({candidateId:p.candidateId}))).code,'WINDOW_ACTIVE');
 assert.equal(old.closed,true);assert.equal(f.runtimes[1].startCalls,0);assert.equal(f.manager.snapshot().active,null);
});

test('revocation during start is refreshed before acknowledgement and closes the candidate',async t=>{
 const f=fixture(t),p=await f.prepare('alpha'),next=f.runtimes[0];let allowed=true;
 f.setRefresh(async()=>allowed);next.startHook=()=>{allowed=false;};
 assert.equal((await f.manager.activate(f.request({candidateId:p.candidateId}))).code,'ADMISSION_DENIED');
 assert.equal(next.startCalls,1);assert.equal(next.closeCalls,1);assert.equal(next.closed,true);assert.equal(f.manager.snapshot().active,null);assert.equal(f.manager.snapshot().candidate,null);
});

test('prewarm reached during post-start refresh cleans the new runtime before acknowledgement',async t=>{
 const f=fixture(t),old=await f.activate('alpha'),p=await f.prepare('beta');let calls=0;
 f.setRefresh(async()=>{if(++calls===3)f.setNow(BASE+3600000-15*60000);return true;});
 assert.equal((await f.manager.activate(f.request({candidateId:p.candidateId}))).code,'WINDOW_ACTIVE');
 assert.equal(old.closed,true);assert.equal(f.runtimes[1].startCalls,1);assert.equal(f.runtimes[1].closeCalls,1);assert.equal(f.manager.snapshot().active,null);assert.equal(f.manager.snapshot().candidate,null);
});

test('close during held post-start refresh starts cleanup promptly and retains physical barrier',async t=>{
 const f=fixture(t),p=await f.prepare('alpha'),held=latch();let calls=0;f.setRefresh(()=>++calls===3?held.promise:Promise.resolve(true));
 const pending=f.manager.activate(f.request({candidateId:p.candidateId}));await until(()=>calls===3);
 assert.equal(f.runtimes[0].startCalls,1);assert.equal(f.manager.snapshot().physicalBarrier,true);
 assert.equal((await f.manager.close()).ok,true);assert.equal(f.runtimes[0].closeCalls,1);assert.equal((await pending).code,'CLOSED');assert.equal(f.manager.snapshot().physicalBarrier,true);
 held.resolve(true);await until(()=>!f.manager.snapshot().physicalBarrier);assert.equal(f.manager.snapshot().active,null);
});

test('denied post-start refresh preserves failed cleanup ownership',async t=>{
 const f=fixture(t),p=await f.prepare('alpha'),next=f.runtimes[0];let allowed=true;
 f.setRefresh(async()=>allowed);next.startHook=()=>{allowed=false;};next.closeHook=()=>{throw Error('PRIVATE_CLOSE');};
 assert.equal((await f.manager.activate(f.request({candidateId:p.candidateId}))).code,'CLOSE_FAILED');assert.equal(f.manager.snapshot().candidate.cleanup,'failed');assert.equal(f.manager.snapshot().state,'faulted');assert.equal(f.manager.snapshot().active,null);
});

test('legacy labels keep128 UTF16 bound while source labels use200 codepoints and real branding after refresh',async t=>{
 const legacy=fixture(t,{label:()=> '😀'.repeat(65)});assert.equal((await legacy.manager.prepare('alpha',legacy.request())).code,'CATALOG_INVALID');
 const {fixture:sourceFixture,source,profileFor,providerFor}=require('./exchange-provider-fixtures.cjs');
 const f=await sourceFixture(t),m=source();await f.publish(m);const provider=providerFor(t,f),raw=profileFor(f,m);let driver,started=false,closeCalls=0;
 const label='😀'.repeat(200),manager=createGameDayManager({clock:()=>BASE,catalog:{list:async()=>[],read:async()=>Object.freeze({profile:raw,descriptor:Object.freeze({eventId:raw.eventId,displayName:label}),revision:'b'.repeat(64)})},
  refreshAdmission:async()=>{await Promise.resolve();if(started)driver.close();return true;},runtimeFactory:async p=>{driver=provider.createPreparedMedia(p);await driver.initial();return{
   candidateAdmissionToken:()=>driver.admissionToken(),start:async()=>{started=true;},close:async()=>{closeCalls++;driver.close();},snapshot:()=>({preparing:false,state:'prepared',ready:false}),dispatch:async()=>({ok:true})};}});
 t.after(()=>manager.close());const request=extra=>{const s=manager.snapshot();return{expectedEventId:s.expectedEventId,expectedSelection:s.expectedSelection,...extra};};
 const p=await manager.prepare(raw.eventId,request());assert.equal(p.ok,true,JSON.stringify(p));assert.equal(manager.snapshot().candidate.displayName,label);
 assert.equal((await manager.activate(request({candidateId:p.candidateId}))).code,'ADMISSION_DENIED');assert.equal(closeCalls,1);assert.equal(manager.snapshot().active,null);
 const tooLong=createGameDayManager({catalog:{list:async()=>[],read:async()=>Object.freeze({profile:raw,descriptor:Object.freeze({eventId:raw.eventId,displayName:'😀'.repeat(201)}),revision:'c'.repeat(64)})},runtimeFactory:()=>{throw Error('MUST_NOT_CONSTRUCT');}});
 t.after(()=>tooLong.close());assert.equal((await tooLong.prepare(raw.eventId,{expectedEventId:null,expectedSelection:0})).code,'CATALOG_INVALID');
});

test('queued source invalidation between async helper settlement and caller continuation denies active acknowledgement',async t=>{
 const {fixture:sourceFixture,source,profileFor,providerFor}=require('./exchange-provider-fixtures.cjs');
 const {admitExchangeCandidate}=require('../scripts/lib/exchange-source-provider.cjs');
 const f=await sourceFixture(t),m=source();await f.publish(m);const provider=providerFor(t,f),raw=profileFor(f,m);let driver,refreshCalls=0,closeCalls=0;
 const manager=createGameDayManager({clock:()=>BASE,catalog:{list:async()=>[],read:async()=>Object.freeze({profile:raw,
  descriptor:Object.freeze({eventId:raw.eventId,displayName:'Synthetic source'}),revision:'d'.repeat(64)})},
  // Deliberately return the Promise directly: an async wrapper would introduce
  // another adoption turn and could hide this helper-to-caller scheduling gap.
  refreshAdmission:()=>{if(++refreshCalls!==4)return true;const p=Promise.resolve(true);p.then(()=>queueMicrotask(()=>driver.close()));return p;},
  runtimeFactory:async p=>{driver=provider.createPreparedMedia(p);await driver.initial();return{
   candidateAdmissionToken:()=>driver.admissionToken(),start:async()=>{},close:async()=>{closeCalls++;driver.close();},
   snapshot:()=>({preparing:false,state:'prepared',ready:false}),dispatch:async()=>({ok:true})};}});
 t.after(()=>manager.close());const request=extra=>{const s=manager.snapshot();return{expectedEventId:s.expectedEventId,expectedSelection:s.expectedSelection,...extra};};
 const prepared=await manager.prepare(raw.eventId,request());assert.equal(prepared.ok,true);
 const activated=await manager.activate(request({candidateId:prepared.candidateId}));
 assert.equal(refreshCalls,4);assert.equal(admitExchangeCandidate(driver.admissionToken()),false);
 assert.equal(activated.code,'ADMISSION_DENIED');assert.equal(manager.snapshot().active,null);assert.equal(manager.snapshot().candidate,null);assert.equal(closeCalls,1);
});

test('queued manager close before caller continuation does not invoke passive policy after close',async t=>{
 let manager,refreshCalls=0,closedDuringGap=false,passiveAfterClose=0;
 manager=createGameDayManager({clock:()=>BASE,catalog:{list:async()=>[],read:async()=>Object.freeze({profile:profile('alpha'),descriptor:Object.freeze({eventId:'alpha',displayName:'Alpha'}),revision:'e'.repeat(64)})},
  refreshAdmission:()=>{if(++refreshCalls!==4)return true;const p=Promise.resolve(true);p.then(()=>queueMicrotask(()=>{closedDuringGap=true;void manager.close();}));return p;},
  admitCandidate:()=>{if(closedDuringGap)passiveAfterClose++;return true;},runtimeFactory:async()=>({start:async()=>{},close:async()=>{},snapshot:()=>({preparing:false,state:'prepared',ready:false}),dispatch:async()=>({ok:true})})});
 t.after(()=>manager.close());const request=extra=>{const s=manager.snapshot();return{expectedEventId:s.expectedEventId,expectedSelection:s.expectedSelection,...extra};};
 const prepared=await manager.prepare('alpha',request());assert.equal(prepared.ok,true);
 assert.equal((await manager.activate(request({candidateId:prepared.candidateId}))).code,'CLOSED');await tick();
 assert.equal(closedDuringGap,true);assert.equal(passiveAfterClose,0);assert.equal(manager.snapshot().active,null);
});
test('final policy clock cannot revoke a source after the last mandatory admission check',async t=>{
 const {fixture:sourceFixture,source,profileFor,providerFor}=require('./exchange-provider-fixtures.cjs');
 const {admitExchangeCandidate}=require('../scripts/lib/exchange-source-provider.cjs');
 const f=await sourceFixture(t),m=source();await f.publish(m);const provider=providerFor(t,f),raw=profileFor(f,m);
 let driver,refreshCalls=0,clockRevoked=false,closes=0;
 const manager=createGameDayManager({clock:()=>{if(refreshCalls===4&&!clockRevoked){clockRevoked=true;driver.close();}return BASE;},
  catalog:{list:async()=>[],read:async()=>Object.freeze({profile:raw,descriptor:Object.freeze({eventId:raw.eventId,displayName:'Synthetic source'}),revision:'f'.repeat(64)})},
  refreshAdmission:async()=>{refreshCalls++;return true;},runtimeFactory:async p=>{driver=provider.createPreparedMedia(p);await driver.initial();return{
   candidateAdmissionToken:()=>driver.admissionToken(),start:async()=>{},close:async()=>{closes++;driver.close();},snapshot:()=>({preparing:false,state:'prepared',ready:false}),dispatch:async()=>({ok:true})};}});
 t.after(()=>manager.close());const request=extra=>{const s=manager.snapshot();return{expectedEventId:s.expectedEventId,expectedSelection:s.expectedSelection,...extra};};
 const prepared=await manager.prepare(raw.eventId,request());assert.equal(prepared.ok,true);
 const activated=await manager.activate(request({candidateId:prepared.candidateId}));assert.equal(clockRevoked,true);
 assert.equal(admitExchangeCandidate(driver.admissionToken()),false);assert.equal(activated.code,'ADMISSION_DENIED');
 assert.equal(manager.snapshot().active,null);assert.equal(closes,1);
});
test('late denied activation cleanup cannot clear a closed manager candidate',async t=>{
 for(const kind of ['denied-refresh','clock-invalid','start-failed'])await t.test(kind,async t=>{
  const f=fixture(t),prepared=await f.prepare('alpha'),runtime=f.runtimes[0],held=latch();runtime.closeHook=()=>held.promise;
  if(kind==='denied-refresh')f.setRefresh(async()=>f.calls!==4);
  if(kind==='clock-invalid')f.setClockHook(()=>f.calls>=4?NaN:BASE);
  if(kind==='start-failed')runtime.startHook=()=>{throw Error('SYNTHETIC_START_FAILURE');};
  const pending=f.manager.activate(f.request({candidateId:prepared.candidateId}));await until(()=>runtime.closeCalls===1);
  const closing=f.manager.close();assert.equal((await pending).code,'CLOSED');held.resolve();await closing;await tick();
  assert.equal(f.manager.snapshot().candidate?.candidateId,prepared.candidateId);
  assert.equal(f.manager.snapshot().active,null);assert.equal(runtime.closeCalls,1);
 });
});
test('window callbacks cannot revoke source admission before publication retirement or start',async t=>{
 for(const boundary of ['publication','retirement','start'])await t.test(boundary,async t=>{
  const {fixture:sourceFixture,source,profileFor,providerFor}=require('./exchange-provider-fixtures.cjs');
  const {admitExchangeCandidate}=require('../scripts/lib/exchange-source-provider.cjs');
  const f=await sourceFixture(t),m=source();await f.publish(m);const provider=providerFor(t,f),raw=profileFor(f,m);
  const trigger={publication:5,retirement:6,start:7}[boundary];let refreshCalls=0,revoked=false,driver;
  const old={starts:0,closes:0},next={starts:0,closes:0};
  const manager=createGameDayManager({clock:()=>{if(refreshCalls===trigger&&!revoked){revoked=true;driver.close();}return BASE;},
   catalog:{list:async()=>[],read:async id=>Object.freeze({profile:id==='old'?profile('old'):raw,
    descriptor:Object.freeze({eventId:id,displayName:id}),revision:'a'.repeat(64)})},refreshAdmission:async()=>{refreshCalls++;return true;},
   runtimeFactory:async p=>{const state=p.provider==='exchange-v1'?next:old;if(state===next){driver=provider.createPreparedMedia(p);await driver.initial();}
    return{...(state===next?{candidateAdmissionToken:()=>driver.admissionToken()}:{}),start:async()=>{state.starts++;},
     close:async()=>{state.closes++;if(state===next)driver.close();},snapshot:()=>({preparing:false,state:'prepared',ready:false}),dispatch:async()=>({ok:true})};}});
  t.after(()=>manager.close());const request=extra=>{const s=manager.snapshot();return{expectedEventId:s.expectedEventId,expectedSelection:s.expectedSelection,...extra};};
  const initial=await manager.prepare('old',request());assert.equal(initial.ok,true);assert.equal((await manager.activate(request({candidateId:initial.candidateId}))).ok,true);
  const candidate=await manager.prepare(raw.eventId,request());
  if(boundary==='publication')assert.equal(candidate.code,'ADMISSION_DENIED');
  else{assert.equal(candidate.ok,true);assert.equal((await manager.activate(request({candidateId:candidate.candidateId}))).code,'ADMISSION_DENIED');}
  assert.equal(revoked,true);assert.equal(admitExchangeCandidate(driver.admissionToken()),false);assert.equal(next.starts,0);
  assert.equal(old.closes,boundary==='start'?1:0,'no old retirement after its replacement was revoked');
 });
});
