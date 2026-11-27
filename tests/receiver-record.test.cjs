'use strict';
// Q-011: a failed probe request says whether the test-bench receiver died,
// hung or refused, with no path or machine name in what is kept.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {receiverRecord,MAX_LINES,MAX_LINE}=require('../scripts/lib/receiver-record.cjs');
const {requestProbe}=require('../scripts/ndi-proof-client.cjs');
const {receiver}=require('../scripts/smoke-full-app-windows.cjs');
const {receiverEvidence}=require('../scripts/soak-windows-job.cjs');

test('the record keeps fixed-word stderr lines, counts every other line and records the exit',()=>{
  let clock=1000;const record=receiverRecord(()=>clock);
  record.stderr(Buffer.from('NDI_PROBE_FAILED_PROBE_DEADLINE\r\nC:\\Users\\someone\\private\\file.dll not found\n'));
  record.stderr(Buffer.from('at host-name.example '));record.stderr(Buffer.from('more\nBUILD01\nNDI_PROBE_FAI'));
  assert.deepEqual(record.snapshot(),{running:true,exit:null,ageMs:0,stderrLines:['NDI_PROBE_FAILED_PROBE_DEADLINE'],stderrOtherLines:3,stderrOverlongLines:0,steps:[],stepsDropped:0,readyAfterMs:null});
  clock=481234.6;record.stderr('LED_CLEANUP');record.exited(1,null);record.exited(0,null);
  const done=record.snapshot();
  assert.deepEqual(done,{running:false,exit:{code:1,signal:null,afterMs:480235},ageMs:480235,stderrLines:['NDI_PROBE_FAILED_PROBE_DEADLINE','NDI_PROBE_FAILED_CLEANUP'],stderrOtherLines:3,stderrOverlongLines:0,steps:[],stepsDropped:0,readyAfterMs:null});
  assert.doesNotMatch(JSON.stringify(done),/Users|someone|private|host-name|example|BUILD01/);
  done.stderrLines.push('X');done.exit.code=9;assert.equal(record.snapshot().stderrLines.length,2,'a snapshot is a copy');assert.equal(record.snapshot().exit.code,1);
});

test('the record is bounded in lines and line length, keeps the last word after a long stderr, and keeps only fixed signals and integer codes',()=>{
  const record=receiverRecord(()=>0);
  for(let i=0;i<MAX_LINES+5;i++)record.stderr('NDI_PROBE_LINE_'+i+'\n');
  assert.deepEqual(record.snapshot().stderrLines,Array.from({length:MAX_LINES},(_,i)=>'NDI_PROBE_LINE_'+(i+5)));
  for(let i=0;i<40;i++)record.stderr(Buffer.alloc(4096,65));record.stderr('A\nNDI_PROBE_FAILED_LAST\nNDI_PROBE_'+'B'.repeat(MAX_LINE));
  record.exited(1,null);const after=record.snapshot();
  assert.equal(after.stderrLines.at(-1),'NDI_PROBE_FAILED_LAST','the last word survives a long stderr');assert.equal(after.stderrOverlongLines,2);assert.equal(after.stderrOtherLines,2);
  const crashed=receiverRecord(()=>0);crashed.exited(3221225477,null);assert.equal(crashed.snapshot().exit.code,3221225477);
  const odd=receiverRecord(()=>0);odd.exited(null,'SIG KILL /path');assert.deepEqual(odd.snapshot().exit,{code:null,signal:null,afterMs:0});
  const killed=receiverRecord(()=>0);killed.exited(null,'SIGTERM');assert.equal(killed.snapshot().exit.signal,'SIGTERM');
});

test('a refused probe connection carries the socket\'s fixed code',async()=>{
  const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  await assert.rejects(requestProbe(port,'t'.repeat(43),1,'frame',{},5000),error=>error.message==='PROBE_CONNECTION'&&error.socketCode==='ECONNREFUSED');
});

// A stand-in receiver speaking the probe's ready line and protocol. `frame`
// makes it drop the connection unanswered, then exit 1 a moment later with
// the probe's fixed failure word and one line that names a path.
const BENCH=`'use strict';
const net=require('node:net');
const server=net.createServer(socket=>{let text='';socket.on('data',chunk=>{text+=chunk;if(!text.includes('\\n'))return;
  const request=JSON.parse(text);if(request.token!==process.env.PIRAIDERS_NDI_PROBE_TOKEN){socket.end(JSON.stringify({id:request.id,ok:false,code:'TOKEN'})+'\\n');return;}
  if(request.command==='frame'){socket.destroy();server.close();setTimeout(()=>{process.stderr.write('NDI_PROBE_FAILED_PROBE_DEADLINE\\r\\n');process.stderr.write('D:\\\\a\\\\private\\\\bench\\\\runtime.dll\\n');process.exit(1);},400);return;}
  socket.end(JSON.stringify({id:request.id,ok:true})+'\\n');});});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({event:'ndi-probe-ready',port:server.address().port,abiValid:true,runtimeVersion:'bench'})));
process.stdin.resume();`;

test('a failed request waits briefly for the receiver to exit and carries its exit and fixed words; close fails with the same evidence',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'receiver-record-'));
  try{
    const script=path.join(dir,'bench-receiver.cjs');await fs.writeFile(script,BENCH);
    const probe=await receiver(dir,'unused.dll','label',dir,{executable:process.execPath,args:[script]});
    assert.deepEqual(await probe.request('discover',{},5000),{id:1,ok:true});
    assert.equal(probe.diagnostics().running,true);
    let lost;await assert.rejects(probe.request('frame',{},5000),error=>{lost=error;return true;});
    assert.match(lost.message,/^PROBE_(CLOSED|CONNECTION)$/);
    assert.equal(lost.receiver.running,false,'the receiver\'s exit was waited for');
    assert.equal(lost.receiver.exit.code,1);assert.deepEqual(lost.receiver.stderrLines,['NDI_PROBE_FAILED_PROBE_DEADLINE']);assert.equal(lost.receiver.stderrOtherLines,1);
    let refused;await assert.rejects(probe.request('frame',{},5000),error=>{refused=error;return true;});
    assert.equal(refused.message,'PROBE_CONNECTION');assert.equal(refused.socketCode,'ECONNREFUSED');assert.equal(refused.receiver.exit.code,1);
    const evidence=receiverEvidence(refused,null);
    assert.equal(evidence.socketCode,'ECONNREFUSED');assert.equal(evidence.receiver.exit.code,1);
    assert.doesNotMatch(JSON.stringify(evidence),/private|bench|runtime\.dll|[A-Z]:\\/);
    let closing;await assert.rejects(probe.close(),error=>{closing=error;return true;});
    assert.match(closing.message,/RECEIVER_CLOSE_FAILED/);assert.equal(closing.receiver.exit.code,1);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('the soak failure line falls back to the receiver\'s record now, and never takes an unfixed socket code',()=>{
  const probe={diagnostics:()=>({running:true,exit:null})};
  assert.deepEqual(receiverEvidence(Error('APP_STATE_HTTP'),probe),{socketCode:null,receiver:{running:true,exit:null}});
  assert.deepEqual(receiverEvidence(Object.assign(Error('PROBE_CONNECTION'),{socketCode:'connect C:\\x'}),undefined),{socketCode:null,receiver:null});
  assert.deepEqual(receiverEvidence(null,{diagnostics(){throw Error('x');}}),{socketCode:null,receiver:null});
});

// Q-001: the third RECEIVER_START_TIMEOUT (job 140538776524) left no receiver
// evidence. The receiver now says each start step on stderr in fixed words;
// the record keeps them with their time, a start timeout carries them, and the
// proofs' failure lines print them.
const {MAX_STEPS,STEP_LINE}=require('../scripts/lib/receiver-record.cjs');
test('Q-001: start step words are kept apart from failure words, each with its milliseconds after the spawn, bounded',()=>{
  let clock=100;const record=receiverRecord(()=>clock);
  clock=350;record.stderr('NDI_PROBE_STEP_MAIN\r\n');
  clock=2100;record.stderr('NDI_PROBE_STEP_RUNTIME_LOADED\nNDI_PROBE_FAILED_RUNTIME_INITIALIZE\n');
  let snap=record.snapshot();
  assert.deepEqual(snap.steps,[{step:'MAIN',afterMs:250},{step:'RUNTIME_LOADED',afterMs:2000}]);
  assert.deepEqual(snap.stderrLines,['NDI_PROBE_FAILED_RUNTIME_INITIALIZE'],'a step is not a failure word');
  assert.equal(snap.readyAfterMs,null);assert.equal(snap.stepsDropped,0);
  clock=2600;record.ready();clock=9000;record.ready();assert.equal(record.snapshot().readyAfterMs,2500,'the first ready counts');
  const many=receiverRecord(()=>0);for(let i=0;i<MAX_STEPS+3;i++)many.stderr('NDI_PROBE_STEP_S'+i+'\n');
  snap=many.snapshot();assert.equal(snap.steps.length,MAX_STEPS);assert.equal(snap.steps[0].step,'S0','the first steps are kept');assert.equal(snap.stepsDropped,3);
  snap.steps.push({step:'X'});assert.equal(many.snapshot().steps.length,MAX_STEPS,'a snapshot is a copy');
});

const STEPS_THEN_HANG=`process.stderr.write('NDI_PROBE_STEP_MAIN\\r\\nNDI_PROBE_STEP_RUNTIME_LOADED\\r\\nC:\\\\private\\\\runtime.dll\\n');
process.stdin.resume();process.stdin.on('end',()=>process.exit(1));`;
const SILENT=`process.stdin.resume();process.stdin.on('end',()=>process.exit(1));`;
test('Q-001: a start timeout carries the steps the receiver reached, or none when it never ran its first line',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'receiver-start-'));
  try{
    const hang=path.join(dir,'hang.cjs'),silent=path.join(dir,'silent.cjs');await fs.writeFile(hang,STEPS_THEN_HANG);await fs.writeFile(silent,SILENT);
    let timedOut;await assert.rejects(receiver(dir,'unused.dll','label',dir,{executable:process.execPath,args:[hang],startTimeoutMs:1500}),error=>{timedOut=error;return true;});
    assert.equal(timedOut.message,'RECEIVER_START_TIMEOUT');
    assert.deepEqual(timedOut.receiver.steps.map(s=>s.step),['MAIN','RUNTIME_LOADED']);
    assert.ok(timedOut.receiver.steps.every(s=>Number.isInteger(s.afterMs)&&s.afterMs>=0&&s.afterMs<1500));
    assert.equal(timedOut.receiver.readyAfterMs,null);assert.equal(timedOut.receiver.startTimeoutMs,1500);
    assert.doesNotMatch(JSON.stringify(receiverEvidence(timedOut,undefined)),/private|runtime\.dll|[A-Z]:\\/);
    let quiet;await assert.rejects(receiver(dir,'unused.dll','label',dir,{executable:process.execPath,args:[silent],startTimeoutMs:1000}),error=>{quiet=error;return true;});
    assert.equal(quiet.message,'RECEIVER_START_TIMEOUT');assert.deepEqual(quiet.receiver.steps,[]);
    assert.equal(receiverEvidence(quiet,undefined).receiver.startTimeoutMs,1000,'the failure line\'s helper keeps it');
    for(const bad of [0,1.5,20001,'5'])await assert.rejects(receiver(dir,'unused.dll','label',dir,{executable:process.execPath,args:[silent],startTimeoutMs:bad}),/RECEIVER_START_BOUND/,'no longer than the proof\'s 20 s');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('Q-001: a started receiver reports its start time and the default 20 s bound',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'receiver-ready-'));
  try{
    const script=path.join(dir,'bench-receiver.cjs');await fs.writeFile(script,BENCH);
    const probe=await receiver(dir,'unused.dll','label',dir,{executable:process.execPath,args:[script]});
    try{assert.ok(Number.isInteger(probe.startMs)&&probe.startMs>=0&&probe.startMs<20000);
      assert.equal(probe.diagnostics().readyAfterMs,probe.startMs);assert.equal(probe.diagnostics().startTimeoutMs,20000);}
    finally{probe.child.kill();await probe.child.closed;}
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('Q-001: the receiver says each start step, and the full-app and activation proofs print the receiver on failure and its start time on success',async()=>{
  const probeSource=await fs.readFile(path.join(__dirname,'..','native','windows','NdiProbe.cs'),'utf8');
  assert.match(probeSource,/static void Step\(string name\) \{ try \{ Console\.Error\.WriteLine\("NDI_PROBE_STEP_" \+ name\); \} catch \{ \} \}/);
  const inOrder=(text,words)=>{const at=words.map(w=>text.indexOf(w));assert.ok(at.every(i=>i>=0),words.join(' '));assert.deepEqual([...at].sort((a,b)=>a-b),at,words.join(' < '));};
  const init=probeSource.slice(probeSource.indexOf('private static string Initialize('),probeSource.indexOf('private static Dictionary<string, object> Stats('));
  inOrder(init,['LoadLibraryEx(','Step("RUNTIME_LOADED")','"NDIlib_initialize"','Step("RUNTIME_INITIALIZED")','createFinder(','Step("FINDER_CREATED")','return version;']);
  inOrder(probeSource.slice(probeSource.indexOf('private static int Main(')),['Step("MAIN")','Require(args.Length','Initialize(dll)','"ndi-probe-ready"']);
  for(const name of ['MAIN','RUNTIME_LOADED','RUNTIME_INITIALIZED','FINDER_CREATED'])assert.match('NDI_PROBE_STEP_'+name,STEP_LINE);
  for(const [file,failure,passed] of [['smoke-full-app-windows.cjs','full-app-proof-fixed-failure','actual-full-app-windows-proof-passed'],['smoke-exchange-activation-windows.cjs','exchange-activation-proof-fixed-failure','exchange-activation-windows-proof-passed']]){
    const text=await fs.readFile(path.join(__dirname,'..','scripts',file),'utf8');
    const at=text.indexOf("event:'"+failure+"'");assert.ok(at>0,file);
    assert.match(text.slice(at,at+1500),/receiver:[^,]*receiverEvidence\(error,probe\)\.receiver/,file+' failure line prints the receiver');
    const ok=text.indexOf("event:'"+passed+"'");assert.ok(ok>0,file+' passed report');
    assert.match(text.slice(ok,ok+3000),/receiverStartMs:probe\.startMs/,file+' passed report has the start time');
  }
});
