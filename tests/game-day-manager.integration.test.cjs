'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {PNG}=require('pngjs');
const {createGameDayManager}=require('../scripts/lib/game-day-manager.cjs');
const {createPreparedEventRuntime}=require('../scripts/lib/prepared-event-runtime.cjs');
const req=(manager,extra={})=>{const s=manager.snapshot();return{expectedEventId:s.expectedEventId,expectedSelection:s.expectedSelection,...extra};};
async function server(port=0){const value=net.createServer(socket=>socket.destroy());await new Promise((resolve,reject)=>{value.once('error',reject);value.listen(port,'127.0.0.1',resolve);});return value;}
async function closeServer(value){await new Promise(resolve=>value.close(()=>resolve()));}
async function connects(port){return new Promise(resolve=>{const socket=net.createConnection({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>{socket.destroy();resolve(false);});});}
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders manager real media '))),reservation=await server(),port=reservation.address().port;await closeServer(reservation);
 const component=path.join(root,'component');await fs.mkdir(component);const executable=path.join(component,'casparcg.exe');await fs.writeFile(executable,'synthetic unexecuted OS boundary');
 const now=Date.now(),entries=new Map();
 for(const id of ['alpha','beta']){const sourceDir=path.join(root,'media',id);await fs.mkdir(sourceDir,{recursive:true});await fs.writeFile(path.join(sourceDir,'01.png'),PNG.sync.write({width:2,height:2,data:Buffer.alloc(16,255)}));
  entries.set(id,Object.freeze({profile:{schemaVersion:1,provider:'local-manual',eventId:id,
   productionWindow:{start:new Date(now+3600000).toISOString(),end:new Date(now+7200000).toISOString()},
   spx:{executable:path.join(root,'missing-unowned-spx.exe'),args:[],cwd:path.join(root,'missing-unowned-spx-cwd')},
   caspar:{executable,cwd:component,runtimeDir:path.join(root,'runtime',id)},
   media:{provider:'local-lexical-v1',sourceDir,cacheDir:path.join(root,'cache',id),startup:{mode:'source'}},
   rossTalk:{host:'127.0.0.1',port,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}}},descriptor:Object.freeze({eventId:id,displayName:'Test '+id}),revision:(id==='alpha'?'a':'b').repeat(64)}));
 }
 let spawns=0;
 const manager=createGameDayManager({catalog:{list:async()=>Object.freeze([...entries.values()].map(value=>Object.freeze({...value.descriptor,status:'available'}))),read:async id=>entries.get(id)},clock:()=>now,
  runtimeFactory:(profile,options)=>createPreparedEventRuntime(profile,{...options,spawnProcess(){spawns++;throw Error('outside production window must not spawn');}})});
 t.after(async()=>{await manager.close();await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});});
 return{root,entries,manager,port,get spawns(){return spawns;}};
}

test('manager stages/full-decodes real media and hands one real TCP listener between prepared event runtimes',async t=>{
 const f=await fixture(t),m=f.manager;
 const a=await m.prepare('alpha',req(m));assert.equal(a.ok,true);assert.equal(await connects(f.port),false,'preparation opens no RossTalk listener');
 assert.equal((await m.activate(req(m,{candidateId:a.candidateId}))).ok,true);assert.equal(await connects(f.port),true);assert.equal(m.snapshot().active.runtime.state,'waiting');assert.equal(m.snapshot().active.runtime.windowAllowed,false);assert.equal(f.spawns,0);
 const b=await m.prepare('beta',req(m));assert.equal(b.ok,true);assert.equal(await connects(f.port),true);assert.equal((await m.activate(req(m,{candidateId:b.candidateId}))).ok,true);assert.equal(await connects(f.port),true);assert.equal(m.snapshot().active.eventId,'beta');assert.equal(f.spawns,0);
 assert.equal((await m.dispatch('stop',req(m))).code,'CONTROL_INHIBITED');assert.equal((await m.close()).ok,true);assert.equal(await connects(f.port),false);assert.equal(f.spawns,0);assert.ok(!JSON.stringify(m.snapshot()).includes(f.root));
});

test('real corrupt media and occupied listener fail with sanitized results and recover after corrected input',async t=>{
 const f=await fixture(t),m=f.manager,entry=f.entries.get('alpha'),image=path.join(entry.profile.media.sourceDir,'01.png');const bytes=await fs.readFile(image);await fs.writeFile(image,'corrupt media');
 assert.equal((await m.prepare('alpha',req(m))).code,'PREPARE_FAILED');assert.equal(m.snapshot().candidate,null);assert.equal(await connects(f.port),false);await fs.writeFile(image,bytes);
 const p=await m.prepare('alpha',req(m));assert.equal(p.ok,true);const occupied=await server(f.port);try{assert.equal((await m.activate(req(m,{candidateId:p.candidateId}))).code,'START_FAILED');assert.equal(m.snapshot().candidate,null);assert.equal(m.snapshot().active,null);assert.equal(f.spawns,0);}finally{await closeServer(occupied);}
 const retry=await m.prepare('alpha',req(m));assert.equal(retry.ok,true);assert.equal((await m.activate(req(m,{candidateId:retry.candidateId}))).ok,true);assert.equal(await connects(f.port),true);assert.equal(f.spawns,0);
});
