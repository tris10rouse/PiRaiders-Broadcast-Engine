#!/usr/bin/env node
'use strict';
// Failure-only disposable differential diagnostic. No NDI consumer, external
// AMCP controller, producer URL, raw native output or production changes.
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSupervisedProcess}=require('./lib/windows-job-process.cjs');
const {CasparConsole}=require('./lib/caspar-console.cjs');
const {casparRendererEnvironment}=require('./lib/caspar-renderer.cjs');
const {preparedCasparConfig}=require('./lib/prepared-caspar-config.cjs');
const FAULTS=new Set(['CONSOLE_TIMEOUT','CONSOLE_CLOSED','CONSOLE_OUTPUT_CLOSED','CONSOLE_PROCESS','CONSOLE_REJECTED','CONSOLE_PROTOCOL','CONSOLE_REPLY_LIMIT','CONSOLE_LINE_LIMIT','CONSOLE_INPUT','CONSOLE_OUTPUT','CONSOLE_BUSY','CONSOLE_SEQUENCE']);
function faultCategory(error){return FAULTS.has(error?.message)?error.message:'COMPONENT_FAILURE';}
function exitCategory(result){if(!result)return'NOT_OBSERVED';if(result.signal)return'PROCESS_SIGNALLED';if(result.code===0)return'TARGET_EXIT_ZERO';if(result.code===252)return'NATIVE_BOUNDARY_EXIT_252';if(Number.isInteger(result.code))return'TARGET_EXIT_NONZERO';return'NOT_OBSERVED';}
function probeConfiguration(directory){
 if(!path.isAbsolute(directory)||/[^\x20-\x7e]/.test(directory))throw Error('PROBE_ASCII_CONTROL_REQUIRED');
 const bytes=Buffer.from(preparedCasparConfig({output:{type:'none'}},directory),'utf8');
 if([...bytes].some(value=>value>127))throw Error('PROBE_ASCII_CONFIG_REQUIRED');
 return bytes;
}
async function closeWithin(child,closed,ms){let timer;try{return await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('PROBE_CLEANUP_TIMEOUT')),ms);})]);}finally{clearTimeout(timer);}}
async function runCase(label,file,bin){
 const child=spawnSupervisedProcess(path.join(bin,'casparcg.exe'),[file,'--log-severity=disable','--disable-logging'],{cwd:bin,env:casparRendererEnvironment(process.env,'mesa-llvmpipe-compat')},{forwardStdin:true});
 let info=null,cleanup='CONTAINMENT_CLOSED',exitObservedBeforeCleanup=false;const closed=new Promise(resolve=>child.once('close',(code,signal)=>{info={code,signal};resolve(info);}));
 const client=new CasparConsole(child,{timeoutMs:10000});let passed=false,fault=null;
 client.on('fault',()=>{});
 try{await client.request('VERSION',{status:201});passed=true;}catch(error){fault=faultCategory(error);}
 finally{
  exitObservedBeforeCleanup=child.exitCode!==null||child.signalCode!==null;
  client.close();
  try{await closeWithin(child,closed,10000);}catch{cleanup='FORCED_NATIVE_HOST_CLOSE';child.kill('SIGKILL');await closeWithin(child,closed,5000);}
 }
 return Object.freeze({case:label,version:passed?'passed':'failed',faultCategory:fault,exitCategory:exitCategory(info),exitObservedBeforeCleanup,cleanupCategory:cleanup});
}
async function main(){
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('WINDOWS_REQUIRED');
 const root=path.resolve('build/caspar-proof-tools'),work=path.resolve('build/caspar-config-path-probe'),evidence=path.resolve('build/extracted-full-app-proof-evidence');
 const tools=JSON.parse(await fs.readFile(path.join(root,'tools.json'),'utf8')),bin=tools.casparDirectory;
 // Both process cwd/resource roots and the configuration's content stay ASCII;
 // only the argv file name differs. This does not diagnose Unicode XML paths.
 if(!path.isAbsolute(bin)||/[^\x20-\x7e]/.test(bin)||/[^\x20-\x7e]/.test(work))throw Error('PROBE_ASCII_CONTROL_REQUIRED');
 await fs.rm(work,{recursive:true,force:true});await fs.mkdir(work,{recursive:true});await fs.mkdir(evidence,{recursive:true});
 const runtime=path.join(work,'runtime');for(const name of ['media','log','data','template'])await fs.mkdir(path.join(runtime,name),{recursive:true});
 const bytes=probeConfiguration(runtime),ascii=path.join(work,'caspar-ascii.config'),unicode=path.join(work,'caspar-鷹.config');
 await fs.writeFile(ascii,bytes,{flag:'wx'});await fs.writeFile(unicode,bytes,{flag:'wx'});
 const cases=[];try{cases.push(await runCase('ascii',ascii,bin));cases.push(await runCase('unicode',unicode,bin));}
 finally{await fs.rm(work,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
 const report={event:'caspar-config-path-probe-result',diagnosticOnly:true,sourceCommit:/^[a-f0-9]{40}$/.test(process.env.PIRAIDERS_PROOF_SOURCE_SHA||'')?process.env.PIRAIDERS_PROOF_SOURCE_SHA:null,configurationSHA256:crypto.createHash('sha256').update(bytes).digest('hex'),byteIdenticalConfiguration:true,commonAsciiCwdAndConfigContent:true,onlyConfigurationArgumentPathDiffers:true,ndiConsumerConfigured:false,externalAmcpControllerConfigured:false,rawNativeOutputRetained:false,cases};
 await fs.writeFile(path.join(evidence,'config-path-probe.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(cases.some(value=>value.cleanupCategory!=='CONTAINMENT_CLOSED'))throw Error('PROBE_FORCED_CLEANUP');
}
if(require.main===module)main().catch(()=>{console.error('CONFIG_PATH_PROBE_FAILED');process.exitCode=1;});
module.exports={probeConfiguration,faultCategory,exitCategory};
