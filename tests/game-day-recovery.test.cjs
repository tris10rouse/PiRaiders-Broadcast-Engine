'use strict';
// BE-006 item 5c part 4: recovery from a missing exchange folder and from a
// corrupt cached snapshot. Real loader, reader, journal, approval store,
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

async function machineFile(t){
  const parent=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders recovery ')));
  t.after(()=>fs.rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const appRoot=path.join(parent,'app'),exchange=path.join(parent,'exchange'),docs=exchangeDocuments();
  await fs.mkdir(path.join(appRoot,'config'),{recursive:true});await fs.writeFile(path.join(appRoot,'config','spx.json'),'{}');
  // The runtime checks that the configured Caspar executable is a file; nothing runs it here.
  await fs.mkdir(path.join(appRoot,'components'),{recursive:true});await fs.writeFile(path.join(appRoot,'components','casparcg.exe'),'synthetic');
  for(const [relative,bytes] of docs.files){const file=path.join(exchange,...relative.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}
  for(const dir of ['cache','runtime','catalog'])await fs.mkdir(path.join(parent,dir));
  const raw={schemaVersion:1,spxConfigFile:'config/spx.json',catalogDirectory:path.join(parent,'catalog'),mediaRoot:exchange,cacheRoot:path.join(parent,'cache'),runtimeRoot:path.join(parent,'runtime'),
    caspar:{executable:path.join(appRoot,'components','casparcg.exe'),cwd:path.join(appRoot,'components')},output:{type:'none'},
    rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',5:'reload',8:'stop'}},
    source:{providerId:'recovery-test',journalDirectory:path.join(parent,'private','journal'),journalStoreId:crypto.randomUUID(),
      approvalDirectory:path.join(parent,'private','approvals'),approvalStoreId:crypto.randomUUID(),expectedCanonicalRoot:exchange,binding:{...docs.binding}}};
  const file=path.join(parent,'machine.json');await fs.writeFile(file,JSON.stringify(raw));
  const m={parent,appRoot,file,raw,exchange,docs,tuple:[...docs.identityTuple]};
  m.load=()=>loadGameDayMachineConfig(file,{appRoot,nodeExecutable:process.execPath});
  m.away=()=>fs.rename(exchange,path.join(parent,'exchange-away'));
  m.back=()=>fs.rename(path.join(parent,'exchange-away'),exchange);
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
function realRuntime(){
  const sessions=[];
  const base=(profile,options)=>createPreparedEventRuntime(profile,{...options,supervisorOptions:{platform:'linux',maxRestarts:0},
    spawnProcess:()=>{const child=new EventEmitter();child.pid=4242;child.stdin={end(){setImmediate(()=>child.emit('exit',1));}};
      child.kill=()=>setImmediate(()=>child.emit('exit',0));setImmediate(()=>child.emit('spawn'));return child;},
    consoleFactory:child=>{const client=new EventEmitter();client.close=()=>child.stdin.end();client.request=async value=>({status:value==='VERSION'?201:202});return client;},
    sessionFactory:async raw=>{const session=await createRossTalkSession({...raw,rossTalk:{...raw.rossTalk,port:0}},{allowEphemeral:true});sessions.push(session);return session;}});
  return{sessions,base};
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

  // The folder comes back: an online preparation (a fresh snapshot) succeeds, plays, and clears the fault.
  await m.back();
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
