'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {normalizePreparedEventProfile}=require('./prepared-event-profile.cjs');
const {preparedCasparConfig}=require('./prepared-caspar-config.cjs');
const {stageSnapshot,loadSnapshot}=require('./media-snapshot.cjs');
const {createRossTalkSession}=require('./rosstalk-session.cjs');
const {LauncherRuntime}=require('./launcher-runtime.cjs');
const {spawnSupervisedProcess,createNativeWindowPolicy,WINDOW_EXPIRED_EXIT_CODE}=require('./windows-job-process.cjs');
const {CasparConsole}=require('./caspar-console.cjs');
function safeRoot(value){return typeof value==='string'&&value.length<=4096&&!/[\x00-\x1f\x7f]/.test(value)&&path.isAbsolute(value);}
function safePrivateRoots(value){return Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&value.length<=3&&Reflect.ownKeys(value).length===value.length+1&&Array.from({length:value.length},(_,index)=>Object.getOwnPropertyDescriptor(value,String(index))).every(item=>item&&Object.hasOwn(item,'value')&&item.enumerable&&safeRoot(item.value));}
function failure(code){return Object.assign(Error(code),{code});}
function same(a,b){return process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;}
function within(parent,child){const a=process.platform==='win32'?parent.toLowerCase():parent,b=process.platform==='win32'?child.toLowerCase():child;return a===b||(!path.relative(a,b).startsWith('..'+path.sep)&&path.relative(a,b)!=='..'&&!path.isAbsolute(path.relative(a,b)));}
async function canonical(file){let cursor=file;const tail=[];for(;;){try{return path.join(await fs.realpath(cursor),...tail.reverse());}catch(error){if(error.code!=='ENOENT')throw error;const parent=path.dirname(cursor);if(parent===cursor)throw error;tail.push(path.basename(cursor));cursor=parent;}}}
async function paths(profile,{source=profile.media.startup.mode==='source',manageSpx=true,sourceRoot,privateRoots=[]}={}){
  // Cached startup must not touch an absent/unmounted Drive source at all.
  const roots=await Promise.all([...(source?[profile.media.sourceDir]:[]),profile.media.cacheDir,profile.caspar.runtimeDir].map(canonical));
  for(let i=0;i<roots.length;i++)for(let j=i+1;j<roots.length;j++)if(within(roots[i],roots[j])||within(roots[j],roots[i]))throw failure('PROFILE_PATHS');
  if(source&&sourceRoot!==undefined){
    const boundary=await fs.realpath(sourceRoot);
    if(!(await fs.stat(boundary)).isDirectory()||!within(boundary,roots[0]))throw failure('PROFILE_PATHS');
    for(const privateRoot of [...roots.slice(1),...await Promise.all(privateRoots.map(canonical))])if(within(boundary,privateRoot)||within(privateRoot,boundary))throw failure('PROFILE_PATHS');
  }
  for(const file of [...(manageSpx?[profile.spx.executable]:[]),profile.caspar.executable])if(!(await fs.stat(file)).isFile())throw failure('PROFILE_PATHS');
  for(const dir of [...(manageSpx?[profile.spx.cwd]:[]),profile.caspar.cwd])if(!(await fs.stat(dir)).isDirectory())throw failure('PROFILE_PATHS');
  if(manageSpx&&same(await fs.realpath(profile.spx.executable),await fs.realpath(profile.caspar.executable)))throw failure('PROFILE_PATHS');
  if(profile.output.type==='ndi'){try{if(!(await fs.stat(path.join(profile.output.runtimeDirectory,'Processing.NDI.Lib.x64.dll'))).isFile())throw failure('NDI_RUNTIME_MISSING');}catch{throw failure('NDI_RUNTIME_MISSING');}}
  if(profile.media.startup.mode==='cached'){
    const selected=await fs.realpath(profile.media.startup.snapshotDir),cache=await fs.realpath(profile.media.cacheDir);
    if(same(selected,cache)||!within(cache,selected))throw failure('PROFILE_PATHS');
  }
}
/** Trusted Node options carry ownership/source policy and OS/test boundaries; never profile data.
 * manageSpx:false leaves SPX ownership and filesystem validation to the caller.
 * Real activation is Windows-only unless an explicit synthetic spawner is supplied.
 */
async function createPreparedEventRuntime(raw,{spawnProcess,consoleFactory=child=>new CasparConsole(child),clock=Date.now,schedule=setTimeout,cancel=clearTimeout,supervisorOptions={},stage=stageSnapshot,load=loadSnapshot,sessionFactory=createRossTalkSession,manageSpx=true,sourceRoot,privateRoots=[],canPrepare=()=>true}={}){
  if(typeof manageSpx!=='boolean'||typeof canPrepare!=='function'||(sourceRoot!==undefined&&!safeRoot(sourceRoot))||!safePrivateRoots(privateRoots)||(privateRoots.length&&sourceRoot===undefined))throw failure('EVENT_OPTIONS_INVALID');
  privateRoots=Object.freeze(privateRoots.map(value=>path.resolve(value)));
  let profile,initial,directory,nativeWindowPolicy;
  try{
    profile=normalizePreparedEventProfile(raw);
    if(process.platform!=='win32'&&typeof spawnProcess!=='function')throw failure('WINDOWS_REQUIRED');
    try{await paths(profile,{manageSpx,sourceRoot,privateRoots});}catch(error){throw failure(error.code==='NDI_RUNTIME_MISSING'?'NDI_RUNTIME_MISSING':'PROFILE_PATHS');}
    // Capture native UTC/boot deadline once; sender restarts never resample it.
    if(!spawnProcess)nativeWindowPolicy=await createNativeWindowPolicy(profile.productionWindow);
    initial=profile.media.startup.mode==='cached'?await load(profile.media.startup.snapshotDir):await stage({sourceDir:profile.media.sourceDir,cacheDir:profile.media.cacheDir});
    await fs.mkdir(profile.caspar.runtimeDir,{recursive:true});
    directory=await fs.mkdtemp(path.join(profile.caspar.runtimeDir,'event-'));
    for(const child of ['media','log','data','template'])await fs.mkdir(path.join(directory,child));
    await fs.writeFile(path.join(directory,'caspar.config'),preparedCasparConfig(profile,directory),{flag:'wx'});
  }catch(error){if(directory)await fs.rm(directory,{recursive:true,force:true}).catch(()=>{});throw failure(['PROFILE_INVALID','PROFILE_PATHS','NDI_RUNTIME_MISSING','WINDOWS_REQUIRED'].includes(error.code)?error.code:'EVENT_PREPARE_FAILED');}
  const spawn=spawnProcess||((exe,args,options,privateInput)=>spawnSupervisedProcess(exe,args,options,{forwardStdin:privateInput,...(privateInput?{productionWindow:nativeWindowPolicy}:{})}));
  let launcher,windowExpired=false,closed=false,started=false,startPromise,closePromise,state='prepared',lastError=null,stamp=0,current=null,standby=null;
  let accepted=initial,lastMode=profile.playback.mode,flight=null,candidate=null;
  const retiring=new Set(),creating=new Set();let retirementFailed=false;
  function syncAccepted(gen){
    if(!gen?.session)return;
    const value=gen.session.snapshot().presentation.controller;
    if(value?.mode==='auto'||value?.mode==='manual')lastMode=value.mode;
    if(candidate&&value?.deckId===candidate.deck.id){accepted=candidate;candidate=null;}
  }
  function active(gen){return !closed&&current===gen&&gen.stamp===stamp&&launcher?.allowed()===true;}
  function gate(gen){syncAccepted(gen);return active(gen)&&gen.ready&&gen.session?.snapshot().presentation.renderer.ready===true;}
  function track(promise){const p=Promise.resolve(promise);retiring.add(p);void p.catch(()=>{retirementFailed=true;lastError='SESSION_CLOSE_FAILED';}).finally(()=>retiring.delete(p));return p;}
  function retire(terminate=false){
    stamp++;
    const gen=current;current=null;
    if(flight)flight.abort.abort();
    if(gen){
      try{syncAccepted(gen);}catch{lastError='STATE_UNAVAILABLE';}gen.ready=false;
      if(gen.session){try{track(gen.session.close());}catch{track(Promise.reject(failure('SESSION_CLOSE_FAILED')));}}
      // Native stop owns normal teardown; do not race taskkill with an early
      // EOF. Fault/bootstrap paths explicitly end the private lifetime pipe.
      if(terminate)try{gen.console.close();}catch{try{gen.child.stdin?.end();}catch{}lastError='CONSOLE_CLOSE_FAILED';}
    }
    if(standby){const pending=standby;standby=null;try{track(pending.session.close());}catch{track(Promise.reject(failure('SESSION_CLOSE_FAILED')));}}
    if(!closed)state=windowExpired?'expired':'waiting';
  }
  async function prepare(gen,{signal}){
    syncAccepted(gen);
    if(!active(gen)||signal.aborted)throw failure('EVENT_CANCELLED');
    if(flight)throw failure('BUSY');
    let permitted=false;
    try{const value=canPrepare();if(value&&typeof value.then==='function')Promise.resolve(value).catch(()=>{});permitted=value===true;}catch{}
    if(!permitted)throw failure('BUSY');
    if(!active(gen)||signal.aborted)throw failure('EVENT_CANCELLED');
    const job={abort:new AbortController()};flight=job;
    const abort=()=>job.abort.abort();signal.addEventListener('abort',abort,{once:true});
    try{
      await paths(profile,{source:true,manageSpx,sourceRoot,privateRoots});
      if(!active(gen)||signal.aborted||job.abort.signal.aborted)throw failure('EVENT_CANCELLED');
      const next=await stage({sourceDir:profile.media.sourceDir,cacheDir:profile.media.cacheDir,signal:job.abort.signal});
      if(!active(gen)||signal.aborted||job.abort.signal.aborted)throw failure('EVENT_CANCELLED');
      candidate=next;return next.snapshotDir;
    }finally{signal.removeEventListener('abort',abort);if(flight===job)flight=null;}
  }
  function session(gen){
    const pending=(async()=>{
      const value=await sessionFactory({presentation:{snapshotDir:accepted.snapshotDir,port:profile.presentation.port,controllerOptions:{...profile.playback,mode:lastMode}},rossTalk:profile.rossTalk,canControl:()=>gate(gen),resolvePreparedSnapshot:args=>prepare(gen,args)});
      try{
        if(closed||(!gen.initial&&!active(gen)))throw failure('EVENT_CANCELLED');
        await value.start();
        if(closed||(!gen.initial&&!active(gen)))throw failure('EVENT_CANCELLED');
        return value;
      }catch(error){await value.close();throw failure(closed||error.code==='EVENT_CANCELLED'?'EVENT_CANCELLED':'EVENT_LISTEN_FAILED');}
    })();
    creating.add(pending);void pending.then(()=>creating.delete(pending),()=>creating.delete(pending));
    return pending;
  }
  async function bootstrap(gen){
    try{
      if(!gen.session){await Promise.all([...retiring]);if(retirementFailed)throw failure('SESSION_CLOSE_FAILED');if(!active(gen))throw failure('EVENT_CANCELLED');gen.session=await session(gen);}
      if(!active(gen)){await gen.session.close();return;}
      await gen.console.request('VERSION',{status:201});
      if(!active(gen))throw failure('EVENT_CANCELLED');
      await gen.console.request('PLAY 1-10 [HTML] "'+gen.session.getProgramURL()+'"');
      const deadline=Date.now()+15000;
      while(active(gen)&&!gen.session.snapshot().presentation.renderer.ready&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
      if(!active(gen)||!gen.session.snapshot().presentation.renderer.ready)throw failure('EVENT_RENDERER_FAILED');
      gen.ready=true;state='ready';lastError=null;
    }catch{
      if(current===gen){lastError='EVENT_BOOTSTRAP_FAILED';retire(true);}
      else{if(gen.session)await gen.session.close().catch(()=>{});try{gen.console.close();}catch{try{gen.child.stdin?.end();}catch{}}}
    }
  }
  function ownedSpawn(exe,args,options){
    const privateInput=exe===profile.caspar.executable;
    const child=spawn(exe,args,{...options,env:{...process.env,...(privateInput&&profile.output.type==='ndi'?{NDI_RUNTIME_DIR_V6:profile.output.runtimeDirectory}:{})}},privateInput);
    if(privateInput){
      // Native expiry is terminal for this prepared event even if a backward
      // wall-clock adjustment would otherwise authorize a supervisor restart.
      child.once('exit',code=>{if(code===WINDOW_EXPIRED_EXIT_CODE&&!closed){windowExpired=true;lastError='PRODUCTION_WINDOW_EXPIRED';retire();state='expired';void launcher.reconcile().catch(()=>{lastError='EVENT_CLOSE_FAILED';});}});
      let client;try{client=consoleFactory(child);if(!client||!['request','close','on'].every(key=>typeof client[key]==='function'))throw failure('EVENT_CONSOLE_FAILED');}catch{try{child.stdin?.end();}catch{}throw failure('EVENT_CONSOLE_FAILED');}
      const gen=standby||{session:null};standby=null;Object.assign(gen,{stamp:++stamp,initial:false,child,console:client,ready:false});current=gen;state='starting';
      client.on('fault',()=>{if(current===gen){lastError='CONSOLE_FAULT';retire(true);}});
      void bootstrap(gen);
    }
    return child;
  }
  launcher=new LauncherRuntime({productionWindow:profile.productionWindow,services:[{name:'spx',command:profile.spx.executable,args:profile.spx.args,cwd:profile.spx.cwd},{name:'casparcg',command:profile.caspar.executable,args:[path.join(directory,'caspar.config'),'--log-severity=disable','--disable-logging'],cwd:profile.caspar.cwd}]},{clock:()=>windowExpired?NaN:clock(),schedule,cancel,manageSpx,supervisorOptions:{...supervisorOptions,spawnProcess:ownedSpawn},onSenderRetiring:()=>{retire();}});
  launcher.on('fault',value=>{if(!windowExpired&&(value?.name==='spx'||!current?.ready))lastError='SERVICE_FAULT';});
  function snapshot(){syncAccepted(current);const owned=current?.session?.snapshot(),p=owned?.presentation;return Object.freeze({eventId:profile.eventId,state,lastError:lastError||owned?.lastError||null,windowAllowed:launcher.allowed(),generation:stamp,ready:!!current&&gate(current),deckId:accepted.deck.id,slideCount:accepted.deck.slides.length,sourceName:profile.output.type==='ndi'?profile.output.name:null,mode:p?.controller?.mode||lastMode,index:p?.controller?.index??null,output:profile.output.type,preparing:flight!==null,closed});}
  function close(){
    if(closePromise)return closePromise;
    let resolveClose,rejectClose;
    const reserved=new Promise((resolve,reject)=>{resolveClose=resolve;rejectClose=reject;});closePromise=reserved;
    closed=true;state='closing';retire();
    // Never wait for resolver/render/black completion before requesting stop.
    const stopping=launcher.close();
    void Promise.allSettled([stopping,...retiring,...[...creating].map(p=>p.then(value=>value.close(),error=>{if(error.code!=='EVENT_CANCELLED')throw error;}))]).then(async results=>{
      if(retirementFailed||results.some(r=>r.status==='rejected'))throw failure('EVENT_CLOSE_FAILED');
      await fs.rm(directory,{recursive:true,force:true});state='closed';
    }).then(resolveClose,()=>{lastError='EVENT_CLOSE_FAILED';closePromise=null;rejectClose(failure(lastError));});
    return reserved;
  }
  function start(){
    if(closed)return Promise.reject(failure('EVENT_CLOSED'));
    if(startPromise)return startPromise;
    startPromise=(async()=>{
      const initialGen={stamp:0,initial:true,session:null,ready:false};
      try{initialGen.session=await session(initialGen);if(closed){await initialGen.session.close();throw failure('EVENT_CLOSED');}standby=initialGen;started=true;await launcher.start();if(!current)state=windowExpired?'expired':'waiting';}
      catch{lastError='EVENT_START_FAILED';await close().catch(()=>{});throw failure(lastError);}
    })();return startPromise;
  }
  // Capture only the currently owned generation; admission, cancellation and
  // Stop priority remain with the same bridge used by actual TCP senders.
  function dispatch(action){
    if(closed)return Promise.resolve(Object.freeze({ok:false,code:'CLOSED'}));
    const owned=current?.session;
    if(!owned)return Promise.resolve(Object.freeze({ok:false,code:'CONTROL_INHIBITED'}));
    return owned.dispatch(action);
  }
  return Object.freeze({start,snapshot,dispatch,close});
}
module.exports={createPreparedEventRuntime};
