'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {setTimeout:wait}=require('node:timers/promises');
const {processTable,descendants,treeState}=require('../scripts/windows-process-evidence.cjs');
const stamp=638987654321000000n & ~127n;
function row(pid,parent,offset=pid,image='C:\\proof\\child.exe'){return{ProcessId:pid,ParentProcessId:parent,CreationUtcTicks:String(stamp+BigInt(offset)),ExecutablePath:image};}
const root=row(10,1,0,'C:\\proof\\host.exe');
test('process evidence captures unordered transitive generations with precision and immutable identities',()=>{
  const child=row(20,10,1),grandchild=row(30,20,2),rows=[grandchild,row(99,98),child,root];
  const captured=descendants(rows,10);assert.deepEqual(captured.map(v=>v.ProcessId),[10,20,30]);
  assert.equal(Number(root.CreationUtcTicks),Number(child.CreationUtcTicks),'fixture defeats rounded numeric identities');
  child.CreationUtcTicks=String(stamp+90n);assert.equal(captured[1].CreationUtcTicks,String(stamp+1n));assert.ok(Object.isFrozen(captured)&&captured.every(Object.isFrozen));
  assert.deepEqual(treeState([grandchild,root],captured),{tracked:3,surviving:2,reused:0,gone:1});
});
test('reused PID is not an old survivor, but an unchanged child remains a failure',()=>{
  const child=row(20,10,1),captured=descendants([root,child],10);
  assert.deepEqual(treeState([row(20,777,2)],captured),{tracked:2,surviving:0,reused:1,gone:1});
  assert.deepEqual(treeState([child],captured),{tracked:2,surviving:1,reused:0,gone:1});
  assert.deepEqual(treeState([],captured),{tracked:2,surviving:0,reused:0,gone:2});
});
test('stale parent PID cannot adopt an older unrelated process or its descendants',()=>{
  const old=row(20,10,-1),oldChild=row(30,20,2),realChild=row(40,10,1);
  const captured=descendants([oldChild,old,root,realChild],10);assert.deepEqual(captured.map(v=>v.ProcessId),[10,40]);
  assert.deepEqual(treeState([old,oldChild],captured),{tracked:2,surviving:0,reused:0,gone:2});
});
test('multiple captures deduplicate one generation and retain distinct generations of one PID',()=>{
  const oldChild=row(20,10,1),newChild=row(20,10,2);
  const captured=[...descendants([root,oldChild],10),...descendants([root,newChild],10)];
  assert.deepEqual(treeState([newChild],captured),{tracked:3,surviving:1,reused:1,gone:1});
});
test('missing, ambiguous or inconsistent identity evidence fails closed without private diagnostics',()=>{
  const child=row(20,10,1),captured=descendants([root,child],10);
  const bad=[{...child,CreationUtcTicks:null},{...child,CreationUtcTicks:Number(child.CreationUtcTicks)},{...child,CreationUtcTicks:'01'},{...child,CreationUtcTicks:'3155378976000000000'},{...child,ExecutablePath:null},{...child,ExecutablePath:'relative.exe'}];
  for(const broken of bad){
    assert.throws(()=>descendants([root,broken],10),{message:'PROCESS_IDENTITY_UNVERIFIED'});
    assert.throws(()=>treeState([broken],captured),{message:'PROCESS_IDENTITY_UNVERIFIED'});
  }
  for(const action of [()=>descendants([child],10),()=>descendants([root,root],10),()=>treeState([child,child],captured),()=>treeState([row(20,10,0)],captured),()=>treeState([{...child,ExecutablePath:'C:\\private\\other.exe'}],captured),()=>treeState([],[])])assert.throws(action,{message:'PROCESS_IDENTITY_UNVERIFIED'});
});
test('contradictory captured generation or live ancestry cannot be silently overwritten',()=>{
  const child=row(20,10,1),captured=descendants([root,child],10);
  for(const changed of [{...child,ParentProcessId:99},{...child,ExecutablePath:'C:\\different\\child.exe'}]){
    assert.throws(()=>treeState([],captured.concat(changed)),{message:'PROCESS_IDENTITY_UNVERIFIED'});
    assert.throws(()=>treeState([],captured.concat(changed,child)),{message:'PROCESS_IDENTITY_UNVERIFIED'});
    assert.throws(()=>treeState([changed],captured),{message:'PROCESS_IDENTITY_UNVERIFIED'});
  }
});
test('same Windows image case/slash aliases preserve generation identity',()=>{
  const captured=descendants([root,row(20,10,1,'C:/Proof/CHILD.exe')],10);
  assert.equal(treeState([row(20,10,1,'c:\\proof\\child.exe')],captured).surviving,1);
});
test('real Windows enumeration identifies a live child and proves its exit by generation',{skip:process.platform!=='win32'&&'Windows process enumeration only'},async t=>{
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  const exited=new Promise(resolve=>child.once('exit',resolve));
  t.after(async()=>{if(child.exitCode===null)child.kill();await exited;});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  const captured=descendants(processTable(),child.pid);
  assert.ok(captured.some(value=>value.ProcessId===child.pid));assert.equal(treeState(processTable(),captured).surviving,captured.length);
  child.kill();await exited;
  const deadline=Date.now()+10000;let remaining;
  do{remaining=treeState(processTable(),captured).surviving;if(!remaining)break;await wait(100);}while(Date.now()<deadline);
  assert.equal(remaining,0);
});
