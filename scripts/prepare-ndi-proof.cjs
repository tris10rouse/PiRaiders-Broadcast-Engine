#!/usr/bin/env node
'use strict';
// Required SDK runtime on a disposable Windows CI runner only. Never installs
// NDI Tools, edits firewall rules, publishes binaries or configures a stadium PC.
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {download}=require('./prepare-caspar-proof.cjs');
const PIN=Object.freeze({name:'ndi-runtime',url:'https://downloads.ndi.tv/SDK/NDI_SDK/NDI%206%20Runtime.exe',sha256:'5972cca54649039318ff5f167fd9940270cafc09678b01e0c35695382270a144',maxBytes:150*1024*1024});
function peMachine(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<64||bytes.toString('ascii',0,2)!=='MZ')throw Error('RUNTIME_PE_INVALID');
  const offset=bytes.readUInt32LE(60);
  if(offset<64||offset>bytes.length-6||bytes.readUInt32LE(offset)!==0x00004550)throw Error('RUNTIME_PE_INVALID');
  return bytes.readUInt16LE(offset+4);
}
// Fixed schema; strings are bounded and trimmed. Never a path, URL or raw error.
function pinMismatchDiagnostic(pin,observedSha256,bytes,observed){
  const text=value=>typeof value==='string'?value.trim().slice(0,200):null;
  return{event:'ndi-installer-pin-mismatch',name:pin.name,expectedSha256:pin.sha256,
    observedSha256:/^[0-9a-f]{64}$/.test(observedSha256)?observedSha256:null,bytes:Number.isSafeInteger(bytes)&&bytes>=0?bytes:null,
    signature:observed&&typeof observed==='object'?{signatureStatus:text(observed.signatureStatus),signer:text(observed.signer),fileVersion:text(observed.fileVersion),productVersion:text(observed.productVersion),productName:text(observed.productName)}:null};
}
async function filesUnder(dir){const all=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())all.push(...await filesUnder(file));else if(e.isFile())all.push(file);}return all;}
function windowsMetadata(file){
  // Use the runner's installed PowerShell7 consistently with its module path.
  // Pass paths as process arguments, never interpolate them into PowerShell.
  const script=path.join(__dirname,'ndi-proof-metadata.ps1');
  return JSON.parse(execFileSync('pwsh.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,file],{encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:65536}));
}
const FIXED_CODE=/^[A-Z_]{1,64}$/;
// Each step that can fail answers its own fixed code (Q-028): a coded error
// passes through; anything else becomes the step's code. The system error code
// (ENOENT, EPERM, ...) is printed beside it, never a message or a path.
async function step(code,fn){
  try{return await fn();}
  catch(error){
    if(error instanceof Error&&FIXED_CODE.test(error.message))throw error;
    const errno=error&&typeof error.code==='string'&&/^E[A-Z0-9]{1,31}$/.test(error.code)?error.code:null;
    console.error(JSON.stringify({event:'ndi-runtime-step-failed',code,errno}));
    throw Error(code);
  }
}
function failureCode(error){return error instanceof Error&&FIXED_CODE.test(error.message)?error.message:'RUNTIME_PREPARATION_FAILED';}
// After the installer ran: find, check and record the SDK DLL. Testable on Linux
// with a stand-in metadata reader; main() passes the real one.
async function recordInstalledRuntime({root,installRoot,installerProvenance,signature,metadata=windowsMetadata}){
  const files=await step('RUNTIME_LISTING_FAILED',()=>filesUnder(installRoot)),candidates=files.filter(file=>path.basename(file).toLowerCase()==='processing.ndi.lib.x64.dll');
  if(candidates.length!==1)throw Error('RUNTIME_LAYOUT_INVALID');
  const dll=candidates[0],stat=await step('RUNTIME_DLL_STAT_FAILED',()=>fs.stat(dll));if(stat.size<64||stat.size>128*1024*1024)throw Error('RUNTIME_SIZE_INVALID');
  const bytes=await step('RUNTIME_DLL_READ_FAILED',()=>fs.readFile(dll));if(peMachine(bytes)!==0x8664)throw Error('RUNTIME_X64_REQUIRED');
  const dllMetadata=await step('RUNTIME_DLL_METADATA_FAILED',()=>metadata(dll)),sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  const provenance={installer:installerProvenance,installerSignature:signature,dll:{sha256,bytes:stat.size,...dllMetadata},notices:files.filter(file=>/licen[cs]e|notice/i.test(path.basename(file))).map(file=>path.basename(file)).sort()};
  await step('RUNTIME_RECORD_WRITE_FAILED',()=>fs.writeFile(path.join(root,'ndi-runtime.json'),JSON.stringify({dllPath:dll,runtimeDirectory:path.dirname(dll),provenance},null,2)));
  return provenance;
}
async function main(){
  if(process.platform!=='win32')throw Error('WINDOWS_REQUIRED');
  const root=path.resolve(process.argv[2]||path.join('build','caspar-proof-tools'));
  // prepare-caspar-proof creates/cleans this private directory first.
  await step('TOOLS_MANIFEST_MISSING',()=>fs.access(path.join(root,'tools.json')));
  const installer=path.join(root,'NDI-Runtime-pinned.exe');
  // A vendor can replace the file behind this unversioned URL. The pin still
  // refuses it; record what was actually served (digest, length, signature and
  // version fields only) so a re-pin can be reviewed against independent evidence.
  let mismatch=null;
  const installerProvenance=await step('RUNTIME_DOWNLOAD_FAILED',()=>download(PIN,installer,{onMismatch:({file,observedSha256,bytes})=>{
    let observed=null;try{observed=windowsMetadata(file);}catch{}
    mismatch=pinMismatchDiagnostic(PIN,observedSha256,bytes,observed);
  }}).catch(error=>{if(mismatch)console.error(JSON.stringify(mismatch));throw error;}));
  const signature=await step('RUNTIME_SIGNATURE_READ_FAILED',()=>windowsMetadata(installer));
  if(signature.signatureStatus!=='Valid'||typeof signature.signer!=='string'||!signature.signer)throw Error('RUNTIME_SIGNATURE_INVALID');
  // The exact trusted SHA is the primary publisher pin. Record the observed
  // valid certificate instead of guessing it from a package display name.
  console.log(JSON.stringify({event:'ndi-installer-verified',...installerProvenance,signature}));
  const installRoot=path.join(root,'ndi-runtime');
  try{execFileSync(installer,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/DIR='+installRoot],{stdio:'ignore',windowsHide:true,timeout:120000});}
  catch(error){console.error(JSON.stringify({event:'ndi-runtime-install-failed',exitCode:Number.isInteger(error.status)?error.status:null}));throw Error('RUNTIME_INSTALL_FAILED');}
  const provenance=await recordInstalledRuntime({root,installRoot,installerProvenance,signature});
  console.log(JSON.stringify({event:'ndi-runtime-prepared',provenance}));
}
if(require.main===module)main().catch(error=>{console.error(failureCode(error));process.exitCode=1;});
module.exports={PIN,peMachine,pinMismatchDiagnostic,step,failureCode,recordInstalledRuntime};
