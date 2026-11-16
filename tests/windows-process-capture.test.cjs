'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {captureProcessTree,descendants,observeTree,identityReason}=require('../scripts/windows-process-evidence.cjs');
const stamp=638987654321000000n;
function row(pid,parent,offset=pid,image='C:\\proof\\child.exe'){return{ProcessId:pid,ParentProcessId:parent,CreationUtcTicks:String(stamp+BigInt(offset)),ExecutablePath:image};}
const root=row(10,1,0,'C:\\proof\\host.exe'),control=row(99,90,1,'C:\\proof\\node.exe'),child=row(20,10,1),sibling=row(30,10,2);
function harness(observations,{deadline=15,queryCost=0,...overrides}={}){
 let clock=0,calls=0;const budgets=[],sleeps=[];
 const options={deadline,expectedParentPid:1,expectedImage:'C:/PROOF/HOST.exe',controlPid:99,pollMs:5,
  now:()=>clock,pause:async ms=>{sleeps.push(ms);clock+=ms;},
  readTable:async budget=>{budgets.push(budget);clock+=queryCost;const value=observations[Math.min(calls++,observations.length-1)];if(value instanceof Error)throw value;return value;},...overrides};
 return{capture:()=>captureProcessTree(10,options),calls:()=>calls,clock:()=>clock,budgets,sleeps};
}
function table(...rows){return[control,root,...rows];}
function reason(expected){return error=>error.message==='PROCESS_IDENTITY_UNVERIFIED'&&identityReason(error)===expected;}
test('preaction capture retries only incomplete observations within one shrinking command budget',async()=>{
 const h=harness([table({...child,ExecutablePath:null}),table({...child,CreationUtcTicks:null}),table(child)]);
 const result=await h.capture();assert.equal(h.calls(),3);assert.deepEqual(h.budgets,[15,10,5]);
 assert.deepEqual(result.currentTree,descendants(table(child),10));assert.deepEqual(result.tree,result.currentTree);assert.deepEqual(result.root,result.currentTree[0]);
 assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.tree)&&result.tree.every(Object.isFrozen));
 assert.equal(observeTree(table(child),result.tree).surviving,2);
});
test('positive control must be complete in successful query and cannot be omitted or substituted',async()=>{
 const h=harness([[{...control,ExecutablePath:null},root,child],table(child)]);assert.equal((await h.capture()).tree.length,2);
 await assert.rejects(harness([[root,child]]).capture(),reason('IDENTITY_MISSING'));
 await assert.rejects(harness([[{...control,CreationUtcTicks:null},root,{...child,ExecutablePath:null}], [{...control,ExecutablePath:'relative.exe'},root,child]]).capture(),reason('IMAGE_INVALID'));
});
test('fresh coherent absence resolves an incomplete candidate without inventing captured identity',async()=>{
 const h=harness([table({...child,ExecutablePath:null}),table()]),captured=await h.capture();
 assert.equal(h.calls(),2);assert.deepEqual(captured.tree.map(value=>value.ProcessId),[10]);
 assert.deepEqual(observeTree(table(),captured.tree),{tracked:1,surviving:1,reused:0,gone:0,unknown:0,reasons:[]});
});
test('complete previous owned children remain captured even if fresh table proves their absence',async()=>{
 const h=harness([table(child,{...sibling,ExecutablePath:null}),table()]),captured=await h.capture();
 assert.deepEqual(captured.currentTree.map(value=>value.ProcessId),[10]);assert.deepEqual(captured.tree.map(value=>value.ProcessId),[10,20]);
 assert.deepEqual(observeTree(table(),captured.tree),{tracked:2,surviving:1,reused:0,gone:1,unknown:0,reasons:[]});
});
test('persistent present incomplete descendants and root fields fail at immutable deadline',async()=>{
 for(const rows of [table({...child,ExecutablePath:null}),table({...child,CreationUtcTicks:null}),[control,{...root,CreationUtcTicks:null},child]]){
  const h=harness([rows]);await assert.rejects(h.capture(),error=>['IMAGE_MISSING','CREATION_MISSING'].includes(identityReason(error)));
  assert.equal(h.clock(),15);assert.equal(h.calls(),3);assert.deepEqual(h.budgets,[15,10,5]);
 }
});
test('expired or over-budget query never becomes a complete capture and pause never extends deadline',async()=>{
 const expired=harness([table(child)],{deadline:0});await assert.rejects(expired.capture(),reason('CAPTURE_DEADLINE'));assert.equal(expired.calls(),0);
 const late=harness([table(child)],{queryCost:15});await assert.rejects(late.capture(),reason('CAPTURE_DEADLINE'));assert.equal(late.calls(),1);
 const h=harness([table({...child,ExecutablePath:null})],{deadline:12});await assert.rejects(h.capture(),reason('IMAGE_MISSING'));assert.deepEqual(h.sleeps,[5,5,2]);assert.equal(h.clock(),12);
});
test('malformed table, row, identity and contradictory sibling fail immediately without retry',async()=>{
 const cases=[
  [null,'TABLE_INVALID'],[[root,root,control],'DUPLICATE_PID'],[table({...child,ParentProcessId:-1}),'ROW_INVALID'],
  [table({...child,CreationUtcTicks:null,ExecutablePath:'private-relative.exe'}),'IMAGE_INVALID'],
  [table({...child,CreationUtcTicks:'private-invalid',ExecutablePath:null}),'CREATION_INVALID'],
  [table({...child,ExecutablePath:null},{...sibling,ExecutablePath:'private-relative.exe'}),'IMAGE_INVALID'],
  [table({...child,ExecutablePath:null},{...sibling,CreationUtcTicks:'01'}),'CREATION_INVALID']
 ];
 for(const [rows,expected]of cases){const h=harness([rows]);await assert.rejects(h.capture(),reason(expected));assert.equal(h.calls(),1);assert.deepEqual(h.sleeps,[]);}
 const queryError=Error('PRIVATE query failure'),h=harness([queryError]);await assert.rejects(h.capture(),error=>error===queryError);assert.equal(h.calls(),1);
});
test('root initial owner and later generation must be verified rather than PID-only anchoring',async()=>{
 for(const modified of [{...root,ParentProcessId:888},{...root,ExecutablePath:'C:\\other\\host.exe'}])await assert.rejects(harness([[control,modified,child]]).capture(),reason('CAPTURE_ROOT_OWNER'));
 const expectedRoot=descendants(table(),10)[0];
 await assert.rejects(harness([table(child)],{expectedRoot:{...expectedRoot,CreationUtcTicks:String(stamp-1n)}}).capture(),reason('CAPTURE_GENERATION_CHANGED'));
 const h=harness([table({...child,ExecutablePath:null}),[control,{...root,CreationUtcTicks:String(stamp+100n)},child]]);
 await assert.rejects(h.capture(),reason('CAPTURE_GENERATION_CHANGED'));assert.equal(h.calls(),2);
 await assert.rejects(harness([table(child)],{expectedParentPid:undefined}).capture(),reason('CAPTURE_INVALID'));
});
test('retry cannot hide same-generation image/parent contradictions or backwards creation ticks',async()=>{
 for(const modified of [{...child,ExecutablePath:'C:\\other\\child.exe'},{...child,ParentProcessId:888},{...child,CreationUtcTicks:String(stamp)}]){
  const h=harness([table(child,{...sibling,ExecutablePath:null}),table(modified)]);
  await assert.rejects(h.capture(),error=>['LIVE_CONTRADICTION','CREATION_BACKWARDS'].includes(identityReason(error)));
 }
});
test('known generation contradictions cannot hide behind a different missing identity field',async()=>{
 const expectedRoot=descendants(table(),10)[0];
 const wrongRoot={...root,CreationUtcTicks:String(stamp+1n),ExecutablePath:null},h=harness([[control,wrongRoot]],{expectedRoot});
 await assert.rejects(h.capture(),reason('CAPTURE_GENERATION_CHANGED'));assert.equal(h.calls(),1);
 const backwards=harness([table(child,{...sibling,ExecutablePath:null}),table({...child,CreationUtcTicks:String(stamp),ExecutablePath:null})]);
 await assert.rejects(backwards.capture(),reason('CREATION_BACKWARDS'));assert.equal(backwards.calls(),2);
 const reusedControl=harness([table({...child,ExecutablePath:null}),[{...control,CreationUtcTicks:String(stamp+100n),ExecutablePath:null},root,child]]);
 await assert.rejects(reusedControl.capture(),reason('LIVE_CONTRADICTION'));assert.equal(reusedControl.calls(),2);
});
test('new complete descendant generation is retained separately; incomplete old generation cannot be substituted',async()=>{
 const newer={...child,CreationUtcTicks:String(stamp+100n),ExecutablePath:'C:\\new\\child.exe'};
 const h=harness([table(child,{...sibling,ExecutablePath:null}),table(newer)]),captured=await h.capture();
 assert.equal(captured.tree.filter(value=>value.ProcessId===20).length,2);assert.equal(observeTree(table(newer),captured.tree).reused,1);
 await assert.rejects(harness([table({...child,ExecutablePath:null}),table(newer)]).capture(),reason('CAPTURE_GENERATION_CHANGED'));
});
test('stale parent PID cannot adopt older process generations into a successful capture',async()=>{
 const old=row(20,10,-1),grandchild=row(30,20,2),h=harness([table(old,grandchild)]);
 assert.deepEqual((await h.capture()).tree.map(value=>value.ProcessId),[10]);
});
test('preaction tolerance does not relax strict descendants or unknown/surviving cleanup rules',async()=>{
 const incomplete=table({...child,ExecutablePath:null});assert.throws(()=>descendants(incomplete,10),reason('IMAGE_MISSING'));
 const result=await harness([table(child)]).capture(),unknown=observeTree(incomplete,result.tree);
 assert.equal(unknown.unknown,1);assert.equal(unknown.surviving,1);assert.notEqual(unknown.unknown+unknown.surviving,0);
 assert.equal(observeTree(table(child),result.tree).surviving,2);
});
test('default monotonic capture deadline survives a backwards wall-clock adjustment',{timeout:5000},async t=>{
 const original=Date.now,started=performance.now(),deadline=started+25,budgets=[];let calls=0;
 t.after(()=>{Date.now=original;});
 Date.now=()=>original()-24*60*60*1000;
 await assert.rejects(captureProcessTree(10,{deadline,expectedParentPid:1,expectedImage:'C:\\proof\\host.exe',controlPid:99,pollMs:5,readTable:async budget=>{calls++;budgets.push(budget);return table({...child,ExecutablePath:null});}}),reason('IMAGE_MISSING'));
 assert.ok(calls>=1);assert.ok(performance.now()>=deadline);assert.ok(budgets.every(value=>value<=25));
 assert.ok(budgets.every((value,index)=>index===0||value<=budgets[index-1]),'retry queries retain the shrinking original budget');
});
test('real Windows bounded preaction capture proves a live child generation and its later cleanup',{skip:process.platform!=='win32'&&'Requires real Windows CIM enumeration',timeout:45000},async t=>{
 const{spawn}=require('node:child_process'),{setTimeout:wait}=require('node:timers/promises');
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'}),closed=new Promise(resolve=>child.once('close',resolve));
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();await closed;});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
 const captured=await captureProcessTree(child.pid,{deadline:performance.now()+15000,expectedParentPid:process.pid,expectedImage:process.execPath});
 assert.equal(captured.root.ProcessId,child.pid);assert.equal(captured.root.ParentProcessId,process.pid);assert.ok(captured.tree.length>=1);
 child.kill();await closed;
 const{processTable}=require('../scripts/windows-process-evidence.cjs'),deadline=Date.now()+10000;let state;
 do{state=observeTree(processTable(),captured.tree);if(state.surviving===0&&state.unknown===0)break;await wait(100);}while(Date.now()<deadline);
 assert.equal(state.surviving,0);assert.equal(state.unknown,0);
});
