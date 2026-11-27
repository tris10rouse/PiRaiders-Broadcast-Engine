'use strict';
// BE-006 item 5c part 1: six distinct diagnostic states, one model and a
// read-only route. Real HTTP, the real view and the real source service on
// temporary synthetic folders; every identity, label and path is synthetic.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const express=require('express'),session=require('express-session'),exphbs=require('express-handlebars');
const {createGameDayWeb}=require('../scripts/lib/game-day-web.cjs');
const {diagnose,DIAGNOSTIC_STATES,NEVER_CLAIMED}=require('../scripts/lib/game-day-diagnostics.cjs');
const {fixture,source,copy}=require('./exchange-provider-fixtures.cjs');
const VIEWS=path.join(__dirname,'..','views');
const SIX=['exchangeFolder','catalogSequence','approvals','prepared','renderer','ndiSender'];

async function machineFile(f){
  await fs.mkdir(path.join(f.parent,'config'),{recursive:true});await fs.writeFile(path.join(f.parent,'config','spx.json'),'{}');
  const raw={schemaVersion:1,spxConfigFile:'config/spx.json',catalogDirectory:path.join(f.parent,'catalog'),
    mediaRoot:f.config.sourceRoot,cacheRoot:f.config.cacheDir,runtimeRoot:path.join(f.parent,'runtime'),
    caspar:{executable:path.join(f.parent,'components','casparcg.exe'),cwd:path.join(f.parent,'components')},output:{type:'none'},
    rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}},
    source:{providerId:'approved-feed',journalDirectory:f.config.journalDir,journalStoreId:f.config.storeId,
      approvalDirectory:path.join(f.parent,'private','approvals'),approvalStoreId:crypto.randomUUID(),
      expectedCanonicalRoot:f.config.sourceRoot,binding:copy(f.config.binding)}};
  const file=path.join(f.parent,'machine-'+crypto.randomUUID()+'.json');await fs.writeFile(file,JSON.stringify(raw));return{file,raw};
}
async function serve(t,options,{username='',password=''}={}){
  const prior=global.config;global.config={general:{username,password}};
  const app=express();app.engine('handlebars',exphbs.engine({extname:'.handlebars'}));app.set('view engine','handlebars');app.set('views',VIEWS);
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port,origin='http://127.0.0.1:'+port;
  const web=createGameDayWeb({port,...options});
  app.use(web.guard);app.use(session({secret:'synthetic-diagnostics',resave:false,saveUninitialized:false}));app.use(web.router);
  let stopped=false;const stop=async()=>{if(stopped)return;stopped=true;await web.close();await new Promise(resolve=>server.close(resolve));global.config=prior;};
  t.after(stop);
  function request(url,{method='GET',headers={},json}={}){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:url,method,agent:false,
    headers:{Host:'127.0.0.1:'+port,...(json===undefined?{}:{'Content-Type':'application/json'}),...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));
    res.on('end',()=>{const text=Buffer.concat(chunks).toString();let value;try{value=JSON.parse(text);}catch{}resolve({status:res.statusCode,text,value,headers:res.headers});});});
    req.on('error',reject);req.end(json===undefined?undefined:JSON.stringify(json));});}
  async function page(){const response=await request('/game-day'),match=/name="piraiders-csrf" content="([a-f0-9]{64})"/.exec(response.text);
    return{response,token:match?.[1],cookie:response.headers['set-cookie']?.[0].split(';')[0]};}
  const post=(p,url,json)=>request(url,{method:'POST',json,headers:{Origin:origin,Cookie:p.cookie,'X-PiRaiders-CSRF':p.token,'Sec-Fetch-Site':'same-origin','Sec-Fetch-Mode':'cors','Sec-Fetch-Dest':'empty'}});
  return{request,page,post,stop};
}
function states(value){return Object.fromEntries(SIX.map(k=>[k,value.states[k].state]));}
function noPaths(text,f){for(const p of [f.parent,f.config.sourceRoot,f.config.cacheDir,f.config.journalDir])assert.equal(text.includes(p)||text.includes(JSON.stringify(p).slice(1,-1)),false,'no private path in a diagnostics answer');}
function onlySix(value){
  assert.deepEqual(Object.keys(value.states),SIX,'exactly six states, in order');assert.deepEqual([...DIAGNOSTIC_STATES],SIX);
  assert.deepEqual([...value.neverClaimed],['sourceDiscovered','receiverConnected','boardInputSelected','onAir']);
  assert.equal(value.ready,false);
  // No field anywhere implies on air, a receiver or the board.
  const text=JSON.stringify({...value,neverClaimed:undefined});
  assert.doesNotMatch(text,/air|receiver|board|discovered|verified/i);
}

// Fakes shaped like the real service status and manager snapshot.
function fakeSource({root=null,catalog={available:true,catalog:{catalogSequence:7}},approvals={read:true,code:null,closed:false},catalogCode=null}={}){
  return{rootState:async()=>typeof root==='function'?root():({code:root}),catalogState:()=>catalog,
    status:()=>({catalog:{available:catalog.available,code:catalogCode},approvals})};
}
function runtime(extra){return{state:'ready',ready:true,output:'ndi',lastError:null,...extra};}
function fakeManager({candidate=null,active=null,preparing=false,operation=null}={}){return{snapshot:()=>({candidate,active,preparing,operation})};}

test('each state comes from its own input and never merges with another',async()=>{
  const all=await diagnose({source:fakeSource(),manager:fakeManager({candidate:{cleanup:'open'},active:{cleanup:'open',runtime:runtime()}})});
  onlySix(all);assert.equal(all.mode,'source');
  assert.deepEqual(states(all),{exchangeFolder:'reachable',catalogSequence:'read',approvals:'readable',prepared:'prepared',renderer:'acknowledged',ndiSender:'running'});
  assert.equal(all.states.catalogSequence.sequence,7);
  for(const k of SIX)assert.equal(all.states[k].code,null);
  // Exchange folder: its own codes only.
  assert.deepEqual((await diagnose({source:fakeSource({root:'SOURCE_UNAVAILABLE'})})).states.exchangeFolder,{state:'unreachable',code:'SOURCE_UNAVAILABLE'});
  assert.deepEqual((await diagnose({source:fakeSource({root:'SOURCE_ROOT_MISMATCH'})})).states.exchangeFolder,{state:'mismatch',code:'SOURCE_ROOT_MISMATCH'});
  assert.deepEqual((await diagnose({source:fakeSource({root:()=>{throw Error('C:\\private\\root');}})})).states.exchangeFolder,{state:'unknown',code:'STATE_UNAVAILABLE'});
  // A folder gone does not change the catalog or approvals states, and back.
  const gone=await diagnose({source:fakeSource({root:'SOURCE_UNAVAILABLE'})});
  assert.deepEqual([gone.states.catalogSequence.state,gone.states.approvals.state],['read','readable']);
  // Catalog sequence: read only with an available catalog and an integer sequence.
  assert.deepEqual((await diagnose({source:fakeSource({catalog:{available:false,catalog:null},catalogCode:'CATALOG_NOT_READ'})})).states.catalogSequence,{state:'unavailable',code:'CATALOG_NOT_READ',sequence:null});
  assert.equal((await diagnose({source:fakeSource({catalog:{available:true,catalog:{catalogSequence:'7'}}})})).states.catalogSequence.state,'unavailable');
  // Approvals: readable, unreadable with its code, or not read yet.
  assert.deepEqual((await diagnose({source:fakeSource({approvals:{read:false,code:'APPROVAL_STORE_CORRUPT',closed:false}})})).states.approvals,{state:'unreadable',code:'APPROVAL_STORE_CORRUPT'});
  assert.deepEqual((await diagnose({source:fakeSource({approvals:{read:false,code:null,closed:false}})})).states.approvals,{state:'not-read',code:null});
  assert.deepEqual((await diagnose({source:fakeSource({approvals:{read:false,code:'APPROVAL_NOT_READ',closed:false}})})).states.approvals,{state:'not-read',code:'APPROVAL_NOT_READ'});
  assert.deepEqual((await diagnose({source:fakeSource({approvals:{read:false,code:'APPROVAL_ROLLBACK',closed:false}})})).states.approvals,{state:'unreadable',code:'APPROVAL_ROLLBACK'});
  // A code that is not a code never reaches the answer.
  assert.deepEqual((await diagnose({source:fakeSource({approvals:{read:false,code:'C:\\private\\x',closed:false}})})).states.approvals,{state:'unreadable',code:'STATE_UNAVAILABLE'});
  // Prepared is the candidate only; an active event is not "prepared".
  assert.equal((await diagnose({manager:fakeManager({active:{cleanup:'open',runtime:runtime()}})})).states.prepared.state,'none');
  assert.equal((await diagnose({manager:fakeManager({preparing:true})})).states.prepared.state,'preparing');
  assert.deepEqual((await diagnose({manager:fakeManager({candidate:{cleanup:'failed'}})})).states.prepared,{state:'cleanup',code:'CLOSE_FAILED'});
  // Renderer acknowledged is not NDI running: an event outside its window, or with no output.
  const waiting=await diagnose({manager:fakeManager({active:{cleanup:'open',runtime:runtime({state:'waiting',ready:false})}})});
  assert.deepEqual([waiting.states.renderer.state,waiting.states.ndiSender.state],['waiting','not-running']);
  const noOutput=await diagnose({manager:fakeManager({active:{cleanup:'open',runtime:runtime({output:'none'})}})});
  assert.deepEqual([noOutput.states.renderer.state,noOutput.states.ndiSender.state],['acknowledged','not-configured']);
  const starting=await diagnose({manager:fakeManager({active:{cleanup:'open',runtime:runtime({state:'starting',ready:false})}})});
  assert.deepEqual([starting.states.renderer.state,starting.states.ndiSender.state],['waiting','starting']);
  // A runtime that says ready without being in its ready state is not running.
  assert.equal((await diagnose({manager:fakeManager({active:{cleanup:'open',runtime:runtime({state:'waiting',ready:true})}})})).states.ndiSender.state,'not-running');
  const closing=await diagnose({manager:fakeManager({active:{cleanup:'closing',runtime:runtime()}})});
  assert.deepEqual([closing.states.renderer.state,closing.states.ndiSender.state],['not-active','not-running']);
  // A local machine has no exchange states; a failing manager is unknown, not idle.
  const local=await diagnose({manager:{snapshot:()=>{throw Error('C:\\private\\boom');}}});
  assert.equal(local.mode,'local');onlySix(local);
  assert.deepEqual(states(local),{exchangeFolder:'not-used',catalogSequence:'not-used',approvals:'not-used',prepared:'unknown',renderer:'unknown',ndiSender:'unknown'});
  assert.equal(local.states.renderer.code,'STATE_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(local),/private/);
  assert.equal((await diagnose({source:fakeSource()})).states.renderer.code,'SOURCE_PLAYBACK_NOT_READY','no manager is its own code');
  assert.deepEqual([...NEVER_CLAIMED],['sourceDiscovered','receiverConnected','boardInputSelected','onAir']);
});

test('the route reads six path-free states on a source machine, through a folder that goes and comes back',async t=>{
  const {createExchangeApprovalStore}=require('../scripts/lib/exchange-approval-store.cjs');
  const f=await fixture(t),m=source();await f.publish(m);
  const {file,raw}=await machineFile(f);
  await fs.mkdir(path.dirname(raw.source.approvalDirectory),{recursive:true});
  assert.equal((await createExchangeApprovalStore().initialize(raw.source.approvalDirectory,raw.source.approvalStoreId)).ok,true);
  const runtimeFactory=async(profile,options)=>{
    await options.preparedMedia.initial({privateRoots:options.privateRoots});let state='prepared';
    return{candidateAdmissionToken:()=>options.preparedMedia.admissionToken(),start:async()=>{state='ready';},close:async()=>{state='closed';options.preparedMedia.close();},
      snapshot:()=>({preparing:false,state,ready:state==='ready',windowAllowed:false}),dispatch:async()=>({ok:true})};
  };
  const s=await serve(t,{appRoot:f.parent,machineFile:file,configFile:path.join(f.parent,'config','spx.json'),runtimeFactory});
  const p=await s.page(),answers=[];
  const read=async()=>{const r=await s.request('/game-day/api/diagnostics',{headers:{Cookie:p.cookie}});answers.push(r.text);assert.equal(r.status,200,r.text);assert.equal(r.value.ok,true);onlySix(r.value.diagnostics);return r.value.diagnostics;};
  let d=await read();assert.equal(d.mode,'source');
  assert.deepEqual(states(d),{exchangeFolder:'reachable',catalogSequence:'unavailable',approvals:'not-read',prepared:'none',renderer:'not-active',ndiSender:'not-running'});
  assert.equal(d.states.catalogSequence.code,'CATALOG_NOT_READ');
  assert.equal((await s.post(p,'/game-day/api/source/refresh',{})).status,200);
  d=await read();assert.equal(d.states.catalogSequence.state,'read');assert.ok(Number.isSafeInteger(d.states.catalogSequence.sequence));
  const status=(await s.request('/game-day/api/source/status',{headers:{Cookie:p.cookie}})).value;
  assert.equal(d.states.catalogSequence.sequence,status.catalog.catalog.catalogSequence,'the sequence the catalog was read at');
  // Approve, prepare and activate: approvals read, then prepared, then the renderer acknowledged.
  const tuple=[...m.identityTuple],win={start:'2026-10-23T18:00:00-05:00',end:'2026-10-23T23:45:00-05:00',prewarmMinutes:20};
  const review=await s.post(p,'/game-day/api/source/review',{identityTuple:tuple});
  assert.equal((await s.post(p,'/game-day/api/source/approve',{identityTuple:tuple,inspectionRevision:review.value.inspection.revision,productionWindow:win})).status,200);
  const id=(await s.request('/game-day/api/events',{headers:{Cookie:p.cookie}})).value.events[0].eventId;
  const body=async extra=>{const st=(await s.request('/game-day/api/state',{headers:{Cookie:p.cookie}})).value.state;return{expectedEventId:st.expectedEventId,expectedSelection:st.expectedSelection,...extra};};
  const prepared=await s.post(p,'/game-day/api/prepare',await body({eventId:id}));assert.equal(prepared.status,200,prepared.text);
  d=await read();assert.deepEqual([d.states.approvals.state,d.states.prepared.state,d.states.renderer.state],['readable','prepared','not-active']);
  assert.equal((await s.post(p,'/game-day/api/activate',await body({candidateId:prepared.value.candidateId}))).status,200);
  d=await read();
  assert.deepEqual(states(d),{exchangeFolder:'reachable',catalogSequence:'read',approvals:'readable',prepared:'none',renderer:'acknowledged',ndiSender:'not-configured'});
  // The exchange folder goes away: only that state changes; it comes back.
  const away=f.config.sourceRoot+'-away';await fs.rename(f.config.sourceRoot,away);
  d=await read();assert.deepEqual(d.states.exchangeFolder,{state:'unreachable',code:'SOURCE_UNAVAILABLE'});
  assert.deepEqual([d.states.catalogSequence.state,d.states.approvals.state,d.states.renderer.state],['read','readable','acknowledged']);
  await fs.rename(away,f.config.sourceRoot);
  d=await read();assert.deepEqual(d.states.exchangeFolder,{state:'reachable',code:null});
  // A file where the folder was is not a reachable folder (review, fence 77).
  await fs.rename(f.config.sourceRoot,away);await fs.writeFile(f.config.sourceRoot,'not a folder');
  d=await read();assert.deepEqual(d.states.exchangeFolder,{state:'unreachable',code:'SOURCE_UNAVAILABLE'});
  await fs.rm(f.config.sourceRoot);await fs.rename(away,f.config.sourceRoot);
  d=await read();assert.deepEqual(d.states.exchangeFolder,{state:'reachable',code:null});
  // A plain read: no POST, and login policy as for every Game Day route.
  assert.equal((await s.post(p,'/game-day/api/diagnostics',{})).status,404);
  for(const text of answers)noPaths(text,f);
});

test('the route on a local machine, on an injected service and behind the SPX login',async t=>{
  const root=path.join(__dirname,'..');
  const manager={snapshot:()=>({state:'idle',candidate:null,active:null,preparing:false,operation:null}),listEvents:async()=>({ok:true,events:[]}),prepare:async()=>({ok:true}),
    activate:async()=>({ok:true}),discardCandidate:async()=>({ok:true}),endDeadEvent:async()=>({ok:true}),dispatch:async()=>({ok:true}),close:()=>Promise.resolve({ok:true})};
  const s=await serve(t,{manager,appRoot:root});const p=await s.page();
  const local=(await s.request('/game-day/api/diagnostics',{headers:{Cookie:p.cookie}})).value.diagnostics;
  onlySix(local);assert.equal(local.mode,'local');
  assert.equal(local.caspar,null,'Q-020: an injected manager has no machine file, so which Caspar runs is not known');
  assert.deepEqual(states(local),{exchangeFolder:'not-used',catalogSequence:'not-used',approvals:'not-used',prepared:'none',renderer:'not-active',ndiSender:'not-running'});
  await s.stop();
  // An injected service alone has no manager and, without rootState, no folder answer.
  const service={refreshCatalog:async()=>({ok:false}),catalogState:()=>({available:false,catalog:null}),catalogEventsPage:()=>({}),catalogSelectionsPage:()=>({}),
    reviewSelection:async()=>({}),confirmSelection:async()=>({}),revokeSelection:async()=>({}),status:()=>({catalog:{available:false,code:'CATALOG_NOT_READ'},approvals:{read:false,code:null,closed:false}}),close:()=>{}};
  const fake=await serve(t,{sourceService:service,appRoot:root});const fp=await fake.page();
  const injected=(await fake.request('/game-day/api/diagnostics',{headers:{Cookie:fp.cookie}})).value.diagnostics;onlySix(injected);
  assert.deepEqual(states(injected),{exchangeFolder:'unknown',catalogSequence:'unavailable',approvals:'not-read',prepared:'unknown',renderer:'unknown',ndiSender:'unknown'});
  assert.equal(injected.states.prepared.code,'SOURCE_PLAYBACK_NOT_READY');
  await fake.stop();
  const locked=await serve(t,{manager,appRoot:root},{username:'operator',password:'synthetic'});
  assert.deepEqual((await locked.request('/game-day/api/diagnostics')).value,{ok:false,code:'AUTH_REQUIRED'});
});
