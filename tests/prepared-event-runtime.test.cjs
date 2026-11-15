'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {PNG}=require('pngjs');
const {createPreparedEventRuntime}=require('../scripts/lib/prepared-event-runtime.cjs');
const {stageSnapshot}=require('../scripts/lib/media-snapshot.cjs');
const {preparedCasparConfig}=require('../scripts/lib/prepared-caspar-config.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<500;n++){if(fn())return;await wait(10);}throw Error('test timeout');}
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders prepared event '));let runtime;
  t.after(async()=>{await runtime?.close();await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  const source=path.join(root,'source'),cache=path.join(root,'cache'),component=path.join(root,'component'),run=path.join(root,'runtime');await fs.mkdir(source);await fs.mkdir(component);
  const exe=path.join(component,'casparcg.exe');await fs.writeFile(exe,'synthetic OS boundary only');
  const pixels=Buffer.alloc(16*9*4,255);await fs.writeFile(path.join(source,'01.png'),PNG.sync.write({width:16,height:9,data:pixels}));
  const profile={schemaVersion:1,provider:'local-manual',eventId:'test-event',productionWindow:{start:new Date(Date.now()-1000).toISOString(),end:new Date(Date.now()+3600000).toISOString(),prewarmMinutes:0},spx:{executable:process.execPath,args:[],cwd:root},caspar:{executable:exe,cwd:component,runtimeDir:run},media:{provider:'local-lexical-v1',sourceDir:source,cacheDir:cache,startup:{mode:'source'}},rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}}};
  const state={spawned:[],sessions:[],closed:0,played:[],clients:[]};
  const options={supervisorOptions:{platform:'linux',maxRestarts:0},spawnProcess:(command,args,opts,privateInput)=>{
    const child=new EventEmitter();child.pid=100+state.spawned.length;child.stdin={end(){setImmediate(()=>child.emit('exit',1));}};child.kill=()=>{setImmediate(()=>child.emit('exit',0));};state.spawned.push({child,command,args,opts,privateInput});setImmediate(()=>child.emit('spawn'));return child;
  },consoleFactory:child=>{const client=new EventEmitter();client.close=()=>child.stdin.end();client.request=async value=>{state.played.push(value);return{status:value==='VERSION'?201:202};};state.clients.push(client);return client;},sessionFactory:async raw=>{
    const item={raw,closed:false,started:false};state.sessions.push(item);
    const api={start:async()=>{item.started=true;},close:async()=>{if(!item.closed){state.closed++;item.closed=true;}},getProgramURL:()=> 'http://127.0.0.1/synthetic#private='+state.sessions.length,snapshot:()=>({presentation:{controller:{deckId:path.basename(raw.presentation.snapshotDir),mode:raw.presentation.controllerOptions.mode,index:null},renderer:{ready:!item.closed}}})};item.api=api;return api;
  }};
  return{profile,state,options,root,async create(extra={}){runtime=await createPreparedEventRuntime(profile,{...options,...extra});return runtime;}};
}
test('invalid profiles or initial media failures bind/spawn nothing and use fixed errors',async t=>{
  const f=await fixture(t);f.profile.provider='sheet';await assert.rejects(f.create(),e=>e.code==='PROFILE_INVALID');f.profile.provider='local-manual';await fs.writeFile(path.join(f.profile.media.sourceDir,'01.png'),'bad bytes');await assert.rejects(f.create(),e=>e.code==='EVENT_PREPARE_FAILED');assert.equal(f.state.spawned.length,0);assert.equal(f.state.sessions.length,0);
});
test('explicit cached startup works after source deletion and never consults the source',async t=>{
  const f=await fixture(t),snapshot=await stageSnapshot({sourceDir:f.profile.media.sourceDir,cacheDir:f.profile.media.cacheDir,quietMs:0});await fs.rm(f.profile.media.sourceDir,{recursive:true});f.profile.media.startup={mode:'cached',snapshotDir:snapshot.snapshotDir};const realpath=fs.realpath;let sourceReads=0;fs.realpath=async value=>{if(value===f.profile.media.sourceDir){sourceReads++;throw Error('disconnected Drive provider');}return realpath(value);};let runtime;try{runtime=await f.create({stage:()=>{throw Error('must not read unavailable source');}});}finally{fs.realpath=realpath;}assert.equal(sourceReads,0);assert.equal(runtime.snapshot().deckId,snapshot.deck.id);assert.equal(f.state.spawned.length,0);await runtime.start();await until(()=>runtime.snapshot().ready);assert.ok(f.state.sessions[0].raw.canControl(),'initial session belongs to the actual first generation');assert.equal(f.state.spawned.length,2);assert.equal(f.state.spawned[1].privateInput,true);assert.equal(f.state.spawned[0].privateInput,false);assert.ok(f.state.played.some(v=>v.startsWith('PLAY ')));assert.ok(!JSON.stringify(runtime.snapshot()).includes(f.root));
});
test('listener startup failure closes its owned session before any service spawn',async t=>{
  const f=await fixture(t);let closed=0;const runtime=await f.create({sessionFactory:async()=>({start:async()=>{throw Error('foreign listener');},close:async()=>{closed++;}})});await assert.rejects(runtime.start(),e=>e.code==='EVENT_START_FAILED');assert.equal(closed,1);assert.equal(f.state.spawned.length,0);
});
test('close during delayed session construction waits cleanup but starts no service',async t=>{
  const f=await fixture(t);let release,entered=false,closed=0;const pending=new Promise(r=>release=r);const runtime=await f.create({sessionFactory:async()=>{entered=true;await pending;return{start:async()=>{throw Error('must not bind after close');},close:async()=>{closed++;}};}});const starting=runtime.start();const rejected=assert.rejects(starting,/EVENT_START_FAILED/);await until(()=>entered);let done=false;const closing=runtime.close().then(()=>done=true);await wait(30);assert.equal(done,false);release();await closing;await rejected;assert.equal(closed,1);assert.equal(f.state.spawned.length,0);
});
test('console fault immediately revokes current session/control before native exit arrives',async t=>{
  const f=await fixture(t),runtime=await f.create();await runtime.start();await until(()=>runtime.snapshot().ready);f.state.clients[0].emit('fault',{code:'CONSOLE_OUTPUT'});assert.equal(runtime.snapshot().ready,false);assert.equal(f.state.sessions[0].closed,true);assert.equal(f.state.sessions[0].raw.canControl(),false);
});
test('generated config escapes printable identity and never enables a TCP controller',()=>{
  const cfg=preparedCasparConfig({output:{type:'ndi',name:'PiRaiders "&<>'}},path.resolve(os.tmpdir(),'private & config'));assert.match(cfg,/<controllers\/>/);assert.doesNotMatch(cfg,/<tcp>/);assert.match(cfg,/PiRaiders &quot;&amp;&lt;&gt;/);assert.match(cfg,/<log-path disabled="true">/);assert.match(cfg,/<cache-path\/>/);assert.throws(()=>preparedCasparConfig({output:{type:'ndi',name:'bad\nname'}},path.resolve(os.tmpdir())),/CONFIG_OUTPUT/);
});

test('canonical cached preflight rejects a valid snapshot outside the declared cache before loading or binding',async t=>{
  const f=await fixture(t);await stageSnapshot({sourceDir:f.profile.media.sourceDir,cacheDir:f.profile.media.cacheDir,quietMs:0});
  const external=await stageSnapshot({sourceDir:f.profile.media.sourceDir,cacheDir:path.join(f.root,'other-cache'),quietMs:0});
  f.profile.media.startup={mode:'cached',snapshotDir:external.snapshotDir};let loads=0;
  await assert.rejects(f.create({load:async()=>{loads++;throw Error('must not read external snapshot');}}),error=>error.code==='PROFILE_PATHS');assert.equal(loads,0);assert.equal(f.state.sessions.length,0);assert.equal(f.state.spawned.length,0);
});
