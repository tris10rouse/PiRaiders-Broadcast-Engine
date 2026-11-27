'use strict';
// Q-027 (part 2 of Q-023): whether this PC has the Microsoft x64 VC++ runtime
// the bundled Caspar imports, and Setup's offer to run the bundled installer.
// The check reads the three runtime DLLs in Windows' own System32 folder
// (the 64-bit one: the bundled Node is x64) as files: each must be a regular
// x64 PE whose version resource is at least the bundled installer's version.
// Nothing is loaded or run to check. Answers are fixed codes only; no path,
// version number or file name is ever printed.
//
// Setup (never Diagnose) offers the installer when the runtime is missing or
// older: it asks "Install the Microsoft Visual C++ Runtime now? (Y/N)" on an
// interactive console and runs runtime/vcredist/VC_redist.x64.exe only on Y.
// Microsoft's installer then shows its own licence terms and Windows asks for
// an administrator. N, no answer or a non-interactive run installs nothing.
// Nothing is downloaded. Design: docs/design/BUNDLED_RUNTIME.md › VC++ runtime.
const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const {VC_RUNTIME_DLLS,peInfo}=require('./pe-imports.cjs');
const {COMPONENTS}=require('./bundled-components.cjs');

// The bundled installer's version (bundled-components.cjs, id vc-redist).
const BUNDLED_VERSION=Object.freeze(COMPONENTS.find(item=>item.id==='vc-redist').version.split('.').map(Number));
const CHECK_CODES=Object.freeze(['VCRUNTIME_PRESENT','VCRUNTIME_OLD','VCRUNTIME_MISSING','VCRUNTIME_UNKNOWN']);
const INSTALL_CODES=Object.freeze(['VCRUNTIME_INSTALLED','VCRUNTIME_INSTALLED_RESTART','VCRUNTIME_NEWER_PRESENT','VCRUNTIME_INSTALL_CANCELLED',
  'VCRUNTIME_INSTALL_FAILED','VCRUNTIME_INSTALLER_MISSING']);
const PROMPT='Install the Microsoft Visual C++ Runtime now? (Y/N) ';
const NEXT_STEP='VCRUNTIME_MISSING: CasparCG needs the Microsoft Visual C++ Runtime. Run Setup-PiRaiders.cmd again and answer Y (Windows asks for an administrator).';
const RESTART_STEP='VCRUNTIME_INSTALLED_RESTART: restart Windows, then run Setup-PiRaiders.cmd again.';
const ANSWER_TIMEOUT_MS=5*60*1000,INSTALL_TIMEOUT_MS=30*60*1000,DLL_MAX_BYTES=16*1024*1024;
const X64=0x8664;
function fail(code){throw Object.assign(Error(code),{code});}

// The installer's place, beside app/ in the extracted ZIP.
function installerPath(appRoot){
  if(typeof appRoot!=='string'||!path.isAbsolute(appRoot))fail('VCRUNTIME_OPTIONS_INVALID');
  return path.join(path.dirname(path.resolve(appRoot)),'runtime','vcredist','VC_redist.x64.exe');
}
function atLeast(version,minimum){
  const parts=String(version).split('.').map(Number);
  for(let i=0;i<minimum.length;i++){if(parts[i]>minimum[i])return true;if(parts[i]<minimum[i])return false;}
  return true;
}

// {check, probe}: probe is 'read' (the files were read), 'not-windows' or
// 'failed' (no usable system folder, or a file that could not be read).
async function checkVcRuntime({platform=process.platform,systemRoot=process.env.SystemRoot,lstat=fs.lstat,readFile=fs.readFile}={}){
  const answer=(check,probe)=>Object.freeze({check,probe});
  if(platform!=='win32')return answer('VCRUNTIME_UNKNOWN','not-windows');
  if(typeof systemRoot!=='string'||!path.win32.isAbsolute(systemRoot)||!/^[A-Za-z]:\\/.test(systemRoot))return answer('VCRUNTIME_UNKNOWN','failed');
  let old=false;
  for(const dll of VC_RUNTIME_DLLS){
    const file=path.win32.join(systemRoot,'System32',dll);
    let info;
    try{info=await lstat(file);}catch(error){if(error&&error.code==='ENOENT')return answer('VCRUNTIME_MISSING','read');return answer('VCRUNTIME_UNKNOWN','failed');}
    if(!info.isFile())return answer('VCRUNTIME_MISSING','read');
    if(info.size>DLL_MAX_BYTES)return answer('VCRUNTIME_UNKNOWN','failed');
    let pe;
    try{pe=peInfo(await readFile(file));}catch{return answer('VCRUNTIME_UNKNOWN','failed');}
    if(pe.machine!==X64||pe.version===null)return answer('VCRUNTIME_UNKNOWN','failed');
    if(!atLeast(pe.version,BUNDLED_VERSION))old=true;
  }
  return answer(old?'VCRUNTIME_OLD':'VCRUNTIME_PRESENT','read');
}

// One Y/N question on the console; anything but Y (or y), end of input or the
// deadline is no. Only asked when both the input and the console are terminals.
function defaultAsk({input=process.stdin,output=process.stderr,timeoutMs=ANSWER_TIMEOUT_MS}={}){
  if(!input.isTTY||!output.isTTY)return Promise.resolve(null);
  return new Promise(resolve=>{
    const rl=require('node:readline').createInterface({input,output,terminal:false});
    let done=false;
    const finish=value=>{if(done)return;done=true;clearTimeout(timer);rl.close();resolve(value);};
    const timer=setTimeout(()=>finish(false),timeoutMs);
    rl.on('line',line=>finish(/^\s*y\s*$/i.test(line)));
    rl.on('close',()=>finish(false));
    output.write(PROMPT);
  });
}

// Runs Microsoft's installer as it is (its own window and licence terms;
// Windows' administrator prompt), waits for it, answers its exit code.
function defaultRunInstaller(executable,{timeoutMs=INSTALL_TIMEOUT_MS}={}){
  return new Promise(resolve=>{
    let child;
    try{child=spawn(executable,['/install','/norestart'],{cwd:path.dirname(executable),stdio:'ignore',windowsHide:false,shell:false,timeout:timeoutMs,killSignal:'SIGKILL'});}
    catch{resolve({exitCode:null});return;}
    child.on('error',()=>resolve({exitCode:null}));
    child.on('exit',code=>resolve({exitCode:Number.isInteger(code)?code:null}));
  });
}
// Microsoft's documented installer exit codes, as fixed codes.
function installCode(exitCode){
  if(exitCode===0)return'VCRUNTIME_INSTALLED';
  if(exitCode===3010||exitCode===1641)return'VCRUNTIME_INSTALLED_RESTART';
  if(exitCode===1638)return'VCRUNTIME_NEWER_PRESENT';
  if(exitCode===1602||exitCode===1223)return'VCRUNTIME_INSTALL_CANCELLED';
  return'VCRUNTIME_INSTALL_FAILED';
}

// What Diagnose prints: {check, probe}. Reports only.
async function vcRuntimeReport(trusted={}){return checkVcRuntime(trusted);}

// What Setup prints: {check, probe, install, after}. install is
// 'not-needed' (present), 'not-checked' (unknown or not Windows),
// 'not-asked' (non-interactive), 'declined', or one INSTALL_CODES code; after
// is the check again once the installer ran, else null. notice(line) receives
// the one-line next step when nothing was installed and the runtime is missing.
async function vcRuntimeSetup({appRoot,ask=defaultAsk,runInstaller=defaultRunInstaller,notice=line=>process.stderr.write(line+'\n'),installerStat=fs.lstat,...check}={}){
  const before=await checkVcRuntime(check);
  const answer=(install,after=null)=>Object.freeze({check:before.check,probe:before.probe,install,after});
  if(before.check==='VCRUNTIME_PRESENT')return answer('not-needed');
  if(before.check==='VCRUNTIME_UNKNOWN')return answer('not-checked');
  const installer=installerPath(appRoot);
  let yes;try{yes=await ask();}catch{yes=null;}
  if(yes!==true){notice(NEXT_STEP);return answer(yes===false?'declined':'not-asked');}
  let regular=false;
  try{const info=await installerStat(installer);regular=info.isFile();}catch{regular=false;}
  if(!regular){notice(NEXT_STEP);return answer('VCRUNTIME_INSTALLER_MISSING');}
  let result;try{result=await runInstaller(installer);}catch{result={exitCode:null};}
  const install=installCode(result&&Number.isInteger(result.exitCode)?result.exitCode:null);
  const after=await checkVcRuntime(check);
  if(install==='VCRUNTIME_INSTALLED_RESTART')notice(RESTART_STEP);
  else if(after.check!=='VCRUNTIME_PRESENT')notice(NEXT_STEP);
  return answer(install,after);
}

module.exports={BUNDLED_VERSION,CHECK_CODES,INSTALL_CODES,PROMPT,NEXT_STEP,RESTART_STEP,installerPath,checkVcRuntime,installCode,vcRuntimeReport,vcRuntimeSetup,defaultAsk};
