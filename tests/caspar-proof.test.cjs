'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const net=require('node:net');
const crypto=require('node:crypto');
const {PNG}=require('pngjs');
const {download,preparationDiagnostic}=require('../scripts/prepare-caspar-proof.cjs');
const {configuration,checkPixels,command}=require('../scripts/smoke-caspar-windows.cjs');
test('proof download verifies actual streamed bytes and removes corrupt/oversize/failed attempts',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders proof download '));
  const bytes=Buffer.alloc(100000,17),sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  const server=http.createServer((req,res)=>{if(req.url==='/fail'){res.writeHead(503);return res.end();}res.write(bytes.subarray(0,50000));res.end(bytes.subarray(50000));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});});
  const pin={name:'fixture',url:'http://127.0.0.1:'+server.address().port,sha256,maxBytes:bytes.length};
  const target=path.join(root,'fixture');
  const result=await download(pin,target);assert.equal(result.bytes,bytes.length);assert.deepEqual(await fs.readFile(target),bytes);await fs.rm(target);
  for(const [override,code]of [[{sha256:'0'.repeat(64)},'DOWNLOAD_HASH'],[{maxBytes:1},'DOWNLOAD_LIMIT'],[{url:pin.url+'/fail'},'DOWNLOAD_FAILED']]){
    await assert.rejects(download({...pin,...override},target),new RegExp(code));assert.deepEqual(await fs.readdir(root),[]);
  }
});
test('a pin mismatch reports the observed digest and length before removal and can never become success',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders proof mismatch '));
  const bytes=Buffer.alloc(70000,23),observed=crypto.createHash('sha256').update(bytes).digest('hex');
  const server=http.createServer((req,res)=>res.end(bytes));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});});
  const pin={name:'fixture',url:'http://127.0.0.1:'+server.address().port,sha256:'0'.repeat(64),maxBytes:bytes.length},target=path.join(root,'fixture');
  const seen=[];
  await assert.rejects(download(pin,target,{onMismatch:async value=>{seen.push({...value,frozen:Object.isFrozen(value),present:(await fs.readFile(value.file)).equals(bytes)});}}),/^Error: DOWNLOAD_HASH$/);
  assert.equal(seen.length,1);assert.equal(seen[0].observedSha256,observed);assert.equal(seen[0].bytes,bytes.length);assert.equal(seen[0].present,true);assert.equal(seen[0].frozen,true);
  assert.deepEqual(await fs.readdir(root),[]);
  // A failing or "approving" hook changes nothing: same error, nothing retained.
  for(const onMismatch of [()=>{throw Error('PRIVATE');},async()=>true])await assert.rejects(download(pin,target,{onMismatch}),/^Error: DOWNLOAD_HASH$/);
  assert.deepEqual(await fs.readdir(root),[]);
  // A matching pin never calls the hook.
  let called=false;await download({...pin,sha256:observed},target,{onMismatch:()=>{called=true;}});assert.equal(called,false);
  const {pinMismatchDiagnostic,PIN}=require('../scripts/prepare-ndi-proof.cjs');
  assert.deepEqual(pinMismatchDiagnostic(PIN,observed,bytes.length,{signatureStatus:'Valid',signer:' CN=Example ',fileVersion:'1.2.3.4   ',productVersion:null,productName:'x'.repeat(300),extra:'C:\\private'}),
    {event:'ndi-installer-pin-mismatch',name:'ndi-runtime',expectedSha256:PIN.sha256,observedSha256:observed,bytes:bytes.length,signature:{signatureStatus:'Valid',signer:'CN=Example',fileVersion:'1.2.3.4',productVersion:null,productName:'x'.repeat(200)}});
  assert.deepEqual(pinMismatchDiagnostic(PIN,'not-a-digest',-1,null),{event:'ndi-installer-pin-mismatch',name:'ndi-runtime',expectedSha256:PIN.sha256,observedSha256:null,bytes:null,signature:null});
});
test('proof protocol uses real bounded TCP and never exposes native echoed private text',async t=>{
  const server=net.createServer(socket=>socket.on('data',bytes=>{
    if(bytes.toString().startsWith('BAD'))socket.end('400 PRIVATE-URL-SECRET\r\n');
    else if(bytes.toString().startsWith('BIG'))socket.end('x'.repeat(17000));
    else if(bytes.toString().startsWith('CLOSE'))socket.end();
    else if(bytes.toString().startsWith('STALL'))return;
    else socket.end('202 PLAY OK\r\n');
  }));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const port=server.address().port;await command(port,'PLAY');
  for(const [value,code]of [['BAD','PROTOCOL_REJECTED'],['BIG','PROTOCOL_LIMIT'],['CLOSE','PROTOCOL_CLOSED'],['STALL','PROTOCOL_TIMEOUT']])await assert.rejects(command(port,value,{timeoutMs:value==='STALL'?100:5000}),error=>error.message===code&&!error.message.includes('SECRET'));
});
test('proof rejects wrong or stale mixed-frame pixels',()=>{
  const data=Buffer.alloc(1920*1080*4);for(let i=0;i<data.length;i+=4)data.set([240,20,20,255],i);
  const bytes=PNG.sync.write({width:1920,height:1080,data});checkPixels(bytes,[240,20,20]);assert.throws(()=>checkPixels(bytes,[0,0,0]),/MIXED_PIXELS/);
  assert.throws(()=>checkPixels(PNG.sync.write({width:1920,height:1080,data:Buffer.alloc(data.length)}),[0,0,0]),/ALPHA_UNVERIFIED/);
  const config=configuration(5250);assert.match(config,/<log-path disabled="true">/);assert.match(config,/<auto-load>false<\/auto-load>/);assert.doesNotMatch(config,/<address>/);assert.throws(()=>configuration(0));
});

test('tool preparation failure diagnostics retain only fixed phase and allowlisted categories',()=>{
  const error=Object.assign(Error('private-path https://secret/?token=hidden'),{code:'ECONNRESET',cause:{code:'UND_ERR_SOCKET',message:'private-stderr'},stderr:'private-stderr'});
  const result=preparationDiagnostic(error,'DOWNLOAD','caspar');
  assert.deepEqual(result,{event:'caspar-proof-preparation-failed',phase:'DOWNLOAD',tool:'caspar',code:'TOOL_PREPARATION_FAILED',systemErrorCode:'ECONNRESET',causeCode:'UND_ERR_SOCKET',timedOut:false});
  assert.deepEqual(preparationDiagnostic(Object.assign(Error('DOWNLOAD_HASH'),{code:'PRIVATE',cause:{code:'PRIVATE'},name:'TimeoutError'}),'PRIVATE','PRIVATE'),{event:'caspar-proof-preparation-failed',phase:'UNKNOWN',tool:null,code:'DOWNLOAD_HASH',systemErrorCode:null,causeCode:null,timedOut:true});
  assert.equal(JSON.stringify(result).includes('private'),false);
  assert.equal(preparationDiagnostic(null,null,null).code,'TOOL_PREPARATION_FAILED');
});
