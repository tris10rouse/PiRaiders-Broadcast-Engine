'use strict';
// BE-006 item 5a part 2: the route steps the Windows exchange activation proof
// takes, run here against the real web adapter and source service on the 5a-1
// synthetic folder (a trusted synthetic runtime stands in for Caspar). The
// Windows job itself runs only on hosted Windows (full-app-proof.yml).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawnSync}=require('node:child_process');
const express=require('express'),session=require('express-session'),exphbs=require('express-handlebars');
const {createGameDayWeb}=require('../scripts/lib/game-day-web.cjs');
const {buildExchangeActivationFixture,ACTIVATION_PICTURES}=require('../scripts/exchange-activation-fixture.cjs');
const routes=require('../scripts/exchange-activation-routes.cjs');
const ROOT=path.join(__dirname,'..'),VIEWS=path.join(ROOT,'views');

async function proofMachine(t,options){
  const parent=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders activation routes ')));
  t.after(()=>fs.rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const appRoot=path.join(parent,'app');await fs.mkdir(path.join(appRoot,'config'),{recursive:true});await fs.writeFile(path.join(appRoot,'config','spx.json'),'{}');
  const built=await buildExchangeActivationFixture({root:path.join(parent,'proof'),...options,machine:{spxConfigFile:'config/spx.json',
    caspar:{executable:path.join(appRoot,'components','casparcg.exe'),cwd:path.join(appRoot,'components')},output:{type:'none'},
    rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}}}});
  return{parent,appRoot,built};
}
async function serve(t,options){
  const prior=global.config;global.config={general:{username:'',password:''}};
  const app=express();app.engine('handlebars',exphbs.engine({extname:'.handlebars'}));app.set('view engine','handlebars');app.set('views',VIEWS);
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port,origin='http://127.0.0.1:'+port,web=createGameDayWeb({port,...options});
  app.use(web.guard);app.use(session({secret:'synthetic-activation-routes',resave:false,saveUninitialized:false}));app.use(web.router);
  t.after(async()=>{await web.close();await new Promise(resolve=>server.close(resolve));global.config=prior;});
  const texts=[];
  function request(url,{method='GET',headers={},json}={}){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:url,method,agent:false,
    headers:{Host:'127.0.0.1:'+port,...(json===undefined?{}:{'Content-Type':'application/json'}),...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));
    res.on('end',()=>{const text=Buffer.concat(chunks).toString();texts.push(text);let value;try{value=JSON.parse(text);}catch{}resolve({status:res.statusCode,value});});});
    req.on('error',reject);req.end(json===undefined?undefined:JSON.stringify(json));});}
  const page=await new Promise((resolve,reject)=>http.get({hostname:'127.0.0.1',port,path:'/game-day',agent:false,headers:{Host:'127.0.0.1:'+port}},res=>{const c=[];res.on('data',x=>c.push(x));res.on('end',()=>resolve({text:Buffer.concat(c).toString(),headers:res.headers}));}).on('error',reject));
  const token=/name="piraiders-csrf" content="([a-f0-9]{64})"/.exec(page.text)[1],cookie=page.headers['set-cookie'][0].split(';')[0];
  return{texts,client:{get:url=>request(url,{headers:{Cookie:cookie}}),
    post:(url,json)=>request(url,{method:'POST',json,headers:{Origin:origin,Cookie:cookie,'X-PiRaiders-CSRF':token,'Sec-Fetch-Site':'same-origin','Sec-Fetch-Mode':'cors','Sec-Fetch-Dest':'empty'}})}};
}
function syntheticRuntime(seen){
  return async(profile,options)=>{
    seen.window=profile.productionWindow;seen.prepared=await options.preparedMedia.initial({privateRoots:options.privateRoots});let state='prepared';
    return{candidateAdmissionToken:()=>options.preparedMedia.admissionToken(),start:async()=>{state='ready';},close:async()=>{state='closed';options.preparedMedia.close();},
      snapshot:()=>({preparing:false,state,ready:state==='ready',windowAllowed:false}),dispatch:async action=>{seen.actions.push(action);return{ok:true};}};
  };
}

test('the approval window contains now, has no prewarm and uses whole seconds with an explicit zone',()=>{
  const now=Date.parse('2026-11-20T17:00:00.750Z'),w=routes.approvalWindow(now);
  assert.deepEqual(w,{start:'2026-11-20T16:59:00Z',end:'2026-11-20T17:15:00Z',prewarmMinutes:0});
  assert.ok(Date.parse(w.start)<=now&&now<Date.parse(w.end));
  assert.throws(()=>routes.approvalWindow(1.5),{code:'WINDOW_OPTIONS_INVALID'});
  assert.throws(()=>routes.approvalWindow(now,{afterMs:0}),{code:'WINDOW_OPTIONS_INVALID'});
});

test('the expected frames follow the published order: launch, Next twice, Previous',()=>{
  const {expectedFrames}=require('../scripts/smoke-exchange-activation-windows.cjs');
  const plan=expectedFrames(ACTIVATION_PICTURES);
  assert.deepEqual(plan.map(x=>x.step),['launch','next-rosstalk','next-route','previous-route']);
  assert.deepEqual(plan.map(x=>x.rgb),[0,1,2,1].map(i=>[...ACTIVATION_PICTURES[i].rgb]));
  for(const x of plan)assert.match(x.name,/^[a-z0-9-]+$/,'evidence file names are fixed and path-free');
  assert.equal(new Set(plan.map(x=>x.name)).size,plan.length);
  assert.throws(()=>expectedFrames(ACTIVATION_PICTURES.slice(0,2)),/ACTIVATION_ORDER/);
});

test('the proof steps approve, prepare and activate the synthetic button through the real routes, path-free',async t=>{
  const {parent,appRoot,built}=await proofMachine(t),seen={actions:[]};
  const s=await serve(t,{appRoot,machineFile:built.machineFile,configFile:path.join(appRoot,'config','spx.json'),runtimeFactory:syntheticRuntime(seen)});
  const window=routes.approvalWindow(Date.now());
  const flow=await routes.approveAndActivate(s.client,{identityTuple:built.identityTuple,window});
  assert.match(flow.eventId,/^sel-[a-f0-9]{40}$/);
  assert.deepEqual(seen.window,{start:new Date(window.start).toISOString(),end:new Date(window.end).toISOString(),prewarmMinutes:0},'the confirmed window reaches the runtime unchanged');
  assert.equal(seen.prepared.deck.slides.length,ACTIVATION_PICTURES.length);
  const st=(await s.client.get('/game-day/api/state')).value.state;assert.equal(st.state,'active');assert.equal(st.active.eventId,flow.eventId);
  await routes.command(s.client,'next');await routes.command(s.client,'previous');await routes.command(s.client,'stop');
  assert.deepEqual(seen.actions,['next','previous','stop']);
  assert.equal(routes.namesPrivatePath(s.texts,[parent,built.sourceRoot,...built.privateRoots]),false,'no route answer names a private path');
});

test('the proof steps stop with a fixed code when the approval list was never set up',async t=>{
  const {appRoot,built}=await proofMachine(t,{initializeApprovals:false});
  const s=await serve(t,{appRoot,machineFile:built.machineFile,configFile:path.join(appRoot,'config','spx.json'),runtimeFactory:syntheticRuntime({actions:[]})});
  await assert.rejects(routes.approveAndActivate(s.client,{identityTuple:built.identityTuple,window:routes.approvalWindow(Date.now())}),{code:'SOURCE_APPROVAL_LIST_NOT_EMPTY'});
  const listed=await s.client.get('/game-day/api/events');
  assert.ok(listed.status!==200||listed.value.ok===false||(Array.isArray(listed.value.events)&&listed.value.events.length===0),'nothing approved, nothing to prepare');
});

test('the proof steps refuse a button the catalog does not list',async t=>{
  const {appRoot,built}=await proofMachine(t);
  const s=await serve(t,{appRoot,machineFile:built.machineFile,configFile:path.join(appRoot,'config','spx.json'),runtimeFactory:syntheticRuntime({actions:[]})});
  const other=[...built.identityTuple];other[4]='not published';
  await assert.rejects(routes.approveAndActivate(s.client,{identityTuple:other,window:routes.approvalWindow(Date.now())}),{code:'SOURCE_SELECTION_NOT_LISTED'});
  await assert.rejects(routes.approveAndActivate(s.client,{identityTuple:built.identityTuple.slice(0,4),window:{}}),{code:'ROUTE_OPTIONS_INVALID'});
});

test('the private-path check sees raw and JSON-escaped paths',()=>{
  const p=path.join(os.tmpdir(),'proof','private');
  assert.equal(routes.namesPrivatePath(['{"ok":true}'],[p]),false);
  assert.equal(routes.namesPrivatePath(['x '+p],[p]),true);
  assert.equal(routes.namesPrivatePath([JSON.stringify({where:'C:\\proof\\private'})],['C:\\proof\\private']),true);
});

test('the Windows proof refuses to run anywhere but Windows',{skip:process.platform==='win32'},()=>{
  const r=spawnSync(process.execPath,[path.join(ROOT,'scripts','smoke-exchange-activation-windows.cjs')],{cwd:ROOT,encoding:'utf8',timeout:60000});
  assert.equal(r.status,1);assert.match(r.stderr,/^EXCHANGE_ACTIVATION_PROOF_FAILED\s*$/);assert.equal(r.stdout,'');
});

test('the workflow runs the exchange activation proof as its own Windows job beside the full-app proof',async()=>{
  // A Windows checkout may turn line endings into CRLF.
  const yml=(await fs.readFile(path.join(ROOT,'.github','workflows','full-app-proof.yml'),'utf8')).replace(/\r\n/g,'\n');
  const jobs=yml.split(/\n  (?=[a-z-]+:\n)/);
  const job=jobs.find(j=>j.startsWith('actual-exchange-activation-private-ndi:'));assert.ok(job,'job present');
  assert.match(job,/runs-on: windows-latest/);assert.match(job,/node scripts\/smoke-exchange-activation-windows\.cjs/);
  assert.match(job,/node scripts\/prepare-caspar-proof\.cjs/);assert.match(job,/node scripts\/prepare-ndi-proof\.cjs/);
  assert.match(job,/path: build\/exchange-activation-proof-evidence/);
  assert.ok(jobs.some(j=>j.startsWith('actual-full-app-private-ndi:')&&/node scripts\/smoke-full-app-windows\.cjs\n/.test(j)),'the full-app proof job is unchanged');
});
