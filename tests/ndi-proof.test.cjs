'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const {peMachine}=require('../scripts/prepare-ndi-proof.cjs');
const {requestProbe}=require('../scripts/ndi-proof-client.cjs');
const {ndiConfiguration,captureEndingTree}=require('../scripts/smoke-ndi-windows.cjs');
test('NDI runtime PE check bounds the offset and requires a genuine PE signature',()=>{
  const pe=Buffer.alloc(128);pe.write('MZ');pe.writeUInt32LE(80,60);pe.writeUInt32LE(0x4550,80);pe.writeUInt16LE(0x8664,84);
  assert.equal(peMachine(pe),0x8664);const x86=Buffer.from(pe);x86.writeUInt16LE(0x14c,84);assert.equal(peMachine(x86),0x14c);
  for(const bad of [null,Buffer.alloc(63),Buffer.alloc(128),pe.subarray(0,85)])assert.throws(()=>peMachine(bad),/RUNTIME_PE_INVALID/);
  for(const offset of [0,63,123,0xffffffff]){const bad=Buffer.from(pe);bad.writeUInt32LE(offset,60);assert.throws(()=>peMachine(bad),/RUNTIME_PE_INVALID/);}
  const bad=Buffer.from(pe);bad[80]=0;assert.throws(()=>peMachine(bad),/RUNTIME_PE_INVALID/);
});
test('NDI probe exchanges actual bounded TCP and redacts untrusted failure replies',async t=>{
  const sockets=new Set(),received=[];
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    let bytes='';socket.on('data',chunk=>{bytes+=chunk;const end=bytes.indexOf('\n');if(end<0)return;const value=JSON.parse(bytes.slice(0,end));received.push(value);
      switch(value.command){
        case 'bad-json':return socket.end('PRIVATE-SECRET\n');
        case 'wrong-id':return socket.end(JSON.stringify({id:value.id+1,ok:true})+'\n');
        case 'bad-ok':return socket.end(JSON.stringify({id:value.id,ok:1})+'\n');
        case 'error':return socket.end(JSON.stringify({id:value.id,ok:false,code:'FRAME_TIMEOUT'})+'\n');
        case 'private':return socket.end(JSON.stringify({id:value.id,ok:false,code:'PRIVATE-secret-token'})+'\n');
        case 'big':return socket.end('x'.repeat(65537));
        case 'close':return socket.end();
        case 'stall':return;
        default:socket.write(JSON.stringify({id:value.id,ok:true,connections:1}).slice(0,5));return setTimeout(()=>socket.end(JSON.stringify({id:value.id,ok:true,connections:1}).slice(5)+'\n'),5);
      }
    });
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));});
  const port=server.address().port,token='private-control-token';
  const r=await requestProbe(port,token,1,'frame',{token:'override',id:77,command:'private',name:'synthetic'});assert.equal(r.connections,1);assert.equal(received[0].token,token);assert.equal(received[0].id,1);assert.equal(received[0].command,'frame');
  for(const [command,code]of [['bad-json','PROBE_PROTOCOL'],['wrong-id','PROBE_PROTOCOL'],['bad-ok','PROBE_PROTOCOL'],['error','PROBE_FRAME_TIMEOUT'],['private','PROBE_FAILED'],['big','PROBE_RESPONSE_LIMIT'],['close','PROBE_CLOSED'],['stall','PROBE_TIMEOUT']])await assert.rejects(requestProbe(port,token,2,command,{},100),error=>error.message===code&&!error.message.includes(token));
  await assert.rejects(requestProbe(port,token,3,'frame',{name:'x'.repeat(4096)}),/PROBE_REQUEST_LIMIT/);
  for(const [p,id,ms]of [[0,1,100],[65536,1,100],[port,0,100],[port,1,0],[port,1,60001]])await assert.rejects(requestProbe(p,token,id,'frame',{},ms),/PROBE_OPTIONS/);
});
test('NDI proof config admits only a bounded inert name and retains private logging controls',()=>{
  const xml=ndiConfiguration(5250,'PiRaiders-CI-123');assert.match(xml,/<ndi><name>PiRaiders-CI-123<\/name><allow-fields>false<\/allow-fields><\/ndi>/);assert.match(xml,/<log-path disabled="true">/);assert.match(xml,/<auto-load>false<\/auto-load>/);
  for(const label of ['',null,'<name>','x y','x'.repeat(65),'x\n'])assert.throws(()=>ndiConfiguration(5250,label),/NDI_LABEL_INVALID/);
  assert.throws(()=>ndiConfiguration(0,'test'));
});

test('NDI ending capture reserves boundary time and rejects expired or replaced hosts',async()=>{
  const host={pid:123,exitCode:null,signalCode:null},tree=Object.freeze([{identity:'complete synthetic capture'}]);
  let active=host,wall=0,options,calls=0;
  const capture=async(pid,value)=>{calls++;assert.equal(pid,123);options=value;return{tree};};
  const deps={capture,wallNow:()=>wall,now:()=>100};
  assert.equal(await captureEndingTree(host,30000,()=>active,deps),tree);
  assert.equal(options.deadline,15100);assert.equal(options.expectedParentPid,process.pid);assert.ok(options.expectedImage);
  wall=22000;await captureEndingTree(host,30000,()=>active,deps);assert.equal(options.deadline,3100);
  wall=25000;await assert.rejects(captureEndingTree(host,30000,()=>active,deps),/WINDOW_CAPTURE_LATE/);assert.equal(calls,2);
  wall=0;active={...host};await assert.rejects(captureEndingTree(host,30000,()=>active,deps),/WINDOW_CAPTURE_LATE/);
  active=host;host.exitCode=1;await assert.rejects(captureEndingTree(host,30000,()=>active,deps),/WINDOW_CAPTURE_LATE/);host.exitCode=null;
  for(const change of [()=>{wall=25000;},()=>{active={...host};},()=>{host.signalCode='SIGTERM';}]){
    wall=0;active=host;host.signalCode=null;
    await assert.rejects(captureEndingTree(host,30000,()=>active,{...deps,capture:async()=>{change();return{tree};}}),/WINDOW_CAPTURE_STALE/);
  }
  host.signalCode=null;wall=0;active=host;
  const failure=Error('PROCESS_IDENTITY_UNVERIFIED');
  await assert.rejects(captureEndingTree(host,30000,()=>active,{...deps,capture:async()=>{throw failure;}}),error=>error===failure);
});
