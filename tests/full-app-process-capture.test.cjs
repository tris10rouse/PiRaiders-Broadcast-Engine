'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {captureOwnedCaspar,capturePinnedTree,processCaptureDeadline,ownedCaspar}=require('../scripts/smoke-full-app-windows.cjs');
const {captureProcessTree,descendants,identityReason,observeTree}=require('../scripts/windows-process-evidence.cjs');
const host='C:\\bench\\JobHost.exe',caspar='C:\\bench\\casparcg.exe';
const row=(id,parent,ticks,image)=>({ProcessId:id,ParentProcessId:parent,CreationUtcTicks:String(ticks),ExecutablePath:image});
const control=row(99,1,90,'C:\\bench\\node.exe'),parent=row(10,1,100,'C:\\app\\node.exe');
function rows(){return[control,parent,row(12,10,110,'C:\\app\\node.exe'),row(13,12,120,host),row(14,13,130,caspar),row(15,14,140,'C:\\bench\\cef.exe')];}
const normalized=value=>require('node:path').win32.normalize(value).toLowerCase();
function harness(tables,deadline=30){let clock=0,calls=0;const stages=[],budgets=[];return{
 stages,budgets,clock:()=>clock,options:{deadline,jobHost:host,now:()=>clock,capture:async(pid,options)=>{
  stages.push({pid,...options});return captureProcessTree(pid,{...options,controlPid:99,pollMs:3,now:()=>clock,pause:async ms=>{clock+=ms;},readTable:async budget=>{budgets.push(budget);clock++;return tables[Math.min(calls++,tables.length-1)];}});
 }}};}
test('full-app sender capture pins CLI then selected JobHost under exactly one original budget',async()=>{
 const a=rows(),b=rows();a[5].ExecutablePath=null;b[5].CreationUtcTicks=null;b.push(row(16,14,141,'C:\\bench\\retired-cef.exe'));
 const h=harness([a,rows(),b,rows()]);const result=await captureOwnedCaspar(parent,caspar,h.options);
 assert.deepEqual(h.stages.map(value=>value.pid),[10,13]);assert.ok(h.stages.every(value=>value.deadline===30));
 assert.deepEqual(h.budgets,[30,26,25,21]);assert.deepEqual(h.stages[0].expectedRoot,parent);assert.equal(h.stages[1].expectedRoot.CreationUtcTicks,'120');
 assert.equal(h.stages[1].expectedParentPid,12);assert.equal(normalized(h.stages[1].expectedImage),normalized(host));
 assert.equal(result.root.ProcessId,14);assert.equal(result.host.ProcessId,13);assert.deepEqual(result.tree.map(value=>value.ProcessId),[13,14,16,15]);
 const cleaned=observeTree([control,parent],result.tree);assert.equal(cleaned.surviving,0);assert.equal(cleaned.unknown,0);assert.equal(cleaned.gone,4);
});
test('explicit absence requires a complete app snapshot and never captures an unowned host',async()=>{
 const h=harness([[control,parent]]);assert.equal(await captureOwnedCaspar(parent,caspar,{...h.options,allowAbsent:true}),null);assert.equal(h.stages.length,1);
 const invalid=rows();invalid[3].ExecutablePath='C:\\not-owned.exe';await assert.rejects(captureOwnedCaspar(parent,caspar,harness([invalid]).options),/OWNED_CASPAR_JOB_HOST/);
 const duplicate=rows();duplicate.push(row(16,13,150,caspar));await assert.rejects(captureOwnedCaspar(parent,caspar,harness([duplicate]).options),/OWNED_CASPAR_ROOT/);
});
test('sender or selected host generation changes cannot authorize a later kill target',async()=>{
 const hostChanged=rows();hostChanged[3].CreationUtcTicks='121';await assert.rejects(captureOwnedCaspar(parent,caspar,harness([rows(),hostChanged]).options),error=>identityReason(error)==='CAPTURE_GENERATION_CHANGED');
 const rootChanged=rows();rootChanged[4].CreationUtcTicks='131';await assert.rejects(captureOwnedCaspar(parent,caspar,harness([rows(),rootChanged]).options),/SENDER_GENERATION_CHANGED_DURING_CAPTURE/);
 const changedParent={...parent,CreationUtcTicks:'101'};await assert.rejects(captureOwnedCaspar(changedParent,caspar,harness([rows()]).options),error=>identityReason(error)==='CAPTURE_GENERATION_CHANGED');
});
test('persistent incomplete sender evidence exhausts the same shared deadline without cleanup success',async()=>{
 const incomplete=rows();incomplete[5].ExecutablePath=null;const h=harness([rows(),incomplete],12);
 await assert.rejects(captureOwnedCaspar(parent,caspar,h.options),error=>identityReason(error)==='IMAGE_MISSING');assert.equal(h.clock(),12);assert.equal(h.stages.length,2);
 assert.ok(h.budgets.at(-1)<h.budgets[0]);assert.throws(()=>ownedCaspar(incomplete,10,caspar,{jobHost:host}),/PROCESS_IDENTITY_UNVERIFIED/);
});
test('late complete stages and already expired budgets cannot return sender evidence',async()=>{
 let clock=0,calls=0;const snapshot={currentTree:descendants(rows(),10),tree:descendants(rows(),10)};
 await assert.rejects(captureOwnedCaspar(parent,caspar,{deadline:5,jobHost:host,now:()=>clock,capture:async()=>{calls++;clock=5;return snapshot;}}),/CAPTURE_BEFORE_DEADLINE/);assert.equal(calls,1);
 await assert.rejects(captureOwnedCaspar(parent,caspar,{deadline:0,now:()=>0,capture:async()=>{calls++;}}),/CAPTURE_BEFORE_DEADLINE/);assert.equal(calls,1);
});
test('window and outer recovery limits cap capture rather than extending the production or observation budget',()=>{
 const end='2026-11-16T12:00:00.000Z',wall=Date.parse(end),sample={monotonicNow:1000,wallNow:wall-100000};
 assert.equal(processCaptureDeadline(end,Infinity,sample),16000);assert.equal(processCaptureDeadline(end,9000,sample),9000);
 assert.equal(processCaptureDeadline(end,Infinity,{...sample,wallNow:wall-400}),1400);assert.equal(processCaptureDeadline(end,Infinity,{...sample,wallNow:wall+1}),1000);
 assert.equal(processCaptureDeadline(end,Infinity,{...sample,wallNow:wall-86400000}),16000,'clock rollback cannot increase15s per-capture total');
 assert.throws(()=>processCaptureDeadline('invalid',Infinity,sample),/CAPTURE_WINDOW_VALID/);
});
test('parent-loss capture passes the exact pinned CLI identity and preserves complete captured generations',async()=>{
 let options;const expected={tree:descendants(rows(),10)};const actual=await capturePinnedTree(parent,{deadline:77,capture:async(pid,value)=>{assert.equal(pid,10);options=value;return expected;}});
 assert.equal(actual,expected);assert.deepEqual(options,{deadline:77,expectedParentPid:1,expectedImage:parent.ExecutablePath,expectedRoot:parent});
});


test('synchronous ownership validation cannot return late evidence after the final native query',async()=>{
 let clock=0,stage=0;
 await assert.rejects(captureOwnedCaspar(parent,caspar,{deadline:5,jobHost:host,now:()=>clock,
  capture:async pid=>{stage++;const tree=descendants(rows(),pid);return{currentTree:tree,tree};},
  resolveImage:value=>{if(stage===2)clock=5;return normalized(value);}
 }),/CAPTURE_BEFORE_DEADLINE/);assert.equal(stage,2);
});
