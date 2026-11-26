'use strict';
// 5e-2: the parts of the Windows soak job (scripts/smoke-soak-windows.cjs)
// that run the same on Linux, so they are tested there: the run's length from
// the workflow's input, the once-per-cycle usage sample of the owned processes
// and the wait for each step's fixed offset. The rules themselves (plan,
// bounds, no lost Stop, record) are scripts/soak-proof.cjs (5e-1).
// Hosted-CI evidence only, never target-PC evidence. See docs/design/SOAK_PROOF.md.
const {execFileSync}=require('node:child_process');
const {descendants}=require('./windows-process-evidence.cjs');
const {soakPlan,DEFAULT_SOAK_MS,MAX_SOAK_MS,CYCLE_MS,MIN_CYCLES}=require('./soak-proof.cjs');

function fail(code){return Object.assign(Error(code),{code});}

// The workflow's `minutes` input: whole minutes, at least the check run's
// shortest and at most the soak's longest. Under four hours it is a check run
// of the job, never the soak.
function soakDuration(text){
  if(typeof text!=='string'||!/^[1-9][0-9]{0,3}$/.test(text))throw fail('SOAK_DURATION_INVALID');
  const minutes=Number(text),durationMs=minutes*CYCLE_MS;
  if(minutes<MIN_CYCLES||durationMs>MAX_SOAK_MS)throw fail('SOAK_DURATION_INVALID');
  return soakPlan({durationMs,checkRun:durationMs<DEFAULT_SOAK_MS});
}

// The process listing with each process's working set and handle count. No
// double quote, so Windows argument quoting leaves it whole; JSON as UTF-8 bytes.
const USAGE_QUERY="$ErrorActionPreference='Stop'; $rows = @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId,ParentProcessId,ExecutablePath,WorkingSetSize,HandleCount,@{Name='CreationUtcTicks';Expression={if($null -eq $_.CreationDate){$null}else{$_.CreationDate.ToUniversalTime().Ticks.ToString([System.Globalization.CultureInfo]::InvariantCulture)}}}); $json = ConvertTo-Json -Compress -InputObject $rows; $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($json); $stream = [Console]::OpenStandardOutput(); $stream.Write($bytes,0,$bytes.Length); $stream.Flush()";
function usageTable(){
  return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',USAGE_QUERY],{encoding:'utf8',timeout:15000,windowsHide:true,maxBuffer:4*1024*1024}));
}

// The owned processes' sums: the application process (the same process the
// job started: same id and start time) and every descendant (SPX, Caspar,
// the decoders). Anything unreadable throws; the caller counts it unreadable.
function ownedUsage(rows,parent){
  if(!Array.isArray(rows)||!parent||!Number.isSafeInteger(parent.ProcessId)||typeof parent.CreationUtcTicks!=='string')throw fail('SOAK_SAMPLE_INVALID');
  const root=rows.find(row=>row&&row.ProcessId===parent.ProcessId);
  if(!root||root.CreationUtcTicks!==parent.CreationUtcTicks)throw fail('SOAK_SAMPLE_PARENT_GONE');
  const owned=new Set(descendants(rows,parent.ProcessId).map(row=>row.ProcessId));
  let workingSetBytes=0,handles=0,processes=0;
  for(const row of rows){
    if(!owned.has(row.ProcessId))continue;
    if(!Number.isSafeInteger(row.WorkingSetSize)||row.WorkingSetSize<0||!Number.isSafeInteger(row.HandleCount)||row.HandleCount<0)throw fail('SOAK_SAMPLE_INVALID');
    workingSetBytes+=row.WorkingSetSize;handles+=row.HandleCount;processes+=1;
  }
  if(!Number.isSafeInteger(workingSetBytes)||workingSetBytes<=0)throw fail('SOAK_SAMPLE_INVALID');
  return{workingSetBytes,handles,processes};
}

// One sample for `cycle`, in the shape checkSamples takes; a failed read is
// an unreadable sample, never a skipped one.
function sampleCycle(cycle,parent,read=usageTable){
  try{const usage=ownedUsage(read(),parent);return{cycle,workingSetBytes:usage.workingSetBytes,handles:usage.handles,processes:usage.processes};}
  catch{return{cycle,unreadable:true};}
}

// Wait until `atMs` on the job's clock; answers how late the step starts
// (0 when on time). A step is never started early.
async function waitFor(atMs,{now,sleep}){
  for(let left=atMs-now();left>0;left=atMs-now())await sleep(left);
  return Math.max(0,Math.round(now()-atMs));
}

// Q-011: the failure line's receiver part. The failed request's own record
// (taken when it failed) wins; else the receiver's record now; the socket's
// fixed code only when it is one. Numbers and fixed words only.
function receiverEvidence(error,probe){
  const socketCode=error&&typeof error.socketCode==='string'&&/^E[A-Z0-9_]{1,31}$/.test(error.socketCode)?error.socketCode:null;
  let receiver=error&&error.receiver&&typeof error.receiver==='object'?error.receiver:null;
  if(!receiver&&probe&&typeof probe.diagnostics==='function')try{receiver=probe.diagnostics();}catch{}
  return{socketCode,receiver:receiver||null};
}
module.exports={soakDuration,USAGE_QUERY,usageTable,ownedUsage,sampleCycle,waitFor,receiverEvidence};
