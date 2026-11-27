#!/usr/bin/env node
'use strict';
// BE-006 item 5f part 3: on hosted Windows, the CI-built ZIP extracted under
// a path with spaces, Unicode and `!`, then its real root entries
// Setup-PiRaiders.cmd (twice, then a wrong argument) and
// Diagnose-PiRaiders.cmd in source mode over a synthetic exchange folder,
// with Verify-PiRaiders.cmd before and after (Q-013)
// (steps in scripts/bundle-entries-proof.cjs). The entries run with the
// bundled Node only: no Node, NODE_PATH, NODE_OPTIONS or npm on the path.
//
//   node scripts/smoke-windows-entries.cjs <zip> <evidence folder>
//
// Writes <evidence>/windows-bundle-entries.json (fixed words and codes only)
// and audits the folder with the evidence privacy check before the upload.
// CI evidence only: no stadium PC, Caspar, NDI or board is involved.
const fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {execFileSync,execFile}=require('node:child_process');
const {verifyManifest}=require('./lib/windows-bundle.cjs');
const {proveBundleEntries}=require('./bundle-entries-proof.cjs');
const {auditEvidence,removeViolations}=require('./proof-evidence-privacy.cjs');

const ENTRIES=new Set(['Setup-PiRaiders.cmd','Diagnose-PiRaiders.cmd','Verify-PiRaiders.cmd']);
const ARGUMENT=/^--[a-z-]{1,32}$/;

// The environment the entries get: the system folders only on the path.
function plainEnvironment(){
  const env={...process.env};
  for(const key of Object.keys(env))if(/^path$/i.test(key)||/^node_(?:options|path)$/i.test(key)||/^npm_/i.test(key))delete env[key];
  env.Path=[path.join(process.env.SystemRoot,'System32'),process.env.SystemRoot].join(';');
  return env;
}
// Runs one root entry through PowerShell; its path and argument enter only
// as environment data, never as script text.
function entryRunner(root,powershell,cwd){
  const base=plainEnvironment();
  return(name,args)=>new Promise((resolve,reject)=>{
    if(!ENTRIES.has(name)||!Array.isArray(args)||args.length>1||args.some(a=>!ARGUMENT.test(a)))return reject(Object.assign(Error('ENTRY_CALL_INVALID'),{code:'ENTRY_CALL_INVALID'}));
    const env={...base,PIRAIDERS_ENTRY:path.join(root,name),PIRAIDERS_ENTRY_ARG:args[0]||''};
    const command=args.length?'& $env:PIRAIDERS_ENTRY $env:PIRAIDERS_ENTRY_ARG; exit $LASTEXITCODE':'& $env:PIRAIDERS_ENTRY; exit $LASTEXITCODE';
    execFile(powershell,['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{cwd,env,windowsHide:true,shell:false,timeout:120000,maxBuffer:65536,encoding:'utf8'},(error,stdout)=>{
      if(error&&(error.killed||typeof error.code!=='number'))return reject(Object.assign(Error('ENTRY_FAILED'),{code:'ENTRY_FAILED'}));
      resolve({exitCode:error?error.code:0,stdout});
    });
  });
}

async function smokeWindowsEntries(archive,evidence){
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('Windows x64 is required for the bundle entries proof');
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'PiRaiders entries 鷹 ! ')),extraction=path.join(work,'Extracted package');
  const root=path.join(extraction,'PiRaiders-Development'),proofWork=path.join(work,'proof work');
  const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  try{
    fs.mkdirSync(extraction);fs.mkdirSync(proofWork);
    execFileSync(powershell,['-NoLogo','-NoProfile','-NonInteractive','-Command',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:PIRAIDERS_SMOKE_ARCHIVE, $env:PIRAIDERS_SMOKE_EXTRACT)'],{
      env:{...process.env,PIRAIDERS_SMOKE_ARCHIVE:path.resolve(archive),PIRAIDERS_SMOKE_EXTRACT:extraction},stdio:'inherit',windowsHide:true,timeout:900000});
    const manifest=verifyManifest(root);
    const result=await proveBundleEntries({root,work:proofWork,runEntry:entryRunner(root,powershell,work),graphicsRanRequired:true});
    const record={...result,sourceCommit:/^[0-9a-f]{40}$/.test(manifest.commitSHA)?manifest.commitSHA:null,manifestVerified:true,
      pathSpacesUnicodeBang:true,bundledNodeOnly:true,claims:'hosted Windows CI only; no stadium PC, Caspar, NDI or board'};
    await fsp.mkdir(evidence,{recursive:true});
    await fsp.writeFile(path.join(evidence,'windows-bundle-entries.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
    const privatePaths=[work,extraction,root,proofWork,path.join(proofWork,'proof','exchange'),path.join(root,'app')];
    for(const p of [...privatePaths])try{const real=fs.realpathSync.native(p);if(!privatePaths.includes(real))privatePaths.push(real);}catch{}
    const audit=await auditEvidence(evidence,privatePaths);
    if(audit.violations.length){await removeViolations(evidence,audit.violations);throw Object.assign(Error('EVIDENCE_NOT_PRIVATE'),{code:'EVIDENCE_NOT_PRIVATE',violations:audit.violations});}
    console.log(JSON.stringify(record));
    return record;
  }finally{fs.rmSync(work,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}

if(require.main===module){
  const [archive='build/windows/PiRaiders-Development-win-x64.zip',evidence='build/windows-entries-evidence']=process.argv.slice(2);
  smokeWindowsEntries(path.resolve(archive),path.resolve(evidence)).catch(error=>{
    // Codes and the fixed fields only; never a message that could hold a path.
    const fixed=typeof error.code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)?error.code:'UNEXPECTED',kind=typeof error.name==='string'&&/^[A-Za-z]{1,32}$/.test(error.name)?error.name:null;
    console.error(JSON.stringify({event:'windows-bundle-entries-proof-failed',code:fixed,kind,answerCode:error.answerCode??null,exitCode:Number.isInteger(error.exitCode)?error.exitCode:null,
      state:typeof error.state==='string'?error.state:null,fixed:error.fixed??null,violations:error.violations??null}));
    process.exitCode=1;
  });
}
module.exports={smokeWindowsEntries,plainEnvironment};
