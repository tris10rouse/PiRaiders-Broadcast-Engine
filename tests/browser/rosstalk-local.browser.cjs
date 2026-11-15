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
test('trusted local commands and actual TCP share native pixels, mode feedback and last-good Reload', {timeout:30000},async t=>{
  const f=await fixture(t),wire=await f.connect();
  assert.equal((await f.session.dispatch('launch')).ok,true);await color(f.page,[240,20,20]);
  await wire.command(2);await color(f.page,[20,20,240]);assert.equal((await f.session.dispatch('previous')).ok,true);await color(f.page,[240,20,20]);
  assert.equal((await f.session.dispatch('auto')).ok,true);assert.equal(f.session.snapshot().presentation.controller.mode,'auto');
  assert.equal((await f.session.dispatch('manual')).ok,true);assert.equal(f.session.snapshot().presentation.controller.mode,'manual');
  const candidate=await f.prepare('local-green',[['01.png',[20,220,20]]]);f.setResolver(()=>candidate.snapshotDir);assert.equal((await f.session.dispatch('reload')).ok,true);await color(f.page,[20,220,20]);
  f.setResolver(()=>{throw Error('/private/student/name');});assert.equal((await f.session.dispatch('reload')).code,'HANDLER_FAILED');assert.equal(f.session.snapshot().lastError,'RESOLVER_FAILED');await color(f.page,[20,220,20]);
  f.setAllowed(false);assert.equal((await f.session.dispatch('next')).code,'HANDLER_FAILED');await color(f.page,[20,220,20]);
  assert.equal((await f.session.dispatch('stop')).ok,true);await color(f.page,[0,0,0]);assert.ok(!JSON.stringify(f.session.snapshot()).includes('/private'));
});

test('TCP Stop blacks a local ignored Reload while its shared barrier prevents late visible output', {timeout:30000},async t=>{
  const f=await fixture(t),wire=await f.connect();assert.equal((await f.session.dispatch('launch')).ok,true);await color(f.page,[240,20,20]);
  let release,signal;const pending=new Promise(resolve=>{release=resolve;});f.setResolver(value=>{signal=value.signal;return pending;});
  const reload=f.session.dispatch('reload');await until(()=>!!signal,'local resolver entered');await wire.command(8);assert.equal(signal.aborted,true);assert.equal((await reload).code,'CANCELLED');await color(f.page,[0,0,0]);
  let settled=false;const next=f.session.dispatch('next').then(value=>{settled=true;return value;});await wait(50);assert.equal(settled,false);await color(f.page,[0,0,0]);
  release(f.initial.snapshotDir);assert.equal((await next).code,'HANDLER_FAILED');await color(f.page,[0,0,0]);assert.equal(f.session.snapshot().presentation.controller.state,'stopped');
  assert.equal((await f.session.dispatch('launch')).ok,true);await color(f.page,[240,20,20]);await f.session.close();assert.equal((await f.session.dispatch('stop')).code,'CLOSED');
});
