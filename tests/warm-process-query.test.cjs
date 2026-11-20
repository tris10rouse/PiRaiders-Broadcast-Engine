'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {WARM_TIMEOUT_MS,warmProcessQuery}=require('../scripts/warm-process-query.cjs');
const root=path.resolve(__dirname,'..');
const clock=(...values)=>()=>values.shift();
const table=JSON.stringify([{ProcessId:10,ParentProcessId:1,ExecutablePath:'C:\\synthetic\\host.exe',CreationUtcTicks:'638987654321000000'}]);

test('the warm-up runs the query once with its own bound and reports only elapsed time and a row count',async()=>{
  const calls=[];
  const result=await warmProcessQuery({run:async ms=>{calls.push(ms);return table;},now:clock(1000,4321.4)});
  assert.deepEqual(calls,[WARM_TIMEOUT_MS]);assert.ok(WARM_TIMEOUT_MS>15000,'longer than the proof’s capture bound');
  assert.deepEqual(result,{event:'process-query-warmed',elapsedMs:3321,rows:1});
  assert.equal(JSON.stringify(result).includes('synthetic'),false,'no path leaves the warm-up');
});
test('a killed, missing, failed or malformed query is a fixed failure kind with no private text',async()=>{
  const cases=[[Object.assign(Error('C:\\synthetic\\secret'),{killed:true}),'CHILD_KILLED'],[Object.assign(Error('spawn powershell.exe ENOENT'),{code:'ENOENT'}),'POWERSHELL_MISSING'],
    [Object.assign(Error('C:\\synthetic\\secret'),{code:1}),'CHILD_EXIT'],[Error('C:\\synthetic\\secret'),'QUERY_FAILED']];
  for(const[error,kind]of cases){
    const result=await warmProcessQuery({run:async()=>{throw error;},now:clock(0,90000)});
    assert.deepEqual(result,{event:'process-query-warm-failed',kind,elapsedMs:90000});
  }
  for(const raw of ['not json','[]','{}'])assert.equal((await warmProcessQuery({run:async()=>raw,now:clock(0,5)})).kind,'TABLE_INVALID');
});
test('the console proof workflow warms the process query immediately before the proof step',()=>{
  const text=fs.readFileSync(path.join(root,'.github/workflows/caspar-console-proof.yml'),'utf8').replace(/\r\n/g,'\n');
  const runs=[...text.matchAll(/^\s+run: (.+)$/gm)].map(m=>m[1].trim());
  const proof=runs.indexOf('node scripts/smoke-caspar-console-windows.cjs');
  assert.ok(proof>0,'the proof step exists');assert.equal(runs[proof-1],'node scripts/warm-process-query.cjs');
});
