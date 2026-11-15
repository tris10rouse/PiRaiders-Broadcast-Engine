'use strict';
// Run from repository root. Integrator may change these two imports to ../scripts
// when moving this isolated draft into tests/.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, fork } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { JOB_HOST } = require('../scripts/lib/windows-job-process.cjs');
const { terminateProcessTree } = require('../scripts/lib/windows-process-tree.cjs');
const windows = {
  skip: process.platform !== 'win32' && 'Requires actual Windows JobHost private stdin and Job Objects; no simulated native result',
  timeout: 45000
};
const DEADLINE_MS = 10000;
// Less than the native 32 * 4KiB queued bound, but larger than its target pipe
// capacity: an unread target can block the writer without causing overflow.
const BACKLOG_BYTES = 32 * 1024;
const fixtureSource = String.raw`
'use strict';
const fs = require('node:fs');
const {spawn,fork}=require('node:child_process');
const [mode,file,arg,extra]=process.argv.slice(2);
setTimeout(()=>process.exit(90),30000);
function atomic(target,bytes){fs.writeFileSync(target+'.partial',bytes);fs.renameSync(target+'.partial',target);}
if(mode==='descendant'){
  process.send({pid:process.pid});
}else if(mode==='root'){
  const descendant=fork(__filename,['descendant'],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
  descendant.once('error',()=>process.exit(91));
  descendant.once('message',value=>{
    atomic(file,JSON.stringify({rootPid:process.pid,descendantPid:value.pid}));
    if(arg==='crash'){
      const timer=setInterval(()=>{if(fs.existsSync(file+'.crash')){clearInterval(timer);process.exit(17);}},10);
    }
  });
  if(arg==='read'){
    const pieces=[];let count=0,written=false;
    process.stdin.on('data',bytes=>{pieces.push(bytes);count+=bytes.length;if(!written&&count>=Number(extra)){written=true;atomic(file+'.bytes',Buffer.concat(pieces));}});
    process.stdin.on('end',()=>atomic(file+'.eof',Buffer.concat(pieces)));
    process.stdin.on('error',()=>process.exit(92));
  }
  // hold/crash intentionally never read/resume stdin.
}else if(mode==='launcher'){
  const host=spawn(arg,['--forward-stdin',process.execPath,__filename,'root',file,'hold'],{windowsHide:true,shell:false,stdio:['pipe','ignore','ignore']});
  host.stdin.on('error',()=>{});
  host.once('error',()=>process.exit(93));
  host.once('spawn',()=>process.send({type:'host',hostPid:host.pid}));
  let finished=false;
  const poll=setInterval(()=>{
    if(finished)return;
    let state;try{state=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return;}
    finished=true;clearInterval(poll);
    // Notify the outer test only after descendants exist and input has entered
    // the host's pipe. Killing this launcher must then be detected despite the
    // target never draining the separate forwarded-stdin writer.
    host.stdin.write(Buffer.alloc(Number(extra),83),error=>{
      if(error)process.exit(94);
      setTimeout(()=>process.send({type:'armed',hostPid:host.pid,...state}),100);
    });
  },10);
}
`;
function alive(pid) {
  try { process.kill(pid,0);return true; }
  catch(error) {if(error.code==='ESRCH')return false;throw error;}
}
async function deadline(promise,label,ms=DEADLINE_MS){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' exceeded '+ms+'ms')),ms);})]);}
  finally{clearTimeout(timer);}
}
async function gone(pid){
  const end=Date.now()+DEADLINE_MS;
  while(alive(pid)&&Date.now()<end)await delay(20);
  assert.equal(alive(pid),false,'test-owned PID '+pid+' must be gone within10s');
}
async function readAtomic(file,host){
  const end=Date.now()+DEADLINE_MS;
  while(Date.now()<end){
    try{return fs.readFileSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(host.exitCode!==null||host.signalCode!==null)throw Error('Host exited before fixture handshake: '+host.exitCode);
    await delay(20);
  }
  throw Error('Fixture handshake exceeded10s');
}
function resources(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'PiRaiders private stdin 鷹 ')),owned=new Set();
  const fixture=path.join(dir,'fixture.cjs');fs.writeFileSync(fixture,fixtureSource);
  t.after(async()=>{
    // Only direct children and PIDs delivered by the test-owned handshake.
    for(const pid of owned){
      if(!alive(pid))continue;
      try{await terminateProcessTree({pid,kill(){}});}catch(error){if(alive(pid))throw error;}
    }
    // Async removal yields to pending child-stream close callbacks on Windows.
    // Process/tree deadlines above remain strict and independent of file cleanup.
    await fs.promises.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:50});
  });
  return{dir,fixture,file:path.join(dir,'state.json'),owned};
}
async function start(t,{forward=true,mode='hold',expected=0}={}){
  const r=resources(t);
  const host=spawn(JOB_HOST,[...(forward?['--forward-stdin']:[]),process.execPath,r.fixture,'root',r.file,mode,String(expected)],{cwd:r.dir,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  const errors=[],stderr=[],stdout=[];let stderrBytes=0,stdoutBytes=0;
  host.on('error',error=>errors.push(error));host.stdin.on('error',()=>{});
  host.stderr.on('data',bytes=>{stderrBytes+=bytes.length;if(stderrBytes<=16384)stderr.push(bytes);});
  host.stdout.on('data',bytes=>{stdoutBytes+=bytes.length;if(stdoutBytes<=16384)stdout.push(bytes);});
  if(host.pid)r.owned.add(host.pid);
  const exit=once(host,'exit');exit.catch(()=>{});
  const state=JSON.parse((await readAtomic(r.file,host)).toString('utf8'));
  for(const pid of [state.rootPid,state.descendantPid]){assert.ok(Number.isSafeInteger(pid)&&pid>0);r.owned.add(pid);}
  assert.deepEqual(errors,[]);
  assert.ok(alive(state.rootPid)&&alive(state.descendantPid),'root and descendant handshake precedes input');
  return{...r,host,state,exit,stderr,stdout};
}
async function backlog(host){
  await deadline(new Promise((resolve,reject)=>host.stdin.write(Buffer.alloc(BACKLOG_BYTES,83),error=>error?reject(error):resolve())),'backlog admission');
  await delay(100);
}
async function assertTreeGone(state){await Promise.all([gone(state.rootPid),gone(state.descendantPid)]);}

test('Windows default containment keeps service stdin NUL while lifetime input stays private',windows,async t=>{
  const f=await start(t,{forward:false,mode:'read',expected:100});
  f.host.stdin.write(Buffer.from('SYNTHETIC_PRIVATE_INPUT_MUST_NOT_REACH_DEFAULT_TARGET'));
  assert.deepEqual(await readAtomic(f.file+'.eof',f.host),Buffer.alloc(0));
  assert.equal(alive(f.state.rootPid),true,'target EOF is not launcher EOF');
  f.host.stdin.end();const [code]=await deadline(f.exit,'default lifetime EOF');assert.equal(code,252);await assertTreeGone(f.state);
});

test('Windows opt-in stdin preserves exact UTF16LE private bytes across fragmented writes',windows,async t=>{
  const payload=Buffer.from('\ufeffPLAY 1-10 [HTML] "private://SYNTHETIC_ONLY_鷹_🏴‍☠️"\r\nNEXT\r\n','utf16le');
  const f=await start(t,{mode:'read',expected:payload.length});
  const widths=[1,3,2,7,1,5];let offset=0,index=0;
  while(offset<payload.length){const end=Math.min(payload.length,offset+widths[index++%widths.length]);await deadline(new Promise((resolve,reject)=>f.host.stdin.write(payload.subarray(offset,end),error=>error?reject(error):resolve())),'fragment write');offset=end;await delay(2);}
  assert.deepEqual(await readAtomic(f.file+'.bytes',f.host),payload);
  for(const chunks of [f.stdout,f.stderr]){const output=Buffer.concat(chunks);assert.equal(output.includes(Buffer.from('SYNTHETIC_ONLY')),false,'native output contains no decoded input echo');assert.equal(output.includes(Buffer.from('SYNTHETIC_ONLY','utf16le')),false,'native output contains no raw UTF16 input echo');}
  f.host.stdin.end();const [code]=await deadline(f.exit,'forwarded EOF');assert.equal(code,252);await assertTreeGone(f.state);
});

test('Windows unread forwarded target fails closed on bounded queue overflow',windows,async t=>{
  const f=await start(t);
  // At most2MiB of test-owned buffered writes, never an unbounded pump. A
  // separate reader must reject overflow instead of waiting behind the writer.
  const block=Buffer.alloc(16*1024,83);
  for(let bytes=0;bytes<2*1024*1024;bytes+=block.length){
    if(f.host.exitCode!==null||f.host.signalCode!==null||f.host.stdin.destroyed)break;
    try{f.host.stdin.write(block);}catch(error){if(error.code!=='EPIPE'&&error.code!=='ERR_STREAM_DESTROYED')throw error;break;}
    await delay(2);
  }
  const [code]=await deadline(f.exit,'forward queue overflow');assert.equal(code,252);
  assert.equal(alive(f.state.descendantPid),false,'descendant cleanup precedes diagnostic host exit');await assertTreeGone(f.state);
});

test('Windows launcher EOF terminates tree despite unread forwarded input backlog',windows,async t=>{
  const f=await start(t);await backlog(f.host);
  assert.equal(alive(f.state.rootPid),true);
  f.host.stdin.end();const [code]=await deadline(f.exit,'EOF with unread backlog');assert.equal(code,252);
  assert.equal(alive(f.state.descendantPid),false);await assertTreeGone(f.state);
});

test('Windows abrupt launcher death terminates forwarded-input tree despite unread backlog',windows,async t=>{
  const r=resources(t),launcher=fork(r.fixture,['launcher',r.file,JOB_HOST,String(BACKLOG_BYTES)],{cwd:r.dir,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
  r.owned.add(launcher.pid);const launcherExit=once(launcher,'exit');launcherExit.catch(()=>{});
  const ready=new Promise((resolve,reject)=>{
    launcher.on('error',reject);
    launcher.on('message',message=>{
      if(message.type==='host'){assert.ok(Number.isSafeInteger(message.hostPid)&&message.hostPid>0);r.owned.add(message.hostPid);}
      if(message.type==='armed')resolve(message);
    });
    launcher.once('exit',()=>reject(Error('Fixture launcher exited before armed handshake')));
  });
  const state=await deadline(ready,'blocked-writer launcher handshake');
  for(const pid of [state.hostPid,state.rootPid,state.descendantPid]){assert.ok(Number.isSafeInteger(pid)&&pid>0);r.owned.add(pid);}
  assert.ok(alive(state.rootPid)&&alive(state.descendantPid));
  launcher.kill('SIGKILL');await deadline(launcherExit,'test launcher death');
  await Promise.all([gone(state.hostPid),gone(state.rootPid),gone(state.descendantPid)]);
});

test('Windows service-root crash closes descendants while forwarded writer is blocked',windows,async t=>{
  const f=await start(t,{mode:'crash'});await backlog(f.host);
  fs.writeFileSync(f.file+'.crash','crash');
  const [code]=await deadline(f.exit,'root crash with unread backlog');
  // Root17 and concurrently broken-pipe252 are both fail-closed outcomes. The
  // unchanged default-mode tests separately require exact root17 propagation.
  assert.ok(code===17||code===252,'root crash must not be reported successful');
  assert.equal(alive(f.state.descendantPid),false,'descendant gone before host exit');await assertTreeGone(f.state);
});

test('Windows kill-on-close still owns forwarded-input descendants after host-only kill',windows,async t=>{
  const f=await start(t);await backlog(f.host);
  f.host.kill('SIGKILL');await deadline(f.exit,'host-only kill');await assertTreeGone(f.state);
});
