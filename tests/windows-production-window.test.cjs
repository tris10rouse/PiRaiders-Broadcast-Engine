'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {fork,spawn,execFileSync}=require('node:child_process');
const {once}=require('node:events');
const {setTimeout:wait}=require('node:timers/promises');
const {JOB_HOST,WINDOW_EXPIRED_EXIT_CODE,createNativeWindowPolicy,spawnSupervisedProcess}=require('../scripts/lib/windows-job-process.cjs');
const {processTable,descendants,treeState,observeTree}=require('../scripts/windows-process-evidence.cjs');
const root=path.resolve(__dirname,'..');
const windows={skip:process.platform!=='win32'&&'Requires actual Windows native interval/containment; no simulated native pass',timeout:45000};
function compiler(){const directory=process.env.SystemRoot||process.env.WINDIR;assert.ok(directory&&path.isAbsolute(directory));const file=['Framework64','Framework'].map(folder=>path.join(directory,'Microsoft.NET',folder,'v4.0.30319','csc.exe')).find(fs.existsSync);assert.ok(file,'installed .NET compiler required');return file;}
function temporary(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'PiRaiders native window '));t.after(()=>fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100}));return directory;}
test('actual native window policy keeps UTC boundaries and immutable elapsed cap under clock changes',windows,async t=>{
 const directory=temporary(t),file=path.join(directory,'policy.exe');
 execFileSync(compiler(),['/nologo','/target:exe','/main:NativeWindowPolicyTest','/out:'+file,path.join(root,'native/windows/JobHost.cs'),path.join(__dirname,'fixtures/native-window-policy.cs')],{encoding:'utf8',windowsHide:true,timeout:30000});
 assert.equal(execFileSync(file,[],{encoding:'utf8',windowsHide:true,timeout:5000}).trim(),'WINDOW_POLICY_PASS');
});
test('native CLI rejects malformed bounds and refuses outside-window targets before execution',windows,async t=>{
 const directory=temporary(t),marker=path.join(directory,'executed'),target=[process.execPath,'-e','require("node:fs").writeFileSync(process.argv[1],"unsafe")',marker];
 const now=Date.now();
 for(const [bounds,expected]of [
  [['x',String(now+10000)],252],[[String(now),String(now)],252],
  [[String(now-2000),String(now-1000)],WINDOW_EXPIRED_EXIT_CODE],
  [[String(now+60000),String(now+120000)],WINDOW_EXPIRED_EXIT_CODE]
 ]){
  const child=spawn(JOB_HOST,['--production-window',...bounds,'0','9007199254740991',...target],{stdio:['pipe','ignore','ignore'],windowsHide:true});
  const [code]=await once(child,'exit');assert.equal(code,expected);assert.equal(fs.existsSync(marker),false);
 }
});
test('native sender deadline kills its full tree while owning Node is blocked and persistent service survives',windows,async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'PiRaiders blocked owner ')),file=path.join(directory,'sender.json');let senderTree=[],persistentTree=[];
 const parent=fork(path.join(__dirname,'fixtures/native-window-launcher.cjs'),[path.join(root,'scripts/lib/windows-job-process.cjs'),file],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
 const closed=once(parent,'close');
 t.after(async()=>{
  if(parent.exitCode===null&&parent.signalCode===null)parent.kill('SIGKILL');await closed;
  const owned=[...persistentTree,...senderTree];
  if(owned.length){
   const deadline=Date.now()+10000;let state;
   do{state=observeTree(processTable(),owned);if(state.surviving===0&&state.unknown===0)break;await wait(100);}while(Date.now()<deadline);
   assert.equal(state.surviving,0,'every captured job generation must close after fixture owner death');
   assert.equal(state.unknown,0,'incomplete cleanup evidence cannot establish termination');
  }
  fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 });
 const [ready]=await once(parent,'message',{signal:AbortSignal.timeout(10000)});assert.equal(ready.ready,true);
 const rows=processTable();senderTree=descendants(rows,ready.senderHostPid);persistentTree=descendants(rows,ready.persistentHostPid);
 assert.ok(senderTree.some(row=>row.ProcessId===ready.rootPid)&&senderTree.some(row=>row.ProcessId===ready.descendantPid));
 const blocked=once(parent,'message',{signal:AbortSignal.timeout(5000)});parent.send({block:true});assert.equal((await blocked)[0].blocked,true);
 const expired=once(parent,'message',{signal:AbortSignal.timeout(20000)});expired.catch(()=>{});
 const deadline=ready.end+2500;let senderState;
 do{senderState=observeTree(processTable(),senderTree);if(senderState.surviving===0&&senderState.unknown===0)break;await wait(100);}while(Date.now()<deadline);
 assert.equal(senderState.surviving,0,'native interval must remove every captured sender generation while owner is blocked');
 assert.equal(senderState.unknown,0,'missing identity fields are unknown until complete exit evidence');
 assert.ok(Date.now()<ready.end+7000,'observation must precede the owner unblocking');
 assert.equal(treeState(processTable(),persistentTree).surviving,persistentTree.length,'persistent SPX stand-in remains alive');
 assert.equal((await expired)[0].senderExit,WINDOW_EXPIRED_EXIT_CODE);
});


test('actual native sample mode is exact and cannot execute appended targets',windows,async t=>{
 const directory=temporary(t),marker=path.join(directory,'executed');
 const sample=execFileSync(JOB_HOST,['--sample-clock'],{encoding:'utf8',windowsHide:true,timeout:3000,maxBuffer:128});
 assert.match(sample,/^PIRAIDERS_CLOCK_V1 [0-9]+ [0-9]+\r?\n$/);
 assert.throws(()=>execFileSync(JOB_HOST,['--sample-clock',process.execPath,'-e','require("node:fs").writeFileSync(process.argv[1],"unsafe")',marker],{stdio:'ignore',windowsHide:true,timeout:3000}),error=>error.status===252);
 assert.equal(fs.existsSync(marker),false);
});
test('real sender restart reuses one native event cutoff rather than a new host budget',windows,async t=>{
 const end=Date.now()+6000;
 const policy=await createNativeWindowPolicy({start:new Date(Date.now()-1000).toISOString(),end:new Date(end).toISOString(),prewarmMinutes:0});
 const children=[];t.after(()=>{for(const child of children)child.stdin.end();});
 const first=spawnSupervisedProcess(process.execPath,['-e','setTimeout(()=>process.exit(0),800)'],{}, {productionWindow:policy});children.push(first);
 assert.equal((await once(first,'exit'))[0],0);
 const second=spawnSupervisedProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{}, {productionWindow:policy});children.push(second);
 assert.equal((await once(second,'exit',{signal:AbortSignal.timeout(10000)}))[0],WINDOW_EXPIRED_EXIT_CODE);
 assert.ok(Date.now()<end+3000,'restart must keep the original native cutoff');
});
