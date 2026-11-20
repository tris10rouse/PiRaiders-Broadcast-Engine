'use strict';
// BE-006 item 4b: the exchange catalog screen on the Game Day page of a source
// machine, in a real browser (items 4c and 4d add approval and playback). A scripted server drives paging, stale and
// unavailable states; a second test runs the real web adapter and the real
// source service on temporary synthetic folders. Every name is synthetic.
const nodeTest=require('node:test'),{before,after}=nodeTest;
// No wait in this file may hang the suite: CI's Linux job once sat 16 minutes
// after test 10 until the job timed out (and the same happened locally). Each
// test has a bound, so its after hooks release held answers and the file ends
// with a named failure; a held answer the page never asks for fails by name.
const TEST_TIMEOUT_MS=120000;
const test=(name,fn)=>nodeTest.test(name,{timeout:TEST_TIMEOUT_MS},fn);
function within(promise,ms,code){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(code)),ms);})]).finally(()=>clearTimeout(timer));}
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
    selections[key]=Array.from({length:i===2?30:1},(_,n)=>({selectionId:'sel-'+pad(i)+'-'+pad(n),identityTuple:['2026-2027',key,n%2?'BOARD-SIDE':'BOARD-MAIN','event','Synthetic button '+pad(n)],origin:'event',targetBoardKey:n%2?'BOARD-SIDE':'BOARD-MAIN',
      displayLabel:n===0&&i===2?'Synthetic button with a deliberately long label that has to wrap on a narrow phone screen':'Synthetic button '+pad(n),templateButtonKey:null,labelShared:false,
      generation:'gen-'+pad(i)+'-'+pad(n),generationSequence:1,playbackFingerprint:'d'.repeat(64),metadataFingerprint:'b'.repeat(64),manifestState:n===3?'incomplete':'complete',occurrenceCount:n+1}));
  }
  return{events,selections};
}
async function scripted(t,{width=1440,height=1000,refreshCode=null}={}){
  const data=catalog();
  const model={revision:'a'.repeat(64),sequence:7,available:false,statusHidden:false,refreshCode,pageCode:null,hold:null,requests:[],
    // Item 4c: review, approve and revoke.
    inspectionRevision:'f'.repeat(64),eligible:true,held:[],approvalRead:true,approvals:new Map(),storeRevision:0,reviewHold:null,timing:true};
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
      const hold=model.hold;if(hold&&body.eventKey===hold.eventKey){model.hold=null;model.held.push(hold);hold.entered.resolve();await hold.release.promise;}
      if(model.pageCode)return answer(409,{ok:false,ready:false,code:model.pageCode});
      if(!model.available)return answer(409,{ok:false,ready:false,code:'CATALOG_UNAVAILABLE'});
      if(body.revision!==model.revision)return answer(409,{ok:false,ready:false,code:'CATALOG_REVISION_STALE'});
      const rows=route==='source/events'?data.events:data.selections[body.eventKey];
      if(!rows)return answer(404,{ok:false,ready:false,code:'CATALOG_EVENT_MISSING'});
      const page={ok:true,...summary(),offset:body.offset,limit:body.limit,total:rows.length,nextOffset:body.offset+body.limit<rows.length?body.offset+body.limit:null};
      return answer(200,route==='source/events'?{...page,events:rows.slice(body.offset,body.offset+body.limit)}:{...page,eventKey:body.eventKey,selections:rows.slice(body.offset,body.offset+body.limit)});}
    if(route==='source/review'&&req.method==='POST'){
      const hold=model.reviewHold;if(hold&&body.identityTuple[4]===hold.label){model.reviewHold=null;model.held.push(hold);hold.entered.resolve();await hold.release.promise;}
      const key=JSON.stringify(body.identityTuple),row=Object.values(data.selections).flat().find(x=>JSON.stringify(x.identityTuple)===key);
      if(!row)return answer(503,{ok:false,ready:false,code:'SOURCE_SELECTION_MISSING'});
      const broadcastWindow=model.timing?{startsAt:'2026-10-23T18:00:00-05:00',endsAt:'2026-10-23T23:45:00-05:00',startSource:'event_type_lead_tail',endSource:'event_type_fixed_end'}:{startsAt:null,endsAt:null,startSource:'missing',endSource:'missing'};
      return answer(200,{ok:true,ready:false,admissionEligible:model.eligible,
        inspection:{ready:false,revision:model.inspectionRevision,selection:{selectionId:row.selectionId,identityTuple:row.identityTuple,displayLabel:row.displayLabel,targetBoardKey:row.targetBoardKey,generation:row.generation,manifestState:row.manifestState,occurrenceCount:row.occurrenceCount},
          event:{eventKey:body.identityTuple[1],displayName:'Synthetic',eventDate:'2026-10-23'},timingProposal:{available:model.timing,broadcastWindow,reviewFlags:model.timing?[]:['INSTANTS_UNAVAILABLE'],operatorConfirmationRequired:true,ready:false},
          sourceTicks:{onBoardAll:false,eventBoardLoaded:false,loadedForYear:null},timeZone:'America/Chicago'},
        approval:model.approvalRead?{read:true,code:null,revision:model.storeRevision,record:model.approvals.get(key)||null}:{read:false,code:'APPROVAL_MISSING',record:null}});}
    if(route==='source/approve'&&req.method==='POST'){
      if(body.inspectionRevision!==model.inspectionRevision)return answer(409,{ok:false,ready:false,code:'APPROVAL_INSPECTION_STALE'});
      const w=body.productionWindow,record={productionWindow:{start:new Date(w.start).toISOString(),end:new Date(w.end).toISOString(),prewarmMinutes:w.prewarmMinutes},current:true,offlinePinned:false};
      model.approvals.set(JSON.stringify(body.identityTuple),record);model.storeRevision++;
      return answer(200,{ok:true,ready:false,changed:true,revision:model.storeRevision,approval:record});}
    if(route==='source/revoke'&&req.method==='POST'){
      const changed=model.approvals.delete(JSON.stringify(body.identityTuple));if(changed)model.storeRevision++;
      return answer(200,{ok:true,ready:false,changed,revision:model.storeRevision,approval:null});}
    // Item 4d: the ordinary playback reads. This PC's approvals are the event list.
    if(route==='state'&&req.method==='GET')return answer(200,{ok:true,state:{expectedEventId:null,expectedSelection:0,active:null,candidate:null,operation:null,preparing:false,physicalBarrier:false,closed:false,lastError:null}});
    if(route==='events'&&req.method==='GET')return answer(200,{ok:true,events:[...model.approvals.keys()].map(key=>{const t=JSON.parse(key);
      return{eventId:'sel-'+crypto.createHash('sha1').update(key).digest('hex'),displayName:[t[4],t[1],t[2]].join(' · '),status:'available'};})});
    answer(503,{ok:false,code:'SOURCE_PLAYBACK_NOT_READY'});
  }catch{res.statusCode=500;res.end(JSON.stringify({ok:false,code:'FIXTURE_FAILED'}));}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',timezoneId:'America/Chicago'}),page=await context.newPage();const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
  // A held answer is released even when a test fails, so the server can close.
  t.after(async()=>{model.hold?.release.resolve();model.reviewHold?.release.resolve();for(const hold of model.held)hold.release.resolve();await context.close();await new Promise(resolve=>server.close(resolve));assert.deepEqual(pageErrors,[]);});
  await page.goto(origin+'/game-day');
  return{page,model,data};
}
// Only the source routes and the two playback reads (state and the approved
// list, item 4d) are used: nothing prepares, activates or plays. Review,
// approve and revoke (item 4c) only where a test lets the operator use them.
function onlySource(model,{approvals=false}={}){
  for(const r of model.requests)if(r.method==='GET'&&(r.route==='state'||r.route==='events'))continue;
  else assert.match(r.route,approvals?/^source\/(status|refresh|events|selections|review|approve|revoke)$/:/^source\/(status|refresh|events|selections)$/,r.method+' '+r.route);
  for(const r of model.requests.filter(r=>r.method==='POST'))assert.equal(r.csrf,'c'.repeat(64),'every POST carries the page token');
}
const summaryText=page=>page.locator('#source-summary').textContent();

test('source machine: refresh, page through events and board buttons, and review one without approving',async t=>{
  const {page,model}=await scripted(t);
  await page.getByText('School year 2026-2027 · 30 events · catalog 7',{exact:true}).waitFor();
  assert.equal(await page.locator('#source-events > li').count(),25,'first page of events');
  assert.equal(await page.locator('#events-heading').textContent(),'Approved board buttons','the approved list replaces the local event list');
  await page.getByText('No board button is approved on this PC yet. Approve one under Exchange events.',{exact:true}).waitFor();
  assert.equal(await page.locator('#prepare').textContent(),'Prepare selected button');assert.equal(await page.locator('#prepare').isDisabled(),true);
  assert.equal(await page.locator('#active-detail').textContent(),'Prepare an approved board button to begin.');
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
  assert.match(await page.locator('#source-check-note').textContent(),/Approving prepares and plays nothing; output is unchanged/);
  assert.equal(await page.locator('#source-review').isVisible(),false,'nothing is checked until the operator asks');
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
  await page.locator('#source-events button').nth(1).click();await within(hold.entered.promise,15000,'HELD_SELECTIONS_NOT_ASKED');
  await page.locator('#source-events button').nth(2).click();
  await page.getByText('Synthetic event 03 · 2026-10-03 · Synthetic · Synthetic field · 1 board button',{exact:true}).waitFor();
  await page.locator('#source-selections > li').first().waitFor();
  const late=page.waitForResponse(r=>r.url().endsWith('/source/selections')&&r.request().postDataJSON()?.eventKey==='EV-02');
  hold.release.resolve();await within((await late).finished(),15000,"HELD_ANSWER_NOT_FINISHED");
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

// Item 4c: review one button, approve it for a confirmed window and revoke it.
async function chooseFirstButton(page){
  await page.getByText('School year 2026-2027 · 30 events · catalog 7',{exact:true}).waitFor();
  await page.locator('#source-events button').nth(1).click();await page.locator('#source-selections > li').nth(24).waitFor();
  await page.locator('#source-selections button').nth(0).click();
}
test('source machine: check a button, confirm a production window, then revoke the approval',async t=>{
  const {page,model}=await scripted(t);
  await chooseFirstButton(page);
  await page.getByRole('button',{name:'Check this button'}).click();
  await page.waitForFunction(()=>document.activeElement?.id==='source-review-heading');
  assert.equal(await page.locator('#source-review-version').textContent(),'gen-02-00');
  assert.equal(await page.locator('#source-review-times').textContent(),'Fri, Oct 23, 2026, 6:00 PM to Fri, Oct 23, 2026, 11:45 PM Central time');
  assert.equal(await page.locator('#source-review-approval').textContent(),'Not approved on this PC');
  assert.equal(await page.locator('#source-window-start').inputValue(),'2026-10-23T18:00','the scheduler’s window is offered');
  assert.equal(await page.locator('#source-window-end').inputValue(),'2026-10-23T23:45');
  assert.equal(await page.locator('#source-window-prewarm').inputValue(),'15');
  assert.equal(await page.locator('#source-revoke').isVisible(),false,'nothing to revoke');
  // A backwards window is refused on the page; nothing is sent.
  await page.locator('#source-window-end').fill('2026-10-23T17:00');
  await page.getByRole('button',{name:'Approve for this window…'}).click();
  await page.getByText('The end must be after the start, and the window at most 24 hours long.',{exact:true}).waitFor();
  assert.equal(await page.locator('#source-window-end').getAttribute('aria-invalid'),'true');
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'source-window-end');
  await page.locator('#source-window-end').fill('2026-10-23T23:45');await page.locator('#source-window-prewarm').fill('75');
  await page.getByRole('button',{name:'Approve for this window…'}).click();
  await page.getByText('Enter a warm-up of 0 to 60 whole minutes.',{exact:true}).waitFor();
  await page.locator('#source-window-prewarm').fill('20');
  // Confirm step: cancel sends nothing and returns focus.
  await page.getByRole('button',{name:'Approve for this window…'}).click();
  await page.waitForFunction(()=>document.activeElement?.id==='source-confirm-text');
  const ask=await page.locator('#source-confirm-text').textContent();
  assert.match(ask,/^Approve “Synthetic button with a deliberately long label that has to wrap on a narrow phone screen” on Synthetic main board for Synthetic event 02: Fri, Oct 23, 2026, 6:00 PM to Fri, Oct 23, 2026, 11:45 PM Central time, warm-up 20 minutes\. /);
  assert.equal(await page.locator('#source-approve').isDisabled(),true,'one decision at a time');
  await page.getByRole('button',{name:'Cancel'}).click();
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'source-approve');
  assert.equal(model.requests.filter(r=>r.route==='source/approve').length,0,'cancel sends nothing');
  await page.getByRole('button',{name:'Approve for this window…'}).click();
  await page.screenshot({path:path.join(evidence,'game-day-source-confirm.png'),fullPage:true});
  await page.getByRole('button',{name:'Confirm approval'}).click();
  await page.getByText('Approved for this PC. Prepare it under Approved board buttons.',{exact:true}).waitFor();
  const sent=model.requests.filter(r=>r.route==='source/approve');
  assert.deepEqual(sent.map(r=>r.body),[{identityTuple:['2026-2027','EV-02','BOARD-MAIN','event','Synthetic button 00'],inspectionRevision:'f'.repeat(64),
    productionWindow:{start:'2026-10-23T23:00:00.000Z',end:'2026-10-24T04:45:00.000Z',prewarmMinutes:20}}],'the confirmed window, in UTC, with the checked revision');
  assert.equal(await page.locator('#source-review-approval').textContent(),'Approved for Fri, Oct 23, 2026, 6:00 PM to Fri, Oct 23, 2026, 11:45 PM Central time, warm-up 20 minutes');
  assert.equal(await page.locator('#stop').isDisabled(),true,'playback controls are untouched');
  // Item 4d: the approval is now in this PC's approved list and can be prepared.
  await page.locator('#event-select option',{hasText:'Synthetic button 00 · EV-02 · BOARD-MAIN'}).waitFor({state:'attached'});
  await page.getByText('Preparing reads the exchange pictures; it does not change active output.',{exact:true}).waitFor();
  assert.equal(await page.locator('#prepare').isDisabled(),false);
  // Revoke, with its own confirmation.
  await page.getByRole('button',{name:'Revoke approval…'}).click();
  assert.match(await page.locator('#source-confirm-text').textContent(),/^Revoke the approval for “Synthetic button with a deliberately long label/);
  await page.locator('#source-confirm-yes').click();
  await page.getByText('Approval revoked on this PC. A prepared copy can no longer be activated.',{exact:true}).waitFor();
  assert.equal(await page.locator('#source-review-approval').textContent(),'Not approved on this PC');
  assert.equal(await page.locator('#source-revoke').isVisible(),false);
  await page.locator('#event-select option',{hasText:'No approved board buttons'}).waitFor({state:'attached'});
  assert.equal(await page.locator('#prepare').isDisabled(),true,'a revoked button leaves the approved list');
  // The scheduler changed the button after the check: nothing is saved and a new check is needed.
  model.inspectionRevision='e'.repeat(64);
  await page.getByRole('button',{name:'Approve for this window…'}).click();await page.getByRole('button',{name:'Confirm approval'}).click();
  await page.getByText('The scheduler changed this button since it was checked. Nothing was saved. Check it again before approving.',{exact:true}).waitFor();
  assert.equal(await page.locator('#source-window').isVisible(),false,'the old review cannot be approved again');
  assert.equal(await page.locator('#source-check').textContent(),'Check this button');
  assert.equal(model.approvals.size,0);
  onlySource(model,{approvals:true});
  assert.ok(!model.requests.some(r=>/^(command|prepare|activate|discard)$/.test(r.route)),'nothing prepared or played');
});

test('source machine: a late review never lands on another button, and an unset approval list blocks approving',async t=>{
  const {page,model}=await scripted(t);
  await chooseFirstButton(page);
  const hold={label:'Synthetic button 00',entered:deferred(),release:deferred()};model.reviewHold=hold;
  await page.getByRole('button',{name:'Check this button'}).click();await within(hold.entered.promise,15000,'HELD_REVIEW_NOT_ASKED');
  assert.equal(await page.locator('#source-check').textContent(),'Checking…');
  await page.locator('#source-selections button').nth(1).click();
  assert.equal(await page.locator('#source-check').textContent(),'Check this button','a new choice starts unchecked');
  // The second button is checked while the first button's answer is still held.
  await page.getByRole('button',{name:'Check this button'}).click();
  await page.locator('#source-review-version').getByText('gen-02-01',{exact:true}).waitFor();
  await page.locator('#source-window-prewarm').fill('30');
  const late=page.waitForResponse(r=>r.url().endsWith('/source/review')&&r.request().postDataJSON()?.identityTuple?.[4]==='Synthetic button 00');
  hold.release.resolve();await within((await late).finished(),15000,"HELD_ANSWER_NOT_FINISHED");
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,200)));
  assert.equal(await page.locator('#source-review-version').textContent(),'gen-02-01','the first button’s late review is dropped');
  assert.equal(await page.locator('#source-window-prewarm').inputValue(),'30','and does not reset the form');
  assert.equal(await page.locator('#source-choice-button').textContent(),'Synthetic button 01');
  // No approval list on this PC: the review shows it and offers no approval.
  model.approvalRead=false;model.timing=false;
  await page.getByRole('button',{name:'Check again'}).click();
  await page.getByText('Approvals are not set up on this PC yet',{exact:true}).waitFor();
  assert.equal(await page.locator('#source-window').isVisible(),false);assert.equal(await page.locator('#source-revoke').isVisible(),false);
  assert.equal(await page.locator('#source-review-times').textContent(),'Not given by the scheduler');
  assert.equal(await page.locator('#source-review-flags').textContent(),'Some scheduler times are missing: enter the window yourself.');
  // An ineligible event can be reviewed, not approved.
  model.approvalRead=true;model.eligible=false;
  await page.getByRole('button',{name:'Check again'}).click();
  await page.getByText(/^The scheduler marks this event as not eligible, so it cannot be approved\./).waitFor();
  assert.equal(await page.locator('#source-window').isVisible(),false);
  // A changed catalog withdraws the review with the lists.
  model.eligible=true;await page.getByRole('button',{name:'Check again'}).click();await page.locator('#source-window').waitFor();
  model.revision='b'.repeat(64);
  await page.getByText('The exchange catalog changed since this list was read. Refresh to see the current events.',{exact:true}).waitFor({timeout:10000});
  assert.equal(await page.locator('#source-review').isVisible(),false);assert.equal(await page.locator('#source-choice').isVisible(),false);
  assert.equal(model.requests.filter(r=>r.route==='source/approve'||r.route==='source/revoke').length,0);
  onlySource(model,{approvals:true});
});

test('source machine at 390 px: the approval review and confirmation fit without sideways scrolling',async t=>{
  const {page,model}=await scripted(t,{width:390,height:844});
  await chooseFirstButton(page);
  await page.getByRole('button',{name:'Check this button'}).click();await page.locator('#source-window').waitFor();
  await page.getByRole('button',{name:'Approve for this window…'}).click();await page.locator('#source-confirm').waitFor();
  const widths=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,
    widest:Math.max(...[...document.querySelectorAll('#source-section *')].map(e=>e.getBoundingClientRect().right))}));
  assert.ok(widths.scroll<=widths.client,'no horizontal page scroll: '+JSON.stringify(widths));
  assert.ok(widths.widest<=widths.client,'nothing in the source section is cut off: '+JSON.stringify(widths));
  for(const id of ['#source-window-start','#source-confirm-yes','#source-confirm-no'])assert.ok((await page.locator(id).boundingBox()).height>=42,'touch target '+id);
  await page.screenshot({path:path.join(evidence,'game-day-source-confirm-390.png'),fullPage:true});
  onlySource(model,{approvals:true});
});

// Item 4d part 2: the whole source flow through the real adapter, the real
// source service and approval store, with a trusted synthetic runtime (no
// Caspar here): approve, prepare, revoke while prepared (activation refused),
// approve again, prepare, activate, play and stop. Desktop and 390 px.
async function realSourcePlayback(t,{width,height}){
  const {fixture,source,copy}=require('../exchange-provider-fixtures.cjs');
  const {createGameDayWeb}=require('../../scripts/lib/game-day-web.cjs');
  const {createExchangeApprovalStore}=require('../../scripts/lib/exchange-approval-store.cjs');
  const f=await fixture(t),m=source();await f.publish(m);
  await fs.mkdir(path.join(f.parent,'config'),{recursive:true});await fs.writeFile(path.join(f.parent,'config','spx.json'),'{}');
  const raw={schemaVersion:1,spxConfigFile:'config/spx.json',catalogDirectory:path.join(f.parent,'catalog'),mediaRoot:f.config.sourceRoot,cacheRoot:f.config.cacheDir,runtimeRoot:path.join(f.parent,'runtime'),
    caspar:{executable:path.join(f.parent,'components','casparcg.exe'),cwd:path.join(f.parent,'components')},output:{type:'none'},
    rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}},
    source:{providerId:'approved-feed',journalDirectory:f.config.journalDir,journalStoreId:f.config.storeId,approvalDirectory:path.join(f.parent,'private','approvals'),
      approvalStoreId:crypto.randomUUID(),expectedCanonicalRoot:f.config.sourceRoot,binding:copy(f.config.binding)}};
  const machineFile=path.join(f.parent,'machine-'+crypto.randomUUID()+'.json');await fs.writeFile(machineFile,JSON.stringify(raw));
  // Setting up the approval list is a setup step, never a screen action.
  await fs.mkdir(path.dirname(raw.source.approvalDirectory),{recursive:true});
  assert.equal((await createExchangeApprovalStore().initialize(raw.source.approvalDirectory,raw.source.approvalStoreId)).ok,true);
  const seen={actions:[],closes:0,starts:0};
  const runtimeFactory=async(profile,options)=>{
    await options.preparedMedia.initial({privateRoots:options.privateRoots});
    let state='prepared',index=null;
    return{candidateAdmissionToken:()=>options.preparedMedia.admissionToken(),start:async()=>{seen.starts++;state='ready';},close:async()=>{seen.closes++;state='closed';options.preparedMedia.close();},
      snapshot:()=>({preparing:false,state,ready:state==='ready',windowAllowed:false,index,slideCount:1,mode:'manual',output:'none'}),
      dispatch:async action=>{seen.actions.push(action);if(action==='launch')index=0;return{ok:true};}};
  };
  const prior=global.config;global.config={general:{username:'',password:''}};
  const app=express();app.engine('handlebars',exphbs.engine({extname:'.handlebars'}));app.set('view engine','handlebars');app.set('views',path.join(root,'views'));
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  const web=createGameDayWeb({port,appRoot:f.parent,machineFile,configFile:path.join(f.parent,'config','spx.json'),runtimeFactory});
  app.use(express.static(path.join(root,'static')));
  app.use(web.guard);app.use(session({secret:'synthetic-source-playback',resave:false,saveUninitialized:false}));app.use(web.router);
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',timezoneId:'America/Chicago'}),page=await context.newPage();const pageErrors=[],answers=[],posts=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('response',r=>{if(r.url().includes('/game-day/api/')){answers.push(r.text().catch(()=>''));if(r.request().method()==='POST')posts.push(r.url().replace(/^.*\/game-day\/api\//,''));}});
  t.after(async()=>{await context.close();await web.close();await new Promise(resolve=>server.close(resolve));global.config=prior;});
  const fits=async label=>{const w=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,
    widest:Math.max(...[...document.querySelectorAll('main *')].filter(e=>e.getClientRects().length&&!e.closest('[hidden]')&&getComputedStyle(e).position!=='fixed').map(e=>e.getBoundingClientRect().right))}));
    assert.ok(w.scroll<=w.client&&w.widest<=w.client+0.5,label+': no sideways scrolling '+JSON.stringify(w));};
  await page.goto('http://127.0.0.1:'+port+'/game-day');
  await page.getByText('School year '+m.schoolYear+' · 1 event · catalog '+m.generationSequence,{exact:true}).waitFor({timeout:20000});
  await page.getByText('No board button is approved on this PC yet. Approve one under Exchange events.',{exact:true}).waitFor();
  assert.equal(await page.getByText('Connected to application',{exact:true}).count(),1);
  if(width>620){
    // Desktop: the exchange catalog above the approved list, playback beside both.
    const [catalogBox,approvedBox,playbackBox]=await Promise.all(['#source-section','#prepare-section','.playback-section'].map(s=>page.locator(s).boundingBox()));
    assert.ok(approvedBox.y>=catalogBox.y+catalogBox.height-1&&Math.abs(approvedBox.x-catalogBox.x)<1,'approved list under the catalog');
    assert.ok(playbackBox.x>=catalogBox.x+catalogBox.width-1&&Math.abs(playbackBox.y-catalogBox.y)<1,'playback beside them');
  }
  const approve=async()=>{
    await page.getByRole('button',{name:'Check this button'}).or(page.getByRole('button',{name:'Check again'})).click();
    await page.locator('#source-window').waitFor();
    await page.locator('#source-window-start').fill('2026-10-23T18:00');await page.locator('#source-window-end').fill('2026-10-23T23:45');
    await page.getByRole('button',{name:'Approve for this window…'}).click();await page.getByRole('button',{name:'Confirm approval'}).click();
    await page.getByText('Approved for this PC. Prepare it under Approved board buttons.',{exact:true}).waitFor();
    await page.getByText('Preparing reads the exchange pictures; it does not change active output.',{exact:true}).waitFor();
  };
  await page.getByRole('button',{name:new RegExp(m.event.displayName)}).click();
  await page.getByRole('button',{name:new RegExp(m.button.displayLabel)}).click();
  await approve();
  const option=await page.locator('#event-select option:checked').textContent();
  assert.ok(option.startsWith(m.button.displayLabel+' · '),'the approved button is listed by its label: '+option);
  await page.getByRole('button',{name:'Prepare selected button'}).click();
  await page.getByText('Pictures prepared. Review the button, then activate it.',{exact:true}).waitFor({timeout:20000});
  await page.waitForFunction(()=>document.activeElement?.id==='candidate-heading');
  assert.equal(await page.locator('#candidate-status').textContent(),'Pictures prepared on this PC. Not activated.');
  assert.equal(await page.locator('#activate').isDisabled(),false);
  await fits('prepared');
  await page.screenshot({path:path.join(evidence,'game-day-source-prepared-'+width+'.png'),fullPage:true});
  // Revoke while prepared: the list empties and activation is refused; nothing starts.
  await page.getByRole('button',{name:'Revoke approval…'}).click();await page.locator('#source-confirm-yes').click();
  await page.getByText('Approval revoked on this PC. A prepared copy can no longer be activated.',{exact:true}).waitFor();
  await page.locator('#event-select option',{hasText:'No approved board buttons'}).waitFor({state:'attached'});
  assert.equal(await page.locator('#prepare').isDisabled(),true);
  await page.getByRole('button',{name:'Activate event'}).click();
  await page.locator('#notice[data-tone=error]').waitFor();
  const refusal=await page.locator('#notice').textContent();
  assert.equal(refusal,'This PC no longer accepts that button: its approval was revoked or changed. Nothing new was started. Approve it again under Exchange events, then prepare it again.','activation refused in plain words');
  assert.equal(seen.starts,0,'nothing started after the revocation');
  assert.equal(await page.locator('#launch').isDisabled(),true);
  await fits('refused');
  await page.screenshot({path:path.join(evidence,'game-day-source-revoked-'+width+'.png'),fullPage:true});
  // Approve again, discard the old preparation, prepare again, activate, play and stop.
  await approve();
  if(await page.locator('#candidate').isVisible()){await page.getByRole('button',{name:'Discard'}).click();await page.getByText('Prepared event discarded.',{exact:true}).waitFor();}
  await page.getByRole('button',{name:'Prepare selected button'}).click();
  await page.getByText('Pictures prepared. Review the button, then activate it.',{exact:true}).waitFor({timeout:20000});
  await page.getByRole('button',{name:'Activate event'}).click();
  await page.getByText('Event activated. Launch starts at slide 1.',{exact:true}).waitFor({timeout:20000});
  await page.locator('#launch:not([disabled])').waitFor();
  await page.locator('#launch').click();await page.getByText('Launch acknowledged.',{exact:true}).waitFor();
  await page.locator('#stop').click();await page.getByText('Black output acknowledged. The sender remains governed by its production window.',{exact:true}).waitFor();
  assert.deepEqual(seen.actions,['launch','stop']);assert.equal(seen.starts,1);
  assert.ok(posts.every(route=>/^(source\/(refresh|events|selections|review|approve|revoke)|prepare|activate|discard|command)$/.test(route)),'only the ordinary and source routes: '+posts.join(','));
  await fits('playing');
  await page.screenshot({path:path.join(evidence,'game-day-source-playing-'+width+'.png'),fullPage:true});
  for(const text of await Promise.all(answers))for(const p of [f.parent,f.config.sourceRoot,f.config.cacheDir,f.config.journalDir])assert.equal(text.includes(p)||text.includes(JSON.stringify(p).slice(1,-1)),false,'no private path reaches the page');
  assert.deepEqual(pageErrors,[]);
}
test('source machine end to end: approve, prepare, revoke while prepared, then approve again and play (desktop)',t=>realSourcePlayback(t,{width:1280,height:900}));
test('source machine end to end at 390 px: the same flow fits without sideways scrolling',t=>realSourcePlayback(t,{width:390,height:844}));
test('a held answer the page never asks for fails by name instead of hanging the suite',async()=>{
  const started=Date.now();await assert.rejects(within(new Promise(()=>{}),50,'HELD_REVIEW_NOT_ASKED'),/^Error: HELD_REVIEW_NOT_ASKED$/);
  assert.ok(Date.now()-started<5000);assert.equal(await within(Promise.resolve('asked'),50,'UNUSED'),'asked');
});
