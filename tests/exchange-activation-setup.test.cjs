'use strict';
// BE-006 item 5b part 4: the Windows exchange activation job's setup and
// cached-start steps, run here on Linux with the very same helpers: the
// operator's setup command (scripts/piraiders-setup.cjs, a child process)
// sets up the stores of the synthetic source machine, twice; the button is
// approved and prepared online through the real web adapter; the command
// pins it offline; with the exchange folder moved away a new web adapter
// starts it from the cache through the real routes. A trusted synthetic
// runtime stands in for Caspar and NDI: no Windows output is shown here.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const express=require('express'),session=require('express-session'),exphbs=require('express-handlebars');
const {createGameDayWeb}=require('../scripts/lib/game-day-web.cjs');
const {buildExchangeActivationFixture,ACTIVATION_PICTURES}=require('../scripts/exchange-activation-fixture.cjs');
const routes=require('../scripts/exchange-activation-routes.cjs');
const setup=require('../scripts/exchange-activation-setup.cjs');
const ROOT=path.join(__dirname,'..'),VIEWS=path.join(ROOT,'views');

async function proofMachine(t){
  const parent=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders activation setup ')));
  t.after(()=>fs.rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const appRoot=path.join(parent,'app');await fs.mkdir(path.join(appRoot,'config'),{recursive:true});await fs.writeFile(path.join(appRoot,'config','spx.json'),'{}');
  const built=await buildExchangeActivationFixture({root:path.join(parent,'proof'),setUpStores:false,machine:{spxConfigFile:'config/spx.json',
    caspar:{executable:path.join(appRoot,'components','casparcg.exe'),cwd:path.join(appRoot,'components')},output:{type:'none'},
    rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}}}});
  return{parent,appRoot,built};
}
async function serve(t,options){
  const prior=global.config;global.config={general:{username:'',password:''}};
  const app=express();app.engine('handlebars',exphbs.engine({extname:'.handlebars'}));app.set('view engine','handlebars');app.set('views',VIEWS);
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port,origin='http://127.0.0.1:'+port,web=createGameDayWeb({port,...options});
  app.use(web.guard);app.use(session({secret:'synthetic-activation-setup',resave:false,saveUninitialized:false}));app.use(web.router);
  let closed=false;const close=async()=>{if(closed)return;closed=true;await web.close();await new Promise(resolve=>server.close(resolve));global.config=prior;};
  t.after(close);
  const texts=[];
  function request(url,{method='GET',headers={},json}={}){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:url,method,agent:false,
    headers:{Host:'127.0.0.1:'+port,...(json===undefined?{}:{'Content-Type':'application/json'}),...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));
    res.on('end',()=>{const text=Buffer.concat(chunks).toString();texts.push(text);let value;try{value=JSON.parse(text);}catch{}resolve({status:res.statusCode,value});});});
    req.on('error',reject);req.end(json===undefined?undefined:JSON.stringify(json));});}
  const page=await new Promise((resolve,reject)=>http.get({hostname:'127.0.0.1',port,path:'/game-day',agent:false,headers:{Host:'127.0.0.1:'+port}},res=>{const c=[];res.on('data',x=>c.push(x));res.on('end',()=>resolve({text:Buffer.concat(c).toString(),headers:res.headers}));}).on('error',reject));
  const token=/name="piraiders-csrf" content="([a-f0-9]{64})"/.exec(page.text)[1],cookie=page.headers['set-cookie'][0].split(';')[0];
  return{texts,close,client:{get:url=>request(url,{headers:{Cookie:cookie}}),
    post:(url,json)=>request(url,{method:'POST',json,headers:{Origin:origin,Cookie:cookie,'X-PiRaiders-CSRF':token,'Sec-Fetch-Site':'same-origin','Sec-Fetch-Mode':'cors','Sec-Fetch-Dest':'empty'}})}};
}
// Records the startup mode and the deck it is given, and the actions.
function syntheticRuntime(seen){
  return async(profile,options)=>{
    seen.modes.push(profile.media.startup.mode);seen.prepared=await options.preparedMedia.initial({privateRoots:options.privateRoots});let state='prepared';
    return{candidateAdmissionToken:()=>options.preparedMedia.admissionToken(),start:async()=>{state='ready';},close:async()=>{state='closed';options.preparedMedia.close();},
      snapshot:()=>({preparing:false,state,ready:state==='ready',windowAllowed:false}),dispatch:async action=>{seen.actions.push(action);return{ok:true};}};
  };
}
// Content hashes of the prepared deck's pictures in play order, and of the fixture's pictures.
function playedOrder(prepared){
  const m=prepared.manifest,file=new Map(m.assets.map(a=>[a.assetKey,a.fileId])),sha=new Map(m.files.map(f=>[f.id,f.sha256]));
  return m.occurrences.map(o=>sha.get(file.get(o.assetKey)));
}
const webOptions=(appRoot,built,seen)=>({appRoot,machineFile:built.machineFile,configFile:path.join(appRoot,'config','spx.json'),runtimeFactory:syntheticRuntime(seen)});
const away=built=>path.join(path.dirname(built.sourceRoot),'exchange-away');

test('the fixture can leave both private stores to the setup command',async t=>{
  const {built}=await proofMachine(t);
  const raw=JSON.parse(await fs.readFile(built.machineFile,'utf8'));
  await assert.rejects(fs.access(raw.source.journalDirectory),{code:'ENOENT'});
  await assert.rejects(fs.access(raw.source.approvalDirectory),{code:'ENOENT'});
  await assert.rejects(fs.access(path.dirname(raw.source.journalDirectory)),{code:'ENOENT'},'no private folder either: the command makes it');
});

test('the setup command sets up the stores once; the second run changes nothing',async t=>{
  const {built}=await proofMachine(t);
  const first=await setup.runSetupCommand(built.machineFile,{appRoot:ROOT});
  assert.deepEqual(first,{exitCode:0,answer:{ok:true,step:'done',code:null,done:{machine:'checked',source:'direct',feed:'checked',journal:'initialized',approvals:'initialized'}}});
  const raw=JSON.parse(await fs.readFile(built.machineFile,'utf8')),before=await setup.storeBytes(raw.source);
  const second=await setup.runSetupCommand(built.machineFile,{appRoot:ROOT});
  assert.deepEqual(setup.checkSetupTwice(first,second),{first:{journal:'initialized',approvals:'initialized'},second:{journal:'present',approvals:'present'}});
  assert.deepEqual(await setup.storeBytes(raw.source),before,'the second run wrote nothing');
  // An answer that is not the expected one is refused with a fixed code.
  assert.throws(()=>setup.checkSetupTwice(first,first),{code:'SETUP_SECOND_RUN_CHANGED'});
  assert.throws(()=>setup.checkSetupTwice(second,second),{code:'SETUP_FIRST_RUN_UNEXPECTED'});
  assert.throws(()=>setup.checkSetupTwice({exitCode:1,answer:{ok:false,step:'source',code:'SETUP_SOURCE_UNAVAILABLE',done:{}}},second),e=>e.code==='SETUP_FIRST_RUN_UNEXPECTED'&&e.answerCode==='SETUP_SOURCE_UNAVAILABLE');
});

test('approved online, pinned by the command, then started from the cache with the exchange folder gone, in the published order',async t=>{
  const {parent,appRoot,built}=await proofMachine(t);
  setup.checkSetupTwice(await setup.runSetupCommand(built.machineFile,{appRoot:ROOT}),await setup.runSetupCommand(built.machineFile,{appRoot:ROOT}));
  // Online: approve, prepare, activate (fills the cache), Stop, close.
  const seenOnline={modes:[],actions:[]},online=await serve(t,webOptions(appRoot,built,seenOnline));
  const flow=await routes.approveAndActivate(online.client,{identityTuple:built.identityTuple,window:routes.approvalWindow(Date.now())});
  await routes.command(online.client,'stop');await online.close();
  assert.deepEqual(seenOnline.modes,['source']);
  // Pin, with the app closed.
  const pinned=await setup.runSetupCommand(built.machineFile,{appRoot:ROOT,pin:true});
  assert.deepEqual(setup.checkPinned(pinned),{pinned:1,unchanged:0,notPrepared:0,ineligible:0});
  // The exchange folder moved away: a cached start through the routes, no approval.
  await fs.rename(built.sourceRoot,away(built));
  const seen={modes:[],actions:[]},cached=await serve(t,webOptions(appRoot,built,seen));
  // The page's own refresh on opening (the Windows proof's real page sends it by itself).
  const page=await cached.client.post('/game-day/api/source/refresh',{});
  assert.notEqual(page.status,200,'no source catalog with the folder gone');
  const settled=await routes.pageRefreshSettled(cached.client,{timeoutMs:20000,intervalMs:20});
  assert.equal(settled.catalog.available,false,'the source catalog is unavailable with the folder gone');assert.equal(settled.catalog.code,page.value.code);
  const start=await routes.startApproved(cached.client);
  assert.equal(start.eventId,flow.eventId,'the same approved button');assert.match(start.candidateId,/^[A-Za-z0-9_-]+$/);
  assert.deepEqual(seen.modes,['cached'],'started from the cache');
  assert.equal(seen.prepared.deck.slides.length,ACTIVATION_PICTURES.length);
  assert.deepEqual(playedOrder(seen.prepared),built.pictureHashes,'the cached pictures come in the published order');
  await routes.command(cached.client,'next');await routes.command(cached.client,'next');await routes.command(cached.client,'previous');await routes.command(cached.client,'stop');
  assert.deepEqual(seen.actions,['next','next','previous','stop']);
  assert.equal(routes.namesPrivatePath([...online.texts,...cached.texts],[parent,built.sourceRoot,away(built),...built.privateRoots]),false,'no route answer names a private path');
});

test('without the offline pin a cached start is refused with a fixed code',async t=>{
  const {appRoot,built}=await proofMachine(t);
  setup.checkSetupTwice(await setup.runSetupCommand(built.machineFile,{appRoot:ROOT}),await setup.runSetupCommand(built.machineFile,{appRoot:ROOT}));
  const online=await serve(t,webOptions(appRoot,built,{modes:[],actions:[]}));
  await routes.approveAndActivate(online.client,{identityTuple:built.identityTuple,window:routes.approvalWindow(Date.now())});
  await routes.command(online.client,'stop');await online.close();
  await fs.rename(built.sourceRoot,away(built));
  const seen={modes:[],actions:[]},cached=await serve(t,webOptions(appRoot,built,seen));
  // Listed (the approval holds), but the source is gone and nothing pins a cached snapshot: preparation is refused.
  await assert.rejects(routes.startApproved(cached.client),e=>e.code==='PREPARE_FAILED'&&e.routeStatus===422);
  assert.deepEqual(seen.modes.filter(m=>m==='cached'),[],'nothing started from the cache');
  // And pinning needs the folder: the command refuses with it gone.
  const refused=await setup.runSetupCommand(built.machineFile,{appRoot:ROOT,pin:true});
  assert.equal(refused.exitCode,1);assert.equal(refused.answer.code,'SETUP_SOURCE_UNAVAILABLE');
  assert.throws(()=>setup.checkPinned(refused),e=>e.code==='SETUP_PIN_UNEXPECTED'&&e.answerCode==='SETUP_SOURCE_UNAVAILABLE');
});

test('the start step refuses an approved list that is not exactly one button',async()=>{
  const client=events=>({get:async url=>url==='/game-day/api/events'?{status:200,value:{ok:true,events}}:{status:200,value:{ok:true,state:{}}},post:async()=>{throw Error('no post expected');}});
  await assert.rejects(routes.startApproved(client([])),{code:'APPROVED_BUTTON_NOT_LISTED'});
  await assert.rejects(routes.startApproved(client([{eventId:'a'},{eventId:'b'}])),{code:'APPROVED_BUTTON_NOT_LISTED'});
  await assert.rejects(routes.startApproved(null),{code:'ROUTE_OPTIONS_INVALID'});
});

test('the setup helper runs only the setup command with an absolute machine file and keeps codes only',async()=>{
  await assert.rejects(setup.runSetupCommand('relative/machine.json',{appRoot:ROOT}),{code:'SETUP_OPTIONS_INVALID'});
  const missing=await setup.runSetupCommand(path.join(os.tmpdir(),'PiRaiders no such machine '+process.pid+'.json'),{appRoot:ROOT});
  assert.deepEqual(missing,{exitCode:1,answer:{ok:false,step:'machine',code:'MACHINE_CONFIG_INVALID',done:{}}});
});

test('the cached run\'s evidence names are fixed, path-free and distinct from the online run\'s',()=>{
  const {expectedFrames}=require('../scripts/smoke-exchange-activation-windows.cjs');
  const online=expectedFrames(ACTIVATION_PICTURES),cached=expectedFrames(ACTIVATION_PICTURES,'cached');
  assert.deepEqual(cached.map(x=>x.rgb),online.map(x=>x.rgb),'the same pictures in the same order');
  for(const x of cached){assert.match(x.name,/^cached-[a-z0-9-]+$/);assert.ok(x.name.length<=48,'the receiver takes names of up to 48 characters');}
  assert.equal(new Set([...online,...cached].map(x=>x.name)).size,online.length+cached.length);
  assert.throws(()=>expectedFrames(ACTIVATION_PICTURES,'other'),/ACTIVATION_PREFIX/);
});
