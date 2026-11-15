#!/usr/bin/env node
'use strict';
// Disposable integrated Windows proof: actual Caspar/CEF/private Console and
// actual NDI SDK receiver. Same-machine software only; no stadium/LAN claim.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const net=require('node:net');
const {spawn,execFileSync}=require('node:child_process');
const {setTimeout:wait}=require('node:timers/promises');
const {PNG}=require('pngjs');
const jpeg=require('jpeg-js');
const appRoot=path.resolve(__dirname,'..');
const {createPreparedEventRuntime}=require(path.join(appRoot,'scripts/lib/prepared-event-runtime.cjs'));
const {spawnSupervisedProcess,JOB_HOST}=require(path.join(appRoot,'scripts/lib/windows-job-process.cjs'));
const {CasparConsole}=require(path.join(appRoot,'scripts/lib/caspar-console.cjs'));
const {stageSnapshot}=require(path.join(appRoot,'scripts/lib/media-snapshot.cjs'));
const {requestProbe}=require(path.join(appRoot,'scripts/ndi-proof-client.cjs'));
const {output:PROBE}=require(path.join(appRoot,'scripts/build-ndi-probe.cjs'));
const {command,descendants}=require(path.join(appRoot,'scripts/smoke-caspar-windows.cjs'));
function table(){const rows=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId,ParentProcessId,ExecutablePath)"],{encoding:'utf8',timeout:15000,windowsHide:true,maxBuffer:1024*1024}));assert.ok(Array.isArray(rows)&&rows.some(row=>row.ProcessId===process.pid),'PROCESS_ENUM_POSITIVE_CONTROL');return rows;}
async function until(predicate,code,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await predicate())return;await wait(100);}throw Error(code);}
async function freePort(){const server=net.createServer();await new Promise((r,j)=>server.listen(0,'127.0.0.1',r).once('error',j));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
function image(rgb){const data=Buffer.alloc(160*90*4);for(let i=0;i<data.length;i+=4)data.set([...rgb,255],i);return{width:160,height:90,data};}
async function filesUnder(dir){const all=[];let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return all;throw error;}for(const entry of entries){const file=path.join(dir,entry.name);if(entry.isDirectory())all.push(...await filesUnder(file));else if(entry.isFile())all.push(file);}return all;}
async function main(){
  if(process.platform!=='win32')throw Error('WINDOWS_REQUIRED');
  const root=path.resolve(process.argv[2]||path.join(appRoot,'build','caspar-proof-tools'));
  const evidence=path.resolve(appRoot,'build','prepared-event-proof-evidence');await fs.rm(evidence,{recursive:true,force:true});await fs.mkdir(evidence,{recursive:true});
  const tools=JSON.parse(await fs.readFile(path.join(root,'tools.json'),'utf8'));
  const ndi=JSON.parse(await fs.readFile(path.join(root,'ndi-runtime.json'),'utf8'));
  await fs.access(PROBE);await fs.access(JOB_HOST);
  const label='PiRaiders-Prepared-CI-'+crypto.randomUUID().replaceAll('-','');
  const hosts=new Set(),nativeExits=[],fixedReceiverErrors=new Set(),frameEvidence=[],privateURLs=new Set(),capabilities=new Set();
  const sourceDir=path.join(root,'prepared-local-source'),cacheDir=path.join(root,'prepared-local-cache'),runtimeDir=path.join(root,'prepared-local-runtime');
  // Disposable proof-owned names only; make repeated local/CI runs independent.
  for(const dir of [sourceDir,cacheDir,runtimeDir])await fs.rm(dir,{recursive:true,force:true});
  const ending={abortObserved:false,entered:false,released:false,release:null,signal:null,stageCalls:0,blockNext:false};
  let runtime,probe,activeCaspar,phase='RECEIVER',report,expectedIdentity,window;
  let spxHost=null,consoleVersions=0,consolePlays=0,privateGenerationCount=0,spawnCount=0,consoleConfigValidated=false;
  function recordHost(child,role){
    hosts.add(child);spawnCount++;
    child.closed=new Promise(resolve=>child.once('close',(code,signal)=>{hosts.delete(child);nativeExits.push({role,code,signal});resolve({code,signal});}));
    child.on('error',()=>{});return child;
  }
  async function receiver(dllPath){
    // Reuse the compiled SDK receiver and authenticated request protocol. This
    // bench host needs captured pipes; application processes use the real adapter.
    const token=crypto.randomBytes(32).toString('base64url');
    const child=recordHost(spawn(JOB_HOST,[PROBE,dllPath,label,evidence],{cwd:root,env:{...process.env,PIRAIDERS_NDI_PROBE_TOKEN:token},windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']}),'receiver');
    child.stdin.on('error',()=>{});
    let port,seq=0,done=false,buffer=Buffer.alloc(0),stderrCarry='';let readyResolve,readyReject;
    const ready=new Promise((r,j)=>{readyResolve=r;readyReject=j;});
    const timer=setTimeout(()=>finish(Error('RECEIVER_START_TIMEOUT')),20000);
    function finish(error,value){if(done)return;done=true;clearTimeout(timer);if(error){child.stdin.end();readyReject(error);}else readyResolve(value);}
    child.once('error',()=>finish(Error('RECEIVER_SPAWN')));child.closed.then(()=>finish(Error('RECEIVER_EXITED')));
    child.stderr.on('data',chunk=>{stderrCarry=(stderrCarry+chunk.toString('utf8')).slice(-4096);for(const line of stderrCarry.split(/\r?\n/))if(/^NDI_PROBE_FAILED_[A-Z_]+$/.test(line))fixedReceiverErrors.add(line);});
    child.stdout.on('data',chunk=>{
      if(done)return;if(buffer.length+chunk.length>16384)return finish(Error('RECEIVER_START_LIMIT'));
      buffer=Buffer.concat([buffer,chunk]);for(let end;(end=buffer.indexOf('\n'))>=0;){
        const line=buffer.subarray(0,end).toString('utf8');buffer=buffer.subarray(end+1);let value;try{value=JSON.parse(line);}catch{continue;}
        if(value?.event!=='ndi-probe-ready')continue;
        if(!Number.isInteger(value.port)||value.port<1||value.port>65535||value.abiValid!==true||typeof value.runtimeVersion!=='string'||value.runtimeVersion.length>255||/[\x00-\x1f\x7f]/.test(value.runtimeVersion))return finish(Error('RECEIVER_READY_INVALID'));
        port=value.port;finish(null,value);
      }
    });
    let info;try{info=await ready;}catch(error){await child.closed;throw error;}
    return{child,info,request:(name,values={},timeoutMs=30000)=>requestProbe(port,token,++seq,name,values,timeoutMs),async close(){
      try{
        if(child.exitCode===null)await requestProbe(port,token,++seq,'close',{},5000);
        let timer;const result=await Promise.race([child.closed,new Promise((_,j)=>{timer=setTimeout(()=>j(Error('RECEIVER_CLOSE_TIMEOUT')),10000);})]).finally(()=>clearTimeout(timer));
        if(result.code!==0||result.signal)throw Error('RECEIVER_CLOSE_FAILED');
      }finally{child.stdin.end();}
    }};
  }
  function ownedSpawn(executable,args,options,privateInput){
    const env={...options.env,...(privateInput?{GALLIUM_DRIVER:'llvmpipe',LIBGL_ALWAYS_SOFTWARE:'1',MESA_GL_VERSION_OVERRIDE:'4.5COMPAT'}:{})};
    const child=recordHost(spawnSupervisedProcess(executable,args,{...options,env},{forwardStdin:privateInput}),privateInput?'caspar':'spx-standin');
    if(privateInput){activeCaspar=child;privateGenerationCount++;}else spxHost=child;
    return child;
  }
  function consoleFactory(child){
    const client=new CasparConsole(child,{timeoutMs:60000}),request=client.request.bind(client);
    client.request=async(value,options)=>{
      if(value.startsWith('PLAY 1-10 [HTML] ')){
        const match=/^PLAY 1-10 \[HTML\] "([^"\r\n]+)"$/.exec(value);assert.ok(match,'PRIVATE_PLAY_SYNTAX');
        const url=match[1],parsed=new URL(url),capability=parsed.hash.slice('#piraiders='.length);
        assert.equal(parsed.hostname,'127.0.0.1');assert.ok(parsed.hash.startsWith('#piraiders=')&&capability,'PRIVATE_PROGRAM_CAPABILITY');
        privateURLs.add(url);capabilities.add(capability);
      }
      const result=await request(value,options);
      if(value==='VERSION')consoleVersions++;
      else if(value.startsWith('PLAY 1-10 [HTML] '))consolePlays++;
      return result;
    };
    return client;
  }
  function ownedRoot(host=activeCaspar){
    assert.ok(host&&Number.isSafeInteger(host.pid),'OWNED_CASPAR_HOST');
    const rows=table(),expected=path.normalize(path.join(tools.casparDirectory,'casparcg.exe')).toLowerCase();
    const matches=rows.filter(row=>row.ParentProcessId===host.pid&&typeof row.ExecutablePath==='string'&&path.normalize(row.ExecutablePath).toLowerCase()===expected);
    assert.equal(matches.length,1,'OWNED_CASPAR_ROOT');return{rows,pid:matches[0].ProcessId};
  }
  async function frame(name,rgb,options={}){
    const result=await probe.request('frame',{name,rgb,minFrames:3,minDurationMs:0,timeoutMs:20000,...options},25000);
    assert.equal(result.sourceIdentityHash,expectedIdentity,'SOURCE_IDENTITY_CHANGED');
    assert.ok(Number.isInteger(result.distinctTimestamps)&&result.distinctTimestamps>=3&&result.connections>0,'FRESH_NDI_FRAMES_REQUIRED');
    assert.equal(result.width,1920);assert.equal(result.height,1080);assert.equal(result.frameRateN,30*result.frameRateD);assert.ok(['BGRA','BGRX'].includes(result.format));
    frameEvidence.push({name,matchedFrames:result.matchedFrames,distinctTimestamps:result.distinctTimestamps,sampleDurationMs:result.sampleDurationMs,format:result.format});
    console.log(JSON.stringify({event:'prepared-ndi-frame-verified',name,distinctTimestamps:result.distinctTimestamps}));
  }
  async function scanPrivateFiles(){
    for(const file of [...await filesUnder(tools.casparDirectory),...await filesUnder(runtimeDir)])if(/\.(?:log|txt|json|config)$/i.test(file)){
      if((await fs.stat(file)).size>16*1024*1024)throw Error('LOG_SCAN_LIMIT');
      const bytes=await fs.readFile(file);
      for(const value of [...privateURLs,...capabilities])if(bytes.includes(Buffer.from(value))||bytes.includes(Buffer.from(value,'utf16le')))throw Error('PRIVATE_URL_PERSISTED');
    }
    const generated=(await filesUnder(runtimeDir)).filter(file=>path.basename(file)==='caspar.config');
    assert.equal(generated.length,1,'OWNED_GENERATED_CONFIG');
    const xml=await fs.readFile(generated[0],'utf8');
    assert.ok(xml.includes('<controllers/>')&&xml.includes('<log-path disabled="true">')&&xml.includes('<cache-path/>'),'PRIVATE_CONFIG_REQUIRED');
    consoleConfigValidated=true;
  }
  let openReloadSocket;
  try{
    probe=await receiver(ndi.dllPath);
    await fs.mkdir(sourceDir);await fs.writeFile(path.join(sourceDir,'01.png'),PNG.sync.write(image([240,20,20])));await fs.writeFile(path.join(sourceDir,'02.jpg'),jpeg.encode(image([20,20,240]),95).data);
    const talk=await freePort(),now=Date.now();window={start:new Date(now+8000).toISOString(),end:new Date(now+180000).toISOString(),prewarmMinutes:0};
    const profile={schemaVersion:1,provider:'local-manual',eventId:'local-prepared-ndi-ci',productionWindow:window,
      spx:{executable:process.execPath,args:['-e','setInterval(()=>{},1000)'],cwd:appRoot},
      caspar:{executable:path.join(tools.casparDirectory,'casparcg.exe'),cwd:tools.casparDirectory,runtimeDir},
      media:{provider:'local-lexical-v1',sourceDir,cacheDir,startup:{mode:'source'}},
      playback:{mode:'manual',intervalMs:1000,transition:{type:'cut',durationMs:0}},presentation:{port:0},
      rossTalk:{host:'127.0.0.1',port:talk,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',2:'next',3:'previous',4:'toggle-auto',5:'reload',8:'stop'},acknowledgements:true},
      output:{type:'ndi',name:label,runtimeDirectory:ndi.runtimeDirectory}};
    runtime=await createPreparedEventRuntime(profile,{spawnProcess:ownedSpawn,consoleFactory,supervisorOptions:{maxRestarts:1,restartDelayMs:100},stage:async options=>{
      ending.stageCalls++;const value=await stageSnapshot(options);
      if(ending.blockNext){ending.blockNext=false;ending.entered=true;ending.signal=options.signal;await new Promise(resolve=>{ending.release=()=>{ending.released=true;resolve();};});}
      return value;
    }});
    phase='PREWARM';await runtime.start();assert.ok(Date.now()<Date.parse(window.start),'SETUP_BEFORE_WINDOW');assert.equal(activeCaspar,undefined,'NO_SENDER_BEFORE_WINDOW');
    await probe.request('absent',{durationMs:1000});assert.equal(activeCaspar,undefined,'NO_OFF_WINDOW_SOURCE');
    phase='INITIAL_READY';await until(()=>runtime.snapshot().ready,'EVENT_READY',60000);
    assert.equal(runtime.snapshot().index,null,'INITIAL_EXPLICIT_LAUNCH_REQUIRED');
    const discovered=await probe.request('discover',{timeoutMs:30000},35000);expectedIdentity=discovered.sourceIdentityHash;assert.match(expectedIdentity,/^[0-9a-f]{64}$/);
    await frame('prepared-black',[0,0,0]);await scanPrivateFiles();
    phase='PLAYBACK';await command(talk,'GPI 1',{prefix:'OK ',timeoutMs:30000});await frame('launch-red',[240,20,20]);
    await command(talk,'GPI 2',{prefix:'OK ',timeoutMs:30000});await frame('next-jpeg-blue',[20,20,240]);
    await command(talk,'GPI 2',{prefix:'OK ',timeoutMs:30000});await frame('next-wrap-red',[240,20,20]);
    await command(talk,'GPI 3',{prefix:'OK ',timeoutMs:30000});await frame('previous-wrap-blue',[20,20,240]);
    await fs.writeFile(path.join(sourceDir,'01.png'),PNG.sync.write(image([20,220,20])));await fs.rm(path.join(sourceDir,'02.jpg'));
    const previousDeck=runtime.snapshot().deckId;await command(talk,'GPI 5',{prefix:'OK ',timeoutMs:45000});const accepted=runtime.snapshot().deckId;assert.notEqual(accepted,previousDeck,'RELOAD_ACCEPTED');await frame('reload-green',[20,220,20]);
    await fs.writeFile(path.join(sourceDir,'01.png'),'deliberate-invalid-image');await command(talk,'GPI 5',{prefix:'ERR ',timeoutMs:45000});assert.equal(runtime.snapshot().deckId,accepted,'FAILED_RELOAD_LAST_GOOD');await frame('failed-reload-green',[20,220,20]);
    await command(talk,'GPI 8',{prefix:'OK ',timeoutMs:30000});await frame('stop-black',[0,0,0],{minFrames:10,minDurationMs:1500});assert.ok(hosts.has(activeCaspar),'STOP_KEEPS_OWNED_SENDER');
    phase='OFFLINE_CRASH';await fs.rm(sourceDir,{recursive:true});const oldHost=activeCaspar,oldGeneration=runtime.snapshot().generation,{rows,pid}=ownedRoot(),oldTree=descendants(rows,oldHost.pid);
    execFileSync('taskkill.exe',['/PID',String(pid),'/F'],{stdio:'ignore',windowsHide:true,timeout:15000});
    await until(()=>activeCaspar!==oldHost&&runtime.snapshot().ready,'EVENT_RESTART_READY',60000);
    assert.ok(runtime.snapshot().generation>oldGeneration,'FRESH_EVENT_GENERATION');assert.equal(runtime.snapshot().index,null,'RESTART_STOPPED');assert.equal(runtime.snapshot().deckId,accepted,'OFFLINE_LAST_GOOD_CACHE');
    assert.ok(privateURLs.size>=2&&consoleVersions>=2&&consolePlays>=2,'PRIVATE_CONSOLE_GENERATION_HANDOFFS');
    await until(()=>{const alive=new Set(table().map(row=>row.ProcessId));return oldTree.every(id=>!alive.has(id));},'OLD_TREE_SURVIVED',10000);
    await frame('restart-black',[0,0,0]);await command(talk,'GPI 1',{prefix:'OK ',timeoutMs:30000});await frame('restart-launch-green',[20,220,20]);await scanPrivateFiles();
    phase='WINDOW_END';
    // Keep output live until close to the real deadline, never extend the window.
    await until(()=>Date.now()>=Date.parse(window.end)-12000,'BOUNDARY_WAIT',180000);
    await fs.mkdir(sourceDir);await fs.writeFile(path.join(sourceDir,'01.png'),PNG.sync.write(image([240,20,20])));
    await command(talk,'GPI 4',{prefix:'OK ',timeoutMs:30000});assert.equal(runtime.snapshot().mode,'auto','AUTO_ACTIVE_BEFORE_END');
    const endHost=activeCaspar,endGeneration=runtime.snapshot().generation,endingTree=descendants(table(),endHost.pid);ending.blockNext=true;
    openReloadSocket=net.createConnection({host:'127.0.0.1',port:talk});openReloadSocket.on('error',()=>{});openReloadSocket.on('data',()=>{});await new Promise((r,j)=>{openReloadSocket.once('connect',r);openReloadSocket.once('error',j);});openReloadSocket.write('GPI 5\r\n');
    await until(()=>ending.entered,'IGNORED_PREPARATION_GATE',6000);assert.ok(!ending.released&&runtime.snapshot().preparing,'PREPARATION_PHYSICAL_FLIGHT');
    await until(()=>Date.now()>=Date.parse(window.end)&&runtime.snapshot().generation>endGeneration&&!runtime.snapshot().ready&&runtime.snapshot().index===null,'WINDOW_EPOCH_FENCED',20000);
    ending.abortObserved=ending.signal.aborted;assert.ok(ending.abortObserved&&!ending.released&&runtime.snapshot().preparing,'WINDOW_ABORT_WITH_UNSETTLED_CALLBACK');
    await until(()=>{const alive=new Set(table().map(row=>row.ProcessId));return endingTree.every(id=>!alive.has(id));},'WINDOW_TREE_SURVIVED',10000);const processStoppedAt=new Date().toISOString();
    const quiet=await probe.request('quiet',{durationMs:1500,timeoutMs:20000},25000);assert.equal(quiet.connections,0);assert.ok(quiet.quietDurationMs>=1500);
    assert.ok(hosts.has(spxHost),'SPX_PERSISTS_AFTER_WINDOW');await scanPrivateFiles();
    for(const value of capabilities)assert.equal(JSON.stringify(runtime.snapshot()).includes(value),false,'SNAPSHOT_CAPABILITY_LEAK');
    const closeStarted=Date.now();let closeTimer;await Promise.race([runtime.close(),new Promise((_,reject)=>{closeTimer=setTimeout(()=>reject(Error('CLOSE_WAITED_FOR_IGNORED_PREPARATION')),5000);})]).finally(()=>clearTimeout(closeTimer));
    const closeDurationMs=Date.now()-closeStarted;assert.ok(!ending.released,'CLOSED_BEFORE_PREPARATION_SETTLEMENT');assert.equal(runtime.snapshot().closed,true);const afterCloseSpawnCount=spawnCount;
    ending.release();await until(()=>!runtime.snapshot().preparing,'PREPARATION_RELEASED',10000);await wait(300);assert.equal(spawnCount,afterCloseSpawnCount,'LATE_PREPARATION_RESTARTED_SERVICE');assert.equal(runtime.snapshot().deckId,accepted,'LATE_PREPARATION_PROMOTED_DECK');
    const lateQuiet=await probe.request('quiet',{durationMs:1500,timeoutMs:20000},25000);assert.equal(lateQuiet.connections,0);
    report={event:'prepared-event-private-ndi-windows-proof-passed',sourceCommit:process.env.PIRAIDERS_PROOF_SOURCE_SHA||null,
      casparProvenance:tools.provenance,ndiProvenance:ndi.provenance,runtimeVersion:probe.info.runtimeVersion,
      actualPreparedEventRuntime:true,localManualProvider:true,actualMediaCaptureDecode:true,actualCasparCEF:true,
      actualPrivateConsole:true,consoleConfigValidated,consoleVersions,consolePlays,privateGenerationCount,
      actualNdiConsumer:true,actualNdiSdkReceiver:true,sourceIdentityStable:true,sourceIdentityHash:expectedIdentity,
      frameEvidence,actualPNGAndJPEG:true,realRossTalk:true,bidirectionalWrap:true,failedReloadLastGood:true,
      sourceOfflineRootCrashRecovery:true,freshStoppedEpoch:true,explicitLaunchAfterRestart:true,realWallClockWindow:window,processStoppedAt,
      windowEndAutoFence:true,ignoredPreparationInjection:{realStageBeforeGate:true,ignoredPostStageSettlement:true,abortObserved:ending.abortObserved,closeBeforeRelease:true,closeDurationMs},
      quietAfterDrain:{connections:quiet.connections,durationMs:quiet.quietDurationMs,drainedFrames:quiet.drainedFrames},lateCompletionQuiet:{connections:lateQuiet.connections,durationMs:lateQuiet.quietDurationMs},
      persistentSPXStandIn:true,sameMachineOnly:true,lanTransportTested:false,windows10Tested:false,stadiumHardwareTested:false,
      noAllRootTcpAssertion:true,privateCapabilitiesExcludedFromDiagnostics:true};
  }catch(error){
    console.error(JSON.stringify({event:'prepared-event-proof-fixed-failure',phase,code:/^[A-Z_][A-Z_0-9]{0,79}$/.test(error.message)?error.message:'ASSERTION_OR_COMPONENT',fixedReceiverErrors:[...fixedReceiverErrors],nativeExits,framesVerified:frameEvidence.map(value=>value.name)}));
    throw Error('PREPARED_EVENT_PROOF_FAILED');
  }finally{
    openReloadSocket?.destroy();
    // Release the injected callback on failure so a broken close path cannot
    // deadlock bench cleanup. Success above already proves close-before-release.
    ending.release?.();
    const results=await Promise.allSettled([runtime?.close(),probe?.close()]);
    for(const child of hosts)child.stdin?.end();
    if(results.some(result=>result.status==='rejected'))throw Error('PREPARED_EVENT_PROOF_CLEANUP');
  }
  report.captures=[];for(const file of (await fs.readdir(evidence)).sort())if(/^[a-z0-9-]+\.png$/.test(file)){const bytes=await fs.readFile(path.join(evidence,file));report.captures.push({name:file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
  assert.ok(report.captures.length>0,'NDI_CAPTURES_REQUIRED');
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
if(require.main===module)main().catch(()=>{console.error('PREPARED_EVENT_PROOF_FAILED');process.exitCode=1;});
module.exports={main};
