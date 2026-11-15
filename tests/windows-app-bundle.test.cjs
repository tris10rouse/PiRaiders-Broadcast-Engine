'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {findOwnedAppParent:selectActual}=require('../scripts/smoke-windows-bundle.cjs');
// Pure process-table tests inject only filesystem identity; no native result is simulated.
const findOwnedAppParent=(rows,pid,image)=>selectActual(rows,pid,image,{realpath:value=>value});
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


test('both executable spellings resolve before comparison and aliasing cannot hide a second root',()=>{
 const alias='C:\\EXTRAC~1\\runtime\\node.exe',rows=fixture().map(row=>[40,60,70].includes(row.ProcessId)?{...row,ExecutablePath:alias}:row),seen=[];
 const canonical=value=>{seen.push(value);return value.toLowerCase()===alias.toLowerCase()?node:value;};
 const found=selectActual(rows,10,node,{realpath:canonical});assert.equal(found.parent.ProcessId,40);assert.ok(seen.some(value=>value.toLowerCase()===alias.toLowerCase())&&seen.includes(node));
 const namespaced=value=>value.toLowerCase()===alias.toLowerCase()?"\\\\?\\"+node:value;
 assert.equal(selectActual(rows,10,node,{realpath:namespaced}).parent.ProcessId,40);
 assert.throws(()=>selectActual(rows.concat(row(100,20,8,alias)),10,node,{realpath:canonical}),/one exact bundled Node/);
 assert.throws(()=>selectActual(rows,10,node,{realpath:()=>{throw Error('private path unavailable');}}),{message:'APP_IMAGE_IDENTITY_UNVERIFIED'});
 assert.throws(()=>selectActual(rows,10,node,{realpath:()=> 'relative.exe'}),{message:'APP_IMAGE_IDENTITY_UNVERIFIED'});
});
