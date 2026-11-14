'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SlideshowController } = require('../scripts/lib/slideshow-controller.cjs');
const deck = {id:'deck',slides:[{id:'a',src:'a.png'},{id:'b',src:'b.png'}]};
function deferred() { let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject}; }
async function flush(){for(let i=0;i<15;i++)await Promise.resolve();}
function clock(){let now=0,id=0;const jobs=new Map();return{jobs,now:()=>now,setTimeout(fn,ms){jobs.set(++id,{fn,due:now+ms});return id;},clearTimeout(key){jobs.delete(key);},advance(ms){now+=ms;for(const[key,job]of[...jobs])if(job.due<=now){jobs.delete(key);job.fn();}}};}
function fixture(t,options={}){
  const scheduler=clock(),shows=[],blacks=[],feedback=[];let effect=()=>{};
  const renderer={show(value){shows.push(value);},black(value){blacks.push(value);},feedback(value){feedback.push(value);return effect(value);}};
  const c=new SlideshowController({deck,scheduler,renderer,...options});t.after(()=>c.close());
  return{c,scheduler,shows,blacks,feedback,onFeedback(fn){effect=fn;}};
}
test('playing mode commits only after feedback ACK, computing queued toggles at execution',async t=>{
  const f=fixture(t),{c}=f;await c.dispatch('launch');f.scheduler.advance(3000);
  const gate=deferred();f.onFeedback(()=>gate.promise);
  const first=c.dispatch('toggle-auto');await flush();const second=c.dispatch('toggle-auto');
  assert.equal(c.snapshot().mode,'auto');assert.equal(c.snapshot().nextAdvanceAt,null);
  assert.equal(f.feedback[0].mode,'manual');assert.ok(Object.isFrozen(f.feedback[0]));
  gate.resolve();await first;await second;assert.deepEqual(f.feedback.map(value=>value.mode),['manual','auto']);
  assert.equal(c.snapshot().mode,'auto');assert.equal(c.snapshot().nextAdvanceAt,13000);assert.equal(f.shows.length,1);
});
test('stopped mode/Reload labels do not render; legacy adapters keep immediate compatibility',async t=>{
  const f=fixture(t),{c}=f;await c.dispatch('manual');await c.setReloadState('loading');
  assert.equal(c.snapshot().mode,'manual');assert.equal(f.feedback.length,0);assert.equal(f.scheduler.jobs.size,0);
  const legacy=new SlideshowController({deck,renderer:{show(){},black(){}}});t.after(()=>legacy.close());
  await legacy.dispatch('launch');assert.equal((await legacy.dispatch('manual')).ok,true);
  const before=legacy.snapshot();assert.equal((await legacy.setReloadState('failed')).ok,true);
  assert.equal(legacy.snapshot().mode,before.mode);assert.equal(legacy.snapshot().index,before.index);
});
test('Reload feedback preserves Auto deadline, including a tick queued while feedback awaits ACK',async t=>{
  const f=fixture(t,{handlerTimeoutMs:20000}),{c}=f;await c.dispatch('launch');f.scheduler.advance(4000);
  const gate=deferred();f.onFeedback(()=>gate.promise);const pending=c.setReloadState('loading');await flush();
  assert.equal(c.snapshot().nextAdvanceAt,10000);assert.equal(f.feedback[0].reload,'loading');assert.equal(c.snapshot().index,0);
  f.scheduler.advance(6000);await flush();assert.equal(c.snapshot().queued,1);assert.equal(f.shows.length,1);
  gate.resolve();assert.equal((await pending).ok,true);await flush();
  assert.equal(c.snapshot().index,1);assert.equal(f.shows.length,2);assert.equal(c.snapshot().nextAdvanceAt,20000);
});
test('successful or failed Reload feedback never resets or suspends an unexpired Auto deadline',async t=>{
  const f=fixture(t),{c}=f;await c.dispatch('launch');f.scheduler.advance(3000);
  await c.setReloadState('loading');assert.equal(c.snapshot().nextAdvanceAt,10000);
  f.onFeedback(()=>{throw Error('/private/person');});
  const result=await c.setReloadState('failed');assert.deepEqual(result,{action:'feedback',ok:false,code:'RENDER_FAILED'});
  assert.equal(c.snapshot().nextAdvanceAt,10000);assert.equal(c.snapshot().autoSuspended,false);
  f.scheduler.advance(7000);await flush();assert.equal(c.snapshot().index,1);
});
test('feedback does not rearm previously suspended Auto or change its committed deck/mode/index',async t=>{
  const f=fixture(t),{c}=f;await c.dispatch('launch');c.autoSuspended=true;c.clearTimer();
  const before=c.snapshot();await c.setReloadState('failed');const after=c.snapshot();
  assert.equal(after.autoSuspended,true);assert.equal(after.nextAdvanceAt,null);
  for(const key of['mode','deckId','index','state'])assert.equal(after[key],before[key]);
});
test('failed mode feedback preserves old mode, suspends Auto and allows explicit recovery',async t=>{
  const f=fixture(t),{c}=f;await c.dispatch('launch');f.onFeedback(()=>Promise.reject(Error('private')));
  assert.equal((await c.dispatch('manual')).code,'RENDER_FAILED');assert.equal(c.snapshot().mode,'auto');
  assert.equal(c.snapshot().autoSuspended,true);assert.equal(c.snapshot().nextAdvanceAt,null);
  f.onFeedback(()=>{});await c.dispatch('manual');assert.equal(c.snapshot().mode,'manual');assert.equal(c.snapshot().autoSuspended,false);
});
test('rapid mixed mode and Reload feedback commands share the normal bounded FIFO',async t=>{
  const f=fixture(t,{maxQueue:2}),{c}=f;await c.dispatch('launch');
  const gate=deferred();f.onFeedback(()=>gate.promise);const first=c.dispatch('manual');await flush();
  const second=c.setReloadState('loading'),third=c.dispatch('toggle-auto');
  for(let i=0;i<100;i++)assert.equal((await c.setReloadState('failed')).code,'BUSY');
  assert.equal(c.snapshot().queued,2);assert.equal(c.snapshot().outstandingRenders,1);
  gate.resolve();await first;await second;await third;
  assert.deepEqual(f.feedback.map(value=>value.mode||value.reload),['manual','loading','auto']);
});
test('Stop preempts active feedback plus queued mode changes; stale ACK cannot commit mode',async t=>{
  const f=fixture(t),{c}=f;await c.dispatch('launch');const gate=deferred();f.onFeedback(()=>gate.promise);
  const active=c.dispatch('manual');await flush();const queued=c.dispatch('toggle-auto');const stop=c.dispatch('stop');
  assert.equal((await active).code,'CANCELLED');assert.equal((await queued).code,'CANCELLED');await stop;
  assert.equal(f.feedback[0].signal.aborted,true);assert.equal(f.blacks.length,1);assert.equal(c.snapshot().mode,'auto');
  for(let i=0;i<100;i++)assert.equal(c.dispatch('stop'),stop);
  gate.resolve();await flush();assert.equal(c.snapshot().state,'stopped');assert.equal(c.snapshot().mode,'auto');
  assert.equal(c.snapshot().outstandingRenders,0);assert.equal(f.scheduler.jobs.size,0);
});
test('canceled feedback retains orphan barrier/watchdog without altering Auto timing until actual settlement',async t=>{
  const f=fixture(t),{c}=f;await c.dispatch('launch');f.scheduler.advance(1000);
  const gate=deferred();f.onFeedback(()=>gate.promise);const abort=new AbortController();
  const pending=c.setReloadState('loading',{signal:abort.signal});await flush();abort.abort();
  assert.equal((await pending).code,'CANCELLED');assert.equal(c.snapshot().nextAdvanceAt,10000);assert.equal(c.snapshot().autoSuspended,false);
  const next=c.dispatch('next');await flush();assert.equal(f.shows.length,1);
  gate.reject(Error('late'));await next;assert.equal(c.snapshot().index,1);assert.equal(c.snapshot().nextAdvanceAt,11000);
});
test('queued feedback cancellation drops that intent without rendering or changing mode',async t=>{
  const f=fixture(t),{c}=f;await c.dispatch('launch');const gate=deferred();f.onFeedback(()=>gate.promise);
  const first=c.dispatch('manual');await flush();const abort=new AbortController();
  const pending=c.setReloadState('loading',{signal:abort.signal});abort.abort();assert.equal((await pending).code,'CANCELLED');
  gate.resolve();await first;assert.equal(f.feedback.length,1);assert.equal(c.snapshot().mode,'manual');
});
test('preempted feedback watchdog survives successful black and bounds repeated Stops',async t=>{
  const f=fixture(t,{handlerTimeoutMs:100}),{c}=f;await c.dispatch('launch');const gate=deferred();f.onFeedback(()=>gate.promise);
  const active=c.setReloadState('loading');await flush();const stop=c.dispatch('stop');await active;await stop;
  const next=c.dispatch('launch');await flush();assert.equal(f.shows.length,1);
  f.scheduler.advance(100);assert.equal((await next).code,'CANCELLED');assert.equal(c.snapshot().faulted,true);
  gate.resolve();await flush();assert.equal(c.snapshot().state,'faulted');assert.equal(f.blacks.length,1);
});
test('feedback timeout is terminal, fences late mode ACK and cancels queued work',async t=>{
  const f=fixture(t,{handlerTimeoutMs:100}),{c}=f;await c.dispatch('launch');const gate=deferred();f.onFeedback(()=>gate.promise);
  const pending=c.dispatch('manual');await flush();const queued=c.setReloadState('failed');f.scheduler.advance(100);
  assert.equal((await pending).code,'RENDER_TIMEOUT');assert.equal((await queued).code,'CANCELLED');
  assert.equal(c.snapshot().mode,'auto');assert.equal((await c.setReloadState('complete')).code,'FAULTED');
  gate.resolve();await flush();assert.equal(c.snapshot().mode,'auto');assert.equal(c.snapshot().state,'faulted');
});
test('close aborts feedback and never commits late mode changes',async t=>{
  const f=fixture(t),{c}=f;await c.dispatch('launch');const gate=deferred();f.onFeedback(()=>gate.promise);
  const pending=c.dispatch('manual');await flush();await c.close();assert.equal((await pending).code,'CANCELLED');
  gate.resolve();await flush();assert.equal(c.snapshot().mode,'auto');assert.equal(c.snapshot().state,'closed');assert.equal(f.scheduler.jobs.size,0);
  assert.equal((await c.setReloadState('loading')).code,'CLOSED');
});
test('invalid feedback options/states/signals return fixed failures before adapter work',async t=>{
  const f=fixture(t),{c}=f;await c.dispatch('launch');
  for(const state of[null,{},'other',1])assert.equal((await c.setReloadState(state)).code,'INVALID_FEEDBACK');
  for(const options of[null,[],1,{bad:1},{get signal(){throw Error('secret');}}])assert.equal((await c.setReloadState('loading',options)).code,'INVALID_OPTIONS');
  assert.equal((await c.setReloadState('loading',{signal:{}})).code,'INVALID_SIGNAL');
  const abort=new AbortController();abort.abort();assert.equal((await c.setReloadState('loading',{signal:abort.signal})).code,'CANCELLED');
  assert.equal(f.feedback.length,0);assert.equal(c.snapshot().nextAdvanceAt,10000);
  assert.throws(()=>new SlideshowController({deck,renderer:{show(){},black(){},feedback:true}}),/renderer required/i);
});
test('Auto queue overload during Reload feedback retries after one interval without catch-up bursts',async t=>{
  const f=fixture(t,{maxQueue:1,handlerTimeoutMs:30000}),{c}=f;await c.dispatch('launch');
  const gate=deferred();f.onFeedback(()=>gate.promise);const loading=c.setReloadState('loading');await flush();const complete=c.setReloadState('complete');
  f.scheduler.advance(10000);await flush();assert.equal(c.snapshot().nextAdvanceAt,20000);assert.equal(f.shows.length,1);
  gate.resolve();await loading;await complete;assert.equal(c.snapshot().nextAdvanceAt,20000);
  f.scheduler.advance(9999);await flush();assert.equal(f.shows.length,1);
  f.scheduler.advance(1);await flush();assert.equal(c.snapshot().index,1);assert.equal(f.shows.length,2);assert.equal(c.snapshot().nextAdvanceAt,30000);
});
test('stale Auto BUSY continuation cannot overwrite a synchronous Stop or manual navigation reset',async t=>{
  for(const recovery of['stop','next','manual']){
    const f=fixture(t,{maxQueue:1,handlerTimeoutMs:30000}),{c}=f;await c.dispatch('launch');
    const gate=deferred();f.onFeedback(()=>gate.promise);const loading=c.setReloadState('loading');await flush();const queued=c.setReloadState('complete');
    let result;
    c.once('result',value=>{assert.equal(value.code,'BUSY');result=c.dispatch(recovery);});
    f.scheduler.advance(10000);await flush();
    if(recovery==='stop'){
      await result;assert.equal((await loading).code,'CANCELLED');assert.equal((await queued).code,'CANCELLED');
      gate.resolve();await flush();assert.equal(c.snapshot().nextAdvanceAt,null);assert.equal(c.snapshot().state,'stopped');
    }else{
      // The recovery was rejected while the queue was still full, so it did not
      // create a newer deadline; the bounded retry remains the correct policy.
      assert.equal((await result).code,'BUSY');gate.resolve();await loading;await queued;
      await c.dispatch(recovery);assert.equal(c.snapshot().nextAdvanceAt,recovery==='manual'?null:20000);
    }
  }
});
