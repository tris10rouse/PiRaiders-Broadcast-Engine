#!/usr/bin/env node
'use strict';
// Disposable CI tools only. No runtime installer, driver or release publication.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const PINS = Object.freeze([
  {name:'caspar',url:'https://github.com/CasparCG/server/releases/download/v2.5.1-stable/casparcg-server-v2.5.1-windows.zip',sha256:'c0756f53f49908fba94f17a43b83d45fd275201e24ab1676530d7bb26832efc6',maxBytes:350000000,extension:'zip'},
  {name:'mesa',url:'https://github.com/pal1000/mesa-dist-win/releases/download/26.2.6/mesa3d-26.2.6-release-mingw.7z',sha256:'da0f71d9181b672c1918f3c342f11118c687f6059a46b16502845160733cc388',maxBytes:500000000,extension:'7z'}
]);
// onMismatch is diagnostics only: it sees the rejected bytes (still in the
// temporary file) with their observed digest and length BEFORE they are removed.
// It can never turn a mismatch into success; its own failure is discarded.
async function download(pin, destination, {fetchImpl=fetch, timeoutMs=180000, onMismatch=null}={}) {
  const temporary=destination+'.partial';
  let handle;
  try {
    // Re-download rather than trusting a stale local tool cache.
    const response=await fetchImpl(pin.url,{signal:AbortSignal.timeout(timeoutMs)});
    if(!response.ok || !response.body) throw Error('DOWNLOAD_FAILED');
    const hash=crypto.createHash('sha256');let bytes=0;
    handle=await fs.open(temporary,'wx');
    for await(const chunk of response.body){
      bytes+=chunk.length;if(bytes>pin.maxBytes)throw Error('DOWNLOAD_LIMIT');
      hash.update(chunk);await handle.writeFile(chunk);
    }
    const observedSha256=hash.digest('hex');
    if(observedSha256!==pin.sha256){
      if(typeof onMismatch==='function'){
        await handle.close();handle=null;
        try{await onMismatch(Object.freeze({file:temporary,observedSha256,bytes}));}catch{}
      }
      throw Error('DOWNLOAD_HASH');
    }
    await handle.close();handle=null;await fs.rename(temporary,destination);
    return {name:pin.name,sha256:pin.sha256,bytes};
  } finally {await handle?.close();await fs.rm(temporary,{force:true});}
}
async function walk(dir){const items=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())items.push(...await walk(file));else if(e.isFile())items.push(file);}return items;}
function preparationDiagnostic(error,phase,tool){
  const code=/^(?:DOWNLOAD_(?:FAILED|LIMIT|HASH)|CASPAR_LAYOUT|MESA_(?:LAYOUT|COLLISION)|WINDOWS_REQUIRED)$/.test(error?.message)?error.message:'TOOL_PREPARATION_FAILED';
  const systemCode=value=>['ETIMEDOUT','ENOENT','EACCES','EPERM','ENOSPC','EEXIST','ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET'].includes(value)?value:null;
  return{event:'caspar-proof-preparation-failed',phase:['PLATFORM','ROOT','DOWNLOAD','EXTRACT','CASPAR_LAYOUT','MESA_LAYOUT','MESA_COPY','MANIFEST'].includes(phase)?phase:'UNKNOWN',tool:['caspar','mesa'].includes(tool)?tool:null,code,systemErrorCode:systemCode(error?.code),causeCode:systemCode(error?.cause?.code),timedOut:error?.name==='TimeoutError'||error?.name==='AbortError'};
}
let preparationPhase='PLATFORM',preparationTool=null;
async function main(){
  if(process.platform!=='win32')throw Error('WINDOWS_REQUIRED');
  const root=path.resolve(process.argv[2]||path.join('build','caspar-proof-tools'));
  preparationPhase='ROOT';
  await fs.rm(root,{recursive:true,force:true,maxRetries:5});await fs.mkdir(root,{recursive:true});
  const provenance=[];
  const sevenZip=path.join(process.env.ProgramFiles||'C:\\Program Files','7-Zip','7z.exe');
  for(const pin of PINS){
    preparationTool=pin.name;preparationPhase='DOWNLOAD';
    const archive=path.join(root,pin.name+'.'+pin.extension);provenance.push(await download(pin,archive));
    preparationPhase='EXTRACT';
    const output=path.join(root,pin.name);await fs.mkdir(output);
    execFileSync(sevenZip,['x','-y','-o'+output,archive],{stdio:'ignore',timeout:180000,windowsHide:true});
  }
  preparationTool='caspar';preparationPhase='CASPAR_LAYOUT';
  const casparFiles=await walk(path.join(root,'caspar'));
  const executables=casparFiles.filter(file=>path.basename(file).toLowerCase()==='casparcg.exe');
  if(executables.length!==1)throw Error('CASPAR_LAYOUT');
  const bin=path.dirname(executables[0]);
  preparationTool='mesa';preparationPhase='MESA_LAYOUT';
  const mesaFiles=await walk(path.join(root,'mesa'));
  const gl=mesaFiles.filter(file=>path.basename(file).toLowerCase()==='opengl32.dll'&&/[\\/]x64[\\/]/i.test(file));
  if(gl.length!==1)throw Error('MESA_LAYOUT');
  const mesaDir=path.dirname(gl[0]);
  preparationPhase='MESA_COPY';
  for(const file of await fs.readdir(mesaDir)){
    // App-local WGL only; never overwrite Caspar's CEF EGL/GLES/DXIL libraries.
    if(!/\.dll$/i.test(file)||/^(?:libEGL|libGLESv2|dxil|vulkan.*)\.dll$/i.test(file))continue;
    const target=path.join(bin,file);
    try{await fs.access(target);if(file.toLowerCase()!=='opengl32.dll')throw Error('MESA_COLLISION');}catch(e){if(e.code!=='ENOENT')throw e;}
    await fs.copyFile(path.join(mesaDir,file),target);
  }
  preparationTool=null;preparationPhase='MANIFEST';
  await fs.writeFile(path.join(root,'tools.json'),JSON.stringify({casparDirectory:bin,provenance},null,2));
  console.log(JSON.stringify({event:'caspar-proof-tools-verified',provenance}));
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify(preparationDiagnostic(error,preparationPhase,preparationTool)));process.exitCode=1;});
module.exports={PINS,download,preparationDiagnostic};
