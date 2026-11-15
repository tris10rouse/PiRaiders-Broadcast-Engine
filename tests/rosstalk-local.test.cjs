'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const {RossTalkBridge}=require('../scripts/lib/rosstalk-bridge.cjs');
const config={host:'127.0.0.1',port:0,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',2:'next',3:'reload',8:'stop'},idleTimeoutMs:1000};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=2500){const end=Date.now()+timeout;while(!fn()){if(Date.now()>=end)throw Error('Local fixture deadline');await wait(5);}}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
async function fixture(t,handler,settings={},options={}){
 const bridge=new RossTalkBridge({...config,...settings},{handleCommand:handler,prioritizeStop:true,allowEphemeral:true,...options});
 const results=[],faults=[];bridge.on('result',value=>results.push(value));bridge.on('fault',value=>faults.push(value));
 t.after(()=>bridge.close());await bridge.start();return{bridge,results,faults};
}
async function peer(t,bridge){const socket=new net.Socket(),lines=[];let pending='';socket.on('data',bytes=>{pending+=bytes.toString();for(let at;(at=pending.indexOf('\r\n'))>=0;){lines.push(pending.slice(0,at));pending=pending.slice(at+2);}});socket.on('error',()=>{});t.after(()=>socket.destroy());await new Promise((resolve,reject)=>{socket.once('error',reject);socket.connect(bridge.address().port,'127.0.0.1',resolve);});return{socket,lines};}
function conserved(bridge){const s=bridge.snapshot();assert.equal(s.accepted,s.completed+s.failed+s.cancelled+s.timedOut);}

test('local and actual TCP share sequence/FIFO, queue limit, fixed results and silent-socket independence',async t=>{
 const hold=deferred(),calls=[];const {bridge}=await fixture(t,c=>{calls.push(c);return c.action==='launch'?hold.promise:undefined;},{maxQueue:2,acknowledgements:false});
 const a=bridge.dispatch('launch');await until(()=>calls.length===1);const p=await peer(t,bridge);p.socket.write('GPI 2\r\n');await until(()=>bridge.snapshot().queued===1);
 const b=bridge.dispatch('previous'),busy=await bridge.dispatch('auto');assert.equal(busy.code,'BUSY');assert.equal(bridge.snapshot().queued,2);assert.equal(bridge.snapshot().connections,1);
 p.socket.end();await until(()=>bridge.snapshot().connections===0);hold.resolve();
 assert.equal((await a).ok,true);const r=await b;assert.equal(r.ok,true);assert.ok(Object.isFrozen(r));assert.deepEqual(calls.map(c=>[c.sequence,c.action]),[[1,'launch'],[2,'next'],[3,'previous']]);assert.equal(calls[2].gpi,undefined);assert.equal(p.lines.length,0);conserved(bridge);
});

test('local Stop preempts TCP callback and queued locals without allowing successor around physical orphan',async t=>{
 const normal=deferred(),black=deferred(),calls=[];const {bridge}=await fixture(t,c=>{calls.push(c);return c.action==='stop'?black.promise:c.action==='reload'?normal.promise:undefined;},{acknowledgements:true});
 const p=await peer(t,bridge);p.socket.write('GPI 3\r\n');await until(()=>calls.length===1);const queued=bridge.dispatch('next'),stop=bridge.dispatch('stop');
 assert.equal((await queued).code,'CANCELLED');await until(()=>calls.length===2);assert.equal(calls[0].signal.aborted,true);assert.equal(bridge.snapshot().outstandingCallbacks,2);
 black.resolve();assert.equal((await stop).ok,true);const successor=bridge.dispatch('previous');await wait(20);assert.equal(calls.length,2);assert.equal(bridge.snapshot().queued,1);
 normal.resolve();assert.equal((await successor).ok,true);assert.deepEqual(calls.map(c=>c.action),['reload','stop','previous']);assert.ok(p.lines.some(line=>line==='ERR 1 CANCELLED'));conserved(bridge);
});

test('TCP Stop preempts local callback; repeated mixed Stops have one shared follower cap and failed outcome',async t=>{
 const normal=deferred(),black=deferred(),calls=[];const {bridge}=await fixture(t,c=>{calls.push(c);return c.action==='stop'?black.promise:normal.promise;},{maxQueue:3,acknowledgements:true});
 const local=bridge.dispatch('reload');await until(()=>calls.length===1);const p=await peer(t,bridge);p.socket.write('GPI 8\r\nGPI 8\r\n');await until(()=>bridge.snapshot().stopFollowers===1);
 assert.equal((await local).code,'CANCELLED');const followers=Array.from({length:98},()=>bridge.dispatch('stop'));assert.equal(bridge.snapshot().stopFollowers,3);assert.equal(bridge.snapshot().rejected,96);assert.equal(bridge.snapshot().outstandingCallbacks,2);
 black.reject(Error('/private/student/name'));const outcomes=await Promise.all(followers);assert.equal(outcomes.filter(r=>r.code==='BUSY').length,96);assert.equal(outcomes.filter(r=>r.code==='HANDLER_FAILED').length,2);assert.equal(calls.filter(c=>c.action==='stop').length,1);
 const saved=await bridge.dispatch('stop');assert.equal(saved.code,'HANDLER_FAILED');assert.equal(calls.length,2);assert.ok(!JSON.stringify(outcomes).includes('student'));
 normal.reject(Error('late'));await until(()=>bridge.snapshot().outstandingCallbacks===0);conserved(bridge);
});

test('preempted local callback retains its original terminal watchdog despite successful and repeated Stop',async t=>{
 const stuck=deferred(),calls=[];const {bridge,faults,results}=await fixture(t,c=>{calls.push(c);return c.action==='reload'?stuck.promise:undefined;},{handlerTimeoutMs:120,maxQueue:2});
 const first=bridge.dispatch('reload');await until(()=>calls.length===1);await wait(20);assert.equal((await bridge.dispatch('stop')).ok,true);assert.equal((await first).code,'CANCELLED');
 for(let i=0;i<5;i++)assert.equal((await bridge.dispatch('stop')).ok,true);const successor=bridge.dispatch('next');await until(()=>bridge.snapshot().state==='faulted');assert.equal((await successor).code,'CLOSED');
 assert.deepEqual(faults,[{code:'HANDLER_TIMEOUT'}]);assert.equal(bridge.snapshot().callbackTimeouts,1);assert.equal(results.filter(r=>r.sequence===1).length,1);assert.equal(calls.length,2);
 stuck.resolve();await wait(20);assert.equal(calls.length,2);conserved(bridge);
});

test('close settles queued local work and mixed Stop followers without waiting for ignored callbacks',async t=>{
 const normal=deferred(),black=deferred(),calls=[];const {bridge}=await fixture(t,c=>{calls.push(c);return c.action==='stop'?black.promise:normal.promise;});
 const first=bridge.dispatch('reload');await until(()=>calls.length===1);const stop=bridge.dispatch('stop');await until(()=>calls.length===2);const follower=bridge.dispatch('stop');
 const p=await peer(t,bridge);p.socket.write('GPI 8\r\n');await until(()=>bridge.snapshot().stopFollowers===2);const queued=bridge.dispatch('next');const closing=bridge.close();assert.strictEqual(bridge.close(),closing);await closing;
 const outcomes=await Promise.all([first,stop,follower,queued]);assert.ok(outcomes.every(r=>r.status==='cancelled'));assert.equal(outcomes[0].code,'CANCELLED');assert.ok(outcomes.slice(1).every(r=>r.code==='CLOSED'));
 assert.equal(bridge.snapshot().outstandingCallbacks,0);assert.equal(bridge.snapshot().stopFollowers,0);normal.reject(Error('late private error'));black.resolve();await wait(20);assert.equal(bridge.snapshot().completed,0);conserved(bridge);
});

test('observer close during local normal, first Stop, follower and saved-outcome admission settles every result',async t=>{
 for(const phase of ['normal','stop','follower','saved']){
  const normal=deferred(),black=deferred();const {bridge}=await fixture(t,c=>c.action==='stop'?black.promise:normal.promise);
  let first,stop;
  if(phase==='follower'||phase==='saved'){first=bridge.dispatch('reload');await until(()=>bridge.snapshot().outstandingCallbacks===1);stop=bridge.dispatch('stop');await until(()=>bridge.snapshot().outstandingCallbacks===2);if(phase==='saved'){black.resolve();await stop;}}
  bridge.once('command',()=>{void bridge.close();});const outcome=await bridge.dispatch(phase==='normal'?'next':'stop');assert.equal(outcome.code,'CLOSED');await bridge.close();
  if(first)await first;if(stop)await stop;normal.resolve();black.resolve();await wait(10);assert.equal(bridge.snapshot().outstandingCallbacks,0);conserved(bridge);
 }
});

test('reentrant Stop observers reserve one black and globally bounded followers before callback entry',async t=>{
 const black=deferred(),calls=[];const {bridge}=await fixture(t,c=>{calls.push(c.action);return c.action==='stop'?black.promise:undefined;},{maxQueue:2});
 const nested=[];let issued=0;bridge.on('command',c=>{if(c.action==='stop'&&issued++<10)nested.push(bridge.dispatch('stop'));});
 const first=bridge.dispatch('stop');assert.equal(bridge.snapshot().stopFollowers,2);assert.equal(bridge.snapshot().rejected,1);await until(()=>calls.length===1);assert.deepEqual(calls,['stop']);black.resolve();assert.equal((await first).ok,true);const results=await Promise.all(nested);assert.equal(results.filter(r=>r.ok).length,2);assert.equal(results.filter(r=>r.code==='BUSY').length,1);conserved(bridge);
});

test('normal work admitted from a Stop observer cannot enter ahead of the reserved Stop',async t=>{
 const black=deferred(),calls=[];const {bridge}=await fixture(t,c=>{calls.push(c.action);return c.action==='stop'?black.promise:undefined;});
 let nested;bridge.once('command',()=>{nested=bridge.dispatch('next');});const stop=bridge.dispatch('stop');await until(()=>calls.length===1);assert.deepEqual(calls,['stop']);black.resolve();await stop;await nested;assert.deepEqual(calls,['stop','next']);conserved(bridge);
});

test('fixed lifecycle/validation/handler failure results do not coerce or expose caller data',async t=>{
 const calls=[],bridge=new RossTalkBridge(config,{allowEphemeral:true,prioritizeStop:true,handleCommand:c=>{calls.push(c);throw Error('/private/path');}});t.after(()=>bridge.close());
 assert.equal((await bridge.dispatch('launch')).code,'NOT_READY');for(const value of [null,undefined,1,{},[],{toString(){throw Error('must not coerce');}},'Launch','launch\n','/private']){const r=await bridge.dispatch(value);assert.equal(r.code,'INVALID_ACTION');assert.equal(r.action,undefined);assert.ok(!JSON.stringify(r).includes('/private'));}
 const starting=bridge.start();assert.equal((await bridge.dispatch('launch')).code,'NOT_READY');await starting;const fail=await bridge.dispatch('manual');assert.equal(fail.code,'HANDLER_FAILED');assert.equal(calls[0].action,'manual');assert.equal(calls[0].gpi,undefined);await bridge.close();assert.equal((await bridge.dispatch('stop')).code,'CLOSED');assert.equal(calls.length,1);
});

test('sequence exhaustion faults once and cancels pending local requests',async t=>{
 const hold=deferred();const {bridge,faults}=await fixture(t,()=>hold.promise);const first=bridge.dispatch('launch');await until(()=>bridge.snapshot().outstandingCallbacks===1);const queued=bridge.dispatch('next');bridge.sequence=Number.MAX_SAFE_INTEGER;
 assert.equal((await bridge.dispatch('stop')).code,'SEQUENCE_LIMIT');assert.equal((await first).code,'CLOSED');assert.equal((await queued).code,'CLOSED');await bridge.close();assert.deepEqual(faults,[{code:'SEQUENCE_LIMIT'}]);assert.equal((await bridge.dispatch('next')).code,'CLOSED');hold.resolve();conserved(bridge);
});

test('legacy local Stop stays in the same FIFO and terminal timeout preserves legacy behavior',async t=>{
 const hold=deferred(),calls=[];const {bridge}=await fixture(t,c=>{calls.push(c.action);return c.action==='launch'?hold.promise:undefined;},{maxQueue:2},{prioritizeStop:false});
 const first=bridge.dispatch('launch');await until(()=>calls.length===1);const next=bridge.dispatch('next'),stop=bridge.dispatch('stop');assert.equal((await bridge.dispatch('previous')).code,'BUSY');assert.equal(calls.length,1);hold.resolve();assert.ok((await first).ok);assert.ok((await next).ok);assert.ok((await stop).ok);assert.deepEqual(calls,['launch','next','stop']);conserved(bridge);
 const stuck=deferred();const other=await fixture(t,()=>stuck.promise,{handlerTimeoutMs:60},{prioritizeStop:false});const timed=other.bridge.dispatch('launch'),pending=other.bridge.dispatch('stop');assert.equal((await timed).code,'HANDLER_TIMEOUT');assert.equal((await pending).code,'CLOSED');await other.bridge.close();stuck.resolve();conserved(other.bridge);
});

test('result-observer close cannot lose the resolved result, queued callers or an incoming priority Stop',async t=>{
 for(const prioritizeStop of [false,true]){
  const {bridge}=await fixture(t,()=>undefined,{}, {prioritizeStop});bridge.once('result',()=>{void bridge.close();});
  const completed=bridge.dispatch('next'),queued=bridge.dispatch('previous');assert.equal((await completed).ok,true);assert.equal((await queued).code,'CLOSED');await bridge.close();conserved(bridge);
 }
 const hold=deferred();const {bridge}=await fixture(t,()=>hold.promise);const first=bridge.dispatch('reload');await until(()=>bridge.snapshot().outstandingCallbacks===1);const queued=bridge.dispatch('next');
 bridge.once('result',()=>{void bridge.close();});const stop=bridge.dispatch('stop');assert.equal((await queued).code,'CANCELLED');assert.equal((await first).code,'CLOSED');assert.equal((await stop).code,'CLOSED');await bridge.close();hold.resolve();conserved(bridge);
});

test('local admission fails closed during failed listener startup without entering any handler',async t=>{
 const occupied=net.createServer();await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>occupied.close(resolve)));
 let calls=0;const bridge=new RossTalkBridge({...config,port:occupied.address().port},{allowEphemeral:true,prioritizeStop:true,handleCommand(){calls++;}});t.after(()=>bridge.close());
 await assert.rejects(bridge.start(),{code:'LISTEN_FAILED'});assert.equal((await bridge.dispatch('stop')).code,'NOT_READY');assert.equal(calls,0);await bridge.close();assert.equal((await bridge.dispatch('stop')).code,'CLOSED');
});
