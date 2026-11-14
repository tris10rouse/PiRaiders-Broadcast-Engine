#!/usr/bin/env node
'use strict';
// Required SDK runtime on a disposable Windows CI runner only. Never installs
// NDI Tools, edits firewall rules, publishes binaries or configures a stadium PC.
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {download}=require('./prepare-caspar-proof.cjs');
const PIN=Object.freeze({name:'ndi-runtime',url:'https://downloads.ndi.tv/SDK/NDI_SDK/NDI%206%20Runtime.exe',sha256:'7ee73eedb56402bca5100868353dbab4e944b6c37d2d9881580698a3b61346cd',maxBytes:150*1024*1024});
function peMachine(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<64||bytes.toString('ascii',0,2)!=='MZ')throw Error('RUNTIME_PE_INVALID');
  const offset=bytes.readUInt32LE(60);
  if(offset<64||offset>bytes.length-6||bytes.readUInt32LE(offset)!==0x00004550)throw Error('RUNTIME_PE_INVALID');
  return bytes.readUInt16LE(offset+4);
}
async function filesUnder(dir){const all=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())all.push(...await filesUnder(file));else if(e.isFile())all.push(file);}return all;}
function windowsMetadata(file){
  // Use the runner's installed PowerShell7 consistently with its module path.
  // Pass paths as process arguments, never interpolate them into PowerShell.
  const script=path.join(__dirname,'ndi-proof-metadata.ps1');
  return JSON.parse(execFileSync('pwsh.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,file],{encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:65536}));
}
async function main(){
  if(process.platform!=='win32')throw Error('WINDOWS_REQUIRED');
  const root=path.resolve(process.argv[2]||path.join('build','caspar-proof-tools'));
  // prepare-caspar-proof creates/cleans this private directory first.
  await fs.access(path.join(root,'tools.json'));
  const installer=path.join(root,'NDI-Runtime-pinned.exe');
  const installerProvenance=await download(PIN,installer),signature=windowsMetadata(installer);
  if(signature.signatureStatus!=='Valid'||typeof signature.signer!=='string'||!signature.signer)throw Error('RUNTIME_SIGNATURE_INVALID');
  // The exact trusted SHA is the primary publisher pin. Record the observed
  // valid certificate instead of guessing it from a package display name.
  console.log(JSON.stringify({event:'ndi-installer-verified',...installerProvenance,signature}));
  const installRoot=path.join(root,'ndi-runtime');
  try{execFileSync(installer,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/DIR='+installRoot],{stdio:'ignore',windowsHide:true,timeout:120000});}
  catch(error){console.error(JSON.stringify({event:'ndi-runtime-install-failed',exitCode:Number.isInteger(error.status)?error.status:null}));throw Error('RUNTIME_INSTALL_FAILED');}
  const files=await filesUnder(installRoot),candidates=files.filter(file=>path.basename(file).toLowerCase()==='processing.ndi.lib.x64.dll');
  if(candidates.length!==1)throw Error('RUNTIME_LAYOUT_INVALID');
  const dll=candidates[0],stat=await fs.stat(dll);if(stat.size<64||stat.size>128*1024*1024)throw Error('RUNTIME_SIZE_INVALID');
  const bytes=await fs.readFile(dll);if(peMachine(bytes)!==0x8664)throw Error('RUNTIME_X64_REQUIRED');
  const dllMetadata=windowsMetadata(dll),sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  const provenance={installer:installerProvenance,installerSignature:signature,dll:{sha256,bytes:stat.size,...dllMetadata},notices:files.filter(file=>/licen[cs]e|notice/i.test(path.basename(file))).map(file=>path.basename(file)).sort()};
  await fs.writeFile(path.join(root,'ndi-runtime.json'),JSON.stringify({dllPath:dll,runtimeDirectory:path.dirname(dll),provenance},null,2));
  console.log(JSON.stringify({event:'ndi-runtime-prepared',provenance}));
}
if(require.main===module)main().catch(error=>{const code=/^[A-Z_]{1,64}$/.test(error.message)?error.message:'RUNTIME_PREPARATION_FAILED';console.error(code);process.exitCode=1;});
module.exports={PIN,peMachine};
