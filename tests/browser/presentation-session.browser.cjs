'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const { stageSnapshot } = require('../../scripts/lib/media-snapshot.cjs');
const { createPresentationHost } = require('../../scripts/lib/presentation-host.cjs');
let browser;
before(async () => {
  const executablePath = process.env.PIRAIDERS_BROWSER_EXECUTABLE;
  if (executablePath) assert.ok(path.isAbsolute(executablePath));
  browser = await chromium.launch({headless:true,...(executablePath ? {executablePath} : {}),args:['--no-sandbox']});
});
after(async () => { await browser?.close(); });
function image(rgb) {
  const data = Buffer.alloc(160 * 90 * 4);
  for (let i=0;i<data.length;i+=4) data.set([...rgb,255],i);
  return {width:160,height:90,data};
}
async function until(predicate, label, timeoutMs=5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now()<end) { if (await predicate()) return; await new Promise(resolve=>setTimeout(resolve,15)); }
  throw Error('Timed out: '+label);
}
async function pixels(page, expected) {
  const png=PNG.sync.read(await page.screenshot()), i=(Math.floor(png.height/2)*png.width+Math.floor(png.width/2))*4;
  const actual=[...png.data.subarray(i,i+3)];
  assert.ok(actual.every((v,n)=>Math.abs(v-expected[n])<=8),`${actual} near ${expected}`);
}
async function fixture(t, options={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders program '));
  let host, context;
  t.after(async()=>{ await host?.close(); await context?.close(); await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}); });
  const sourceDir=path.join(root,'source'),cacheDir=path.join(root,'cache');await fs.mkdir(sourceDir);
  await fs.writeFile(path.join(sourceDir,'01.png'),PNG.sync.write(image([240,20,20])));
  await fs.writeFile(path.join(sourceDir,'02.jpg'),jpeg.encode(image([20,20,240]),95).data);
  const staged=await stageSnapshot({sourceDir,cacheDir,quietMs:0});await fs.rm(sourceDir,{recursive:true});
  host=await createPresentationHost({snapshotDir:staged.snapshotDir,commandTimeoutMs:2000,controllerOptions:{mode:'manual'},...options});
  context=await browser.newContext({viewport:{width:960,height:540}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===host.origin ? route.continue() : route.abort());
  return {root,host,context,staged,async open(){const page=await context.newPage();await page.goto(host.getProgramURL());await until(()=>host.snapshot().renderer.ready,'renderer black readiness');return page;}};
}
test('authenticated managed program delivers real offline frames; normal SPX globals cannot become a second writer', {timeout:20000},async t=>{
  const f=await fixture(t),{host}=f;
  assert.equal((await host.dispatch('launch')).code,'NOT_READY');
  const page=await f.open();assert.ok(!page.url().includes('#'),'bootstrap capability removed from history');
  assert.equal(host.snapshot().renderer.presentation,'black');await pixels(page,[0,0,0]);
  assert.equal((await host.dispatch('next')).code,'NOT_PLAYING');
  for(const[action,index,color]of[['launch',0,[240,20,20]],['previous',1,[20,20,240]],['next',0,[240,20,20]]]){
    assert.equal((await host.dispatch(action)).ok,true);assert.equal(host.snapshot().controller.index,index);
    assert.equal(host.snapshot().renderer.presentation,'frame');await pixels(page,color);
  }
  const blocked=await page.evaluate(async()=>Promise.all([window.play(),window.next(),window.update('{}')]));
  assert.ok(blocked.every(result=>!result.ok),'managed lifecycle refuses competing writes');await pixels(page,[240,20,20]);
  const cookies=await f.context.cookies();const cookie=cookies.find(c=>c.name.startsWith('piraidersPresentation_'));
  assert.ok(cookie&&cookie.httpOnly&&cookie.sameSite==='Strict'&&cookie.path==='/piraiders/');
  const credential=new URL(host.getProgramURL()).hash.slice('#piraiders='.length);
  assert.ok(!JSON.stringify(host.snapshot()).includes(credential),'diagnostics omit bootstrap secret');
  const anonymous=await browser.newContext();t.after(()=>anonymous.close());
  const response=await anonymous.request.get(host.origin+'/piraiders/media/'+f.staged.deck.id+'/'+f.staged.deck.slides[0].src);
  assert.equal(response.status(),403);
  assert.equal((await host.dispatch('stop')).ok,true);assert.equal(host.snapshot().renderer.presentation,'black');await pixels(page,[0,0,0]);
  assert.equal((await host.dispatch('next')).ok,false);await pixels(page,[0,0,0]);
  await page.evaluate(()=>window.stop());await until(()=>!host.snapshot().renderer.connected,'managed stop closes session');await page.waitForFunction(()=>window.piraidersRenderer.snapshot().state==='black',null,{timeout:4000});await pixels(page,[0,0,0]);
});
test('Stop cancels an actual delayed image fetch and late network completion never relights output', {timeout:20000},async t=>{
  const f=await fixture(t),page=await f.open();await f.host.dispatch('launch');
  let release, entered;
  const gate=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{entered=resolve;});
  t.after(()=>release());
  await page.route('**/*.jpg',async route=>{entered();await gate;await route.continue().catch(()=>{});});
  const next=f.host.dispatch('next');await seen;
  const stop=f.host.dispatch('stop');assert.equal((await next).ok,false);assert.equal((await stop).ok,true);
  await pixels(page,[0,0,0]);release();await page.waitForTimeout(350);await pixels(page,[0,0,0]);
  assert.equal(f.host.snapshot().controller.state,'stopped');assert.equal(f.host.snapshot().renderer.presentation,'black');
  assert.equal((await f.host.dispatch('launch')).ok,true);await pixels(page,[240,20,20]);
});
test('one program owner, real transport disconnect blacks, and fresh credential navigation requires Launch instead of replay',{timeout:20000},async t=>{
  const f=await fixture(t);
  // Capture the actual native WebSocket only for fault injection. No transport,
  // renderer promise, decode or acknowledgment is mocked.
  await f.context.addInitScript(()=>{const Native=window.WebSocket;window.WebSocket=class extends Native{constructor(...args){super(...args);window.__faultSocket=this;}};});
  const page=await f.open();await f.host.dispatch('launch');await f.host.dispatch('next');await pixels(page,[20,20,240]);
  const second=await browser.newContext();t.after(()=>second.close());const extra=await second.newPage();
  await extra.goto(f.host.getProgramURL());await extra.waitForTimeout(250);
  await pixels(extra,[0,0,0]);assert.equal(f.host.snapshot().renderer.ready,true);await pixels(page,[20,20,240]);
  await page.evaluate(()=>window.__faultSocket.close());
  await until(()=>!f.host.snapshot().renderer.connected,'transport disconnected');await page.waitForFunction(()=>window.piraidersRenderer.snapshot().state==='black',null,{timeout:4000});await pixels(page,[0,0,0]);
  assert.equal(f.host.snapshot().renderer.presentation,'unverified');assert.equal(f.host.snapshot().controller.state,'stopped');
  await page.waitForTimeout(300);assert.equal(f.host.snapshot().renderer.connected,false,'no automatic reconnect');
  await page.goto(f.host.getProgramURL());await until(()=>f.host.snapshot().renderer.ready,'new session black ack');
  await pixels(page,[0,0,0]);assert.equal((await f.host.dispatch('next')).code,'NOT_PLAYING');
  assert.equal((await f.host.dispatch('launch')).ok,true);assert.equal(f.host.snapshot().controller.index,0);await pixels(page,[240,20,20]);
  await f.host.close();await page.waitForFunction(()=>window.piraidersRenderer.snapshot().state==='black',null,{timeout:4000});await pixels(page,[0,0,0]);assert.equal(f.host.snapshot().closed,true);
});
test('lost paint acknowledgment times out closed, resets controller and prevents late committed frames',{timeout:20000},async t=>{
  const f=await fixture(t,{commandTimeoutMs:800}),page=await f.open();await f.host.dispatch('launch');
  await page.evaluate(()=>{window.requestAnimationFrame=()=>1;});
  const result=await f.host.dispatch('next');assert.equal(result.ok,false);
  await until(()=>!f.host.snapshot().renderer.connected,'timeout closes transport');
  assert.equal(f.host.snapshot().renderer.presentation,'unverified');assert.equal(f.host.snapshot().controller.state,'stopped');
  await page.waitForFunction(()=>window.piraidersRenderer.snapshot().state==='black',null,{timeout:4000});await pixels(page,[0,0,0]);await page.waitForTimeout(1100);await pixels(page,[0,0,0]);
  assert.equal((await f.host.dispatch('launch')).code,'NOT_READY');
});
test('missing stylesheet leaves an all-black canvas and cannot report managed readiness', {timeout:20000}, async t=>{
  const f=await fixture(t),page=await f.context.newPage();
  await page.route('**/slideshow.css',route=>route.abort());
  await page.goto(f.host.getProgramURL());await page.waitForTimeout(300);
  const png=PNG.sync.read(await page.screenshot());
  for(let i=0;i<png.data.length;i+=4) assert.ok(png.data[i]<=2&&png.data[i+1]<=2&&png.data[i+2]<=2,'every startup pixel remains black');
  assert.equal(f.host.snapshot().renderer.ready,false);
  assert.equal((await f.host.dispatch('launch')).code,'NOT_READY');
});
async function candidateFor(f, files) {
  const sourceDir=await fs.mkdtemp(path.join(f.root,'candidate-'));
  for(const[name,color]of files) await fs.writeFile(path.join(sourceDir,name),name.endsWith('.jpg') ? jpeg.encode(image(color),95).data : PNG.sync.write(image(color)));
  const prepared=await stageSnapshot({sourceDir,cacheDir:path.join(f.root,'cache'),quietMs:0});
  await fs.rm(sourceDir,{recursive:true});return prepared;
}
test('managed mode feedback and verified Reload preserve occurrences, keep failed candidates off output and stay black while stopped', {timeout:20000}, async t=>{
  const f=await fixture(t),page=await f.open();await f.host.dispatch('launch');await f.host.dispatch('next');
  assert.equal((await f.host.dispatch('auto')).ok,true);
  assert.equal(f.host.snapshot().controller.mode,'auto');assert.equal(await page.locator('.piraiders-mode').innerText(),'AUTO');
  assert.equal((await f.host.dispatch('manual')).ok,true);
  assert.equal(f.host.snapshot().controller.mode,'manual');assert.equal(await page.locator('.piraiders-mode').innerText(),'MANUAL');await pixels(page,[20,20,240]);
  const candidate=await candidateFor(f,[['02.jpg',[20,20,240]],['03.png',[20,220,20]]]);
  assert.equal((await f.host.reloadSnapshot(candidate.snapshotDir)).ok,true);
  await until(()=>f.host.snapshot().reload.state==='idle','successful candidate retirement');
  assert.equal(f.host.snapshot().controller.deckId,candidate.deck.id);assert.equal(f.host.snapshot().controller.index,0);
  await pixels(page,[20,20,240]);
  const oldURL=f.host.origin+'/piraiders/media/'+f.staged.deck.id+'/'+f.staged.deck.slides[0].src;
  const retired=await f.context.request.get(oldURL);assert.notEqual(retired.status(),200);assert.equal((await retired.body()).length,0);
  await page.waitForFunction(()=>document.querySelector('.piraiders-reload').hidden,null,{timeout:3000});
  const invalid=await candidateFor(f,[['02.jpg',[20,20,240]],['03.png',[240,200,20]]]);
  await fs.writeFile(path.join(invalid.snapshotDir,invalid.manifest.files[0].src),Buffer.alloc(invalid.manifest.files[0].bytes));
  assert.equal((await f.host.dispatch('auto')).ok,true);const deadline=f.host.snapshot().controller.nextAdvanceAt;
  assert.equal((await f.host.reloadSnapshot(invalid.snapshotDir)).ok,false);
  await page.waitForFunction(()=>document.querySelector('.piraiders-reload').textContent.includes('FAILED'),null,{timeout:3000});
  assert.equal(f.host.snapshot().controller.nextAdvanceAt,deadline,'preparation/feedback failure keeps existing Auto deadline');
  assert.equal(f.host.snapshot().controller.deckId,candidate.deck.id);await pixels(page,[20,20,240]);
  const green=await candidateFor(f,[['03.png',[20,220,20]]]);
  assert.equal((await f.host.dispatch('stop')).ok,true);
  assert.equal((await f.host.reloadSnapshot(green.snapshotDir)).ok,true);
  assert.equal(f.host.snapshot().controller.state,'stopped');assert.equal(f.host.snapshot().controller.index,null);
  assert.equal(f.host.snapshot().controller.nextAdvanceAt,null);await pixels(page,[0,0,0]);
  assert.equal(await page.locator('.piraiders-reload').isVisible(),false);
  assert.equal((await f.host.dispatch('launch')).ok,true);await pixels(page,[20,220,20]);
  assert.equal(f.host.snapshot().media.registered,1);
});
test('Stop does not wait for blocked candidate filesystem I/O and late preparation cannot restore Reload feedback', {timeout:20000}, async t=>{
  const f=await fixture(t),page=await f.open();await f.host.dispatch('launch');
  const candidate=await candidateFor(f,[['01.png',[20,220,20]]]);
  const target=path.join(candidate.snapshotDir,'manifest.json'),original=fs.open;
  let release,entered,descriptorClosed;
  const gate=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{entered=resolve;}),closed=new Promise(resolve=>{descriptorClosed=resolve;});
  let intercepted=false;
  t.mock.method(fs,'open',async(...args)=>{
    const handle=await original(...args);
    if(args[0]===target&&!intercepted){
      intercepted=true;const read=handle.read.bind(handle),close=handle.close.bind(handle);let first=true;
      handle.read=async(...values)=>{if(first){first=false;entered();await gate;}return read(...values);};
      handle.close=async()=>{try{return await close();}finally{descriptorClosed();}};
    }
    return handle;
  });
  try{
    const reload=f.host.reloadSnapshot(candidate.snapshotDir);await seen;
    assert.equal((await f.host.dispatch('stop')).ok,true);await pixels(page,[0,0,0]);
    assert.equal((await reload).code,'CANCELLED');
    assert.equal((await f.host.reloadSnapshot(candidate.snapshotDir)).code,'BUSY','admission held until actual verification settles');
    release();await closed;await until(()=>f.host.snapshot().reload.state==='idle','canceled verification cleanup');
    assert.equal(f.host.snapshot().controller.deckId,f.staged.deck.id);assert.equal(f.host.snapshot().media.registered,1);
    await page.waitForTimeout(150);await pixels(page,[0,0,0]);
    assert.equal(await page.locator('.piraiders-reload').isVisible(),false);assert.equal(await page.locator('.piraiders-mode').innerText(),'');
  }finally{release();if(intercepted)await closed;t.mock.restoreAll();}
});
test('Stop cancels candidate rendering without early promotion and a late image cannot replace the last-good deck', {timeout:20000}, async t=>{
  const f=await fixture(t),page=await f.open();await f.host.dispatch('launch');
  const candidate=await candidateFor(f,[['01.png',[20,220,20]]]);
  let release,entered;const gate=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{entered=resolve;});
  await page.route('**/piraiders/media/'+candidate.deck.id+'/**',async route=>{entered();await gate;await route.continue().catch(()=>{});});
  try{
    const reload=f.host.reloadSnapshot(candidate.snapshotDir);await seen;
    assert.equal((await f.host.dispatch('stop')).ok,true);assert.equal((await reload).code,'CANCELLED');
    await pixels(page,[0,0,0]);release();await until(()=>f.host.snapshot().reload.state==='idle','canceled candidate retirement');
    await page.waitForTimeout(150);await pixels(page,[0,0,0]);assert.equal(f.host.snapshot().controller.deckId,f.staged.deck.id);
    assert.equal(f.host.snapshot().media.registered,1);assert.equal((await f.host.dispatch('launch')).ok,true);await pixels(page,[240,20,20]);
  }finally{release();}
});
test('preparation deadline replaces loading with safe failure feedback while last-good Auto timing continues', {timeout:20000}, async t=>{
  const f=await fixture(t,{prepareTimeoutMs:400,controllerOptions:{mode:'auto',intervalMs:10000}}),page=await f.open();await f.host.dispatch('launch');
  const deadline=f.host.snapshot().controller.nextAdvanceAt,candidate=await candidateFor(f,[['01.png',[20,220,20]]]);
  const target=path.join(candidate.snapshotDir,'manifest.json'),original=fs.open;
  let release,descriptorClosed,intercepted=false;
  const gate=new Promise(resolve=>{release=resolve;}),closed=new Promise(resolve=>{descriptorClosed=resolve;});
  t.mock.method(fs,'open',async(...args)=>{
    const handle=await original(...args);
    if(args[0]===target&&!intercepted){
      intercepted=true;const read=handle.read.bind(handle),close=handle.close.bind(handle);let first=true;
      handle.read=async(...values)=>{if(first){first=false;await gate;}return read(...values);};
      handle.close=async()=>{try{return await close();}finally{descriptorClosed();}};
    }
    return handle;
  });
  try{
    const reload=f.host.reloadSnapshot(candidate.snapshotDir);
    await until(()=>intercepted,'candidate descriptor entered');
    await page.waitForFunction(()=>!document.querySelector('.piraiders-reload').hidden&&!!document.querySelector('.piraiders-spinner'),null,{timeout:3000});
    assert.equal((await reload).code,'PREPARE_TIMEOUT');
    await page.waitForFunction(()=>document.querySelector('.piraiders-reload').textContent.includes('FAILED'),null,{timeout:3000});
    assert.equal(f.host.snapshot().controller.nextAdvanceAt,deadline);assert.equal(f.host.snapshot().controller.autoSuspended,false);
    assert.equal(f.host.snapshot().controller.deckId,f.staged.deck.id);await pixels(page,[240,20,20]);
    assert.equal((await f.host.reloadSnapshot(candidate.snapshotDir)).code,'BUSY');
    release();await closed;await until(()=>f.host.snapshot().reload.state==='idle','timed-out verification cleanup');
  }finally{release();if(intercepted)await closed;t.mock.restoreAll();}
});
