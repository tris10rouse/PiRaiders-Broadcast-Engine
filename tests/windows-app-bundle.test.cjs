'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {findOwnedAppParent}=require('../scripts/smoke-windows-bundle.cjs');
const stamp=638987654321000000n,node='C:\\extracted package 鷹 !\\runtime\\node.exe';
const row=(pid,parent,offset,image)=>({ProcessId:pid,ParentProcessId:parent,CreationUtcTicks:String(stamp+BigInt(offset)),ExecutablePath:image});
function fixture(){return[
 row(10,1,0,'C:\\bundle\\JobHost.exe'),row(20,10,1,'C:\\Windows\\powershell.exe'),
 row(30,20,2,'C:\\Windows\\cmd.exe'),row(40,30,3,node),
 row(50,40,4,'C:\\bundle\\JobHost.exe'),row(60,50,5,node),
 row(70,60,6,node),row(80,777,7,node),
 // A retained numeric PPID from before this host generation must not be adopted.
 row(90,10,-1,node)
];}
test('extracted application proof selects exact CLI generation rather than SPX/nested Node or stale ancestry',()=>{
 const found=findOwnedAppParent(fixture().reverse(),10,node.replaceAll('\\','/').toUpperCase());
 assert.equal(found.parent.ProcessId,40);assert.ok(Object.isFrozen(found));
 assert.deepEqual(found.tree.map(row=>row.ProcessId),[10,20,30,40,50,60,70]);
 assert.equal(found.tree.some(row=>[80,90].includes(row.ProcessId)),false);
});
test('ambiguous or incomplete extracted application ownership refuses crash injection',()=>{
 const rows=fixture();assert.throws(()=>findOwnedAppParent([...rows,row(100,20,8,node)],10,node),/one exact bundled Node/);
 assert.throws(()=>findOwnedAppParent(rows.filter(row=>![50,60,70].includes(row.ProcessId)),10,node),/distinct owned processes/);
 assert.throws(()=>findOwnedAppParent(rows,10,'C:\\foreign\\node.exe'),/one exact bundled Node/);
 assert.throws(()=>findOwnedAppParent(rows.map(row=>row.ProcessId===40?{...row,CreationUtcTicks:null}:row),10,node),{message:'PROCESS_IDENTITY_UNVERIFIED'});
});
