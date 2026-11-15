'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { LauncherRuntime } = require('../scripts/lib/launcher-runtime.cjs');
const { ProcessSupervisor } = require('../scripts/lib/process-supervisor.cjs');
const { SlideshowController } = require('../scripts/lib/slideshow-controller.cjs');
const start = Date.parse('2026-11-15T18:00:00Z'), end = start + 3600000;
const settings = { productionWindow: {start: new Date(start).toISOString(), end: new Date(end).toISOString()}, services: ['spx','casparcg'].map(name => ({name, command: name, args: []})) };
const flush = async () => { for(let i=0;i<10;i++) await Promise.resolve(); };
function deferred() { let resolve; const promise=new Promise(r=>resolve=r); return {promise,resolve}; }
function fixture(hook, delayed=false) {
  const f={now:start, children:[], kills:[], tasks:[], callbacks:[]};
  f.runtime=new LauncherRuntime(settings, {clock:()=>f.now, schedule:fn=>{f.tasks.push(fn);return fn;},cancel:()=>{},onSenderRetiring:hook,
    supervisorOptions:{platform:'win32',schedule:fn=>{f.tasks.push(fn);return fn;},cancel:()=>{},spawnProcess:command=>{const c=new EventEmitter();c.pid=100+f.children.length;c.kill=()=>{};f.children.push({command,child:c});return c;},execFileProcess:(file,args,opts,cb)=>{f.kills.push(args);if(delayed)f.callbacks.push(cb);else cb(null);}}});
  return f;
}
test('active real slideshow Auto is synchronously canceled before blocked runtime queue and delayed native stop',async()=>{
  const jobs=new Map();let id=0,shows=0;
  const slideshow=new SlideshowController({deck:{id:'d',slides:[{id:'a',src:'a.png'},{id:'b',src:'b.png'}]},renderer:{show(){shows++;},black(){throw Error('close must not need black');}},scheduler:{now:()=>0,setTimeout:(fn,ms)=>{jobs.set(++id,{fn,ms});return id;},clearTimeout:key=>jobs.delete(key)}});
  await slideshow.dispatch('launch');assert.equal(slideshow.snapshot().nextAdvanceAt,10000);
  const f=fixture(()=>{slideshow.close();},true);await f.runtime.start();
  const pending=deferred();f.runtime.queue=pending.promise;
  const staleTick=[...jobs.values()].find(v=>v.ms===10000).fn;
  const closing=f.runtime.close();
  assert.equal(slideshow.snapshot().state,'closed');assert.equal(jobs.size,0);assert.equal(f.kills.length,0);
  staleTick();await flush();assert.equal(shows,1);
  pending.resolve();await flush();assert.equal(f.kills.length,2);
  let done=false;closing.then(()=>done=true);await flush();assert.equal(done,false);
  f.callbacks.forEach(cb=>cb(null));await closing;
});
test('throwing and never settling/rejected Promise hooks cannot prevent native termination, even when diagnostic observer throws',async()=>{
  for(const hook of [()=>{throw Error('private secret');},()=>new Promise(()=>{}),()=>Promise.reject(Error('private secret'))]) {
    const f=fixture(hook);const faults=[];f.runtime.on('fault',data=>{faults.push(data);throw Error('observer failure');});
    await f.runtime.start();await f.runtime.close();
    assert.equal(f.kills.length,2);assert.ok(faults.length>=1);assert.ok(faults.every(d=>d.error==='SENDER_RETIRING_HOOK_FAILED'));
  }
});
test('late OS spawn self-stop invokes retirement before kill without waiting for reconciliation',async()=>{
  const order=[];const f=fixture(({reason})=>order.push(reason),true);await f.runtime.start();f.now=end;
  f.children[1].child.emit('spawn');
  assert.deepEqual(order,['stopping']);assert.equal(f.kills.length,1);assert.equal(f.runtime.sender.stopping,true);
  f.callbacks.shift()(null);await f.runtime.sender.stop();
  const closing=f.runtime.close();await flush();f.callbacks.splice(0).forEach(cb=>cb(null));await closing;
});
test('current exit retires before retry while stale old supervisor events never retire replacement',async()=>{
  const reasons=[];const f=fixture(({reason})=>reasons.push(reason));await f.runtime.start();const old=f.runtime.sender;
  f.children[1].child.emit('exit',1);assert.deepEqual(reasons,['exited']);
  f.tasks.at(-1)();assert.equal(f.children.length,3); // scheduled retry
  old.stopping=true;await f.runtime.reconcile();assert.notEqual(f.runtime.sender,old);
  reasons.length=0;for(const event of ['exited','fault','inhibited'])old.emit(event,{name:'casparcg',error:'old'});
  assert.deepEqual(reasons,[]);
  for(const event of ['fault','inhibited'])f.runtime.sender.emit(event,{name:'casparcg',error:'current'});
  assert.deepEqual(reasons,['fault','inhibited']);await f.runtime.close();
});
test('optional hook validation and standalone supervisor hook failure never delay kill',async()=>{
  assert.throws(()=>new LauncherRuntime(settings,{onSenderRetiring:true}),/onSenderRetiring/);
  assert.throws(()=>new ProcessSupervisor(settings.services,{onStopping:true}),/onStopping/);
  for(const hook of [()=>{throw Error('private');},()=>new Promise(()=>{})]) {
    const child=new EventEmitter();child.pid=9;child.kill=()=>{};let kills=0;const diagnostics=[];
    const supervisor=new ProcessSupervisor([settings.services[1]],{onStopping:hook,platform:'win32',spawnProcess:()=>child,execFileProcess:(f,a,o,cb)=>{kills++;cb(null);}});
    supervisor.on('fault',data=>{diagnostics.push(data);throw Error('observer');});supervisor.start();await supervisor.stop();
    assert.equal(kills,1);assert.equal(diagnostics[0].error,'STOPPING_HOOK_FAILED');
  }
});
test('supervisor reserves one stop barrier before hook and reentrant fault observer admission, with retry after failure',async()=>{
  const child=new EventEmitter();child.pid=9;child.kill=()=>{};
  let calls=0,kills=0,reentered,fail=true;const completions=[];
  const supervisor=new ProcessSupervisor([settings.services[1]],{onStopping:()=>{calls++;reentered=supervisor.stop();throw Error('hook');},platform:'win32',spawnProcess:()=>child,execFileProcess:(f,a,o,cb)=>{kills++;completions.push(()=>cb(fail?Error('denied'):null));}});
  const observerPromises=[];supervisor.on('fault',()=>{observerPromises.push(supervisor.stop());});supervisor.start();
  const first=supervisor.stop();assert.strictEqual(first,reentered);assert.equal(calls,1);assert.equal(kills,1);assert.strictEqual(observerPromises[0],first);
  completions.shift()();await assert.rejects(first,/failed to stop/);assert.strictEqual(observerPromises[1],first);assert.equal(supervisor.stopPromise,null);
  fail=false;const second=supervisor.stop();assert.notStrictEqual(second,first);assert.strictEqual(second,reentered);assert.equal(calls,2);assert.equal(kills,2);assert.strictEqual(observerPromises.at(-1),second);
  completions.shift()();await second;assert.equal(supervisor.children.size,0);
});
test('runtime reserves close barrier before retirement hook and reentrant hook-fault observer',async()=>{
  for(const throwing of [false,true]) {
    let f,hookCalls=0;const recursive=[],faultRecursive=[];
    f=fixture(()=>{hookCalls++;recursive.push(f.runtime.close());if(throwing)throw Error('hook');},true);
    f.runtime.on('fault',data=>{if(data.error==='SENDER_RETIRING_HOOK_FAILED')faultRecursive.push(f.runtime.close());});
    await f.runtime.start();const first=f.runtime.close();
    assert.strictEqual(recursive[0],first);assert.equal(hookCalls,1);assert.equal(f.kills.length,0);
    if(throwing)assert.strictEqual(faultRecursive[0],first);
    await flush();assert.equal(f.kills.length,2);assert.equal(hookCalls,2);
    for(const promise of [...recursive,...faultRecursive])assert.strictEqual(promise,first);
    f.callbacks.forEach(cb=>cb(null));await first;assert.equal(f.runtime.sender,null);
  }
});
