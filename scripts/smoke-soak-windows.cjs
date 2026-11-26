#!/usr/bin/env node
'use strict';
// 5e-2: the soak job on disposable hosted Windows. The real application entry
// (scripts/piraiders-app.cjs --no-browser, in a console of its own) on the
// synthetic exchange source machine of the activation job
// (scripts/exchange-activation-fixture.cjs, stores set up by the setup
// command); through the real routes it refreshes, reviews, approves, prepares
// and activates the one synthetic button, with real Caspar/CEF and NDI
// software output. The button is switched to Manual once over the command
// route before the first cycle (exchange buttons start in Auto, whose own
// advance would race the plan's fixed offsets). Then the 5e-1 plan
// (scripts/soak-proof.cjs): every one-minute cycle Launch, Next, Next,
// Previous and Reload over allowlisted RossTalk and Stop over RossTalk (even
// cycles) or the command route (odd cycles), at fixed offsets. The pinned NDI
// SDK receiver must see each step's picture, and full-frame black after every
// Stop; after each Stop the owned processes' summed working set and handle
// count are sampled (scripts/soak-windows-job.cjs). At the end the 5e-1 rules
// judge the run and a Ctrl+C close must take every owned process with it.
//
// PIRAIDERS_SOAK_MINUTES sets the length: under four hours it is a check run
// of this job (run "check-run"), never the soak. Evidence: the last cycle's
// received frames (PNG, overwritten every cycle) and result.json (numbers and
// fixed words only), checked by scripts/proof-evidence-privacy.cjs.
// Same-machine hosted-CI evidence only: no hardware, stadium PC, board or
// deployment claim. Synthetic data only. See docs/design/SOAK_PROOF.md.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {setTimeout:sleep}=require('node:timers/promises');
const {chromium}=require('playwright');
const {JOB_HOST}=require('./lib/windows-job-process.cjs');
const {output:PROBE}=require('./build-ndi-probe.cjs');
const {command:rossTalk}=require('./smoke-caspar-windows.cjs');
const {checkConsolePixels}=require('./smoke-caspar-console-windows.cjs');
const {processTable,observeTree,identityReason}=require('./windows-process-evidence.cjs');
const {sourceLocation}=require('./extracted-app-proof.cjs');
const full=require('./smoke-full-app-windows.cjs');
const {buildExchangeActivationFixture}=require('./exchange-activation-fixture.cjs');
const setup=require('./exchange-activation-setup.cjs');
const routes=require('./exchange-activation-routes.cjs');
const {auditEvidence,removeViolations}=require('./proof-evidence-privacy.cjs');
const consoleClose=require('./console-close-proof.cjs');
const soak=require('./soak-proof.cjs');
const job=require('./soak-windows-job.cjs');
const checkoutRoot=path.resolve(__dirname,'..');
// The allowlisted RossTalk map; Stop on odd cycles goes over the command route instead.
const GPI=Object.freeze({launch:1,next:2,previous:3,reload:5,stop:8});
// Every non-Stop picture must be seen within this; a Stop's black is judged by the 5e-1 bound.
const PICTURE_TIMEOUT_MS=20000,STOP_LOOK_MS=8000;

async function scenario(location,plan){
  const tools=path.resolve(process.argv[2]||path.join(checkoutRoot,'build','caspar-proof-tools'));
  const evidence=path.join(checkoutRoot,'build','soak-proof-evidence'),work=path.join(checkoutRoot,'build','soak-proof');
  for(const dir of [evidence,work]){await fs.rm(dir,{recursive:true,force:true});await fs.mkdir(dir,{recursive:true});}
  const toolInfo=JSON.parse(await fs.readFile(path.join(tools,'tools.json'),'utf8')),ndi=JSON.parse(await fs.readFile(path.join(tools,'ndi-runtime.json'),'utf8'));
  for(const file of [PROBE,JOB_HOST,consoleClose.CONSOLE_PROOF,location.jobHost,path.join(location.appRoot,'scripts','piraiders-app.cjs')])await fs.access(file);
  const label='PiRaiders-Soak-CI-'+crypto.randomUUID().replaceAll('-',''),port=await full.freePort(),talk=await full.freePort(),origin='http://127.0.0.1:'+port;
  const spx=path.join(work,'spx'),data=path.join(spx,'data'),log=path.join(spx,'log');
  await fs.mkdir(path.join(data,'Bench','data'),{recursive:true});await fs.mkdir(log);
  await fs.writeFile(path.join(data,'Bench','profile.json'),JSON.stringify({general:{name:'Synthetic soak'},templates:[]}));
  await fs.writeFile(path.join(data,'Bench','data','Run.json'),JSON.stringify({templates:[],rundown:[]}));
  const configFile=path.join(spx,'config.json');
  await fs.writeFile(configFile,JSON.stringify({general:{port,hostname:'synthetic-soak-ci',launchBrowser:false,loglevel:'error',dataroot:data,logfolder:log,
    templatesource:'spx-ip-address',langfile:'english.json',username:'',password:'',apikey:'',resolution:'HD',recents:[]},casparcg:{servers:[]},osc:{enable:false},globalExtras:{}}));
  const casparExe=path.join(toolInfo.casparDirectory,'casparcg.exe');
  const built=await buildExchangeActivationFixture({root:path.join(work,'proof'),setUpStores:false,machine:{
    spxConfigFile:path.relative(location.appRoot,configFile).split(path.sep).join('/'),
    caspar:{executable:casparExe,cwd:toolInfo.casparDirectory,rendererProfile:'mesa-llvmpipe-compat'},
    output:{type:'ndi',name:label,runtimeDirectory:ndi.runtimeDirectory},presentation:{port:0},
    rossTalk:{host:'127.0.0.1',port:talk,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',2:'next',3:'previous',5:'reload',8:'stop'},acknowledgements:true}}});
  const privatePaths=[work,built.sourceRoot,...built.privateRoots,tools,toolInfo.casparDirectory];
  const timings={},answers=[],samples=[],stops=[],stopMisses=[];
  let probe,app,browser,page,phase='SETUP',sourceIdentity,cleanupTree,lastTreeCounts,cyclesCompleted=0,cycle=null,step=null,maxStepLateMs=0,framesSeen=0,minDistinctTimestamps=null,record,close;
  const started=performance.now(),mark=name=>{timings[name]=Math.round(performance.now()-started);};
  const client={
    get:async url=>{const r=await page.evaluate(async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(30000)});return{status:response.status,text:await response.text()};},url);answers.push(r.text);let value;try{value=JSON.parse(r.text);}catch{}return{status:r.status,value};},
    post:async(url,body)=>{const r=await page.evaluate(async([url,body])=>{const response=await fetch(url,{method:'POST',signal:AbortSignal.timeout(60000),headers:{'Content-Type':'application/json',
      'X-PiRaiders-Csrf':document.querySelector('meta[name="piraiders-csrf"]').content},body:JSON.stringify(body)});return{status:response.status,text:await response.text()};},[url,body]);
      answers.push(r.text);let value;try{value=JSON.parse(r.text);}catch{}return{status:r.status,value};}};
  async function state(){const r=await client.get('/game-day/api/state');assert.equal(r.status,200,'APP_STATE_HTTP');assert.equal(r.value.ok,true,'APP_STATE_OK');return r.value.state;}
  // One received picture, fresh frames from the same source. Names repeat every cycle, so the last cycle's frames are kept.
  async function frame(name,rgb,options={}){
    const result=await probe.request('frame',{name,rgb,minFrames:3,minDurationMs:0,timeoutMs:PICTURE_TIMEOUT_MS,...options},PICTURE_TIMEOUT_MS+5000);
    assert.equal(result.sourceIdentityHash,sourceIdentity,'SOURCE_IDENTITY_CHANGED');assert.ok(result.distinctTimestamps>=3&&result.connections>0,'FRESH_NDI_FRAMES_REQUIRED');
    assert.equal(result.width,1920,'NDI_FRAME_WIDTH');assert.equal(result.height,1080,'NDI_FRAME_HEIGHT');assert.ok(['BGRA','BGRX'].includes(result.format),'NDI_FRAME_FORMAT');
    if(rgb.every(x=>x===0))checkConsolePixels(await fs.readFile(path.join(evidence,name+'.png')),rgb);
    framesSeen+=1;minDistinctTimestamps=Math.min(minDistinctTimestamps??Infinity,result.distinctTimestamps);
  }
  async function issue(action,transport){
    if(transport==='route')await routes.command(client,action);
    else await rossTalk(talk,'GPI '+GPI[action],{prefix:'OK ',timeoutMs:30000});
  }
  try{
    phase='SETUP_COMMAND';setup.checkSetupTwice(await setup.runSetupCommand(built.machineFile,{appRoot:location.appRoot,nodeExecutable:location.nodeExecutable,pin:false}),
      await setup.runSetupCommand(built.machineFile,{appRoot:location.appRoot,nodeExecutable:location.nodeExecutable,pin:false}));mark('setUp');
    phase='RECEIVER';probe=await full.receiver(tools,ndi.dllPath,label,evidence);
    phase='APPLICATION';app=await full.application(built.machineFile,origin+'/game-day',location,{consoleHost:consoleClose.CONSOLE_PROOF});mark('applicationReady');
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    page=await browser.newPage({viewport:{width:1440,height:1000}});
    await page.goto(origin+'/game-day');await page.locator('#connection').filter({hasText:'Connected to application'}).waitFor();
    assert.equal(await page.locator('body').getAttribute('data-mode'),'source','SOURCE_MODE_PAGE');
    phase='PAGE_REFRESH';await routes.pageRefreshSettled(client);
    // The window covers the whole run and its close.
    phase='APPROVE';const window=routes.approvalWindow(Date.now(),{afterMs:plan.durationMs+30*60000});
    const flow=await routes.approveAndActivate(client,{identityTuple:built.identityTuple,window});mark('activated');
    phase='RENDERER_READY';await full.until(async()=>{const value=await state();return value.active&&value.active.eventId===flow.eventId&&value.active.runtime.ready;},'APP_RENDERER_READY',90000);
    phase='SENDER_IDENTITY';cleanupTree=(await full.captureOwnedCaspar(app.parentIdentity,casparExe,{deadline:performance.now()+15000,jobHost:location.jobHost})).tree;
    phase='NDI_DISCOVERY';sourceIdentity=(await probe.request('discover',{timeoutMs:30000},35000)).sourceIdentityHash;assert.match(sourceIdentity,/^[a-f0-9]{64}$/,'NDI_SOURCE_IDENTITY');
    phase='MANUAL';await routes.command(client,'manual');
    phase='BLACK_BEFORE_LAUNCH';await frame('soak-before-launch-black',[0,0,0]);mark('cyclesStart');
    // The plan's clock starts now; each step waits for its fixed offset and is never started early.
    const origin0=performance.now()+1000;
    for(const s of plan.steps){
      cycle=s.cycle;step=s.step;phase='CYCLE';
      maxStepLateMs=Math.max(maxStepLateMs,await job.waitFor(origin0+s.atMs,{now:()=>performance.now(),sleep:ms=>sleep(ms)}));
      if(s.action!=='stop'){
        await issue(s.action,s.transport);const picture=built.order[s.expect];
        await frame('soak-'+s.step,picture.rgb);continue;
      }
      const issuedAt=performance.now();await issue('stop',s.transport);
      let blackAt=null;
      // A black not seen (or not full-frame, or from another source) is a lost Stop for the rules; its fixed cause is kept.
      try{await frame('soak-stop-black',[0,0,0],{timeoutMs:STOP_LOOK_MS});blackAt=performance.now();}
      catch(error){stopMisses.push({cycle:s.cycle,code:error&&typeof error.code==='string'&&/^[A-Z_]{1,64}$/.test(error.code)?error.code:full.fixedFailure(error)});}
      stops.push({cycle:s.cycle,transport:s.transport,issuedAt,blackAt});
      // After the Stop, the cycle's one usage sample; then the cycle is complete.
      samples.push(job.sampleCycle(s.cycle,app.parentIdentity));
      cyclesCompleted=s.cycle+1;
    }
    cycle=null;step=null;mark('cyclesDone');
    phase='PRIVACY';assert.equal(routes.namesPrivatePath(answers,privatePaths),false,'ROUTE_ANSWER_NAMES_PRIVATE_PATH');
    phase='RULES';record=soak.soakRecord({plan,cyclesCompleted,samples,stops});
    // Ctrl+C at the application's console: every owned process gone, the SPX port free, the receiver quiet.
    phase='CLOSE_CAPTURE';cleanupTree=(await full.capturePinnedTree(app.parentIdentity,{deadline:performance.now()+15000})).tree;
    phase='CLOSE_SIGNAL';const signalled=performance.now();await consoleClose.sendClose('graceful',app.parentPid);
    phase='CLOSE';const exit=await full.settledChild(app.child);const exited=performance.now();
    phase='CLOSE_GONE';await full.until(()=>{lastTreeCounts=observeTree(processTable(),cleanupTree);return lastTreeCounts.surviving===0&&lastTreeCounts.unknown===0;},'APP_TREE_SURVIVED_CLOSE',consoleClose.CLOSE_GONE_BOUND_MS);
    const goneAt=performance.now();
    phase='CLOSE_PORT';await consoleClose.portFree(port);
    phase='CLOSE_RECORD';close=consoleClose.closeRecord({method:'graceful',exitCode:exit.code,signal:exit.signal,signalToExitMs:Math.round(exited-signalled),signalToGoneMs:Math.round(goneAt-signalled)});
    phase='CLOSE_QUIET';const quiet=await probe.request('quiet',{durationMs:1500,timeoutMs:20000},25000);assert.equal(quiet.connections,0,'RECEIVER_NOT_QUIET');mark('closed');
  }catch(error){
    // The rules' own record when they broke it (numbers and fixed words only), else what the run got to.
    const soakPart=error&&error.soak?error.soak:{run:plan.run,soak:plan.run==='soak',cycles:plan.cycles,cyclesCompleted,stopsIssued:stops.length,stopsSeenBlack:stops.filter(s=>s.blackAt!==null).length,samplesTaken:samples.length,samplesUnreadable:samples.filter(s=>s.unreadable).length};
    let evidenceViolations=null;try{const audit=await auditEvidence(evidence,privatePaths);evidenceViolations=audit.violations;if(audit.violations.length)await removeViolations(evidence,audit.violations);}catch{}
    console.error(JSON.stringify({event:'soak-proof-fixed-failure',phase,cycle,step,
      routeStatus:error&&Number.isInteger(error.routeStatus)?error.routeStatus:null,answerCode:error&&typeof error.answerCode==='string'?error.answerCode:null,
      code:error&&typeof error.code==='string'&&/^[A-Z_]{1,64}$/.test(error.code)?error.code:full.fixedFailure(error),processIdentityReason:identityReason(error),
      soak:soakPart,stopMisses:stopMisses.slice(0,20),maxStepLateMs,framesSeen,treeCounts:lastTreeCounts||null,appCategories:app?[...app.categories]:[],evidenceViolations,timingsMs:timings}));
    throw Error('SOAK_PROOF_FAILED');
  }finally{
    const cleanup=[];try{await browser?.close();}catch{cleanup.push('BROWSER');}
    try{await full.killApplication(app?.child);}catch{cleanup.push('APPLICATION');}
    try{await full.cleanupCaptured(cleanupTree,location.jobHost);}catch{cleanup.push('RECORDED_TREE');}
    try{await probe?.close();}catch{cleanup.push('RECEIVER');}
    if(cleanup.length){console.error(JSON.stringify({event:'soak-proof-cleanup-failed',parts:cleanup}));throw Error('SOAK_PROOF_CLEANUP');}
  }
  const report={event:plan.run==='soak'?'soak-windows-proof-passed':'soak-check-run-windows-passed',sourceCommit:process.env.PIRAIDERS_PROOF_SOURCE_SHA||null,
    casparProvenance:toolInfo.provenance,ndiProvenance:ndi.provenance,runtimeVersion:probe.info.runtimeVersion,actualCLI:true,sourceMachine:true,syntheticExchangeFolder:true,
    manualBeforeFirstCycle:true,publishedOrder:built.order.map(p=>p.name),sourceIdentityHash:sourceIdentity,sourceIdentityStable:true,
    soak:record,maxStepLateMs,framesSeen,minDistinctTimestamps,samples:samples.map(s=>s.unreadable?{cycle:s.cycle,unreadable:true}:{cycle:s.cycle,workingSetBytes:s.workingSetBytes,handles:s.handles,processes:s.processes}),
    close,closeTookEveryOwnedProcess:true,routeAnswersPathFree:true,timingsMs:timings,
    evidence:'hosted-ci',targetPcEvidence:false,sameMachineOnly:true,windows10Tested:false,lanTransportTested:false,stadiumHardwareTested:false};
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify(report,null,2));
  const audit=await auditEvidence(evidence,privatePaths);
  if(audit.violations.length){await removeViolations(evidence,audit.violations);
    console.error(JSON.stringify({event:'soak-proof-fixed-failure',phase:'EVIDENCE_PRIVACY',code:'EVIDENCE_NAMES_PRIVATE_PATH',evidenceViolations:audit.violations}));throw Error('EVIDENCE_NAMES_PRIVATE_PATH');}
  console.log(JSON.stringify({...report,samples:undefined}));
}
async function main(){
  if(process.platform!=='win32')throw Error('WINDOWS_REQUIRED');
  const plan=job.soakDuration(process.env.PIRAIDERS_SOAK_MINUTES||'');
  console.log(JSON.stringify({event:'soak-proof-plan',run:plan.run,cycles:plan.cycles,durationMs:plan.durationMs}));
  await scenario(sourceLocation(checkoutRoot),plan);
}
if(require.main===module)main().catch(()=>{console.error('SOAK_PROOF_FAILED');process.exitCode=1;});
module.exports={GPI,PICTURE_TIMEOUT_MS,STOP_LOOK_MS};
