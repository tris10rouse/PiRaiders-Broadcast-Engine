'use strict';
const {parentPort}=require('node:worker_threads');
const {decodeImage}=require('./image-decode-core.cjs');
let next=1,faulted=false;
function bad(id,code='IMAGE_DECODE_FAILED'){
 faulted=true;parentPort.postMessage({id,ok:false,code});parentPort.close();
}
parentPort.on('message',request=>{
 if(faulted)return;
 const id=request?.id;
 if(!request||typeof request!=='object'||Reflect.ownKeys(request).length!==6||
  !['id','bytes','format','maxPixels','maxDimension','maxMemoryUsageInMB'].every(k=>Object.hasOwn(request,k))||
  id!==next||id>500||!(request.bytes instanceof Uint8Array)||request.bytes.byteLength>20971520||
  !['png','jpeg'].includes(request.format)||!Number.isInteger(request.maxPixels)||request.maxPixels<1||request.maxPixels>16777216||
  !Number.isInteger(request.maxDimension)||request.maxDimension<1||request.maxDimension>8192||
  !Number.isInteger(request.maxMemoryUsageInMB)||request.maxMemoryUsageInMB<1||request.maxMemoryUsageInMB>512){bad(Number.isInteger(id)?id:null);return;}
 next++;
 try{
  const b=Buffer.from(request.bytes.buffer,request.bytes.byteOffset,request.bytes.byteLength);
  const result=decodeImage(b,request.format,request);
  parentPort.postMessage({id,ok:true,format:request.format,...result});
 }catch(error){bad(id,['INVALID_IMAGE','UNSUPPORTED_IMAGE','IMAGE_DIMENSION_LIMIT'].includes(error?.code)?error.code:'IMAGE_DECODE_FAILED');}
});
