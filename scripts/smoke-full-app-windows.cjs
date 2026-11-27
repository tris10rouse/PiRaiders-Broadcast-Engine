#!/usr/bin/env node
'use strict';
// Actual application entry/default native boundaries on disposable Windows CI.
// Same-machine receiver evidence only; no hardware or installation-readiness claim.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const net=require('node:net');
const {spawn,execFileSync}=require('node:child_process');
const {setTimeout:wait}=require('node:timers/promises');
const {performance}=require('node:perf_hooks');
const {chromium}=require('playwright');
const {PNG}=require('pngjs');
const jpeg=require('jpeg-js');
const {JOB_HOST}=require('./lib/windows-job-process.cjs');
const {output:PROBE}=require('./build-ndi-probe.cjs');
const {requestProbe}=require('./ndi-proof-client.cjs');
const {receiverRecord}=require('./lib/receiver-record.cjs');
const {receiverEvidence}=require('./soak-windows-job.cjs');
const receiverLifetime=require('./lib/receiver-lifetime.cjs');
const {command}=require('./smoke-caspar-windows.cjs');
const {checkConsolePixels}=require('./smoke-caspar-console-windows.cjs');
const {processTable,descendants,treeState,observeTree,identityReason,identityCaptureDiagnostics,captureProcessTree}=require('./windows-process-evidence.cjs');
const {createRuntimeDiagnostics,canonicalImage,cleanAppEnvironment,sourceLocation,prepareExtracted,verifyOriginalInventory,captureAppParent,assertOuterBench}=require('./extracted-app-proof.cjs');
const {startArgs}=require('./console-close-proof.cjs');
const {proofRuntime,proofMachine,assertNoSeparateRuntime,checkBundledCaspar,graphicsRecord}=require('./extracted-bundle-proof.cjs');
const {runGraphicsCheck}=require('./lib/graphics-check.cjs');
const checkoutRoot=path.resolve(__dirname,'..');
function normalized(file){return path.win32.normalize(file).toLowerCase();}
function ownedCaspar(rows,parent,executable,{allowAbsent=false,jobHost=JOB_HOST,resolveImage=normalized}={}){
 const tree=descendants(rows,parent),images=tree.filter(row=>resolveImage(row.ExecutablePath)===resolveImage(executable));
 if(allowAbsent&&images.length===0)return null;
 // CEF may reuse the sender image; only a direct child of an owned JobHost
 // is a sender root. An image-matching descendant alone grants no authority.
 const matches=images.filter(row=>tree.some(host=>host.ProcessId===row.ParentProcessId&&resolveImage(host.ExecutablePath)===resolveImage(jobHost)));
 if(images.length&&matches.length===0)assert.fail('OWNED_CASPAR_JOB_HOST');
 assert.equal(matches.length,1,'OWNED_CASPAR_ROOT');
 const root=matches[0],host=tree.find(row=>row.ProcessId===root.ParentProcessId);
 return{root,host,tree:descendants(rows,host.ProcessId)};
}
// Capture both ownership levels inside ONE caller deadline. The second snapshot
// pins the selected sender host and retains complete transient children for later
// cleanup; the actual kill target must remain the same fully-known generation.
function processCaptureDeadline(windowEnd,outer=Infinity,{monotonicNow=performance.now(),wallNow=Date.now()}={}){
 assert.ok(Number.isFinite(monotonicNow)&&Number.isFinite(wallNow)&&(Number.isFinite(outer)||outer===Infinity),'CAPTURE_CLOCK_VALID');
 const end=windowEnd===null?Infinity:Date.parse(windowEnd);assert.ok(Number.isFinite(end)||windowEnd===null,'CAPTURE_WINDOW_VALID');
 return Math.min(outer,monotonicNow+Math.max(0,Math.min(15000,end-wallNow)));
}
async function capturePinnedTree(parent,{deadline,capture=captureProcessTree,scope='tree'}={}){
 return capture(parent.ProcessId,{deadline,scope,expectedParentPid:parent.ParentProcessId,expectedImage:parent.ExecutablePath,expectedRoot:parent});
}
async function captureOwnedCaspar(parent,executable,{deadline,allowAbsent=false,jobHost=JOB_HOST,resolveImage=normalized,capture=captureProcessTree,now=()=>performance.now()}={}){
 assert.ok(Number.isFinite(deadline)&&now()<deadline,'CAPTURE_BEFORE_DEADLINE');
 const app=await capturePinnedTree(parent,{deadline,capture,scope:'application'});
 assert.ok(now()<deadline,'CAPTURE_BEFORE_DEADLINE');
 const selected=ownedCaspar(app.currentTree,parent.ProcessId,executable,{allowAbsent,jobHost,resolveImage});
 assert.ok(now()<deadline,'CAPTURE_BEFORE_DEADLINE');
 if(!selected)return null;
 const sender=await capturePinnedTree(selected.host,{deadline,capture,scope:'sender'});
 assert.ok(now()<deadline,'CAPTURE_BEFORE_DEADLINE');
 const verified=ownedCaspar(sender.currentTree,selected.host.ProcessId,executable,{jobHost,resolveImage});
 for(const key of ['ProcessId','ParentProcessId','CreationUtcTicks','ExecutablePath'])assert.equal(verified.root[key],selected.root[key],'SENDER_GENERATION_CHANGED_DURING_CAPTURE');
 assert.ok(now()<deadline,'CAPTURE_BEFORE_DEADLINE');
 return{root:verified.root,host:verified.host,tree:sender.tree};
}
function startedNoEarlierThan(row,utc){const ms=Date.parse(utc);assert.ok(Number.isSafeInteger(ms),'WINDOW_TIMESTAMP');assert.match(row.CreationUtcTicks,/^[1-9][0-9]{0,18}$/);return BigInt(row.CreationUtcTicks)>=621355968000000000n+BigInt(ms)*10000n;}
// Preserve only a developer-authored assertion label, never its value diff.
function fixedFailure(error){
 const message=error instanceof assert.AssertionError?error.message.split('\n',1)[0]:error?.message;
 return typeof message==='string'&&/^[A-Z_][A-Z_0-9]{0,79}$/.test(message)?message:'ASSERTION_OR_COMPONENT';
}
function privateText(bytes){return /#piraiders=[A-Za-z0-9_-]{40,}/.test(bytes.toString('utf8'))||/#piraiders=[A-Za-z0-9_-]{40,}/.test(bytes.toString('utf16le'));}
async function until(predicate,code,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await predicate())return;await wait(100);}throw Error(code);}
async function freePort(){const server=net.createServer();await new Promise((r,j)=>server.listen(0,'127.0.0.1',r).once('error',j));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
function image(rgb){const data=Buffer.alloc(160*90*4);for(let i=0;i<data.length;i+=4)data.set([...rgb,255],i);return{width:160,height:90,data};}
async function filesUnder(dir){const all=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())all.push(...await filesUnder(file));else if(e.isFile())all.push(file);}return all;}
function own(child){child.stdin?.on('error',()=>{});child.on('error',()=>{});child.closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));return child;}
async function settledChild(child){let timer;return Promise.race([child.closed,new Promise((r,j)=>{timer=setTimeout(()=>j(Error('OWNED_PROCESS_CLOSE_TIMEOUT')),10000);})]).finally(()=>clearTimeout(timer));}
async function closeChild(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;child.stdin?.end();await settledChild(child);}
async function killApplication(child){
 if(!child||child.exitCode!==null||child.signalCode!==null)return;
 let tree,enumerationFailed=false;try{tree=descendants(processTable(),child.pid);}catch{enumerationFailed=true;}
 child.kill();await settledChild(child);
 if(enumerationFailed)throw Error('APP_CLEANUP_IDENTITY_UNVERIFIED');
 await until(()=>{const value=observeTree(processTable(),tree);return value.surviving===0&&value.unknown===0;},'CLEANUP_APP_TREE_SURVIVED',10000);
}
// Cleanup only. Failure assertions remain latched even if this fallback removes
// a surviving recorded JobHost after parent-loss containment failed.
async function cleanupCaptured(captured,jobHost=JOB_HOST,resolveImage=normalized){
 if(!captured)return;const rows=processTable();observeTree(rows,captured);
 for(const old of captured)if(resolveImage(old.ExecutablePath)===resolveImage(jobHost)){
  const live=rows.find(row=>row.ProcessId===old.ProcessId);
  if(live&&typeof live.ExecutablePath==='string'&&live.CreationUtcTicks===old.CreationUtcTicks&&normalized(live.ExecutablePath)===old.ExecutablePath&&live.ParentProcessId===old.ParentProcessId)
   try{execFileSync('taskkill.exe',['/PID',String(old.ProcessId),'/F'],{stdio:'ignore',timeout:15000,windowsHide:true});}catch{if(treeState(processTable(),[old]).surviving)throw Error('CLEANUP_JOB_HOST_SURVIVED');}
 }
 await until(()=>{const value=observeTree(processTable(),captured);return value.surviving===0&&value.unknown===0;},'CLEANUP_RECORDED_TREE_SURVIVED',10000);
}
// Q-011: `bench` replaces the receiver's command for the Linux test only
// (`bench.args` may be a function of the real arguments).
// Every failed request, start or close carries `error.receiver`, the
// receiver's recorded exit and fixed-word stderr (scripts/lib/receiver-record.cjs).
// Q-012: `lifetimeMinutes` (the soak only) is checked before the spawn, passed
// as the receiver's fourth argument and must come back in its ready line;
// without it the receiver keeps its 8-minute default, also checked when echoed.
// Q-001: the record keeps the receiver's start steps; a start timeout carries
// them, the record says the start bound (`bench.startTimeoutMs`, Linux tests
// only; else 20 s) and a started receiver answers `startMs`.
const RECEIVER_START_MS=20000;
async function receiver(root,dll,label,evidence,bench={},{lifetimeMinutes}={}){
 const real=[PROBE,dll,label,evidence,...receiverLifetime.lifetimeArgs(lifetimeMinutes)];
 const expectedLifetime=lifetimeMinutes===undefined?receiverLifetime.DEFAULT_MINUTES:lifetimeMinutes;
 const startTimeoutMs=bench.startTimeoutMs===undefined?RECEIVER_START_MS:bench.startTimeoutMs;
 if(!Number.isInteger(startTimeoutMs)||startTimeoutMs<1||startTimeoutMs>RECEIVER_START_MS)throw Error('RECEIVER_START_BOUND');
 const token=crypto.randomBytes(32).toString('base64url'),record=receiverRecord(),snapshot=()=>({...record.snapshot(),startTimeoutMs});
 const child=own(spawn(bench.executable||JOB_HOST,typeof bench.args==='function'?bench.args(real):bench.args||real,{cwd:root,env:{...process.env,PIRAIDERS_NDI_PROBE_TOKEN:token},windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']}));
 child.closed.then(({code,signal})=>record.exited(code,signal));child.stderr.on('data',chunk=>record.stderr(chunk));
 // A lost connection usually means the receiver is exiting: give its exit a moment to be recorded.
 async function evidenceOn(error,settleMs){
  // Waits on the record, not exitCode: `exit` can come before stderr closes, and only `close` records it.
  if(settleMs&&record.snapshot().running){let timer;await Promise.race([child.closed,new Promise(r=>{timer=setTimeout(r,settleMs);})]);clearTimeout(timer);}
  if(error&&typeof error==='object')error.receiver=snapshot();return error;
 }
 let seq=0,port,done=false,buffer=Buffer.alloc(0),timer;
 const ready=new Promise((resolve,reject)=>{
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
  timer=setTimeout(()=>finish(Error('RECEIVER_START_TIMEOUT')),startTimeoutMs);
  child.once('error',()=>finish(Error('RECEIVER_SPAWN')));child.closed.then(()=>finish(Error('RECEIVER_EXITED')));
  child.stdout.on('data',chunk=>{
   if(done)return;if(buffer.length+chunk.length>16384)return finish(Error('RECEIVER_START_LIMIT'));
   buffer=Buffer.concat([buffer,chunk]);for(let end;(end=buffer.indexOf('\n'))>=0;){
    const line=buffer.subarray(0,end).toString('utf8');buffer=buffer.subarray(end+1);let value;try{value=JSON.parse(line);}catch{continue;}
    if(value?.event!=='ndi-probe-ready')continue;
    if(!Number.isInteger(value.port)||value.port<1||value.port>65535||value.abiValid!==true||typeof value.runtimeVersion!=='string'||value.runtimeVersion.length>255||/[\x00-\x1f\x7f]/.test(value.runtimeVersion))return finish(Error('RECEIVER_READY_INVALID'));
    if((lifetimeMinutes!==undefined||value.lifetimeMinutes!==undefined)&&value.lifetimeMinutes!==expectedLifetime)return finish(Error('RECEIVER_LIFETIME_MISMATCH'));
    port=value.port;record.ready();finish(null,value);
   }
  });
 });
 let info;try{info=await ready;}catch(error){try{await closeChild(child);}finally{await evidenceOn(error,0);}throw error;}
 return{child,info,startMs:record.snapshot().readyAfterMs,diagnostics:snapshot,
  async request(name,values={},timeoutMs=30000){
   try{return await requestProbe(port,token,++seq,name,values,timeoutMs);}
   catch(error){throw await evidenceOn(error,/^PROBE_(CONNECTION|CLOSED)$/.test(error?.message)?3000:0);}
  },
  async close(){
   let failed;try{if(child.exitCode===null)await requestProbe(port,token,++seq,'close',{},5000);const result=await settledChild(child);assert.equal(result.code,0,'RECEIVER_CLOSE_FAILED');assert.equal(result.signal,null,'RECEIVER_CLOSE_SIGNAL');}catch(error){failed=error;}
   finally{child.stdin.end();await settledChild(child);}if(failed)throw await evidenceOn(failed,0);
  }};
}
// 5d-2: with `consoleHost` the source entry runs in a console of its own
// (scripts/console-close-proof.cjs); the application process is that host's
// one direct Node child.
function consoleApplication(rows,hostPid,nodeExecutable){
 const found=descendants(rows,hostPid).filter(row=>row.ParentProcessId===hostPid&&typeof row.ExecutablePath==='string'&&normalized(row.ExecutablePath)===normalized(nodeExecutable));
 assert.equal(found.length,1,'CONSOLE_APP_PARENT');return found[0];
}
// 5d-3: with `browser` the source entry starts as the operator starts it, without
// --no-browser, and must answer browserOpened true; every other start answers false.
function appEntry(location,machineFile,{browser=false}={}){
 if(typeof browser!=='boolean')throw Error('APP_BROWSER_OPTION');
 if(browser&&location.extracted)throw Error('APP_BROWSER_SOURCE_ONLY');
 return[path.join(location.appRoot,'scripts','piraiders-app.cjs'),machineFile,...(browser?[]:['--no-browser'])];
}
async function application(machineFile,expectedURL,location,{consoleHost,browser=false}={}){
 // Actual user entry. No preload, injected spawn, manager/runtime or fake child.
 const env=cleanAppEnvironment(process.env,process.env.SystemRoot);
 assert.ok(consoleHost===undefined||(!location.extracted&&typeof consoleHost==='string'),'CONSOLE_HOST_SOURCE_ONLY');
 const entry=appEntry(location,machineFile,{browser});
 const child=location.extracted
  ?own(spawn(location.jobHost,[location.powershell,'-NoLogo','-NoProfile','-NonInteractive','-Command','& $env:PIRAIDERS_PROOF_ENTRY --no-browser; $appExit=$LASTEXITCODE; Start-Sleep -Seconds 60; exit $appExit'],{cwd:location.appRoot,env:{...env,PIRAIDERS_PROOF_ENTRY:location.entry},windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']}))
  :consoleHost?own(spawn(consoleHost,startArgs(location.nodeExecutable,entry),{cwd:location.appRoot,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']}))
  :own(spawn(location.nodeExecutable,entry,{cwd:location.appRoot,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']}));
 let buffer=Buffer.alloc(0),total=0,ready=false,browserAnswer;const categories=new Set();
 child.stderr.on('data',chunk=>{const text=chunk.toString('utf8');for(const line of text.split(/\r?\n/))if(/^[A-Z_]{1,64}$/.test(line))categories.add(line);});
 child.stdout.on('data',chunk=>{total+=chunk.length;if(total>65536){categories.add('APP_STDOUT_LIMIT');return;}buffer=Buffer.concat([buffer,chunk]);for(let end;(end=buffer.indexOf('\n'))>=0;){const line=buffer.subarray(0,end).toString('utf8');buffer=buffer.subarray(end+1);let value;try{value=JSON.parse(line);}catch{continue;}if(value.component==='piraiders-app'&&value.event==='browser-open-failed')categories.add('BROWSER_OPEN_FAILED');if(value.component==='piraiders-app'&&value.event==='controller-available'&&value.url===expectedURL&&typeof value.browserOpened==='boolean'){browserAnswer=value.browserOpened;ready=true;}}});
 try{await until(()=>{if(child.exitCode!==null||child.signalCode!==null)throw Error('APPLICATION_START_EXIT');return ready&&!categories.has('APP_STDOUT_LIMIT');},'APPLICATION_START_TIMEOUT',20000);
  assert.equal(browserAnswer,browser,browser?'APP_DID_NOT_REPORT_BROWSER_OPENED':'APP_OPENED_A_BROWSER');}catch(error){await killApplication(child);throw error;}
 try{const rows=processTable(),captured=location.extracted?captureAppParent(rows,child.pid,location.nodeExecutable,location.powershell):{parent:consoleHost?consoleApplication(rows,child.pid,location.nodeExecutable):descendants(rows,child.pid)[0],outerRoots:null};
  return{child,categories,browserOpened:browserAnswer,parentPid:captured.parent.ProcessId,parentIdentity:captured.parent,outerRoots:captured.outerRoots};
 }catch(error){await killApplication(child);throw error;}
}
async function scenario(location){
 const root=path.resolve(process.argv[2]||path.join(checkoutRoot,'build','caspar-proof-tools'));
 const evidence=path.join(checkoutRoot,'build',location.extracted?'extracted-full-app-proof-evidence':'full-app-proof-evidence'),fixture=path.join(location.appRoot,'build','full-app-proof-fixture');
 for(const dir of [evidence,fixture]){await fs.rm(dir,{recursive:true,force:true});await fs.mkdir(dir,{recursive:true});}
 // Q-021: the extracted ZIP runs its own Caspar (software mirror, its Mesa) and
 // NDI DLL, and the receiver loads that DLL; root is then only the receiver's
 // working folder. The source tree keeps the CI-prepared tools in root.
 if(location.extracted){assertNoSeparateRuntime(process.env);await fs.mkdir(root,{recursive:true});}
 const runtime=proofRuntime({extracted:location.extracted,appRoot:location.appRoot,toolsRoot:root,readJSON:file=>JSON.parse(require('node:fs').readFileSync(file,'utf8'))});
 const resolveImage=location.extracted?canonicalImage:normalized;
 function isCaspar(row){try{return resolveImage(row.ExecutablePath)===resolveImage(runtime.casparExecutable);}catch{return false;}}
 for(const file of [PROBE,JOB_HOST,location.jobHost,path.join(location.appRoot,'scripts','piraiders-app.cjs')])await fs.access(file);
 const label='PiRaiders-App-CI-'+crypto.randomUUID().replaceAll('-',''),port=await freePort(),talk=await freePort(),origin='http://127.0.0.1:'+port;
 const dirs=Object.fromEntries(['data','log','catalog','media','cache','runtime'].map(name=>[name,path.join(fixture,name)]));
 for(const dir of Object.values(dirs))await fs.mkdir(dir);
 const sourceDir=path.join(dirs.media,'football');await fs.mkdir(sourceDir);
 await fs.mkdir(path.join(dirs.data,'Bench','data'),{recursive:true});await fs.writeFile(path.join(dirs.data,'Bench','profile.json'),JSON.stringify({general:{name:'Synthetic full application'},templates:[]}));await fs.writeFile(path.join(dirs.data,'Bench','data','Run.json'),JSON.stringify({templates:[],rundown:[]}));
 const config={general:{port,hostname:'synthetic-full-app-ci',launchBrowser:false,loglevel:'error',dataroot:dirs.data,logfolder:dirs.log,templatesource:'spx-ip-address',langfile:'english.json',username:'',password:'',apikey:'',resolution:'HD',recents:[]},casparcg:{servers:[]},osc:{enable:false},globalExtras:{}};
 const configFile=path.join(fixture,'config.json'),configBytes=JSON.stringify(config);await fs.writeFile(configFile,configBytes);
 const machineFile=location.extracted?path.join(location.appRoot,'config','piraiders-app.json'):path.join(fixture,'machine.json');await fs.writeFile(machineFile,JSON.stringify(proofMachine({schemaVersion:1,spxConfigFile:path.relative(location.appRoot,configFile).split(path.sep).join('/'),catalogDirectory:dirs.catalog,mediaRoot:dirs.media,cacheRoot:dirs.cache,runtimeRoot:dirs.runtime,output:{type:'ndi',name:label},presentation:{port:0},rossTalk:{host:'127.0.0.1',port:talk,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',2:'next',3:'previous',4:'toggle-auto',5:'reload',8:'stop'},acknowledgements:true}},runtime)),{flag:'wx'});
 const frames=[],runtimeDiagnostics=createRuntimeDiagnostics();let probe,app,browser,page,activeConfigEvent=null,phase='SETUP',sourceIdentity,report,cleanupTree,lastTreeCounts;
 let activeWindowEnd=null,bundledEvidence=null;
 // Q-021: what the app says it runs (Diagnostics `caspar`) and the OpenGL
 // check's answer on this runner (the ZIP's own check), fixed words only.
 async function bundledRuntimeEvidence(){
  const result=await page.evaluate(async()=>{const response=await fetch('/game-day/api/diagnostics',{signal:AbortSignal.timeout(10000)});return{status:response.status,value:await response.json()};});
  assert.equal(result.status,200,'APP_DIAGNOSTICS_HTTP');assert.equal(result.value.ok,true,'APP_DIAGNOSTICS_OK');
  const caspar=checkBundledCaspar(result.value.diagnostics.caspar),graphics=graphicsRecord(await runGraphicsCheck({appRoot:location.appRoot}));
  return{caspar,graphics,receiverDllFromZip:true,casparFromZip:true,separateNdiRuntimeVariable:false,ciPreparedCasparMesaNdi:false,gpuPathTested:false};
 }
 function captureDeadline(outer=Infinity){return processCaptureDeadline(activeWindowEnd,outer);}
 async function ownedSender(options={},outer=Infinity){return captureOwnedCaspar(app.parentIdentity,runtime.casparExecutable,{...options,deadline:captureDeadline(outer),jobHost:location.jobHost,resolveImage});}
 async function state(){const result=await page.evaluate(async()=>{const response=await fetch('/game-day/api/state',{signal:AbortSignal.timeout(5000)});return{status:response.status,value:await response.json()};});assert.equal(result.status,200,'APP_STATE_HTTP');assert.equal(result.value.ok,true,'APP_STATE_OK');runtimeDiagnostics.record(result.value.state);return result.value.state;}
 async function commandAPI(action,ok=true){const result=await page.evaluate(async action=>{const current=await (await fetch('/game-day/api/state',{signal:AbortSignal.timeout(5000)})).json();const response=await fetch('/game-day/api/command',{method:'POST',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json','X-PiRaiders-Csrf':document.querySelector('meta[name="piraiders-csrf"]').content},body:JSON.stringify({action,expectedEventId:current.state.expectedEventId,expectedSelection:current.state.expectedSelection})});return{status:response.status,value:await response.json()};},action);assert.equal(result.value.ok,ok,'APP_COMMAND_RESULT');return result;}
 async function frame(name,rgb,options={}){const result=await probe.request('frame',{name,rgb,minFrames:3,minDurationMs:0,timeoutMs:20000,...options},25000);assert.equal(result.sourceIdentityHash,sourceIdentity,'SOURCE_IDENTITY_CHANGED');assert.ok(result.distinctTimestamps>=3&&result.connections>0,'FRESH_NDI_FRAMES_REQUIRED');assert.equal(result.width,1920,'NDI_FRAME_WIDTH');assert.equal(result.height,1080,'NDI_FRAME_HEIGHT');assert.equal(result.frameRateN,30*result.frameRateD,'NDI_FRAME_RATE');assert.ok(['BGRA','BGRX'].includes(result.format),'NDI_FRAME_FORMAT');const bytes=await fs.readFile(path.join(evidence,name+'.png'));if(rgb.every(x=>x===0))checkConsolePixels(bytes,rgb);frames.push({name,distinctTimestamps:result.distinctTimestamps,matchedFrames:result.matchedFrames,format:result.format});}
 async function scan(){
  const generated=(await filesUnder(dirs.runtime)).filter(file=>path.basename(file)==='caspar.config');assert.ok(generated.length>=1&&generated.length<=128,'BOUNDED_PRIVATE_CASPAR_CONFIGS');
  const activeDirectory=path.join(dirs.runtime,activeConfigEvent);assert.equal(generated.filter(file=>{const relative=path.relative(activeDirectory,file);return relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);}).length,1,'ONE_ACTIVE_PRIVATE_CASPAR_CONFIG');
  for(const file of generated){const stat=await fs.stat(file);assert.ok(stat.size<=65536,'PRIVATE_CONFIG_LIMIT');const xml=await fs.readFile(file,'utf8');assert.ok(xml.includes('<controllers/>')&&xml.includes('<log-path disabled="true">')&&xml.includes('<cache-path/>'),'PRIVATE_CASPAR_CONFIGURATION');}
  for(const file of [...await filesUnder(runtime.casparDirectory),...await filesUnder(dirs.runtime),...await filesUnder(dirs.log)])if(/\.(?:log|txt|json|config)$/i.test(file)){const stat=await fs.stat(file);assert.ok(stat.size<=16*1024*1024,'LOG_SCAN_LIMIT');assert.equal(privateText(await fs.readFile(file)),false,'PRIVATE_URL_PERSISTED');}
 }
 async function event(id,window){await fs.writeFile(path.join(dirs.catalog,id+'.json'),JSON.stringify({schemaVersion:1,provider:'local-manual',eventId:id,displayName:'Synthetic '+id,productionWindow:window,relativeSourcePath:'football',startup:{mode:'source'},playback:{mode:'manual',intervalMs:1000,transition:{type:'cut',durationMs:0}}}));await page.locator('#refresh-events').click();await until(async()=>await page.locator('#event-select option[value="'+id+'"]').count()===1,'EVENT_NOT_LISTED');await page.locator('#event-select').selectOption(id);await page.locator('#prepare').click();await until(async()=>!!(await state()).candidate,'PREPARATION_FAILED',30000);await page.locator('#activate').click();await until(async()=>{const value=await state();return value.active?.eventId===id&&value.candidate===null;},'ACTIVATION_FAILED',30000);activeConfigEvent=id;}
 async function gone(tree,code,absoluteDeadline=Infinity){await until(()=>{lastTreeCounts=observeTree(processTable(),tree);return lastTreeCounts.surviving===0&&lastTreeCounts.unknown===0;},code,Math.min(10000,Math.max(1,absoluteDeadline-Date.now())));assert.ok(Date.now()<=absoluteDeadline,'TREE_OBSERVATION_LATE');}
 async function absentBefore(start){let observations=0;while(Date.parse(start)-Date.now()>400){const durationMs=Math.min(1000,Date.parse(start)-Date.now()-300);if(durationMs<100)break;await probe.request('absent',{durationMs});observations++;}return{observations,finalBoundaryGapMs:Math.max(0,Date.parse(start)-Date.now()),sampleResolutionMs:50};}
 try{
  probe=await receiver(root,runtime.receiverDll,label,evidence);app=await application(machineFile,origin+'/game-day',location);cleanupTree=descendants(processTable(),app.parentPid);
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(origin+'/game-day');await page.locator('#connection').filter({hasText:'Connected to application'}).waitFor();
  if(runtime.bundled){phase='BUNDLED_RUNTIME';bundledEvidence=await bundledRuntimeEvidence();}
  assert.equal((await page.request.get(origin+'/shows')).status(),200,'SPX_SHOWS_AVAILABLE');
  await fs.writeFile(path.join(sourceDir,'01.png'),PNG.sync.write(image([240,20,20])));await fs.writeFile(path.join(sourceDir,'02.jpg'),jpeg.encode(image([20,20,240]),95).data);
  const now=Date.now(),window={start:new Date(now+30000).toISOString(),end:new Date(now+210000).toISOString(),prewarmMinutes:0};activeWindowEnd=window.end;
  phase='PREWINDOW';await event('football',window);assert.ok(Date.now()<Date.parse(window.start)-2000,'SETUP_BEFORE_WINDOW');assert.equal(descendants(processTable(),app.parentPid).some(isCaspar),false,'NO_CASPAR_BEFORE_WINDOW');const prewindowAbsence=await absentBefore(window.start);
  phase='INITIAL_READY';await until(async()=>!!(await state()).active?.runtime.ready,'APP_RENDERER_READY',60000);assert.ok(Date.now()>=Date.parse(window.start),'READY_NOT_BEFORE_WINDOW');phase='INITIAL_PROCESS_IDENTITY';assert.ok(startedNoEarlierThan((await ownedSender()).root,window.start),'CASPAR_BIRTH_NOT_BEFORE_WINDOW');phase='INITIAL_NDI_DISCOVERY';const discovered=await probe.request('discover',{timeoutMs:30000},35000);sourceIdentity=discovered.sourceIdentityHash;assert.match(sourceIdentity,/^[a-f0-9]{64}$/,'NDI_SOURCE_IDENTITY');phase='INITIAL_NDI_BLACK';await frame('app-initial-black',[0,0,0]);await scan();
  await page.screenshot({path:path.join(evidence,'game-day-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(evidence,'game-day-narrow.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
  phase='PLAYBACK';await page.locator('#launch').click();await frame('app-launch-red',[240,20,20]);await command(talk,'GPI 2',{prefix:'OK ',timeoutMs:30000});await frame('app-next-jpeg-blue',[20,20,240]);await page.locator('[data-action="next"]').click();await frame('app-next-wrap-red',[240,20,20]);await command(talk,'GPI 3',{prefix:'OK ',timeoutMs:30000});await frame('app-previous-wrap-blue',[20,20,240]);
  await fs.writeFile(path.join(sourceDir,'01.png'),PNG.sync.write(image([20,220,20])));await fs.rm(path.join(sourceDir,'02.jpg'));await commandAPI('reload');await frame('app-reload-green',[20,220,20]);await fs.writeFile(path.join(sourceDir,'01.png'),'deliberate-invalid-image');await commandAPI('reload',false);assert.equal((await state()).active.runtime.lastError,'RESOLVER_FAILED','CORRUPT_RELOAD_REFUSED');await frame('app-failed-reload-green',[20,220,20]);await commandAPI('auto');assert.equal((await state()).active.runtime.mode,'auto');await commandAPI('manual');assert.equal((await state()).active.runtime.mode,'manual');
  const beforeStop=(await ownedSender());await page.locator('#stop').click();await frame('app-stop-black',[0,0,0],{minFrames:10,minDurationMs:1500});assert.equal(treeState(processTable(),[beforeStop.root]).surviving,1,'STOP_RETAINS_SENDER_ROOT');
  phase='CASPAR_CAPTURE';lastTreeCounts=null;await fs.rm(sourceDir,{recursive:true});const old=(await ownedSender());phase='CASPAR_TERMINATE';execFileSync('taskkill.exe',['/PID',String(old.root.ProcessId),'/F'],{stdio:'ignore',timeout:15000,windowsHide:true});
  phase='CASPAR_GONE';await gone(old.tree,'OLD_SENDER_TREE_SURVIVED');phase='CASPAR_RECOVERY';const recoveryDeadline=performance.now()+60000;await until(async()=>{const value=await state();if(!value.active?.runtime.ready)return false;const next=(await ownedSender({allowAbsent:true},recoveryDeadline));return !!next&&(next.root.ProcessId!==old.root.ProcessId||next.root.CreationUtcTicks!==old.root.CreationUtcTicks);},'APP_OFFLINE_RESTART',60000);assert.equal((await state()).active.runtime.index,null,'RESTART_REQUIRES_LAUNCH');assert.equal((await probe.request('discover',{timeoutMs:30000},35000)).sourceIdentityHash,sourceIdentity,'RESTART_SOURCE_IDENTITY');await frame('app-restart-black',[0,0,0]);await commandAPI('launch');await frame('app-offline-restart-green',[20,220,20]);await scan();
  phase='WINDOW_END';const ending=(await ownedSender()),endMs=Date.parse(window.end),maxPolicyAt=endMs+20000,maxGoneAt=endMs+30000;assert.ok(Date.now()<=maxPolicyAt,'WINDOW_POLICY_OBSERVATION_LATE');await until(async()=>Date.now()>=endMs&&!(await state()).active.runtime.ready&&(await state()).active.runtime.index===null,'APP_REAL_WINDOW_END',Math.max(1,maxPolicyAt-Date.now()));const policyFencedAt=new Date().toISOString();assert.ok(Date.now()<=maxPolicyAt,'WINDOW_POLICY_FENCE_LATE');await gone(ending.tree,'WINDOW_SENDER_TREE_SURVIVED',maxGoneAt);const windowStoppedAt=new Date().toISOString();const quiet=await probe.request('quiet',{durationMs:1500,timeoutMs:20000},25000);assert.equal(quiet.connections,0);assert.ok(quiet.quietDurationMs>=1500);assert.equal((await page.request.get(origin+'/shows')).status(),200,'SPX_PERSISTS_AFTER_WINDOW');
  phase='PARENT_LOSS_EVENT';await fs.mkdir(sourceDir);await fs.writeFile(path.join(sourceDir,'01.png'),PNG.sync.write(image([240,20,20])));const secondNow=Date.now(),secondWindow={start:new Date(secondNow+20000).toISOString(),end:new Date(secondNow+120000).toISOString(),prewarmMinutes:0};activeWindowEnd=secondWindow.end;await event('parent-loss',secondWindow);assert.ok(Date.now()<Date.parse(secondWindow.start)-2000,'PARENT_EVENT_SETUP_BEFORE_WINDOW');assert.equal((await ownedSender({allowAbsent:true})),null,'NO_SECOND_SENDER_BEFORE_WINDOW');const secondPrewindowObservation={noCasparRoot:true,receiverQuietAfterPriorWindow:true,discoveryCacheAbsenceNotRequired:true};await until(async()=>!!(await state()).active.runtime.ready,'PARENT_LOSS_EVENT_READY',60000);assert.ok(Date.now()>=Date.parse(secondWindow.start),'SECOND_READY_NOT_BEFORE_WINDOW');assert.ok(startedNoEarlierThan((await ownedSender()).root,secondWindow.start),'SECOND_CASPAR_BIRTH_NOT_BEFORE_WINDOW');assert.equal((await probe.request('discover',{timeoutMs:30000},35000)).sourceIdentityHash,sourceIdentity,'SECOND_EVENT_SOURCE_IDENTITY');await commandAPI('launch');await frame('app-before-parent-loss-red',[240,20,20]);
  phase='PARENT_LOSS';const parentLossTriggeredAt=new Date().toISOString();assert.ok(Date.now()<Date.parse(secondWindow.end),'PARENT_LOSS_WITHIN_WINDOW');phase='PARENT_CAPTURE';lastTreeCounts=null;cleanupTree=(await capturePinnedTree(app.parentIdentity,{deadline:captureDeadline()})).tree;assert.ok(cleanupTree.some(isCaspar),'PARENT_LOSS_ACTIVE_CASPAR');phase='PARENT_VERIFY';assert.equal(treeState(processTable(),[app.parentIdentity]).surviving,1,'ACTUAL_CLI_GENERATION_BEFORE_CRASH');phase='PARENT_TERMINATE';assert.ok(Date.now()<Date.parse(secondWindow.end),'PARENT_TERMINATE_WITHIN_WINDOW');if(location.extracted)execFileSync('taskkill.exe',['/PID',String(app.parentPid),'/F'],{stdio:'ignore',timeout:15000,windowsHide:true});else{app.child.kill();await settledChild(app.child);}phase='PARENT_GONE';await gone(cleanupTree,'NESTED_APP_TREE_SURVIVED');if(location.extracted)assertOuterBench(processTable(),app.child,app.outerRoots);phase='PARENT_QUIET';const parentQuiet=await probe.request('quiet',{durationMs:1500,timeoutMs:20000},25000);assert.equal(parentQuiet.connections,0);assert.ok(parentQuiet.quietDurationMs>=1500);await assert.rejects(fetch(origin+'/api/v1/version',{signal:AbortSignal.timeout(2000)}));if(location.extracted)assertOuterBench(processTable(),app.child,app.outerRoots);await scan();assert.equal(await fs.readFile(configFile,'utf8'),configBytes,'SPX_CONFIG_UNCHANGED');
  report={event:'actual-full-app-windows-proof-passed',sourceCommit:process.env.PIRAIDERS_PROOF_SOURCE_SHA||null,receiverStartMs:probe.startMs,casparProvenance:runtime.casparProvenance,ndiProvenance:runtime.ndiProvenance,bundledRuntime:runtime.bundled?bundledEvidence:null,runtimeVersion:probe.info.runtimeVersion,actualCLI:true,actualSPX:true,actualGameDayUI:true,actualHTTPCommands:true,actualAllowlistedRossTalk:true,defaultNativeSpawnBoundaries:true,nestedWindowsJobs:true,explicitCIMesaEnvironment:false,applicationRendererProfile:'mesa-llvmpipe-compat',inheritedMesaVariablesRemoved:true,actualGLRendererUnrecorded:true,actualRootCMD:location.extracted,systemNodeOnApplicationPath:false,rendererEnvironment:{GALLIUM_DRIVER:'llvmpipe',LIBGL_ALWAYS_SOFTWARE:'1',MESA_GL_VERSION_OVERRIDE:'4.5COMPAT'},actualCasparCEF:true,actualNdiConsumer:true,actualNdiSdkReceiver:true,sourceIdentityHash:sourceIdentity,sourceIdentityStable:true,frames,fullFrameOpaqueBlack:true,realClockWindow:window,prewindowAbsence,policyFencedAt,windowPolicyFenceLatenessMs:Math.max(0,Date.parse(policyFencedAt)-endMs),windowTreeGoneLatenessMs:Math.max(0,Date.parse(windowStoppedAt)-endMs),windowStoppedAt,windowEndSenderGone:true,windowEndReceiverQuiet:{connections:quiet.connections,durationMs:quiet.quietDurationMs},persistentSPXAfterWindow:true,offlineCasparCrashRecovery:true,restartStoppedBlackBeforeLaunch:true,failedReloadRetainsPixels:true,parentDeathWhileSending:true,parentLossEventWindow:secondWindow,secondPrewindowObservation,parentLossTriggeredAt,nestedTreeGone:true,parentLossReceiverQuiet:{connections:parentQuiet.connections,durationMs:parentQuiet.quietDurationMs},spxConfigUnchanged:true,gracefulAppCloseTested:false,extractedPackageTested:location.extracted,archiveEvidence:location.archiveEvidence||null,independentParentDeathWhileBenchAlive:location.extracted,defaultWindowsBrowserDispatchTested:false,privateURLPatternLogScan:true,sameMachineOnly:true,windows10Tested:false,lanTransportTested:false,stadiumHardwareTested:false};
 }catch(error){if(page)try{await page.screenshot({path:path.join(evidence,'failure-ui.png'),fullPage:true,timeout:5000});}catch{}console.error(JSON.stringify({event:'full-app-proof-fixed-failure',phase,receiver:receiverEvidence(error,probe).receiver,processIdentityReason:identityReason(error),processCaptureDiagnostics:identityCaptureDiagnostics(error),code:fixedFailure(error),framesVerified:frames.map(x=>x.name),treeCounts:lastTreeCounts||null,runtimeState:runtimeDiagnostics.snapshot(),appCategories:app?[...app.categories]:[]}));throw Error('FULL_APP_PROOF_FAILED');
 }finally{
  const cleanup=[];try{await browser?.close();}catch{cleanup.push('BROWSER');}
  try{await killApplication(app?.child);}catch{cleanup.push('APPLICATION');}
  try{await cleanupCaptured(cleanupTree,location.jobHost,location.extracted?canonicalImage:normalized);}catch{cleanup.push('RECORDED_TREE');}
  try{await probe?.close();}catch{cleanup.push('RECEIVER');}
  if(cleanup.length)throw Error('FULL_APP_PROOF_CLEANUP');
 }
 if(location.extracted){verifyOriginalInventory(location.inventory);report.originalInventoryUnchanged=true;}
 report.captures=[];for(const name of(await fs.readdir(evidence)).sort())if(/^[a-z0-9-]+\.png$/.test(name)){const bytes=await fs.readFile(path.join(evidence,name));report.captures.push({name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}for(const frame of frames)assert.ok(report.captures.some(capture=>capture.name===frame.name+'.png'),'FRAME_CAPTURE_REQUIRED');await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
async function main(){
 if(process.platform!=='win32')throw Error('WINDOWS_REQUIRED');
 const location=process.argv[3]?prepareExtracted(process.argv[3],process.env.PIRAIDERS_PROOF_SOURCE_SHA):sourceLocation(checkoutRoot);
 try{await scenario(location);}finally{if(location.extracted){try{verifyOriginalInventory(location.inventory);}finally{await fs.rm(location.work,{recursive:true,force:true,maxRetries:10,retryDelay:100});}}}
}
if(require.main===module)main().catch(()=>{console.error('FULL_APP_PROOF_FAILED');process.exitCode=1;});
module.exports={ownedCaspar,processCaptureDeadline,capturePinnedTree,captureOwnedCaspar,privateText,startedNoEarlierThan,fixedFailure,
 // Reused unchanged by the exchange activation proof (scripts/smoke-exchange-activation-windows.cjs).
 normalized,until,freePort,filesUnder,settledChild,killApplication,cleanupCaptured,receiver,application,appEntry,consoleApplication};
