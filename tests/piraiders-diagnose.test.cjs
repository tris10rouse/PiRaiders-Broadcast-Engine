'use strict';
// BE-006 item 5c part 3: the diagnostics command. Real loader, reader,
// approval store and setup step on temporary folders, the real Game Day web
// adapter for the running app; synthetic exchange documents only. No Windows.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto');
const express=require('express'),session=require('express-session'),exphbs=require('express-handlebars');
const {loadGameDayMachineConfig}=require('../scripts/lib/game-day-catalog.cjs');
const {setupSourceMachine}=require('../scripts/lib/exchange-setup.cjs');
const {createGameDayWeb}=require('../scripts/lib/game-day-web.cjs');
const {exchangeDocuments}=require('../scripts/exchange-activation-fixture.cjs');
const {main}=require('../scripts/piraiders-diagnose.cjs');
const SIX=['exchangeFolder','catalogSequence','approvals','prepared','renderer','ndiSender'];
const VIEWS=path.join(__dirname,'..','views');

async function tempRoot(t){const parent=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders diagnose ')));
  t.after(()=>fs.rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100}));return parent;}
async function freePort(){const s=http.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
// An app root whose SPX config names the port, a synthetic exchange folder
// and a source machine file; with setup, its journal and approval list.
async function machineFile(t,{change=raw=>raw,setup=true,port}={}){
  const parent=await tempRoot(t),appRoot=path.join(parent,'app'),exchange=path.join(parent,'exchange'),docs=exchangeDocuments();
  await fs.mkdir(path.join(appRoot,'config'),{recursive:true});
  const spx=path.join(appRoot,'config','spx.json');await fs.writeFile(spx,JSON.stringify({general:{port:port??await freePort()}}));
  let sequence=null;
  for(const [relative,bytes] of docs.files){const file=path.join(exchange,...relative.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);
    if(relative==='catalog.json')sequence=JSON.parse(Buffer.from(bytes).toString()).catalogSequence;}
  for(const dir of ['cache','runtime','catalog'])await fs.mkdir(path.join(parent,dir));
  const raw={schemaVersion:1,spxConfigFile:'config/spx.json',catalogDirectory:path.join(parent,'catalog'),mediaRoot:exchange,cacheRoot:path.join(parent,'cache'),runtimeRoot:path.join(parent,'runtime'),
    caspar:{executable:path.join(appRoot,'components','casparcg.exe'),cwd:path.join(appRoot,'components')},output:{type:'none'},
    rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}},
    source:{providerId:'diagnose-test',journalDirectory:path.join(parent,'private','journal'),journalStoreId:crypto.randomUUID(),
      approvalDirectory:path.join(parent,'private','approvals'),approvalStoreId:crypto.randomUUID(),expectedCanonicalRoot:exchange,binding:{...docs.binding}}};
  const changed=change(raw,parent),file=path.join(parent,'machine.json');await fs.writeFile(file,JSON.stringify(changed));
  const options={appRoot,nodeExecutable:process.execPath};
  if(setup&&changed.source)assert.equal((await setupSourceMachine(await loadGameDayMachineConfig(file,options))).ok,true);
  return{parent,appRoot,file,raw:changed,exchange,spx,sequence,binding:docs.binding,options};
}
async function setPort(m,port){await fs.writeFile(m.spx,JSON.stringify({general:{port}}));}
const run=(m,argv=['--machine',m.file])=>main(argv,m.options);
function states(answer){return Object.fromEntries(SIX.map(k=>[k,answer.states[k].state]));}
function private_(m){return[m.parent,m.exchange,m.raw.source?.journalStoreId,m.raw.source?.approvalStoreId,m.binding.feedId].filter(Boolean);}
function clean(answer,m){
  assert.deepEqual(Object.keys(answer.states),SIX,'exactly the six states of 5c-1, in order');
  assert.equal(answer.ready,false);
  assert.deepEqual([...answer.neverClaimed],['sourceDiscovered','receiverConnected','boardInputSelected','onAir']);
  const text=JSON.stringify(answer);
  for(const secret of private_(m))assert.equal(text.includes(secret),false,'no private path or id in the answer');
  assert.doesNotMatch(JSON.stringify({...answer,neverClaimed:undefined}),/air|receiver|board|discovered|verified/i);
}
// Every file under the private stores and the exchange folder, with its size
// and modification time: the command must change none of them.
async function tree(dir){const out=[];async function walk(d){let entries;try{entries=await fs.readdir(d,{withFileTypes:true});}catch{return;}
  for(const e of entries){const p=path.join(d,e.name),s=await fs.lstat(p);out.push([path.relative(dir,p),s.size,s.mtimeMs].join(':'));if(e.isDirectory())await walk(p);}}
  await walk(dir);return out.sort();}

// The real Game Day web adapter on the port the SPX config names.
async function serveApp(t,m,{username='',password=''}={}){
  const prior=global.config;global.config={general:{username,password}};
  const app=express();app.engine('handlebars',exphbs.engine({extname:'.handlebars'}));app.set('view engine','handlebars');app.set('views',VIEWS);
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await setPort(m,port);
  const web=createGameDayWeb({port,appRoot:m.appRoot,machineFile:m.file,configFile:m.spx});
  app.use(web.guard);app.use(session({secret:'synthetic-diagnose',resave:false,saveUninitialized:false}));app.use(web.router);
  let stopped=false;const stop=async()=>{if(stopped)return;stopped=true;await web.close();await new Promise(resolve=>server.close(resolve));global.config=prior;};
  t.after(stop);return{port,stop};
}
// A stand-in that answers on the port with a fixed body.
async function serveText(t,m,status,body){
  const server=http.createServer((req,res)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(typeof body==='string'?body:JSON.stringify(body));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await setPort(m,server.address().port);
  t.after(()=>new Promise(resolve=>server.close(resolve)));
}

test('arguments: exit 2 for wrong arguments, 1 for a machine file that cannot be loaded',async t=>{
  const m=await machineFile(t,{setup:false});
  for(const argv of [[],['--machine'],['--machine','relative.json'],['--other',m.file],['--machine',m.file,'extra']]){
    const r=await run(m,argv);assert.equal(r.exitCode,2);assert.deepEqual(r.answer,{ok:false,code:'DIAGNOSE_USAGE'});}
  const bad=await run(m,['--machine',path.join(m.parent,'absent.json')]);
  assert.equal(bad.exitCode,1);assert.deepEqual(bad.answer,{ok:false,code:'MACHINE_CONFIG_INVALID'});
});

test('with the app closed: the three store states from the stores, the three runtime states unknown, nothing written',async t=>{
  const m=await machineFile(t);
  const before=[await tree(path.join(m.parent,'private')),await tree(m.exchange)];
  const r=await run(m);
  assert.equal(r.exitCode,0);assert.equal(r.answer.ok,true);clean(r.answer,m);
  assert.equal(r.answer.mode,'source');assert.equal(r.answer.app,'not-running');
  assert.deepEqual(states(r.answer),{exchangeFolder:'reachable',catalogSequence:'read',approvals:'readable',prepared:'unknown',renderer:'unknown',ndiSender:'unknown'});
  assert.equal(r.answer.states.catalogSequence.sequence,m.sequence,'the sequence in the exchange catalog');
  for(const k of ['prepared','renderer','ndiSender'])assert.deepEqual(r.answer.states[k],{state:'unknown',code:'APP_NOT_RUNNING',from:'app'});
  for(const k of ['exchangeFolder','catalogSequence','approvals'])assert.equal(r.answer.states[k].from,'stores');
  assert.deepEqual([await tree(path.join(m.parent,'private')),await tree(m.exchange)],before,'the command writes nothing');
});

test('store states name what is wrong: no approval list yet, a missing or moved folder, a foreign feed',async t=>{
  const fresh=await machineFile(t,{setup:false});
  let r=await run(fresh);assert.equal(r.exitCode,0);clean(r.answer,fresh);
  assert.deepEqual(r.answer.states.approvals,{state:'unreadable',code:'APPROVAL_MISSING',from:'stores'});
  assert.equal(r.answer.states.exchangeFolder.state,'reachable');
  assert.equal(await fs.lstat(path.join(fresh.parent,'private')).then(()=>true,()=>false),false,'no store made');

  const gone=await machineFile(t);await fs.rename(gone.exchange,gone.exchange+'-away');
  r=await run(gone);clean(r.answer,gone);
  assert.deepEqual(r.answer.states.exchangeFolder,{state:'unreachable',code:'SOURCE_UNAVAILABLE',from:'stores'});
  assert.deepEqual(r.answer.states.catalogSequence,{state:'unavailable',code:'SOURCE_UNAVAILABLE',sequence:null,from:'stores'});
  assert.equal(r.answer.states.approvals.state,'readable','approvals are read from their own store');
  // A file where the folder was is not a reachable folder.
  await fs.writeFile(gone.exchange,'not a folder');
  r=await run(gone);assert.equal(r.answer.states.exchangeFolder.state,'unreachable');

  const moved=await machineFile(t,{setup:false,change:(raw,parent)=>({...raw,source:{...raw.source,expectedCanonicalRoot:path.join(parent,'elsewhere')}})});
  await fs.mkdir(path.join(moved.parent,'elsewhere'));
  r=await run(moved);clean(r.answer,moved);
  assert.deepEqual(r.answer.states.exchangeFolder,{state:'mismatch',code:'SOURCE_ROOT_MISMATCH',from:'stores'});
  assert.deepEqual(r.answer.states.catalogSequence,{state:'unavailable',code:'SOURCE_ROOT_MISMATCH',sequence:null,from:'stores'});

  const foreign=await machineFile(t,{setup:false,change:raw=>({...raw,source:{...raw.source,binding:{...raw.source.binding,epoch:raw.source.binding.epoch+1}}})});
  r=await run(foreign);clean(r.answer,foreign);
  assert.deepEqual(r.answer.states.catalogSequence,{state:'unavailable',code:'REBIND_REQUIRED',sequence:null,from:'stores'});
  // A corrupt approval list is unreadable with the store's own code.
  const corrupt=await machineFile(t);
  for(const name of await fs.readdir(corrupt.raw.source.approvalDirectory))await fs.writeFile(path.join(corrupt.raw.source.approvalDirectory,name),'{');
  r=await run(corrupt);assert.equal(r.answer.states.approvals.state,'unreadable');assert.match(r.answer.states.approvals.code,/^APPROVAL_[A-Z_]+$/);
});

test('with the app running: the runtime states come from its diagnostics route',async t=>{
  const m=await machineFile(t);await serveApp(t,m);
  const r=await run(m);assert.equal(r.exitCode,0);clean(r.answer,m);
  assert.equal(r.answer.app,'answered');
  assert.deepEqual(states(r.answer),{exchangeFolder:'reachable',catalogSequence:'read',approvals:'readable',prepared:'none',renderer:'not-active',ndiSender:'not-running'});
  for(const k of ['prepared','renderer','ndiSender'])assert.equal(r.answer.states[k].from,'app');
});

test('an app that answers but cannot be read is never called not running',async t=>{
  const locked=await machineFile(t);await serveApp(t,locked,{username:'operator',password:'synthetic'});
  let r=await run(locked);assert.equal(r.exitCode,0);clean(r.answer,locked);assert.equal(r.answer.app,'auth-required');
  for(const k of ['prepared','renderer','ndiSender'])assert.deepEqual(r.answer.states[k],{state:'unknown',code:'APP_AUTH_REQUIRED',from:'app'});

  const six=Object.fromEntries(SIX.map(k=>[k,{state:'unknown',code:null}]));
  const valid={ok:true,diagnostics:{scope:'game-day-diagnostics',ready:false,mode:'source',states:{...six,prepared:{state:'prepared',code:null},renderer:{state:'acknowledged',code:null},ndiSender:{state:'running',code:null}},
    neverClaimed:['sourceDiscovered','receiverConnected','boardInputSelected','onAir']}};
  const cases=[
    ['not JSON',200,'<html>','invalid-answer','APP_ANSWER_INVALID'],
    ['another app',404,{ok:false,code:'NOT_FOUND'},'invalid-answer','APP_ANSWER_INVALID'],
    ['wrong scope',200,{...valid,diagnostics:{...valid.diagnostics,scope:'other'}},'invalid-answer','APP_ANSWER_INVALID'],
    ['ready claimed',200,{...valid,diagnostics:{...valid.diagnostics,ready:true}},'invalid-answer','APP_ANSWER_INVALID'],
    ['on air',200,{...valid,diagnostics:{...valid.diagnostics,states:{...valid.diagnostics.states,ndiSender:{state:'on-air',code:null}}}},'invalid-answer','APP_ANSWER_INVALID'],
    ['path in a code',200,{...valid,diagnostics:{...valid.diagnostics,states:{...valid.diagnostics.states,renderer:{state:'waiting',code:'/private/x'}}}},'invalid-answer','APP_ANSWER_INVALID'],
    ['local app for a source machine',200,{...valid,diagnostics:{...valid.diagnostics,mode:'local'}},'mode-mismatch','APP_MODE_MISMATCH'],
    ['busy',503,{ok:false,code:'CLOSED'},'unavailable','APP_UNAVAILABLE']];
  for(const [name,status,body,app,code] of cases){
    const m=await machineFile(t);await serveText(t,m,status,body);
    r=await run(m);assert.equal(r.exitCode,0,name);clean(r.answer,m);assert.equal(r.answer.app,app,name);
    for(const k of ['prepared','renderer','ndiSender'])assert.deepEqual(r.answer.states[k],{state:'unknown',code,from:'app'},name);
    assert.equal(r.answer.states.exchangeFolder.state,'reachable',name);
  }
  const ok=await machineFile(t);await serveText(t,ok,200,valid);
  r=await run(ok);assert.equal(r.answer.app,'answered');
  assert.deepEqual([r.answer.states.prepared.state,r.answer.states.renderer.state,r.answer.states.ndiSender.state],['prepared','acknowledged','running']);
});

test('a listener that accepts but never answers in time is not "not running", and the read has a hard deadline',async t=>{
  const net=require('node:net'),sockets=new Set();
  const silent=net.createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});});
  // Sends headers, then one byte every 500 ms: an idle timeout alone never fires.
  const dribble=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});const timer=setInterval(()=>res.write(' '),500);res.on('close',()=>clearInterval(timer));});
  dribble.on('connection',socket=>sockets.add(socket));
  for(const server of [silent,dribble])await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{for(const s of sockets)s.destroy();await Promise.all([silent,dribble].map(server=>new Promise(r=>server.close(r))));});
  for(const server of [silent,dribble]){
    const m=await machineFile(t);await setPort(m,server.address().port);
    const started=Date.now(),r=await run(m),took=Date.now()-started;
    assert.equal(r.exitCode,0);clean(r.answer,m);assert.equal(r.answer.app,'no-answer');
    for(const k of ['prepared','renderer','ndiSender'])assert.deepEqual(r.answer.states[k],{state:'unknown',code:'APP_NO_ANSWER',from:'app'});
    assert.ok(took<4000,'bounded by the deadline, took '+took+' ms');
  }
});

test('a local machine has no exchange states; an unusable port in the SPX config is its own code',async t=>{
  const m=await machineFile(t,{setup:false,change:raw=>{const copy={...raw};delete copy.source;return copy;}});
  let r=await run(m);assert.equal(r.exitCode,0);clean(r.answer,m);assert.equal(r.answer.mode,'local');
  assert.deepEqual([r.answer.states.exchangeFolder,r.answer.states.catalogSequence,r.answer.states.approvals],
    [{state:'not-used',code:null,from:'stores'},{state:'not-used',code:null,sequence:null,from:'stores'},{state:'not-used',code:null,from:'stores'}]);
  assert.equal(r.answer.app,'not-running');
  await fs.writeFile(m.spx,JSON.stringify({general:{port:'5656; other'}}));
  r=await run(m);assert.equal(r.answer.app,'config-invalid');assert.equal(r.answer.states.renderer.code,'APP_PORT_INVALID');
  await fs.writeFile(m.spx,'{');
  r=await run(m);assert.equal(r.answer.app,'config-invalid');assert.equal(r.answer.states.renderer.code,'APP_PORT_INVALID');
  // A falsy port is 5656, as server.js's `port || 5656` (review, fence 79); a
  // stand-in on another port shows the command did not use it.
  await serveText(t,m,200,'<html>');const other=JSON.parse(await fs.readFile(m.spx,'utf8')).general.port;
  let asked=null;
  for(const port of [false,0,'',null]){
    await fs.writeFile(m.spx,JSON.stringify({general:{port}}));
    const {diagnoseMachine}=require('../scripts/lib/game-day-diagnose.cjs');
    const answer=await diagnoseMachine(await loadGameDayMachineConfig(m.file,m.options),{get:async p=>{asked=p;return{answered:false};}});
    assert.equal(asked,5656,String(port));assert.notEqual(asked,other);assert.equal(answer.app,'not-running');
  }
});
