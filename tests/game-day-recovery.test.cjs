'use strict';
// BE-006 item 5c parts 4 and 5: recovery from a missing exchange folder, a
// corrupt cached snapshot (5c-4), an unreadable approval list and a renderer
// (Caspar) process that dies while playing (5c-5). Real loader, reader, journal, approval store,
// cache, source service, manager and diagnostics on temporary folders;
// synthetic exchange documents from the activation fixture. The folder test
// runs the real prepared-event runtime and RossTalk session with a synthetic
// Caspar process and a scripted renderer page. Caspar, NDI and Windows are
// not here.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),http=require('node:http');
const {EventEmitter}=require('node:events'),{WebSocket}=require('ws');
const {loadGameDayMachineConfig}=require('../scripts/lib/game-day-catalog.cjs');
const {setupSourceMachine,pinOfflineApprovals}=require('../scripts/lib/exchange-setup.cjs');
const {createExchangeSourceService}=require('../scripts/lib/exchange-source-service.cjs');
const {createGameDayManager}=require('../scripts/lib/game-day-manager.cjs');
const {createPreparedEventRuntime}=require('../scripts/lib/prepared-event-runtime.cjs');
const {createRossTalkSession}=require('../scripts/lib/rosstalk-session.cjs');
const {diagnose}=require('../scripts/lib/game-day-diagnostics.cjs');
const {exchangeDocuments}=require('../scripts/exchange-activation-fixture.cjs');

const WINDOW={start:'2026-10-01T00:00:00Z',end:'2026-10-01T23:00:00Z',prewarmMinutes:15};
const NOON=Date.parse('2026-10-01T12:00:00Z');
const until=async(fn,ms=10000)=>{const end=Date.now()+ms;while(!fn()){if(Date.now()>end)throw Error('UNTIL_TIMEOUT');await new Promise(r=>setTimeout(r,10));}};

async function machineFile(t,{output}={}){
  const parent=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders recovery ')));
  t.after(()=>fs.rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const appRoot=path.join(parent,'app'),exchange=path.join(parent,'exchange'),docs=exchangeDocuments();
  await fs.mkdir(path.join(appRoot,'config'),{recursive:true});await fs.writeFile(path.join(appRoot,'config','spx.json'),'{}');
  // The runtime checks that the configured Caspar executable is a file; nothing runs it here.
  await fs.mkdir(path.join(appRoot,'components'),{recursive:true});await fs.writeFile(path.join(appRoot,'components','casparcg.exe'),'synthetic');
  for(const [relative,bytes] of docs.files){const file=path.join(exchange,...relative.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}
  for(const dir of ['cache','runtime','catalog'])await fs.mkdir(path.join(parent,dir));
  // An NDI output needs only the runtime library's file name here; nothing loads it.
  if(output==='ndi'){await fs.mkdir(path.join(parent,'ndi'));await fs.writeFile(path.join(parent,'ndi','Processing.NDI.Lib.x64.dll'),'synthetic');}
  const raw={schemaVersion:1,spxConfigFile:'config/spx.json',catalogDirectory:path.join(parent,'catalog'),mediaRoot:exchange,cacheRoot:path.join(parent,'cache'),runtimeRoot:path.join(parent,'runtime'),
    caspar:{executable:path.join(appRoot,'components','casparcg.exe'),cwd:path.join(appRoot,'components')},output:output==='ndi'?{type:'ndi',name:'PiRaiders Recovery',runtimeDirectory:path.join(parent,'ndi')}:{type:'none'},
    rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',5:'reload',8:'stop'}},
    source:{providerId:'recovery-test',journalDirectory:path.join(parent,'private','journal'),journalStoreId:crypto.randomUUID(),
      approvalDirectory:path.join(parent,'private','approvals'),approvalStoreId:crypto.randomUUID(),expectedCanonicalRoot:exchange,binding:{...docs.binding}}};
  const file=path.join(parent,'machine.json');await fs.writeFile(file,JSON.stringify(raw));
  const m={parent,appRoot,file,raw,exchange,docs,tuple:[...docs.identityTuple]};
  m.load=()=>loadGameDayMachineConfig(file,{appRoot,nodeExecutable:process.execPath});
  m.away=()=>fs.rename(exchange,path.join(parent,'exchange-away'));
  m.back=()=>fs.rename(path.join(parent,'exchange-away'),exchange);
  // A stray file in the approval folder: the store refuses the whole list
  // (APPROVAL_INVALID) and nothing in its history changes; removed, it reads again.
  const stray=path.join(raw.source.approvalDirectory,'stray');
  m.approvalsUnreadable=()=>fs.writeFile(stray,'not an approval');
  m.approvalsReadable=()=>fs.rm(stray);
  return m;
}
async function confirm(m){
  assert.equal((await setupSourceMachine(await m.load())).ok,true);
  const service=createExchangeSourceService(await m.load());
  try{
    const review=await service.reviewSelection(m.tuple);assert.equal(review.ok,true,review.code);
    const confirmed=await service.confirmSelection({identityTuple:m.tuple,inspectionRevision:review.inspection.revision,productionWindow:WINDOW});
    assert.equal(confirmed.ok,true,confirmed.code);
  }finally{service.close();}
}
// A stand-in runtime: it prepares through the service's driver and records
// the deck and the actions it is given.
function recorder(){
  const seen={prepared:[],actions:[]};
  const base=async(profile,options)=>{
    const prepared=await options.preparedMedia.initial({privateRoots:options.privateRoots});seen.prepared.push({mode:profile.media.startup.mode,prepared});
    let state='prepared';
    return{candidateAdmissionToken:()=>options.preparedMedia.admissionToken(),start:async()=>{state='ready';},close:async()=>{state='closed';options.preparedMedia.close();},
      snapshot:()=>({preparing:false,state,ready:state==='ready',windowAllowed:true,output:'none'}),dispatch:async action=>{seen.actions.push(action);return{ok:true};}};
  };
  return{seen,base};
}
// The real prepared-event runtime with a synthetic Caspar process and console.
// supervisor: the Caspar restart policy (5c-5 lets it restart).
function realRuntime(supervisor={maxRestarts:0}){
  const sessions=[],children=[];
  const base=(profile,options)=>createPreparedEventRuntime(profile,{...options,supervisorOptions:{platform:'linux',...supervisor},
    spawnProcess:()=>{const child=new EventEmitter();child.pid=4242+children.length;child.stdin={end(){setImmediate(()=>child.emit('exit',1));}};
      child.kill=()=>setImmediate(()=>child.emit('exit',0));
      // The process dies on its own, as a killed renderer does.
      child.crash=()=>child.emit('exit',null,'SIGKILL');
      children.push(child);setImmediate(()=>child.emit('spawn'));return child;},
    consoleFactory:child=>{const client=new EventEmitter();client.close=()=>child.stdin.end();client.request=async value=>({status:value==='VERSION'?201:202});return client;},
    sessionFactory:async raw=>{const session=await createRossTalkSession({...raw,rossTalk:{...raw.rossTalk,port:0}},{allowEphemeral:true});sessions.push(session);return session;}});
  return{sessions,children,base};
}
// A scripted program page: it joins the session, says ready and acknowledges every command.
async function programPage(t,session){
  const token=new URL(session.getProgramURL()).hash.slice('#piraiders='.length),origin=session.origin,url=new URL(origin);
  const cookie=await new Promise((resolve,reject)=>{
    const req=http.request({hostname:url.hostname,port:url.port,path:'/piraiders/session',method:'POST',agent:false,headers:{Origin:origin,Authorization:'Bearer '+token}},res=>{
      res.resume();res.on('end',()=>res.statusCode===204?resolve(res.headers['set-cookie'][0].split(';')[0]):reject(Error('BOOTSTRAP_FAILED')));});
    req.on('error',reject);req.end();
  });
  const ws=new WebSocket('ws://'+url.host+'/piraiders/socket.io/?EIO=4&transport=websocket',{headers:{Origin:origin,Cookie:cookie}}),commands=[];
  ws.on('error',()=>{});
  ws.on('message',bytes=>{
    const value=bytes.toString();
    if(value[0]==='0')ws.send('40'+JSON.stringify({token}));else if(value==='2')ws.send('3');
    else if(value.startsWith('42')){const [name,data]=JSON.parse(value.slice(2));
      if(name==='init')ws.send('42'+JSON.stringify(['ready',{epoch:data.epoch}]));
      if(name==='command'){commands.push(data);ws.send('42'+JSON.stringify(['ack',{epoch:data.epoch,id:data.id,ok:true}]));}}
  });
  t.after(()=>ws.terminate());
  await until(()=>session.snapshot().presentation.renderer.ready);
  return{commands};
}
function managerFor(t,service,machine,base){
  const manager=createGameDayManager({catalog:service.playbackCatalog,runtimeFactory:service.preparedRuntimeFactory(base),clock:()=>NOON,
    sourceRoot:machine.mediaRoot,privateRoots:[machine.runtimeRoot,machine.catalogDirectory,machine.source.approvalDirectory],...service.admission});
  t.after(()=>manager.close());return manager;
}
const request=(manager,extra)=>{const s=manager.snapshot();return{expectedEventId:s.expectedEventId,expectedSelection:s.expectedSelection,...extra};};
const states=d=>Object.fromEntries(Object.entries(d.states).map(([k,v])=>[k,v.state]));
// Every picture file of one cached snapshot.
async function mediaFiles(snapshotDir){
  const out=[];
  for(const entry of await fs.readdir(snapshotDir,{withFileTypes:true,recursive:true}))if(entry.isFile()&&/\.(png|jpe?g)$/i.test(entry.name))out.push(path.join(entry.parentPath??entry.path,entry.name));
  assert.ok(out.length>0,'the snapshot holds pictures');return out.sort();
}
// Same length, one byte changed: only the content hash can tell.
async function corrupt(file){const bytes=await fs.readFile(file);bytes[bytes.length>>1]^=0xff;await fs.writeFile(file,bytes);}

test('the exchange folder goes away while an event plays: the last good content stays, the diagnostics say unreachable; back, a refresh reads it again',async t=>{
  const m=await machineFile(t);await confirm(m);
  const machine=await m.load(),service=createExchangeSourceService(machine);t.after(()=>service.close());
  const {sessions,base}=realRuntime(),manager=managerFor(t,service,machine,base);
  const refreshed=await service.refreshCatalog();assert.equal(refreshed.ok,true,refreshed.code);const sequence=refreshed.catalogSequence;
  const [listed]=(await manager.listEvents()).events,prepared=await manager.prepare(listed.eventId,request(manager));
  assert.equal(prepared.ok,true,prepared.code);
  assert.equal((await manager.activate(request(manager,{candidateId:prepared.candidateId}))).ok,true);
  await until(()=>sessions.length===1);const page=await programPage(t,sessions[0]);
  await until(()=>manager.snapshot().active?.runtime.ready===true);
  assert.equal((await manager.dispatch('launch',request(manager))).ok,true);
  assert.equal((await manager.dispatch('next',request(manager))).ok,true);
  const before=manager.snapshot().active.runtime,blacks=()=>page.commands.filter(c=>c.type==='black').length,blackBefore=blacks();
  assert.equal(before.slideCount,3);
  let d=await diagnose({source:service,manager});
  assert.deepEqual(states(d),{exchangeFolder:'reachable',catalogSequence:'read',approvals:'readable',prepared:'none',renderer:'acknowledged',ndiSender:'not-configured'});
  assert.equal(d.states.catalogSequence.sequence,sequence);

  // The folder goes away mid-event.
  await m.away();
  d=await diagnose({source:service,manager});
  assert.deepEqual(d.states.exchangeFolder,{state:'unreachable',code:'SOURCE_UNAVAILABLE'});
  assert.equal(d.states.renderer.state,'acknowledged','the event keeps playing');
  // A reload cannot read the source: refused, and the deck, the picture and the output stay.
  assert.equal((await manager.dispatch('reload',request(manager))).ok,false);
  let now=manager.snapshot().active.runtime;
  assert.deepEqual([now.deckId,now.index,now.ready,now.state],[before.deckId,before.index,true,'ready'],'last good content kept');
  assert.equal(blacks(),blackBefore,'never blacked by the outage');
  assert.equal((await manager.dispatch('next',request(manager))).ok,true,'the operator still controls the playing deck');
  // A catalog refresh with the folder gone is refused and says why.
  const refused=await service.refreshCatalog();assert.deepEqual([refused.ok,refused.code],[false,'SOURCE_UNAVAILABLE']);
  d=await diagnose({source:service,manager});
  assert.deepEqual(d.states.catalogSequence,{state:'unavailable',code:'SOURCE_UNAVAILABLE',sequence:null});
  assert.equal(d.states.renderer.state,'acknowledged');

  // It comes back: a refresh reads it again, and a reload works again on the same deck.
  await m.back();
  d=await diagnose({source:service,manager});assert.deepEqual(d.states.exchangeFolder,{state:'reachable',code:null});
  const again=await service.refreshCatalog();assert.equal(again.ok,true,again.code);assert.equal(again.catalogSequence,sequence);
  d=await diagnose({source:service,manager});assert.deepEqual(d.states.catalogSequence,{state:'read',code:null,sequence});
  assert.equal((await manager.dispatch('reload',request(manager))).ok,true);
  now=manager.snapshot().active.runtime;assert.equal(now.deckId,before.deckId,'same playback, same deck');
  assert.equal(blacks(),blackBefore);
  assert.equal((await manager.dispatch('stop',request(manager))).ok,true);
  await until(()=>blacks()>blackBefore);
  for(const text of [JSON.stringify(d)])assert.equal(text.includes(m.parent),false,'no path in the diagnostics');
});

test('a corrupt cached snapshot is refused, never played: nothing is prepared, the output stays black, the diagnostics name the fault',async t=>{
  const m=await machineFile(t);await confirm(m);
  // Prepared online once (fills the cache), pinned offline by the setup command.
  let machine=await m.load(),service=createExchangeSourceService(machine);
  let {seen,base}=recorder(),manager=managerFor(t,service,machine,base);
  let [listed]=(await manager.listEvents()).events;
  assert.equal((await manager.prepare(listed.eventId,request(manager))).ok,true);
  const pinnedDir=seen.prepared[0].prepared.snapshotDir;
  await manager.close();service.close();
  const pinned=await pinOfflineApprovals(await m.load());assert.equal(pinned.ok,true,pinned.code);assert.equal(pinned.done.offline.pinned,1);

  // The pinned snapshot's bytes change on disk, and the folder goes away: the button is a cached start of that snapshot.
  await corrupt((await mediaFiles(pinnedDir))[0]);
  await m.away();
  machine=await m.load();service=createExchangeSourceService(machine);t.after(()=>service.close());
  ({seen,base}=recorder());manager=managerFor(t,service,machine,base);
  [listed]=(await manager.listEvents()).events;
  const entry=await service.playbackCatalog.read(listed.eventId);
  assert.equal(entry.profile.media.startup.mode,'cached');assert.equal(entry.profile.media.startup.snapshotId,path.basename(pinnedDir));
  let d=await diagnose({source:service,manager});assert.deepEqual(d.states.prepared,{state:'none',code:null},'no fault before an attempt');
  const refused=await manager.prepare(listed.eventId,request(manager));
  assert.deepEqual([refused.ok,refused.code],[false,'PREPARE_FAILED']);
  assert.equal(seen.prepared.length,0,'the corrupt snapshot never reached a runtime');
  let s=manager.snapshot();assert.deepEqual([s.candidate,s.active],[null,null],'nothing prepared, nothing playing: the output stays black');
  assert.equal((await manager.activate(request(manager,{candidateId:'a'.repeat(48)}))).ok,false,'nothing to start');
  d=await diagnose({source:service,manager});
  assert.deepEqual(d.states.prepared,{state:'none',code:'CACHE_CHANGED'},'the fault is named');
  assert.deepEqual(d.states.exchangeFolder,{state:'unreachable',code:'SOURCE_UNAVAILABLE'});
  assert.deepEqual([d.states.renderer.state,d.states.ndiSender.state],['not-active','not-running']);
  assert.equal(JSON.stringify(d).includes(m.parent),false,'no path in the diagnostics');
  // Asked again: refused again, still named.
  assert.equal((await manager.prepare(listed.eventId,request(manager))).ok,false);
  assert.equal(seen.prepared.length,0);assert.equal((await diagnose({source:service,manager})).states.prepared.code,'CACHE_CHANGED');

  // The folder comes back. A preparation the manager refuses after its runtime was built names its own refusal, not the old cause.
  await m.back();
  const refusing=createGameDayManager({catalog:service.playbackCatalog,runtimeFactory:service.preparedRuntimeFactory(base),clock:()=>NOON,
    sourceRoot:machine.mediaRoot,privateRoots:[machine.runtimeRoot,machine.catalogDirectory,machine.source.approvalDirectory],
    refreshAdmission:service.admission.refreshAdmission,admitCandidate:()=>false});
  t.after(()=>refusing.close());
  const denied=await refusing.prepare(listed.eventId,request(refusing));assert.deepEqual([denied.ok,denied.code],[false,'ADMISSION_DENIED']);
  assert.deepEqual((await diagnose({source:service,manager:refusing})).states.prepared,{state:'none',code:'ADMISSION_DENIED'});
  assert.deepEqual((await diagnose({source:service,manager})).states.prepared,{state:'none',code:'PREPARE_FAILED'},'that runtime was built: the old cause is gone, the refusal stays');
  await refusing.close();seen.prepared.length=0;
  // An online preparation (a fresh snapshot) succeeds, plays, and clears the fault.
  const recovered=await manager.prepare(listed.eventId,request(manager));assert.equal(recovered.ok,true,recovered.code);
  assert.equal(seen.prepared.length,1);assert.equal(seen.prepared[0].mode,'source');assert.notEqual(seen.prepared[0].prepared.snapshotDir,pinnedDir);
  d=await diagnose({source:service,manager});assert.deepEqual(d.states.prepared,{state:'prepared',code:null});
  assert.equal((await manager.activate(request(manager,{candidateId:recovered.candidateId}))).ok,true);
  d=await diagnose({source:service,manager});assert.deepEqual(d.states.prepared,{state:'none',code:null},'the fault is cleared by the good preparation');
  assert.equal((await manager.dispatch('next',request(manager))).ok,true);assert.deepEqual(seen.actions,['next']);
});

test('a cached snapshot corrupted after an online preparation is refused when the same service prepares it again, and the fault is named',async t=>{
  const m=await machineFile(t);await confirm(m);
  const machine=await m.load(),service=createExchangeSourceService(machine);t.after(()=>service.close());
  const {seen,base}=recorder(),manager=managerFor(t,service,machine,base);
  const [listed]=(await manager.listEvents()).events;
  assert.equal((await manager.prepare(listed.eventId,request(manager))).ok,true);
  const dir=seen.prepared[0].prepared.snapshotDir;
  await corrupt((await mediaFiles(dir))[0]);
  // The same playback: the coordinator reuses the snapshot it staged, and its loader refuses the changed bytes.
  const again=await manager.prepare(listed.eventId,request(manager));
  assert.deepEqual([again.ok,again.code],[false,'PREPARE_FAILED']);
  assert.equal(seen.prepared.length,1,'never handed to a runtime');assert.equal(manager.snapshot().candidate,null);
  const d=await diagnose({source:service,manager});
  assert.deepEqual(d.states.prepared,{state:'none',code:'CACHE_CHANGED'});
  assert.deepEqual(d.states.exchangeFolder,{state:'reachable',code:null});
});

// Q-007: the refused reuse is dropped, so the next preparation stages fresh
// from the exchange folder instead of being refused until the app restarts.
test('after a refused reused snapshot, the next preparation by the same service stages fresh from the folder and plays it; the changed snapshot never plays',async t=>{
  const m=await machineFile(t);await confirm(m);
  const machine=await m.load(),service=createExchangeSourceService(machine);t.after(()=>service.close());
  const {seen,base}=recorder(),manager=managerFor(t,service,machine,base);
  const [listed]=(await manager.listEvents()).events;
  assert.equal((await manager.prepare(listed.eventId,request(manager))).ok,true);
  const dir=seen.prepared[0].prepared.snapshotDir;
  await corrupt((await mediaFiles(dir))[0]);
  const refused=await manager.prepare(listed.eventId,request(manager));
  assert.deepEqual([refused.ok,refused.code],[false,'PREPARE_FAILED']);
  assert.equal((await diagnose({source:service,manager})).states.prepared.code,'CACHE_CHANGED','the refusal is named once');
  // Asked again in the same app: a fresh snapshot, not the changed one.
  const fresh=await manager.prepare(listed.eventId,request(manager));
  assert.equal(fresh.ok,true,fresh.code);
  assert.equal(seen.prepared.length,2);assert.equal(seen.prepared[1].mode,'source');
  assert.notEqual(seen.prepared[1].prepared.snapshotDir,dir,'the changed snapshot is never handed to a runtime');
  assert.deepEqual((await diagnose({source:service,manager})).states.prepared,{state:'prepared',code:null});
  assert.equal((await manager.activate(request(manager,{candidateId:fresh.candidateId}))).ok,true);
  assert.equal((await manager.dispatch('next',request(manager))).ok,true);assert.deepEqual(seen.actions,['next']);
});

// Activates the only approved event on the real runtime, joins a program page and plays two pictures.
async function playing(t,m,supervisor){
  const machine=await m.load(),service=createExchangeSourceService(machine);t.after(()=>service.close());
  const runtime=realRuntime(supervisor),manager=managerFor(t,service,machine,runtime.base);
  const [listed]=(await manager.listEvents()).events,prepared=await manager.prepare(listed.eventId,request(manager));
  assert.equal(prepared.ok,true,prepared.code);
  assert.equal((await manager.activate(request(manager,{candidateId:prepared.candidateId}))).ok,true);
  await until(()=>runtime.sessions.length===1);const page=await programPage(t,runtime.sessions[0]);
  await until(()=>manager.snapshot().active?.runtime.ready===true);
  assert.equal((await manager.dispatch('launch',request(manager))).ok,true);
  assert.equal((await manager.dispatch('next',request(manager))).ok,true);
  return{machine,service,manager,runtime,page,listed};
}

test('the approval list becomes unreadable while an event plays: the event keeps its content, nothing new is listed, the diagnostics say unreadable; readable again, it recovers',async t=>{
  const m=await machineFile(t);await confirm(m);
  const {service,manager,page,listed}=await playing(t,m);
  const blacks=()=>page.commands.filter(c=>c.type==='black').length,blackBefore=blacks(),before=manager.snapshot().active.runtime;
  let d=await diagnose({source:service,manager});
  assert.deepEqual(states(d),{exchangeFolder:'reachable',catalogSequence:'unavailable',approvals:'readable',prepared:'none',renderer:'acknowledged',ndiSender:'not-configured'});

  await m.approvalsUnreadable();
  // The page lists the approved events: refused, and the diagnostics say why (the listing is a read of the list).
  const listing=await manager.listEvents();assert.deepEqual([listing.ok,listing.code],[false,'CATALOG_INVALID']);
  d=await diagnose({source:service,manager});
  assert.deepEqual(d.states.approvals,{state:'unreadable',code:'APPROVAL_INVALID'});
  assert.deepEqual([d.states.renderer.state,d.states.exchangeFolder.state],['acknowledged','reachable'],'the event keeps playing');
  // The active event was admitted from a completed read; it keeps its deck and picture, and the operator keeps control.
  assert.equal((await manager.dispatch('next',request(manager))).ok,true);
  let now=manager.snapshot().active.runtime;
  assert.deepEqual([now.deckId,now.ready,now.state],[before.deckId,true,'ready']);assert.equal(now.index,(before.index+1)%before.slideCount);
  assert.equal(blacks(),blackBefore,'never blacked by the unreadable list');
  // Nothing new can be prepared from an unreadable list (the window is open, so the manager refuses first; the list is
  // the second guard and is covered by the next test).
  const refused=await manager.prepare(listed.eventId,request(manager));assert.equal(refused.ok,false);
  assert.equal(manager.snapshot().candidate,null);

  await m.approvalsReadable();
  const again=await manager.listEvents();assert.equal(again.ok,true,again.code);assert.deepEqual(again.events.map(e=>e.eventId),[listed.eventId]);
  d=await diagnose({source:service,manager});assert.deepEqual(d.states.approvals,{state:'readable',code:null});
  assert.equal((await manager.dispatch('stop',request(manager))).ok,true);
  await until(()=>blacks()>blackBefore);
  assert.equal(JSON.stringify(d).includes(m.parent),false,'no path in the diagnostics');
});

test('an approval list unreadable at activation: the prepared button is refused, never played, the output stays black; readable again, it activates',async t=>{
  const m=await machineFile(t);await confirm(m);
  const machine=await m.load(),service=createExchangeSourceService(machine);t.after(()=>service.close());
  const {sessions,base}=realRuntime(),manager=managerFor(t,service,machine,base);
  const [listed]=(await manager.listEvents()).events,prepared=await manager.prepare(listed.eventId,request(manager));
  assert.equal(prepared.ok,true,prepared.code);

  await m.approvalsUnreadable();
  const refused=await manager.activate(request(manager,{candidateId:prepared.candidateId}));
  assert.deepEqual([refused.ok,refused.code],[false,'ADMISSION_DENIED']);
  let s=manager.snapshot();assert.equal(s.active,null,'nothing plays');assert.equal(sessions.length,0,'no renderer session was opened: the output stays black');
  let d=await diagnose({source:service,manager});
  assert.deepEqual(d.states.approvals,{state:'unreadable',code:'APPROVAL_INVALID'});
  assert.deepEqual([d.states.renderer.state,d.states.ndiSender.state],['not-active','not-running']);
  // Preparing again reads the list first: refused before any runtime is built.
  const again=await manager.prepare(listed.eventId,request(manager));assert.deepEqual([again.ok,again.code],[false,'CATALOG_INVALID']);
  assert.equal(manager.snapshot().candidate,null);

  await m.approvalsReadable();
  const ready=await manager.prepare(listed.eventId,request(manager));assert.equal(ready.ok,true,ready.code);
  assert.equal((await manager.activate(request(manager,{candidateId:ready.candidateId}))).ok,true);
  d=await diagnose({source:service,manager});assert.deepEqual(d.states.approvals,{state:'readable',code:null});
  await until(()=>sessions.length===1);await programPage(t,sessions[0]);
  await until(()=>manager.snapshot().active?.runtime.ready===true);
  assert.equal((await manager.dispatch('launch',request(manager))).ok,true);
});

test('the renderer (Caspar) dies while playing: acknowledged and sender running drop at once, one bounded restart brings the same deck back, a second death within the window stays down',async t=>{
  const m=await machineFile(t,{output:'ndi'});await confirm(m);
  const {service,manager,runtime}=await playing(t,m,{maxRestarts:1,restartDelayMs:50,windowMs:60000});
  const before=manager.snapshot().active.runtime;
  let d=await diagnose({source:service,manager});
  assert.deepEqual([d.states.renderer.state,d.states.ndiSender.state],['acknowledged','running']);
  assert.equal(runtime.children.length,1);

  // Killed: the program session closes with it (a real program page blacks itself on that disconnect), and the
  // diagnostics stop saying acknowledged and running before any restart.
  runtime.children[0].crash();
  d=await diagnose({source:service,manager});
  assert.deepEqual([d.states.renderer,d.states.ndiSender],[{state:'waiting',code:null},{state:'not-running',code:null}]);
  assert.equal(manager.snapshot().active.runtime.ready,false);
  await until(()=>runtime.sessions[0].snapshot().state==='closed');
  const control=await manager.dispatch('next',request(manager));assert.equal(control.ok,false,'no control of a dead renderer');

  // One restart: a new Caspar process and a new program session on the same accepted deck.
  await until(()=>runtime.sessions.length===2);assert.equal(runtime.children.length,2);
  await programPage(t,runtime.sessions[1]);
  await until(()=>manager.snapshot().active?.runtime.ready===true);
  let now=manager.snapshot().active.runtime;assert.equal(now.deckId,before.deckId,'last good deck, not new content');
  d=await diagnose({source:service,manager});assert.deepEqual([d.states.renderer.state,d.states.ndiSender.state],['acknowledged','running']);
  // The restarted renderer shows nothing until Launch: black, not a picture from before the crash.
  assert.equal(now.index,null,'not playing after the restart');
  assert.equal((await manager.dispatch('next',request(manager))).ok,false,'Next has nothing to advance');
  assert.equal((await manager.dispatch('launch',request(manager))).ok,true);
  assert.equal((await manager.dispatch('next',request(manager))).ok,true);

  // Killed again within the restart window: the limit holds, no third process, and the diagnostics say not acknowledged.
  runtime.children[1].crash();
  await new Promise(r=>setTimeout(r,400));
  assert.equal(runtime.children.length,2,'restarts are bounded');assert.equal(runtime.sessions.length,2);
  d=await diagnose({source:service,manager});
  assert.deepEqual(d.states.renderer,{state:'waiting',code:'SERVICE_FAULT'});assert.deepEqual(d.states.ndiSender,{state:'not-running',code:'SERVICE_FAULT'});
  assert.equal((await manager.dispatch('next',request(manager))).ok,false);
  assert.equal(JSON.stringify(d).includes(m.parent),false,'no path in the diagnostics');
});

// Q-009: past the restart limit the event stays active with no renderer inside its window. The operator
// can end that dead event (the output stays black, the diagnostics say not active) and prepare again.
// A live event, or one whose bounded restart is still pending, is never ended this way.
test('a dead event past the restart limit can be ended by the operator and prepared again; a live or restarting event cannot',async t=>{
  const m=await machineFile(t,{output:'ndi'});await confirm(m);
  const {service,manager,runtime,listed}=await playing(t,m,{maxRestarts:1,restartDelayMs:50,windowMs:60000});
  const end=()=>manager.endDeadEvent(request(manager));
  let refused=await end();assert.deepEqual([refused.ok,refused.code],[false,'EVENT_NOT_DEAD'],'a live, acknowledged event is never ended');
  assert.equal(manager.snapshot().active.runtime.ready,true);
  assert.equal(manager.snapshot().active.runtime.restartsExhausted,false);

  // First death: a bounded restart is pending, so the event is not dead yet.
  runtime.children[0].crash();
  await until(()=>runtime.sessions[0].snapshot().state==='closed');
  refused=await end();assert.deepEqual([refused.ok,refused.code],[false,'EVENT_NOT_DEAD'],'a restarting event is not ended');
  await until(()=>runtime.sessions.length===2);await programPage(t,runtime.sessions[1]);
  await until(()=>manager.snapshot().active?.runtime.ready===true);

  // Second death within the window: the limit holds. Before Q-009 nothing could replace it inside the window.
  runtime.children[1].crash();
  await until(()=>manager.snapshot().active.runtime.restartsExhausted===true);
  assert.equal((await manager.dispatch('stop',request(manager))).code,'CONTROL_INHIBITED');
  assert.equal((await manager.prepare(listed.eventId,request(manager))).code,'WINDOW_ACTIVE','a dead event still holds its window until it is ended');
  assert.equal((await manager.endDeadEvent({expectedEventId:listed.eventId,expectedSelection:0})).code,'STALE_SELECTION');

  const ended=await end();assert.equal(ended.ok,true,ended.code);
  let s=manager.snapshot();assert.equal(s.active,null,'nothing plays: the output stays black');assert.equal(s.expectedEventId,null);
  assert.equal(runtime.children.length,2,'ending starts no renderer');
  let d=await diagnose({source:service,manager});
  assert.deepEqual([d.states.renderer.state,d.states.ndiSender.state],['not-active','not-running']);
  assert.equal((await end()).code,'NOT_READY','nothing left to end');

  // Prepared again inside the same window: a new renderer plays the accepted deck.
  const prepared=await manager.prepare(listed.eventId,request(manager));assert.equal(prepared.ok,true,prepared.code);
  assert.equal((await manager.activate(request(manager,{candidateId:prepared.candidateId}))).ok,true);
  await until(()=>runtime.sessions.length===3);assert.equal(runtime.children.length,3);
  await programPage(t,runtime.sessions[2]);
  await until(()=>manager.snapshot().active?.runtime.ready===true);
  d=await diagnose({source:service,manager});assert.deepEqual([d.states.renderer.state,d.states.ndiSender.state],['acknowledged','running']);
  assert.equal(manager.snapshot().active.runtime.index,null,'black until Launch');
  assert.equal((await manager.dispatch('launch',request(manager))).ok,true);
});
