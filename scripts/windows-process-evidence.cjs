'use strict';
// Disposable Windows proof tooling only; never shipped in the application ZIP.
// PIDs and ParentProcessId can refer to a later generation after reuse. Retain
// creation ticks as decimal strings: DateTime ticks exceed JS integer precision.
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const PROCESS_QUERY="$ErrorActionPreference='Stop'; ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId,ParentProcessId,ExecutablePath,@{Name='CreationUtcTicks';Expression={if($null -eq $_.CreationDate){$null}else{$_.CreationDate.ToUniversalTime().Ticks.ToString([System.Globalization.CultureInfo]::InvariantCulture)}}})";
function fail(){throw Error('PROCESS_IDENTITY_UNVERIFIED');}
function index(rows){
  if(!Array.isArray(rows)||rows.length>65536)fail();
  const result=new Map();
  for(const row of rows){if(!row||!Number.isSafeInteger(row.ProcessId)||row.ProcessId<0||!Number.isSafeInteger(row.ParentProcessId)||row.ParentProcessId<0||result.has(row.ProcessId))fail();result.set(row.ProcessId,row);}
  return result;
}
function identity(row){
  if(!row||!Number.isSafeInteger(row.ProcessId)||row.ProcessId<=0||!Number.isSafeInteger(row.ParentProcessId)||row.ParentProcessId<0||typeof row.CreationUtcTicks!=='string'||!/^[1-9][0-9]{0,18}$/.test(row.CreationUtcTicks)||BigInt(row.CreationUtcTicks)>3155378975999999999n||typeof row.ExecutablePath!=='string'||!path.win32.isAbsolute(row.ExecutablePath)||row.ExecutablePath.includes('\0'))fail();
  return Object.freeze({ProcessId:row.ProcessId,ParentProcessId:row.ParentProcessId,CreationUtcTicks:row.CreationUtcTicks,ExecutablePath:path.win32.normalize(row.ExecutablePath).toLowerCase()});
}
function processTable(){
  const raw=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',PROCESS_QUERY],{encoding:'utf8',timeout:15000,windowsHide:true,maxBuffer:1024*1024});
  const rows=JSON.parse(raw),byPid=index(rows);identity(byPid.get(process.pid)); // Positive control: enumeration can actually identify this process.
  return rows;
}
function descendants(rows,parent){
  const byPid=index(rows),root=identity(byPid.get(parent)),found=new Map([[parent,root]]);
  for(let again=true;again;){again=false;for(const row of rows){
    const ancestor=found.get(row.ParentProcessId);if(!ancestor||found.has(row.ProcessId))continue;
    const child=identity(row);
    // An older process cannot be this generation's child. Windows retains a
    // numeric PPID after its original parent exits; no ancestry is inferred.
    if(BigInt(child.CreationUtcTicks)<BigInt(ancestor.CreationUtcTicks))continue;
    found.set(child.ProcessId,child);again=true;
  }}
  return Object.freeze([...found.values()]);
}
function treeState(rows,captured){
  const byPid=index(rows);if(!Array.isArray(captured)||!captured.length)fail();
  const unique=new Map();for(const row of captured){
    const value=identity(row),key=value.ProcessId+':'+value.CreationUtcTicks,previous=unique.get(key);
    if(previous&&(previous.ExecutablePath!==value.ExecutablePath||previous.ParentProcessId!==value.ParentProcessId))fail();
    unique.set(key,value);
  }
  const result={tracked:unique.size,surviving:0,reused:0,gone:0};
  for(const old of unique.values()){
    const row=byPid.get(old.ProcessId);if(!row){result.gone++;continue;}
    const current=identity(row);
    if(current.CreationUtcTicks!==old.CreationUtcTicks){
      if(BigInt(current.CreationUtcTicks)<BigInt(old.CreationUtcTicks))fail();
      result.reused++;continue;
    }
    if(current.ExecutablePath!==old.ExecutablePath||current.ParentProcessId!==old.ParentProcessId)fail();
    result.surviving++;
  }
  return Object.freeze(result); // Bounded counts only: no paths, IDs or private capabilities in diagnostics.
}
module.exports={PROCESS_QUERY,processTable,descendants,treeState};
