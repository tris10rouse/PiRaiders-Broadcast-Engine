'use strict';
// Q-020: the app runs the bundled CasparCG with the chosen renderer, and the
// defaults use the bundle. Linux tests with a synthetic bundle folder (stand-in
// files, not the real Caspar, Mesa or NDI); no Caspar is started here and no
// Windows, GPU or output claim follows. Q-021 runs the bundled Caspar on
// hosted Windows.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {bundledLocations,bundledCaspar,softwareLayoutState,ensureSoftwareCaspar,casparReport,SOFTWARE_PROFILE,MESA_FILES}=require('../scripts/lib/bundled-caspar.cjs');
const {loadGameDayMachineConfig,createLocalEventCatalog}=require('../scripts/lib/game-day-catalog.cjs');
const {graphicsFor}=require('../scripts/lib/graphics-check.cjs');
const {preflightRenderer,casparRendererEnvironment}=require('../scripts/lib/caspar-renderer.cjs');
const {checkRuntimeLayout}=require('../scripts/lib/bundled-components.cjs');
const diagnoseCommand=require('../scripts/piraiders-diagnose.cjs');

const said=code=>({platform:'win32',run:async()=>{said.calls++;return{exitCode:0,stdout:code};}});
said.calls=0;

// A folder shaped like the extracted ZIP: app/ beside runtime/caspar,
// runtime/mesa and runtime/ndi, with stand-in files.
async function bundle(t){
  const parent=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders bundled caspar 鷹 ')));
  t.after(()=>fs.rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:50}));
  const root=path.join(parent,'PiRaiders-Development'),app=path.join(root,'app');
  const files={'runtime/caspar/casparcg.exe':'MZ caspar','runtime/caspar/libcef.dll':'MZ cef','runtime/caspar/locales/en-US.pak':'pak',
    'runtime/caspar/casparcg.config':'<configuration/>','runtime/mesa/opengl32.dll':'MZ mesa front','runtime/mesa/libgallium_wgl.dll':'MZ gallium',
    'runtime/ndi/Processing.NDI.Lib.x64.dll':'MZ ndi','app/config.json':'{}'};
  for(const [rel,text] of Object.entries(files)){const file=path.join(root,...rel.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,text);}
  for(const dir of ['events','media'])await fs.mkdir(path.join(app,dir));
  return{parent,root,app};
}
async function machineFile(b,change=raw=>raw){
  const raw={schemaVersion:1,spxConfigFile:'config.json',catalogDirectory:'events',mediaRoot:'media',cacheRoot:'cache',runtimeRoot:'event-runtime',
    output:{type:'ndi',name:'PiRaiders'},rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}}};
  const file=path.join(b.app,'config','piraiders-app.json');await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,JSON.stringify(change(raw)));return file;
}
const load=(b,file,graphicsCheck)=>loadGameDayMachineConfig(file,{appRoot:b.app,nodeExecutable:process.execPath,...(graphicsCheck?{graphicsCheck}:{})});
async function exists(file){try{await fs.lstat(file);return true;}catch{return false;}}

test('the bundled places: runtime beside app, the software copy outside runtime/',()=>{
  const at=bundledLocations(path.join(path.sep,'x','PiRaiders','app'));
  assert.equal(at.caspar,path.join(path.sep,'x','PiRaiders','runtime','caspar'));
  assert.equal(at.ndi,path.join(path.sep,'x','PiRaiders','runtime','ndi'));
  assert.equal(at.software,path.join(path.sep,'x','PiRaiders','runtime-software','caspar'));
  assert.deepEqual(bundledCaspar(path.join(path.sep,'x','PiRaiders','app'),'gpu'),{executable:path.join(at.caspar,'casparcg.exe'),cwd:at.caspar},'gpu: the bundled Caspar, no profile');
  assert.deepEqual(bundledCaspar(path.join(path.sep,'x','PiRaiders','app'),'software'),{executable:path.join(at.software,'casparcg.exe'),cwd:at.software,rendererProfile:SOFTWARE_PROFILE});
  assert.throws(()=>bundledCaspar('relative/app','gpu'),/BUNDLED_CASPAR_OPTIONS_INVALID/);
  assert.throws(()=>bundledCaspar(path.join(path.sep,'x','app'),'auto'),/BUNDLED_CASPAR_OPTIONS_INVALID/);
});

test('a machine file without caspar runs the bundled Caspar with the chosen renderer; NDI from runtime/ndi',async t=>{
  const b=await bundle(t),file=await machineFile(b),at=bundledLocations(b.app);
  said.calls=0;
  const gpu=await load(b,file,said('GPU_OPENGL_45'));
  assert.equal(said.calls,1,'the check runs once when the machine loads');
  assert.equal(gpu.casparFrom,'bundle');assert.deepEqual(gpu.graphics,{check:'GPU_OPENGL_45',probe:'ran',setting:'auto',renderer:'gpu'});
  assert.deepEqual({...gpu.caspar},{executable:path.join(at.caspar,'casparcg.exe'),cwd:at.caspar});
  assert.equal(gpu.output.runtimeDirectory,at.ndi);
  assert.deepEqual(casparReport(gpu),{from:'bundle',renderer:'gpu'});
  // Diagnose and Setup report this answer; the check is not run again.
  assert.equal(await graphicsFor(gpu,said('GPU_OPENGL_TOO_OLD')),gpu.graphics);assert.equal(said.calls,1);
  // The GPU Caspar has no Mesa beside it and no Mesa variables.
  await preflightRenderer(gpu.caspar);
  assert.deepEqual(casparRendererEnvironment({PATH:'p',GALLIUM_DRIVER:'kept as inherited'},gpu.caspar.rendererProfile),{PATH:'p',GALLIUM_DRIVER:'kept as inherited'});
  assert.equal(await exists(path.join(at.caspar,'opengl32.dll')),false);
  for(const check of ['GPU_OPENGL_TOO_OLD','GPU_OPENGL_UNKNOWN']){
    const soft=await load(b,file,said(check));
    assert.deepEqual({...soft.caspar},{executable:path.join(at.software,'casparcg.exe'),cwd:at.software,rendererProfile:SOFTWARE_PROFILE},check);
    assert.deepEqual(casparReport(soft),{from:'bundle',renderer:'software'});
  }
  // Off Windows the check is not run: unknown, so software.
  const linux=await load(b,file);
  assert.equal(linux.graphics.probe,process.platform==='win32'?linux.graphics.probe:'not-windows');
  if(process.platform!=='win32')assert.equal(linux.graphics.renderer,'software');
  // The machine file's setting forces either.
  const forcedGpu=await load(b,await machineFile(b,raw=>({...raw,renderer:'gpu'})),said('GPU_OPENGL_TOO_OLD'));
  assert.equal(forcedGpu.caspar.executable,path.join(at.caspar,'casparcg.exe'));assert.equal(forcedGpu.caspar.rendererProfile,undefined);
  const forcedSoft=await load(b,await machineFile(b,raw=>({...raw,renderer:'software'})),said('GPU_OPENGL_45'));
  assert.equal(forcedSoft.caspar.executable,path.join(at.software,'casparcg.exe'));
  // A compiled event profile carries the chosen Caspar and the bundled NDI folder.
  await fs.writeFile(path.join(b.app,'events','football.json'),JSON.stringify({schemaVersion:1,provider:'local-manual',eventId:'football',displayName:'Football',
    productionWindow:{start:'2026-01-01T00:00:00Z',end:'2026-01-01T01:00:00Z'},relativeSourcePath:'football',startup:{mode:'source'}}));
  const record=await createLocalEventCatalog(forcedSoft).read('football');
  assert.equal(record.profile.caspar.executable,path.join(at.software,'casparcg.exe'));assert.equal(record.profile.caspar.rendererProfile,SOFTWARE_PROFILE);
  assert.equal(record.profile.output.runtimeDirectory,at.ndi);
});

test('a machine file that names its own Caspar and NDI folder keeps them; no check runs',async t=>{
  const b=await bundle(t),own=path.join(b.parent,'own');
  const file=await machineFile(b,raw=>({...raw,caspar:{executable:path.join(own,'casparcg.exe'),cwd:own,rendererProfile:SOFTWARE_PROFILE},output:{...raw.output,runtimeDirectory:path.join(own,'ndi')}}));
  said.calls=0;const m=await load(b,file,said('GPU_OPENGL_45'));
  assert.equal(said.calls,0,'no check for a machine file\'s own Caspar');
  assert.equal(m.casparFrom,'machine-file');assert.equal(m.graphics,undefined);
  assert.deepEqual({...m.caspar},{executable:path.join(own,'casparcg.exe'),cwd:own,rendererProfile:SOFTWARE_PROFILE});
  assert.equal(m.output.runtimeDirectory,path.join(own,'ndi'));
  assert.deepEqual(casparReport(m),{from:'machine-file',renderer:'software'});
  const plain=await load(b,await machineFile(b,raw=>({...raw,caspar:{executable:path.join(own,'casparcg.exe'),cwd:own}})));
  assert.deepEqual(casparReport(plain),{from:'machine-file',renderer:'unknown'});
  // A caspar block is still judged strictly; a bad one still refuses the file.
  for(const caspar of [{},{executable:path.join(own,'x.exe')},{executable:path.join(own,'x.exe'),cwd:own,rendererProfile:'other'},null,'bundle'])
    await assert.rejects(load(b,await machineFile(b,raw=>({...raw,caspar}))),{code:'MACHINE_CONFIG_INVALID'},JSON.stringify(caspar));
  // The NDI output name is still required; an empty runtimeDirectory is refused, not replaced.
  await assert.rejects(load(b,await machineFile(b,raw=>({...raw,output:{type:'ndi'}}))),{code:'MACHINE_CONFIG_INVALID'});
  await assert.rejects(load(b,await machineFile(b,raw=>({...raw,output:{type:'ndi',name:'N',runtimeDirectory:''}}))),{code:'MACHINE_CONFIG_INVALID'});
});

test('the software copy: made once, Mesa beside its casparcg.exe only, rebuilt when the bundle changes',async t=>{
  const b=await bundle(t),at=bundledLocations(b.app),exe=path.join(at.software,'casparcg.exe');
  assert.equal(await softwareLayoutState(b.app),'missing');
  await assert.rejects(preflightRenderer(bundledCaspar(b.app,'software')),{code:'MESA_RUNTIME_MISSING'},'before the copy exists');
  assert.deepEqual(await ensureSoftwareCaspar(b.app),{layout:'built'});
  assert.equal(await softwareLayoutState(b.app),'ready');
  await preflightRenderer(bundledCaspar(b.app,'software'));
  for(const rel of ['casparcg.exe','libcef.dll','locales/en-US.pak','casparcg.config'])
    assert.equal(await fs.readFile(path.join(at.software,...rel.split('/')),'utf8'),await fs.readFile(path.join(at.caspar,...rel.split('/')),'utf8'),rel);
  for(const name of MESA_FILES)assert.equal(await fs.readFile(path.join(at.software,name),'utf8'),await fs.readFile(path.join(at.mesa,name),'utf8'),name);
  // The bundled runtime/ folder itself still keeps the layout rule.
  const listing=[];for(const dir of ['caspar','mesa','ndi'])for(const name of await fs.readdir(path.join(at.root,'runtime',dir),{recursive:true}))listing.push('runtime/'+dir+'/'+name.split(path.sep).join('/'));
  assert.deepEqual(checkRuntimeLayout([...listing,'runtime/vcredist/VC_redist.x64.exe']),[]);
  assert.equal(await exists(path.join(at.caspar,'opengl32.dll')),false,'Mesa never beside the GPU Caspar');
  // Hard links where the disk allows them.
  if(process.platform!=='win32')assert.equal((await fs.stat(exe)).ino,(await fs.stat(path.join(at.caspar,'casparcg.exe'))).ino);
  // Current: nothing is made again.
  const before=(await fs.stat(path.join(at.software,'.piraiders-software-layout.json'))).mtimeMs;
  assert.deepEqual(await ensureSoftwareCaspar(b.app),{layout:'ready'});
  assert.equal((await fs.stat(path.join(at.software,'.piraiders-software-layout.json'))).mtimeMs,before);
  // A changed bundled file (a new extraction) makes it again from the new bytes.
  await fs.rm(path.join(at.caspar,'libcef.dll'));await fs.writeFile(path.join(at.caspar,'libcef.dll'),'MZ cef, newer');
  assert.equal(await softwareLayoutState(b.app),'missing');
  assert.deepEqual(await ensureSoftwareCaspar(b.app),{layout:'built'});
  assert.equal(await fs.readFile(path.join(at.software,'libcef.dll'),'utf8'),'MZ cef, newer');
  // A file removed from the copy is noticed and put back.
  await fs.rm(path.join(at.software,'opengl32.dll'));
  assert.equal(await softwareLayoutState(b.app),'missing');
  assert.deepEqual(await ensureSoftwareCaspar(b.app),{layout:'built'});
  assert.equal(await exists(path.join(at.software,'opengl32.dll')),true);
  assert.deepEqual((await fs.readdir(at.softwareRoot)),['caspar'],'no building folder is left');
});

test('without hard links the copy is made by copying',async t=>{
  const b=await bundle(t),at=bundledLocations(b.app);let links=0;
  assert.deepEqual(await ensureSoftwareCaspar(b.app,{link:async()=>{links++;throw Object.assign(Error('cross-device'),{code:'EXDEV'});}}),{layout:'built'});
  assert.ok(links>0);
  assert.notEqual((await fs.stat(path.join(at.software,'casparcg.exe'))).ino,(await fs.stat(path.join(at.caspar,'casparcg.exe'))).ino);
  assert.equal(await softwareLayoutState(b.app),'ready');
});

test('the copy is refused, with nothing half-made left, when the bundle is not as shipped',async t=>{
  const cases={
    'Mesa beside the bundled Caspar':async at=>fs.writeFile(path.join(at.caspar,'opengl32.dll'),'MZ'),
    'Mesa missing':async at=>fs.rm(path.join(at.mesa,'libgallium_wgl.dll')),
    'Mesa empty':async at=>fs.writeFile(path.join(at.mesa,'opengl32.dll'),''),
    'Caspar missing':async at=>fs.rm(path.join(at.caspar,'casparcg.exe')),
    'a link inside Caspar':async at=>fs.symlink(path.join(at.mesa,'opengl32.dll'),path.join(at.caspar,'linked.dll')),
    'no runtime folder':async at=>fs.rm(path.join(at.root,'runtime'),{recursive:true})};
  for(const [name,spoil] of Object.entries(cases)){
    const b=await bundle(t),at=bundledLocations(b.app);await spoil(at);
    await assert.rejects(ensureSoftwareCaspar(b.app),{code:'SOFTWARE_LAYOUT_FAILED'},name);
    assert.equal(await exists(at.software),false,name);
    assert.equal(await softwareLayoutState(b.app),'unknown',name);
  }
  // A copy that fails part-way leaves the previous copy, and no building folder.
  const b=await bundle(t),at=bundledLocations(b.app);await ensureSoftwareCaspar(b.app);
  await fs.rm(path.join(at.caspar,'casparcg.config'));await fs.writeFile(path.join(at.caspar,'casparcg.config'),'<changed/>');
  let n=0;const failing=async(from,to)=>{if(++n===2)throw Error('disk full');throw Error('no links');};
  const realCopy=fs.copyFile;let copies=0;fs.copyFile=async(...args)=>{if(++copies===2)throw Object.assign(Error('disk full'),{code:'ENOSPC'});return realCopy(...args);};
  try{await assert.rejects(ensureSoftwareCaspar(b.app,{link:failing}),{code:'SOFTWARE_LAYOUT_FAILED'});}finally{fs.copyFile=realCopy;}
  assert.deepEqual(await fs.readdir(at.softwareRoot),['caspar']);
  assert.equal(await fs.readFile(path.join(at.software,'casparcg.exe'),'utf8'),'MZ caspar','the previous copy stays');
  // The new copy cannot take the name (a file held open on Windows): the old one is put back whole.
  const realRename=fs.rename;fs.rename=async(from,to)=>{if(path.basename(from).startsWith('.building-'))throw Object.assign(Error('busy'),{code:'EPERM'});return realRename(from,to);};
  try{await assert.rejects(ensureSoftwareCaspar(b.app),{code:'SOFTWARE_LAYOUT_FAILED'});}finally{fs.rename=realRename;}
  assert.deepEqual(await fs.readdir(at.softwareRoot),['caspar']);
  assert.equal(await fs.readFile(path.join(at.software,'casparcg.config'),'utf8'),'<configuration/>','the previous copy is whole');
  assert.deepEqual(await ensureSoftwareCaspar(b.app),{layout:'built'});
  assert.equal(await fs.readFile(path.join(at.software,'casparcg.config'),'utf8'),'<changed/>');
  assert.deepEqual(await fs.readdir(at.softwareRoot),['caspar'],'no retired folder is left');
});

test('Diagnose prints which Caspar runs, its renderer and whether the software copy is there; it never makes it',async t=>{
  const b=await bundle(t),file=await machineFile(b),options={appRoot:b.app,nodeExecutable:process.execPath};
  const soft=await diagnoseCommand.main(['--machine',file],{...options,graphicsCheck:said('GPU_OPENGL_TOO_OLD')});
  assert.equal(soft.exitCode,0);
  assert.deepEqual(soft.answer.caspar,{from:'bundle',renderer:'software',layout:'missing'});
  assert.deepEqual(soft.answer.graphics,{check:'GPU_OPENGL_TOO_OLD',probe:'ran',setting:'auto',renderer:'software'});
  assert.equal(await exists(bundledLocations(b.app).softwareRoot),false,'Diagnose writes nothing');
  await ensureSoftwareCaspar(b.app);
  assert.deepEqual((await diagnoseCommand.main(['--machine',file],{...options,graphicsCheck:said('GPU_OPENGL_TOO_OLD')})).answer.caspar,{from:'bundle',renderer:'software',layout:'ready'});
  assert.deepEqual((await diagnoseCommand.main(['--machine',file],{...options,graphicsCheck:said('GPU_OPENGL_45')})).answer.caspar,{from:'bundle',renderer:'gpu',layout:'not-needed'});
  const own=await machineFile(b,raw=>({...raw,caspar:{executable:path.join(b.parent,'casparcg.exe'),cwd:b.parent}}));
  assert.deepEqual((await diagnoseCommand.main(['--machine',own],options)).answer.caspar,{from:'machine-file',renderer:'unknown',layout:'not-needed'});
  assert.equal(JSON.stringify(soft.answer).includes(b.parent),false,'no path in the answer');
});

// The web adapter: at app start it makes the software copy for a bundled
// software machine and the diagnostics route says which Caspar runs.
async function webDiagnostics(t,b,file){
  const express=require('express'),session=require('express-session'),http=require('node:http');
  const {createGameDayWeb}=require('../scripts/lib/game-day-web.cjs');
  const prior=global.config;global.config={general:{username:'',password:''}};
  const app=express(),server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  const web=createGameDayWeb({port,appRoot:b.app,machineFile:file,configFile:path.join(b.app,'config.json')});
  app.use(web.guard);app.use(session({secret:'synthetic-bundled-caspar',resave:false,saveUninitialized:false}));app.use(web.router);
  t.after(async()=>{await web.close();await new Promise(resolve=>server.close(resolve));global.config=prior;});
  return new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port,path:'/game-day/api/diagnostics',agent:false,headers:{Host:'127.0.0.1:'+port}},res=>{
    const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,text,value:JSON.parse(text)});});}).on('error',reject);});
}
// No stand-in check here: off Windows it is not run, and on Windows this
// synthetic bundle has no check, so both answer unknown, hence software.
test('the app makes the software copy at start and its diagnostics say which Caspar runs',async t=>{
  const b=await bundle(t),file=await machineFile(b,raw=>({...raw,output:{type:'none'}}));
  const answer=await webDiagnostics(t,b,file);
  assert.equal(answer.status,200,answer.text);
  assert.deepEqual(answer.value.diagnostics.caspar,{from:'bundle',renderer:'software',layout:'ready',code:null});
  assert.deepEqual(Object.keys(answer.value.diagnostics.states),['exchangeFolder','catalogSequence','approvals','prepared','renderer','ndiSender'],'the six states unchanged');
  assert.equal(await softwareLayoutState(b.app),'ready');
  assert.equal(answer.text.includes(b.parent),false,'no path in the answer');
  // A bundle whose copy cannot be made: the app still answers, and says so.
  const broken=await bundle(t);await fs.rm(path.join(broken.root,'runtime','mesa'),{recursive:true});
  const failed=await webDiagnostics(t,broken,await machineFile(broken,raw=>({...raw,output:{type:'none'}})));
  assert.equal(failed.status,200,failed.text);
  assert.deepEqual(failed.value.diagnostics.caspar,{from:'bundle',renderer:'software',layout:'failed',code:'SOFTWARE_LAYOUT_FAILED'});
  // A machine file's own Caspar: nothing is made.
  const own=await bundle(t);
  const mine=await webDiagnostics(t,own,await machineFile(own,raw=>({...raw,output:{type:'none'},caspar:{executable:path.join(own.parent,'casparcg.exe'),cwd:own.parent}})));
  assert.deepEqual(mine.value.diagnostics.caspar,{from:'machine-file',renderer:'unknown',layout:'not-needed',code:null});
  assert.equal(await exists(bundledLocations(own.app).softwareRoot),false);
});
