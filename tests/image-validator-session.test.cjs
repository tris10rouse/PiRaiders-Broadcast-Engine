'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Worker}=require('node:worker_threads'),{once}=require('node:events');
const {PNG}=require('pngjs'),jpeg=require('jpeg-js');
const {createImageValidationSession}=require('../scripts/lib/image-validator-session.cjs');
const tick=()=>new Promise(r=>setImmediate(r));
function gate(){let resolve;return{promise:new Promise(r=>resolve=r),resolve:()=>resolve()};}
function image(format='png'){const data=Buffer.from([255,0,0,255,0,255,0,255]);return format==='png'?PNG.sync.write({width:2,height:1,data}):jpeg.encode({width:2,height:1,data},90).data;}
function session(t){const s=createImageValidationSession();t.after(()=>s.close());return s;}
function code(expected){return e=>e.code===expected;}
function workerProbe(t,{holdPost=false,holdTermination=false}={}){
 const post=Worker.prototype.postMessage,terminate=Worker.prototype.terminate,entered=gate(),terminated=gate(),release=gate();
 const seen=new Set();let saved,worker,terminationCalls=0;
 t.mock.method(Worker.prototype,'postMessage',function(message,transfer){
  worker=this;seen.add(this);saved={message,transfer};entered.resolve();
  if(!holdPost)return post.call(this,message,transfer);
 });
 t.mock.method(Worker.prototype,'terminate',function(){terminationCalls++;const p=terminate.call(this);return Promise.resolve(p).then(async value=>{terminated.resolve();if(holdTermination)await release.promise;return value;});});
 t.after(()=>release.resolve());
 return{entered:entered.promise,terminated:terminated.promise,release:release.resolve,count:()=>seen.size,terminationCalls:()=>terminationCalls,worker:()=>worker,
  send:()=>post.call(worker,saved.message,saved.transfer)};
}
async function online(worker){if(worker.threadId===-1)throw Error('WORKER_EXITED_BEFORE_ONLINE');await once(worker,'online');}

test('lazy operation session decodes real PNG/JPEG with one worker and dedicated copies',async t=>{
 const p=workerProbe(t),s=session(t);assert.equal(s.snapshot().hasWorker,false);
 const png=image(),original=Buffer.from(png),pending=s.validate(png,{extension:'.png'});png.fill(0);
 assert.deepEqual(await pending,{format:'png',width:2,height:1});assert.equal(png.byteLength,original.byteLength,'caller allocation not detached');
 const jpg=image('jpeg'),before=Buffer.from(jpg);assert.deepEqual(await s.validate(jpg,{extension:'.jpg'}),{format:'jpeg',width:2,height:1});assert.deepEqual(jpg,before);
 assert.equal(p.count(),1);assert.equal(p.terminationCalls(),0);const first=s.close();assert.equal(first,s.close());await first;assert.equal(p.terminationCalls(),1);assert.equal(s.snapshot().closed,true);assert.equal(s.snapshot().busy,false);
});
test('request limits are applied afresh and a failed full decode permanently faults session',async t=>{
 const s=session(t);await s.validate(image(),{extension:'.png',maxPixels:2,maxDimension:2});
 await assert.rejects(s.validate(image('jpeg'),{extension:'.jpg',maxDimension:1}),code('IMAGE_DIMENSION_LIMIT'));
 assert.equal(s.snapshot().closed,true);await assert.rejects(s.validate(image(),{extension:'.png'}),code('IMAGE_SESSION_CLOSED'));
});
test('valid signature corrupt CRC and truncated JPEG fail in actual decoder then terminate',async t=>{
 for(const format of ['png','jpeg']){const s=session(t),b=image(format);if(format==='png')b[b.length-1]^=1;else b[b.length-2]=0;
  await assert.rejects(s.validate(b,{extension:format==='png'?'.png':'.jpg'}),code('INVALID_IMAGE'));assert.equal(s.snapshot().closed,true);}
});
test('preflight byte/format/options/abort limits fault lazily without workers',async t=>{
 const p=workerProbe(t);
 for(const [buffer,options,expected]of [[Buffer.alloc(20971521),{extension:'.png'},'IMAGE_TOO_LARGE'],[image(),{extension:'.gif'},'UNSUPPORTED_IMAGE'],[image(),{extension:'.jpg'},'IMAGE_FORMAT_MISMATCH'],[image(),{extension:'.png',timeoutMs:10001},'INVALID_OPTIONS'],[image(),{extension:'.png',maxPixels:16777217},'INVALID_OPTIONS'],[image(),{extension:'.png',signal:AbortSignal.abort()},'IMAGE_ABORTED']]){
  const s=session(t);await assert.rejects(s.validate(buffer,options),code(expected));assert.equal(s.snapshot().closed,true);
 }assert.equal(p.count(),0);
});
test('concurrent call is rejected without queueing or poisoning the owned flight',async t=>{
 const p=workerProbe(t,{holdPost:true}),s=session(t);const first=s.validate(image(),{extension:'.png'});await p.entered;
 await assert.rejects(s.validate(image(),{extension:'.png'}),code('IMAGE_BUSY'));assert.equal(s.snapshot().requests,1);p.send();assert.equal((await first).format,'png');assert.equal(p.count(),1);
});
for(const mode of ['abort','timeout','close'])test(mode+' waits actual worker termination and ignores late responses',{timeout:15000},async t=>{
 const p=workerProbe(t,{holdPost:true,holdTermination:true}),s=session(t),controller=new AbortController();let fire;
 if(mode==='timeout'){const schedule=global.setTimeout;t.mock.method(global,'setTimeout',(fn,ms,...args)=>{if(!(ms>4000&&ms<=4321))return schedule(fn,ms,...args);fire=()=>fn(...args);const timer=schedule(()=>{},3600000);timer.unref();return timer;});}
 const pending=s.validate(image(),{extension:'.png',signal:controller.signal,timeoutMs:mode==='timeout'?4321:10000});const rejected=assert.rejects(pending,code(mode==='timeout'?'IMAGE_TIMEOUT':'IMAGE_ABORTED'));
 await p.entered;await online(p.worker());
 if(mode==='abort')controller.abort();else if(mode==='timeout'){assert.equal(typeof fire,'function');fire();}else void s.close();
 await p.terminated;let acknowledged=false;void pending.then(()=>{acknowledged=true;},()=>{acknowledged=true;});await tick();assert.equal(acknowledged,false);assert.equal(s.snapshot().busy,true);assert.equal(s.snapshot().closed,false);
 p.worker().emit('message',{id:1,ok:true,format:'png',width:2,height:1});await tick();assert.equal(acknowledged,false);
 p.release();await rejected;await s.close();assert.equal(s.snapshot().closed,true);assert.equal(p.worker().threadId,-1);assert.equal(p.terminationCalls(),1);await assert.rejects(s.validate(image(),{extension:'.png'}),code('IMAGE_SESSION_CLOSED'));
});
test('malformed/wrong request ID response faults the actual worker and no result is accepted',async t=>{
 const p=workerProbe(t,{holdPost:true}),s=session(t),pending=s.validate(image(),{extension:'.png'});const rejected=assert.rejects(pending,code('IMAGE_DECODE_FAILED'));await p.entered;await online(p.worker());
 p.worker().emit('message',{id:2,ok:true,format:'png',width:2,height:1});await rejected;assert.equal(p.worker().threadId,-1);assert.equal(s.snapshot().closed,true);
});
test('500 sequential actual decodes share one worker; request501 closes session', {timeout:30000},async t=>{
 const p=workerProbe(t),s=session(t),b=image();for(let i=0;i<500;i++)await s.validate(b,{extension:'.png'});
 assert.equal(s.snapshot().requests,500);assert.equal(p.count(),1);await assert.rejects(s.validate(b,{extension:'.png'}),code('IMAGE_SESSION_LIMIT'));assert.equal(p.worker().threadId,-1);assert.equal(s.snapshot().closed,true);
});
for(const mode of ['throw','reject'])test('failed terminate '+mode+' retains real worker ownership until confirmed exit',{timeout:15000},async t=>{
 const p=workerProbe(t,{holdPost:true}),s=createImageValidationSession();
 const original=Worker.prototype.terminate;
 t.after(async()=>{if(p.worker()?.threadId!==-1)await original.call(p.worker());await s.close().catch(()=>{});});
 t.mock.method(Worker.prototype,'terminate',function(){if(mode==='throw')throw Error('PRIVATE_TERMINATE');return Promise.reject(Error('PRIVATE_TERMINATE'));});
 const pending=s.validate(image(),{extension:'.png'}),requestFailure=assert.rejects(pending,e=>e.code==='IMAGE_DECODE_FAILED');
 await p.entered;await once(p.worker(),'online');const closing=s.close(),closeFailure=assert.rejects(closing,e=>e.code==='IMAGE_DECODE_FAILED');
 let settled=false;void closing.then(()=>{settled=true;},()=>{settled=true;});await new Promise(r=>setImmediate(r));
 assert.equal(settled,false);assert.equal(s.snapshot().busy,true);assert.equal(s.snapshot().admissionClosed,true);assert.equal(s.snapshot().closed,false);assert.notEqual(p.worker().threadId,-1);
 await original.call(p.worker());await requestFailure;await closeFailure;
 assert.equal(s.snapshot().closed,true);assert.equal(s.snapshot().busy,false);assert.equal(p.worker().threadId,-1);
});
test('idle unexpected worker response is a persistent operation fault',{timeout:10000},async t=>{
 const p=workerProbe(t),s=createImageValidationSession();t.after(()=>s.close());await s.validate(image(),{extension:'.png'});
 p.worker().emit('message',{id:1,ok:true,format:'png',width:2,height:1});await s.close();
 assert.equal(s.snapshot().faultCode,'IMAGE_DECODE_FAILED');assert.equal(p.worker().threadId,-1);await assert.rejects(s.validate(image(),{extension:'.png'}),e=>e.code==='IMAGE_SESSION_CLOSED');
});
test('dedicated-copy elapsed time shrinks the one immutable image timer',async t=>{
 const {performance}=require('node:perf_hooks');const bytes=image(),from=Uint8Array.from,schedule=global.setTimeout;let clock=0,installed=null;
 t.mock.method(performance,'now',()=>clock);
 t.mock.method(Uint8Array,'from',function(value,...args){const owned=from.call(this,value,...args);if(value===bytes)clock+=4000;return owned;});
 t.mock.method(global,'setTimeout',(fn,ms,...args)=>{if(ms<=5000)installed=ms;return schedule(fn,ms,...args);});
 const s=createImageValidationSession();t.after(()=>s.close());await s.validate(bytes,{extension:'.png',timeoutMs:5000});assert.equal(installed,1000);await s.close();
});

// Largest contract-legal JPEG: 4096 x 4096 = 16,777,216 pixels (exchange contract, bounds table).
const {syntheticJpeg,SYNTHETIC_JPEG_LAYOUTS}=require('./synthetic-jpeg.cjs');
const {IMAGE_SESSION_WORKER_HEAP}=require('../scripts/lib/image-validator-session.cjs');
const {EXCHANGE_SNAPSHOT_LIMITS}=require('../scripts/lib/exchange-snapshot.cjs');
test('synthetic JPEG builder output is accepted in every layout, baseline and progressive, at odd sizes',async t=>{
 const s=session(t);
 for(const layout of SYNTHETIC_JPEG_LAYOUTS)for(const progressive of [false,true])for(const [width,height] of [[16,16],[17,9],[100,37]])
  assert.deepEqual(await s.validate(syntheticJpeg({width,height,layout,progressive}),{extension:'.jpg'}),{format:'jpeg',width,height},layout+' '+progressive+' '+width+'x'+height);
});
test('decoder worker heap is a fixed frozen cap and the exchange JPEG budget is the validator maximum',()=>{
 assert.deepEqual(IMAGE_SESSION_WORKER_HEAP,{maxOldGenerationSizeMb:384,maxYoungGenerationSizeMb:16});assert.equal(Object.isFrozen(IMAGE_SESSION_WORKER_HEAP),true);
 assert.equal(EXCHANGE_SNAPSHOT_LIMITS.jpegDecodeMemoryMb,512);assert.equal(EXCHANGE_SNAPSHOT_LIMITS.maxPixels,4096*4096);
});
for(const layout of SYNTHETIC_JPEG_LAYOUTS)for(const progressive of [false,true])
 test('4096 x 4096 '+layout+(progressive?' progressive':' baseline')+' JPEG decodes with the exchange budget inside the unchanged 10 s limit',{timeout:60000},async t=>{
  const s=session(t),b=syntheticJpeg({width:4096,height:4096,layout,progressive});
  assert.deepEqual(await s.validate(b,{extension:'.jpg',maxMemoryUsageInMB:EXCHANGE_SNAPSHOT_LIMITS.jpegDecodeMemoryMb,timeoutMs:10000}),{format:'jpeg',width:4096,height:4096});
  // The same worker stays usable for the next picture of the operation.
  assert.deepEqual(await s.validate(image(),{extension:'.png'}),{format:'png',width:2,height:1});assert.equal(s.snapshot().faultCode,null);
 });
test('the 128 MB default budget still refuses a 4096 x 4096 JPEG and the counted budget stays capped at 512',{timeout:60000},async t=>{
 const b=syntheticJpeg({width:4096,height:4096,layout:'4:2:0'});
 await assert.rejects(createImageValidationSession().validate(b,{extension:'.jpg'}),code('IMAGE_DECODE_FAILED'));
 await assert.rejects(createImageValidationSession().validate(b,{extension:'.jpg',maxMemoryUsageInMB:513}),code('INVALID_OPTIONS'));
 // One megabyte under what four full-resolution components count: refused, not silently accepted.
 const four=syntheticJpeg({width:4096,height:4096,layout:'four-component'});
 await assert.rejects(createImageValidationSession().validate(four,{extension:'.jpg',maxMemoryUsageInMB:448}),code('IMAGE_DECODE_FAILED'));
});
test('a JPEG above the pixel or side limit is refused before decoding',async t=>{
 await assert.rejects(createImageValidationSession().validate(syntheticJpeg({width:4104,height:4096,layout:'grey'}),{extension:'.jpg',maxMemoryUsageInMB:512}),code('IMAGE_DIMENSION_LIMIT'));
 await assert.rejects(createImageValidationSession().validate(syntheticJpeg({width:8200,height:8,layout:'grey'}),{extension:'.jpg',maxMemoryUsageInMB:512}),code('IMAGE_DIMENSION_LIMIT'));
});
test('a dense 4096 x 4096 colour JPEG just under 20 MiB decodes inside the unchanged 10 s limit',{timeout:120000},async t=>{
 // Deterministic noise, so every block carries real entropy-coded data; quality 73 gives 20,390,928 bytes.
 const width=4096,height=4096,data=Buffer.alloc(width*height*4),words=new Uint32Array(data.buffer,data.byteOffset,width*height);
 let x=0x9e3779b9;for(let i=0;i<words.length;i++){x^=x<<13;x^=x>>>17;x^=x<<5;words[i]=x;}
 const b=jpeg.encode({width,height,data},73).data;
 assert.ok(b.length>19*1024*1024&&b.length<=20*1024*1024,'synthetic dense JPEG is '+b.length+' bytes');
 const s=session(t),started=Date.now();
 assert.deepEqual(await s.validate(b,{extension:'.jpg',maxMemoryUsageInMB:EXCHANGE_SNAPSHOT_LIMITS.jpegDecodeMemoryMb,timeoutMs:10000}),{format:'jpeg',width,height});
 t.diagnostic('dense 4096 x 4096 4:4:4 JPEG, '+b.length+' bytes, decoded in '+(Date.now()-started)+' ms');
});
