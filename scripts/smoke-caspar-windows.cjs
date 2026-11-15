#!/usr/bin/env node
'use strict';
// Real disposable Caspar/CEF/OpenGL proof. No NDI consumer or stadium connection.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const net=require('node:net');
const http=require('node:http');
const {spawn,execFileSync}=require('node:child_process');
const {setTimeout:wait}=require('node:timers/promises');
const {PNG}=require('pngjs');
const jpeg=require('jpeg-js');
const {processTable,descendants,treeState}=require('./windows-process-evidence.cjs');
const {LauncherRuntime}=require('./lib/launcher-runtime.cjs');
const {JOB_HOST}=require('./lib/windows-job-process.cjs');
const {stageSnapshot}=require('./lib/media-snapshot.cjs');
const {createRossTalkSession}=require('./lib/rosstalk-session.cjs');
function configuration(port){
  assert.ok(Number.isInteger(port)&&port>0&&port<65536);
  return `<?xml version="1.0" encoding="utf-8"?>
<configuration><paths><media-path>media/</media-path><log-path disabled="true">log/</log-path><data-path>data/</data-path><template-path>template/</template-path></paths><log-level>info</log-level><channels><channel><video-mode>1080p3000</video-mode><color-depth>8</color-depth><consumers/></channel></channels><controllers><tcp><port>${port}</port><protocol>AMCP</protocol></tcp></controllers><osc><disable-send-to-amcp-clients>true</disable-send-to-amcp-clients></osc><ndi><auto-load>false</auto-load></ndi><html><enable-gpu>false</enable-gpu><remote-debugging-port>0</remote-debugging-port><cache-path/></html></configuration>`;
}
async function until(predicate,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await predicate())return;await wait(100);}throw Error(label);}
async function freePort(){const server=net.createServer();await new Promise((r,j)=>server.listen(0,'127.0.0.1',r).once('error',j));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
// One bounded command per socket, only the fixed status header returned; never
// log echoed AMCP commands, arbitrary INFO data or credential-bearing failures.
async function command(port,value,{prefix='202 ',timeoutMs=10000}={}){
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection({host:'127.0.0.1',port});let bytes=Buffer.alloc(0),done=false;
    const timer=setTimeout(()=>finish(Error('PROTOCOL_TIMEOUT')),timeoutMs);
    function finish(error){if(done)return;done=true;clearTimeout(timer);socket.destroy();if(error)reject(error);else resolve();}
    socket.on('error',()=>finish(Error('PROTOCOL_UNAVAILABLE')));
    socket.on('connect',()=>socket.write(value+'\r\n'));
    socket.on('close',()=>{if(!done)finish(Error('PROTOCOL_CLOSED'));});
    socket.on('data',chunk=>{if(done)return;if(bytes.length+chunk.length>16384)return finish(Error('PROTOCOL_LIMIT'));bytes=Buffer.concat([bytes,chunk]);const end=bytes.indexOf('\r\n');if(end<0)return;finish(bytes.subarray(0,end).toString('ascii').startsWith(prefix)?null:Error('PROTOCOL_REJECTED'));});
  });
}
function image(rgb){const data=Buffer.alloc(160*90*4);for(let i=0;i<data.length;i+=4)data.set([...rgb,255],i);return PNG.sync.write({width:160,height:90,data});}
function checkPixels(bytes,rgb){const png=PNG.sync.read(bytes);assert.equal(png.width,1920);assert.equal(png.height,1080);for(const[x,y]of [[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]]){const i=(Math.floor(png.height*y)*png.width+Math.floor(png.width*x))*4;assert.ok(png.data[i+3]>=250,'ALPHA_UNVERIFIED');assert.ok(rgb.every((v,n)=>Math.abs(png.data[i+n]-v)<=12),'MIXED_PIXELS');}}
async function filesUnder(dir){const all=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())all.push(...await filesUnder(file));else if(e.isFile())all.push(file);}return all;}
async function main(){
  if(process.platform!=='win32')throw Error('WINDOWS_REQUIRED');
  let processEvidence=null;const processChecks={};
  function treeGone(captured){processEvidence=treeState(processTable(),captured);processChecks[phase]=processEvidence;return processEvidence.surviving===0;}
  const toolRoot=path.resolve(process.argv[2]||path.join('build','caspar-proof-tools'));
  const evidence=path.resolve('build','caspar-proof-evidence');await fs.rm(evidence,{recursive:true,force:true});await fs.mkdir(evidence,{recursive:true});
  const {casparDirectory:bin,provenance}=JSON.parse(await fs.readFile(path.join(toolRoot,'tools.json'),'utf8'));
  const port=await freePort(),config=path.join(bin,'piraiders-proof.config');
  for(const folder of ['media','log','data','template'])await fs.mkdir(path.join(bin,folder),{recursive:true});
  await fs.writeFile(config,configuration(port));
  const fixtures=path.join(toolRoot,'fixtures');await fs.mkdir(fixtures,{recursive:true});
  async function prepare(name,colors){const sourceDir=path.join(fixtures,name);await fs.mkdir(sourceDir);for(let i=0;i<colors.length;i++)await fs.writeFile(path.join(sourceDir,'0'+i+(i===1?'.jpg':'.png')),i===1?jpeg.encode(PNG.sync.read(image(colors[i])),95).data:image(colors[i]));return stageSnapshot({sourceDir,cacheDir:path.join(toolRoot,'snapshots'),quietMs:0});}
  const initial=await prepare('initial',[[240,20,20],[20,20,240]]),replacement=await prepare('replacement',[[20,220,20]]);
  let now=Date.now(),session,runtime,mesaStartupObserved=false,phase='START',captureCount=0;
  const start=now+16*60000,end=start+3600000,children=[],hosts=new Set();let activeHost,report,startupBytes=0;const startup=[],nativeExits=[];const httpCounts={},nativeFlags=new Set();let upgrades=0,bootstrapFields=null,expectedBearer=null,referrerCapabilityObserved=false;
  function contained(command,args,options){
    const child=spawn(JOB_HOST,[command,...args],{cwd:options.cwd,env:{...process.env,GALLIUM_DRIVER:'llvmpipe',LIBGL_ALWAYS_SOFTWARE:'1',MESA_GL_VERSION_OVERRIDE:'4.5COMPAT'},windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    child.stdin.on('error',()=>{});hosts.add(child);child.once('exit',(code,signal)=>{hosts.delete(child);nativeExits.push({code,signal});});
    // Native output after pre-auth startup is discarded. Only retain a boolean
    // observation of the software renderer; bound carry across UTF-8 chunks.
    for(const stream of [child.stdout,child.stderr]){let carry='';stream.on('data',chunk=>{const text=chunk.toString('utf8');if((phase==='START'||phase==='COLOR_MIXER')&&startupBytes<16384){const part=text.slice(0,16384-startupBytes);startupBytes+=part.length;startup.push(part);}const value=carry+text;for(const flag of ['ERR_CONNECTION_REFUSED','ERR_FILE_NOT_FOUND','ERR_ABORTED','SyntaxError','TypeError','ReferenceError','CefInitialize','WebSocket','cookie'])if(value.includes(flag))nativeFlags.add(flag);if(/Initialized OpenGL[^\r\n]*Mesa/i.test(value))mesaStartupObserved=true;carry=value.slice(-512);});}
    if(command.toLowerCase().endsWith('casparcg.exe'))activeHost=child;
    return child;
  }
  runtime=new LauncherRuntime({productionWindow:{start:new Date(start).toISOString(),end:new Date(end).toISOString()},services:[
    {name:'spx',command:process.execPath,args:['-e','setInterval(()=>{},1000)']},
    {name:'casparcg',command:path.join(bin,'casparcg.exe'),args:[config,'--log-severity=disable','--disable-logging'],cwd:bin}
  ]},{clock:()=>now,supervisorOptions:{spawnProcess:contained,maxRestarts:1,restartDelayMs:100}});
  // The persistent SPX process is a harmless stand-in in this probe. Separate
  // package CI tests the actual SPX server. Managed host/CEF/Caspar here are real.
  try{
    await runtime.start();assert.equal(runtime.sender,null);
    now=start-15*60000;await runtime.reconcile();
    await until(async()=>{try{await command(port,'VERSION',{prefix:'201 ',timeoutMs:1000});return true;}catch{return false;}},'CASPAR_STARTUP',60000);
    children.push(...descendants(processTable(),activeHost.pid));
    phase='COLOR_MIXER';await command(port,'PLAY 1-10 RED');
    async function capture(name,rgb){
      let last;
      for(let attempt=0;attempt<8;attempt++){
        const stem='piraiders-'+name+'-'+captureCount++,file=path.join(bin,'media',stem+'.png');
        await command(port,'ADD 1 IMAGE "'+stem+'"');
        try{
          await until(async()=>{try{const bytes=await fs.readFile(file);if(bytes.length>16*1024*1024)throw Error('CAPTURE_LIMIT');checkPixels(bytes,rgb);return true;}catch(e){last=e;return false;}},'CAPTURE_PIXELS',5000);
          await fs.copyFile(file,path.join(evidence,name+'.png'));return;
        }catch{await wait(200);}
      }
      throw Error(last?'PIXEL_MISMATCH':'CAPTURE_MISSING');
    }
    await capture('mixer-red',[255,0,0]);assert.ok(mesaStartupObserved,'MESA_GL_STARTUP_UNOBSERVED');
    await command(port,'CLEAR 1');phase='MANAGED_CEF';
    const createServer=http.createServer;
    http.createServer=function(...args){const server=createServer.apply(this,args);const emit=server.emit;server.emit=function(event,...values){if(event==='request'){const [req,res]=values;const category=req.url==='/piraiders/session'?'bootstrap':req.url.startsWith('/templates/piraiders/slideshow/')?'template':req.url.startsWith('/piraiders/socket.io')?'socket':req.url.startsWith('/piraiders/media/')?'media':'other';if(category==='bootstrap'){const h=req.headers,expected=new URL(session.origin);const classify=(value,allowed)=>value===undefined?'absent':allowed.includes(value)?value:'other';bootstrapFields={originAbsent:h.origin===undefined,originKind:h.origin===undefined?'absent':h.origin==='null'?'null':'other',originMatches:h.origin===session.origin,hostMatches:h.host===expected.host,markerMatches:h['x-piraiders-bootstrap']==='1',bearerMatches:expectedBearer!==null&&h.authorization===expectedBearer,referrerContainsCapability:typeof h.referer==='string'&&expectedBearer!==null&&h.referer.includes(expectedBearer.slice(7)),site:classify(h['sec-fetch-site'],['same-origin','same-site','cross-site','none']),mode:classify(h['sec-fetch-mode'],['cors','same-origin','no-cors','navigate','websocket']),dest:classify(h['sec-fetch-dest'],['empty','document','iframe'])};referrerCapabilityObserved ||= bootstrapFields.referrerContainsCapability;}res.once('finish',()=>{const key=category+':'+res.statusCode;httpCounts[key]=(httpCounts[key]||0)+1;});}return emit.call(this,event,...values);};server.on('upgrade',()=>upgrades++);return server;};
    try{session=await createRossTalkSession({presentation:{snapshotDir:initial.snapshotDir,commandTimeoutMs:20000,controllerOptions:{mode:'manual'}},rossTalk:{host:'127.0.0.1',port:0,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',2:'next',3:'previous',5:'reload',8:'stop'},acknowledgements:true},canControl:()=>runtime.allowed(),resolvePreparedSnapshot:async()=>replacement.snapshotDir},{allowEphemeral:true});}finally{http.createServer=createServer;}
    await session.start();const privateURL=session.getProgramURL(),token=new URL(privateURL).hash.split('=')[1];
    expectedBearer='Bearer '+token;
    await command(port,'PLAY 1-10 [HTML] "'+privateURL+'"');
    await until(()=>session.snapshot().presentation.renderer.ready,'CEF_INITIAL_BLACK',60000);
    const talk=session.address().port;
    await command(talk,'GPI 1',{prefix:'OK ',timeoutMs:30000});await capture('launch-red',[240,20,20]);
    await command(talk,'GPI 2',{prefix:'OK ',timeoutMs:30000});await capture('next-blue',[20,20,240]);
    await command(talk,'GPI 3',{prefix:'OK ',timeoutMs:30000});await capture('previous-red',[240,20,20]);
    await command(talk,'GPI 5',{prefix:'OK ',timeoutMs:45000});await capture('reload-green',[20,220,20]);
    await command(talk,'GPI 8',{prefix:'OK ',timeoutMs:30000});await capture('stop-black',[0,0,0]);
    // Stop leaves the real Caspar process alive within the permitted window.
    await command(port,'VERSION',{prefix:'201 '});
    // No raw logs or config enter artifacts. Fail if the bootstrap credential
    // reached a known textual log/config file despite controls. CEF uses an
    // empty cache-path; this scan is supplemental, not a filesystem sandbox.
    async function scanPrivateLogs(){for(const file of await filesUnder(bin))if(/\.(?:log|txt|json|config)$/i.test(file)){
      const stat=await fs.stat(file);if(stat.size>16*1024*1024)throw Error('LOG_SCAN_LIMIT');
      const body=await fs.readFile(file);if(body.includes(Buffer.from(token))||body.includes(Buffer.from(token,'utf16le'))||body.includes(Buffer.from(privateURL)))throw Error('PRIVATE_URL_PERSISTED');
    }}await scanPrivateLogs();
    phase='CRASH_RECOVERY';const oldHost=activeHost,oldEpoch=session.snapshot().presentation.renderer.epoch,rows=processTable();
    const expectedImage=path.join(bin,'casparcg.exe').toLowerCase();
    const roots=descendants(rows,oldHost.pid).filter(row=>row.ParentProcessId===oldHost.pid&&typeof row.ExecutablePath==='string'&&path.normalize(row.ExecutablePath).toLowerCase()===expectedImage);
    assert.equal(roots.length,1,'OWNED_ROOT_IDENTITY');const root=roots[0];
    assert.ok(root&&Number.isSafeInteger(root.ProcessId)&&root.ProcessId>0,'OWNED_ROOT_MISSING');
    const crashedTree=descendants(rows,oldHost.pid);children.push(...crashedTree);
    // Kill only the proven direct child of our native containment host. The
    // host must tear down CEF, then supervisor may restart within its window.
    execFileSync('taskkill.exe',['/PID',String(root.ProcessId),'/F'],{stdio:'ignore',timeout:15000,windowsHide:true});
    await until(async()=>{if(activeHost===oldHost)return false;try{await command(port,'VERSION',{prefix:'201 ',timeoutMs:1000});return true;}catch{return false;}},'CASPAR_RESTART',60000);
    await until(()=>treeGone(crashedTree),'CRASHED_TREE_SURVIVED',10000);
    await until(()=>!session.snapshot().presentation.renderer.connected,'OLD_RENDERER_SURVIVED',10000);
    await command(port,'PLAY 1-10 [HTML] "'+session.getProgramURL()+'"');
    await until(()=>session.snapshot().presentation.renderer.ready,'RESTART_INITIAL_BLACK',60000);
    assert.notEqual(session.snapshot().presentation.renderer.epoch,oldEpoch);assert.equal(session.snapshot().presentation.controller.state,'stopped');
    await capture('restart-black',[0,0,0]);await command(talk,'GPI 1',{prefix:'OK ',timeoutMs:30000});await capture('restart-launch-green',[20,220,20]);
    assert.equal(referrerCapabilityObserved,false,'PRIVATE_URL_REFERRER');await scanPrivateLogs();
    children.push(...descendants(processTable(),activeHost.pid));phase='WINDOW_END';
    now=end;await runtime.reconcile();assert.equal(runtime.sender,null);
    await until(()=>treeGone(children),'CASPAR_TREE_SURVIVED',10000);
    await assert.rejects(command(port,'VERSION',{prefix:'201 ',timeoutMs:1000}));
    assert.ok(hosts.size>=1,'Persistent service survives window end');
    report={event:'real-caspar-windows-software-proof-passed',sourceCommit:process.env.PIRAIDERS_PROOF_SOURCE_SHA||null,provenance,videoMode:'1080p3000',mesaStartupObserved,softwareRendererRequested:'llvmpipe',mesaProfileRequested:'4.5COMPAT',actualGLRendererUnrecorded:true,actualCaspar:true,actualManagedCEF:true,actualMixedPixelCaptures:8,actualPNGAndJPEG:true,bootstrapOriginProof:bootstrapFields.originMatches?'matching-origin':'same-origin-metadata',privateCapabilityInReferrer:false,rootCrashRecovery:true,freshStoppedEpochAfterRestart:true,realRossTalk:true,windowEndProcessTreeGone:true,processIdentityEvidence:'pid-creation-utc-ticks-and-image',processChecks,windowClock:'injected-policy-clock-with-real-processes',persistentSPXStandIn:true,ndiTested:false,windows10Tested:false,stadiumHardwareTested:false};
  }catch(error){
    const renderer=session?.snapshot().presentation.renderer;
    console.error(JSON.stringify({event:'caspar-proof-fixed-diagnostic',phase,nativeExits,processEvidence,processChecks,code:/^[A-Z_]{1,64}$/.test(error.message)?error.message:'ASSERTION_OR_COMPONENT_FAILED',httpCounts,bootstrapFields,upgrades,nativeFlags:[...nativeFlags],renderer:renderer?{ready:renderer.ready,connected:renderer.connected,presentation:renderer.presentation,lastError:renderer.lastError}:null}));
    // This bounded capture stops BEFORE host construction/private URL creation.
    // It contains only disposable pre-auth startup; URLs are omitted as well.
    if(phase==='START'||phase==='COLOR_MIXER')console.error(JSON.stringify({event:'caspar-preauth-startup-diagnostic',nativeExits,startup:startup.join('').replace(/https?:\/\/[^\s<>"']+/g,'[URL omitted]')}));
    // Fixed phase only: never include protocol text, URL or native exceptions.
    throw Error('CASPAR_PROOF_FAILED_'+phase);
  }finally{
    const cleanup=await Promise.allSettled([session?.close(),runtime.close()]);
    for(const child of hosts)child.stdin?.end();
    if(cleanup.some(result=>result.status==='rejected'))throw Error('CASPAR_PROOF_FAILED_CLEANUP');
  }
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
if(require.main===module)main().catch(error=>{console.error(/^CASPAR_PROOF_FAILED_[A-Z_]+$/.test(error.message)?error.message:'CASPAR_PROOF_FAILED');process.exitCode=1;});
module.exports={configuration,checkPixels,command};
