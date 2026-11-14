'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {chromium}=require('playwright');
const {PNG}=require('pngjs');
const {stageSnapshot}=require('../../scripts/lib/media-snapshot.cjs');
const {createRossTalkSession}=require('../../scripts/lib/rosstalk-session.cjs');
let browser;
before(async()=>{const executablePath=process.env.PIRAIDERS_BROWSER_EXECUTABLE;if(executablePath)assert.ok(path.isAbsolute(executablePath));browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});});
after(()=>browser?.close());
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label,ms=5000){const end=Date.now()+ms;while(Date.now()<end){if(await predicate())return;await wait(10);}throw Error('Deadline: '+label);}
async function color(page,expected){const png=PNG.sync.read(await page.screenshot()),i=(Math.floor(png.height/2)*png.width+Math.floor(png.width/2))*4;const rgb=[...png.data.subarray(i,i+3)];assert.ok(rgb.every((v,n)=>Math.abs(v-expected[n])<=6),`${rgb} near ${expected}`);}
function image(rgb){const data=Buffer.alloc(160*90*4);for(let i=0;i<data.length;i+=4)data.set([...rgb,255],i);return PNG.sync.write({width:160,height:90,data});}
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders managed TCP '));let session,context;const wires=[];
  t.after(async()=>{for(const socket of wires)socket.destroy();await session?.close();await context?.close();await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  async function prepare(name,files){const sourceDir=path.join(root,name);await fs.mkdir(sourceDir);for(const[file,rgb]of files)await fs.writeFile(path.join(sourceDir,file),image(rgb));const snapshot=await stageSnapshot({sourceDir,cacheDir:path.join(root,'cache'),quietMs:0});await fs.rm(sourceDir,{recursive:true});return snapshot;}
  const initial=await prepare('initial',[['01.png',[240,20,20]],['02.png',[20,20,240]]]);
  let allowed=true,resolver=async()=>initial.snapshotDir;
  session=await createRossTalkSession({presentation:{snapshotDir:initial.snapshotDir,commandTimeoutMs:2000,prepareTimeoutMs:5000,controllerOptions:{mode:'manual'}},rossTalk:{host:'127.0.0.1',port:0,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',2:'next',3:'previous',4:'toggle-auto',5:'reload',8:'stop'},acknowledgements:true,maxQueue:4},canControl:()=>allowed,resolvePreparedSnapshot:value=>resolver(value),resolverTimeoutMs:3000},{allowEphemeral:true});
  await session.start();context=await browser.newContext({viewport:{width:960,height:540}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===session.origin?route.continue():route.abort());
  const page=await context.newPage();await page.goto(session.getProgramURL());await until(()=>session.snapshot().presentation.renderer.ready,'initial black ready');
  async function connect(){const socket=net.createConnection({host:'127.0.0.1',port:session.address().port});wires.push(socket);let buffer='';const lines=[];socket.on('error',()=>{});socket.on('data',bytes=>{buffer+=bytes;for(let i;(i=buffer.indexOf('\r\n'))>=0;){lines.push(buffer.slice(0,i));buffer=buffer.slice(i+2);}});await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});return{socket,lines,async command(id,ok=true){const count=lines.length;socket.write('GPI '+id+'\r\n');await until(()=>lines.length>count,'diagnostic command result');const line=lines[count];assert.ok(line.startsWith(ok?'OK ':'ERR '),line);return line;}};}
  return{session,page,initial,prepare,connect,setAllowed(value){allowed=value;},setResolver(value){resolver=value;}};
}
test('actual TCP commands produce native frames, mode feedback and verified Reload; gate denial never blocks Stop', {timeout:30000},async t=>{
  const f=await fixture(t),wire=await f.connect();
  await wire.command(1);await color(f.page,[240,20,20]);
  await wire.command(2);await color(f.page,[20,20,240]);
  await wire.command(3);await color(f.page,[240,20,20]);
  await wire.command(4);assert.equal(await f.page.locator('.piraiders-mode').innerText(),'AUTO');
  await wire.command(4);assert.equal(await f.page.locator('.piraiders-mode').innerText(),'MANUAL');
  const replacement=await f.prepare('replacement',[['01.png',[20,220,20]]]);f.setResolver(async()=>replacement.snapshotDir);
  await wire.command(5);assert.equal(f.session.snapshot().presentation.controller.deckId,replacement.deck.id);await color(f.page,[20,220,20]);
  f.setAllowed(false);await wire.command(2,false);await color(f.page,[20,220,20]);
  await wire.command(8);await color(f.page,[0,0,0]);assert.equal(f.session.snapshot().presentation.controller.state,'stopped');
});
test('Stop reaches black through a full TCP queue and repeated presses while an ignored resolver retains its actual barrier', {timeout:30000},async t=>{
  const f=await fixture(t),wire=await f.connect();await wire.command(1);
  const replacement=await f.prepare('late',[['01.png',[20,220,20]]]);let release,entered=false,signal;
  const gate=new Promise(resolve=>{release=resolve;});f.setResolver(async value=>{entered=true;signal=value.signal;await gate;return replacement.snapshotDir;});
  try{
    wire.socket.write('GPI 5\r\n');await until(()=>entered,'Reload resolver entered');
    wire.socket.write('GPI 2\r\n'.repeat(20)+'GPI 8\r\n'.repeat(100));
    await until(()=>f.session.snapshot().presentation.controller.state==='stopped'&&f.session.snapshot().presentation.renderer.presentation==='black','priority Stop acknowledged');
    assert.equal(signal.aborted,true);await color(f.page,[0,0,0]);
    assert.ok(f.session.snapshot().transport.outstandingCallbacks<=2,'one interrupted normal plus one Stop maximum');
    const later=await f.connect();later.socket.write('GPI 1\r\n');await wait(120);
    assert.equal(f.session.snapshot().presentation.controller.state,'stopped','normal successors cannot bypass unresolved callback');
    release();await until(()=>f.session.snapshot().presentation.controller.state==='playing','successor resumes after actual settlement');
    assert.equal(f.session.snapshot().presentation.controller.deckId,f.initial.deck.id);await color(f.page,[240,20,20]);
    assert.ok(f.session.snapshot().transport.stopFollowers<=4);
  }finally{release();}
});
test('late prepared resolution cannot cross a gate change or renderer epoch replacement', {timeout:30000},async t=>{
  const f=await fixture(t),wire=await f.connect();await wire.command(1);
  const replacement=await f.prepare('fenced',[['01.png',[20,220,20]]]);let release,entered=false;
  let gate=new Promise(resolve=>{release=resolve;});f.setResolver(async()=>{entered=true;await gate;return replacement.snapshotDir;});
  try{
    const n=wire.lines.length;wire.socket.write('GPI 5\r\n');await until(()=>entered,'gate resolver entered');f.setAllowed(false);release();await until(()=>wire.lines.length>n,'gate denial result');assert.ok(wire.lines.at(-1).startsWith('ERR '));
    assert.equal(f.session.snapshot().presentation.controller.deckId,f.initial.deck.id);await wire.command(8);await color(f.page,[0,0,0]);
    f.setAllowed(true);await wire.command(1);entered=false;gate=new Promise(resolve=>{release=resolve;});
    const before=wire.lines.length;wire.socket.write('GPI 5\r\n');await until(()=>entered,'epoch resolver entered');
    const epoch=f.session.snapshot().presentation.renderer.epoch;await f.page.goto(f.session.getProgramURL());
    await until(()=>f.session.snapshot().presentation.renderer.ready&&f.session.snapshot().presentation.renderer.epoch!==epoch,'fresh renderer epoch');release();await until(()=>wire.lines.length>before,'stale epoch rejection');
    assert.ok(wire.lines.at(-1).startsWith('ERR '));assert.equal(f.session.snapshot().presentation.controller.deckId,f.initial.deck.id);assert.equal(f.session.snapshot().presentation.controller.state,'stopped');await color(f.page,[0,0,0]);
  }finally{release();}
});
