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
const {download}=require('../scripts/prepare-caspar-proof.cjs');
const {configuration,checkPixels,descendants,command}=require('../scripts/smoke-caspar-windows.cjs');
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
test('proof protocol uses real bounded TCP and never exposes native echoed private text',async t=>{
  const server=net.createServer(socket=>socket.on('data',bytes=>{
    if(bytes.toString().startsWith('BAD'))socket.end('400 PRIVATE-URL-SECRET\r\n');
    else if(bytes.toString().startsWith('BIG'))socket.end('x'.repeat(17000));
    else if(bytes.toString().startsWith('CLOSE'))socket.end();
    else if(bytes.toString().startsWith('STALL'))return;
    else socket.end('202 PLAY OK\r\n');
  }));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const port=server.address().port;await command(port,'PLAY');
  for(const [value,code]of [['BAD','PROTOCOL_REJECTED'],['BIG','PROTOCOL_LIMIT'],['CLOSE','PROTOCOL_CLOSED'],['STALL','PROTOCOL_TIMEOUT']])await assert.rejects(command(port,value,{timeoutMs:100}),error=>error.message===code&&!error.message.includes('SECRET'));
});
test('proof rejects wrong or stale mixed-frame pixels and verifies descendants transitively',()=>{
  const data=Buffer.alloc(1920*1080*4);for(let i=0;i<data.length;i+=4)data.set([240,20,20,255],i);
  const bytes=PNG.sync.write({width:1920,height:1080,data});checkPixels(bytes,[240,20,20]);assert.throws(()=>checkPixels(bytes,[0,0,0]),/MIXED_PIXELS/);
  assert.throws(()=>checkPixels(PNG.sync.write({width:1920,height:1080,data:Buffer.alloc(data.length)}),[0,0,0]),/ALPHA_UNVERIFIED/);
  assert.deepEqual(descendants([{ProcessId:3,ParentProcessId:2},{ProcessId:2,ParentProcessId:1},{ProcessId:8,ParentProcessId:7}],1).sort(),[1,2,3]);
  const config=configuration(5250);assert.match(config,/<log-path disabled="true">/);assert.match(config,/<auto-load>false<\/auto-load>/);assert.doesNotMatch(config,/<address>/);assert.throws(()=>configuration(0));
});
