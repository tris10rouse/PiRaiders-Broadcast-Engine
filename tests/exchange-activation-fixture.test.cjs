'use strict';
// BE-006 item 5a part 1: the synthetic exchange folder the Windows activation
// proof publishes is accepted by the Engine's own loader, catalog, review,
// approval and preparation code, and its pictures come out of the prepared
// cache in the published order. Real HTTP and the real source service; the
// runtime is a trusted synthetic one (no Caspar here). Synthetic data only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const express=require('express'),session=require('express-session'),exphbs=require('express-handlebars');
const {PNG}=require('pngjs'),jpeg=require('jpeg-js');
const {createGameDayWeb}=require('../scripts/lib/game-day-web.cjs');
const {buildExchangeActivationFixture,exchangeDocuments,ACTIVATION_PICTURES,ACTIVATION_SIZE}=require('../scripts/exchange-activation-fixture.cjs');
const VIEWS=path.join(__dirname,'..','views');

async function tempRoot(t){const parent=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders activation ')));
  t.after(()=>fs.rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100}));return parent;}
async function proofMachine(t,options){
  const parent=await tempRoot(t),appRoot=path.join(parent,'app'),root=path.join(parent,'proof');
  await fs.mkdir(path.join(appRoot,'config'),{recursive:true});await fs.writeFile(path.join(appRoot,'config','spx.json'),'{}');
  const built=await buildExchangeActivationFixture({root,...options,machine:{spxConfigFile:'config/spx.json',
    caspar:{executable:path.join(appRoot,'components','casparcg.exe'),cwd:path.join(appRoot,'components')},output:{type:'none'},
    rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}}}});
  return{parent,appRoot,root,built};
}
function decode(bytes){
  const image=bytes[0]===0xff?jpeg.decode(bytes,{useTArray:true}):PNG.sync.read(bytes);
  const {width,height,data}=image,at=(x,y)=>[...data.subarray((y*width+x)*4,(y*width+x)*4+3)];
  return{width,height,corners:[at(0,0),at(width-1,0),at(0,height-1),at(width-1,height-1),at(width>>1,height>>1)]};
}
function near(actual,expected,tolerance=6){return actual.every((v,i)=>Math.abs(v-expected[i])<=tolerance);}
async function serve(t,options){
  const prior=global.config;global.config={general:{username:'',password:''}};
  const app=express();app.engine('handlebars',exphbs.engine({extname:'.handlebars'}));app.set('view engine','handlebars');app.set('views',VIEWS);
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port,origin='http://127.0.0.1:'+port,web=createGameDayWeb({port,...options});
  app.use(web.guard);app.use(session({secret:'synthetic-activation',resave:false,saveUninitialized:false}));app.use(web.router);
  let stopped=false;const stop=async()=>{if(stopped)return;stopped=true;await web.close();await new Promise(resolve=>server.close(resolve));global.config=prior;};t.after(stop);
  function request(url,{method='GET',headers={},json}={}){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:url,method,agent:false,
    headers:{Host:'127.0.0.1:'+port,...(json===undefined?{}:{'Content-Type':'application/json'}),...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));
    res.on('end',()=>{const text=Buffer.concat(chunks).toString();let value;try{value=JSON.parse(text);}catch{}resolve({status:res.statusCode,text,value,headers:res.headers});});});
    req.on('error',reject);req.end(json===undefined?undefined:JSON.stringify(json));});}
  const response=await request('/game-day'),token=/name="piraiders-csrf" content="([a-f0-9]{64})"/.exec(response.text)?.[1],cookie=response.headers['set-cookie']?.[0].split(';')[0];
  return{stop,page:response,get:url=>request(url,{headers:{Cookie:cookie}}),
    post:(url,json)=>request(url,{method:'POST',json,headers:{Origin:origin,Cookie:cookie,'X-PiRaiders-CSRF':token,'Sec-Fetch-Site':'same-origin','Sec-Fetch-Mode':'cors','Sec-Fetch-Dest':'empty'}})};
}
const WINDOW={start:'2026-10-23T18:00:00-05:00',end:'2026-10-23T23:45:00-05:00',prewarmMinutes:0};

test('the activation documents are deterministic full-frame pictures in a fixed order',()=>{
  const a=exchangeDocuments(),b=exchangeDocuments();
  assert.equal(a.playbackFingerprint,b.playbackFingerprint,'same fingerprint every time');
  assert.deepEqual([...a.files.keys()],[...b.files.keys()]);for(const [k,v] of a.files)assert.equal(Buffer.compare(v,b.files.get(k)),0,k);
  assert.deepEqual(a.order.map(p=>p.name),ACTIVATION_PICTURES.map(p=>p.name));
  assert.equal(new Set(a.order.map(p=>p.rgb.join())).size,3,'three distinct colours');
  const assets=[...a.files.keys()].filter(k=>k.startsWith('assets/'));assert.equal(assets.length,3);
  const formats=assets.map(k=>path.extname(k)).sort();assert.deepEqual(formats,['.jpg','.png','.png'],'PNG and JPEG on the exchange path');
  for(const k of assets){const d=decode(a.files.get(k));assert.equal(d.width,ACTIVATION_SIZE.width);assert.equal(d.height,ACTIVATION_SIZE.height);
    assert.ok(a.order.some(p=>d.corners.every(c=>near(c,p.rgb))),'each picture is one solid proof colour: '+k);}
  // Nothing in the published folder looks like a real identity or a path.
  for(const [k,v] of a.files)if(k.endsWith('.json')){const text=v.toString();assert.doesNotMatch(text,/@|https?:|[A-Za-z]:\\|\/home\/|\/tmp\//,k);}
});

test('the builder refuses a used folder and bad options, and writes nothing then',async t=>{
  const parent=await tempRoot(t);
  await assert.rejects(buildExchangeActivationFixture({root:'relative',machine:{}}),{code:'FIXTURE_OPTIONS_INVALID'});
  await assert.rejects(buildExchangeActivationFixture({root:parent}),{code:'FIXTURE_OPTIONS_INVALID'});
  await fs.writeFile(path.join(parent,'keep.txt'),'x');
  await assert.rejects(buildExchangeActivationFixture({root:parent,machine:{}}),{code:'FIXTURE_ROOT_NOT_EMPTY'});
  assert.deepEqual(await fs.readdir(parent),['keep.txt']);
});

test('the proof folder goes from refresh to approved, prepared, active and stopped through the real routes',async t=>{
  const {parent,appRoot,built}=await proofMachine(t),raw=JSON.parse(await fs.readFile(built.machineFile,'utf8'));
  assert.equal(raw.source.expectedCanonicalRoot,built.sourceRoot);assert.notEqual(raw.source.journalStoreId,raw.source.approvalStoreId);
  const seen={prepared:null,actions:[]};
  const runtimeFactory=async(profile,options)=>{
    seen.prepared=await options.preparedMedia.initial({privateRoots:options.privateRoots});let state='prepared';
    return{candidateAdmissionToken:()=>options.preparedMedia.admissionToken(),start:async()=>{state='ready';},close:async()=>{state='closed';options.preparedMedia.close();},
      snapshot:()=>({preparing:false,state,ready:state==='ready',windowAllowed:false}),dispatch:async action=>{seen.actions.push(action);return{ok:true};}};
  };
  const s=await serve(t,{appRoot,machineFile:built.machineFile,configFile:path.join(appRoot,'config','spx.json'),runtimeFactory});
  assert.equal(s.page.status,200);assert.match(s.page.text,/<body data-mode="source">/);
  const texts=[];const keep=r=>{texts.push(r.text);return r;};
  const refreshed=keep(await s.post('/game-day/api/source/refresh',{}));assert.equal(refreshed.status,200,refreshed.text);
  const revision=refreshed.value.catalog.revision;
  const events=keep(await s.post('/game-day/api/source/events',{revision,offset:0,limit:50}));assert.deepEqual(events.value.events.map(e=>e.eventKey),[built.identityTuple[1]]);
  const selections=keep(await s.post('/game-day/api/source/selections',{revision,eventKey:built.identityTuple[1],offset:0,limit:50}));
  assert.deepEqual(selections.value.selections.map(x=>x.identityTuple),[built.identityTuple]);
  const review=keep(await s.post('/game-day/api/source/review',{identityTuple:built.identityTuple}));
  assert.equal(review.status,200,review.text);assert.deepEqual(review.value.approval,{read:true,code:null,revision:0,record:null},'the setup step left an empty approval list');
  const approved=keep(await s.post('/game-day/api/source/approve',{identityTuple:built.identityTuple,inspectionRevision:review.value.inspection.revision,productionWindow:WINDOW}));
  assert.equal(approved.status,200,approved.text);
  const listed=keep(await s.get('/game-day/api/events'));assert.equal(listed.value.events.length,1);const id=listed.value.events[0].eventId;
  const expect=async extra=>{const st=(await s.get('/game-day/api/state')).value.state;return{expectedEventId:st.expectedEventId,expectedSelection:st.expectedSelection,...extra};};
  const prepared=keep(await s.post('/game-day/api/prepare',await expect({eventId:id})));assert.equal(prepared.status,200,prepared.text);
  // The prepared cache holds the three pictures in the published order.
  const slides=seen.prepared.deck.slides;assert.equal(slides.length,built.order.length);
  for(let i=0;i<slides.length;i++){
    const file=path.isAbsolute(slides[i].src)?slides[i].src:path.join(seen.prepared.snapshotDir,...slides[i].src.split('/'));
    assert.ok(file.startsWith(path.join(parent,'proof','cache')+path.sep),'prepared from the Engine cache, not the exchange folder');
    const d=decode(await fs.readFile(file));assert.equal(d.width,1920);assert.equal(d.height,1080);
    assert.ok(d.corners.every(c=>near(c,built.order[i].rgb)),'slide '+(i+1)+' is '+built.order[i].name);
  }
  assert.equal(keep(await s.post('/game-day/api/activate',await expect({candidateId:prepared.value.candidateId}))).status,200);
  assert.equal((await s.get('/game-day/api/state')).value.state.state,'active');
  assert.equal(keep(await s.post('/game-day/api/command',await expect({action:'next'}))).status,200);
  assert.equal(keep(await s.post('/game-day/api/command',await expect({action:'stop'}))).status,200);
  assert.deepEqual(seen.actions,['next','stop']);
  for(const text of texts)for(const p of [parent,built.sourceRoot,...built.privateRoots])assert.equal(text.includes(p)||text.includes(JSON.stringify(p).slice(1,-1)),false,'no private path in an answer');
});

test('without the approval setup step nothing can be approved (the step is what makes approval possible)',async t=>{
  const {appRoot,built}=await proofMachine(t,{initializeApprovals:false});
  const s=await serve(t,{appRoot,machineFile:built.machineFile,configFile:path.join(appRoot,'config','spx.json')});
  assert.equal((await s.post('/game-day/api/source/refresh',{})).status,200);
  const review=await s.post('/game-day/api/source/review',{identityTuple:built.identityTuple});
  assert.equal(review.value.approval.code,'APPROVAL_MISSING');
  const approve=await s.post('/game-day/api/source/approve',{identityTuple:built.identityTuple,inspectionRevision:review.value.inspection.revision,productionWindow:WINDOW});
  assert.equal(approve.status,503);assert.equal(approve.value.code,'APPROVAL_MISSING');
});
