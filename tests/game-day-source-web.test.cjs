'use strict';
// BE-006 item 4a: the source browsing routes of the Game Day web adapter on a
// loader-made source machine. Real HTTP, the real view, the real source
// service on temporary folders; every identity, label and path is synthetic.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const express=require('express'),session=require('express-session'),exphbs=require('express-handlebars');
const {createGameDayWeb}=require('../scripts/lib/game-day-web.cjs');
const {fixture,source,copy}=require('./exchange-provider-fixtures.cjs');
const VIEWS=path.join(__dirname,'..','views');

async function machineFile(f,{expectedCanonicalRoot=f.config.sourceRoot}={}){
  await fs.mkdir(path.join(f.parent,'config'),{recursive:true});await fs.writeFile(path.join(f.parent,'config','spx.json'),'{}');
  const raw={schemaVersion:1,spxConfigFile:'config/spx.json',catalogDirectory:path.join(f.parent,'catalog'),
    mediaRoot:f.config.sourceRoot,cacheRoot:f.config.cacheDir,runtimeRoot:path.join(f.parent,'runtime'),
    caspar:{executable:path.join(f.parent,'components','casparcg.exe'),cwd:path.join(f.parent,'components')},output:{type:'none'},
    rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}},
    source:{providerId:'approved-feed',journalDirectory:f.config.journalDir,journalStoreId:f.config.storeId,
      approvalDirectory:path.join(f.parent,'private','approvals'),approvalStoreId:crypto.randomUUID(),
      expectedCanonicalRoot,binding:copy(f.config.binding)}};
  const file=path.join(f.parent,'machine-'+crypto.randomUUID()+'.json');await fs.writeFile(file,JSON.stringify(raw));return file;
}
async function serve(t,options,{username='',password=''}={}){
  const prior=global.config;global.config={general:{username,password}};
  const app=express();app.engine('handlebars',exphbs.engine({extname:'.handlebars'}));app.set('view engine','handlebars');app.set('views',VIEWS);
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port,origin='http://127.0.0.1:'+port;
  const web=createGameDayWeb({port,...options(port)});
  app.use(web.guard);app.use(session({secret:'synthetic-source-web',resave:false,saveUninitialized:false}));app.use(web.router);
  let stopped=false;const stop=async()=>{if(stopped)return;stopped=true;await web.close();await new Promise(resolve=>server.close(resolve));global.config=prior;};
  t.after(stop);
  function request(url,{method='GET',headers={},json}={}){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:url,method,agent:false,
    headers:{Host:'127.0.0.1:'+port,...(json===undefined?{}:{'Content-Type':'application/json'}),...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));
    res.on('end',()=>{const text=Buffer.concat(chunks).toString();let value;try{value=JSON.parse(text);}catch{}resolve({status:res.statusCode,headers:res.headers,text,value});});});
    req.on('error',reject);req.end(json===undefined?undefined:JSON.stringify(json));});}
  async function page(){const response=await request('/game-day'),match=/name="piraiders-csrf" content="([a-f0-9]{64})"/.exec(response.text);
    return{response,token:match?.[1],cookie:response.headers['set-cookie']?.[0].split(';')[0]};}
  return{web,request,origin,stop,page,
    post:(p,url,json,extra={})=>request(url,{method:'POST',json,headers:{Origin:origin,Cookie:p.cookie,'X-PiRaiders-CSRF':p.token,'Sec-Fetch-Site':'same-origin','Sec-Fetch-Mode':'cors','Sec-Fetch-Dest':'empty',...extra}})};
}
function noPaths(text,f){for(const p of [f.parent,f.config.sourceRoot,f.config.cacheDir,f.config.journalDir,path.join(f.parent,'private')])assert.equal(text.includes(p)||text.includes(JSON.stringify(p).slice(1,-1)),false,'no private path in a response');}

test('a source machine serves path-free catalog pages behind the page token; playback lists only approvals',async t=>{
  const f=await fixture(t),m=source();await f.publish(m);
  const file=await machineFile(f),s=await serve(t,()=>({appRoot:f.parent,machineFile:file,configFile:path.join(f.parent,'config','spx.json')}));
  const p=await s.page();assert.equal(p.response.status,200);assert.match(p.token,/^[a-f0-9]{64}$/);
  assert.match(p.response.text,/reads events from the scheduler’s exchange folder/,'source mode says where to approve and prepare');
  assert.match(p.response.text,/<h2 id="events-heading">Approved board buttons<\/h2>/,'the approved list (item 4d part 2)');
  assert.doesNotMatch(p.response.text,/not built yet/,'no notice that playback is missing');
  assert.match(p.response.text,/<body data-mode="source">/);assert.match(p.response.text,/id="source-section"/,'the exchange catalog screen (item 4b)');
  const responses=[];const keep=r=>{responses.push(r.text);return r;};
  // Item 4d: a source machine has a playback manager whose catalog is this
  // PC's approvals. With no approval store set up there is nothing to list,
  // and Stop with nothing playing is simply not ready.
  const state=keep(await s.request('/game-day/api/state',{headers:{Cookie:p.cookie}}));
  assert.equal(state.status,200);assert.equal(state.value.state.state,'idle');assert.equal(state.value.state.active,null);
  const listed=keep(await s.request('/game-day/api/events',{headers:{Cookie:p.cookie}}));
  assert.equal(listed.status,422);assert.deepEqual(listed.value,{ok:false,code:'CATALOG_INVALID'},'no approval store yet');
  const stop=keep(await s.post(p,'/game-day/api/command',{action:'stop',expectedEventId:null,expectedSelection:0}));
  assert.equal(stop.status,409);assert.equal(stop.value.code,'NOT_READY');
  // Before a refresh nothing is browsable.
  const before=keep(await s.request('/game-day/api/source/status',{headers:{Cookie:p.cookie}}));
  assert.equal(before.status,200);assert.equal(before.value.ready,false);assert.equal(before.value.status.catalog.code,'CATALOG_NOT_READ');
  assert.deepEqual(before.value.catalog,{available:false,catalog:null});
  const early=keep(await s.post(p,'/game-day/api/source/events',{revision:'0'.repeat(64),offset:0,limit:50}));
  assert.equal(early.status,409);assert.equal(early.value.code,'CATALOG_UNAVAILABLE');
  // Refresh, then page through events and one event's selections.
  const refreshed=keep(await s.post(p,'/game-day/api/source/refresh',{}));
  assert.equal(refreshed.status,200,refreshed.text);assert.equal(refreshed.value.ok,true);assert.equal(refreshed.value.ready,false);
  const revision=refreshed.value.catalog.revision;assert.match(revision,/^[a-f0-9]{64}$/);
  const events=keep(await s.post(p,'/game-day/api/source/events',{revision,offset:0,limit:50}));
  assert.equal(events.status,200);assert.equal(events.value.ready,false);assert.deepEqual(events.value.events.map(e=>e.eventKey),[m.event.eventKey]);
  const selections=keep(await s.post(p,'/game-day/api/source/selections',{revision,eventKey:m.event.eventKey,offset:0,limit:50}));
  assert.equal(selections.status,200);assert.deepEqual(selections.value.selections.map(x=>x.identityTuple),[m.identityTuple]);
  assert.equal(selections.value.selections[0].displayLabel,m.button.displayLabel,'the full source label');
  const after=keep(await s.request('/game-day/api/source/status',{headers:{Cookie:p.cookie}}));
  assert.equal(after.value.status.catalog.available,true);assert.equal(after.value.catalog.available,true);
  // The service's own codes keep their meaning over HTTP.
  const stale=keep(await s.post(p,'/game-day/api/source/events',{revision:'1'.repeat(64),offset:0,limit:50}));assert.equal(stale.status,409);assert.equal(stale.value.code,'CATALOG_REVISION_STALE');
  const missing=keep(await s.post(p,'/game-day/api/source/selections',{revision,eventKey:'no-such-event',offset:0,limit:50}));assert.equal(missing.status,404);assert.equal(missing.value.code,'CATALOG_EVENT_MISSING');
  const beyond=keep(await s.post(p,'/game-day/api/source/events',{revision,offset:5,limit:50}));assert.equal(beyond.status,400);assert.equal(beyond.value.code,'CATALOG_QUERY_INVALID');
  for(const r of responses)noPaths(r,f);
  // Close shuts the service; its provider boundary is free for a new adapter.
  await s.stop();
  const again=await serve(t,()=>({appRoot:f.parent,machineFile:file,configFile:path.join(f.parent,'config','spx.json')}));
  const p2=await again.page();assert.equal(p2.response.status,200,'a second adapter can open the same machine after close');
  assert.equal((await again.post(p2,'/game-day/api/source/refresh',{})).status,200);
});

test('source routes keep the exact HTTP schema, CSRF and Origin rules',async t=>{
  const f=await fixture(t),m=source();await f.publish(m);
  const file=await machineFile(f),s=await serve(t,()=>({appRoot:f.parent,machineFile:file,configFile:path.join(f.parent,'config','spx.json')}));
  const p=await s.page(),revision=(await s.post(p,'/game-day/api/source/refresh',{})).value.catalog.revision;
  const bad=[['refresh',{extra:true}],['refresh',[]],['events',{revision,offset:0}],['events',{revision,offset:0,limit:65}],['events',{revision,offset:0,limit:0}],
    ['events',{revision,offset:-1,limit:10}],['events',{revision:'A'.repeat(64),offset:0,limit:10}],['events',{revision,offset:0,limit:10,extra:1}],['events',{revision,offset:'0',limit:10}],
    ['selections',{revision,offset:0,limit:10}],['selections',{revision,eventKey:'',offset:0,limit:10}],['selections',{revision,eventKey:'a\u0000b',offset:0,limit:10}],
    ['selections',{revision,eventKey:'x'.repeat(129),offset:0,limit:10}],['selections',{revision,eventKey:7,offset:0,limit:10}]];
  for(const[name,json]of bad){const r=await s.post(p,'/game-day/api/source/'+name,json);assert.equal(r.status,400,name+' '+JSON.stringify(json));assert.deepEqual(r.value,{ok:false,code:'INVALID_REQUEST'});}
  assert.equal((await s.post(p,'/game-day/api/source/refresh',{},{'X-PiRaiders-CSRF':'f'.repeat(64)})).value.code,'CSRF_DENIED');
  assert.equal((await s.post(p,'/game-day/api/source/refresh',{},{Origin:'https://foreign.invalid'})).value.code,'ORIGIN_DENIED');
  assert.equal((await s.request('/game-day/api/source/refresh',{headers:{Cookie:p.cookie}})).status,405,'refresh is POST only');
  assert.equal((await s.request('/game-day/api/source/status?x=1',{headers:{Cookie:p.cookie}})).status,400,'no query strings');
  const unknown=await s.post(p,'/game-day/api/source/prepare',{});assert.equal(unknown.status,404,'no source preparation route in this slice');
  // Item 4c bodies are exact too.
  const tupleBody=[...m.identityTuple],win={start:'2026-10-23T18:00:00-05:00',end:'2026-10-23T23:45:00-05:00',prewarmMinutes:15};
  const badApproval=[['review',{}],['review',{identityTuple:tupleBody.slice(0,4)}],['review',{identityTuple:[...tupleBody.slice(0,4),7]}],['review',{identityTuple:[...tupleBody.slice(0,4),'x'.repeat(201)]}],
    ['review',{identityTuple:[...tupleBody.slice(0,4),'a\u0007b']}],['review',{identityTuple:tupleBody,extra:1}],['revoke',{identityTuple:'2026-2027'}],
    ['approve',{identityTuple:tupleBody,inspectionRevision:'0'.repeat(64)}],['approve',{identityTuple:tupleBody,inspectionRevision:'Z'.repeat(64),productionWindow:win}],
    ['approve',{identityTuple:tupleBody,inspectionRevision:'0'.repeat(64),productionWindow:{start:win.start,end:win.end}}],
    ['approve',{identityTuple:tupleBody,inspectionRevision:'0'.repeat(64),productionWindow:{...win,prewarmMinutes:61}}],
    ['approve',{identityTuple:tupleBody,inspectionRevision:'0'.repeat(64),productionWindow:{...win,start:'x'.repeat(41)}}],
    ['approve',{identityTuple:tupleBody,inspectionRevision:'0'.repeat(64),productionWindow:{...win,note:'x'}}]];
  for(const[name,json]of badApproval){const r=await s.post(p,'/game-day/api/source/'+name,json);assert.equal(r.status,400,name+' '+JSON.stringify(json));assert.deepEqual(r.value,{ok:false,code:'INVALID_REQUEST'});}
  assert.equal((await s.post(p,'/game-day/api/source/approve',{identityTuple:tupleBody,inspectionRevision:'0'.repeat(64),productionWindow:win},{'X-PiRaiders-CSRF':'f'.repeat(64)})).value.code,'CSRF_DENIED');
  assert.equal((await s.post(p,'/game-day/api/source/revoke',{identityTuple:tupleBody},{Origin:'https://foreign.invalid'})).value.code,'ORIGIN_DENIED');
  // The retained-root check still applies through HTTP.
  const g=await fixture(t);await g.publish(source());
  const wrongFile=await machineFile(g,{expectedCanonicalRoot:path.join(g.parent,'retained elsewhere')});
  const w=await serve(t,()=>({appRoot:g.parent,machineFile:wrongFile,configFile:path.join(g.parent,'config','spx.json')}));
  const wp=await w.page(),refused=await w.post(wp,'/game-day/api/source/refresh',{});
  assert.equal(refused.status,503);assert.deepEqual(refused.value,{ok:false,ready:false,code:'SOURCE_ROOT_MISMATCH'});noPaths(refused.text,g);
});

test('source routes follow the existing SPX login policy',async t=>{
  const f=await fixture(t);await f.publish(source());
  const file=await machineFile(f),s=await serve(t,()=>({appRoot:f.parent,machineFile:file,configFile:path.join(f.parent,'config','spx.json')}),{username:'operator',password:'synthetic'});
  const r=await s.request('/game-day/api/source/status');assert.equal(r.status,401);assert.equal(r.value.code,'AUTH_REQUIRED');
  const page=await s.request('/game-day');assert.equal(page.status,302,'the page sends an unsigned-in operator to the SPX login');
});

test('a local-folder adapter has no source routes, and the trusted options are exact',async t=>{
  const calls=[];const manager={snapshot:()=>({state:'idle'}),listEvents:async()=>({ok:true,events:[]}),prepare:async()=>({ok:true}),activate:async()=>({ok:true}),
    discardCandidate:async()=>({ok:true}),endDeadEvent:async()=>({ok:true}),dispatch:async action=>{calls.push(action);return{ok:true};},close:()=>Promise.resolve({ok:true})};
  const root=path.join(__dirname,'..');
  const s=await serve(t,()=>({manager,appRoot:root}));const p=await s.page();
  assert.equal((await s.request('/game-day/api/source/status',{headers:{Cookie:p.cookie}})).status,404);
  assert.equal((await s.post(p,'/game-day/api/source/refresh',{})).status,404);
  assert.equal((await s.request('/game-day/api/state',{headers:{Cookie:p.cookie}})).status,200,'local playback is unchanged');
  assert.equal((await s.post(p,'/game-day/api/command',{action:'stop',expectedEventId:null,expectedSelection:0})).status,200);assert.deepEqual(calls,['stop']);
  assert.ok(!p.response.text.includes('exchange folder'),'no source notice on a local-folder machine');
  assert.ok(p.response.text.includes('<body data-mode="local">')&&!p.response.text.includes('source-section'),'no exchange catalog screen on a local-folder machine');
  const service={refreshCatalog:async()=>{throw Object.assign(Error('C:\\private\\path'),{code:'X'});},catalogState:()=>({available:false,catalog:null}),
    catalogEventsPage:()=>{throw Error('boom');},catalogSelectionsPage:()=>({ok:false,code:'BUSY'}),
    reviewSelection:async()=>{throw Error('C:\\private\\review');},confirmSelection:async()=>({ok:false,code:'APPROVAL_CONFLICT'}),revokeSelection:async()=>({ok:false,code:'APPROVAL_MISSING'}),status:()=>({ready:false}),close:()=>{}};
  assert.throws(()=>createGameDayWeb({port:1,appRoot:root,manager,sourceService:service}),{code:'APP_CONFIG_INVALID'});
  assert.throws(()=>createGameDayWeb({port:1,appRoot:root,sourceService:{...service,close:undefined}}),{code:'APP_CONFIG_INVALID'});
  const fake=await serve(t,()=>({sourceService:service,appRoot:root}));const fp=await fake.page();
  const thrown=await fake.post(fp,'/game-day/api/source/refresh',{});assert.equal(thrown.status,503);assert.deepEqual(thrown.value,{ok:false,code:'SOURCE_SERVICE_FAILED'});
  assert.ok(!thrown.text.includes('private'),'a thrown error never reaches the page');
  assert.deepEqual((await fake.post(fp,'/game-day/api/source/events',{revision:'0'.repeat(64),offset:0,limit:1})).value,{ok:false,code:'SOURCE_SERVICE_FAILED'});
  assert.equal((await fake.post(fp,'/game-day/api/source/selections',{revision:'0'.repeat(64),eventKey:'e',offset:0,limit:1})).status,409);
  // Item 4c: the confirmation methods are part of the exact service shape.
  for(const name of ['reviewSelection','confirmSelection','revokeSelection'])
    assert.throws(()=>createGameDayWeb({port:1,appRoot:root,sourceService:{...service,[name]:undefined}}),{code:'APP_CONFIG_INVALID'});
  const tupleBody=['2026-2027','EV','BOARD','event','label'];
  const review=await fake.post(fp,'/game-day/api/source/review',{identityTuple:tupleBody});
  assert.deepEqual([review.status,review.value],[503,{ok:false,code:'SOURCE_SERVICE_FAILED'}]);assert.ok(!review.text.includes('private'));
  const windowBody={start:'2026-10-23T18:00:00-05:00',end:'2026-10-23T23:45:00-05:00',prewarmMinutes:15};
  assert.equal((await fake.post(fp,'/game-day/api/source/approve',{identityTuple:tupleBody,inspectionRevision:'0'.repeat(64),productionWindow:windowBody})).status,409);
  assert.equal((await fake.post(fp,'/game-day/api/source/revoke',{identityTuple:tupleBody})).status,503);
});

// Item 4c over real HTTP: review, approve and revoke with the real service
// and the real approval store on temporary synthetic folders.
test('a source machine reviews, approves and revokes one selection over HTTP, path-free',async t=>{
  const {createExchangeApprovalStore}=require('../scripts/lib/exchange-approval-store.cjs');
  const f=await fixture(t),m=source();await f.publish(m);
  const file=await machineFile(f),raw=JSON.parse(await fs.readFile(file,'utf8'));
  const s=await serve(t,()=>({appRoot:f.parent,machineFile:file,configFile:path.join(f.parent,'config','spx.json')}));
  const p=await s.page(),responses=[];const keep=r=>{responses.push(r.text);return r;};
  const tupleBody=[...m.identityTuple],win={start:'2026-10-23T18:00:00-05:00',end:'2026-10-23T23:45:00-05:00',prewarmMinutes:20};
  // No approval store yet: review still shows the selection; nothing can be written.
  const first=keep(await s.post(p,'/game-day/api/source/review',{identityTuple:tupleBody}));
  assert.equal(first.status,200,first.text);assert.equal(first.value.approval.read,false);assert.equal(first.value.approval.code,'APPROVAL_MISSING');
  assert.equal(first.value.inspection.selection.displayLabel,m.button.displayLabel);assert.equal(first.value.admissionEligible,true);
  const noStore=keep(await s.post(p,'/game-day/api/source/approve',{identityTuple:tupleBody,inspectionRevision:first.value.inspection.revision,productionWindow:win}));
  assert.equal(noStore.status,503);assert.equal(noStore.value.code,'APPROVAL_MISSING');
  await fs.mkdir(path.dirname(raw.source.approvalDirectory),{recursive:true});
  assert.equal((await createExchangeApprovalStore().initialize(raw.source.approvalDirectory,raw.source.approvalStoreId)).ok,true);
  const review=keep(await s.post(p,'/game-day/api/source/review',{identityTuple:tupleBody}));
  assert.deepEqual(review.value.approval,{read:true,code:null,revision:0,record:null});
  const stale=keep(await s.post(p,'/game-day/api/source/approve',{identityTuple:tupleBody,inspectionRevision:'0'.repeat(64),productionWindow:win}));
  assert.equal(stale.status,409);assert.equal(stale.value.code,'APPROVAL_INSPECTION_STALE');
  const backwards=keep(await s.post(p,'/game-day/api/source/approve',{identityTuple:tupleBody,inspectionRevision:review.value.inspection.revision,productionWindow:{...win,start:win.end,end:win.start}}));
  assert.equal(backwards.status,400);assert.equal(backwards.value.code,'APPROVAL_WINDOW_INVALID');
  const approved=keep(await s.post(p,'/game-day/api/source/approve',{identityTuple:tupleBody,inspectionRevision:review.value.inspection.revision,productionWindow:win}));
  assert.equal(approved.status,200,approved.text);
  assert.deepEqual(approved.value,{ok:true,ready:false,changed:true,revision:1,approval:{productionWindow:{start:'2026-10-23T23:00:00.000Z',end:'2026-10-24T04:45:00.000Z',prewarmMinutes:20},current:true,offlinePinned:false}});
  const status=keep(await s.request('/game-day/api/source/status',{headers:{Cookie:p.cookie}}));
  assert.equal(status.value.status.approvals.read,true);assert.equal(status.value.status.approvals.revision,1);assert.equal(status.value.status.ready,false);
  assert.deepEqual(keep(await s.post(p,'/game-day/api/source/review',{identityTuple:tupleBody})).value.approval.record,approved.value.approval);
  // The approval is now the one selection playback can prepare (item 4d).
  const events=keep(await s.request('/game-day/api/events',{headers:{Cookie:p.cookie}}));
  assert.equal(events.status,200,events.text);assert.equal(events.value.events.length,1);assert.match(events.value.events[0].eventId,/^sel-[a-f0-9]{40}$/);
  const revoked=keep(await s.post(p,'/game-day/api/source/revoke',{identityTuple:tupleBody}));
  assert.equal(revoked.status,200);assert.deepEqual(revoked.value,{ok:true,ready:false,changed:true,revision:2,approval:null});
  assert.equal((await createExchangeApprovalStore().open(raw.source.approvalDirectory,raw.source.approvalStoreId)).approvals.length,0,'the store holds the revocation');
  assert.deepEqual(keep(await s.request('/game-day/api/events',{headers:{Cookie:p.cookie}})).value,{ok:true,events:[]},'a revoked selection leaves the list');
  for(const r of responses)noPaths(r,f);
});

// Item 4d over real HTTP: an approved selection is prepared, started, played
// and stopped through the ordinary playback routes. The runtime is a trusted
// synthetic one (no Caspar here); it receives the service's own driver.
test('a source machine prepares, starts and stops an approved selection over HTTP',async t=>{
  const {createExchangeApprovalStore}=require('../scripts/lib/exchange-approval-store.cjs');
  const {isExchangePreparedMedia}=require('../scripts/lib/exchange-source-provider.cjs');
  const f=await fixture(t),m=source();await f.publish(m);
  const file=await machineFile(f),raw=JSON.parse(await fs.readFile(file,'utf8'));
  await fs.mkdir(path.dirname(raw.source.approvalDirectory),{recursive:true});
  assert.equal((await createExchangeApprovalStore().initialize(raw.source.approvalDirectory,raw.source.approvalStoreId)).ok,true);
  const seen={profiles:[],actions:[],closes:0,fail:false};
  const runtimeFactory=async(profile,options)=>{
    assert.equal(isExchangePreparedMedia(options.preparedMedia,profile),true);seen.profiles.push(profile);
    if(seen.fail)throw Object.assign(Error('PROFILE_PATHS'),{code:'PROFILE_PATHS'});
    await options.preparedMedia.initial({privateRoots:options.privateRoots});
    let state='prepared';
    return{candidateAdmissionToken:()=>options.preparedMedia.admissionToken(),start:async()=>{state='ready';},close:async()=>{seen.closes++;state='closed';options.preparedMedia.close();},
      snapshot:()=>({preparing:false,state,ready:state==='ready',windowAllowed:false}),dispatch:async action=>{seen.actions.push(action);return{ok:true};}};
  };
  assert.throws(()=>createGameDayWeb({port:1,appRoot:f.parent,runtimeFactory:'no',machineFile:file}),{code:'APP_CONFIG_INVALID'});
  assert.throws(()=>createGameDayWeb({port:1,appRoot:f.parent,runtimeFactory,sourceService:{}}),{code:'APP_CONFIG_INVALID'});
  const s=await serve(t,()=>({appRoot:f.parent,machineFile:file,configFile:path.join(f.parent,'config','spx.json'),runtimeFactory}));
  const p=await s.page(),responses=[];const keep=r=>{responses.push(r.text);return r;};
  const tupleBody=[...m.identityTuple],win={start:'2026-10-23T18:00:00-05:00',end:'2026-10-23T23:45:00-05:00',prewarmMinutes:20};
  const review=keep(await s.post(p,'/game-day/api/source/review',{identityTuple:tupleBody}));
  assert.equal(keep(await s.post(p,'/game-day/api/source/approve',{identityTuple:tupleBody,inspectionRevision:review.value.inspection.revision,productionWindow:win})).status,200);
  const events=keep(await s.request('/game-day/api/events',{headers:{Cookie:p.cookie}})),id=events.value.events[0].eventId;
  const request=async extra=>{const st=(await s.request('/game-day/api/state',{headers:{Cookie:p.cookie}})).value.state;return{expectedEventId:st.expectedEventId,expectedSelection:st.expectedSelection,...extra};};
  // A runtime that cannot be built is a plain preparation failure.
  seen.fail=true;const failed=keep(await s.post(p,'/game-day/api/prepare',await request({eventId:id})));
  assert.equal(failed.status,422);assert.equal(failed.value.code,'PREPARE_FAILED');seen.fail=false;
  const prepared=keep(await s.post(p,'/game-day/api/prepare',await request({eventId:id})));
  assert.equal(prepared.status,200,prepared.text);
  const profile=seen.profiles.at(-1);assert.deepEqual(profile.media.identityTuple,tupleBody);assert.equal(profile.productionWindow.prewarmMinutes,20);
  assert.equal(profile.caspar.runtimeDir,path.join(raw.runtimeRoot,id));
  const activated=keep(await s.post(p,'/game-day/api/activate',await request({candidateId:prepared.value.candidateId})));
  assert.equal(activated.status,200,activated.text);
  const state=keep(await s.request('/game-day/api/state',{headers:{Cookie:p.cookie}})).value.state;
  assert.equal(state.state,'active');assert.equal(state.active.eventId,id);assert.equal(state.active.runtime.ready,true);
  assert.equal(state.receiverVerified,false);assert.equal(state.boardVerified,false);
  assert.equal(keep(await s.post(p,'/game-day/api/command',await request({action:'next'}))).status,200);
  assert.equal(keep(await s.post(p,'/game-day/api/command',await request({action:'stop'}))).status,200);
  assert.deepEqual(seen.actions,['next','stop']);
  // A source route for preparation still does not exist: playback uses the ordinary routes.
  assert.equal((await s.post(p,'/game-day/api/source/prepare',{})).status,404);
  for(const r of responses)noPaths(r,f);
  // Close stops the runtime first, then frees the provider for a new adapter.
  await s.stop();assert.equal(seen.closes,1);
  const again=await serve(t,()=>({appRoot:f.parent,machineFile:file,configFile:path.join(f.parent,'config','spx.json'),runtimeFactory}));
  const p2=await again.page();assert.equal(p2.response.status,200);
  assert.equal((await again.request('/game-day/api/events',{headers:{Cookie:p2.cookie}})).value.events[0].eventId,id,'the same id after a restart');
});
