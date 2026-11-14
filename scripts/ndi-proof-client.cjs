'use strict';
// Test-bench-only authenticated loopback protocol; not part of the app bundle.
const net=require('node:net');
function requestProbe(port,token,id,command,values={},timeoutMs=30000){
  if(!Number.isInteger(port)||port<1||port>65535||typeof token!=='string'||!Number.isSafeInteger(id)||id<1||typeof command!=='string'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)return Promise.reject(Error('PROBE_OPTIONS'));
  const bytes=Buffer.from(JSON.stringify({...values,token,id,command})+'\n');
  if(bytes.length>4096)return Promise.reject(Error('PROBE_REQUEST_LIMIT'));
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection({host:'127.0.0.1',port});let buffer=Buffer.alloc(0),done=false;
    const timer=setTimeout(()=>finish(Error('PROBE_TIMEOUT')),timeoutMs);
    function finish(error,value){if(done)return;done=true;clearTimeout(timer);socket.destroy();if(error)reject(error);else resolve(value);}
    socket.once('error',()=>finish(Error('PROBE_CONNECTION')));
    socket.once('connect',()=>socket.write(bytes));
    socket.once('close',()=>{if(!done)finish(Error('PROBE_CLOSED'));});
    socket.on('data',chunk=>{
      if(done)return;if(buffer.length+chunk.length>65536)return finish(Error('PROBE_RESPONSE_LIMIT'));
      buffer=Buffer.concat([buffer,chunk]);const end=buffer.indexOf('\n');if(end<0)return;
      try{
        const result=JSON.parse(buffer.subarray(0,end).toString('utf8'));
        if(!result||typeof result!=='object'||Array.isArray(result)||result.id!==id||typeof result.ok!=='boolean')throw Error('PROBE_PROTOCOL');
        if(!result.ok){const code=typeof result.code==='string'&&/^[A-Z_][A-Z_0-9]{0,63}$/.test(result.code)?result.code:'FAILED';throw Error('PROBE_'+code);}
        finish(null,result);
      }catch(error){finish(/^PROBE_[A-Z_0-9]+$/.test(error.message)?error:Error('PROBE_PROTOCOL'));}
    });
  });
}
module.exports={requestProbe};
