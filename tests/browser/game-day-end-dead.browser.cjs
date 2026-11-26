'use strict';
// Q-010: the Game Day page's control for ending a dead event (Q-009's
// POST /game-day/api/end-dead). The scripted server answers state the way
// the manager's publicRecord does; only an active event whose runtime reports
// restartsExhausted (not ready, not preparing) offers it. Every name is synthetic.
const nodeTest=require('node:test'),{before,after}=nodeTest;
const test=(name,fn)=>nodeTest.test(name,{timeout:90000},fn);
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {once}=require('node:events');
const {chromium}=require('playwright');
const exphbs=require('express-handlebars');
const root=path.resolve(__dirname,'../..');
const VIEW=path.join(root,'views','view-game-day.handlebars');
const evidence=process.env.PIRAIDERS_UI_EVIDENCE_DIR?path.resolve(process.env.PIRAIDERS_UI_EVIDENCE_DIR):path.join(root,'build','game-day-ui-browser');
let browser;
before(async()=>{const executablePath=process.env.PIRAIDERS_BROWSER_EXECUTABLE;if(executablePath)assert.ok(path.isAbsolute(executablePath));await fs.mkdir(evidence,{recursive:true});browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});});
after(()=>browser?.close());

const EVENT_ID='synthetic-event-alpha';
function runtime(over={}){return{state:'waiting',ready:false,windowAllowed:true,preparing:false,output:'ndi',slideCount:4,sourceName:'SYNTHETIC OUTPUT',mode:'manual',index:null,restartsExhausted:true,lastError:'SERVICE_FAULT',...over};}
function activeEvent(over={}){const start=new Date(Date.now()-3600000).toISOString(),end=new Date(Date.now()+3600000).toISOString();
  return{eventId:EVENT_ID,displayName:'Synthetic home game',revision:'a'.repeat(64),productionWindow:{start,end,prewarmMinutes:15},cleanup:'open',runtime:runtime(over)};}
function stateWith(active,selection=3){return{state:active?'active':'idle',closed:false,expectedEventId:active?active.eventId:null,expectedSelection:selection,lastError:null,active,candidate:null,operation:null,preparing:false,listing:false,physicalBarrier:false};}

async function scripted(t,{width=1440,height=1000,active=activeEvent()}={}){
  const model={state:stateWith(active),posts:[],endAnswer:null,holdState:0};
  const html=await exphbs.create({extname:'.handlebars'}).render(VIEW,{csrfToken:'c'.repeat(64),sourceMode:false},{layout:false});
  const server=http.createServer(async(req,res)=>{try{
    const url=new URL(req.url,'http://fixture');
    if(url.pathname==='/game-day'){res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'"});res.end(html);return;}
    const assets={'/css/piraiders-game-day.css':['static/css/piraiders-game-day.css','text/css'],'/js/piraiders-game-day.js':['static/js/piraiders-game-day.js','text/javascript']};
    if(assets[url.pathname]){const[file,type]=assets[url.pathname];res.writeHead(200,{'Content-Type':type});res.end(await fs.readFile(path.join(root,file)));return;}
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    const route=url.pathname.replace('/game-day/api/','');const answer=(status,value)=>{res.statusCode=status;res.end(JSON.stringify(value));};
    if(route==='state'&&req.method==='GET'){const value=model.state;if(model.holdState)await new Promise(resolve=>setTimeout(resolve,model.holdState));return answer(200,{ok:true,state:value});}
    if(route==='events'&&req.method==='GET')return answer(200,{ok:true,events:[{eventId:'synthetic-event-beta',displayName:'Synthetic next game',status:'available'}]});
    if(route==='end-dead'&&req.method==='POST'){
      let body='';for await(const chunk of req)body+=chunk;
      model.posts.push({body:JSON.parse(body),csrf:req.headers['x-piraiders-csrf']});
      if(model.endAnswer)return answer(409,model.endAnswer);
      // The state read that follows the end is held, so the page shows its own answer first.
      model.holdState=2500;setTimeout(()=>{model.state=stateWith(null,model.state.expectedSelection+1);model.holdState=0;},2000);
      return answer(200,{ok:true,expectedSelection:model.state.expectedSelection});
    }
    return answer(404,{ok:false,code:'NOT_FOUND'});
  }catch{res.statusCode=500;res.end(JSON.stringify({ok:false,code:'FIXTURE_FAILED'}));}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  t.after(async()=>{await context.close();await new Promise(resolve=>server.close(resolve));assert.deepEqual(errors,[]);});
  await page.goto(origin+'/game-day');
  await page.waitForFunction(()=>document.querySelector('#connection').textContent==='Connected to application');
  return{page,model};
}
const visible=(page,id)=>page.locator('#'+id).isVisible();
const text=(page,id)=>page.locator('#'+id).textContent();
function noAirClaim(value){assert.doesNotMatch(value,/on air|on-air|receiver|board input/i);}

test('a dead event: the page says the renderer stopped restarting and ends it after one confirmation, by keyboard',async t=>{
  const {page,model}=await scripted(t);
  await page.waitForSelector('#dead-event:not([hidden])');
  const said=await text(page,'dead-event-text');
  assert.match(said,/stopped restarting/i);noAirClaim(said);
  assert.match(await text(page,'renderer-status'),/stopped restarting/i);
  noAirClaim(await text(page,'active-detail'));
  // Original controls stay where they were, untouched by this panel.
  for(const id of ['launch','stop','auto','manual','reload-media'])assert.equal(await page.locator('#'+id).count(),1);
  assert.equal(await page.locator('[data-action]').count(),6);
  // One confirmed action: the first press only asks.
  await page.locator('#end-dead').focus();await page.keyboard.press('Enter');
  await page.waitForSelector('#end-dead-confirm:not([hidden])');
  assert.equal(model.posts.length,0,'asking is not ending');
  assert.equal(await visible(page,'end-dead'),false);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'dead-event-text');
  noAirClaim(await text(page,'dead-event-text'));
  await page.screenshot({path:path.join(evidence,'game-day-end-dead-confirm-1440.png'),fullPage:true});
  // Cancel by keyboard: nothing sent, focus back on the button.
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'end-dead-yes');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'end-dead-no');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#end-dead-confirm',{state:'hidden'});
  assert.equal(await page.evaluate(()=>document.activeElement.id),'end-dead');assert.equal(model.posts.length,0);
  // Ask again and confirm.
  await page.keyboard.press('Enter');await page.waitForSelector('#end-dead-confirm:not([hidden])');
  await page.keyboard.press('Tab');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#notice').dataset.tone==='success');
  // Ended: never offered again while the page still holds the older state, and focus goes on to Playback.
  assert.equal(await visible(page,'end-dead'),false,'no End on an ended event');assert.equal(await visible(page,'end-dead-yes'),false);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'playback-heading');
  assert.equal(model.posts.length,1);
  assert.deepEqual(model.posts[0].body,{expectedEventId:EVENT_ID,expectedSelection:3});
  assert.equal(model.posts[0].csrf,'c'.repeat(64));
  const done=await text(page,'notice');assert.match(done,/ended/i);assert.match(done,/black/i);noAirClaim(done);
  // Nothing active afterwards; preparation is offered again.
  await page.waitForFunction(()=>document.querySelector('#active-name').textContent==='Activate a prepared event');
  await page.waitForSelector('#dead-event',{state:'hidden'});
  await page.waitForFunction(()=>!document.querySelector('#prepare').disabled);
  assert.equal(await text(page,'runtime-state'),'No active event');
  await page.screenshot({path:path.join(evidence,'game-day-end-dead-after-1440.png'),fullPage:true});
});

test('offered for a dead event whose earlier close failed (the manager retries it)',async t=>{
  const {page}=await scripted(t,{active:{...activeEvent(),cleanup:'failed'}});
  await page.waitForSelector('#dead-event:not([hidden])');
  assert.equal(await page.locator('#end-dead').isEnabled(),true);
});

test('never offered for a live, acknowledged, restarting, preparing or closing event',async t=>{
  const cases=[
    ['live and acknowledged',activeEvent({state:'ready',ready:true,restartsExhausted:false,lastError:null,index:0})],
    ['restart pending',activeEvent({restartsExhausted:false,preparing:true})],
    ['exhausted but reported ready',activeEvent({state:'ready',ready:true})],
    ['exhausted but preparing',activeEvent({preparing:true})],
    ['closing',{...activeEvent(),cleanup:'closing'}]
  ];
  for(const [name,active] of cases){
    const {page,model}=await scripted(t,{active});
    await page.waitForFunction(()=>document.querySelector('#active-name').textContent==='Synthetic home game');
    await new Promise(resolve=>setTimeout(resolve,1800));
    assert.equal(await visible(page,'dead-event'),false,name);
    assert.doesNotMatch(await text(page,'renderer-status'),/stopped restarting/i,name);
    assert.equal(model.posts.length,0,name);
  }
});

test('390 px: fits the width, keyboard reachable; a refused end keeps the event and says why',async t=>{
  const {page,model}=await scripted(t,{width:390,height:844});
  await page.waitForSelector('#dead-event:not([hidden])');
  model.endAnswer={ok:false,code:'EVENT_NOT_DEAD'};
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no horizontal scroll');
  await page.locator('#end-dead').focus();await page.keyboard.press('Enter');
  await page.waitForSelector('#end-dead-confirm:not([hidden])');
  for(const id of ['end-dead-yes','end-dead-no']){const box=await page.locator('#'+id).boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390,id+' inside 390 px');}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no horizontal scroll while confirming');
  await page.screenshot({path:path.join(evidence,'game-day-end-dead-confirm-390.png'),fullPage:true});
  await page.keyboard.press('Tab');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#notice').dataset.tone==='error');
  assert.equal(model.posts.length,1);
  const said=await text(page,'notice');assert.match(said,/nothing was ended/i);noAirClaim(said);
  assert.equal(await text(page,'active-name'),'Synthetic home game');
  assert.equal(await visible(page,'dead-event'),true);
  assert.equal(await visible(page,'end-dead-confirm'),false);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'end-dead','focus stays on the control after a refusal');
});
