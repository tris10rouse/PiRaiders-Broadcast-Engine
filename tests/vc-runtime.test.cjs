'use strict';
// Q-027: the VC++ runtime check and Setup's consent to run the bundled
// installer. Linux tests use stand-ins (system folder files, the question,
// the installer runner); the Windows test reads the real System32 files of a
// hosted runner, which has the runtime installed. A clean PC without the
// runtime, and Microsoft's installer actually running, are a manual gate.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {PassThrough}=require('node:stream');
const vc=require('../scripts/lib/vc-runtime.cjs');
const root=path.resolve(__dirname,'..');

// A minimal PE: x64 (or another machine) with a VS_FIXEDFILEINFO version.
function pe(machine=0x8664,version='14.44.35211.0'){
  const bytes=Buffer.alloc(512);bytes.write('MZ',0,'ascii');bytes.writeUInt32LE(64,60);bytes.writeUInt32LE(0x00004550,64);bytes.writeUInt16LE(machine,68);
  if(version){const [a,b,c,d]=version.split('.').map(Number);const at=200;
    Buffer.from([0xbd,0x04,0xef,0xfe]).copy(bytes,at);bytes.writeUInt32LE(0x00010000,at+4);bytes.writeUInt32LE((a<<16|b)>>>0,at+8);bytes.writeUInt32LE((c<<16|d)>>>0,at+12);}
  return bytes;
}
const SYSTEM='C:\\Windows';
const dllPath=name=>path.win32.join(SYSTEM,'System32',name);
// Stand-in system folder: name -> bytes (or {dir:true}).
function system(files){
  return{platform:'win32',systemRoot:SYSTEM,
    lstat:async file=>{const f=files[file];if(f===undefined)throw Object.assign(Error('missing'),{code:'ENOENT'});
      return{isFile:()=>!f.dir,size:f.dir?0:f.length};},
    readFile:async file=>{const f=files[file];if(!f||f.dir)throw Object.assign(Error('missing'),{code:'ENOENT'});return f;}};
}
const all=(bytes=pe())=>Object.fromEntries(['msvcp140.dll','vcruntime140.dll','vcruntime140_1.dll'].map(n=>[dllPath(n),bytes]));

test('the fixed codes and the bundled version come from the component list',()=>{
  assert.deepEqual([...vc.CHECK_CODES],['VCRUNTIME_PRESENT','VCRUNTIME_OLD','VCRUNTIME_MISSING','VCRUNTIME_UNKNOWN']);
  const {COMPONENTS}=require('../scripts/lib/bundled-components.cjs');
  assert.deepEqual([...vc.BUNDLED_VERSION],COMPONENTS.find(c=>c.id==='vc-redist').version.split('.').map(Number));
  assert.equal(vc.PROMPT,'Install the Microsoft Visual C++ Runtime now? (Y/N) ');
  assert.match(vc.NEXT_STEP,/^VCRUNTIME_MISSING: .*Setup-PiRaiders\.cmd again and answer Y/);
  assert.equal(vc.installerPath(path.join(path.sep,'bundle','app')),path.join(path.sep,'bundle','runtime','vcredist','VC_redist.x64.exe'));
  assert.throws(()=>vc.installerPath('relative/app'),/VCRUNTIME_OPTIONS_INVALID/);
});

test('the check reads the three system DLLs: present, older, missing, or unknown',async()=>{
  assert.deepEqual(await vc.checkVcRuntime(system(all())),{check:'VCRUNTIME_PRESENT',probe:'read'});
  assert.deepEqual(await vc.checkVcRuntime(system(all(pe(0x8664,'14.50.1.0')))),{check:'VCRUNTIME_PRESENT',probe:'read'},'newer is present');
  assert.deepEqual(await vc.checkVcRuntime(system(all(pe(0x8664,'14.44.35212.0')))),{check:'VCRUNTIME_PRESENT',probe:'read'});
  const older={...all(),[dllPath('msvcp140.dll')]:pe(0x8664,'14.29.30133.0')};
  assert.deepEqual(await vc.checkVcRuntime(system(older)),{check:'VCRUNTIME_OLD',probe:'read'});
  assert.deepEqual(await vc.checkVcRuntime(system(all(pe(0x8664,'14.44.35210.0')))),{check:'VCRUNTIME_OLD',probe:'read'});
  for(const name of ['msvcp140.dll','vcruntime140.dll','vcruntime140_1.dll']){
    const files=all();delete files[dllPath(name)];
    assert.deepEqual(await vc.checkVcRuntime(system(files)),{check:'VCRUNTIME_MISSING',probe:'read'},name);
    assert.deepEqual(await vc.checkVcRuntime(system({...all(),[dllPath(name)]:{dir:true}})),{check:'VCRUNTIME_MISSING',probe:'read'},name+' a folder');
  }
  // A 32-bit file, no version resource, not a PE, an unreadable file: unknown, never present.
  for(const bytes of [pe(0x14c),pe(0x8664,null),Buffer.from('not a pe file'.padEnd(80,'.'))])
    assert.deepEqual(await vc.checkVcRuntime(system(all(bytes))),{check:'VCRUNTIME_UNKNOWN',probe:'failed'});
  const denied={...system(all()),lstat:async()=>{throw Object.assign(Error('no'),{code:'EACCES'});}};
  assert.deepEqual(await vc.checkVcRuntime(denied),{check:'VCRUNTIME_UNKNOWN',probe:'failed'});
  for(const systemRoot of [undefined,'','Windows','\\\\server\\share\\Windows'])
    assert.deepEqual(await vc.checkVcRuntime({...system(all()),systemRoot}),{check:'VCRUNTIME_UNKNOWN',probe:'failed'},String(systemRoot));
  assert.deepEqual(await vc.checkVcRuntime({platform:'linux'}),{check:'VCRUNTIME_UNKNOWN',probe:'not-windows'});
});

test('installer exit codes become fixed codes',()=>{
  assert.equal(vc.installCode(0),'VCRUNTIME_INSTALLED');
  assert.equal(vc.installCode(3010),'VCRUNTIME_INSTALLED_RESTART');assert.equal(vc.installCode(1641),'VCRUNTIME_INSTALLED_RESTART');
  assert.equal(vc.installCode(1638),'VCRUNTIME_NEWER_PRESENT');
  assert.equal(vc.installCode(1602),'VCRUNTIME_INSTALL_CANCELLED');assert.equal(vc.installCode(1223),'VCRUNTIME_INSTALL_CANCELLED');
  for(const other of [1,1603,740,-1,null])assert.equal(vc.installCode(other),'VCRUNTIME_INSTALL_FAILED',String(other));
  for(const c of ['VCRUNTIME_INSTALLED','VCRUNTIME_INSTALLED_RESTART','VCRUNTIME_NEWER_PRESENT','VCRUNTIME_INSTALL_CANCELLED','VCRUNTIME_INSTALL_FAILED'])assert.ok(vc.INSTALL_CODES.includes(c));
});

// Setup with a stand-in system folder that the stand-in installer fills.
function setupWith(t,{files=all(),answer,exitCode=0,fills=true,installer=true}={}){
  const state={files:{...files},asked:0,ran:[],notices:[]};
  const sys=system(state.files);
  return{state,options:{...sys,appRoot:path.join(path.sep,'bundle','app'),
    ask:async()=>{state.asked++;return answer;},
    installerStat:async file=>{if(!installer)throw Object.assign(Error('missing'),{code:'ENOENT'});return{isFile:()=>true,file};},
    runInstaller:async file=>{state.ran.push(file);if(fills)Object.assign(state.files,all());return{exitCode};},
    notice:line=>state.notices.push(line)}};
}

test('Setup: present asks nothing and runs nothing',async t=>{
  const {state,options}=setupWith(t,{answer:true});
  assert.deepEqual(await vc.vcRuntimeSetup(options),{check:'VCRUNTIME_PRESENT',probe:'read',install:'not-needed',after:null});
  assert.equal(state.asked,0);assert.deepEqual(state.ran,[]);assert.deepEqual(state.notices,[]);
});

test('Setup: missing runs the bundled installer only on Y, and checks again',async t=>{
  const files=all();delete files[dllPath('vcruntime140_1.dll')];
  const {state,options}=setupWith(t,{files,answer:true});
  assert.deepEqual(await vc.vcRuntimeSetup(options),{check:'VCRUNTIME_MISSING',probe:'read',install:'VCRUNTIME_INSTALLED',after:{check:'VCRUNTIME_PRESENT',probe:'read'}});
  assert.equal(state.asked,1);assert.deepEqual(state.ran,[path.join(path.sep,'bundle','runtime','vcredist','VC_redist.x64.exe')]);assert.deepEqual(state.notices,[]);
  // Older: the same offer.
  const old=setupWith(t,{files:all(pe(0x8664,'14.29.30133.0')),answer:true});
  assert.equal((await vc.vcRuntimeSetup(old.options)).install,'VCRUNTIME_INSTALLED');assert.equal(old.state.ran.length,1);
});

test('Setup: N, no answer or a non-interactive run installs nothing and prints the next step',async t=>{
  const files=all();delete files[dllPath('msvcp140.dll')];
  for(const [answer,install] of [[false,'declined'],[null,'not-asked'],[undefined,'not-asked'],['Y','not-asked']]){
    const {state,options}=setupWith(t,{files,answer});
    assert.deepEqual(await vc.vcRuntimeSetup(options),{check:'VCRUNTIME_MISSING',probe:'read',install,after:null},String(answer));
    assert.deepEqual(state.ran,[]);assert.deepEqual(state.notices,[vc.NEXT_STEP]);
  }
  const {state,options}=setupWith(t,{files});options.ask=async()=>{throw Error('console gone');};
  assert.equal((await vc.vcRuntimeSetup(options)).install,'not-asked');assert.deepEqual(state.ran,[]);
});

test('Setup: a missing installer, a cancelled or failed install, and a restart are reported',async t=>{
  const files=all();delete files[dllPath('msvcp140.dll')];
  let r=setupWith(t,{files,answer:true,installer:false});
  assert.deepEqual(await vc.vcRuntimeSetup(r.options),{check:'VCRUNTIME_MISSING',probe:'read',install:'VCRUNTIME_INSTALLER_MISSING',after:null});
  assert.deepEqual(r.state.ran,[]);assert.deepEqual(r.state.notices,[vc.NEXT_STEP]);
  r=setupWith(t,{files,answer:true,exitCode:1602,fills:false});
  assert.deepEqual(await vc.vcRuntimeSetup(r.options),{check:'VCRUNTIME_MISSING',probe:'read',install:'VCRUNTIME_INSTALL_CANCELLED',after:{check:'VCRUNTIME_MISSING',probe:'read'}});
  assert.deepEqual(r.state.notices,[vc.NEXT_STEP]);
  r=setupWith(t,{files,answer:true,exitCode:1603,fills:false});
  assert.equal((await vc.vcRuntimeSetup(r.options)).install,'VCRUNTIME_INSTALL_FAILED');
  r=setupWith(t,{files,answer:true,exitCode:3010,fills:false});
  assert.equal((await vc.vcRuntimeSetup(r.options)).install,'VCRUNTIME_INSTALLED_RESTART');assert.deepEqual(r.state.notices,[vc.RESTART_STEP]);
  r=setupWith(t,{files,answer:true});r.options.runInstaller=async()=>{throw Error('spawn failed');};
  assert.equal((await vc.vcRuntimeSetup(r.options)).install,'VCRUNTIME_INSTALL_FAILED');
});

test('Setup: unknown or not Windows asks nothing',async t=>{
  const {state,options}=setupWith(t,{files:all(pe(0x14c)),answer:true});
  assert.deepEqual(await vc.vcRuntimeSetup(options),{check:'VCRUNTIME_UNKNOWN',probe:'failed',install:'not-checked',after:null});
  assert.equal(state.asked,0);assert.deepEqual(state.ran,[]);
  assert.deepEqual(await vc.vcRuntimeSetup({appRoot:path.join(path.sep,'bundle','app'),platform:'linux',ask:async()=>assert.fail('asked')}),
    {check:'VCRUNTIME_UNKNOWN',probe:'not-windows',install:'not-checked',after:null});
});

test('the question is asked only on a terminal; only Y or y is yes',async()=>{
  const tty=s=>Object.assign(s,{isTTY:true});
  assert.equal(await vc.defaultAsk({input:new PassThrough(),output:tty(new PassThrough())}),null,'input not a terminal');
  assert.equal(await vc.defaultAsk({input:tty(new PassThrough()),output:new PassThrough()}),null,'output not a terminal');
  for(const [typed,yes] of [['Y\n',true],['y\r\n',true],[' y \n',true],['N\n',false],['yes\n',false],['\n',false],['',false]]){
    const input=tty(new PassThrough()),output=tty(new PassThrough());let shown='';output.on('data',c=>shown+=c);
    const asked=vc.defaultAsk({input,output});
    if(typed)input.write(typed);input.end();
    assert.equal(await asked,yes,JSON.stringify(typed));assert.equal(shown,vc.PROMPT);
  }
  const input=tty(new PassThrough());
  assert.equal(await vc.defaultAsk({input,output:tty(new PassThrough()),timeoutMs:20}),false,'no answer in time is no');
});

test('Setup and Diagnose print vcRuntime; Diagnose never asks; --pin-offline never asks',async t=>{
  const setup=require('../scripts/piraiders-setup.cjs'),diagnose=require('../scripts/piraiders-diagnose.cjs');
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders vc '));t.after(()=>fs.rm(parent,{recursive:true,force:true}));
  const file=path.join(parent,'machine.json');
  await fs.writeFile(file,JSON.stringify({schemaVersion:1,spxConfigFile:'config.json',catalogDirectory:path.join(parent,'catalog'),mediaRoot:path.join(parent,'media'),
    cacheRoot:path.join(parent,'cache'),runtimeRoot:path.join(parent,'runtime'),caspar:{executable:path.join(parent,'casparcg.exe'),cwd:parent},output:{type:'none'},
    rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}}}));
  for(const d of ['catalog','media','cache','runtime'])await fs.mkdir(path.join(parent,d));
  const files=all();delete files[dllPath('msvcp140.dll')];
  let asked=0,ran=0;
  const vcRuntime={...system(files),ask:async()=>{asked++;return true;},installerStat:async()=>({isFile:()=>true}),runInstaller:async()=>{ran++;return{exitCode:1602};},notice:()=>{}};
  const options={appRoot:root,nodeExecutable:process.execPath,graphicsCheck:{platform:'linux'},vcRuntime};
  const d=await diagnose.main(['--machine',file],options);
  assert.deepEqual(d.answer.vcRuntime,{check:'VCRUNTIME_MISSING',probe:'read'});assert.equal(asked,0);assert.equal(ran,0);
  const s=await setup.main(['--machine',file],options);
  assert.equal(s.answer.code,'SETUP_MACHINE_NOT_SOURCE','local mode: the store steps refuse, the runtime is still checked');
  assert.deepEqual(s.answer.vcRuntime,{check:'VCRUNTIME_MISSING',probe:'read',install:'VCRUNTIME_INSTALL_CANCELLED',after:{check:'VCRUNTIME_MISSING',probe:'read'}});
  assert.equal(asked,1);assert.equal(ran,1);
  const p=await setup.main(['--machine',file,'--pin-offline'],options);
  assert.deepEqual(p.answer.vcRuntime,{check:'VCRUNTIME_MISSING',probe:'read',install:'not-asked',after:null});assert.equal(asked,1);assert.equal(ran,1);
  // Fixed codes only: no path or version number printed.
  for(const a of [d.answer,s.answer,p.answer]){const text=JSON.stringify(a.vcRuntime);assert.doesNotMatch(text,/System32|Windows|\\\\|14\.\d/);}
});

test('on Windows: the real System32 files of this PC are read (hosted runners have the runtime)',{skip:process.platform!=='win32'&&'Windows only'},async()=>{
  const answer=await vc.checkVcRuntime();
  assert.equal(answer.probe,'read',JSON.stringify(answer));
  assert.ok(['VCRUNTIME_PRESENT','VCRUNTIME_OLD'].includes(answer.check),JSON.stringify(answer));
});
