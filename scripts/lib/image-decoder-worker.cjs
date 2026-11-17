'use strict';
// Legacy one-shot workerData/message protocol retained.
const {parentPort,workerData}=require('node:worker_threads');
const {decodeImage}=require('./image-decode-core.cjs');
try{
 const buffer=Buffer.from(workerData.bytes.buffer,workerData.bytes.byteOffset,workerData.bytes.byteLength);
 const result=decodeImage(buffer,workerData.format,workerData);
 parentPort.postMessage({ok:true,format:workerData.format,...result});
}catch(error){parentPort.postMessage({ok:false,code:['INVALID_IMAGE','UNSUPPORTED_IMAGE','IMAGE_DIMENSION_LIMIT'].includes(error?.code)?error.code:'IMAGE_DECODE_FAILED'});}
