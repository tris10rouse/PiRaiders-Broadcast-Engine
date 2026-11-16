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


test('native expiry synchronously fences the prepared event and cannot restart after clock rollback',async t=>{
  const f=await fixture(t);let now=Date.now();const runtime=await f.create({manageSpx:false,clock:()=>now,supervisorOptions:{platform:'linux',maxRestarts:3,restartDelayMs:10}});
  await runtime.start();await until(()=>runtime.snapshot().ready);assert.equal(f.state.spawned.length,1);
  const current=f.state.spawned[0],old=f.state.sessions[0];current.child.emit('exit',251,null);
  assert.equal(runtime.snapshot().ready,false);assert.equal(runtime.snapshot().windowAllowed,false);assert.equal(old.raw.canControl(),false);assert.equal(old.closed,true);
  assert.equal(runtime.snapshot().lastError,'PRODUCTION_WINDOW_EXPIRED');assert.equal(runtime.snapshot().state,'expired');
  now=Date.parse(f.profile.productionWindow.start)+500;assert.ok(now<Date.parse(f.profile.productionWindow.end),'rolled-back wall clock still appears within the configured interval');
  await wait(80);assert.equal(f.state.spawned.length,1);assert.equal(runtime.snapshot().windowAllowed,false);assert.equal(runtime.snapshot().lastError,'PRODUCTION_WINDOW_EXPIRED');
  assert.deepEqual(await runtime.dispatch('launch'),{ok:false,code:'CONTROL_INHIBITED'});await runtime.start();await wait(30);assert.equal(f.state.spawned.length,1);
});


test('delayed native expiry cannot overwrite closing or closed lifecycle',async t=>{
 for(const phase of ['closing','closed']){
  const f=await fixture(t),runtime=await f.create({manageSpx:false});
  await runtime.start();await until(()=>runtime.snapshot().ready);
  const child=f.state.spawned[0].child;
  // Confirmed stop may precede the JS exit callback; hold that callback here.
  child.kill=()=>true;
  const closing=runtime.close();
  if(phase==='closed')await closing;
  assert.equal(runtime.snapshot().state,phase);
  child.emit('exit',251,null);
  assert.equal(runtime.snapshot().state,phase);
  assert.notEqual(runtime.snapshot().lastError,'PRODUCTION_WINDOW_EXPIRED');
  await closing;assert.equal(runtime.snapshot().state,'closed');
 }
});


test('explicit renderer affects the private Caspar spawn while SPX retains inherited environment',async t=>{
 const f=await fixture(t);f.profile.caspar.rendererProfile='mesa-llvmpipe-compat';await fs.writeFile(path.join(path.dirname(f.profile.caspar.executable),'opengl32.dll'),'synthetic DLL boundary only');
 const keys=['GALLIUM_DRIVER','LIBGL_ALWAYS_SOFTWARE','MESA_GL_VERSION_OVERRIDE','gallium_driver','LiBgL_AlWaYs_SoFtWaRe','mesa_gl_version_override'];const original=new Map(keys.map(key=>[key,process.env[key]]));
 const names=new Set(keys.map(key=>key.toLowerCase())),selected=env=>Object.fromEntries(Object.entries(env).filter(([key])=>names.has(key.toLowerCase())));
 for(const key of keys)process.env[key]='inherited-SPX-value';const inherited=selected(process.env);let runtime;
 try{runtime=await f.create();await runtime.start();await until(()=>runtime.snapshot().ready);
  const spx=f.state.spawned.find(value=>!value.privateInput),caspar=f.state.spawned.find(value=>value.privateInput);
  assert.deepEqual(selected(spx.opts.env),inherited);
  assert.equal(caspar.opts.env.GALLIUM_DRIVER,'llvmpipe');assert.equal(caspar.opts.env.LIBGL_ALWAYS_SOFTWARE,'1');assert.equal(caspar.opts.env.MESA_GL_VERSION_OVERRIDE,'4.5COMPAT');
  for(const key of keys)assert.equal(process.env[key],'inherited-SPX-value');
 }finally{await runtime?.close();for(const [key,value]of original){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('missing explicit renderer fails before media staging, listener creation or spawning',async t=>{
 const f=await fixture(t);f.profile.caspar.rendererProfile='mesa-llvmpipe-compat';let stages=0;
 await assert.rejects(f.create({stage:async()=>{stages++;throw Error('must not stage');}}),error=>error.code==='MESA_RUNTIME_MISSING'&&error.message==='MESA_RUNTIME_MISSING');
 assert.equal(stages,0);assert.equal(f.state.sessions.length,0);assert.equal(f.state.spawned.length,0);
 await assert.rejects(fs.stat(f.profile.caspar.runtimeDir),error=>error.code==='ENOENT');
 await fs.writeFile(path.join(path.dirname(f.profile.caspar.executable),'opengl32.dll'),'synthetic DLL boundary only');
 const recovered=await f.create();assert.equal(recovered.snapshot().state,'prepared');assert.equal(f.state.spawned.length,0);assert.equal(f.state.sessions.length,0);
});


test('managed relative config is ASCII and directory-independent while other config callers retain absolute paths',()=>{
 const profile={output:{type:'ndi',name:'PiRaiders "&<>'}},ascii=path.resolve(os.tmpdir(),'owned-ascii'),unicode=path.resolve(os.tmpdir(),'owned-鷹 ! & runtime');
 const managed=preparedCasparConfig(profile,unicode,{relativePaths:true});
 assert.equal(managed,preparedCasparConfig(profile,ascii,{relativePaths:true}));assert.equal(/[^\x00-\x7f]/.test(managed),false);assert.equal(managed.includes(unicode),false);
 for(const folder of ['media','log','data','template'])assert.ok(managed.includes('>'+folder+'/</'),'only fixed relative paths enter managed XML');
 assert.match(managed,/<controllers\/>/);assert.match(managed,/<log-path disabled="true">/);assert.match(managed,/<cache-path\/>/);assert.match(managed,/PiRaiders &quot;&amp;&lt;&gt;/);
 const absolute=preparedCasparConfig(profile,unicode);assert.ok(absolute.includes('owned-鷹 ! &amp; runtime'));assert.notEqual(absolute,managed);assert.equal(preparedCasparConfig(profile,unicode,{}),absolute);
 for(const options of [null,[],{relativePaths:'true'},{relativePaths:true,cwd:'foreign'},{relativePaths:true,argv:['foreign']}])assert.throws(()=>preparedCasparConfig(profile,unicode,options),/CONFIG_PATH_POLICY/);
 assert.throws(()=>preparedCasparConfig(profile,'relative',{relativePaths:true}),/CONFIG_DIRECTORY/);
});

test('managed Caspar launches its ASCII config in the newly owned Unicode directory without changing SPX, exe or NDI environment',async t=>{
 const f=await fixture(t);f.profile.caspar.runtimeDir=path.join(f.root,'owned runtime 鷹 ! &');
 // A foreign configuration in the configured component cwd must not be read or
 // overwritten; only the newly created private runtime directory is admitted.
 const foreign=path.join(f.profile.caspar.cwd,'caspar.config');await fs.writeFile(foreign,'foreign component config must remain unchanged');
 f.profile.caspar.rendererProfile='mesa-llvmpipe-compat';await fs.writeFile(path.join(path.dirname(f.profile.caspar.executable),'opengl32.dll'),'synthetic DLL boundary only');
 const ndiDirectory=path.join(f.root,'ndi-runtime');await fs.mkdir(ndiDirectory);await fs.writeFile(path.join(ndiDirectory,'Processing.NDI.Lib.x64.dll'),'synthetic SDK boundary only');f.profile.output={type:'ndi',name:'PiRaiders test',runtimeDirectory:ndiDirectory};
 const runtime=await f.create();await runtime.start();await until(()=>runtime.snapshot().ready);
 const caspar=f.state.spawned.find(value=>value.privateInput),spx=f.state.spawned.find(value=>!value.privateInput);
 assert.equal(caspar.command,f.profile.caspar.executable);assert.deepEqual(caspar.args,['caspar.config','--log-severity=disable','--disable-logging']);assert.equal(caspar.privateInput,true);
 assert.equal(path.dirname(caspar.opts.cwd),f.profile.caspar.runtimeDir);assert.match(path.basename(caspar.opts.cwd),/^event-/);assert.notEqual(caspar.opts.cwd,f.profile.caspar.cwd);
 assert.equal(caspar.opts.env.NDI_RUNTIME_DIR_V6,ndiDirectory);assert.equal(caspar.opts.env.GALLIUM_DRIVER,'llvmpipe');assert.equal(caspar.opts.env.MESA_GL_VERSION_OVERRIDE,'4.5COMPAT');assert.equal(caspar.opts.env.LIBGL_ALWAYS_SOFTWARE,'1');
 assert.equal(spx.command,f.profile.spx.executable);assert.deepEqual(spx.args,f.profile.spx.args);assert.equal(spx.opts.cwd,f.profile.spx.cwd);assert.equal(spx.privateInput,false);
 const config=await fs.readFile(path.join(caspar.opts.cwd,caspar.args[0]),'utf8');assert.equal(/[^\x00-\x7f]/.test(config),false);assert.equal(config.includes(f.root),false);assert.equal(await fs.readFile(foreign,'utf8'),'foreign component config must remain unchanged');
 for(const name of ['media','log','data','template'])assert.equal((await fs.stat(path.join(caspar.opts.cwd,name))).isDirectory(),true);
 // The same expiry fence still retires this managed generation immediately;
 // no cwd/argv change may rearm it after the native boundary reports expiry.
 const before=f.state.spawned.length;caspar.child.emit('exit',251,null);assert.equal(runtime.snapshot().windowAllowed,false);assert.equal(runtime.snapshot().ready,false);assert.equal(runtime.snapshot().state,'expired');await runtime.start();await wait(50);assert.equal(f.state.spawned.length,before);
});
