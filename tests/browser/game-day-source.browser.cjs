'use strict';
// BE-006 item 4b: the exchange catalog screen on the Game Day page of a source
// machine, in a real browser. A scripted server drives paging, stale and
// unavailable states; a second test runs the real web adapter and the real
// source service on temporary synthetic folders. Every name is synthetic.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const crypto=require('node:crypto');
const {once}=require('node:events');
const {chromium}=require('playwright');
const express=require('express'),session=require('express-session'),exphbs=require('express-handlebars');
const root=path.resolve(__dirname,'../..');
const VIEW=path.join(root,'views','view-game-day.handlebars');
const evidence=process.env.PIRAIDERS_UI_EVIDENCE_DIR?path.resolve(process.env.PIRAIDERS_UI_EVIDENCE_DIR):path.join(root,'build','game-day-ui-browser');
let browser;
before(async()=>{const executablePath=process.env.PIRAIDERS_BROWSER_EXECUTABLE;if(executablePath)assert.ok(path.isAbsolute(executablePath));await fs.mkdir(evidence,{recursive:true});browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});});
after(()=>browser?.close());

function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}
const pad=n=>String(n).padStart(2,'0');
function catalog(){
  const events=[],selections={};
  for(let i=1;i<=30;i++){
    const key='EV-'+pad(i);
    events.push({eventKey:key,displayName:'Synthetic event '+pad(i),eventDate:'2026-10-'+pad(i),eventType:'Synthetic',homeSchool:'Synthetic',venue:'Synthetic field',
      playbackArea:'Stadium Playback',boardOnly:false,eventBoard:{boardKey:'BOARD-MAIN',displayName:'Synthetic main board'},eligibility:{eligible:true,reasonCodes:[]},timingProposal:null,selectionCount:i===2?30:1});
    selections[key]=Array.from({length:i===2?30:1},(_,n)=>({selectionId:'sel-'+pad(i)+'-'+pad(n),identityTuple:{eventKey:key,n},origin:'event',targetBoardKey:n%2?'BOARD-SIDE':'BOARD-MAIN',
      displayLabel:n===0&&i===2?'Synthetic button with a deliberately long label that has to wrap on a narrow phone screen':'Synthetic button '+pad(n),templateButtonKey:null,labelShared:false,
      generation:'gen-'+pad(i)+'-'+pad(n),generationSequence:1,playbackFingerprint:'d'.repeat(64),metadataFingerprint:'b'.repeat(64),manifestState:n===3?'incomplete':'complete',occurrenceCount:n+1}));
  }
  return{events,selections};
}
async function scripted(t,{width=1440,height=1000,refreshCode=null}={}){
  const data=catalog();
  const model={revision:'a'.repeat(64),sequence:7,available:false,statusHidden:false,refreshCode,pageCode:null,hold:null,requests:[]};
  const summary=()=>({scope:'source-catalog-metadata',ready:false,revision:model.revision,feedId:'synthetic-feed',epoch:1,schoolYear:'2026-2027',catalogSequence:model.sequence,eventCount:data.events.length});
  const html=await exphbs.create({extname:'.handlebars'}).render(VIEW,{csrfToken:'c'.repeat(64),sourceMode:true},{layout:false});
  const server=http.createServer(async(req,res)=>{try{
    const url=new URL(req.url,'http://fixture');
    if(url.pathname==='/game-day'){res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'"});res.end(html);return;}
    const assets={'/css/piraiders-game-day.css':['static/css/piraiders-game-day.css','text/css'],'/js/piraiders-game-day.js':['static/js/piraiders-game-day.js','text/javascript']};
    if(assets[url.pathname]){const[file,type]=assets[url.pathname];res.writeHead(200,{'Content-Type':type});res.end(await fs.readFile(path.join(root,file)));return;}
    if(!url.pathname.startsWith('/game-day/api/')){res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');return;}
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    let bytes='';for await(const part of req)bytes+=part;const body=bytes?JSON.parse(bytes):null;
    const route=url.pathname.replace('/game-day/api/','');model.requests.push({method:req.method,route,body,csrf:req.headers['x-piraiders-csrf']});
    const answer=(status,value)=>{res.statusCode=status;res.end(JSON.stringify(value));};
    if(route==='source/status'&&req.method==='GET'){const live=model.available&&!model.statusHidden;
      return answer(200,{ok:true,ready:false,status:{scope:'exchange-source-service',ready:false,catalog:{available:live,code:live?null:'CATALOG_NOT_READ'}},catalog:{available:live,catalog:live?summary():null}});}
    if(route==='source/refresh'&&req.method==='POST'){
      if(model.refreshCode){model.available=false;return answer(model.refreshCode==='BUSY'?409:503,{ok:false,ready:false,code:model.refreshCode});}
      model.available=true;return answer(200,{ok:true,ready:false,catalogSequence:model.sequence,catalog:summary()});}
    if((route==='source/events'||route==='source/selections')&&req.method==='POST'){
      const hold=model.hold;if(hold&&body.eventKey===hold.eventKey){model.hold=null;hold.entered.resolve();await hold.release.promise;}
      if(model.pageCode)return answer(409,{ok:false,ready:false,code:model.pageCode});
      if(!model.available)return answer(409,{ok:false,ready:false,code:'CATALOG_UNAVAILABLE'});
      if(body.revision!==model.revision)return answer(409,{ok:false,ready:false,code:'CATALOG_REVISION_STALE'});
      const rows=route==='source/events'?data.events:data.selections[body.eventKey];
      if(!rows)return answer(404,{ok:false,ready:false,code:'CATALOG_EVENT_MISSING'});
      const page={ok:true,...summary(),offset:body.offset,limit:body.limit,total:rows.length,nextOffset:body.offset+body.limit<rows.length?body.offset+body.limit:null};
      return answer(200,route==='source/events'?{...page,events:rows.slice(body.offset,body.offset+body.limit)}:{...page,eventKey:body.eventKey,selections:rows.slice(body.offset,body.offset+body.limit)});}
    answer(503,{ok:false,code:'SOURCE_PLAYBACK_NOT_READY'});
  }catch{res.statusCode=500;res.end(JSON.stringify({ok:false,code:'FIXTURE_FAILED'}));}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),page=await context.newPage();const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  t.after(async()=>{model.hold?.release.resolve();await context.close();await new Promise(resolve=>server.close(resolve));assert.deepEqual(pageErrors,[]);});
  await page.goto(origin+'/game-day');
  return{page,model,data};
}
// Only the source routes are used: nothing prepares, activates, plays or asks for playback state.
function onlySource(model){
  for(const r of model.requests)assert.match(r.route,/^source\/(status|refresh|events|selections)$/,r.method+' '+r.route);
  for(const r of model.requests.filter(r=>r.method==='POST'))assert.equal(r.csrf,'c'.repeat(64),'every POST carries the page token');
}
const summaryText=page=>page.locator('#source-summary').textContent();

test('source machine: refresh, page through events and board buttons, and review one without approving',async t=>{
  const {page,model}=await scripted(t);
  await page.getByText('School year 2026-2027 · 30 events · catalog 7',{exact:true}).waitFor();
  assert.equal(await page.locator('#source-events > li').count(),25,'first page of events');
  assert.equal(await page.locator('#event-section, .event-section:not(.source-section)').first().isVisible(),false,'the local event list is not shown');
  assert.equal(await page.locator('#active-detail').textContent(),'Playback on this PC needs an approved exchange selection. Approval is not built yet.');
  assert.equal(await page.locator('#stop').isDisabled(),true);assert.equal(await page.locator('#launch').isDisabled(),true);
  await page.getByRole('button',{name:'Show more events'}).click();
  await page.locator('#source-events > li').nth(29).waitFor();assert.equal(await page.locator('#source-events > li').count(),30);
  assert.equal(await page.locator('#source-more-events').isVisible(),false,'no more pages');
  // Keyboard: Tab order reaches an event; Enter opens its board buttons and moves focus there.
  await page.locator('#source-events button').nth(1).focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.activeElement?.id==='source-selections-heading');
  assert.equal(await page.locator('#source-events button').nth(1).getAttribute('aria-pressed'),'true');
  assert.match(await page.locator('#source-event-detail').textContent(),/Synthetic event 02 · 2026-10-02 · Synthetic · Synthetic field · 30 board buttons/);
  assert.equal(await page.locator('#source-selections > li').count(),25);
  await page.getByRole('button',{name:'Show more boards and buttons'}).click();
  await page.locator('#source-selections > li').nth(29).waitFor();
  await page.locator('#source-selections button').nth(3).click();
  await page.waitForFunction(()=>document.activeElement?.id==='source-choice-heading');
  assert.equal(await page.locator('#source-choice-event').textContent(),'Synthetic event 02');
  assert.equal(await page.locator('#source-choice-board').textContent(),'BOARD-SIDE','a board that is not the event board shows its key');
  assert.equal(await page.locator('#source-choice-button').textContent(),'Synthetic button 03');
  assert.equal(await page.locator('#source-choice-pictures').textContent(),'4 pictures · Incomplete');
  await page.locator('#source-selections button').nth(0).click();
  assert.equal(await page.locator('#source-choice-board').textContent(),'Synthetic main board','the event board shows its name');
  assert.match(await page.locator('#source-choice').textContent(),/not built yet\. Nothing is prepared and output is unchanged/);
  await page.screenshot({path:path.join(evidence,'game-day-source-desktop.png'),fullPage:true});
  // A refresh of an unchanged catalog keeps the operator's place.
  await page.getByRole('button',{name:'Refresh from exchange',exact:true}).click();
  await page.getByText('School year 2026-2027 · 30 events · catalog 7',{exact:true}).waitFor();
  assert.equal(await page.locator('#source-choice').isVisible(),true);
  const pages=model.requests.filter(r=>r.route==='source/events'||r.route==='source/selections');
  assert.ok(pages.every(r=>r.body.limit===25&&r.body.revision==='a'.repeat(64)));
  assert.deepEqual(pages.map(r=>[r.route,r.body.offset,r.body.eventKey||null]),[['source/events',0,null],['source/events',25,null],['source/selections',0,'EV-02'],['source/selections',25,'EV-02']]);
  onlySource(model);
});

test('source machine: a changed catalog empties the lists until the operator refreshes',async t=>{
  const {page,model}=await scripted(t);
  await page.getByText('School year 2026-2027 · 30 events · catalog 7',{exact:true}).waitFor();
  await page.locator('#source-events button').nth(1).click();await page.locator('#source-selections > li').nth(24).waitFor();
  // Read in another tab: the status poll sees a different revision.
  model.revision='e'.repeat(64);model.sequence=8;
  await page.getByText('The exchange catalog changed since this list was read. Refresh to see the current events.',{exact:true}).waitFor({timeout:8000});
  assert.equal(await page.locator('#source-events-block').isVisible(),false);assert.equal(await page.locator('#source-event').isVisible(),false);
  assert.equal(await page.locator('#source-choice').isVisible(),false);
  await page.locator('#source-problem-refresh').click();
  await page.getByText('School year 2026-2027 · 30 events · catalog 8',{exact:true}).waitFor();
  assert.equal(await page.locator('#source-problem').isVisible(),false);
  // A page that answers stale (status cannot see the change) does the same.
  model.statusHidden=true;model.revision='f'.repeat(64);
  await page.getByRole('button',{name:'Show more events'}).click();
  await page.getByText('The exchange catalog changed since this list was read. Refresh to see the current events.',{exact:true}).waitFor();
  assert.equal(await page.locator('#source-events-block').isVisible(),false);
  // A busy source keeps the lists.
  model.statusHidden=false;await page.locator('#source-problem-refresh').click();await page.getByText('School year 2026-2027 · 30 events · catalog 8',{exact:true}).waitFor();
  model.pageCode='BUSY';await page.locator('#source-events button').nth(4).click();
  await page.getByText('The exchange folder is being read. Try again in a moment.',{exact:true}).waitFor();
  assert.equal(await page.locator('#source-events > li').count(),25,'lists stay while the source is busy');
  onlySource(model);
});

test('source machine: an unreachable or wrong exchange folder shows no catalog and recovers on refresh',async t=>{
  const {page,model}=await scripted(t,{refreshCode:'SOURCE_UNAVAILABLE'});
  await page.getByText('The exchange folder could not be reached. Check that the synced folder is on this PC, then refresh.',{exact:true}).waitFor();
  assert.equal(await summaryText(page),'No exchange catalog is shown.');assert.equal(await page.locator('#source-events-block').isVisible(),false);
  model.refreshCode='SOURCE_ROOT_MISMATCH';await page.locator('#source-problem-refresh').click();
  await page.getByText('The exchange folder is not the one this PC was set up with. Nothing was read. Check this PC’s setup before refreshing.',{exact:true}).waitFor();
  model.refreshCode=null;await page.locator('#source-problem-refresh').click();
  await page.getByText('School year 2026-2027 · 30 events · catalog 7',{exact:true}).waitFor();
  assert.equal(await page.locator('#source-problem').isVisible(),false);
  assert.equal(await page.getByText('Connected to application',{exact:true}).count(),1);
  onlySource(model);
});

test('source machine: a late answer for an earlier event never replaces the newer event’s buttons',async t=>{
  const {page,model}=await scripted(t);
  await page.getByText('School year 2026-2027 · 30 events · catalog 7',{exact:true}).waitFor();
  const hold={eventKey:'EV-02',entered:deferred(),release:deferred()};model.hold=hold;
  await page.locator('#source-events button').nth(1).click();await hold.entered.promise;
  await page.locator('#source-events button').nth(2).click();
  await page.getByText('Synthetic event 03 · 2026-10-03 · Synthetic · Synthetic field · 1 board button',{exact:true}).waitFor();
  await page.locator('#source-selections > li').first().waitFor();
  const late=page.waitForResponse(r=>r.url().endsWith('/source/selections')&&r.request().postDataJSON()?.eventKey==='EV-02');
  hold.release.resolve();await(await late).finished();
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,200)));
  assert.equal(await page.locator('#source-selections > li').count(),1,'only EV-03’s one button');
  assert.equal(await page.locator('#source-selections button').first().getAttribute('data-selection-id'),'sel-03-00');
  assert.equal(await page.locator('#source-events button').nth(2).getAttribute('aria-pressed'),'true');
  onlySource(model);
});

test('source machine at 390 px: no sideways scrolling, long labels wrap',async t=>{
  const {page,model}=await scripted(t,{width:390,height:844});
  await page.getByText('School year 2026-2027 · 30 events · catalog 7',{exact:true}).waitFor();
  await page.locator('#source-events button').nth(1).click();await page.locator('#source-selections > li').nth(24).waitFor();
  await page.locator('#source-selections button').nth(0).click();
  const widths=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,
    widest:Math.max(...[...document.querySelectorAll('#source-section *')].map(e=>e.getBoundingClientRect().right))}));
  assert.ok(widths.scroll<=widths.client,'no horizontal page scroll: '+JSON.stringify(widths));
  assert.ok(widths.widest<=widths.client,'nothing in the source section is cut off: '+JSON.stringify(widths));
  const target=await page.locator('#source-events button').first().boundingBox();assert.ok(target.height>=44,'touch target');
  await page.screenshot({path:path.join(evidence,'game-day-source-390.png'),fullPage:true});
  onlySource(model);
});

// The real adapter, guard, view and source service, driven by a real browser.
test('source machine end to end: the real web adapter and source service list a published synthetic event',async t=>{
  const {fixture,source,copy}=require('../exchange-provider-fixtures.cjs');
  const {createGameDayWeb}=require('../../scripts/lib/game-day-web.cjs');
  const f=await fixture(t),m=source();await f.publish(m);
  await fs.mkdir(path.join(f.parent,'config'),{recursive:true});await fs.writeFile(path.join(f.parent,'config','spx.json'),'{}');
  const raw={schemaVersion:1,spxConfigFile:'config/spx.json',catalogDirectory:path.join(f.parent,'catalog'),mediaRoot:f.config.sourceRoot,cacheRoot:f.config.cacheDir,runtimeRoot:path.join(f.parent,'runtime'),
    caspar:{executable:path.join(f.parent,'components','casparcg.exe'),cwd:path.join(f.parent,'components')},output:{type:'none'},
    rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}},
    source:{providerId:'approved-feed',journalDirectory:f.config.journalDir,journalStoreId:f.config.storeId,approvalDirectory:path.join(f.parent,'private','approvals'),
      approvalStoreId:crypto.randomUUID(),expectedCanonicalRoot:f.config.sourceRoot,binding:copy(f.config.binding)}};
  const machineFile=path.join(f.parent,'machine-'+crypto.randomUUID()+'.json');await fs.writeFile(machineFile,JSON.stringify(raw));
  const prior=global.config;global.config={general:{username:'',password:''}};
  const app=express();app.engine('handlebars',exphbs.engine({extname:'.handlebars'}));app.set('view engine','handlebars');app.set('views',path.join(root,'views'));
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  const web=createGameDayWeb({port,appRoot:f.parent,machineFile,configFile:path.join(f.parent,'config','spx.json')});
  // As in server.js, the SPX static folder is served beside the Game Day router.
  app.use(express.static(path.join(root,'static')));
  app.use(web.guard);app.use(session({secret:'synthetic-source-browser',resave:false,saveUninitialized:false}));app.use(web.router);
  const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}),page=await context.newPage();const pageErrors=[],answers=[];
  page.on('pageerror',error=>pageErrors.push(error.message));page.on('response',r=>{if(r.url().includes('/game-day/api/'))answers.push(r.text().catch(()=>''));});
  t.after(async()=>{await context.close();await web.close();await new Promise(resolve=>server.close(resolve));global.config=prior;});
  await page.goto('http://127.0.0.1:'+port+'/game-day');
  await page.getByText('School year '+m.schoolYear+' · 1 event · catalog '+m.generationSequence,{exact:true}).waitFor({timeout:20000});
  await page.getByRole('button',{name:new RegExp(m.event.displayName)}).click();
  await page.getByRole('button',{name:new RegExp(m.button.displayLabel)}).click();
  assert.equal(await page.locator('#source-choice-button').textContent(),m.button.displayLabel);
  assert.equal(await page.locator('#source-choice-generation').textContent(),m.generation);
  assert.equal(await page.getByText('Connected to application',{exact:true}).count(),1);
  for(const text of await Promise.all(answers))for(const p of [f.parent,f.config.sourceRoot,f.config.cacheDir,f.config.journalDir])assert.equal(text.includes(p)||text.includes(JSON.stringify(p).slice(1,-1)),false,'no private path reaches the page');
  assert.deepEqual(pageErrors,[]);
});
