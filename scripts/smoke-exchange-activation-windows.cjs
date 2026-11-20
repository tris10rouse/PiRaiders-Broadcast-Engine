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
const routes=require('./exchange-activation-routes.cjs');
const checkoutRoot=path.resolve(__dirname,'..');

// The order the receiver must see. Names are the evidence file names.
function expectedFrames(order){
  assert.ok(Array.isArray(order)&&order.length===3,'ACTIVATION_ORDER');
  const [first,second,third]=order;
  return[
    {step:'launch',name:'exchange-launch-'+first.name,rgb:first.rgb},
    {step:'next-rosstalk',name:'exchange-next-'+second.name,rgb:second.rgb},
    {step:'next-route',name:'exchange-next-'+third.name,rgb:third.rgb},
    {step:'previous-route',name:'exchange-previous-'+second.name,rgb:second.rgb}];
}

async function scenario(location){
  const tools=path.resolve(process.argv[2]||path.join(checkoutRoot,'build','caspar-proof-tools'));
  const evidence=path.join(checkoutRoot,'build','exchange-activation-proof-evidence'),work=path.join(checkoutRoot,'build','exchange-activation-proof');
  for(const dir of [evidence,work]){await fs.rm(dir,{recursive:true,force:true});await fs.mkdir(dir,{recursive:true});}
  const toolInfo=JSON.parse(await fs.readFile(path.join(tools,'tools.json'),'utf8')),ndi=JSON.parse(await fs.readFile(path.join(tools,'ndi-runtime.json'),'utf8'));
  for(const file of [PROBE,JOB_HOST,location.jobHost,path.join(location.appRoot,'scripts','piraiders-app.cjs')])await fs.access(file);
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
  const built=await buildExchangeActivationFixture({root:path.join(work,'proof'),machine:{
    spxConfigFile:path.relative(location.appRoot,configFile).split(path.sep).join('/'),
    caspar:{executable:casparExe,cwd:toolInfo.casparDirectory,rendererProfile:'mesa-llvmpipe-compat'},
    output:{type:'ndi',name:label,runtimeDirectory:ndi.runtimeDirectory},presentation:{port:0},
    rossTalk:{host:'127.0.0.1',port:talk,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',2:'next',3:'previous',8:'stop'},acknowledgements:true}}});
  const privatePaths=[work,built.sourceRoot,...built.privateRoots,tools,toolInfo.casparDirectory];
  const plan=expectedFrames(built.order),frames=[],timings={};let probe,app,browser,page,phase='SETUP',sourceIdentity,report,cleanupTree,lastTreeCounts;
  const started=performance.now(),mark=name=>{timings[name]=Math.round(performance.now()-started);};
  const answers=[];
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
  try{
    phase='RECEIVER';probe=await full.receiver(tools,ndi.dllPath,label,evidence);
    phase='APPLICATION';app=await full.application(built.machineFile,origin+'/game-day',location);mark('applicationReady');
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});page=await browser.newPage({viewport:{width:1440,height:1000}});
    await page.goto(origin+'/game-day');await page.locator('#connection').filter({hasText:'Connected to application'}).waitFor();
    assert.equal(await page.locator('body').getAttribute('data-mode'),'source','SOURCE_MODE_PAGE');
    phase='APPROVE';const window=routes.approvalWindow(Date.now());
    const flow=await routes.approveAndActivate(client,{identityTuple:built.identityTuple,window});mark('activated');
    phase='RENDERER_READY';await full.until(async()=>{const value=await state();return value.active&&value.active.eventId===flow.eventId&&value.active.runtime.ready;},'APP_RENDERER_READY',90000);mark('rendererReady');
    phase='SENDER_IDENTITY';const sender=await full.captureOwnedCaspar(app.parentIdentity,casparExe,{deadline:performance.now()+15000,jobHost:location.jobHost});cleanupTree=sender.tree;
    phase='NDI_DISCOVERY';const discovered=await probe.request('discover',{timeoutMs:30000},35000);sourceIdentity=discovered.sourceIdentityHash;assert.match(sourceIdentity,/^[a-f0-9]{64}$/,'NDI_SOURCE_IDENTITY');
    phase='BLACK_BEFORE_LAUNCH';await frame('exchange-before-launch-black',[0,0,0]);
    phase='LAUNCH';await page.locator('#launch').click();await frame(plan[0].name,plan[0].rgb);
    phase='NEXT_ROSSTALK';await rossTalk(talk,'GPI 2',{prefix:'OK ',timeoutMs:30000});await frame(plan[1].name,plan[1].rgb);
    phase='NEXT_ROUTE';await routes.command(client,'next');await frame(plan[2].name,plan[2].rgb);
    phase='PREVIOUS_ROUTE';await routes.command(client,'previous');await frame(plan[3].name,plan[3].rgb);mark('sequenceSeen');
    phase='STOP';await page.locator('#stop').click();await frame('exchange-stop-black',[0,0,0],{minFrames:10,minDurationMs:1500});mark('stoppedBlack');
    phase='PRIVACY';assert.equal(routes.namesPrivatePath(answers,privatePaths),false,'ROUTE_ANSWER_NAMES_PRIVATE_PATH');
    phase='CLOSE_CAPTURE';lastTreeCounts=null;cleanupTree=(await full.capturePinnedTree(app.parentIdentity,{deadline:performance.now()+15000})).tree;
    assert.ok(cleanupTree.some(row=>full.normalized(row.ExecutablePath)===full.normalized(casparExe)),'CLOSE_ACTIVE_CASPAR');
    phase='CLOSE';app.child.kill();await full.settledChild(app.child);
    phase='CLOSE_GONE';await full.until(()=>{lastTreeCounts=observeTree(processTable(),cleanupTree);return lastTreeCounts.surviving===0&&lastTreeCounts.unknown===0;},'APP_TREE_SURVIVED_CLOSE',10000);
    phase='CLOSE_QUIET';const quiet=await probe.request('quiet',{durationMs:1500,timeoutMs:20000},25000);assert.equal(quiet.connections,0,'RECEIVER_NOT_QUIET');assert.ok(quiet.quietDurationMs>=1500,'RECEIVER_NOT_QUIET');mark('closed');
    assert.equal(await fs.readFile(configFile,'utf8'),configBytes,'SPX_CONFIG_UNCHANGED');
    report={event:'exchange-activation-windows-proof-passed',sourceCommit:process.env.PIRAIDERS_PROOF_SOURCE_SHA||null,casparProvenance:toolInfo.provenance,ndiProvenance:ndi.provenance,
      runtimeVersion:probe.info.runtimeVersion,actualCLI:true,sourceMachine:true,syntheticExchangeFolder:true,approvalListSetUpBeforeStart:true,
      routes:['source/refresh','source/events','source/selections','source/review','source/approve','events','prepare','activate','command'],
      approvalWindowContainsNow:true,prewarmMinutes:window.prewarmMinutes,publishedOrder:built.order.map(p=>p.name),sourceIdentityHash:sourceIdentity,sourceIdentityStable:true,
      frames,fullFrameOpaqueBlackBeforeLaunch:true,fullFrameOpaqueBlackAfterStop:true,routeAnswersPathFree:true,closeTookEveryOwnedProcess:true,
      closeReceiverQuiet:{connections:quiet.connections,durationMs:quiet.quietDurationMs},spxConfigUnchanged:true,timingsMs:timings,
      sameMachineOnly:true,windows10Tested:false,lanTransportTested:false,stadiumHardwareTested:false};
  }catch(error){
    if(page)try{await page.screenshot({path:path.join(evidence,'failure-ui.png'),fullPage:true,timeout:5000});}catch{}
    console.error(JSON.stringify({event:'exchange-activation-proof-fixed-failure',phase,code:error&&typeof error.code==='string'&&/^[A-Z_]{1,64}$/.test(error.code)?error.code:full.fixedFailure(error),
      processIdentityReason:identityReason(error),processCaptureDiagnostics:identityCaptureDiagnostics(error),framesVerified:frames.map(x=>x.name),treeCounts:lastTreeCounts||null,
      appCategories:app?[...app.categories]:[],timingsMs:timings}));
    throw Error('EXCHANGE_ACTIVATION_PROOF_FAILED');
  }finally{
    const cleanup=[];try{await browser?.close();}catch{cleanup.push('BROWSER');}
    try{await full.killApplication(app?.child);}catch{cleanup.push('APPLICATION');}
    try{await full.cleanupCaptured(cleanupTree,location.jobHost);}catch{cleanup.push('RECORDED_TREE');}
    try{await probe?.close();}catch{cleanup.push('RECEIVER');}
    if(cleanup.length){console.error(JSON.stringify({event:'exchange-activation-proof-cleanup-failed',parts:cleanup}));throw Error('EXCHANGE_ACTIVATION_PROOF_CLEANUP');}
  }
  report.captures=[];
  for(const name of(await fs.readdir(evidence)).sort())if(/^[a-z0-9-]+\.png$/.test(name)){const bytes=await fs.readFile(path.join(evidence,name));report.captures.push({name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
  for(const f of frames)assert.ok(report.captures.some(c=>c.name===f.name+'.png'),'FRAME_CAPTURE_REQUIRED');
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
async function main(){
  if(process.platform!=='win32')throw Error('WINDOWS_REQUIRED');
  await scenario(sourceLocation(checkoutRoot));
}
if(require.main===module)main().catch(()=>{console.error('EXCHANGE_ACTIVATION_PROOF_FAILED');process.exitCode=1;});
module.exports={expectedFrames};
