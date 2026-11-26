#!/usr/bin/env node
'use strict';
// BE-006 item 5a part 2: the exchange activation proof on disposable hosted
// Windows. The real application entry (scripts/piraiders-app.cjs --no-browser)
// on a source machine built by scripts/exchange-activation-fixture.cjs (a
// synthetic exchange folder, the journal with its confirmed binding and the
// approval list set up as a setup step); through the real routes it refreshes,
// reviews and approves the one synthetic button, prepares and activates it;
// Launch on the real Game Day page, Next over allowlisted RossTalk, Next and
// Previous over the real command route, Stop on the page. The pinned NDI SDK
// receiver must see the three synthetic pictures in the published order,
// then full-frame black; closing the application must take every owned
// process with it.
//
// Evidence (5a-3): only the received synthetic frames (PNG) and sanitized JSON
// are kept; scripts/proof-evidence-privacy.cjs fails the proof if any retained
// file names the proof folder, the exchange folder or a private store, here
// and again in the job's step before the upload. No page screenshot is kept:
// its pixels cannot be checked for paths. See
// docs/design/EXCHANGE_ACTIVATION_WINDOWS_PROOF.md.
//
// Setup and cached start (5b-4): the private stores are set up by the
// operator's setup command (scripts/piraiders-setup.cjs), run twice (the
// second run changes nothing). After the online run and close, the command
// pins the button offline, the exchange folder is moved away, and the
// application started again plays the same button from the cache through the
// approved list alone: the same pictures in order, then Stop black, then a
// clean close.
//
// Close (5d-2): the application runs in a console of its own, as
// Launch-PiRaiders.cmd does. The online run is closed gracefully, by Ctrl+C in
// that console; the cached run by closing the console window. Each time every
// owned process must be gone, within the close bounds, and the SPX port free;
// the times are kept in result.json (`closes`).
//
// Default browser (5d-3): a third start, as the operator starts it (without
// --no-browser). The application must report that it opened Game Day; the job
// must see a new browser process whose command line holds that loopback URL
// (scripts/default-browser-proof.cjs). The job closes that browser itself,
// then closes the application by Ctrl+C: nothing it owns may be left.
// result.json keeps `defaultBrowser` (the browser's image name, never a
// command line).
//
// Same-machine CI evidence only: no hardware, stadium PC, board or
// deployment claim. Synthetic data only.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {chromium}=require('playwright');
const {JOB_HOST}=require('./lib/windows-job-process.cjs');
const {output:PROBE}=require('./build-ndi-probe.cjs');
const {command:rossTalk}=require('./smoke-caspar-windows.cjs');
const {checkConsolePixels}=require('./smoke-caspar-console-windows.cjs');
const {processTable,observeTree,identityReason,identityCaptureDiagnostics}=require('./windows-process-evidence.cjs');
const {sourceLocation}=require('./extracted-app-proof.cjs');
const full=require('./smoke-full-app-windows.cjs');
const {buildExchangeActivationFixture}=require('./exchange-activation-fixture.cjs');
const setup=require('./exchange-activation-setup.cjs');
const routes=require('./exchange-activation-routes.cjs');
const {auditEvidence,removeViolations}=require('./proof-evidence-privacy.cjs');
const consoleClose=require('./console-close-proof.cjs');
const defaultBrowser=require('./default-browser-proof.cjs');
const checkoutRoot=path.resolve(__dirname,'..');

// The order the receiver must see. Names are the evidence file names.
// `prefix` names the run: 'exchange' (online) or 'cached' (5b-4).
function expectedFrames(order,prefix='exchange'){
  assert.ok(Array.isArray(order)&&order.length===3,'ACTIVATION_ORDER');assert.ok(prefix==='exchange'||prefix==='cached','ACTIVATION_PREFIX');
  const [first,second,third]=order;
  return[
    {step:'launch',name:prefix+'-launch-'+first.name,rgb:first.rgb},
    {step:'next-rosstalk',name:prefix+'-next-'+second.name,rgb:second.rgb},
    {step:'next-route',name:prefix+'-next-'+third.name,rgb:third.rgb},
    {step:'previous-route',name:prefix+'-previous-'+second.name,rgb:second.rgb}];
}

async function scenario(location){
  const tools=path.resolve(process.argv[2]||path.join(checkoutRoot,'build','caspar-proof-tools'));
  const evidence=path.join(checkoutRoot,'build','exchange-activation-proof-evidence'),work=path.join(checkoutRoot,'build','exchange-activation-proof');
  for(const dir of [evidence,work]){await fs.rm(dir,{recursive:true,force:true});await fs.mkdir(dir,{recursive:true});}
  const toolInfo=JSON.parse(await fs.readFile(path.join(tools,'tools.json'),'utf8')),ndi=JSON.parse(await fs.readFile(path.join(tools,'ndi-runtime.json'),'utf8'));
  for(const file of [PROBE,JOB_HOST,consoleClose.CONSOLE_PROOF,location.jobHost,path.join(location.appRoot,'scripts','piraiders-app.cjs')])await fs.access(file);
  const label='PiRaiders-Exchange-CI-'+crypto.randomUUID().replaceAll('-',''),port=await full.freePort(),talk=await full.freePort(),origin='http://127.0.0.1:'+port;
  // SPX's own data (outside the fixture root, which must start empty).
  const spx=path.join(work,'spx'),data=path.join(spx,'data'),log=path.join(spx,'log');
  await fs.mkdir(path.join(data,'Bench','data'),{recursive:true});await fs.mkdir(log);
  await fs.writeFile(path.join(data,'Bench','profile.json'),JSON.stringify({general:{name:'Synthetic exchange activation'},templates:[]}));
  await fs.writeFile(path.join(data,'Bench','data','Run.json'),JSON.stringify({templates:[],rundown:[]}));
  const configFile=path.join(spx,'config.json'),configBytes=JSON.stringify({general:{port,hostname:'synthetic-exchange-ci',launchBrowser:false,loglevel:'error',dataroot:data,logfolder:log,
    templatesource:'spx-ip-address',langfile:'english.json',username:'',password:'',apikey:'',resolution:'HD',recents:[]},casparcg:{servers:[]},osc:{enable:false},globalExtras:{}});
  await fs.writeFile(configFile,configBytes);
  const casparExe=path.join(toolInfo.casparDirectory,'casparcg.exe');
  const built=await buildExchangeActivationFixture({root:path.join(work,'proof'),setUpStores:false,machine:{
    spxConfigFile:path.relative(location.appRoot,configFile).split(path.sep).join('/'),
    caspar:{executable:casparExe,cwd:toolInfo.casparDirectory,rendererProfile:'mesa-llvmpipe-compat'},
    output:{type:'ndi',name:label,runtimeDirectory:ndi.runtimeDirectory},presentation:{port:0},
    rossTalk:{host:'127.0.0.1',port:talk,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',2:'next',3:'previous',8:'stop'},acknowledgements:true}}});
  const awayRoot=path.join(path.dirname(built.sourceRoot),'exchange-away');
  const privatePaths=[work,built.sourceRoot,awayRoot,...built.privateRoots,tools,toolInfo.casparDirectory];
  const plan=expectedFrames(built.order),cachedPlan=expectedFrames(built.order,'cached'),frames=[],timings={};let probe,app,browser,page,phase='SETUP',sourceIdentity,report,cleanupTree,lastTreeCounts,browserTree;
  const started=performance.now(),mark=name=>{timings[name]=Math.round(performance.now()-started);};
  const answers=[],closes=[],closeAttempts=[];
  const client={
    get:async url=>{const r=await page.evaluate(async url=>{const response=await fetch(url,{signal:AbortSignal.timeout(30000)});return{status:response.status,text:await response.text()};},url);answers.push(r.text);let value;try{value=JSON.parse(r.text);}catch{}return{status:r.status,value};},
    post:async(url,body)=>{const r=await page.evaluate(async([url,body])=>{const response=await fetch(url,{method:'POST',signal:AbortSignal.timeout(60000),headers:{'Content-Type':'application/json',
      'X-PiRaiders-Csrf':document.querySelector('meta[name="piraiders-csrf"]').content},body:JSON.stringify(body)});return{status:response.status,text:await response.text()};},[url,body]);
      answers.push(r.text);let value;try{value=JSON.parse(r.text);}catch{}return{status:r.status,value};}};
  async function state(){const r=await client.get('/game-day/api/state');assert.equal(r.status,200,'APP_STATE_HTTP');assert.equal(r.value.ok,true,'APP_STATE_OK');return r.value.state;}
  async function frame(name,rgb,options={}){
    const result=await probe.request('frame',{name,rgb,minFrames:3,minDurationMs:0,timeoutMs:20000,...options},25000);
    assert.equal(result.sourceIdentityHash,sourceIdentity,'SOURCE_IDENTITY_CHANGED');assert.ok(result.distinctTimestamps>=3&&result.connections>0,'FRESH_NDI_FRAMES_REQUIRED');
    assert.equal(result.width,1920,'NDI_FRAME_WIDTH');assert.equal(result.height,1080,'NDI_FRAME_HEIGHT');assert.ok(['BGRA','BGRX'].includes(result.format),'NDI_FRAME_FORMAT');
    if(rgb.every(x=>x===0))checkConsolePixels(await fs.readFile(path.join(evidence,name+'.png')),rgb);
    frames.push({name,distinctTimestamps:result.distinctTimestamps,matchedFrames:result.matchedFrames,format:result.format});
  }
  const runSetup=pin=>setup.runSetupCommand(built.machineFile,{appRoot:location.appRoot,nodeExecutable:location.nodeExecutable,pin});
  // Open the Game Day page of the running application (a new session each start).
  async function openPage(){
    if(page)try{await page.close();}catch{}
    page=await browser.newPage({viewport:{width:1440,height:1000}});
    await page.goto(origin+'/game-day');await page.locator('#connection').filter({hasText:'Connected to application'}).waitFor();
    assert.equal(await page.locator('body').getAttribute('data-mode'),'source','SOURCE_MODE_PAGE');
  }
  // Renderer ready, owned sender captured, NDI source (same identity), then
  // black, Launch, Next over RossTalk, Next and Previous over the route, Stop black.
  async function playAndStop(eventId,steps,tag){
    phase=tag+'RENDERER_READY';await full.until(async()=>{const value=await state();return value.active&&value.active.eventId===eventId&&value.active.runtime.ready;},'APP_RENDERER_READY',90000);mark(tag.toLowerCase()+'rendererReady');
    phase=tag+'SENDER_IDENTITY';const sender=await full.captureOwnedCaspar(app.parentIdentity,casparExe,{deadline:performance.now()+15000,jobHost:location.jobHost});cleanupTree=sender.tree;
    phase=tag+'NDI_DISCOVERY';const discovered=await probe.request('discover',{timeoutMs:30000},35000);
    if(sourceIdentity===undefined){sourceIdentity=discovered.sourceIdentityHash;assert.match(sourceIdentity,/^[a-f0-9]{64}$/,'NDI_SOURCE_IDENTITY');}
    else assert.equal(discovered.sourceIdentityHash,sourceIdentity,'SOURCE_IDENTITY_CHANGED');
    const prefix=steps[0].name.split('-')[0];
    phase=tag+'BLACK_BEFORE_LAUNCH';await frame(prefix+'-before-launch-black',[0,0,0]);
    phase=tag+'LAUNCH';await page.locator('#launch').click();await frame(steps[0].name,steps[0].rgb);
    phase=tag+'NEXT_ROSSTALK';await rossTalk(talk,'GPI 2',{prefix:'OK ',timeoutMs:30000});await frame(steps[1].name,steps[1].rgb);
    phase=tag+'NEXT_ROUTE';await routes.command(client,'next');await frame(steps[2].name,steps[2].rgb);
    phase=tag+'PREVIOUS_ROUTE';await routes.command(client,'previous');await frame(steps[3].name,steps[3].rgb);mark(tag.toLowerCase()+'sequenceSeen');
    phase=tag+'STOP';await page.locator('#stop').click();await frame(prefix+'-stop-black',[0,0,0],{minFrames:10,minDurationMs:1500});mark(tag.toLowerCase()+'stoppedBlack');
  }
  // Close the application at its console (`graceful`: Ctrl+C; `console-close`:
  // the window closed): every owned process gone, the SPX port free, the receiver quiet.
  async function closeApplication(tag,method,{activeCaspar=true}={}){
    phase=tag+'CLOSE_CAPTURE';lastTreeCounts=null;cleanupTree=(await full.capturePinnedTree(app.parentIdentity,{deadline:performance.now()+15000})).tree;
    if(activeCaspar)assert.ok(cleanupTree.some(row=>full.normalized(row.ExecutablePath)===full.normalized(casparExe)),'CLOSE_ACTIVE_CASPAR');
    phase=tag+'CLOSE_SIGNAL';const signalled=performance.now();await consoleClose.sendClose(method,app.parentPid);
    phase=tag+'CLOSE';const exit=await full.settledChild(app.child);const exited=performance.now();
    phase=tag+'CLOSE_GONE';await full.until(()=>{lastTreeCounts=observeTree(processTable(),cleanupTree);return lastTreeCounts.surviving===0&&lastTreeCounts.unknown===0;},'APP_TREE_SURVIVED_CLOSE',consoleClose.CLOSE_GONE_BOUND_MS);
    const goneAt=performance.now();
    phase=tag+'CLOSE_PORT';await consoleClose.portFree(port);
    // Raw times first, so a close that breaks a rule still shows them on the failure line.
    const attempt={method,exitCode:exit.code,signal:exit.signal,signalToExitMs:Math.round(exited-signalled),signalToGoneMs:Math.round(goneAt-signalled)};
    phase=tag+'CLOSE_RECORD';closeAttempts.push(attempt);closes.push(consoleClose.closeRecord(attempt));
    phase=tag+'CLOSE_QUIET';const quiet=await probe.request('quiet',{durationMs:1500,timeoutMs:20000},25000);assert.equal(quiet.connections,0,'RECEIVER_NOT_QUIET');assert.ok(quiet.quietDurationMs>=1500,'RECEIVER_NOT_QUIET');mark(tag.toLowerCase()+'closed');
    return{connections:quiet.connections,durationMs:quiet.quietDurationMs};
  }
  try{
    // The operator's setup command sets up both private stores; run again it changes nothing.
    phase='SETUP_COMMAND';const setupRuns=setup.checkSetupTwice(await runSetup(false),await runSetup(false));mark('setUp');
    phase='RECEIVER';probe=await full.receiver(tools,ndi.dllPath,label,evidence);
    phase='APPLICATION';app=await full.application(built.machineFile,origin+'/game-day',location,{consoleHost:consoleClose.CONSOLE_PROOF});mark('applicationReady');
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});await openPage();
    // The page refreshes the source catalog by itself on opening; let that finish first.
    phase='PAGE_REFRESH';const pageRefresh=await routes.pageRefreshSettled(client);mark('pageRefreshSettled');
    // The window covers the online run and the cached start after it.
    phase='APPROVE';const window=routes.approvalWindow(Date.now(),{afterMs:30*60000});
    const flow=await routes.approveAndActivate(client,{identityTuple:built.identityTuple,window});mark('activated');
    await playAndStop(flow.eventId,plan,'');
    phase='PRIVACY';assert.equal(routes.namesPrivatePath(answers,privatePaths),false,'ROUTE_ANSWER_NAMES_PRIVATE_PATH');
    const quiet=await closeApplication('','graceful');
    // Cached start (5b-4): pin with the app closed, move the exchange folder away, start again.
    phase='PIN_OFFLINE';const offlinePin=setup.checkPinned(await runSetup(true));mark('pinned');
    phase='EXCHANGE_AWAY';await fs.rename(built.sourceRoot,awayRoot);
    await assert.rejects(fs.access(built.sourceRoot),{code:'ENOENT'},'EXCHANGE_FOLDER_STILL_THERE');
    phase='CACHED_APPLICATION';app=await full.application(built.machineFile,origin+'/game-day',location,{consoleHost:consoleClose.CONSOLE_PROOF});mark('cachedApplicationReady');
    await openPage();
    phase='CACHED_PAGE_REFRESH';const cachedRefresh=await routes.pageRefreshSettled(client);
    assert.equal(cachedRefresh.catalog.available,false,'CACHED_SOURCE_CATALOG_AVAILABLE');
    phase='CACHED_START';const cachedStart=await routes.startApproved(client);mark('cachedActivated');
    assert.equal(cachedStart.eventId,flow.eventId,'CACHED_START_OTHER_BUTTON');
    await playAndStop(cachedStart.eventId,cachedPlan,'CACHED_');
    phase='CACHED_PRIVACY';assert.equal(routes.namesPrivatePath(answers,privatePaths),false,'ROUTE_ANSWER_NAMES_PRIVATE_PATH');
    await assert.rejects(fs.access(built.sourceRoot),{code:'ENOENT'},'EXCHANGE_FOLDER_STILL_THERE');
    const cachedQuiet=await closeApplication('CACHED_','console-close');
    assert.deepEqual(closes.map(c=>c.method),['graceful','console-close'],'CLOSE_METHODS_BOTH');
    // Default browser (5d-3): the third start opens Game Day in the system's default browser.
    phase='BROWSER_SNAPSHOT';if(page)try{await page.close();}catch{}page=null;
    const gameDay=origin+'/game-day',before=defaultBrowser.processKeys(defaultBrowser.browserTable(gameDay));
    phase='BROWSER_APPLICATION';app=await full.application(built.machineFile,gameDay,location,{consoleHost:consoleClose.CONSOLE_PROOF,browser:true});mark('browserApplicationReady');
    phase='BROWSER_PROCESS';let roots=[],browserRows;
    await full.until(()=>{browserRows=defaultBrowser.browserTable(gameDay);roots=defaultBrowser.browserRoots(browserRows,before);return roots.length>0;},'BROWSER_PROCESS_NOT_SEEN',30000);mark('browserSeen');
    browserTree=roots;// From here on the cleanup closes at least what was found.
    assert.equal(new Set(roots.map(row=>String(row.ExecutablePath).toLowerCase())).size,1,'BROWSER_IMAGES_DIFFER');
    browserTree=defaultBrowser.browserTree(browserRows,roots,before);
    phase='BROWSER_CLOSE';const browserClosing=performance.now();lastTreeCounts=await defaultBrowser.closeBrowser(browserTree,{until:full.until});const browserCloseMs=performance.now()-browserClosing;
    const browserTracked=browserTree.length;browserTree=null;
    const browserReport=defaultBrowser.browserRecord({appReportedOpened:app.browserOpened,image:roots[0].ExecutablePath,roots:roots.length,tracked:browserTracked,closeMs:browserCloseMs});
    const browserQuiet=await closeApplication('BROWSER_','graceful',{activeCaspar:false});
    const browserClose=closes.pop();assert.equal(browserClose.method,'graceful','BROWSER_APP_CLOSE_METHOD');
    assert.equal(await fs.readFile(configFile,'utf8'),configBytes,'SPX_CONFIG_UNCHANGED');
    report={event:'exchange-activation-windows-proof-passed',sourceCommit:process.env.PIRAIDERS_PROOF_SOURCE_SHA||null,casparProvenance:toolInfo.provenance,ndiProvenance:ndi.provenance,
      runtimeVersion:probe.info.runtimeVersion,actualCLI:true,sourceMachine:true,syntheticExchangeFolder:true,approvalListSetUpBeforeStart:true,
      storesSetUpBySetupCommand:true,setupCommandRuns:setupRuns,
      routes:['source/refresh','source/events','source/selections','source/review','source/approve','events','prepare','activate','command'],
      pageOwnRefresh:{catalogAvailable:pageRefresh.catalog.available,code:pageRefresh.catalog.code},approvalWindowContainsNow:true,prewarmMinutes:window.prewarmMinutes,publishedOrder:built.order.map(p=>p.name),sourceIdentityHash:sourceIdentity,sourceIdentityStable:true,
      frames,fullFrameOpaqueBlackBeforeLaunch:true,fullFrameOpaqueBlackAfterStop:true,routeAnswersPathFree:true,closeTookEveryOwnedProcess:true,
      closeReceiverQuiet:quiet,closes,
      cachedStart:{offlinePin,exchangeFolderAbsent:true,sourceCatalogAvailable:false,sourceCatalogCode:cachedRefresh.catalog.code,sameButton:true,routes:['events','prepare','activate','command'],
        publishedOrder:built.order.map(p=>p.name),sourceIdentityStable:true,fullFrameOpaqueBlackBeforeLaunch:true,fullFrameOpaqueBlackAfterStop:true,closeTookEveryOwnedProcess:true,closeReceiverQuiet:cachedQuiet},
      defaultBrowser:{...browserReport,appClose:browserClose,appCloseReceiverQuiet:browserQuiet},
      spxConfigUnchanged:true,timingsMs:timings,
      sameMachineOnly:true,windows10Tested:false,lanTransportTested:false,stadiumHardwareTested:false};
  }catch(error){
    // The page's visible text instead of a screenshot, kept only when it names no private path.
    // The whole text is checked before it is cut, so a cut cannot leave part of a path.
    if(page)try{const allText=String(await page.locator('body').innerText({timeout:5000})),visibleText=allText.slice(0,4000);
      if(!routes.namesPrivatePath([allText,allText.toLowerCase()],privatePaths.flatMap(p=>[p,p.toLowerCase(),p.split(path.sep).join('/')])))await fs.writeFile(path.join(evidence,'failure-page.json'),JSON.stringify({phase,visibleText},null,2));}catch{}
    let evidenceViolations=null;try{const audit=await auditEvidence(evidence,privatePaths);evidenceViolations=audit.violations;if(audit.violations.length)await removeViolations(evidence,audit.violations);}catch{}
    let sourceStatus=null;if(page&&['APPROVE','PAGE_REFRESH','CACHED_PAGE_REFRESH','CACHED_START'].includes(phase))try{sourceStatus=routes.sourceStatusCodes((await client.get('/game-day/api/source/status')).value);}catch{}
    console.error(JSON.stringify({event:'exchange-activation-proof-fixed-failure',phase,
      routeStatus:error&&Number.isInteger(error.routeStatus)?error.routeStatus:null,setupExitCode:error&&Number.isInteger(error.exitCode)?error.exitCode:null,answerCode:error&&typeof error.answerCode==='string'?error.answerCode:null,sourceStatus,code:error&&typeof error.code==='string'&&/^[A-Z_]{1,64}$/.test(error.code)?error.code:full.fixedFailure(error),
      processIdentityReason:identityReason(error),processCaptureDiagnostics:identityCaptureDiagnostics(error),framesVerified:frames.map(x=>x.name),closes,closeAttempts,evidenceViolations,treeCounts:lastTreeCounts||null,
      appCategories:app?[...app.categories]:[],timingsMs:timings}));
    throw Error('EXCHANGE_ACTIVATION_PROOF_FAILED');
  }finally{
    const cleanup=[];try{await browser?.close();}catch{cleanup.push('BROWSER');}
    if(browserTree)try{await defaultBrowser.closeBrowser(browserTree,{until:full.until});}catch{cleanup.push('DEFAULT_BROWSER');}
    try{await full.killApplication(app?.child);}catch{cleanup.push('APPLICATION');}
    try{await full.cleanupCaptured(cleanupTree,location.jobHost);}catch{cleanup.push('RECORDED_TREE');}
    try{await probe?.close();}catch{cleanup.push('RECEIVER');}
    if(cleanup.length){console.error(JSON.stringify({event:'exchange-activation-proof-cleanup-failed',parts:cleanup}));throw Error('EXCHANGE_ACTIVATION_PROOF_CLEANUP');}
  }
  report.captures=[];
  for(const name of(await fs.readdir(evidence)).sort())if(/^[a-z0-9-]+\.png$/.test(name)){const bytes=await fs.readFile(path.join(evidence,name));report.captures.push({name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
  for(const f of frames)assert.ok(report.captures.some(c=>c.name===f.name+'.png'),'FRAME_CAPTURE_REQUIRED');
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify(report,null,2));
  const audit=await auditEvidence(evidence,privatePaths);
  if(audit.violations.length){await removeViolations(evidence,audit.violations);
    console.error(JSON.stringify({event:'exchange-activation-proof-fixed-failure',phase:'EVIDENCE_PRIVACY',code:'EVIDENCE_NAMES_PRIVATE_PATH',evidenceViolations:audit.violations}));throw Error('EVIDENCE_NAMES_PRIVATE_PATH');}
  console.log(JSON.stringify(report));
}
async function main(){
  if(process.platform!=='win32')throw Error('WINDOWS_REQUIRED');
  await scenario(sourceLocation(checkoutRoot));
}
if(require.main===module)main().catch(()=>{console.error('EXCHANGE_ACTIVATION_PROOF_FAILED');process.exitCode=1;});
module.exports={expectedFrames};
