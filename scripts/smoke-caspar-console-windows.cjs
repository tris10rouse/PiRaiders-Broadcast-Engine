#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const net=require('node:net');
const {execFileSync}=require('node:child_process');
const {setTimeout:wait}=require('node:timers/promises');
const {PNG}=require('pngjs');
const jpeg=require('jpeg-js');
const {configuration,checkPixels,descendants}=require('./smoke-caspar-windows.cjs');
const {spawnSupervisedProcess}=require('./lib/windows-job-process.cjs');
const {CasparConsole}=require('./lib/caspar-console.cjs');
const {LauncherRuntime}=require('./lib/launcher-runtime.cjs');
const {stageSnapshot}=require('./lib/media-snapshot.cjs');
const {createRossTalkSession}=require('./lib/rosstalk-session.cjs');
function checkConsolePixels(bytes,rgb){
  checkPixels(bytes,rgb);
  if(rgb.every(v=>v===0)){
    const png=PNG.sync.read(bytes);
    for(let i=0;i<png.data.length;i+=4)if(png.data[i]>12||png.data[i+1]>12||png.data[i+2]>12||png.data[i+3]<250)throw Error('BLACK_PIXELS');
  }
}
function consoleConfiguration(){return configuration(5250).replace(/<controllers>.*?<\/controllers>/,'<controllers/>');}
function ps(source){return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; "+source],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1024*1024}));}
function table(){return ps('ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath)');}
function listeners(){return ps("ConvertTo-Json -Compress -InputObject @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Select-Object OwningProcess)");}
async function until(fn,code,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error(code);}
function image(rgb){const data=Buffer.alloc(160*90*4);for(let i=0;i<data.length;i+=4)data.set([...rgb,255],i);return{width:160,height:90,data};}
async function filesUnder(dir){const out=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())out.push(...await filesUnder(f));else if(e.isFile())out.push(f);}return out;}
async function main(){
  if(process.platform!=='win32')throw Error('WINDOWS_REQUIRED');
  const root=path.resolve(process.argv[2]||path.join('build','caspar-proof-tools'));
  const tools=JSON.parse(await fs.readFile(path.join(root,'tools.json'),'utf8')),bin=tools.casparDirectory;
  const evidence=path.resolve('build','caspar-console-evidence');await fs.rm(evidence,{recursive:true,force:true});await fs.mkdir(evidence,{recursive:true});
  const config=path.join(bin,'piraiders-console.config');for(const f of ['media','log','data','template'])await fs.mkdir(path.join(bin,f),{recursive:true});await fs.writeFile(config,consoleConfiguration());
  const sourceDir=path.join(root,'console-source');await fs.mkdir(sourceDir);
  await fs.writeFile(path.join(sourceDir,'01.png'),PNG.sync.write(image([240,20,20])));await fs.writeFile(path.join(sourceDir,'02.jpg'),jpeg.encode(image([20,20,240]),95).data);
  const snapshot=await stageSnapshot({sourceDir,cacheDir:path.join(root,'console-snapshots'),quietMs:0});await fs.rm(sourceDir,{recursive:true});
  let now=Date.now(),runtime,session,activeHost,activeClient,phase='START',token,report,captureCount=0;
  const end=now+3600000,hosts=new Set(),clients=new Set(),captures=[],listenerProbe=net.createServer();
  function contained(exe,args,options){
    const isCaspar=exe.toLowerCase().endsWith('casparcg.exe');
    const child=spawnSupervisedProcess(exe,args,{...options,env:{...process.env,GALLIUM_DRIVER:'llvmpipe',LIBGL_ALWAYS_SOFTWARE:'1',MESA_GL_VERSION_OVERRIDE:'4.5COMPAT'}},{forwardStdin:isCaspar});
    hosts.add(child);child.once('close',()=>hosts.delete(child));
    if(isCaspar){activeHost=child;activeClient=new CasparConsole(child,{timeoutMs:60000});clients.add(activeClient);}
    return child;
  }
  async function request(value,status=202){return activeClient.request(value,{status});}
  async function capture(name,rgb){
    for(let attempt=0;attempt<8;attempt++){
      const stem='console-'+name+'-'+captureCount++,file=path.join(bin,'media',stem+'.png');await request('ADD 1 IMAGE "'+stem+'"');
      try{await until(async()=>{try{const b=await fs.readFile(file);assert.ok(b.length<16*1024*1024);checkConsolePixels(b,rgb);return true;}catch{return false;}},'CAPTURE_PIXELS',5000);await fs.copyFile(file,path.join(evidence,name+'.png'));captures.push(name);return;}catch{await wait(200);}
    }throw Error('CAPTURE_PIXELS');
  }
  function ownedRoot(){const rows=table(),matches=rows.filter(r=>r.ParentProcessId===activeHost.pid&&typeof r.ExecutablePath==='string'&&path.normalize(r.ExecutablePath).toLowerCase()===path.join(bin,'casparcg.exe').toLowerCase());assert.equal(matches.length,1,'OWNED_CASPAR_ROOT');return{rows,pid:matches[0].ProcessId};}
  function noAmcpListener(){const{pid}=ownedRoot(),rows=listeners();assert.ok(rows.some(r=>r.OwningProcess===process.pid),'LISTENER_ENUM_POSITIVE_CONTROL');assert.ok(!rows.some(r=>r.OwningProcess===pid),'OWNED_ROOT_TCP_LISTENER');}
  try{
    await new Promise((resolve,reject)=>listenerProbe.listen(0,'127.0.0.1',resolve).once('error',reject));
    runtime=new LauncherRuntime({productionWindow:{start:new Date(now-1000).toISOString(),end:new Date(end).toISOString(),prewarmMinutes:0},services:[{name:'spx',command:process.execPath,args:['-e','setInterval(()=>{},1000)']},{name:'casparcg',command:path.join(bin,'casparcg.exe'),args:[config,'--log-severity=disable','--disable-logging'],cwd:bin}]},{clock:()=>now,supervisorOptions:{spawnProcess:contained,maxRestarts:1,restartDelayMs:100}});
    await runtime.start();await request('VERSION',201);noAmcpListener();await request('PLAY 1-10 RED');await capture('mixer-red',[255,0,0]);await request('CLEAR 1');
    phase='CEF';session=await createRossTalkSession({presentation:{snapshotDir:snapshot.snapshotDir,commandTimeoutMs:20000,controllerOptions:{mode:'manual'}},rossTalk:{host:'127.0.0.1',port:0,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',2:'next',8:'stop'},acknowledgements:true},canControl:()=>runtime.allowed(),resolvePreparedSnapshot:async()=>snapshot.snapshotDir},{allowEphemeral:true});await session.start();
    const url=session.getProgramURL();token=new URL(url).hash.split('=')[1];await request('PLAY 1-10 [HTML] "'+url+'"');await until(()=>session.snapshot().presentation.renderer.ready,'CEF_READY',60000);await capture('prepared-black',[0,0,0]);
    // Real loopback RossTalk, actual managed browser, private console AMCP.
    const{command}=require('./smoke-caspar-windows.cjs'),port=session.address().port;
    await command(port,'GPI 1',{prefix:'OK ',timeoutMs:30000});await capture('launch-red',[240,20,20]);await command(port,'GPI 2',{prefix:'OK ',timeoutMs:30000});await capture('next-blue',[20,20,240]);await command(port,'GPI 8',{prefix:'OK ',timeoutMs:30000});await capture('stop-black',[0,0,0]);
    phase='RECOVERY';const oldHost=activeHost,oldEpoch=session.snapshot().presentation.renderer.epoch,{rows,pid}=ownedRoot(),oldTree=descendants(rows,oldHost.pid);
    execFileSync('taskkill.exe',['/PID',String(pid),'/F'],{stdio:'ignore',windowsHide:true,timeout:15000});await until(()=>activeHost!==oldHost,'CONSOLE_RESTART',20000);await request('VERSION',201);noAmcpListener();await until(()=>{const alive=new Set(table().map(r=>r.ProcessId));return oldTree.every(id=>!alive.has(id));},'OLD_TREE',10000);await until(()=>!session.snapshot().presentation.renderer.connected,'OLD_RENDERER',10000);
    await request('PLAY 1-10 [HTML] "'+session.getProgramURL()+'"');await until(()=>session.snapshot().presentation.renderer.ready,'RESTART_CEF',60000);assert.notEqual(session.snapshot().presentation.renderer.epoch,oldEpoch);assert.equal(session.snapshot().presentation.controller.state,'stopped');await capture('restart-black',[0,0,0]);await command(port,'GPI 1',{prefix:'OK ',timeoutMs:30000});await capture('restart-launch-red',[240,20,20]);
    phase='WINDOW_END';const ending=descendants(table(),activeHost.pid);now=end;await runtime.reconcile();assert.equal(runtime.sender,null);await until(()=>{const alive=new Set(table().map(r=>r.ProcessId));return ending.every(id=>!alive.has(id));},'WINDOW_TREE',10000);
    for(const file of await filesUnder(bin))if(/\.(?:log|txt|json|config)$/i.test(file)){if((await fs.stat(file)).size>16*1024*1024)throw Error('LOG_SCAN_LIMIT');const b=await fs.readFile(file);if(b.includes(Buffer.from(token))||b.includes(Buffer.from(token,'utf16le')))throw Error('PRIVATE_URL_PERSISTED');}
    report={event:'caspar-private-console-proof-passed',sourceCommit:process.env.PIRAIDERS_PROOF_SOURCE_SHA||null,provenance:tools.provenance,actualConsoleAMCP:true,utf16Input:true,correlatedStatus:true,emptyTcpControllers:true,listenerEnumerationPositiveControl:true,noOwnedRootTcpListenerBeforeAndAfterRestart:true,actualManagedCEF:true,fullFrameOpaqueBlackVerified:true,actualMixedImages:captures,realRossTalk:true,rootCrashRecovery:true,freshStoppedEpoch:true,windowEndTreeGone:true,windowClock:'injected-policy-clock-with-real-processes',persistentSPXStandIn:true,ndiTested:false,windows10Tested:false,stadiumHardwareTested:false};
  }catch(error){console.error(JSON.stringify({event:'caspar-console-fixed-failure',phase,code:/^[A-Z_]{1,64}$/.test(error.message)?error.message:'ASSERTION_OR_COMPONENT',captures}));throw Error('CONSOLE_PROOF_FAILED');}
  finally{const results=await Promise.allSettled([runtime?.close(),session?.close()]);for(const client of clients)client.close();for(const child of hosts)child.stdin?.end();if(listenerProbe.listening)await new Promise((resolve,reject)=>listenerProbe.close(error=>error?reject(error):resolve()));if(results.some(r=>r.status==='rejected'))throw Error('CONSOLE_PROOF_CLEANUP');}
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
if(require.main===module)main().catch(()=>{console.error('CONSOLE_PROOF_FAILED');process.exitCode=1;});
module.exports={consoleConfiguration,checkConsolePixels};
