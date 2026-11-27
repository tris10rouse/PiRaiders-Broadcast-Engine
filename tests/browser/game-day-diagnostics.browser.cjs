'use strict';
// BE-006 part 5c-2: the diagnostics panel on the Game Day page, in a real
// browser. The scripted server answers the diagnostics route with the real
// model (scripts/lib/game-day-diagnostics.cjs) over stand-in inputs, so the
// page shows what the route would answer. Every name is synthetic.
const nodeTest=require('node:test'),{before,after}=nodeTest;
const test=(name,fn)=>nodeTest.test(name,{timeout:90000},fn);
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {once}=require('node:events');
const {chromium}=require('playwright');
const exphbs=require('express-handlebars');
const {diagnose}=require('../../scripts/lib/game-day-diagnostics.cjs');
const root=path.resolve(__dirname,'../..');
const VIEW=path.join(root,'views','view-game-day.handlebars');
const evidence=process.env.PIRAIDERS_UI_EVIDENCE_DIR?path.resolve(process.env.PIRAIDERS_UI_EVIDENCE_DIR):path.join(root,'build','game-day-ui-browser');
let browser;
before(async()=>{const executablePath=process.env.PIRAIDERS_BROWSER_EXECUTABLE;if(executablePath)assert.ok(path.isAbsolute(executablePath));await fs.mkdir(evidence,{recursive:true});browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});});
after(()=>browser?.close());
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}
const NAMES=['exchangeFolder','catalogSequence','approvals','prepared','renderer','ndiSender'];
const pageState={state:'idle',closed:false,expectedEventId:null,expectedSelection:0,lastError:null,active:null,candidate:null,operation:null,preparing:false,listing:false,physicalBarrier:false};

async function scripted(t,{sourceMode=true,width=1440,height=1000}={}){
  // What the stand-in source service and manager report; diagnose() turns it into the route's answer.
  const model={root:{code:null},catalog:{available:true,catalog:{catalogSequence:7}},status:{catalog:{code:null},approvals:{read:true}},
    snapshot:{active:{cleanup:'open',runtime:{state:'ready',ready:true,output:'ndi'}},candidate:null},
    caspar:{from:'bundle',renderer:'software',layout:'ready',code:null},override:null,fail:0,hold:null,reads:0};
  const source={rootState:async()=>model.root,catalogState:()=>model.catalog,status:()=>model.status};
  const manager={snapshot:()=>model.snapshot};
  const html=await exphbs.create({extname:'.handlebars'}).render(VIEW,{csrfToken:'c'.repeat(64),sourceMode},{layout:false});
  const server=http.createServer(async(req,res)=>{try{
    const url=new URL(req.url,'http://fixture');
    if(url.pathname==='/game-day'){res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'"});res.end(html);return;}
    const assets={'/css/piraiders-game-day.css':['static/css/piraiders-game-day.css','text/css'],'/js/piraiders-game-day.js':['static/js/piraiders-game-day.js','text/javascript']};
    if(assets[url.pathname]){const[file,type]=assets[url.pathname];res.writeHead(200,{'Content-Type':type});res.end(await fs.readFile(path.join(root,file)));return;}
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    const route=url.pathname.replace('/game-day/api/','');const answer=(status,value)=>{res.statusCode=status;res.end(JSON.stringify(value));};
    if(route==='diagnostics'&&req.method==='GET'){
      model.reads++;const hold=model.hold;model.hold=null;if(hold){hold.entered.resolve();await hold.release.promise;}
      if(model.fail)return answer(model.fail,{ok:false,code:'STATE_UNAVAILABLE'});
      // Q-020: the web adapter adds which Caspar runs beside the six states.
      const diagnostics=model.override||{...await diagnose({source:sourceMode?source:null,manager}),caspar:model.caspar};
      return answer(200,{ok:true,diagnostics});
    }
    if(route==='state'&&req.method==='GET')return answer(200,{ok:true,state:pageState});
    if(route==='events'&&req.method==='GET')return answer(200,{ok:true,events:[]});
    if(route==='source/status'&&req.method==='GET')return answer(200,{ok:true,ready:false,status:{scope:'exchange-source-service',ready:false,catalog:{available:false,code:'SOURCE_UNAVAILABLE'}},catalog:{available:false,catalog:null}});
    if(route==='source/refresh'&&req.method==='POST')return answer(503,{ok:false,ready:false,code:'SOURCE_UNAVAILABLE'});
    return answer(404,{ok:false,code:'NOT_FOUND'});
  }catch{res.statusCode=500;res.end(JSON.stringify({ok:false,code:'FIXTURE_FAILED'}));}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  t.after(async()=>{model.hold?.release.resolve();await context.close();await new Promise(resolve=>server.close(resolve));assert.deepEqual(errors,[]);});
  return{page,model,origin};
}
const rows=page=>page.evaluate(names=>names.map(n=>document.getElementById('diag-'+n).firstChild?.textContent??''),NAMES);
const codes=page=>page.evaluate(names=>names.map(n=>document.querySelector('#diag-'+n+' .diag-code')?.textContent??null),NAMES);
async function readAgain(page,model){const before=model.reads;await page.locator('#diagnostics-refresh').click();await page.waitForFunction(()=>!document.querySelector('#diagnostics-refresh').hasAttribute('aria-busy'));assert.ok(model.reads>before);}
const caspar=page=>page.evaluate(()=>{const e=document.getElementById('diag-caspar');return{text:e.firstChild?.textContent??'',lines:[...e.querySelectorAll('.diag-code')].map(x=>x.textContent),tone:e.dataset.tone};});
function noClaims(texts){for(const text of texts){assert.doesNotMatch(text,/\bready\b/i);assert.doesNotMatch(text,/on air|on-air|receiver|board input|discovered/i);}}

test('source machine: six distinct states, loading, keyboard re-read, faults and an unreadable answer',async t=>{
  const {page,model,origin}=await scripted(t);
  const first=deferred(),entered=deferred();model.hold={entered,release:first};
  // Q-008: the page's own 5 s bound on a GET is real time. A cold first page
  // on hosted Windows took over 5 s (job 139667346571), so that bound aborted
  // the read this test holds. The page's clock stands still while it is held.
  await page.clock.install();await page.clock.pauseAt(Date.now()+1000);
  await page.goto(origin+'/game-day');await entered.promise;
  await new Promise(resolve=>setTimeout(resolve,5500));
  assert.equal(await page.locator('#diagnostics-summary').textContent(),'Reading diagnostics…');
  assert.deepEqual(await rows(page),NAMES.map(()=>'Reading…'));
  first.resolve();await page.clock.resume();await page.waitForFunction(()=>document.querySelector('#diagnostics-summary').textContent.startsWith('Diagnostics read.'));
  // Everything up: still six separate statements, none of them "ready" or "on air".
  const up=await rows(page);
  assert.deepEqual(up,['Reachable','Catalog sequence 7 read','Readable','None prepared','Acknowledged','Sender running']);
  assert.equal(new Set(up).size,6);noClaims(up);assert.deepEqual(await codes(page),[null,null,null,null,null,null]);
  assert.equal(await page.locator('#diagnostics dt').count(),7,'six states and the graphics renderer');
  // Q-020: the renderer the bundled Caspar uses, and the ndi.video link beside the NDI sender.
  assert.deepEqual(await caspar(page),{text:'Software (bundled Mesa)',lines:['renderer: software'],tone:''});
  const link=page.locator('#ndi-link');
  assert.equal(await link.getAttribute('href'),'https://ndi.video');assert.equal(await link.getAttribute('rel'),'noopener noreferrer');assert.ok(await link.isVisible());
  assert.equal(await link.evaluate(a=>a.closest('[data-state]').dataset.state),'ndiSender','the link sits in the NDI sender row');
  assert.match(await page.locator('#diagnostics-note').textContent(),/NDI® is a registered trademark of Vizrt NDI AB\./);
  assert.equal(await page.locator('#diagnostics dt').nth(6).textContent(),'NDI® sender');
  await page.screenshot({path:path.join(evidence,'game-day-diagnostics-source-desktop.png'),fullPage:true});
  // The live status line stays the same across quiet reads; the time is outside it.
  const live=await page.locator('#diagnostics-summary').textContent();
  assert.doesNotMatch(live,/\d:\d\d/);assert.equal(await page.locator('#diagnostics-summary').getAttribute('aria-live'),'polite');
  assert.match(await page.locator('#diagnostics-time').textContent(),/^Read at \d/);
  assert.equal(await page.locator('#diagnostics-time').evaluate(e=>e.closest('[aria-live]')),null);
  await readAgain(page,model);assert.equal(await page.locator('#diagnostics-summary').textContent(),live);
  // Desktop layout: under both columns, full width, three per row.
  const desk=await page.evaluate(()=>{const w=document.querySelector('.workspace').getBoundingClientRect(),d=document.querySelector('#diagnostics-section').getBoundingClientRect(),p=document.querySelector('.playback-section').getBoundingClientRect(),src=document.querySelector('#source-section').getBoundingClientRect();
    const r=[...document.querySelectorAll('#diagnostics > div')].map(x=>x.getBoundingClientRect());return{full:Math.abs(d.width-w.width)<=2,below:d.top>=Math.max(p.bottom,src.bottom)-1,cols:new Set(r.map(x=>Math.round(x.left))).size};});
  assert.deepEqual(desk,{full:true,below:true,cols:3});

  // The re-read button is reached by Tab from the page's own controls.
  await page.locator('#source-refresh').focus();let reached=false;
  for(let i=0;i<60&&!reached;i++){await page.keyboard.press('Tab');reached=await page.evaluate(()=>document.activeElement?.id==='diagnostics-refresh');}
  assert.ok(reached,'Tab reaches Read diagnostics again');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.id),'ndi-link','Tab then reaches the ndi.video link');
  assert.notEqual(await page.locator('#ndi-link').evaluate(a=>getComputedStyle(a).outlineStyle),'none','the link shows its focus');
  await page.locator('#diagnostics-refresh').focus();

  // Faults: each state says its own thing, with its code.
  model.root={code:'SOURCE_UNAVAILABLE'};model.catalog={available:false};model.status={catalog:{code:'CATALOG_UNAVAILABLE'},approvals:{read:false,code:'APPROVAL_STORE_UNREADABLE'}};
  model.snapshot={active:{cleanup:'open',runtime:{state:'starting',ready:false,output:'ndi'}},candidate:{cleanup:'open'}};
  const before=model.reads;await page.keyboard.press('Enter');await page.waitForFunction(n=>!document.querySelector('#diagnostics-refresh').hasAttribute('aria-busy'),before);assert.ok(model.reads>before);
  await page.waitForFunction(()=>document.getElementById('diag-exchangeFolder').firstChild?.textContent==='Not reachable');
  const down=await rows(page);
  assert.deepEqual(down,['Not reachable','No catalog read','Could not be read','Prepared, not activated','Waiting for acknowledgment','Sender starting']);noClaims(down);
  assert.deepEqual(await codes(page),['SOURCE_UNAVAILABLE','CATALOG_UNAVAILABLE','APPROVAL_STORE_UNREADABLE',null,null,null]);
  assert.equal(await page.locator('#diag-exchangeFolder').getAttribute('data-tone'),'attention');
  assert.equal(await page.locator('#diag-prepared').getAttribute('data-tone'),'');

  model.root={code:'SOURCE_ROOT_MISMATCH'};model.snapshot={active:null,candidate:{cleanup:'failed'}};model.status={catalog:{code:null},approvals:{}};
  await readAgain(page,model);
  assert.deepEqual((await rows(page)).filter((_,i)=>[0,2,3,4,5].includes(i)),['Not the folder set up on this PC','Not read yet','Preparation cleanup not confirmed','No active event','Not running']);
  assert.equal(await page.locator('#diag-prepared').getAttribute('data-tone'),'attention');

  // Q-020: the graphics card, a software copy that could not be made, and a machine file's own Caspar.
  model.caspar={from:'bundle',renderer:'gpu',layout:'not-needed',code:null};await readAgain(page,model);
  assert.deepEqual(await caspar(page),{text:'Graphics card',lines:['renderer: gpu'],tone:''});
  model.caspar={from:'bundle',renderer:'software',layout:'failed',code:'SOFTWARE_LAYOUT_FAILED'};await readAgain(page,model);
  assert.deepEqual(await caspar(page),{text:'Software (bundled Mesa)',lines:['renderer: software','SOFTWARE_LAYOUT_FAILED'],tone:'attention'});
  await page.screenshot({path:path.join(evidence,'game-day-diagnostics-renderer-failed.png'),fullPage:true});
  model.caspar={from:'machine-file',renderer:'unknown',layout:'not-needed',code:null};await readAgain(page,model);
  assert.deepEqual(await caspar(page),{text:'Set by this PC’s own Caspar',lines:[],tone:''});
  model.caspar={from:'machine-file',renderer:'software',layout:'not-needed',code:null};await readAgain(page,model);
  assert.deepEqual(await caspar(page),{text:'Software (Mesa), this PC’s own Caspar',lines:['renderer: software'],tone:''});
  // Values the page does not know are never echoed; no caspar answer is not known.
  for(const value of [{from:'bundle',renderer:'<b>gpu</b>'},{from:'elsewhere',renderer:'gpu'},'gpu',null]){
    model.caspar=value;await readAgain(page,model);
    assert.deepEqual(await caspar(page),{text:'Not known',lines:[],tone:'attention'},JSON.stringify(value));
  }
  model.caspar={from:'bundle',renderer:'software',layout:'ready',code:null};
  // A state value the page does not know is never echoed; a missing one is not known.
  model.override={scope:'game-day-diagnostics',ready:false,mode:'source',states:{exchangeFolder:{state:'on-air',code:'ON_AIR'},catalogSequence:{state:'read',code:null,sequence:'7'},approvals:{state:'readable',code:'<b>x</b>'},prepared:{state:'none',code:null},renderer:{state:'acknowledged',code:null}},neverClaimed:[]};
  await readAgain(page,model);
  assert.deepEqual(await rows(page),['Not known','Not known','Readable','None prepared','Acknowledged','Not known']);
  assert.deepEqual(await codes(page),[null,null,null,null,null,null]);
  assert.equal(await page.locator('#diagnostics b').count(),0);

  // The route fails: every row unavailable, not the last answer.
  model.override=null;model.fail=500;await readAgain(page,model);
  assert.deepEqual(await rows(page),NAMES.map(()=>'Unavailable'));
  assert.deepEqual(await caspar(page),{text:'Unavailable',lines:[],tone:'attention'});
  assert.equal(await page.locator('#diagnostics-summary').textContent(),'Diagnostics could not be read. Check the connection to the application, then read them again.');
  await page.screenshot({path:path.join(evidence,'game-day-diagnostics-source-unavailable.png'),fullPage:true});
  model.fail=0;await readAgain(page,model);assert.equal((await rows(page))[0],'Not the folder set up on this PC');
});

test('a read held past the page\'s 5 s bound shows could not be read, then a re-read recovers',async t=>{
  const {page,model,origin}=await scripted(t);
  const held=deferred(),entered=deferred();model.hold={entered,release:held};
  await page.clock.install();await page.clock.pauseAt(Date.now()+1000);
  await page.goto(origin+'/game-day');await entered.promise;
  await page.clock.runFor(4900);
  assert.equal(await page.locator('#diagnostics-summary').textContent(),'Reading diagnostics…');
  await page.clock.runFor(200);
  await page.waitForFunction(()=>document.querySelector('#diagnostics-summary').textContent.startsWith('Diagnostics could not be read.'));
  assert.deepEqual(await rows(page),NAMES.map(()=>'Unavailable'));
  held.resolve();await page.clock.resume();await readAgain(page,model);
  assert.equal(await page.locator('#diagnostics-summary').textContent(),'Diagnostics read. They are read again every few seconds.');
});

test('after an access answer the page stops reading diagnostics, also on the button',async t=>{
  const {page,model,origin}=await scripted(t,{sourceMode:false});
  model.fail=401;await page.goto(origin+'/game-day');
  await page.getByText('Sign-in required',{exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('#diagnostics-refresh').hasAttribute('aria-busy'));
  const reads=model.reads;await page.locator('#diagnostics-refresh').click();await new Promise(resolve=>setTimeout(resolve,5600));
  assert.equal(model.reads,reads,'no diagnostics read once sign-in is required');
  assert.deepEqual(await rows(page),NAMES.map(()=>'Unavailable'));
});

test('local machine at 390 px: exchange states not used, one column, no sideways scroll',async t=>{
  const {page,model,origin}=await scripted(t,{sourceMode:false,width:390,height:844});
  model.snapshot={active:{cleanup:'open',runtime:{state:'ready',ready:true,output:'none'}},candidate:null};
  await page.goto(origin+'/game-day');await page.waitForFunction(()=>document.querySelector('#diagnostics-summary').textContent.startsWith('Diagnostics read.'));
  const texts=await rows(page);
  assert.deepEqual(texts,['Not used on this PC','Not used on this PC','Not used on this PC','None prepared','Acknowledged','Output disabled']);noClaims(texts);
  await page.locator('#diagnostics-section').scrollIntoViewIfNeeded();assert.ok(await page.locator('#diagnostics-section').isVisible());
  const layout=await page.evaluate(()=>{const s=document.scrollingElement,m=document.querySelector('main');const r=[...document.querySelectorAll('#diagnostics > div')].map(d=>d.getBoundingClientRect());
    const row=document.querySelector('#diagnostics > div'),dt=row.querySelector('dt').getBoundingClientRect(),dd=row.querySelector('dd').getBoundingClientRect();
    return{page:s.scrollWidth-s.clientWidth,main:m.scrollWidth-m.clientWidth,lefts:new Set(r.map(x=>Math.round(x.left))).size,sameLine:Math.abs(dt.top-dd.top)<4&&dd.left>dt.right,
      below:document.querySelector('#diagnostics-section').getBoundingClientRect().top>=document.querySelector('.playback-section').getBoundingClientRect().bottom-1};});
  assert.equal(layout.page,0);assert.ok(layout.main<=0,'main does not scroll sideways');assert.equal(layout.lefts,1,'one column');
  assert.ok(layout.sameLine,'name and value share a line at 390 px');assert.ok(layout.below,'below playback');
  // Q-020 at 390 px: the renderer row and the ndi.video link fit, the link on its own line inside the NDI sender row.
  assert.deepEqual(await caspar(page),{text:'Software (bundled Mesa)',lines:['renderer: software'],tone:''});
  const ndi=await page.evaluate(()=>{const row=document.querySelector('[data-state=ndiSender]').getBoundingClientRect(),dd=document.getElementById('diag-ndiSender').getBoundingClientRect(),a=document.getElementById('ndi-link').getBoundingClientRect();
    return{inside:a.left>=row.left-1&&a.right<=row.right+1&&a.bottom<=row.bottom+1,below:a.top>=dd.bottom-1,visible:a.width>0&&a.height>0};});
  assert.deepEqual(ndi,{inside:true,below:true,visible:true});
  await page.screenshot({path:path.join(evidence,'game-day-diagnostics-local-390.png'),fullPage:true});
});
