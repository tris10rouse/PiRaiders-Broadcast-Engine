'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createGameDayManager}=require('../scripts/lib/game-day-manager.cjs');
const {normalizeWindow,senderAllowed}=require('../scripts/lib/production-window.cjs');
const BASE=Date.parse('2026-11-15T12:00:00Z');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){const end=Date.now()+3000;while(!fn()){if(Date.now()>=end)throw Error('Manager fixture timeout');await wait(5);}}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const req=(manager,extra={})=>{const s=manager.snapshot();return{expectedEventId:s.expectedEventId,expectedSelection:s.expectedSelection,...extra};};
function profile(eventId){const root=path.join(path.parse(process.cwd()).root,'private-student-fixture');return {schemaVersion:1,provider:'local-manual',eventId,
 productionWindow:{start:new Date(BASE+3600000).toISOString(),end:new Date(BASE+7200000).toISOString()},
 spx:{executable:path.join(root,'node.exe'),args:[path.join(root,'server.js')],cwd:path.join(root,'app')},
 caspar:{executable:path.join(root,'caspar.exe'),cwd:path.join(root,'component'),runtimeDir:path.join(root,'runtime',eventId)},
 media:{provider:'local-lexical-v1',sourceDir:path.join(root,'media',eventId),cacheDir:path.join(root,'cache',eventId),startup:{mode:'source'}},
 rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}}};}
function entry(id,revision=id==='alpha'?'a':'b'){return Object.freeze({profile:profile(id),descriptor:Object.freeze({eventId:id,displayName:'Game '+id}),revision:revision.repeat(64)});}
function fixture(t,managerOptions={}){
 const f={now:BASE,entries:new Map([['alpha',entry('alpha')],['beta',entry('beta')]]),runtimes:[],reads:[],factoryCalls:[],listHook:null,readHook:null,factoryHook:null};
 const catalog={list:async()=>f.listHook?f.listHook():Object.freeze([...f.entries.values()].map(value=>Object.freeze({...value.descriptor,status:'available'}))),read:async id=>{f.reads.push(id);if(f.readHook)return f.readHook(id);return f.entries.get(id);}};
 function makeRuntime(p){const r={profile:p,state:'prepared',preparing:false,ready:false,startCalls:0,closeCalls:0,actions:[],startHook:null,closeHook:null,dispatchHook:null,snapshotHook:null,closed:false};
  r.api={start(){r.startCalls++;r.state='starting';return Promise.resolve().then(()=>r.startHook?r.startHook():undefined).then(()=>{if(!r.closed){r.state='ready';r.ready=true;}});},
   close(){r.closeCalls++;r.state='closing';const stopping=r.closeHook?r.closeHook():undefined;return Promise.resolve(stopping).then(()=>{r.closed=true;r.ready=false;r.state='closed';});},
   snapshot(){if(r.snapshotHook)return r.snapshotHook();return {eventId:p.eventId,state:r.state,lastError:null,ready:r.ready,preparing:r.preparing,mode:'manual',index:r.ready?0:null,windowAllowed:senderAllowed(normalizeWindow(p.productionWindow),f.now),output:'none'};},
   dispatch(action){r.actions.push(action);return r.dispatchHook?r.dispatchHook(action):Promise.resolve({ok:true,secret:'/private-student-fixture/not-public'});}};
  f.runtimes.push(r);return r;
 }
 f.makeRuntime=makeRuntime;
 f.manager=createGameDayManager({catalog,clock:()=>f.now,runtimeFactory:async(p,options)=>{f.factoryCalls.push({profile:p,options});return f.factoryHook?f.factoryHook(p,options):makeRuntime(p).api;},...managerOptions});
 t.after(async()=>{for(const r of f.runtimes){r.startHook=null;r.closeHook=null;r.preparing=false;r.snapshotHook=null;}await f.manager.close();});
 f.prepare=async id=>{const value=await f.manager.prepare(id,req(f.manager));assert.equal(value.ok,true,JSON.stringify(value));return value;};
 f.activate=async id=>{const prepared=await f.prepare(id);const value=await f.manager.activate(req(f.manager,{candidateId:prepared.candidateId}));assert.equal(value.ok,true,JSON.stringify(value));return f.runtimes.at(-1);};
 return f;
}

test('frozen catalog/profile revision prepares without startup and activates exactly one sender-only runtime',async t=>{
 const f=fixture(t),m=f.manager;assert.equal(m.snapshot().state,'idle');const listed=await m.listEvents();assert.equal(listed.ok,true);assert.equal(listed.events.length,2);assert.ok(Object.isFrozen(listed.events));
 const first=await f.prepare('alpha'),r=f.runtimes[0];assert.equal(r.startCalls,0);assert.equal(m.snapshot().state,'prepared');assert.match(first.candidateId,/^[a-f0-9]{48}$/);assert.ok(Object.isFrozen(f.factoryCalls[0].profile));assert.ok(Object.isFrozen(f.factoryCalls[0].profile.media));assert.equal(f.factoryCalls[0].options.manageSpx,false);
 const revised=entry('alpha','c');revised.profile.playback={mode:'manual',intervalMs:20000};f.entries.set('alpha',revised);
 const before=req(m);const activation=m.activate({...before,candidateId:first.candidateId});assert.equal(m.snapshot().expectedSelection,1,'epoch reserves synchronously');assert.equal((await activation).ok,true);assert.equal(r.startCalls,1);assert.equal(m.snapshot().active.revision,'a'.repeat(64));assert.equal(r.profile.playback.intervalMs,10000);assert.equal(r.profile.productionWindow.prewarmMinutes,15);
 assert.equal((await m.dispatch('next',before)).code,'STALE_SELECTION');assert.equal((await m.dispatch('stop',req(m))).ok,true);assert.equal(r.closeCalls,0);assert.deepEqual(r.actions,['stop']);
 const text=JSON.stringify(m.snapshot());assert.ok(!text.includes('private-student'));assert.ok(!text.includes('executable'));assert.ok(!text.includes('secret'));assert.equal(m.snapshot().receiverVerified,false);assert.equal(m.snapshot().boardVerified,false);
});

test('strict request and candidate schemas reject stale or hidden fields without reads/factory/start',async t=>{
 const f=fixture(t),m=f.manager;const good=req(m),accessor={expectedEventId:null};Object.defineProperty(accessor,'expectedSelection',{enumerable:true,get(){throw Error('must not run');}});
 for(const raw of [null,undefined,{},[],{...good,extra:1},{...good,expectedSelection:'0'},{...good,expectedEventId:'../secret'},accessor])assert.equal((await m.prepare('alpha',raw)).code,'INVALID_REQUEST');
 for(const id of ['',1,'Alpha','a/b','../alpha','x'.repeat(65)])assert.equal((await m.prepare(id,good)).code,'INVALID_REQUEST');
 assert.equal((await m.prepare('alpha',{...good,expectedSelection:1})).code,'STALE_SELECTION');assert.equal((await m.dispatch('AUTO',good)).code,'INVALID_REQUEST');assert.equal((await m.dispatch('stop',good)).code,'NOT_READY');assert.equal(f.reads.length,0);
 const p=await f.prepare('alpha');assert.equal((await m.activate({...good,candidateId:'invalid'})).code,'INVALID_REQUEST');assert.equal((await m.activate({...good,candidateId:'f'.repeat(48)})).code,'STALE_CANDIDATE');assert.equal((await m.discardCandidate({...good,candidateId:p.candidateId,extra:true})).code,'INVALID_REQUEST');assert.equal(f.runtimes[0].startCalls,0);
});

test('selecting the same event again still fences the previous active epoch',async t=>{
 const f=fixture(t),m=f.manager;const first=await f.activate('alpha'),old=req(m),p=await f.prepare('alpha');assert.equal((await m.activate(req(m,{candidateId:p.candidateId}))).ok,true);
 assert.equal(first.closeCalls,1);assert.equal(f.runtimes[1].startCalls,1);assert.equal(m.snapshot().expectedSelection,2);assert.equal((await m.dispatch('launch',old)).code,'STALE_SELECTION');assert.equal((await m.dispatch('launch',req(m))).ok,true);
});

test('active and default-prewarm windows refuse prepare/replacement regardless of black, unready or crashed status',async t=>{
 const f=fixture(t),m=f.manager,r=await f.activate('alpha'),p=await f.prepare('beta');
 f.now=BASE+45*60000;for(const state of ['ready','waiting','starting','closed']){r.state=state;r.ready=false;assert.equal((await m.prepare('beta',req(m))).code,'WINDOW_ACTIVE');assert.equal((await m.activate(req(m,{candidateId:p.candidateId}))).code,'WINDOW_ACTIVE');}
 assert.equal(r.closeCalls,0);assert.equal(f.runtimes[1].startCalls,0);assert.equal((await m.dispatch('stop',req(m))).ok,true);assert.equal(r.closeCalls,0);
 f.now=BASE+7200000;assert.equal((await m.activate(req(m,{candidateId:p.candidateId}))).ok,true);
});

test('initial event may activate in its own allowed production window',async t=>{
 const f=fixture(t);f.now=BASE+3600000;const r=await f.activate('alpha');assert.equal(r.startCalls,1);assert.equal(f.manager.snapshot().active.runtime.windowAllowed,true);
});

test('one pending catalog/factory flight rejects excess lifecycle requests while Stop remains independent',async t=>{
 const f=fixture(t),m=f.manager,r=await f.activate('alpha'),gate=deferred();let entered=false;
 f.factoryHook=p=>{entered=true;return gate.promise;};const preparing=m.prepare('beta',req(m));await until(()=>entered);
 assert.equal((await m.prepare('alpha',req(m))).code,'BUSY');assert.equal((await m.discardCandidate(req(m,{candidateId:'a'.repeat(48)}))).code,'BUSY');assert.equal(f.factoryCalls.length,2);
 assert.equal((await m.dispatch('stop',req(m))).ok,true);assert.deepEqual(r.actions,['stop']);assert.equal(r.closeCalls,0);const next=f.makeRuntime(profile('beta'));gate.resolve(next.api);assert.equal((await preparing).ok,true);assert.equal(next.startCalls,0);
});

test('active preparing and unknown status fail closed without starting a second preparation or sender',async t=>{
 const f=fixture(t),m=f.manager,r=await f.activate('alpha'),p=await f.prepare('beta');r.preparing=true;
 assert.equal((await m.prepare('beta',req(m))).code,'BUSY');assert.equal((await m.activate(req(m,{candidateId:p.candidateId}))).code,'BUSY');assert.equal(r.closeCalls,0);
 r.preparing=false;r.snapshotHook=()=>{throw Error('/private/student');};assert.equal((await m.prepare('beta',req(m))).code,'BUSY');assert.equal(m.snapshot().active.runtime.lastError,'STATE_UNAVAILABLE');assert.ok(!JSON.stringify(m.snapshot()).includes('/private'));
 r.snapshotHook=null;assert.equal((await m.activate(req(m,{candidateId:p.candidateId}))).ok,true);
});

test('confirmed old shutdown with ignored staging retains a retired barrier until physical settlement',async t=>{
 const f=fixture(t),m=f.manager,r=await f.activate('alpha'),p=await f.prepare('beta');r.closeHook=()=>{r.preparing=true;};
 assert.equal((await m.activate(req(m,{candidateId:p.candidateId}))).code,'BUSY');assert.equal(r.closeCalls,1);assert.equal(f.runtimes[1].startCalls,0);assert.equal(m.snapshot().physicalBarrier,true);
 assert.equal((await m.prepare('alpha',req(m))).code,'BUSY');assert.equal((await m.activate(req(m,{candidateId:p.candidateId}))).code,'BUSY');
 r.preparing=false;assert.equal((await m.activate(req(m,{candidateId:p.candidateId}))).ok,true);assert.equal(r.closeCalls,1);assert.equal(f.runtimes[1].startCalls,1);assert.equal(m.snapshot().retired,0);
});

test('failed old close retains ownership and candidate, retries the same runtime before any new start',async t=>{
 const f=fixture(t),m=f.manager,r=await f.activate('alpha'),p=await f.prepare('beta');r.closeHook=()=>Promise.reject(Error('/private/denied'));
 assert.equal((await m.activate(req(m,{candidateId:p.candidateId}))).code,'CLOSE_FAILED');assert.equal(m.snapshot().active.eventId,'alpha');assert.equal(m.snapshot().active.cleanup,'failed');assert.equal(f.runtimes[1].startCalls,0);
 r.closeHook=null;assert.equal((await m.activate(req(m,{candidateId:p.candidateId}))).ok,true);assert.equal(r.closeCalls,2);assert.equal(f.runtimes[1].startCalls,1);assert.equal(m.snapshot().lastError,null);
});

test('failed candidate start and failed cleanup block restart until explicit successful cleanup retry',async t=>{
 const f=fixture(t),m=f.manager,p=await f.prepare('alpha'),r=f.runtimes[0];r.startHook=()=>Promise.reject(Error('/private/start'));r.closeHook=()=>Promise.reject(Error('/private/close'));
 assert.equal((await m.activate(req(m,{candidateId:p.candidateId}))).code,'CLOSE_FAILED');assert.equal(m.snapshot().candidate.cleanup,'failed');assert.equal(r.startCalls,1);assert.equal((await m.activate(req(m,{candidateId:p.candidateId}))).code,'CANDIDATE_CLOSED');assert.equal(r.startCalls,1);
 r.closeHook=null;assert.equal((await m.discardCandidate(req(m,{candidateId:p.candidateId}))).ok,true);assert.equal(r.closeCalls,2);assert.equal(m.snapshot().candidate,null);assert.equal((await f.prepare('beta')).ok,true);
});

test('successful cleanup after start failure permits fresh preparation without resurrecting failed candidate',async t=>{
 const f=fixture(t),m=f.manager,p=await f.prepare('alpha'),r=f.runtimes[0];r.startHook=()=>{throw Error('failed');};assert.equal((await m.activate(req(m,{candidateId:p.candidateId}))).code,'START_FAILED');assert.equal(r.closeCalls,1);assert.equal(m.snapshot().active,null);assert.equal(m.snapshot().candidate,null);assert.equal((await f.prepare('beta')).ok,true);assert.equal(r.startCalls,1);
});

test('replacing an unused candidate waits confirmed disposal; failures retain candidate and block factory',async t=>{
 const f=fixture(t),m=f.manager,p=await f.prepare('alpha'),r=f.runtimes[0],gate=deferred();r.closeHook=()=>gate.promise;const replacing=m.prepare('beta',req(m));await until(()=>r.closeCalls===1);assert.equal(f.factoryCalls.length,1);assert.equal((await m.prepare('alpha',req(m))).code,'BUSY');
 gate.reject(Error('denied'));assert.equal((await replacing).code,'CLOSE_FAILED');assert.equal(m.snapshot().candidate.candidateId,p.candidateId);r.closeHook=null;assert.equal((await f.prepare('beta')).ok,true);assert.equal(r.closeCalls,2);assert.equal(f.factoryCalls.length,2);
});

test('close begins active native cleanup immediately and cancels logically while an ignored factory remains physical',async t=>{
 const f=fixture(t),m=f.manager,r=await f.activate('alpha'),gate=deferred();let entered=false;f.factoryHook=()=>{entered=true;return gate.promise;};const preparing=m.prepare('beta',req(m));await until(()=>entered);
 const closing=m.close();assert.equal(r.closeCalls,1,'native cleanup begins in close calling turn');assert.strictEqual(m.close(),closing);assert.equal((await preparing).code,'CLOSED');assert.equal((await closing).ok,true);assert.equal(m.snapshot().preparing,true);assert.equal(m.snapshot().closed,true);
 const late=f.makeRuntime(profile('beta'));gate.resolve(late.api);await until(()=>late.closeCalls===1&&!m.snapshot().preparing);assert.equal(late.startCalls,0);assert.equal(m.snapshot().candidate,null);assert.equal(m.snapshot().active.runtime.ready,false);assert.equal((await m.prepare('alpha',req(m))).code,'CLOSED');
});

test('late factory cleanup failure is retained and repeated manager close retries cleanup',async t=>{
 const f=fixture(t),m=f.manager,gate=deferred();let entered=false;f.factoryHook=()=>{entered=true;return gate.promise;};const preparing=m.prepare('alpha',req(m));await until(()=>entered);assert.equal((await m.close()).ok,true);assert.equal((await preparing).code,'CLOSED');
 const late=f.makeRuntime(profile('alpha'));late.closeHook=()=>Promise.reject(Error('/private/cleanup'));gate.resolve(late.api);await until(()=>!m.snapshot().preparing);assert.equal(m.snapshot().lastError,'CLOSE_FAILED');assert.equal(m.snapshot().state,'faulted');assert.equal(m.snapshot().retired,1);
 late.closeHook=null;assert.equal((await m.close()).ok,true);assert.equal(late.closeCalls,2);assert.equal(m.snapshot().retired,0);
});

test('application close retries failed active shutdown and never stops an unowned application service',async t=>{
 const f=fixture(t),m=f.manager,r=await f.activate('alpha');r.closeHook=()=>Promise.reject(Error('denied'));const first=m.close();assert.equal(r.closeCalls,1);assert.equal((await first).code,'CLOSE_FAILED');assert.equal(m.snapshot().active.cleanup,'failed');
 r.closeHook=null;assert.equal((await m.close()).ok,true);assert.equal(r.closeCalls,2);assert.ok(f.factoryCalls.every(call=>call.options.manageSpx===false));assert.equal((await m.dispatch('stop',req(m))).code,'CLOSED');
});

test('close while old stop is pending cancels activation and starts candidate cleanup without awaiting old',async t=>{
 const f=fixture(t),m=f.manager,r=await f.activate('alpha'),p=await f.prepare('beta'),next=f.runtimes[1],gate=deferred();r.closeHook=()=>gate.promise;
 const activation=m.activate(req(m,{candidateId:p.candidateId}));await until(()=>r.closeCalls===1);const closing=m.close();assert.equal(next.closeCalls,1);assert.equal(r.closeCalls,1);assert.equal((await activation).code,'CLOSED');gate.resolve();assert.equal((await closing).ok,true);await wait(10);assert.equal(next.startCalls,0);assert.equal(m.snapshot().candidate.runtime.ready,false);
});

test('Stop dispatch enters candidate independently while activation start is pending; close fences its late completion',async t=>{
 const f=fixture(t),m=f.manager,p=await f.prepare('alpha'),r=f.runtimes[0],gate=deferred();r.startHook=()=>gate.promise;const activation=m.activate(req(m,{candidateId:p.candidateId}));await until(()=>r.startCalls===1);
 assert.equal((await m.dispatch('next',req(m))).code,'NOT_READY');assert.equal((await m.dispatch('stop',req(m))).ok,true);assert.deepEqual(r.actions,['stop']);const closing=m.close();assert.equal(r.closeCalls,1);assert.equal((await activation).code,'CLOSED');await closing;gate.resolve();await until(()=>m.snapshot().operation===null);assert.equal(m.snapshot().active,null);assert.equal(r.startCalls,1);assert.equal(r.closeCalls,1);
});

test('policy is rechecked after catalog read and factory settlement cross into prewarm',async t=>{
 for(const phase of ['catalog','factory']){
  const f=fixture(t),m=f.manager,r=await f.activate('alpha'),gate=deferred();let entered=false;
  if(phase==='catalog')f.readHook=id=>{entered=true;return gate.promise;};else f.factoryHook=()=>{entered=true;return gate.promise;};
  const preparing=m.prepare('beta',req(m));await until(()=>entered);f.now=BASE+45*60000;
  let late;if(phase==='catalog')gate.resolve(f.entries.get('beta'));else{late=f.makeRuntime(profile('beta'));gate.resolve(late.api);}
  assert.equal((await preparing).code,'WINDOW_ACTIVE');assert.equal(r.closeCalls,0);assert.equal(m.snapshot().candidate,null);if(late){assert.equal(late.closeCalls,1);assert.equal(late.startCalls,0);}else assert.equal(f.factoryCalls.length,1);
 }
});

test('policy is rechecked after candidate disposal and old stop before any replacement factory/start',async t=>{
 for(const phase of ['dispose','stop']){
  const f=fixture(t),m=f.manager,r=await f.activate('alpha'),p=await f.prepare('beta'),next=f.runtimes[1],gate=deferred();let pending;
  if(phase==='dispose'){next.closeHook=()=>gate.promise;pending=m.prepare('alpha',req(m));await until(()=>next.closeCalls===1);}else{r.closeHook=()=>gate.promise;pending=m.activate(req(m,{candidateId:p.candidateId}));await until(()=>r.closeCalls===1);}
  f.now=BASE+45*60000;gate.resolve();assert.equal((await pending).code,'WINDOW_ACTIVE');assert.equal(next.startCalls,0);assert.equal(f.factoryCalls.length,2);
 }
});

test('catalog/option errors and arbitrary runtime errors remain bounded and sanitized',async t=>{
 for(const options of [null,{}, {catalog:{list(){},read(){}} ,runtimeFactory:false}])assert.throws(()=>createGameDayManager(options),error=>error.code==='MANAGER_OPTIONS_INVALID'||error instanceof TypeError);
 const f=fixture(t),m=f.manager;f.listHook=()=>[{eventId:'alpha',displayName:'/x',secret:'private'}];assert.equal((await m.listEvents()).code,'CATALOG_INVALID');f.listHook=()=>Array.from({length:129},()=>({eventId:'alpha',displayName:'x'}));assert.equal((await m.listEvents()).code,'CATALOG_INVALID');
 for(const bad of [undefined,{}, {...entry('alpha')},Object.freeze({...entry('alpha'),revision:'secret'}),Object.freeze({...entry('alpha'),profile:{...profile('alpha'),manageSpx:false}}),Object.freeze({...entry('alpha'),descriptor:{eventId:'beta',displayName:'Mismatch'}})]){f.readHook=()=>bad;assert.equal((await m.prepare('alpha',req(m))).code,'CATALOG_INVALID');}
 assert.equal(f.factoryCalls.length,0);f.readHook=null;f.factoryHook=()=>{throw Error('/private/student');};assert.equal((await m.prepare('alpha',req(m))).code,'PREPARE_FAILED');assert.ok(!JSON.stringify(m.snapshot()).includes('/private'));
 f.factoryHook=null;const r=await f.activate('alpha');r.dispatchHook=()=>({ok:false,code:'/private/student'});assert.equal((await m.dispatch('next',req(m))).code,'COMMAND_FAILED');r.dispatchHook=()=>{throw Error('/private/student');};assert.equal((await m.dispatch('stop',req(m))).code,'COMMAND_FAILED');
});

test('invalid clock fails closed for preparation/replacement while shutdown remains available',async t=>{
 const f=fixture(t),m=f.manager;f.now=NaN;assert.equal((await m.prepare('alpha',req(m))).code,'CLOCK_INVALID');assert.equal(f.factoryCalls.length,0);f.now=BASE;await f.activate('alpha');const p=await f.prepare('beta');f.now=Infinity;assert.equal((await m.activate(req(m,{candidateId:p.candidateId}))).code,'CLOCK_INVALID');assert.equal((await m.close()).ok,true);
});

test('reentrant close from factory/start/native cleanup cannot publish a late active runtime or duplicate cleanup',async t=>{
 for(const phase of ['factory','start','close']){
  const f=fixture(t),m=f.manager;let nested;
  if(phase==='factory'){f.factoryHook=p=>{nested=m.close();return f.makeRuntime(p).api;};const preparing=m.prepare('alpha',req(m));assert.equal((await preparing).code,'CLOSED');await nested;await until(()=>!m.snapshot().preparing);}
  else{const p=await f.prepare('alpha'),r=f.runtimes[0];if(phase==='start'){r.startHook=()=>{nested=m.close();};const activating=m.activate(req(m,{candidateId:p.candidateId}));assert.equal((await activating).code,'CLOSED');await nested;await until(()=>m.snapshot().operation===null);}
   else{r.closeHook=()=>{nested=m.close();};const closing=m.close();assert.strictEqual(nested,closing);await closing;}}
  assert.equal(m.snapshot().active,null);assert.ok(f.runtimes.every(r=>r.closeCalls===1));
 }
});

test('failed disposal of an invalid retired factory result is retried before any later factory invocation',async t=>{
 const f=fixture(t),m=f.manager;let invalid;f.factoryHook=p=>{invalid=f.makeRuntime(p);delete invalid.api.dispatch;invalid.closeHook=()=>Promise.reject(Error('denied'));return invalid.api;};
 assert.equal((await m.prepare('alpha',req(m))).code,'CLOSE_FAILED');assert.equal(m.snapshot().retired,1);assert.equal(m.snapshot().state,'faulted');
 f.factoryHook=null;assert.equal((await m.prepare('beta',req(m))).code,'CLOSE_FAILED');assert.equal(f.factoryCalls.length,1);assert.equal(invalid.closeCalls,2);
 invalid.closeHook=null;assert.equal((await f.prepare('beta')).ok,true);assert.equal(invalid.closeCalls,3);assert.equal(f.factoryCalls.length,2);assert.equal(m.snapshot().retired,0);
});

test('catalog invalid-row summaries remain fixed, bounded and unselectable without poisoning valid rows',async t=>{
 const f=fixture(t),m=f.manager;f.listHook=()=>Object.freeze([
  Object.freeze({eventId:'alpha',displayName:'Game alpha',status:'available'}),
  Object.freeze({eventId:'broken-event',displayName:'Unavailable event',status:'invalid',code:'CATALOG_INVALID'}),
  Object.freeze({eventId:null,displayName:'Unavailable event',status:'invalid',code:'CATALOG_INVALID'}),
  Object.freeze({eventId:null,displayName:'Unavailable event',status:'invalid',code:'CATALOG_INVALID'})]);
 const listed=await m.listEvents();assert.equal(listed.ok,true);assert.equal(listed.events.length,4);assert.ok(listed.events.every(Object.isFrozen));assert.equal((await m.prepare(null,req(m))).code,'INVALID_REQUEST');
 f.listHook=()=>[{eventId:'alpha',displayName:'Game',status:'available'},{eventId:'alpha',displayName:'Unavailable event',status:'invalid',code:'CATALOG_INVALID'}];assert.equal((await m.listEvents()).code,'CATALOG_INVALID');
});


test('sourceRoot is trusted optional absolute metadata, validated before catalog access and forwarded outside profile JSON',async t=>{
 const sourceRoot=path.join(path.parse(process.cwd()).root,'trusted-media-root'),f=fixture(t,{sourceRoot});await f.prepare('alpha');assert.equal(f.factoryCalls[0].options.sourceRoot,sourceRoot);assert.equal(Object.hasOwn(f.factoryCalls[0].profile,'sourceRoot'),false);
 const legacy=fixture(t);await legacy.prepare('alpha');assert.equal(Object.hasOwn(legacy.factoryCalls[0].options,'sourceRoot'),false);
 let touches=0;const catalog={get list(){touches++;throw Error('must validate root first');},get read(){touches++;throw Error('must validate root first');}};
 for(const value of [null,0,{},[],false,'','relative','/bad\0root','/bad\nroot','/'+ 'a'.repeat(4096)])assert.throws(()=>createGameDayManager({catalog,sourceRoot:value}),{code:'MANAGER_OPTIONS_INVALID'});
 assert.equal(touches,0);for(const options of [{catalog:{list(){},read(){}},extra:true},{get catalog(){throw Error('must not run');}}])assert.throws(()=>createGameDayManager(options),{code:'MANAGER_OPTIONS_INVALID'});
});


test('late factory cleanup failure is not erased by completion of an earlier pending application close',async t=>{
 const f=fixture(t),m=f.manager,r=await f.activate('alpha'),factory=deferred(),native=deferred();let entered=false;
 f.factoryHook=()=>{entered=true;return factory.promise;};const preparing=m.prepare('beta',req(m));await until(()=>entered);r.closeHook=()=>native.promise;const closing=m.close();assert.equal((await preparing).code,'CLOSED');
 const late=f.makeRuntime(profile('beta'));late.closeHook=()=>Promise.reject(Error('late cleanup denied'));factory.resolve(late.api);await until(()=>late.closeCalls===1&&!m.snapshot().preparing);assert.strictEqual(m.close(),closing,'failure cannot unreserve an ongoing close');
 native.resolve();assert.equal((await closing).code,'CLOSE_FAILED');assert.equal(m.snapshot().lastError,'CLOSE_FAILED');late.closeHook=null;assert.equal((await m.close()).ok,true);assert.equal(late.closeCalls,2);assert.equal(m.snapshot().lastError,null);
});


test('invalid factory facade is owned and disposed even when a method accessor throws',async t=>{
 const f=fixture(t),m=f.manager;let bad;f.factoryHook=p=>{bad=f.makeRuntime(p);Object.defineProperty(bad.api,'dispatch',{get(){throw Error('/private/runtime');}});return bad.api;};assert.equal((await m.prepare('alpha',req(m))).code,'RUNTIME_INVALID');assert.equal(bad.closeCalls,1);assert.equal(m.snapshot().retired,0);assert.equal(m.snapshot().candidate,null);assert.ok(!JSON.stringify(m.snapshot()).includes('/private'));
 f.factoryHook=null;assert.equal((await f.prepare('beta')).ok,true);
});


test('shared preparation admission closes before the initial factory flight and stays fenced across shutdown',async t=>{
 const f=fixture(t),m=f.manager;await f.activate('alpha');const oldGate=f.factoryCalls[0].options.canPrepare;assert.equal(typeof oldGate,'function');assert.equal(oldGate(),true);
 const gate=deferred();let entered=false;f.factoryHook=(_profile,options)=>{entered=true;assert.equal(options.canPrepare(),false);return gate.promise;};const preparing=m.prepare('beta',req(m));assert.equal(oldGate(),false,'factory admission reserved in caller turn');await until(()=>entered);
 f.now=BASE+45*60000;assert.equal(oldGate(),false,'old direct transport cannot prepare as prewarm opens');const late=f.makeRuntime(profile('beta'));gate.resolve(late.api);assert.equal((await preparing).code,'WINDOW_ACTIVE');assert.equal(oldGate(),true);assert.equal(late.closeCalls,1);
 await m.close();assert.equal(oldGate(),false,'closed manager never reopens source staging');
});


test('private root boundaries are strict, copied/frozen trusted options requiring an explicit source root',async t=>{
 const volume=path.parse(process.cwd()).root,sourceRoot=path.join(volume,'public-media'),privateRoots=['cache','runtime','catalog'].map(name=>path.join(volume,name));
 const f=fixture(t,{sourceRoot,privateRoots});privateRoots[0]=path.join(volume,'changed-after-construction');await f.prepare('alpha');const sent=f.factoryCalls[0].options.privateRoots;assert.ok(Object.isFrozen(sent));assert.equal(sent[0],path.join(volume,'cache'));assert.equal(Object.hasOwn(f.factoryCalls[0].profile,'privateRoots'),false);
 let touches=0;const catalog={get list(){touches++;throw Error('must validate private roots first');},get read(){touches++;throw Error('must not read');}},hidden=[path.join(volume,'x')];Object.defineProperty(hidden,'0',{enumerable:true,get(){touches++;throw Error('must not run');}});
 for(const value of [null,1,{},'relative',new Array(1),[null],['relative'],[path.join(volume,'a')+'\0'],Array.from({length:4},()=>path.join(volume,'x')),hidden])assert.throws(()=>createGameDayManager({catalog,sourceRoot,privateRoots:value}),{code:'MANAGER_OPTIONS_INVALID'});
 assert.throws(()=>createGameDayManager({catalog,privateRoots:[path.join(volume,'cache')]}),{code:'MANAGER_OPTIONS_INVALID'});assert.equal(touches,0);
});


test('one held inventory flight coalesces one hundred callers into the same promise and immutable result',async t=>{
 const f=fixture(t),m=f.manager,gate=deferred();let calls=0,reentrant;
 f.listHook=()=>{calls++;reentrant=m.listEvents();return gate.promise;};const shared=m.listEvents(),followers=Array.from({length:100},()=>m.listEvents());assert.ok(followers.every(value=>value===shared));assert.equal(m.snapshot().listing,true);await until(()=>calls===1);assert.strictEqual(reentrant,shared);
 gate.resolve([Object.freeze({eventId:'alpha',displayName:'Game alpha',status:'available'})]);const values=await Promise.all([shared,...followers]);assert.ok(values.every(value=>value===values[0]));assert.equal(values[0].ok,true);assert.ok(Object.isFrozen(values[0]));assert.ok(Object.isFrozen(values[0].events));assert.ok(Object.isFrozen(values[0].events[0]));assert.equal(m.snapshot().listing,false);assert.equal(calls,1);
 f.listHook=()=>{calls++;return [{eventId:'beta',displayName:'New inventory',status:'available'}];};const next=m.listEvents();assert.notStrictEqual(next,shared);assert.equal((await next).events[0].eventId,'beta');assert.equal(calls,2);
});

test('failed shared inventory settles every caller once and permits a fresh actual retry',async t=>{
 const f=fixture(t),m=f.manager,gate=deferred();let calls=0;f.listHook=()=>{calls++;return gate.promise;};const shared=m.listEvents(),followers=Array.from({length:100},()=>m.listEvents());await until(()=>calls===1);gate.reject(Error('/private/catalog'));const values=await Promise.all([shared,...followers]);assert.ok(values.every(value=>value===values[0]));assert.equal(values[0].code,'CATALOG_INVALID');assert.equal(m.snapshot().listing,false);assert.ok(!JSON.stringify(values[0]).includes('/private'));
 f.listHook=()=>{calls++;return [{eventId:'alpha',displayName:'Game alpha',status:'available'}];};assert.equal((await m.listEvents()).ok,true);assert.equal(calls,2);
});

test('close never waits a hung inventory and retains its physical flight after logical CLOSED settlement',async t=>{
 const f=fixture(t),m=f.manager,r=await f.activate('alpha'),gate=deferred();let calls=0;f.listHook=()=>{calls++;return gate.promise;};const shared=m.listEvents(),followers=Array.from({length:100},()=>m.listEvents());await until(()=>calls===1);
 const closing=m.close();assert.equal(r.closeCalls,1,'native cleanup starts immediately despite inventory');assert.equal((await closing).ok,true);const values=await Promise.all([shared,...followers]);assert.ok(values.every(value=>value===values[0]));assert.equal(values[0].code,'CLOSED');assert.equal(m.snapshot().listing,true,'physical listing reference retained');assert.equal((await m.listEvents()).code,'CLOSED');assert.equal(calls,1);
 gate.reject(Error('/private/late-list'));await until(()=>m.snapshot().listing===false);assert.equal(m.snapshot().closed,true);assert.equal(calls,1);assert.equal(m.snapshot().lastError,null);
});
