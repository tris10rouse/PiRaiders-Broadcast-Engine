'use strict';
// Disposable proof tooling only. Application locations are selected from a
// verified extracted inventory, never from a machine/event configuration.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {verifyManifest}=require('./lib/windows-bundle.cjs');
const {findOwnedAppParent}=require('./smoke-windows-bundle.cjs');
const {treeState}=require('./windows-process-evidence.cjs');
const MANIFEST='BUILD-MANIFEST.json';
const MESA=new Set(['GALLIUM_DRIVER','LIBGL_ALWAYS_SOFTWARE','MESA_GL_VERSION_OVERRIDE']);
function hash(file){
 const digest=crypto.createHash('sha256'),handle=fs.openSync(file,'r'),buffer=Buffer.alloc(65536);
 try{for(let n;(n=fs.readSync(handle,buffer,0,buffer.length,null))>0;)digest.update(buffer.subarray(0,n));}finally{fs.closeSync(handle);}
 return digest.digest('hex');
}
function canonicalImage(file,{realpath=fs.realpathSync.native}={}){
 try{const resolved=realpath(file);if(typeof resolved!=='string'||!path.win32.isAbsolute(resolved))throw Error();return path.win32.toNamespacedPath(path.win32.normalize(resolved)).toLowerCase();}catch{throw Error('PROOF_IMAGE_IDENTITY_UNVERIFIED');}
}
function cleanAppEnvironment(parent,systemRoot){
 assert.ok(typeof systemRoot==='string'&&path.win32.isAbsolute(systemRoot),'PROOF_SYSTEM_ROOT');
 const result={};for(const [key,value]of Object.entries(parent))if(!MESA.has(key.toUpperCase())&&!/^path$/i.test(key)&&!/^node_(?:options|path)$/i.test(key)&&!/^npm_/i.test(key))result[key]=value;
 result.Path=[path.win32.join(systemRoot,'System32'),systemRoot].join(';');
 return result;
}
function inventory(root){
 const manifest=verifyManifest(root);
 return Object.freeze({root:path.resolve(root),manifestSHA256:hash(path.join(root,MANIFEST)),sourceCommit:manifest.commitSHA,nodeVersion:manifest.node.version,
  files:Object.freeze(manifest.files.map(item=>Object.freeze({...item})))});
}
function originalFile(root,relative){
 assert.ok(typeof relative==='string'&&relative.length>0&&!relative.includes('\\')&&!relative.includes(':')&&!/[\x00-\x1f\x7f]/.test(relative)&&relative.split('/').every(p=>p&&p!=='.'&&p!=='..'),'PROOF_INVENTORY_PATH');
 let cursor=root;assert.ok(fs.lstatSync(cursor).isDirectory()&&!fs.lstatSync(cursor).isSymbolicLink(),'PROOF_INVENTORY_ROOT');
 for(const part of relative.split('/')){cursor=path.join(cursor,part);assert.equal(fs.lstatSync(cursor).isSymbolicLink(),false,'PROOF_INVENTORY_LINK');}
 return cursor;
}
function verifyOriginalInventory(record){
 assert.equal(hash(originalFile(record.root,MANIFEST)),record.manifestSHA256,'ORIGINAL_MANIFEST_CHANGED');
 for(const item of record.files){const file=originalFile(record.root,item.path),stat=fs.lstatSync(file);assert.ok(stat.isFile(),'ORIGINAL_FILE_TYPE');assert.equal(stat.size,item.bytes,'ORIGINAL_FILE_SIZE');assert.equal(hash(file),item.sha256,'ORIGINAL_FILE_HASH');}
 return true; // New runtime/config files are not represented as inventory members.
}
function sourceLocation(root,nodeExecutable=process.execPath){
 assert.ok(path.isAbsolute(root)&&path.isAbsolute(nodeExecutable),'PROOF_LOCATION_ABSOLUTE');
 return Object.freeze({appRoot:path.resolve(root),nodeExecutable,jobHost:path.resolve(root,'build/windows/PiRaiders.JobHost.exe'),extracted:false});
}
function extractedLocation(root,record){
 assert.equal(path.resolve(root),record.root,'PROOF_INVENTORY_ROOT');verifyOriginalInventory(record);
 const paths={appRoot:path.join(root,'app'),nodeExecutable:path.join(root,'runtime/node.exe'),jobHost:path.join(root,'app/build/windows/PiRaiders.JobHost.exe'),entry:path.join(root,'Launch-PiRaiders.cmd')};
 for(const relative of ['runtime/node.exe','app/build/windows/PiRaiders.JobHost.exe','Launch-PiRaiders.cmd','app/scripts/piraiders-app.cjs','app/server.js'])assert.ok(record.files.some(f=>f.path===relative),'PROOF_LOCATION_INVENTORIED');
 return Object.freeze({...paths,extracted:true,inventory:record});
}
function assertOuterBench(rows,outer,roots){
 assert.equal(outer.exitCode,null,'OUTER_CONTAINMENT_REMAINS_ALIVE');assert.equal(outer.signalCode,null,'OUTER_CONTAINMENT_REMAINS_ALIVE');
 assert.equal(treeState(rows,roots).surviving,1,'OUTER_BENCH_REMAINS_ALIVE');
}
function captureAppParent(rows,outerPid,nodeExecutable,powershell,{realpath=fs.realpathSync.native}={}){
 const found=findOwnedAppParent(rows,outerPid,nodeExecutable,{realpath});
 const image=path.win32.normalize(realpath(powershell)).toLowerCase();
 const roots=found.tree.filter(row=>row.ParentProcessId===outerPid&&row.ExecutablePath===image);
 assert.equal(roots.length,1,'OUTER_BENCH_ROOT_IDENTITY');
 return Object.freeze({...found,outerRoots:Object.freeze(roots)});
}
function prepareExtracted(archive,expectedSource){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('WINDOWS_REQUIRED');
 assert.match(expectedSource,/^[a-f0-9]{40}$/,'PROOF_SOURCE_REQUIRED');
 const zip=path.resolve(archive),stat=fs.lstatSync(zip);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=512*1024*1024,'PROOF_ARCHIVE');
 const archiveSHA256=hash(zip);
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'PiRaiders output 鷹 ! ')),extraction=path.join(work,'Extracted package'),powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
 try{
  fs.mkdirSync(extraction);
  execFileSync(powershell,['-NoLogo','-NoProfile','-NonInteractive','-Command','Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:PIRAIDERS_PROOF_ARCHIVE, $env:PIRAIDERS_PROOF_EXTRACT)'],{env:{...process.env,PIRAIDERS_PROOF_ARCHIVE:zip,PIRAIDERS_PROOF_EXTRACT:extraction},stdio:'ignore',windowsHide:true,timeout:900000});
  assert.equal(hash(zip),archiveSHA256,'ARCHIVE_CHANGED_DURING_EXTRACT');
  const root=path.join(extraction,'PiRaiders-Development'),record=inventory(root),location=extractedLocation(root,record);assert.equal(record.sourceCommit,expectedSource,'ARCHIVE_SOURCE_COMMIT');
  const nodeVersion=execFileSync(location.nodeExecutable,['--version'],{encoding:'utf8',timeout:5000,maxBuffer:128,windowsHide:true,env:cleanAppEnvironment(process.env,process.env.SystemRoot)}).trim();
  assert.equal(nodeVersion,record.nodeVersion,'BUNDLED_NODE_VERSION');
  return Object.freeze({...location,work,powershell,archiveEvidence:Object.freeze({archiveSHA256,manifestSHA256:record.manifestSHA256,sourceCommit:record.sourceCommit,nodeVersion,originalInventoryFiles:record.files.length})});
 }catch(error){fs.rmSync(work,{recursive:true,force:true,maxRetries:10,retryDelay:100});throw error;}
}
// Fixed fields only: an application snapshot can contain paths, event data and
// private capabilities elsewhere. Never retain or serialize the raw snapshot.
function createRuntimeDiagnostics(){
 const states=new Set(['prepared','waiting','starting','ready','expired','closing','closed']);
 const errors=new Set(['SESSION_CLOSE_FAILED','STATE_UNAVAILABLE','CONSOLE_CLOSE_FAILED','EVENT_BOOTSTRAP_FAILED','PRODUCTION_WINDOW_EXPIRED','EVENT_CLOSE_FAILED','CONSOLE_FAULT','SERVICE_FAULT','EVENT_START_FAILED','DISCONNECTED','PROTOCOL_ERROR','RENDERER_TIMEOUT','TRANSPORT_FAULT','RESOLVER_FAILED','CLOSE_FAILED','LISTEN_FAILED']);
 const history=[];let observations=0;
 function record(value){
  const runtime=value?.active?.runtime;
  const safe=Object.freeze({state:runtime?(states.has(runtime.state)?runtime.state:'unknown'):'unavailable',lastError:runtime?.lastError==null?null:(errors.has(runtime.lastError)?runtime.lastError:'UNRECOGNIZED'),generation:Number.isSafeInteger(runtime?.generation)&&runtime.generation>=0&&runtime.generation<=1000000?runtime.generation:null,ready:typeof runtime?.ready==='boolean'?runtime.ready:null,windowAllowed:typeof runtime?.windowAllowed==='boolean'?runtime.windowAllowed:null});
  observations=Math.min(observations+1,1000000);
  if(!history.length||JSON.stringify(history[history.length-1])!==JSON.stringify(safe)){history.push(safe);if(history.length>16)history.shift();}
 }
 function snapshot(){return Object.freeze({observations,history:Object.freeze(history.slice())});}
 return Object.freeze({record,snapshot});
}
module.exports={createRuntimeDiagnostics,canonicalImage,cleanAppEnvironment,inventory,verifyOriginalInventory,sourceLocation,extractedLocation,assertOuterBench,captureAppParent,prepareExtracted};
