'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {once}=require('node:events');
const {chromium}=require('playwright');
let browser;
const root=path.resolve(__dirname,'../..');
const evidence=process.env.PIRAIDERS_UI_EVIDENCE_DIR?path.resolve(process.env.PIRAIDERS_UI_EVIDENCE_DIR):path.join(root,'build','game-day-ui-browser');
before(async()=>{const executablePath=process.env.PIRAIDERS_BROWSER_EXECUTABLE;if(executablePath)assert.ok(path.isAbsolute(executablePath));await fs.mkdir(evidence,{recursive:true});browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});});
after(()=>browser?.close());
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}
function record(id='football',ready=true){return{eventId:id,displayName:id==='football'?'Football · Home game':'Band showcase',revision:'a'.repeat(64),productionWindow:{start:new Date(Date.now()-60000).toISOString(),end:new Date(Date.now()+3600000).toISOString(),prewarmMinutes:15},cleanup:'open',runtime:{state:ready?'ready':'waiting',ready,windowAllowed:ready,preparing:false,output:'ndi',sourceName:'PiRaiders Stadium Graphics',slideCount:3,mode:'manual',index:null,lastError:null}};}
function initial(){return{state:'active',closed:false,expectedEventId:'football',expectedSelection:1,lastError:null,active:record(),candidate:null,operation:null,preparing:false,listing:false,physicalBarrier:false,retired:0,receiverVerified:false,boardVerified:false};}
async function fixture(t,{empty=false}={}){
 const model={state:initial(),events:empty?[]:[{eventId:'football',displayName:'Football · Home game',status:'available'},{eventId:'band',displayName:'Band showcase',status:'available'}],requests:[],getError:0,catalogError:0,holdState:null,holdAction:null,stateRequests:0,inFlightGets:0,maxGets:0,actionResult:null,actionStatus:200};
 const html=(await fs.readFile(path.join(root,'views/view-game-day.handlebars'),'utf8')).replace('{{csrfToken}}','fixture-csrf-token');
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname==='/game-day'){res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'"});res.end(html);return;}
  const assets={'/css/piraiders-game-day.css':['static/css/piraiders-game-day.css','text/css'],'/js/piraiders-game-day.js':['static/js/piraiders-game-day.js','text/javascript']};
  if(assets[url.pathname]){const[file,type]=assets[url.pathname];res.writeHead(200,{'Content-Type':type});res.end(await fs.readFile(path.join(root,file)));return;}
  if(!url.pathname.startsWith('/game-day/api/')){res.writeHead(200,{'Content-Type':'text/plain'});res.end('Existing SPX route fixture');return;}
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  const route=url.pathname.slice('/game-day/api/'.length);
  if(req.method==='GET'&&route==='state'){
   model.stateRequests++;model.inFlightGets++;model.maxGets=Math.max(model.maxGets,model.inFlightGets);
   const hold=model.holdState;model.holdState=null;const captured=structuredClone(model.state);if(hold){hold.entered.resolve();await hold.release.promise;}
   model.inFlightGets--;if(model.getError){res.writeHead(model.getError);res.end(JSON.stringify({ok:false,code:model.getError===401?'AUTH_REQUIRED':'UNAVAILABLE'}));return;}
   res.end(JSON.stringify({ok:true,state:captured}));return;
  }
  if(req.method==='GET'&&route==='events'){if(model.catalogError){res.writeHead(503);res.end(JSON.stringify({ok:false,code:'CATALOG_INVALID'}));return;}res.end(JSON.stringify({ok:true,events:model.events}));return;}
  let bytes='';for await(const part of req)bytes+=part;const body=JSON.parse(bytes);model.requests.push({route,body,csrf:req.headers['x-piraiders-csrf']});
  const hold=model.holdAction;if(hold&&body.action===hold.action){hold.entered.resolve();await hold.release.promise;}
  if(model.actionResult){res.statusCode=model.actionStatus;res.end(JSON.stringify(model.actionResult));return;}
  if(route==='prepare')model.state.candidate={...record(body.eventId,false),candidateId:'b'.repeat(48)};
  if(route==='activate'){model.state.active=model.state.candidate;delete model.state.active.candidateId;model.state.candidate=null;model.state.expectedEventId=model.state.active.eventId;model.state.expectedSelection++;}
  if(route==='discard')model.state.candidate=null;
  if(route==='command'&&model.state.active){const r=model.state.active.runtime;if(body.action==='launch')r.index=0;if(body.action==='next')r.index=(r.index+1)%3;if(body.action==='previous')r.index=(r.index+2)%3;if(body.action==='auto')r.mode='auto';if(body.action==='manual')r.mode='manual';if(body.action==='stop')r.index=null;}
  res.end(JSON.stringify({ok:true}));
 }catch{res.statusCode=500;res.end(JSON.stringify({ok:false,code:'FIXTURE_FAILED'}));}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
 t.after(async()=>{model.holdAction?.release.resolve();model.holdState?.release.resolve();await context.close();await new Promise(resolve=>server.close(resolve));assert.deepEqual(pageErrors,[]);});
 await page.goto(origin+'/game-day');await page.getByText('Connected to application',{exact:true}).waitFor();await page.locator('#refresh-events:not([disabled])').waitFor();
 return{page,model,origin,async refresh(){await page.locator('#retry').evaluate(button=>button.click());await page.getByText('Connected to application',{exact:true}).waitFor();}};
}

test('real browser displays honest readiness, stable event selection, native keyboard focus and protected changes',async t=>{
 const f=await fixture(t),{page,model}=f;
 await page.locator('#event-select').selectOption('band');await wait(1700);assert.equal(await page.locator('#event-select').inputValue(),'band');
 assert.equal(await page.locator('#prepare').isDisabled(),true);assert.equal(await page.locator('#protection').isVisible(),true);assert.equal(await page.locator('#launch').isEnabled(),true);
 assert.equal(await page.locator('#renderer-status').textContent(),'Acknowledged and ready');assert.match(await page.locator('#output-status').textContent(),/NDI configured/);assert.equal(await page.getByText('Unverified',{exact:true}).count(),1);
 assert.equal(await page.locator('iframe,canvas,video').count(),0);assert.equal(await page.locator('a[href="/shows"]').count(),2);
 await page.locator('#launch').focus();await page.keyboard.press('Enter');await page.getByText('Launch acknowledged.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByText('Next slide acknowledged.',{exact:true}).waitFor();
 assert.deepEqual(model.requests.map(r=>r.body.action),['launch','next']);assert.ok(model.requests.every(r=>r.csrf==='fixture-csrf-token'&&r.body.expectedEventId==='football'&&r.body.expectedSelection===1));
 await page.locator('#reload-media').focus();await page.keyboard.press('Tab');assert.equal(await page.locator('#stop').evaluate(el=>el===document.activeElement),true);assert.notEqual(await page.locator('#stop').evaluate(el=>getComputedStyle(el).outlineStyle),'none');assert.equal(model.maxGets,1);
});

test('preparation and activation use the selected catalog event and show empty/invalid/recoverable catalog states',async t=>{
 const f=await fixture(t,{empty:true}),{page,model}=f;assert.equal(await page.locator('#prepare').isDisabled(),true);assert.match(await page.locator('#catalog-note').textContent(),/Add a valid local event/);
 model.events=[{eventId:'broken',displayName:'Unavailable event',status:'invalid',code:'CATALOG_INVALID'},{eventId:'band',displayName:'Band showcase',status:'available'}];model.state.active=null;model.state.expectedEventId=null;model.state.expectedSelection=0;model.state.state='idle';await f.refresh();
 await page.locator('#refresh-events').click();await page.locator('#event-select').selectOption('band');await page.locator('#prepare').click();await page.getByText('Media prepared. Review the event, then activate it.',{exact:true}).waitFor();await page.locator('#candidate').waitFor();
 assert.equal(await page.locator('#candidate-name').textContent(),'Band showcase');assert.match(await page.locator('#catalog-note').textContent(),/1 event needs attention/);
 await page.locator('#activate').click();await page.getByText('Event activated. Launch starts at slide 1.',{exact:true}).waitFor();await page.getByRole('heading',{name:'Band showcase',exact:true}).waitFor();assert.equal(model.requests[0].body.eventId,'band');assert.equal(model.requests[1].body.candidateId,'b'.repeat(48));
 model.catalogError=1;await page.locator('#refresh-events').click();await page.getByText('The event list could not be read. Check local configuration, then refresh the list.',{exact:true}).waitFor();assert.equal(await page.locator('#prepare').isDisabled(),true);
});

test('Stop bypasses a pending Reload and its newer notice survives the older response',async t=>{
 const {page,model}=await fixture(t);model.holdAction={action:'reload',entered:deferred(),release:deferred()};
 await page.locator('#reload-media').click();await model.holdAction.entered.promise;assert.equal(await page.locator('#launch').isDisabled(),true);assert.equal(await page.locator('#stop').isEnabled(),true);
 await page.locator('#stop').click();await page.getByText('Black output acknowledged. The sender remains governed by its production window.',{exact:true}).waitFor();assert.deepEqual(model.requests.map(r=>r.body.action),['reload','stop']);
 model.holdAction.release.resolve();await wait(100);assert.match(await page.locator('#notice').textContent(),/^Black output acknowledged/);assert.equal(await page.locator('#stop').isEnabled(),true);
});

test('polling never applies a held pre-command response over newer state and never overlaps GET state',async t=>{
 const {page,model}=await fixture(t);const hold={entered:deferred(),release:deferred()};model.holdState=hold;await hold.entered.promise;
 await page.locator('#launch').click();await page.getByText('Launch acknowledged.',{exact:true}).waitFor();hold.release.resolve();
 await page.waitForFunction(()=>document.getElementById('slide-position').textContent.startsWith('Slide 1'));assert.equal(model.maxGets,1);await wait(100);assert.match(await page.locator('#slide-position').textContent(),/^Slide 1/);
});

test('stale commands, disconnect and authorization failure show actionable fixed messages with retained state',async t=>{
 const f=await fixture(t),{page,model}=f;model.actionResult={ok:false,code:'STALE_SELECTION'};await page.locator('#launch').click();await page.getByText('The active event changed. Status is being refreshed; review it before trying again.',{exact:true}).waitFor();
 model.getError=503;await page.locator('#retry').evaluate(button=>button.click());await page.getByText('Application connection lost',{exact:true}).waitFor();assert.equal(await page.locator('#active-name').textContent(),'Football · Home game');assert.equal(await page.locator('#launch').isDisabled(),true);assert.equal(await page.locator('#stop').isEnabled(),true);
 model.getError=401;await page.locator('#retry').click();await page.getByText('Sign-in required',{exact:true}).waitFor();assert.equal(await page.locator('#sign-in').isVisible(),true);assert.equal(await page.locator('#stop').isDisabled(),true);
 model.getError=0;model.actionResult=null;await page.locator('#reload-page').click();await page.getByText('Connected to application',{exact:true}).waitFor();assert.equal(await page.locator('#launch').isEnabled(),true);
});

test('held Stop excludes every normal mutation and coalesces duplicate Stop without changing its intent',async t=>{
 const {page,model}=await fixture(t);model.holdAction={action:'stop',entered:deferred(),release:deferred()};
 await page.locator('#stop').click();await model.holdAction.entered.promise;
 assert.equal(await page.locator('#launch').isDisabled(),true);assert.equal(await page.locator('#reload-media').isDisabled(),true);assert.equal(await page.locator('#stop').isEnabled(),true);
 await page.locator('#launch').evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));
 await page.locator('#stop').evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));
 assert.deepEqual(model.requests.map(row=>row.body.action),['stop']);assert.equal(await page.locator('#notice').textContent(),'Requesting black output…');
 model.holdAction.release.resolve();await page.getByText('Black output acknowledged. The sender remains governed by its production window.',{exact:true}).waitFor();
 await page.locator('#launch:not([disabled])').waitFor();assert.deepEqual(model.requests.map(row=>row.body.action),['stop']);
});

test('403 failure JSON distinguishes CSRF reload, authentication policy and security refusal from sign-in',async t=>{
 for(const [code,label,link]of [['CSRF_DENIED','Page authorization expired','reload-page'],['AUTH_POLICY_REQUIRED','SPX configuration required','configure-spx'],['ORIGIN_DENIED','Request access refused','reload-page'],['AUTH_REQUIRED','Sign-in required','sign-in']]){
  const {page,model}=await fixture(t);model.actionStatus=code==='AUTH_REQUIRED'?401:403;model.actionResult={ok:false,code};
  await page.locator('#launch').click();await page.getByText(label,{exact:true}).waitFor();assert.equal(await page.locator('#'+link).isVisible(),true);
  assert.equal(await page.locator('#sign-in').isVisible(),code==='AUTH_REQUIRED');assert.equal(await page.locator('#configure-spx').isVisible(),code==='AUTH_POLICY_REQUIRED');
  assert.equal(await page.locator('#launch').isDisabled(),true);assert.equal(await page.locator('#stop').isDisabled(),true);
  await wait(100);assert.equal(await page.locator('#connection').textContent(),label,'successful status GET must not erase authorization recovery');
  if(code==='CSRF_DENIED'){model.actionResult=null;model.actionStatus=200;await page.locator('#reload-page').click();await page.getByText('Connected to application',{exact:true}).waitFor();assert.equal(await page.locator('#launch').isEnabled(),true);}
 }
});

test('footer navigation remains one unobscured hit target across wrap-prone fonts and supported mobile widths',async t=>{
 const {page}=await fixture(t);const measurements=[];
 for(const font of ['system-ui','DejaVu Sans','Arial'])for(const width of [390,380,360,340,320]){
  await page.setViewportSize({width,height:844});await page.evaluate(value=>document.documentElement.style.fontFamily=value,font);
  await page.locator('footer a').focus();
  const value=await page.locator('footer a').evaluate((element,{font,width})=>{const r=element.getBoundingClientRect(),stop=document.getElementById('stop').getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{font,width,fragments:element.getClientRects().length,hit:hit===element,hitTag:hit?.tagName,rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},stop:{top:stop.top,bottom:stop.bottom},visible:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overlap:r.top<stop.bottom&&r.bottom>stop.top};},{font,width});
  measurements.push(value);await fs.writeFile(path.join(evidence,'footer-wrap-layout.json'),JSON.stringify(measurements,null,2));
  if(!value.hit||!value.visible||value.overlap)await page.screenshot({path:path.join(evidence,'footer-wrap-failure.png'),fullPage:true});
  assert.equal(value.fragments,1,'footer link must not fragment across lines');assert.equal(value.hit,true,'footer hit target is obscured');assert.equal(value.visible,true);assert.equal(value.overlap,false);
 }
});

test('desktop and390px operator layout retain long content, focus and independent Stop without overflow',async t=>{
 const f=await fixture(t),{page,model}=f;
 model.state.active.displayName='Football · Senior night and community recognition — West district stadium';model.state.active.runtime.index=1;
 model.state.candidate={...record('band',false),candidateId:'b'.repeat(48),displayName:'Band showcase · Homecoming performance and visiting schools'};await f.refresh();
 await page.screenshot({path:path.join(evidence,'desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 const measurements=[];
 for(const selector of ['#event-select','#discard','#launch','#reload-media','footer a']){
  await page.locator(selector).evaluate(element=>{element.scrollIntoView({block:'center'});element.focus();});
  const measure=await page.locator(selector).evaluate(element=>{const rect=element.getBoundingClientRect(),stop=document.getElementById('stop').getBoundingClientRect(),main=document.getElementById('main').getBoundingClientRect();const x=rect.x+rect.width/2,y=rect.y+rect.height/2;const hit=document.elementFromPoint(x,y);return{selector:element.id||'footer-link',text:element.textContent,rect:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height},fragments:[...element.getClientRects()].map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom})),stop:{top:stop.top,bottom:stop.bottom},hit:hit===element,hitElement:hit?{tag:hit.tagName,id:hit.id,className:hit.className,text:hit.textContent?.slice(0,160)}:null,visible:rect.top>=0&&rect.bottom<=innerHeight,overlap:rect.top<stop.bottom&&rect.bottom>stop.top,main:{top:main.top,bottom:main.bottom},viewport:{width:innerWidth,height:innerHeight},font:getComputedStyle(element).font};});
  measurements.push(measure);await fs.writeFile(path.join(evidence,'mobile-layout.json'),JSON.stringify(measurements,null,2));
  if(!measure.hit||!measure.visible||measure.overlap)await page.screenshot({path:path.join(evidence,'mobile-hit-failure.png'),fullPage:true});
  assert.equal(measure.hit,true,selector+' hit target is obscured');assert.equal(measure.visible,true);assert.equal(measure.overlap,false,selector+' intersects Stop region');
 }
 await page.locator('#reload-media').focus();await page.keyboard.press('Tab');assert.equal(await page.locator('#stop').evaluate(element=>element===document.activeElement),true);
 await page.locator('#main').evaluate(element=>element.scrollTop=0);await page.evaluate(()=>scrollTo(0,0));
 await fs.writeFile(path.join(evidence,'mobile-layout.json'),JSON.stringify(measurements,null,2));
 await page.screenshot({path:path.join(evidence,'mobile.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('#stop').isEnabled(),true);assert.match(await page.locator('#active-name').textContent(),/Senior night/);
});
