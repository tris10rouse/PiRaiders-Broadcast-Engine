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
  const mediaRoot=path.join(root,'media'),board=path.join(mediaRoot,'board'),source=path.join(board,'slides'),cache=path.join(root,'cache'),component=path.join(root,'component'),run=path.join(root,'runtime');await fs.mkdir(source,{recursive:true});await fs.mkdir(component);
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
  return{profile,state,options,root,mediaRoot,board,source,async create(extra={}){runtime=await createPreparedEventRuntime(profile,{...options,...extra});return runtime;}};
}
test('trusted source root rejects ancestor symlink escape before any staging or listener',async t=>{
 const f=await fixture(t),outside=path.join(f.root,'outside');await fs.mkdir(path.join(outside,'slides'),{recursive:true});
 await fs.rename(f.board,path.join(f.root,'original-board'));await fs.symlink(outside,f.board,process.platform==='win32'?'junction':'dir');let stages=0;
 await assert.rejects(f.create({sourceRoot:f.mediaRoot,stage:async()=>{stages++;throw Error('outside source must not be read');}}),e=>e.code==='PROFILE_PATHS');
 assert.equal(stages,0);assert.equal(f.state.sessions.length,0);assert.equal(f.state.spawned.length,0);
});
test('source root is rechecked at Reload after an ancestor switches outside the machine boundary',async t=>{
 const f=await fixture(t),runtime=await f.create({sourceRoot:f.mediaRoot});await runtime.start();await until(()=>runtime.snapshot().ready);const accepted=runtime.snapshot().deckId;
 const outside=path.join(f.root,'outside');await fs.mkdir(path.join(outside,'slides'),{recursive:true});await fs.rename(f.board,path.join(f.root,'original-board'));await fs.symlink(outside,f.board,process.platform==='win32'?'junction':'dir');
 await assert.rejects(f.state.sessions[0].raw.resolvePreparedSnapshot({signal:new AbortController().signal}),e=>e.code==='PROFILE_PATHS');
 assert.equal(runtime.snapshot().deckId,accepted);assert.equal(runtime.snapshot().preparing,false);assert.equal(runtime.snapshot().ready,true);
});
test('explicit cached startup never consults unavailable machine source root or source directory',async t=>{
 const f=await fixture(t),snapshot=await stageSnapshot({sourceDir:f.source,cacheDir:f.profile.media.cacheDir,quietMs:0});await fs.rm(f.mediaRoot,{recursive:true});f.profile.media.startup={mode:'cached',snapshotDir:snapshot.snapshotDir};
 const originals={stat:fs.stat,realpath:fs.realpath};let reads=0;
 for(const key of Object.keys(originals))fs[key]=async value=>{if(value===f.mediaRoot||value===f.source){reads++;throw Error('disconnected Drive');}return originals[key](value);};
 try{const runtime=await f.create({sourceRoot:f.mediaRoot});assert.equal(runtime.snapshot().deckId,snapshot.deck.id);await runtime.start();await until(()=>runtime.snapshot().ready);assert.equal(reads,0);}finally{Object.assign(fs,originals);}
});
test('invalid trusted source roots fail before filesystem access and cannot be supplied by profile data',async t=>{
 const f=await fixture(t),stat=fs.stat;let reads=0;fs.stat=async()=>{reads++;throw Error('must validate first');};
 try{for(const sourceRoot of [null,1,{},'relative/root','/bad\0root','/bad\nroot','/'+ 'x'.repeat(4096)])await assert.rejects(f.create({sourceRoot}),e=>e.code==='EVENT_OPTIONS_INVALID');}finally{fs.stat=stat;}
 assert.equal(reads,0);f.profile.sourceRoot=f.mediaRoot;await assert.rejects(f.create(),e=>e.code==='PROFILE_INVALID');assert.equal(f.state.sessions.length,0);assert.equal(f.state.spawned.length,0);
});

test('whole private root aliases are rejected even when the selected cache directory is a sibling',async t=>{
 const f=await fixture(t),alias=path.join(f.root,'storage-alias');await fs.symlink(f.root,alias,process.platform==='win32'?'junction':'dir');let stages=0;
 await assert.rejects(f.create({sourceRoot:f.mediaRoot,privateRoots:[alias],stage:async()=>{stages++;throw Error('must not stage');}}),e=>e.code==='PROFILE_PATHS');assert.equal(stages,0);assert.equal(f.state.spawned.length,0);
});
test('trusted preparation admission fails closed and releases only actual settled Reload flight',async t=>{
 const f=await fixture(t);let allowed=false,stages=0;
 const runtime=await f.create({sourceRoot:f.mediaRoot,canPrepare:()=>allowed,stage:async options=>{stages++;return stageSnapshot({...options,quietMs:0});}});await runtime.start();await until(()=>runtime.snapshot().ready);
 const reload=()=>f.state.sessions[0].raw.resolvePreparedSnapshot({signal:new AbortController().signal});
 await assert.rejects(reload(),e=>e.code==='BUSY');assert.equal(stages,1);assert.equal(runtime.snapshot().preparing,false);
 allowed=true;const pending=reload();assert.equal(runtime.snapshot().preparing,true);await pending;assert.equal(stages,2);assert.equal(runtime.snapshot().preparing,false);
});
test('throwing and asynchronous preparation guards never admit a decoder or leak a rejection',async t=>{
 const f=await fixture(t);
 for(const canPrepare of [()=>{throw Error('private path');},()=>Promise.reject(Error('private path'))]){
  const runtime=await f.create({canPrepare});await runtime.start();await until(()=>runtime.snapshot().ready);
  await assert.rejects(f.state.sessions.at(-1).raw.resolvePreparedSnapshot({signal:new AbortController().signal}),e=>e.code==='BUSY');assert.equal(runtime.snapshot().preparing,false);await runtime.close();
 }
 const stat=fs.stat;let reads=0;fs.stat=async()=>{reads++;throw Error('must validate first');};
 try{for(const options of [{canPrepare:null},{canPrepare:true},{privateRoots:null},{sourceRoot:f.mediaRoot,privateRoots:Array(1)},{sourceRoot:f.mediaRoot,privateRoots:Object.defineProperty([],0,{get(){throw Error('must not invoke accessor');}})},{privateRoots:['relative']},{privateRoots:[f.root]},{sourceRoot:f.mediaRoot,privateRoots:[f.root,f.root,f.root,f.root]}])await assert.rejects(f.create(options),e=>e.code==='EVENT_OPTIONS_INVALID');}finally{fs.stat=stat;}
 assert.equal(reads,0);
});
