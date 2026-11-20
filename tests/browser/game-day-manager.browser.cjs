'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {EventEmitter}=require('node:events');
const {chromium}=require('playwright');
const {PNG}=require('pngjs');
const {createGameDayManager}=require('../../scripts/lib/game-day-manager.cjs');
const {createPreparedEventRuntime}=require('../../scripts/lib/prepared-event-runtime.cjs');
const {stageSnapshot}=require('../../scripts/lib/media-snapshot.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){const end=Date.now()+15000;while(!await fn()){if(Date.now()>=end)throw Error(label);await wait(10);}}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
const req=(manager,extra={})=>{const s=manager.snapshot();return{expectedEventId:s.expectedEventId,expectedSelection:s.expectedSelection,...extra};};
let browser;
before(async()=>{browser=await chromium.launch({headless:true,...(process.env.PIRAIDERS_BROWSER_EXECUTABLE?{executablePath:process.env.PIRAIDERS_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox']});});
after(()=>browser?.close());
async function port(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value;}
async function pixels(page,rgb){const png=PNG.sync.read(await page.screenshot()),offset=(Math.floor(png.height/2)*png.width+Math.floor(png.width/2))*4;assert.ok(rgb.every((value,index)=>Math.abs(png.data[offset+index]-value)<=6),'REAL_CHROMIUM_PIXELS');}
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders manager browser '))),component=path.join(root,'component');await fs.mkdir(component);const executable=path.join(component,'casparcg.exe');await fs.writeFile(executable,'synthetic OS boundary; never executed');
 const initial=Date.now(),start=initial+3600000,entries=new Map(),sharedPort=await port(),state={now:initial,scheduled:new Map(),serial:0,children:[],factory:[],stage:{alpha:0,beta:0},betaEntered:false,oldEntered:false,holdOld:false,betaGate:deferred(),oldGate:deferred(),contexts:[],wires:[]};
 for(const id of ['alpha','beta']){const sourceDir=path.join(root,'media',id);await fs.mkdir(sourceDir,{recursive:true});const data=Buffer.alloc(16*9*4);for(let i=0;i<data.length;i+=4)data.set([240,20,20,255],i);await fs.writeFile(path.join(sourceDir,'01.png'),PNG.sync.write({width:16,height:9,data}));
  entries.set(id,Object.freeze({profile:{schemaVersion:1,provider:'local-manual',eventId:id,productionWindow:{start:new Date(start).toISOString(),end:new Date(start+3600000).toISOString()},
   spx:{executable:path.join(root,'unowned-spx.exe'),args:[],cwd:path.join(root,'unowned-spx')},caspar:{executable,cwd:component,runtimeDir:path.join(root,'runtime',id)},
   media:{provider:'local-lexical-v1',sourceDir,cacheDir:path.join(root,'cache',id),startup:{mode:'source'}},playback:{mode:'manual'},presentation:{port:0},
   rossTalk:{host:'127.0.0.1',port:sharedPort,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',5:'reload',8:'stop'},acknowledgements:true}},descriptor:Object.freeze({eventId:id,displayName:'Test '+id}),revision:(id==='alpha'?'a':'b').repeat(64)}));
 }
 function spawnProcess(command,args,options,privateInput){assert.equal(privateInput,true,'ONLY_OWNED_CASPAR');const child=new EventEmitter();child.pid=50000+state.children.length;child.closed=false;child.privateInput=privateInput;child.stdin={end:()=>child.kill()};
  child.finish=()=>{if(child.closed)return;child.closed=true;child.emit('exit',0);child.emit('close',0);};child.kill=()=>{setImmediate(child.finish);return true;};state.children.push(child);queueMicrotask(()=>child.emit('spawn'));return child;}
 function consoleFactory(child){const client=new EventEmitter();client.closed=false;client.request=async command=>{
  if(client.closed)throw Error('SYNTHETIC_CONSOLE_CLOSED');if(command==='VERSION')return{status:201};const match=/^PLAY 1-10 \[HTML\] "([^"\r\n]+)"$/.exec(command);assert.ok(match,'PRIVATE_PLAY');const origin=new URL(match[1]).origin;
  const context=await browser.newContext({viewport:{width:640,height:360}});state.contexts.push(context);await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());child.page=await context.newPage();await child.page.goto(match[1]);return{status:202};
 };client.close=()=>{if(client.closed)return;client.closed=true;child.stdin.end();client.emit('fault',{code:'CLOSED'});};return client;}
 const manager=createGameDayManager({sourceRoot:path.join(root,'media'),clock:()=>state.now,catalog:{list:async()=>Object.freeze([...entries.values()].map(value=>Object.freeze({...value.descriptor,status:'available'}))),read:async id=>entries.get(id)},
  runtimeFactory:(profile,options)=>{state.factory.push({id:profile.eventId,options});return createPreparedEventRuntime(profile,{...options,spawnProcess,consoleFactory,supervisorOptions:{platform:'linux'},
   schedule:(fn,ms)=>{const id=++state.serial;state.scheduled.set(id,{fn,ms,eventId:profile.eventId});return id;},cancel:id=>state.scheduled.delete(id),
   stage:async args=>{state.stage[profile.eventId]++;if(profile.eventId==='beta'){state.betaEntered=true;await state.betaGate.promise;}else if(state.holdOld&&state.stage.alpha>1){state.oldEntered=true;await state.oldGate.promise;}return stageSnapshot(args);}});}});
 t.after(async()=>{state.betaGate.resolve();state.oldGate.resolve();for(const socket of state.wires)socket.destroy();await manager.close();await until(()=>!manager.snapshot().preparing&&!manager.snapshot().physicalBarrier,'ALL_STAGE_SETTLED');for(const child of state.children)child.finish();await Promise.allSettled(state.contexts.map(context=>context.close()));await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 async function activateAlpha(){const p=await manager.prepare('alpha',req(manager));assert.equal(p.ok,true);assert.equal((await manager.activate(req(manager,{candidateId:p.candidateId}))).ok,true);}
 async function prewarm(){await until(()=>[...state.scheduled.values()].some(value=>value.eventId==='alpha'),'ALPHA_POLL_ARMED');state.now=start-15*60000;const [id,task]=[...state.scheduled].find(([,value])=>value.eventId==='alpha');state.scheduled.delete(id);task.fn();await until(()=>manager.snapshot().active.runtime.ready,'ALPHA_RENDERER_READY');return state.children.at(-1).page;}
 async function connect(){const socket=net.createConnection({host:'127.0.0.1',port:sharedPort}),lines=[];state.wires.push(socket);let pending='';socket.on('error',()=>{});socket.on('data',chunk=>{pending+=chunk;for(let at;(at=pending.indexOf('\r\n'))>=0;){lines.push(pending.slice(0,at));pending=pending.slice(at+2);}});await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});return{send:id=>socket.write('GPI '+id+'\r\n'),lines,async command(id,ok=true){const before=lines.length;socket.write('GPI '+id+'\r\n');await until(()=>lines.length>before,'DIRECT_TCP_RESULT');assert.ok(lines[before].startsWith(ok?'OK ':'ERR '));return lines[before];}};}
 return{manager,state,initial,activateAlpha,prewarm,connect};
}

test('pending initial factory excludes old direct TCP Reload when prewarm opens without blocking priority Stop',{timeout:45000},async t=>{
 const f=await fixture(t),m=f.manager;await f.activateAlpha();const pending=m.prepare('beta',req(m));await until(()=>f.state.betaEntered,'BETA_FACTORY_HELD');assert.equal(f.state.factory[0].options.canPrepare(),false);
 const page=await f.prewarm(),wire=await f.connect();await wire.command(1);await pixels(page,[240,20,20]);const count=f.state.stage.alpha;
 await wire.command(5,false);assert.equal(f.state.stage.alpha,count,'OLD_DECODER_NOT_ENTERED');assert.equal(m.snapshot().active.runtime.lastError,'BUSY');await pixels(page,[240,20,20]);
 // Diagnostics only (2026-11-20): this Stop answered not ok once on a hosted Windows run; name its answer and state if it does again.
 const stopped=await m.dispatch('stop',req(m));assert.equal(stopped.ok,true,'STOP_ANSWER '+JSON.stringify(stopped)+' RUNTIME '+JSON.stringify({state:m.snapshot().active?.runtime?.state,lastError:m.snapshot().active?.runtime?.lastError,preparing:m.snapshot().preparing}));await pixels(page,[0,0,0]);assert.equal(m.snapshot().preparing,true);
 f.state.betaGate.resolve();assert.equal((await pending).code,'WINDOW_ACTIVE');assert.equal(m.snapshot().candidate,null);assert.equal(f.state.children.length,1);assert.equal(f.state.factory[0].options.canPrepare(),true);
 await wire.command(1);await wire.command(5);assert.equal(f.state.stage.alpha,count+1);await pixels(page,[240,20,20]);
});

test('actual old TCP staging flight survives rewind/close as a retained manager barrier',{timeout:45000},async t=>{
 const f=await fixture(t),m=f.manager;await f.activateAlpha();const page=await f.prewarm(),wire=await f.connect();await wire.command(1);await pixels(page,[240,20,20]);f.state.holdOld=true;wire.send(5);await until(()=>f.state.oldEntered,'OLD_RELOAD_HELD');
 f.state.now=f.initial;assert.equal((await m.prepare('beta',req(m))).code,'BUSY');assert.equal(f.state.factory.length,1);const closing=m.close();assert.equal((await closing).ok,true);assert.equal(m.snapshot().physicalBarrier,true,'CLOSED_RUNTIME_KEEPS_ACTUAL_STAGE_REFERENCE');
 f.state.oldGate.resolve();await until(()=>!m.snapshot().physicalBarrier,'OLD_STAGE_SETTLED');assert.equal(m.snapshot().closed,true);assert.equal(f.state.factory.length,1);assert.equal(f.state.children.length,1);
});
