'use strict';
// Q-019: the OpenGL 4.5 check and the renderer choice. Linux tests run the
// JS side with stand-in checks (a stub runner, and real stand-in executables
// spawned by the real runner); only the Windows test compiles and runs the
// real native check. No GPU, driver or Caspar claim from Linux.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {CHECK_CODES,RENDERER_SETTINGS,normalizeRendererSetting,chooseRenderer,graphicsCheckExecutable,runGraphicsCheck,graphicsFor}=require('../scripts/lib/graphics-check.cjs');
const {loadGameDayMachineConfig}=require('../scripts/lib/game-day-catalog.cjs');
const setupCommand=require('../scripts/piraiders-setup.cjs');
const diagnoseCommand=require('../scripts/piraiders-diagnose.cjs');
const root=path.resolve(__dirname,'..');

test('the fixed codes and settings',()=>{
  assert.deepEqual([...CHECK_CODES],['GPU_OPENGL_45','GPU_OPENGL_TOO_OLD','GPU_OPENGL_UNKNOWN']);
  assert.deepEqual([...RENDERER_SETTINGS],['auto','gpu','software']);
  assert.equal(Object.isFrozen(CHECK_CODES),true);assert.equal(Object.isFrozen(RENDERER_SETTINGS),true);
});

test('auto uses the GPU only when the check says OpenGL 4.5; gpu and software force',()=>{
  assert.equal(chooseRenderer('GPU_OPENGL_45','auto'),'gpu');
  assert.equal(chooseRenderer('GPU_OPENGL_TOO_OLD','auto'),'software');
  assert.equal(chooseRenderer('GPU_OPENGL_UNKNOWN','auto'),'software');
  for(const check of CHECK_CODES){assert.equal(chooseRenderer(check,'gpu'),'gpu');assert.equal(chooseRenderer(check,'software'),'software');}
  assert.equal(chooseRenderer('GPU_OPENGL_45',undefined),'gpu','an absent setting is auto');
  assert.equal(chooseRenderer('NVIDIA 4.6','auto'),'software','anything but the 4.5 code is not 4.5');
  for(const bad of ['GPU','Auto','',null,1,{},['gpu']])assert.throws(()=>chooseRenderer('GPU_OPENGL_45',bad),/RENDERER_SETTING_INVALID/);
});

test('the renderer setting: absent is auto, the three words only',()=>{
  assert.equal(normalizeRendererSetting(undefined),'auto');
  for(const word of RENDERER_SETTINGS)assert.equal(normalizeRendererSetting(word),word);
  for(const bad of ['GPU','Software','mesa','auto ','',null,0,true,{}])assert.throws(()=>normalizeRendererSetting(bad),/RENDERER_SETTING_INVALID/);
});

test('the check is the bundled executable beside JobHost',()=>{
  assert.equal(graphicsCheckExecutable('/bundle/app'),path.join('/bundle/app','build','windows','PiRaiders.GraphicsCheck.exe'));
  assert.throws(()=>graphicsCheckExecutable('relative/app'),/GRAPHICS_CHECK_OPTIONS_INVALID/);
});

test('off Windows the check is not run and answers unknown',async()=>{
  let ran=false;
  const answer=await runGraphicsCheck({appRoot:'/bundle/app',platform:'linux',run:async()=>{ran=true;return{exitCode:0,stdout:'GPU_OPENGL_45'};}});
  assert.equal(ran,false);assert.deepEqual(answer,{check:'GPU_OPENGL_UNKNOWN',probe:'not-windows'});assert.equal(Object.isFrozen(answer),true);
});

test('on Windows only an exact code with exit 0 is taken; anything else is unknown and never echoed',async()=>{
  const at=async(result)=>runGraphicsCheck({appRoot:path.resolve('/bundle/app'),platform:'win32',run:async()=>typeof result==='function'?result():result});
  for(const code of CHECK_CODES){
    assert.deepEqual(await at({exitCode:0,stdout:code+'\r\n'}),{check:code,probe:'ran'});
    assert.deepEqual(await at({exitCode:0,stdout:code}),{check:code,probe:'ran'});
  }
  for(const result of [{exitCode:1,stdout:'GPU_OPENGL_45\r\n'},{exitCode:0,stdout:'NVIDIA GeForce RTX 4.6.0 C:\\Windows\\System32\\nvoglv64.dll'},
    {exitCode:0,stdout:'GPU_OPENGL_45\r\nGPU_OPENGL_45\r\n'},{exitCode:0,stdout:' GPU_OPENGL_45'},{exitCode:0,stdout:''},{exitCode:null,stdout:'GPU_OPENGL_45'},
    {exitCode:0,stdout:'gpu_opengl_45'},{exitCode:0,stdout:42},null,()=>{throw Error('C:\\secret\\path');}]){
    const answer=await at(result);
    assert.deepEqual(answer,{check:'GPU_OPENGL_UNKNOWN',probe:'failed'},JSON.stringify(result));
    assert.doesNotMatch(JSON.stringify(answer),/NVIDIA|secret|System32/);
  }
  assert.deepEqual(await at({missing:true}),{check:'GPU_OPENGL_UNKNOWN',probe:'missing'});
});

// Real child processes through the real runner, with stand-in executables.
function standIn(t,body){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'PiRaiders graphics '));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'check');fs.writeFileSync(file,'#!/bin/sh\n'+body+'\n',{mode:0o755});return{dir,file};
}
const posix={skip:process.platform==='win32'?'POSIX stand-in executables; the Windows test runs the real check':false};
test('the real runner takes a stand-in check\'s code',posix,async t=>{
  const {file}=standIn(t,'printf "GPU_OPENGL_TOO_OLD\\r\\n"');
  assert.deepEqual(await runGraphicsCheck({executable:file,platform:'win32'}),{check:'GPU_OPENGL_TOO_OLD',probe:'ran'});
});
test('the real runner bounds a check that hangs or says too much',posix,async t=>{
  const hang=standIn(t,'sleep 30');const started=Date.now();
  assert.deepEqual(await runGraphicsCheck({executable:hang.file,platform:'win32',timeoutMs:300}),{check:'GPU_OPENGL_UNKNOWN',probe:'failed'});
  assert.ok(Date.now()-started<5000,'killed at the bound');
  const loud=standIn(t,'head -c 100000 /dev/zero | tr "\\0" A');
  assert.deepEqual(await runGraphicsCheck({executable:loud.file,platform:'win32'}),{check:'GPU_OPENGL_UNKNOWN',probe:'failed'});
  const crash=standIn(t,'echo GPU_OPENGL_45; exit 3');
  assert.deepEqual(await runGraphicsCheck({executable:crash.file,platform:'win32'}),{check:'GPU_OPENGL_UNKNOWN',probe:'failed'});
});
test('the real runner answers missing for no file, a folder or a link',posix,async t=>{
  const {dir,file}=standIn(t,'echo GPU_OPENGL_45');
  assert.deepEqual(await runGraphicsCheck({executable:path.join(dir,'none.exe'),platform:'win32'}),{check:'GPU_OPENGL_UNKNOWN',probe:'missing'});
  assert.deepEqual(await runGraphicsCheck({executable:dir,platform:'win32'}),{check:'GPU_OPENGL_UNKNOWN',probe:'missing'});
  const link=path.join(dir,'link.exe');fs.symlinkSync(file,link);
  assert.deepEqual(await runGraphicsCheck({executable:link,platform:'win32'}),{check:'GPU_OPENGL_UNKNOWN',probe:'missing'});
});

// The machine file's renderer setting and the two commands' answers.
async function machine(t,change=raw=>raw){
  const parent=await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(),'PiRaiders renderer ')));t.after(()=>fsp.rm(parent,{recursive:true,force:true}));
  const appRoot=path.join(parent,'app');await fsp.mkdir(path.join(appRoot,'config'),{recursive:true});
  await fsp.writeFile(path.join(appRoot,'config','spx.json'),JSON.stringify({general:{port:1}}));
  for(const dir of ['media','cache','runtime','catalog'])await fsp.mkdir(path.join(parent,dir));
  const raw=change({schemaVersion:1,spxConfigFile:'config/spx.json',catalogDirectory:path.join(parent,'catalog'),mediaRoot:path.join(parent,'media'),
    cacheRoot:path.join(parent,'cache'),runtimeRoot:path.join(parent,'runtime'),caspar:{executable:path.join(appRoot,'c','casparcg.exe'),cwd:path.join(appRoot,'c')},
    output:{type:'none'},rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}}});
  const file=path.join(parent,'machine.json');await fsp.writeFile(file,JSON.stringify(raw));
  return{file,options:{appRoot,nodeExecutable:process.execPath},parent};
}
test('the machine file takes renderer auto, gpu or software and refuses anything else',async t=>{
  const absent=await machine(t);
  assert.equal((await loadGameDayMachineConfig(absent.file,absent.options)).renderer,'auto');
  for(const word of RENDERER_SETTINGS){const m=await machine(t,raw=>({...raw,renderer:word}));assert.equal((await loadGameDayMachineConfig(m.file,m.options)).renderer,word);}
  for(const bad of ['GPU','mesa','',null,1,{type:'gpu'}]){const m=await machine(t,raw=>({...raw,renderer:bad}));
    await assert.rejects(loadGameDayMachineConfig(m.file,m.options),/MACHINE_CONFIG_INVALID/,JSON.stringify(bad));}
});
test('graphicsFor reports the check, the probe, the setting and the choice',async t=>{
  const m=await machine(t,raw=>({...raw,renderer:'software'})),loaded=await loadGameDayMachineConfig(m.file,m.options);
  const answer=await graphicsFor(loaded,{platform:'win32',run:async()=>({exitCode:0,stdout:'GPU_OPENGL_45'})});
  assert.deepEqual(answer,{check:'GPU_OPENGL_45',probe:'ran',setting:'software',renderer:'software'});assert.equal(Object.isFrozen(answer),true);
  await assert.rejects(graphicsFor({renderer:'gpu',appRoot:'/x'}),/MACHINE_CONFIG_INVALID/,'only a loader-made machine');
});
test('Setup and Diagnose print the graphics answer, with no GPU name or path',async t=>{
  const m=await machine(t,raw=>({...raw,renderer:'gpu'}));
  const check={platform:'win32',run:async()=>({exitCode:0,stdout:'GPU_OPENGL_TOO_OLD'})};
  const setup=await setupCommand.main(['--machine',m.file],{...m.options,graphicsCheck:check});
  assert.equal(setup.exitCode,1);assert.equal(setup.answer.code,'SETUP_MACHINE_NOT_SOURCE','a local machine is still refused by setup');
  assert.deepEqual(setup.answer.graphics,{check:'GPU_OPENGL_TOO_OLD',probe:'ran',setting:'gpu',renderer:'gpu'});
  const diagnose=await diagnoseCommand.main(['--machine',m.file],{...m.options,graphicsCheck:check});
  assert.equal(diagnose.exitCode,0);assert.deepEqual(diagnose.answer.graphics,{check:'GPU_OPENGL_TOO_OLD',probe:'ran',setting:'gpu',renderer:'gpu'});
  assert.deepEqual(Object.keys(diagnose.answer.states),['exchangeFolder','catalogSequence','approvals','prepared','renderer','ndiSender'],'the six states unchanged');
  for(const answer of [setup.answer,diagnose.answer])assert.equal(JSON.stringify(answer).includes(m.parent),false);
  // Off Windows (this host, no stand-in), the commands still answer: unknown, software.
  const plain=await diagnoseCommand.main(['--machine',m.file],m.options);
  if(process.platform!=='win32')assert.deepEqual(plain.answer.graphics,{check:'GPU_OPENGL_UNKNOWN',probe:'not-windows',setting:'gpu',renderer:'gpu'});
  // A refused machine file has no graphics answer: the setting is unknown.
  const bad=await machine(t,raw=>({...raw,renderer:'GPU'}));
  const refused=await diagnoseCommand.main(['--machine',bad.file],{...bad.options,graphicsCheck:check});
  assert.deepEqual(refused,{exitCode:1,answer:{ok:false,code:'MACHINE_CONFIG_INVALID'}});
});

test('the native check uses only the system OpenGL and prints only fixed codes',()=>{
  const source=fs.readFileSync(path.join(root,'native','windows','GraphicsCheck.cs'),'utf8');
  assert.match(source,/LoadLibraryExW\("opengl32\.dll", ?IntPtr\.Zero, ?LOAD_LIBRARY_SEARCH_SYSTEM32\)/);
  const printed=[...source.matchAll(/Console\.(?:Out\.)?Write(?:Line)?\(([^)]*)\)/g)].map(m=>m[1]);
  assert.deepEqual(printed,['answer'],'one print, of the answer only');
  for(const code of CHECK_CODES)assert.match(source,new RegExp('"'+code+'"'));
  assert.doesNotMatch(source,/GL_RENDERER|GL_VENDOR|0x1F01|0x1F00|Console\.Error/,'never reads or prints the GPU name or vendor');
});

test('the actual native check prints exactly one fixed code on Windows',{skip:process.platform!=='win32'?'Requires the Windows Framework compiler and the real OpenGL driver':false,timeout:60000},t=>{
  const windows=process.env.SystemRoot||process.env.WINDIR;
  const compiler=['Framework64','Framework'].map(part=>path.join(windows,'Microsoft.NET',part,'v4.0.30319','csc.exe')).find(file=>fs.existsSync(file));
  assert.ok(compiler,'Framework compiler');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'PiRaiders graphics '));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'PiRaiders.GraphicsCheck.'+crypto.randomUUID().slice(0,8)+'.exe');
  execFileSync(compiler,['/nologo','/target:exe','/platform:x64','/optimize+','/debug-','/warn:4','/out:'+file,path.join(root,'native','windows','GraphicsCheck.cs')],{encoding:'utf8',windowsHide:true,timeout:30000});
  const stdout=execFileSync(file,[],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.match(stdout,/^GPU_OPENGL_(?:45|TOO_OLD|UNKNOWN)\r?\n$/);
  // Hosted Windows has no GPU: the system OpenGL there is not 4.5.
  if(process.env.GITHUB_ACTIONS==='true')assert.notEqual(stdout.trim(),'GPU_OPENGL_45');
  t.diagnostic('native check on this host: '+stdout.trim());
});
