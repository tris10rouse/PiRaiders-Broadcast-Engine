'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const {RossTalkBridge}=require('../scripts/lib/rosstalk-bridge.cjs');
const {normalizeRossTalkConfig}=require('../scripts/lib/rosstalk-protocol.cjs');
const config={host:'127.0.0.1',port:0,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',2:'next',3:'reload',8:'stop'},idleTimeoutMs:1000};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=2000){const end=Date.now()+timeout;while(!fn()){if(Date.now()>=end)throw Error('Priority fixture deadline');await wait(5);}}
function gate(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
async function fixture(t,handler,options={}){
 const bridge=new RossTalkBridge({...config,...options},{handleCommand:handler,prioritizeStop:true,allowEphemeral:true});
 const results=[],faults=[];bridge.on('result',value=>results.push(value));bridge.on('fault',value=>faults.push(value));
 t.after(()=>bridge.close());await bridge.start();return{bridge,results,faults};
}
async function peer(t,bridge){const socket=new net.Socket();let text='',closed=false;socket.on('data',bytes=>{text+=bytes.toString('ascii');});socket.on('error',()=>{});socket.on('close',()=>{closed=true;});t.after(()=>socket.destroy());await new Promise((resolve,reject)=>{socket.once('error',reject);socket.connect(bridge.address().port,'127.0.0.1',()=>{socket.off('error',reject);resolve();});});return{socket,get text(){return text;},get closed(){return closed;}};}

test('priority Stop admits after full normal queue and BUSY frames in one actual TCP burst',async t=>{
 const normal=gate(),black=gate(),calls=[];
 const {bridge,results}=await fixture(t,command=>{calls.push(command);return command.action==='stop'?black.promise:normal.promise;},{maxQueue:2,acknowledgements:true});
 const p=await peer(t,bridge);p.socket.write('GPI 1\r\n');await until(()=>calls.length===1);
 p.socket.write('GPI 2\r\n'.repeat(20)+'GPI 8\r\n');await until(()=>calls.some(c=>c.action==='stop'));
 assert.equal(calls[0].signal.aborted,true);assert.equal(bridge.snapshot().queued,0);assert.equal(bridge.snapshot().outstandingCallbacks,2);
 assert.ok(results.some(r=>r.code==='BUSY'));assert.equal(p.closed,false,'priority BUSY does not hide the later Stop');
 black.resolve();await until(()=>bridge.snapshot().completed===1);assert.ok(p.text.includes('stop\r\n'));
 p.socket.write('GPI 2\r\n');await until(()=>bridge.snapshot().queued===1);await wait(20);assert.equal(calls.length,2);
 normal.resolve();await until(()=>bridge.snapshot().completed===2);assert.deepEqual(calls.map(c=>c.action),['launch','stop','next']);
 assert.equal(bridge.snapshot().accepted,bridge.snapshot().completed+bridge.snapshot().failed+bridge.snapshot().cancelled+bridge.snapshot().timedOut);
});

test('one hundred repeated Stops coalesce black and retain only bounded diagnostic followers',async t=>{
 const normal=gate(),black=gate(),calls=[];
 const {bridge}=await fixture(t,c=>{calls.push(c);return c.action==='stop'?black.promise:normal.promise;},{maxQueue:4,acknowledgements:true});
 const p=await peer(t,bridge);p.socket.write('GPI 3\r\n');await until(()=>calls.length===1);
 p.socket.write('GPI 8\r\n'.repeat(100));await until(()=>bridge.snapshot().rejected===95);
 assert.equal(calls.filter(c=>c.action==='stop').length,1);assert.equal(bridge.snapshot().stopFollowers,4);assert.equal(bridge.snapshot().outstandingCallbacks,2);
 black.resolve();await until(()=>bridge.snapshot().completed===5);assert.equal(bridge.snapshot().stopFollowers,0);
 p.socket.write('GPI 2\r\nGPI 8\r\n');await until(()=>bridge.snapshot().completed===6);
 assert.equal(bridge.snapshot().queued,0);assert.equal(calls.filter(c=>c.action==='stop').length,1,'saved outcome reused through orphan barrier');
 normal.reject(Error('late private failure'));await until(()=>bridge.snapshot().outstandingCallbacks===0);
 assert.equal(bridge.snapshot().failed,0);assert.equal(bridge.snapshot().stopPending,false);assert.equal(bridge.snapshot().cancelled,2);
});

test('preempted normal callback keeps its original deadline even after black success and repeated Stop',async t=>{
 const stuck=gate(),calls=[];
 const {bridge,faults,results}=await fixture(t,c=>{calls.push(c);return c.action==='stop'?undefined:stuck.promise;},{handlerTimeoutMs:120,maxQueue:2});
 const p=await peer(t,bridge);p.socket.write('GPI 3\r\n');await until(()=>calls.length===1);await wait(20);
 p.socket.write('GPI 8\r\n');await until(()=>bridge.snapshot().completed===1);
 for(let i=0;i<3;i++)p.socket.write('GPI 8\r\n');p.socket.write('GPI 2\r\n');
 await until(()=>bridge.snapshot().state==='faulted');assert.deepEqual(faults,[{code:'HANDLER_TIMEOUT'}]);
 assert.equal(bridge.snapshot().callbackTimeouts,1);assert.equal(bridge.snapshot().timedOut,0,'logical canceled request is not counted twice');
 assert.equal(results.filter(r=>r.sequence===1).length,1);assert.equal(calls.filter(c=>c.action==='stop').length,1);
 stuck.resolve();await wait(20);assert.equal(calls.some(c=>c.action==='next'),false);assert.equal(bridge.snapshot().outstandingCallbacks,0);
});

test('Stop received before normal handler microtask prevents that normal callback from entering',async t=>{
 const calls=[];const {bridge}=await fixture(t,c=>{calls.push(c.action);});
 const p=await peer(t,bridge);p.socket.write('GPI 1\r\nGPI 2\r\nGPI 8\r\n');
 await until(()=>bridge.snapshot().completed===1);assert.deepEqual(calls,['stop']);assert.equal(bridge.snapshot().cancelled,2);
 assert.equal(bridge.snapshot().outstandingCallbacks,0);
});

test('failed shared Stop reports one callback failure to every accepted follower and blocks successors until orphan settles',async t=>{
 const normal=gate(),black=gate(),calls=[];const {bridge}=await fixture(t,c=>{calls.push(c);return c.action==='stop'?black.promise:normal.promise;},{acknowledgements:true});
 const p=await peer(t,bridge);p.socket.write('GPI 1\r\n');await until(()=>calls.length===1);p.socket.write('GPI 8\r\nGPI 8\r\nGPI 8\r\n');
 await until(()=>bridge.snapshot().stopFollowers===2);black.reject(Error('private filesystem path'));await until(()=>bridge.snapshot().failed===3);
 p.socket.write('GPI 2\r\n');await until(()=>bridge.snapshot().queued===1);await wait(20);assert.equal(calls.length,2);
 normal.resolve();await until(()=>bridge.snapshot().completed===1);assert.equal(calls.at(-1).action,'next');assert.ok(!p.text.includes('private'));
});

test('close cancels Stop, its followers and queued work without waiting on actual callbacks',async t=>{
 const normal=gate(),black=gate(),calls=[];const {bridge}=await fixture(t,c=>{calls.push(c);return c.action==='stop'?black.promise:normal.promise;});
 const p=await peer(t,bridge);p.socket.write('GPI 1\r\n');await until(()=>calls.length===1);p.socket.write('GPI 8\r\nGPI 8\r\nGPI 2\r\n');await until(()=>bridge.snapshot().accepted===4);
 await bridge.close();assert.equal(bridge.snapshot().state,'closed');assert.equal(bridge.snapshot().cancelled,4);assert.equal(bridge.snapshot().outstandingCallbacks,0);
 assert.ok(calls.every(c=>c.signal.aborted));normal.resolve();black.resolve();await wait(20);assert.equal(bridge.snapshot().completed,0);
});

test('silent write-half-close releases connection slots while preserving accepted callback ordering',async t=>{
 const normal=gate(),calls=[];const {bridge}=await fixture(t,c=>{calls.push(c.action);return c.action==='launch'?normal.promise:undefined;},{maxConnections:1,handlerTimeoutMs:5000});
 const first=await peer(t,bridge);first.socket.end('GPI 1\r\n');await until(()=>calls.length===1&&first.closed&&bridge.snapshot().connections===0);
 for(let i=0;i<30;i++){const p=await peer(t,bridge);p.socket.end('GPI 8\r\n');await until(()=>p.closed&&bridge.snapshot().connections===0);}
 assert.equal(calls.filter(c=>c==='stop').length,1);assert.equal(bridge.snapshot().completed,30);assert.equal(bridge.snapshot().outstandingCallbacks,1);
 normal.resolve();await until(()=>bridge.snapshot().outstandingCallbacks===0);assert.equal(bridge.snapshot().rejected,0);
});

test('priority keeps malformed-frame rejection and listener recovery',async t=>{
 const {bridge}=await fixture(t,async()=>{}, {acknowledgements:true,maxFrameBytes:16});
 for(const frame of ['GPI 1\n','gpi 1\r\n','x'.repeat(17)]){const p=await peer(t,bridge);p.socket.write(frame);await until(()=>p.closed);}
 const good=await peer(t,bridge);good.socket.write('GPI 8\r\n');await until(()=>bridge.snapshot().completed===1);
 assert.equal(bridge.snapshot().accepted,1);
});

test('priority mode opts into extended bounded deadlines without changing legacy validation or defaults',()=>{
 assert.throws(()=>new RossTalkBridge({...config,handlerTimeoutMs:10001},{allowEphemeral:true,handleCommand(){}}));
 for(const prioritizeStop of [null,1,'true'])assert.throws(()=>new RossTalkBridge(config,{allowEphemeral:true,prioritizeStop,handleCommand(){}}));
 const normal=new RossTalkBridge(config,{allowEphemeral:true,prioritizeStop:true,handleCommand(){}});assert.equal(normal.config.handlerTimeoutMs,2000);
 const extended=new RossTalkBridge({...config,handlerTimeoutMs:300000},{allowEphemeral:true,prioritizeStop:true,handleCommand(){}});assert.equal(extended.config.handlerTimeoutMs,300000);
 assert.throws(()=>new RossTalkBridge({...config,handlerTimeoutMs:300001},{allowEphemeral:true,prioritizeStop:true,handleCommand(){}}));
 assert.throws(()=>normalizeRossTalkConfig({...config,port:7788},{allowExtendedTimeout:'true'}));
});

test('observer-triggered close during Stop admission cannot leak a pending request or dispatch after close',async t=>{
 const calls=[];const {bridge}=await fixture(t,c=>{calls.push(c);});bridge.on('command',value=>{if(value.action==='stop')void bridge.close();});
 const p=await peer(t,bridge);p.socket.write('GPI 8\r\n');await until(()=>bridge.snapshot().state==='closed');
 assert.equal(calls.length,0);assert.equal(bridge.snapshot().accepted,1);assert.equal(bridge.snapshot().cancelled,1);assert.equal(bridge.snapshot().outstandingCallbacks,0);
});
