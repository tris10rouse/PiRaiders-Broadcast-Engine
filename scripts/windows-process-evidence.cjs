'use strict';
// Disposable Windows proof tooling only; never shipped in the application ZIP.
// PIDs and ParentProcessId can refer to a later generation after reuse. Retain
// creation ticks as decimal strings: DateTime ticks exceed JS integer precision.
const {execFileSync,execFile}=require('node:child_process');
const {setTimeout:wait}=require('node:timers/promises');
const {performance}=require('node:perf_hooks');
const path=require('node:path');
// Bypass WindowsPowerShell5 console code pages; JSON is an explicit UTF8 byte protocol.
const PROCESS_QUERY="$ErrorActionPreference='Stop'; $rows = @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId,ParentProcessId,ExecutablePath,@{Name='CreationUtcTicks';Expression={if($null -eq $_.CreationDate){$null}else{$_.CreationDate.ToUniversalTime().Ticks.ToString([System.Globalization.CultureInfo]::InvariantCulture)}}}); $json = ConvertTo-Json -Compress -InputObject $rows; $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($json); $stream = [Console]::OpenStandardOutput(); $stream.Write($bytes,0,$bytes.Length); $stream.Flush()";
const failures=new WeakMap(),captureDiagnostics=new WeakMap();
function identityCaptureDiagnostics(error){return captureDiagnostics.get(error)||null;}
function fail(reason){const error=Error('PROCESS_IDENTITY_UNVERIFIED');failures.set(error,reason);throw error;}
function identityReason(error){return failures.get(error)||null;}
function index(rows){
  if(!Array.isArray(rows)||rows.length>65536)fail('TABLE_INVALID');
  const result=new Map();
  for(const row of rows){
    if(!row||!Number.isSafeInteger(row.ProcessId)||row.ProcessId<0||!Number.isSafeInteger(row.ParentProcessId)||row.ParentProcessId<0)fail('ROW_INVALID');
    if(result.has(row.ProcessId))fail('DUPLICATE_PID');
    result.set(row.ProcessId,row);
  }
  return result;
}
function identity(row){
  if(!row)fail('IDENTITY_MISSING');
  if(!Number.isSafeInteger(row.ProcessId)||row.ProcessId<=0||!Number.isSafeInteger(row.ParentProcessId)||row.ParentProcessId<0)fail('ROW_INVALID');
  if(row.CreationUtcTicks===null||row.CreationUtcTicks===undefined||row.CreationUtcTicks==='')fail('CREATION_MISSING');
  if(typeof row.CreationUtcTicks!=='string'||!/^[1-9][0-9]{0,18}$/.test(row.CreationUtcTicks)||BigInt(row.CreationUtcTicks)>3155378975999999999n)fail('CREATION_INVALID');
  if(row.ExecutablePath===null||row.ExecutablePath===undefined||row.ExecutablePath==='')fail('IMAGE_MISSING');
  if(typeof row.ExecutablePath!=='string'||!path.win32.isAbsolute(row.ExecutablePath)||row.ExecutablePath.includes('\0'))fail('IMAGE_INVALID');
  return Object.freeze({ProcessId:row.ProcessId,ParentProcessId:row.ParentProcessId,CreationUtcTicks:row.CreationUtcTicks,ExecutablePath:path.win32.normalize(row.ExecutablePath).toLowerCase()});
}
function processTable(){
  const raw=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',PROCESS_QUERY],{encoding:'utf8',timeout:15000,windowsHide:true,maxBuffer:1024*1024});
  const rows=JSON.parse(raw),byPid=index(rows);identity(byPid.get(process.pid)); // Positive control: enumeration can actually identify this process.
  return rows;
}
// Pre-action captures only (no cleanup deadline is running). Exactly one failure
// is repeatable: the bounded query itself timing out (ETIMEDOUT). Malformed,
// missing or contradictory evidence still fails at once, and every attempt is
// counted so that a slow enumeration is visible in the retained evidence rather
// than silently absorbed. Deadline-bound observations keep calling processTable().
function processTableForCapture({read=processTable,attempts=3,record=null,now=()=>performance.now()}={}){
  if(typeof read!=='function'||!Number.isSafeInteger(attempts)||attempts<1||attempts>3||(record!==null&&typeof record!=='function'))fail('CAPTURE_INVALID');
  for(let attempt=1;;attempt++){
    const started=now();let rows,failed=false,failure;
    try{rows=read();}catch(error){failed=true;failure=error;}
    const timedOut=failed&&!!failure&&failure.code==='ETIMEDOUT';
    if(record)record(Object.freeze({attempt,timedOut,failed,elapsedMs:Math.max(0,Math.min(60000,Math.floor(now()-started)))}));
    if(!failed)return rows;
    if(!timedOut||attempt>=attempts)throw failure;
  }
}
function descendants(rows,parent){
  const byPid=index(rows),root=identity(byPid.get(parent)),found=new Map([[parent,root]]);
  for(let again=true;again;){again=false;for(const row of rows){
    const ancestor=found.get(row.ParentProcessId);if(!ancestor||found.has(row.ProcessId))continue;
    // Validate present fields before using creation time to exclude a stale PPID.
    const observed=captureIdentity(row);
    if(row.CreationUtcTicks&&BigInt(row.CreationUtcTicks)<BigInt(ancestor.CreationUtcTicks))continue;
    const child=observed.value||identity(row);
    found.set(child.ProcessId,child);again=true;
  }}
  return Object.freeze([...found.values()]);
}
function capturedIdentities(captured){
  if(!Array.isArray(captured)||!captured.length)fail('CAPTURE_INVALID');
  const unique=new Map();for(const row of captured){
    const value=identity(row),key=value.ProcessId+':'+value.CreationUtcTicks,previous=unique.get(key);
    if(previous&&(previous.ExecutablePath!==value.ExecutablePath||previous.ParentProcessId!==value.ParentProcessId))fail('CAPTURE_CONTRADICTION');
    unique.set(key,value);
  }
  return unique;
}
function evaluate(rows,captured,allowUnknown){
  // Captured evidence must be complete and coherent even when a new CIM query
  // is incomplete. Retrying a live observation cannot hide a corrupt capture.
  const unique=capturedIdentities(captured),byPid=index(rows);
  const result={tracked:unique.size,surviving:0,reused:0,gone:0},reasons=new Set();let unknown=0;
  for(const old of unique.values()){
    const row=byPid.get(old.ProcessId);if(!row){result.gone++;continue;}
    let current;
    if(allowUnknown){
      // Validate every present field before classifying missing teardown data.
      // Null creation ticks must not hide a malformed executable path.
      const observed=captureIdentity(row);
      if(!observed.value){unknown++;reasons.add(observed.missing);continue;}
      current=observed.value;
    }else current=identity(row);
    if(current.CreationUtcTicks!==old.CreationUtcTicks){
      if(BigInt(current.CreationUtcTicks)<BigInt(old.CreationUtcTicks))fail('CREATION_BACKWARDS');
      result.reused++;continue;
    }
    if(current.ExecutablePath!==old.ExecutablePath||current.ParentProcessId!==old.ParentProcessId)fail('LIVE_CONTRADICTION');
    result.surviving++;
  }
  if(allowUnknown){result.unknown=unknown;result.reasons=Object.freeze([...reasons].sort());}
  return Object.freeze(result); // Fixed counts/reasons only; no IDs, paths or private capabilities.
}
function treeState(rows,captured){return evaluate(rows,captured,false);}
// This function does not retry or own a timer. Callers retain their original
// cleanup deadline and require BOTH surviving===0 and unknown===0 to pass.
function observeTree(rows,captured){return evaluate(rows,captured,true);}
// Pre-action capture is distinct from post-action observation. Only present rows
// with missing identity fields may be retried; malformed evidence always fails.
// Validate both fields before classifying a row as incomplete, so null creation
// ticks cannot hide a malformed executable path (or vice versa).
function captureIdentity(row){
  if(!row)fail('IDENTITY_MISSING');
  if(!Number.isSafeInteger(row.ProcessId)||row.ProcessId<=0||!Number.isSafeInteger(row.ParentProcessId)||row.ParentProcessId<0)fail('ROW_INVALID');
  const missingCreation=row.CreationUtcTicks===null||row.CreationUtcTicks===undefined||row.CreationUtcTicks==='';
  const missingImage=row.ExecutablePath===null||row.ExecutablePath===undefined||row.ExecutablePath==='';
  if(!missingCreation&&(typeof row.CreationUtcTicks!=='string'||!/^[1-9][0-9]{0,18}$/.test(row.CreationUtcTicks)||BigInt(row.CreationUtcTicks)>3155378975999999999n))fail('CREATION_INVALID');
  if(!missingImage&&(typeof row.ExecutablePath!=='string'||!path.win32.isAbsolute(row.ExecutablePath)||row.ExecutablePath.includes('\0')))fail('IMAGE_INVALID');
  return {value:missingCreation||missingImage?null:identity(row),missing:missingCreation?'CREATION_MISSING':missingImage?'IMAGE_MISSING':null};
}
function readCaptureTable(timeoutMs){
  return new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',PROCESS_QUERY],
    {encoding:'utf8',timeout:timeoutMs,windowsHide:true,maxBuffer:1024*1024},(error,raw)=>{
      if(error){reject(error);return;}
      try{resolve(JSON.parse(raw));}catch{try{fail('TABLE_INVALID');}catch(failure){reject(failure);}}
    }));
}
// Exactly one immutable absolute deadline is supplied by the caller. A complete
// positive-control and root PID-generation are required in the successful table.
// Previously complete owned identities are retained for cleanup. A missing field
// never means gone: only a later complete positive-control snapshot may establish
// that the incomplete candidate PID is no longer present. No identity is invented
// for that candidate and it is not counted as a captured generation.
async function captureProcessTreeImpl(parent,{deadline,expectedParentPid,expectedImage,expectedRoot=null,readTable=readCaptureTable,now=()=>performance.now(),pause=wait,pollMs=100,controlPid=process.pid}={},diagnostics){
  if(!Number.isSafeInteger(parent)||parent<=0||!Number.isSafeInteger(controlPid)||controlPid<=0||!Number.isFinite(deadline)||!Number.isSafeInteger(pollMs)||pollMs<1||pollMs>1000||!Number.isSafeInteger(expectedParentPid)||expectedParentPid<0||typeof expectedImage!=='string'||!path.win32.isAbsolute(expectedImage)||expectedImage.includes('\0'))fail('CAPTURE_INVALID');
  const known=new Map(),partial=new Map();let root=expectedRoot===null?null:identity(expectedRoot),control=null,lastMissing=null;
  const image=path.win32.normalize(expectedImage).toLowerCase();
  if(root&&(root.ProcessId!==parent||root.ParentProcessId!==expectedParentPid||root.ExecutablePath!==image))fail('CAPTURE_INVALID');
  function checkPartial(row){
    const previous=partial.get(row.ProcessId),current={ParentProcessId:row.ParentProcessId,
      CreationUtcTicks:row.CreationUtcTicks||null,ExecutablePath:row.ExecutablePath?path.win32.normalize(row.ExecutablePath).toLowerCase():null};
    if(previous){
      if(previous.CreationUtcTicks&&current.CreationUtcTicks&&previous.CreationUtcTicks!==current.CreationUtcTicks){
        if(BigInt(current.CreationUtcTicks)<BigInt(previous.CreationUtcTicks))fail('CREATION_BACKWARDS');
        // A known new descendant generation is retained separately, but an
        // incomplete generation cannot silently be substituted by PID reuse.
        if(row.ProcessId===parent||!previous.complete)fail('CAPTURE_GENERATION_CHANGED');
      }else if(previous.ParentProcessId!==current.ParentProcessId||(previous.ExecutablePath&&current.ExecutablePath&&previous.ExecutablePath!==current.ExecutablePath))fail('LIVE_CONTRADICTION');
    }
    if(!partial.has(row.ProcessId)&&partial.size>=65536)fail('CAPTURE_LIMIT');
    partial.set(row.ProcessId,{ParentProcessId:current.ParentProcessId,CreationUtcTicks:current.CreationUtcTicks||previous?.CreationUtcTicks||null,
      ExecutablePath:current.ExecutablePath||previous?.ExecutablePath||null,complete:!!(current.CreationUtcTicks&&current.ExecutablePath)});
  }
  while(now()<deadline){
    diagnostics.queries=Math.min(65536,diagnostics.queries+1);
    const rows=await readTable(Math.max(1,Math.min(15000,Math.floor(deadline-now()))));
    if(now()>=deadline)fail(lastMissing||'CAPTURE_DEADLINE');
    const byPid=index(rows),missing=new Set(),pendingBefore=new Set([...partial].filter(([,value])=>!value.complete).map(([pid])=>pid));
    function inspect(row,role){const observed=captureIdentity(row);checkPartial(row);if(observed.missing){missing.add(observed.missing);diagnostics.missingRoles[role]=Math.min(65536,diagnostics.missingRoles[role]+1);}return observed.value;}
    const controlRow=byPid.get(controlPid),observedControl=inspect(controlRow,'control');
    if(control&&((controlRow.CreationUtcTicks&&controlRow.CreationUtcTicks!==control.CreationUtcTicks)||controlRow.ParentProcessId!==control.ParentProcessId||(controlRow.ExecutablePath&&path.win32.normalize(controlRow.ExecutablePath).toLowerCase()!==control.ExecutablePath)))fail('LIVE_CONTRADICTION');
    if(control&&observedControl&&(control.CreationUtcTicks!==observedControl.CreationUtcTicks||control.ExecutablePath!==observedControl.ExecutablePath||control.ParentProcessId!==observedControl.ParentProcessId))fail('LIVE_CONTRADICTION');
    if(observedControl)control=observedControl;
    const rootRow=byPid.get(parent),observedRoot=inspect(rootRow,'root');
    if(root&&rootRow.CreationUtcTicks&&rootRow.CreationUtcTicks!==root.CreationUtcTicks)fail('CAPTURE_GENERATION_CHANGED');
    if(rootRow.ParentProcessId!==expectedParentPid||(rootRow.ExecutablePath&&path.win32.normalize(rootRow.ExecutablePath).toLowerCase()!==image))fail('CAPTURE_ROOT_OWNER');
    if(root&&observedRoot&&(root.CreationUtcTicks!==observedRoot.CreationUtcTicks||root.ExecutablePath!==observedRoot.ExecutablePath||root.ParentProcessId!==observedRoot.ParentProcessId))fail('CAPTURE_GENERATION_CHANGED');
    if(observedRoot)root=observedRoot;
    // Check all related rows, not only until the first missing field. This also
    // prevents an earlier incomplete sibling from masking contradictory data.
    const reached=new Map([[parent,observedRoot]]),proven=new Set(observedRoot?[parent]:[]);
    const excluded=new Set();
    for(let again=true;again;){again=false;for(const row of rows){
      if(!reached.has(row.ParentProcessId)||reached.has(row.ProcessId)||excluded.has(row.ProcessId))continue;
      const ancestor=reached.get(row.ParentProcessId);
      // A newly encountered, provably older row belongs to another parent PID
      // generation. Validate syntax, but do not create an incomplete obligation.
      // Previously tracked partial/complete candidates must still be resolved.
      captureIdentity(row);
      if(!partial.has(row.ProcessId)&&ancestor&&row.CreationUtcTicks&&BigInt(row.CreationUtcTicks)<BigInt(ancestor.CreationUtcTicks)){
        excluded.add(row.ProcessId);diagnostics.excludedOlderRows=Math.min(65536,diagnostics.excludedOlderRows+1);continue;
      }
      const value=inspect(row,'related');
      if(value&&ancestor&&BigInt(value.CreationUtcTicks)<BigInt(ancestor.CreationUtcTicks))continue;
      reached.set(row.ProcessId,value);if(value&&ancestor&&proven.has(row.ParentProcessId))proven.add(row.ProcessId);again=true;
    }}
    // Retain fully-known previous generations even if a later coherent table
    // shows them absent. Present-but-incomplete previous rows still block capture.
    for(const old of known.values()){
      const row=byPid.get(old.ProcessId);if(!row)continue;
      const value=inspect(row,'previouslyCaptured');if(!value)continue;
      if(BigInt(value.CreationUtcTicks)<BigInt(old.CreationUtcTicks))fail('CREATION_BACKWARDS');
      if(value.CreationUtcTicks===old.CreationUtcTicks&&(value.ExecutablePath!==old.ExecutablePath||value.ParentProcessId!==old.ParentProcessId))fail('LIVE_CONTRADICTION');
    }
    // Incomplete candidates from prior tables remain obligations while present,
    // even if a disappeared/reused immediate parent cuts off current reachability.
    // A newly complete but off-tree candidate cannot gain historical ownership
    // from a numeric PPID alone; fail closed instead of inventing an identity.
    for(const pid of pendingBefore){
      if(proven.has(pid)||pid===parent||pid===controlPid)continue;
      const row=byPid.get(pid);if(!row)continue;
      const value=inspect(row,'previouslyCaptured');
      if(value)fail('CAPTURE_ANCESTRY_UNVERIFIED');
    }
    for(const [pid,value]of reached)if(value&&proven.has(pid))known.set(value.ProcessId+':'+value.CreationUtcTicks,value);
    if(known.size>65536)fail('CAPTURE_LIMIT');
    if(!missing.size){
      const currentTree=descendants(rows,parent);
      for(const value of currentTree)known.set(value.ProcessId+':'+value.CreationUtcTicks,value);
      if(now()>=deadline)fail('CAPTURE_DEADLINE');
      return Object.freeze({root,currentTree,tree:Object.freeze([...known.values()])});
    }
    lastMissing=[...missing].sort()[0];
    const remaining=deadline-now();if(remaining<=0)break;
    await pause(Math.min(pollMs,remaining));
  }
  fail(lastMissing||'CAPTURE_DEADLINE');
}
// Fixed-schema, bounded diagnostics contain counts and timing only. They never
// retain raw tables, process identifiers, executable paths or caller strings.
async function captureProcessTree(parent,options={}){
  const scope=['application','sender','tree'].includes(options.scope)?options.scope:'tree';
  const now=options.now||(()=>performance.now()),started=now();
  const diagnostics={scope,queries:0,missingRoles:{control:0,root:0,related:0,previouslyCaptured:0},excludedOlderRows:0};
  try{
    if(options.scope!==undefined&&!['application','sender','tree'].includes(options.scope))fail('CAPTURE_INVALID');
    return await captureProcessTreeImpl(parent,options,diagnostics);
  }catch(error){
    const bounded=value=>Number.isFinite(value)?Math.max(0,Math.min(15000,Math.floor(value))):0;
    if(error&&(typeof error==='object'||typeof error==='function'))captureDiagnostics.set(error,Object.freeze({...diagnostics,missingRoles:Object.freeze({...diagnostics.missingRoles}),elapsedMs:bounded(now()-started),remainingMs:bounded(options.deadline-now())}));
    throw error;
  }
}
module.exports={PROCESS_QUERY,processTable,processTableForCapture,descendants,treeState,observeTree,identityReason,identityCaptureDiagnostics,captureProcessTree};
