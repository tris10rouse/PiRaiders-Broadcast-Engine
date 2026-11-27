#!/usr/bin/env node
'use strict';
// Q-033 (part of Q-024): on hosted Windows, the CI-built ZIP extracted under
// a path with spaces, Unicode and `!`, then its real root entry
// Test-PiRaiders.cmd: once with a wrong argument (exit 2), then twice
// without, each run required to print PASS (steps and checks in
// scripts/bench-cmd-proof.cjs). The entry runs with the bundled Node only:
// no Node, NODE_PATH, NODE_OPTIONS or npm on the path.
//
//   node scripts/smoke-windows-bench.cjs <zip> <evidence folder>
//
// Writes <evidence>/windows-bench-test.json (fixed words, codes and timings)
// and the last run's bench-summary.txt (fixed codes, counts and timings by
// construction), and audits the folder with the evidence privacy check
// before the upload. A failed run keeps its summary too. Hosted Windows CI
// evidence only: the bench test runs the ZIP's own app, CasparCG and NDI
// sender with demo data; nothing receives the NDI picture, and no stadium
// PC, board or on-air claim follows.
const fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {verifyManifest}=require('./lib/windows-bundle.cjs');
const {entryRunner}=require('./smoke-windows-entries.cjs');
const {proveBenchCommand}=require('./bench-cmd-proof.cjs');
const {auditEvidence,removeViolations}=require('./proof-evidence-privacy.cjs');

// One run's bound: the bench's own bounds (app start 60 s, renderer 120 s,
// slides, close) plus Verify, Setup and Diagnose, with a margin.
const RUN_TIMEOUT_MS=600000;

async function smokeWindowsBench(archive,evidence){
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('Windows x64 is required for the bench test proof');
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'PiRaiders bench 鷹 ! ')),extraction=path.join(work,'Extracted package');
  const root=path.join(extraction,'PiRaiders-Development');
  const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  await fsp.mkdir(evidence,{recursive:true});
  try{
    fs.mkdirSync(extraction);
    execFileSync(powershell,['-NoLogo','-NoProfile','-NonInteractive','-Command',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:PIRAIDERS_SMOKE_ARCHIVE, $env:PIRAIDERS_SMOKE_EXTRACT)'],{
      env:{...process.env,PIRAIDERS_SMOKE_ARCHIVE:path.resolve(archive),PIRAIDERS_SMOKE_EXTRACT:extraction},stdio:'inherit',windowsHide:true,timeout:900000});
    const manifest=verifyManifest(root);
    let record,failure=null;
    try{record=await proveBenchCommand({root,runEntry:entryRunner(root,powershell,work,{timeoutMs:RUN_TIMEOUT_MS})});}
    catch(error){failure=error;}
    // The summary the operator would send back, kept as evidence (pass or fail).
    try{await fsp.copyFile(path.join(root,'app','bench-test','bench-summary.txt'),path.join(evidence,'bench-summary.txt'));}catch{}
    if(!failure){
      record={...record,sourceCommit:/^[0-9a-f]{40}$/.test(manifest.commitSHA)?manifest.commitSHA:null,manifestVerified:true,
        pathSpacesUnicodeBang:true,bundledNodeOnly:true,claims:'hosted Windows CI only; demo data; no stadium PC, board, receiver or on-air claim'};
      await fsp.writeFile(path.join(evidence,'windows-bench-test.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
    }
    const privatePaths=[work,extraction,root,path.join(root,'app'),path.join(root,'app','bench-test')];
    for(const p of [...privatePaths])try{const real=fs.realpathSync.native(p);if(!privatePaths.includes(real))privatePaths.push(real);}catch{}
    const audit=await auditEvidence(evidence,privatePaths);
    if(audit.violations.length){await removeViolations(evidence,audit.violations);throw Object.assign(Error('EVIDENCE_NOT_PRIVATE'),{code:'EVIDENCE_NOT_PRIVATE',violations:audit.violations});}
    // The summary is fixed codes, counts and timings, audited above: shown in the log.
    try{process.stdout.write(await fsp.readFile(path.join(evidence,'bench-summary.txt'),'utf8'));}catch{}
    if(failure)throw failure;
    console.log(JSON.stringify(record));
    return record;
  }finally{fs.rmSync(work,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}

if(require.main===module){
  const [archive='build/windows/PiRaiders-Development-win-x64.zip',evidence='build/windows-bench-evidence']=process.argv.slice(2);
  smokeWindowsBench(path.resolve(archive),path.resolve(evidence)).catch(error=>{
    // Codes and the fixed fields only; never a message that could hold a path.
    const fixed=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(v)?v:null;
    console.error(JSON.stringify({event:'windows-bench-test-proof-failed',code:fixed(error.code)||'UNEXPECTED',failedStep:fixed(error.failedStep),failedCode:fixed(error.failedCode),
      exitCode:Number.isInteger(error.exitCode)?error.exitCode:null,stepIndex:Number.isInteger(error.stepIndex)?error.stepIndex:null,
      stepCount:Number.isInteger(error.stepCount)?error.stepCount:null,violations:error.violations??null}));
    process.exitCode=1;
  });
}
module.exports={smokeWindowsBench};
