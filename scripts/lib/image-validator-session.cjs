'use strict';
// Operation-scoped decoder. One request at a time; no persistent application pool.
const path=require('node:path');
const {Worker}=require('node:worker_threads');
const {performance}=require('node:perf_hooks');
const {MAX_INPUT_BYTES}=require('./image-validator.cjs');
const CODES=new Set(['INVALID_IMAGE','UNSUPPORTED_IMAGE','IMAGE_DIMENSION_LIMIT','IMAGE_DECODE_FAILED']);
const fail=code=>Object.assign(Error('Image validation rejected'),{code});
function input(buffer,options){
 if(!options||typeof options!=='object'||Array.isArray(options))throw fail('INVALID_OPTIONS');
 const {extension,maxPixels=16777216,maxDimension=8192,timeoutMs=10000,signal,maxMemoryUsageInMB=128}=options;
 if(!Buffer.isBuffer(buffer)||typeof extension!=='string'||!Number.isInteger(maxPixels)||maxPixels<1||maxPixels>16777216||
  !Number.isInteger(maxDimension)||maxDimension<1||maxDimension>8192||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000||
  !Number.isInteger(maxMemoryUsageInMB)||maxMemoryUsageInMB<1||maxMemoryUsageInMB>512||(signal!==undefined&&!(signal instanceof AbortSignal)))throw fail('INVALID_OPTIONS');
 if(signal?.aborted)throw fail('IMAGE_ABORTED');
 if(buffer.length>MAX_INPUT_BYTES)throw fail('IMAGE_TOO_LARGE');
 const ext=extension.toLowerCase().replace(/^\./,'');if(!['png','jpg','jpeg'].includes(ext))throw fail('UNSUPPORTED_IMAGE');
 const format=buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':buffer.length>=2&&buffer[0]===255&&buffer[1]===216?'jpeg':null;
 if(!format)throw fail('INVALID_IMAGE');if(format!==(ext==='png'?'png':'jpeg'))throw fail('IMAGE_FORMAT_MISMATCH');
 return{format,maxPixels,maxDimension,timeoutMs,signal,maxMemoryUsageInMB};
}
function createImageValidationSession(){
 let worker=null,inflight=null,closePromise=null,closed=false,terminated=false,requests=0,exitPromise=null,observedExit=false,faultCode=null;
 function clean(request){clearTimeout(request.timer);request.signal?.removeEventListener('abort',request.abort);}
 function terminate(code){
  if(closePromise)return closePromise;
  closed=true;let resolve,reject;
  closePromise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  // Observe rejection even for an unexpected idle-worker fault. Callers still
  // receive this same rejecting physical-close promise from close().
  void closePromise.catch(()=>{});
  const request=inflight;inflight=null;if(request)clean(request);
  let stopping;try{stopping=worker?.terminate();}catch{stopping=Promise.reject(fail('IMAGE_DECODE_FAILED'));}
  // A rejected terminate call is not evidence that the native thread is gone.
  // Keep this request/close physically owned until the real exit event arrives.
  void (async()=>{
   let failed=false;try{await stopping;}catch{failed=true;faultCode='IMAGE_DECODE_FAILED';}
   if(worker&&!observedExit)await exitPromise;
   terminated=true;
   if(request)request.reject(fail(failed?'IMAGE_DECODE_FAILED':code||'IMAGE_ABORTED'));
   if(failed)reject(fail('IMAGE_DECODE_FAILED'));else resolve();
  })();
  return closePromise;
 }
 function fault(code){faultCode??=code;void terminate(code);}
 function receive(message){
  if(closed)return;
  const request=inflight;
  if(!request||message?.id!==request.id){fault('IMAGE_DECODE_FAILED');return;}
  if(request.signal?.aborted){fault('IMAGE_ABORTED');return;}
  if(performance.now()>=request.deadline){fault('IMAGE_TIMEOUT');return;}
  if(message?.ok!==true){fault(CODES.has(message?.code)?message.code:'IMAGE_DECODE_FAILED');return;}
  if(Reflect.ownKeys(message).length!==5||!['id','ok','format','width','height'].every(k=>Object.hasOwn(message,k))||
   message.format!==request.format||!Number.isInteger(message.width)||message.width<1||message.width>request.maxDimension||
   !Number.isInteger(message.height)||message.height<1||message.height>request.maxDimension||message.width*message.height>request.maxPixels){fault('IMAGE_DECODE_FAILED');return;}
  inflight=null;clean(request);request.resolve(Object.freeze({format:message.format,width:message.width,height:message.height}));
 }
 function validate(buffer,options={}){
  if(closed)return Promise.reject(fail('IMAGE_SESSION_CLOSED'));
  if(inflight)return Promise.reject(fail('IMAGE_BUSY'));
  if(requests>=500){fault('IMAGE_SESSION_LIMIT');return closePromise.then(()=>{throw fail('IMAGE_SESSION_LIMIT');});}
  let c;try{c=input(buffer,options);}catch(error){fault(error.code||'INVALID_OPTIONS');return closePromise.then(()=>{throw error;});}
  const deadline=performance.now()+c.timeoutMs;
  // A dedicated copy is transferred; callers retain their original allocation.
  let bytes;try{bytes=Uint8Array.from(buffer);}catch{fault('IMAGE_DECODE_FAILED');return closePromise.then(()=>{throw fail('IMAGE_DECODE_FAILED');});}
  const remaining=deadline-performance.now();
  if(remaining<=0){fault('IMAGE_TIMEOUT');return closePromise.then(()=>{throw fail('IMAGE_TIMEOUT');});}
  return new Promise((resolve,reject)=>{
   const request={...c,id:++requests,deadline,resolve,reject,timer:null,abort:null};
   inflight=request;request.abort=()=>fault('IMAGE_ABORTED');
   request.timer=setTimeout(()=>fault('IMAGE_TIMEOUT'),remaining);
   c.signal?.addEventListener('abort',request.abort,{once:true});
   if(c.signal?.aborted){fault('IMAGE_ABORTED');return;}
   try{
    if(!worker){worker=new Worker(path.join(__dirname,'image-decoder-session-worker.cjs'),{resourceLimits:{maxOldGenerationSizeMb:64,maxYoungGenerationSizeMb:16}});
     let resolveExit;exitPromise=new Promise(resolve=>{resolveExit=resolve;});
     worker.once('exit',()=>{observedExit=true;resolveExit();if(!closed)fault('IMAGE_DECODE_FAILED');});
     worker.on('message',receive);worker.once('error',()=>fault('IMAGE_DECODE_FAILED'));}
    worker.postMessage({id:request.id,bytes,format:c.format,maxPixels:c.maxPixels,maxDimension:c.maxDimension,maxMemoryUsageInMB:c.maxMemoryUsageInMB},[bytes.buffer]);
   }catch{fault('IMAGE_DECODE_FAILED');}
  });
 }
 return Object.freeze({validate,close:()=>terminate(),snapshot:()=>Object.freeze({closed:terminated,admissionClosed:closed,busy:inflight!==null||closed&&!terminated,requests,hasWorker:worker!==null,faultCode})});
}
module.exports={createImageValidationSession};
