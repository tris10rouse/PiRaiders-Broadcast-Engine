#!/usr/bin/env node
'use strict';
// Disposable native SDK proof only. Same-machine NDI may use local optimized
// transport; no LAN/Windows10/Daktronics/receiver hardware claim follows.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const {setTimeout:wait}=require('node:timers/promises');
const {performance}=require('node:perf_hooks');
const {PNG}=require('pngjs');
const jpeg=require('jpeg-js');
const {processTable:table,processTableForCapture,descendants,observeTree,identityReason,captureProcessTree}=require('./windows-process-evidence.cjs');
const {configuration,command}=require('./smoke-caspar-windows.cjs');
const {requestProbe}=require('./ndi-proof-client.cjs');
const {fixedFailure,systemFailure}=require('./ndi-proof-diagnostics.cjs');
const {JOB_HOST}=require('./lib/windows-job-process.cjs');
const {output:PROBE}=require('./build-ndi-probe.cjs');
const {LauncherRuntime}=require('./lib/launcher-runtime.cjs');
const {stageSnapshot}=require('./lib/media-snapshot.cjs');
const {createRossTalkSession}=require('./lib/rosstalk-session.cjs');
const net=require('node:net');
function ndiConfiguration(port,label){
  if(typeof label!=='string'||!/^[A-Za-z0-9-]{1,64}$/.test(label))throw Error('NDI_LABEL_INVALID');
  const xml=configuration(port);assert.ok(xml.includes('<consumers/>'));
  return xml.replace('<consumers/>','<consumers><ndi><name>'+label+'</name><allow-fields>false</allow-fields></ndi></consumers>');
}
async function until(predicate,code,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await predicate())return;await wait(100);}throw Error(code);}
// Capture complete identities while the sender is live, with time reserved for
// the near-boundary black frame. Never extend the event or infer missing rows.
async function captureEndingTree(host,end,getActive,{capture=captureProcessTree,wallNow=Date.now,now=()=>performance.now()}={}){
  const live=()=>getActive()===host&&host.exitCode===null&&host.signalCode===null;
  const remaining=end-wallNow()-5000;
  if(!Number.isFinite(remaining)||remaining<=0||!live())throw Error('WINDOW_CAPTURE_LATE');
  const result=await capture(host.pid,{deadline:now()+Math.min(15000,remaining),expectedParentPid:process.pid,expectedImage:JOB_HOST});
  if(wallNow()>=end-5000||!live())throw Error('WINDOW_CAPTURE_STALE');
  return result.tree;
}
// Q-004: the crash phase's listing ran once under the 15 s query bound and timed
// out on hosted Windows twice (16f82e8, 730b0f1) after every frame had passed.
// It is a pre-action capture (nothing is killed yet, no cleanup deadline runs),
// so, as in the Caspar proof, only a timed-out query may repeat (at most 3) and
// every query is counted in the report and the fixed diagnostic. Deadline-bound
// observations (treeGone) keep a single processTable() call.
function crashEnumerationTable(processEnumeration,{read=table}={}){
  return processTableForCapture({read,record:({timedOut,elapsedMs})=>{processEnumeration.captureQueries++;if(timedOut)processEnumeration.captureTimeouts++;processEnumeration.maxCaptureMs=Math.max(processEnumeration.maxCaptureMs,elapsedMs);}});
}
async function freePort(){const server=net.createServer();await new Promise((r,j)=>server.listen(0,'127.0.0.1',r).once('error',j));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
function image(rgb){const data=Buffer.alloc(160*90*4);for(let i=0;i<data.length;i+=4)data.set([...rgb,255],i);return{width:160,height:90,data};}
async function filesUnder(dir){const all=[];for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())all.push(...await filesUnder(file));else if(entry.isFile())all.push(file);}return all;}
async function main(){
  if(process.platform!=='win32')throw Error('WINDOWS_REQUIRED');
  let processEvidence=null;const processChecks={},processUnknownObservations={},processEnumeration={captureQueries:0,captureTimeouts:0,maxCaptureMs:0};
  function treeGone(captured){processEvidence=observeTree(table(),captured);processChecks[phase]=processEvidence;if(processEvidence.unknown)processUnknownObservations[phase]=(processUnknownObservations[phase]||0)+1;return processEvidence.surviving===0&&processEvidence.unknown===0;}
  const root=path.resolve(process.argv[2]||path.join('build','caspar-proof-tools'));
  const evidence=path.resolve('build','ndi-proof-evidence');await fs.rm(evidence,{recursive:true,force:true});await fs.mkdir(evidence,{recursive:true});
  const tools=JSON.parse(await fs.readFile(path.join(root,'tools.json'),'utf8'));
  const ndi=JSON.parse(await fs.readFile(path.join(root,'ndi-runtime.json'),'utf8'));
  await fs.access(PROBE);await fs.access(JOB_HOST);
  const bin=tools.casparDirectory,label='PiRaiders-CI-'+crypto.randomUUID().replaceAll('-','');
  const hosts=new Set(),nativeExits=[],fixedReceiverErrors=new Set(),negativeControlErrors=new Set(),frameEvidence=[];
  let activeCaspar,runtime,session,probe,phase='RECEIVER',report,expectedIdentity=null,programToken=null;
  let casparStartup='',window;
  function contained(executable,args,options={},role='service'){
    const child=spawn(JOB_HOST,[executable,...args],{cwd:options.cwd,env:{...process.env,...options.env},windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    child.stdin.on('error',()=>{});hosts.add(child);
    child.closed=new Promise(resolve=>child.once('close',(code,signal)=>{hosts.delete(child);nativeExits.push({role,code,signal});resolve({code,signal});}));
    child.on('error',()=>{});
    if(role==='caspar'){
      activeCaspar=child;
      for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{
        // No producer URL exists in Caspar until START has completed.
        if(phase==='START'&&casparStartup.length<16384)casparStartup+=(chunk.toString('utf8')).slice(0,16384-casparStartup.length);
      });
    }
    return child;
  }
  async function receiver(dllPath,negativeControl=false){
    let startupBuffer='';
    const receiverErrors=negativeControl?negativeControlErrors:fixedReceiverErrors;
    const token=crypto.randomBytes(32).toString('base64url');
    const child=contained(PROBE,[dllPath,label,evidence],{env:{PIRAIDERS_NDI_PROBE_TOKEN:token}},negativeControl?'receiver-negative-control':'receiver');
    let port,seq=0,done=false,buffer=Buffer.alloc(0);
    let resolveReady,rejectReady;
    const ready=new Promise((r,j)=>{resolveReady=r;rejectReady=j;});
    const timer=setTimeout(()=>finish(Error('RECEIVER_START_TIMEOUT')),20000);
    function finish(error,value){if(done)return;done=true;clearTimeout(timer);if(error){child.stdin.end();rejectReady(error);}else resolveReady(value);}
    child.once('error',()=>finish(Error('RECEIVER_SPAWN')));
    child.closed.then(()=>finish(Error('RECEIVER_EXITED')));
    child.stderr.on('data',chunk=>{startupBuffer=(startupBuffer+chunk.toString('utf8')).slice(-4096);for(const line of startupBuffer.split(/\r?\n/))if(/^NDI_PROBE_FAILED_[A-Z_]+$/.test(line))receiverErrors.add(line);});
    child.stdout.on('data',chunk=>{
      if(done)return;if(buffer.length+chunk.length>16384)return finish(Error('RECEIVER_START_LIMIT'));
      buffer=Buffer.concat([buffer,chunk]);for(let end;(end=buffer.indexOf('\n'))>=0;){const line=buffer.subarray(0,end).toString('utf8');buffer=buffer.subarray(end+1);
        let value;try{value=JSON.parse(line);}catch{continue;}
        if(value?.event!=='ndi-probe-ready')continue;
        if(!Number.isInteger(value.port)||value.port<1||value.port>65535||value.abiValid!==true||typeof value.runtimeVersion!=='string'||value.runtimeVersion.length>255||/[\x00-\x1f\x7f]/.test(value.runtimeVersion))return finish(Error('RECEIVER_READY_INVALID'));
        port=value.port;finish(null,value);
      }
    });
    let info;try{info=await ready;}catch(error){await child.closed;throw error;}
    return{child,info,request:async(name,values={},timeoutMs=30000)=>requestProbe(port,token,++seq,name,values,timeoutMs),async close(){
      try{
        if(child.exitCode===null)await requestProbe(port,token,++seq,'close',{},5000);
        // Wait for normal native SDK destruction before closing containment.
        // EOF is reserved for failed/stalled cleanup, never a successful proof.
        let timer;const result=await Promise.race([child.closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('RECEIVER_CLOSE_TIMEOUT')),10000);})]).finally(()=>clearTimeout(timer));
        if(result.code!==0||result.signal)throw Error('RECEIVER_CLOSE_FAILED');
      }finally{child.stdin.end();}
    }};
  }
  try{
    // Real Windows negative: a missing SDK library must fail before any control
    // endpoint is admitted. The helper's fixed error proves which check failed.
    await assert.rejects(receiver(path.join(root,'missing','Processing.NDI.Lib.x64.dll'),true));
    assert.ok(negativeControlErrors.has('NDI_PROBE_FAILED_RUNTIME_PATH'),'MISSING_RUNTIME_NOT_REJECTED');
    probe=await receiver(ndi.dllPath);
    const sourceDir=path.join(root,'ndi-initial'),replacementDir=path.join(root,'ndi-replacement');
    await fs.mkdir(sourceDir);await fs.mkdir(replacementDir);
    await fs.writeFile(path.join(sourceDir,'01.png'),PNG.sync.write(image([240,20,20])));
    await fs.writeFile(path.join(sourceDir,'02.jpg'),jpeg.encode(image([20,20,240]),95).data);
    await fs.writeFile(path.join(replacementDir,'01.png'),PNG.sync.write(image([20,220,20])));
    const initial=await stageSnapshot({sourceDir,cacheDir:path.join(root,'ndi-snapshots'),quietMs:0});
    const replacement=await stageSnapshot({sourceDir:replacementDir,cacheDir:path.join(root,'ndi-snapshots'),quietMs:0});
    await fs.rm(sourceDir,{recursive:true});await fs.rm(replacementDir,{recursive:true});
    const port=await freePort(),config=path.join(bin,'piraiders-ndi-proof.config');
    for(const folder of ['media','log','data','template'])await fs.mkdir(path.join(bin,folder),{recursive:true});
    await fs.writeFile(config,ndiConfiguration(port,label));
    // Real wall clock, short explicit bench window, no default15m wait. Receiver
    // and all staging are ready before the window is configured.
    window={start:new Date(Date.now()+6000).toISOString(),end:new Date(Date.now()+180000).toISOString(),prewarmMinutes:0};
    runtime=new LauncherRuntime({productionWindow:window,services:[
      {name:'spx',command:process.execPath,args:['-e','setInterval(()=>{},1000)']},
      {name:'casparcg',command:path.join(bin,'casparcg.exe'),args:[config,'--log-severity=disable','--disable-logging'],cwd:bin}
    ]},{supervisorOptions:{maxRestarts:1,restartDelayMs:100,spawnProcess:(exe,args,options)=>contained(exe,args,{...options,env:{GALLIUM_DRIVER:'llvmpipe',LIBGL_ALWAYS_SOFTWARE:'1',MESA_GL_VERSION_OVERRIDE:'4.5COMPAT',NDI_RUNTIME_DIR_V6:ndi.runtimeDirectory}},exe.toLowerCase().endsWith('casparcg.exe')?'caspar':'spx-standin')}});
    phase='START';await runtime.start();assert.equal(runtime.sender,null);
    await probe.request('absent',{durationMs:1000});assert.equal(runtime.sender,null,'NO_SENDER_BEFORE_WINDOW');
    await until(async()=>{try{await command(port,'VERSION',{prefix:'201 ',timeoutMs:1000});return true;}catch{return false;}},'CASPAR_STARTUP',60000);
    const discover=await probe.request('discover',{timeoutMs:30000},35000);expectedIdentity=discover.sourceIdentityHash;
    assert.match(expectedIdentity,/^[0-9a-f]{64}$/);
    async function frame(name,rgb,options={}){
      const r=await probe.request('frame',{name,rgb,minFrames:3,minDurationMs:0,timeoutMs:20000,...options},25000);
      assert.equal(r.sourceIdentityHash,expectedIdentity,'SOURCE_IDENTITY_CHANGED');
      assert.ok(Number.isInteger(r.distinctTimestamps)&&r.distinctTimestamps>=3&&r.connections>0,'FRESH_NDI_FRAMES_REQUIRED');
      assert.equal(r.width,1920);assert.equal(r.height,1080);assert.equal(r.frameRateN,30*r.frameRateD);assert.ok(['BGRA','BGRX'].includes(r.format));
      frameEvidence.push({name,matchedFrames:r.matchedFrames,distinctTimestamps:r.distinctTimestamps,sampleDurationMs:r.sampleDurationMs,format:r.format});
      console.log(JSON.stringify({event:'ndi-frame-verified',name,distinctTimestamps:r.distinctTimestamps}));
    }
    await command(port,'PLAY 1-10 RED');await frame('mixer-red',[255,0,0]);
    phase='PRESENTATION';await command(port,'CLEAR 1');
    session=await createRossTalkSession({presentation:{snapshotDir:initial.snapshotDir,commandTimeoutMs:20000,controllerOptions:{mode:'manual'}},rossTalk:{host:'127.0.0.1',port:0,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',2:'next',3:'previous',5:'reload',8:'stop'},acknowledgements:true},canControl:()=>runtime.allowed(),resolvePreparedSnapshot:async()=>replacement.snapshotDir},{allowEphemeral:true});
    await session.start();const url=session.getProgramURL();programToken=new URL(url).hash.split('=')[1];
    await command(port,'PLAY 1-10 [HTML] "'+url+'"');
    await until(()=>session.snapshot().presentation.renderer.ready,'CEF_INITIAL_BLACK',60000);await frame('prepared-black',[0,0,0]);
    const talk=session.address().port;
    await command(talk,'GPI 1',{prefix:'OK ',timeoutMs:30000});await frame('launch-red',[240,20,20]);
    await command(talk,'GPI 2',{prefix:'OK ',timeoutMs:30000});await frame('next-blue',[20,20,240]);
    await command(talk,'GPI 3',{prefix:'OK ',timeoutMs:30000});await frame('previous-red',[240,20,20]);
    await command(talk,'GPI 5',{prefix:'OK ',timeoutMs:45000});await frame('reload-green',[20,220,20]);
    await command(talk,'GPI 8',{prefix:'OK ',timeoutMs:30000});await frame('stop-black',[0,0,0],{minFrames:10,minDurationMs:1500});
    await command(port,'VERSION',{prefix:'201 '});
    phase='CRASH_ENUMERATE';const oldHost=activeCaspar,oldEpoch=session.snapshot().presentation.renderer.epoch;
    const rows=crashEnumerationTable(processEnumeration),expectedImage=path.join(bin,'casparcg.exe').toLowerCase();
    phase='CRASH_SELECT';
    const ownedRoots=descendants(rows,oldHost.pid).filter(r=>r.ParentProcessId===oldHost.pid&&typeof r.ExecutablePath==='string'&&path.normalize(r.ExecutablePath).toLowerCase()===expectedImage);
    assert.equal(ownedRoots.length,1,'OWNED_ROOT_IDENTITY');
    const oldTree=descendants(rows,oldHost.pid);
    phase='CRASH_TERMINATE';
    execFileSync('taskkill.exe',['/PID',String(ownedRoots[0].ProcessId),'/F'],{stdio:'ignore',windowsHide:true,timeout:15000});
    phase='CRASH_RESTART';
    await until(async()=>{if(activeCaspar===oldHost)return false;try{await command(port,'VERSION',{prefix:'201 ',timeoutMs:1000});return true;}catch{return false;}},'CASPAR_RESTART',60000);
    phase='CRASH_OLD_TREE';
    await until(()=>treeGone(oldTree),'OLD_TREE_SURVIVED',10000);
    phase='CRASH_OLD_RENDERER';
    await until(()=>!session.snapshot().presentation.renderer.connected,'OLD_RENDERER_SURVIVED',10000);
    phase='CRASH_REPLAY';
    await command(port,'PLAY 1-10 [HTML] "'+session.getProgramURL()+'"');
    phase='CRASH_READY';
    await until(()=>session.snapshot().presentation.renderer.ready,'RESTART_INITIAL_BLACK',60000);
    assert.notEqual(session.snapshot().presentation.renderer.epoch,oldEpoch,'RESTART_EPOCH_UNCHANGED');assert.equal(session.snapshot().presentation.controller.state,'stopped','RESTART_NOT_STOPPED');
    phase='CRASH_FRAMES';
    await frame('restart-black',[0,0,0]);
    await command(talk,'GPI 1',{prefix:'OK ',timeoutMs:30000});await frame('restart-launch-green',[20,220,20]);
    await command(talk,'GPI 8',{prefix:'OK ',timeoutMs:30000});
    phase='WINDOW_CAPTURE';
    await until(()=>Date.now()>=Date.parse(window.end)-30000,'WINDOW_CAPTURE_WAIT',180000);
    const endingHost=activeCaspar;
    const endingTree=await captureEndingTree(endingHost,Date.parse(window.end),()=>activeCaspar);
    phase='WINDOW_END';
    // Sender must be alive/black close to the real boundary, not merely on the
    // first post-Stop frame. Do not extend the window if earlier work ran late.
    await until(()=>Date.now()>=Date.parse(window.end)-5000,'WINDOW_BOUNDARY_WAIT',180000);
    await frame('pre-end-black',[0,0,0],{minFrames:10,minDurationMs:1000});
    assert.equal(activeCaspar,endingHost,'WINDOW_HOST_CHANGED');
    assert.equal(endingHost.exitCode,null,'WINDOW_HOST_EXITED');
    assert.equal(endingHost.signalCode,null,'WINDOW_HOST_SIGNALED');
    await until(()=>Date.now()>=Date.parse(window.end)&&runtime.sender===null,'WINDOW_END_PROCESS',20000);
    const processStoppedAt=new Date().toISOString();
    await until(()=>treeGone(endingTree),'WINDOW_TREE_SURVIVED',10000);
    const quiet=await probe.request('quiet',{durationMs:1500,timeoutMs:20000},25000);
    assert.equal(quiet.connections,0);assert.ok(quiet.quietDurationMs>=1500);
    assert.ok(hosts.size>=2,'Persistent SPX stand-in and receiver remain until close');
    phase='PRIVACY';
    for(const file of await filesUnder(bin))if(/\.(?:log|txt|json|config)$/i.test(file)){
      const stat=await fs.stat(file);if(stat.size>16*1024*1024)throw Error('LOG_SCAN_LIMIT');
      const bytes=await fs.readFile(file);if(bytes.includes(Buffer.from(programToken))||bytes.includes(Buffer.from(programToken,'utf16le')))throw Error('PRIVATE_URL_PERSISTED');
    }
    report={event:'real-ndi-windows-software-proof-passed',sourceCommit:process.env.PIRAIDERS_PROOF_SOURCE_SHA||null,casparProvenance:tools.provenance,ndiProvenance:ndi.provenance,runtimeVersion:probe.info.runtimeVersion,actualNdiSdkReceiver:true,actualNdiConsumer:true,sourceIdentityStable:true,sourceIdentityHash:expectedIdentity,frameEvidence,missingRuntimeRejected:true,actualPNGAndJPEG:true,rootCrashRecovery:true,freshStoppedEpochAfterRestart:true,realWallClockWindow:window,processStoppedAt,processIdentityEvidence:'pid-creation-utc-ticks-and-image',processChecks,processUnknownObservations,processEnumeration,quietAfterDrain:{connections:quiet.connections,durationMs:quiet.quietDurationMs,drainedFrames:quiet.drainedFrames},persistentSPXStandIn:true,sameMachineOnly:true,lanTransportTested:false,windows10Tested:false,stadiumHardwareTested:false};
  }catch(error){
    console.error(JSON.stringify({event:'ndi-proof-fixed-diagnostic',phase,processEvidence,processChecks,processUnknownObservations,processEnumeration,processIdentityReason:identityReason(error),code:fixedFailure(error),systemErrorCode:systemFailure(error),fixedReceiverErrors:[...fixedReceiverErrors],negativeControlErrors:[...negativeControlErrors],nativeExits,framesVerified:frameEvidence.map(f=>f.name)}));
    if(phase==='START')console.error(JSON.stringify({event:'ndi-preauth-caspar-startup',text:casparStartup.replace(/https?:\/\/[^\s<>"']+/g,'[URL omitted]')}));
    throw Error('NDI_PROOF_FAILED_'+phase);
  }finally{
    // Sender shutdown is independent of receiver/presentation completion.
    const results=await Promise.allSettled([runtime?.close(),session?.close(),probe?.close()]);
    for(const child of hosts)child.stdin.end();
    if(results.some(r=>r.status==='rejected'))throw Error('NDI_PROOF_FAILED_CLEANUP');
  }
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
if(require.main===module)main().catch(error=>{console.error(/^NDI_PROOF_FAILED_[A-Z_]+$/.test(error.message)?error.message:'NDI_PROOF_FAILED');process.exitCode=1;});
module.exports={ndiConfiguration,captureEndingTree,crashEnumerationTable};
