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
const jpeg=require('jpeg-js');
const appRoot=path.resolve(__dirname,'..','..');
const {createPreparedEventRuntime}=require(path.join(appRoot,'scripts/lib/prepared-event-runtime.cjs'));
const {stageSnapshot}=require(path.join(appRoot,'scripts/lib/media-snapshot.cjs'));
let browser;
before(async()=>{
  const executablePath=process.env.PIRAIDERS_BROWSER_EXECUTABLE;
  if(executablePath)assert.ok(path.isAbsolute(executablePath),'BROWSER_EXECUTABLE_ABSOLUTE');
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});
});
after(()=>browser?.close());
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label,ms=10000){const end=Date.now()+ms;while(Date.now()<end){if(await predicate())return;await wait(10);}throw Error(label);}
async function port(){const server=net.createServer();await new Promise((r,j)=>server.listen(0,'127.0.0.1',r).once('error',j));const value=server.address().port;await new Promise(r=>server.close(r));return value;}
function image(rgb){const data=Buffer.alloc(160*90*4);for(let i=0;i<data.length;i+=4)data.set([...rgb,255],i);return{width:160,height:90,data};}
async function pixels(page,expected){
  const png=PNG.sync.read(await page.screenshot()),i=(Math.floor(png.height/2)*png.width+Math.floor(png.width/2))*4;
  assert.ok(expected.every((value,index)=>Math.abs(png.data[i+index]-value)<=8),'ACTUAL_RENDERER_PIXELS');
  if(expected.every(value=>value===0))for(let offset=0;offset<png.data.length;offset+=4){
    assert.ok(png.data[offset]<=8&&png.data[offset+1]<=8&&png.data[offset+2]<=8&&png.data[offset+3]>=250,'FULL_FRAME_OPAQUE_BLACK');
  }
}
async function fixture(t,{gateStage=false,intervalMs=600,mode='manual'}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders prepared browser '));
  const sourceDir=path.join(root,'source'),cacheDir=path.join(root,'cache'),runtimeDir=path.join(root,'runtime'),casparDir=path.join(root,'component'),spxDir=path.join(root,'spx');
  for(const directory of [sourceDir,casparDir,spxDir])await fs.mkdir(directory);
  const casparExe=path.join(casparDir,'casparcg.exe');await fs.writeFile(casparExe,'synthetic OS boundary; never executed');
  async function writeDeck(second=[20,20,240]){await fs.writeFile(path.join(sourceDir,'01.png'),PNG.sync.write(image([240,20,20])));await fs.writeFile(path.join(sourceDir,'02.jpg'),jpeg.encode(image(second),95).data);}
  await writeDeck();
  const initialNow=Date.now(),start=initialNow+16*60000,end=start+3600000;
  const state={now:initialNow,children:[],clients:[],pages:[],urls:[],kills:[],closing:[],timers:new Set(),scheduled:new Map(),serial:0,killDelay:0,stageCalls:0,blockNext:false,blocked:false,blockedSignal:null,release:null};
  const wires=[];let runtime;
  function later(callback,ms=0){const timer=setTimeout(()=>{state.timers.delete(timer);callback();},ms);state.timers.add(timer);return timer;}
  function spawnProcess(_exe,_args,_options,privateInput){
    const child=new EventEmitter();child.pid=50000+state.children.length;child.exitCode=null;child.signalCode=null;child.privateInput=privateInput;child.exitObserved=false;
    child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();
    child.finish=(code=0,signal=null)=>{if(child.exitObserved)return;child.exitObserved=true;child.exitCode=code;child.signalCode=signal;child.emit('exit',code,signal);child.emit('close',code,signal);if(child.context)state.closing.push(child.context.close().catch(()=>{}));};
    child.stdin.end=()=>{later(()=>child.finish(0),state.killDelay);};
    child.kill=()=>{later(()=>child.finish(null,'SIGTERM'),state.killDelay);return true;};
    state.children.push(child);queueMicrotask(()=>child.emit('spawn'));return child;
  }
  function consoleFactory(child){
    assert.equal(child.privateInput,true,'CONSOLE_PRIVATE_CHILD');
    const client=new EventEmitter();client.closed=false;
    client.request=async command=>{
      if(client.closed)throw Error('SYNTHETIC_CONSOLE_CLOSED');
      if(command==='VERSION')return{status:201};
      const match=/^PLAY 1-10 \[HTML\] "([^"\r\n]+)"$/.exec(command);
      if(!match)throw Error('SYNTHETIC_CONSOLE_COMMAND');
      const url=match[1],origin=new URL(url).origin;
      assert.ok(url.includes('#piraiders='),'PRIVATE_PROGRAM_CAPABILITY');
      const context=await browser.newContext({viewport:{width:960,height:540}});child.context=context;
      await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
      const page=await context.newPage();child.page=page;state.pages.push(page);state.urls.push(url);
      try{await page.goto(url);}catch{throw Error('SYNTHETIC_CEF_OPEN_FAILED');}
      return{status:202};
    };
    client.close=()=>{if(client.closed)return;client.closed=true;child.stdin.end();client.emit('fault',{code:'CONSOLE_CLOSED'});};
    child.client=client;state.clients.push(client);return client;
  }
  const rossTalkPort=await port();
  const profile={schemaVersion:1,provider:'local-manual',eventId:'local-browser-fixture',productionWindow:{start:new Date(start).toISOString(),end:new Date(end).toISOString()},
    spx:{executable:process.execPath,args:[],cwd:spxDir},caspar:{executable:casparExe,cwd:casparDir,runtimeDir},
    media:{provider:'local-lexical-v1',sourceDir,cacheDir,startup:{mode:'source'}},
    playback:{mode,intervalMs,transition:{type:'cut',durationMs:0}},presentation:{port:0},
    rossTalk:{host:'127.0.0.1',port:rossTalkPort,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',2:'next',3:'previous',4:'toggle-auto',5:'reload',8:'stop'},acknowledgements:true}};
  const options={spawnProcess,consoleFactory,clock:()=>state.now,
    schedule:(fn,ms)=>{const id=++state.serial;state.scheduled.set(id,{fn,ms});return id;},cancel:id=>state.scheduled.delete(id),
    supervisorOptions:{platform:'win32',maxRestarts:2,restartDelayMs:50,execFileProcess:(_file,args,_options,callback)=>{
      const child=state.children.find(value=>value.pid===Number(args[1]));assert.ok(child,'TEST_OWNED_PID_ONLY');
      state.kills.push({pid:child.pid});later(()=>{child.finish(null,'SIGTERM');callback(null);},state.killDelay);
    }}};
  if(gateStage)options.stage=async args=>{
    state.stageCalls++;const candidate=await stageSnapshot(args);
    if(state.blockNext){state.blockNext=false;state.blocked=true;state.blockedSignal=args.signal;await new Promise(resolve=>{state.release=resolve;});}
    return candidate;
  };
  t.after(async()=>{
    state.release?.();state.killDelay=0;for(const socket of wires)socket.destroy();
    try{await runtime?.close();}finally{
      for(const child of state.children)child.finish(0);
      await Promise.allSettled(state.closing);
      for(const timer of state.timers)clearTimeout(timer);
      await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    }
  });
  runtime=await createPreparedEventRuntime(profile,options);
  async function tick(at){await until(()=>state.scheduled.size>0,'LAUNCHER_POLL_ARMED');state.now=at;const task=[...state.scheduled.entries()].at(-1);state.scheduled.delete(task[0]);task[1].fn();await wait(0);}
  async function connect(){
    const socket=net.createConnection({host:'127.0.0.1',port:rossTalkPort});wires.push(socket);let carry='';const lines=[];socket.on('error',()=>{});
    socket.on('data',chunk=>{carry+=chunk.toString();for(let end;(end=carry.indexOf('\r\n'))>=0;){lines.push(carry.slice(0,end));carry=carry.slice(end+2);}});
    await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
    return{socket,lines,send(id){socket.write('GPI '+id+'\r\n');},async command(id,ok=true){const before=lines.length;socket.write('GPI '+id+'\r\n');await until(()=>lines.length>before,'ROSS_TALK_REPLY');assert.ok(lines[before].startsWith(ok?'OK ':'ERR '),'ROSS_TALK_OUTCOME');return lines[before];}};
  }
  const caspar=()=>state.children.filter(child=>child.privateInput).at(-1);
  const currentPage=()=>caspar()?.page;
  async function ready(){await until(()=>runtime.snapshot().ready,'PREPARED_EVENT_READY',20000);return currentPage();}
  return{runtime,state,sourceDir,cacheDir,start,end,writeDeck,tick,connect,caspar,currentPage,ready};
}

test('prepared runtime joins actual TCP/native browser playback, cache Reload, restart and window fences (OS simulated)',{timeout:120000},async t=>{
  const f=await fixture(t);await f.runtime.start();
  assert.equal(f.state.children.filter(child=>child.privateInput).length,0,'NO_PREWARM_SENDER');
  assert.equal(f.runtime.snapshot().ready,false);let wire=await f.connect();await wire.command(1,false);
  await f.tick(f.start-15*60000);let page=await f.ready();
  await pixels(page,[0,0,0]);assert.equal(f.runtime.snapshot().index,null,'EXPLICIT_LAUNCH_REQUIRED');
  await wire.command(1);await pixels(page,[240,20,20]);assert.equal(f.runtime.snapshot().index,0);
  await wire.command(3);await pixels(page,[20,20,240]);assert.equal(f.runtime.snapshot().index,1,'PREVIOUS_WRAPS');
  await wire.command(2);await pixels(page,[240,20,20]);assert.equal(f.runtime.snapshot().index,0,'NEXT_WRAPS');
  await wire.command(4);assert.equal(f.runtime.snapshot().mode,'auto');
  await until(()=>f.runtime.snapshot().index===1,'ACTUAL_AUTO_ADVANCE');await pixels(page,[20,20,240]);
  await wait(300);await wire.command(3);await pixels(page,[240,20,20]);
  await wait(350);assert.equal(f.runtime.snapshot().index,0,'MANUAL_NAV_RESETS_AUTO_DEADLINE');
  await until(()=>f.runtime.snapshot().index===1,'RESET_AUTO_ADVANCE');
  await wire.command(4);assert.equal(f.runtime.snapshot().mode,'manual');await wait(650);assert.equal(f.runtime.snapshot().index,1,'MANUAL_MODE_HOLDS');
  const firstDeck=f.runtime.snapshot().deckId;await f.writeDeck([20,220,20]);await wire.command(5);
  const accepted=f.runtime.snapshot().deckId;assert.notEqual(accepted,firstDeck);await pixels(page,[20,220,20]);
  await fs.writeFile(path.join(f.sourceDir,'01.png'),'corrupt candidate');await wire.command(5,false);
  assert.equal(f.runtime.snapshot().deckId,accepted,'FAILED_RELOAD_LAST_GOOD');await pixels(page,[20,220,20]);
  await wire.command(8);await pixels(page,[0,0,0]);assert.equal(f.caspar().exitObserved,false,'STOP_KEEPS_SENDER');
  await fs.rm(f.sourceDir,{recursive:true});
  const old=f.caspar(),firstURL=f.state.urls[0];old.finish(17);await until(()=>f.caspar()!==old,'OWNED_RESTART');page=await f.ready();wire=await f.connect();
  assert.ok(f.state.urls.at(-1)!==firstURL,'NEW_PRIVATE_PROGRAM_URL');
  assert.equal(f.runtime.snapshot().deckId,accepted,'RESTART_RETAINS_ACCEPTED_CACHE_WITHOUT_SOURCE');
  assert.equal(f.runtime.snapshot().index,null,'FRESH_EPOCH_STOPPED');await pixels(page,[0,0,0]);
  await wire.command(1);await pixels(page,[240,20,20]);await wire.command(2);await pixels(page,[20,220,20]);
  for(const url of f.state.urls)assert.equal(JSON.stringify(f.runtime.snapshot()).includes(new URL(url).hash.slice('#piraiders='.length)),false,'SNAPSHOT_NO_CAPABILITY');
  await wire.command(4);assert.equal(f.runtime.snapshot().mode,'auto');const ending=f.caspar();f.state.killDelay=1000;
  await f.tick(f.end);await until(()=>!f.runtime.snapshot().ready&&f.state.kills.some(value=>value.pid===ending.pid),'IMMEDIATE_WINDOW_FENCE',300);
  await page.waitForFunction(()=>window.piraidersRenderer.snapshot().state==='black',null,{timeout:500});await pixels(page,[0,0,0]);
  assert.equal(ending.exitObserved,false,'EPOCH_CLOSED_BEFORE_NATIVE_TERMINATION_COMPLETES');
  await until(()=>ending.exitObserved,'DELAYED_NATIVE_STOP');
  const count=f.state.children.length;await wait(700);assert.equal(f.state.children.length,count,'NO_OFF_WINDOW_RESTART');
  assert.equal(f.runtime.snapshot().ready,false);f.state.killDelay=0;
});

test('retired ignored staging completion cannot resurrect and retains global preparation barrier across fresh browser epoch',{timeout:120000},async t=>{
  // The stage itself is real filesystem capture/decode. A deliberately ignored
  // post-stage cancellation gate injects an adversarial callback settlement delay.
  const f=await fixture(t,{gateStage:true});await f.runtime.start();await f.tick(f.start-15*60000);let page=await f.ready();let wire=await f.connect();
  await wire.command(1);await pixels(page,[240,20,20]);await f.writeDeck([20,220,20]);
  const accepted=f.runtime.snapshot().deckId;f.state.blockNext=true;wire.send(5);await until(()=>f.state.blocked,'REAL_STAGE_POST_CAPTURE_GATE');
  assert.equal(f.state.stageCalls,2);await f.tick(f.end);await until(()=>!f.runtime.snapshot().ready,'RETIRED_GATE');
  assert.equal(f.state.blockedSignal.aborted,true);assert.equal(f.runtime.snapshot().preparing,true,'ACTUAL_FLIGHT_STILL_OWNED');
  await f.tick(f.start);page=await f.ready();wire=await f.connect();await pixels(page,[0,0,0]);
  assert.equal(f.runtime.snapshot().index,null);await wire.command(1);await pixels(page,[240,20,20]);
  await wire.command(5,false);assert.equal(f.state.stageCalls,2,'NO_NEW_PREPARATION_AROUND_IGNORED_CALLBACK');
  f.state.release();await until(()=>!f.runtime.snapshot().preparing,'OLD_CALLBACK_SETTLED');
  assert.equal(f.runtime.snapshot().deckId,accepted,'OLD_CANDIDATE_NOT_PROMOTED');await pixels(page,[240,20,20]);
  await wire.command(2);await pixels(page,[20,20,240]);
  await wire.command(5);assert.equal(f.state.stageCalls,3);assert.notEqual(f.runtime.snapshot().deckId,accepted);await pixels(page,[20,220,20]);
});
