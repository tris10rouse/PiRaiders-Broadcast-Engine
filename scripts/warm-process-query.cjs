'use strict';
// Disposable Windows proof tooling only; never shipped in the application ZIP.
// The private console proof failed at START three times (79ff344, bc679a3 and
// PR #83's 6da55bb): its first Windows process listing (one PowerShell CIM
// query) did not answer inside the proof's 15 s capture bound on a freshly
// started hosted runner (step PROCESS_CAPTURE, one query, killed at 15 s).
// This step runs the same query once before the proof, with its own bound, so
// the proof's unchanged 15 s bound applies to a warmed query service. It is a
// CI mitigation, not a claim about any other PC's first query.
// Output: fixed keys only (elapsed time and a row count); no IDs or paths.
const {execFile}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const {PROCESS_QUERY}=require('./windows-process-evidence.cjs');
const WARM_TIMEOUT_MS=90000;

function runQuery(timeoutMs){
  return new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',PROCESS_QUERY],
    {encoding:'utf8',timeout:timeoutMs,windowsHide:true,maxBuffer:1024*1024},(error,raw)=>error?reject(error):resolve(raw)));
}
function failureKind(error){
  if(error&&error.killed===true)return 'CHILD_KILLED';
  if(error&&error.code==='ENOENT')return 'POWERSHELL_MISSING';
  if(error&&Number.isInteger(error.code))return 'CHILD_EXIT';
  return 'QUERY_FAILED';
}
async function warmProcessQuery({run=runQuery,now=()=>performance.now(),timeoutMs=WARM_TIMEOUT_MS}={}){
  const started=now();
  try{
    const raw=await run(timeoutMs),rows=JSON.parse(raw);
    if(!Array.isArray(rows)||!rows.length)return{event:'process-query-warm-failed',kind:'TABLE_INVALID',elapsedMs:Math.round(now()-started)};
    return{event:'process-query-warmed',elapsedMs:Math.round(now()-started),rows:rows.length};
  }catch(error){
    return{event:'process-query-warm-failed',kind:error instanceof SyntaxError?'TABLE_INVALID':failureKind(error),elapsedMs:Math.round(now()-started)};
  }
}
module.exports={WARM_TIMEOUT_MS,warmProcessQuery,failureKind};
if(require.main===module)warmProcessQuery().then(result=>{
  console.log(JSON.stringify(result));
  if(result.event!=='process-query-warmed')process.exitCode=1;
});
