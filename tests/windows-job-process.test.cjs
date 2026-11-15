'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { assertJobHostAvailable, createNativeWindowPolicy, spawnSupervisedProcess } = require('../scripts/lib/windows-job-process.cjs');

test('Windows containment fails closed when helper is missing', () => {
  let spawned = false;
  assert.throws(() => spawnSupervisedProcess('target.exe', [], {}, {
    platform: 'win32', hostPath: path.join(os.tmpdir(), 'missing-job-host-' + process.pid, 'host.exe'),
    spawnProcess: () => { spawned = true; }
  }), /containment helper missing/);
  assert.equal(spawned, false);
});
test('Windows wrapper preserves argv and keeps a private lifetime pipe without shell fallback', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-adapter-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const hostPath = path.join(dir, 'host.exe'); fs.writeFileSync(hostPath, 'mock binary');
  const args = ['', 'a b', 'a"b', 'trailing\\', 'Unicode: 鷹', '&|%$'];
  let invocation;
  const child = { stdin: new EventEmitter() };
  const result = spawnSupervisedProcess('C:\\Program Files\\target.exe', args, { cwd: dir, shell: true, detached: true }, {
    platform: 'win32', hostPath, spawnProcess: (...values) => { invocation = values; return child; }
  });
  assert.strictEqual(result, child);
  assert.equal(invocation[0], hostPath);
  assert.deepEqual(invocation[1], ['C:\\Program Files\\target.exe', ...args]);
  assert.deepEqual(invocation[2].stdio, ['pipe', 'inherit', 'inherit']);
  assert.equal(invocation[2].shell, false);
  assert.equal(invocation[2].windowsHide, true);
  assert.equal(invocation[2].detached, undefined);
  assert.equal(invocation[2].cwd, dir);
  assert.doesNotThrow(() => child.stdin.emit('error', Error('pipe closed')));
  assert.throws(() => spawnSupervisedProcess('target.exe', ['bad\0argument'], {}, { platform: 'win32', hostPath }), /Invalid contained/);
});
test('non-Windows processes retain direct spawning without a native helper', () => {
  const options = { cwd: '.', shell: false, stdio: 'inherit' };
  const args = ['server.js']; let invocation;
  const child = {};
  assertJobHostAvailable({ platform: 'linux', hostPath: 'missing' });
  assert.strictEqual(spawnSupervisedProcess('node', args, options, {
    platform: 'linux', spawnProcess: (...values) => { invocation = values; return child; }
  }), child);
  assert.deepEqual(invocation, ['node', args, options]);
});
test('private Windows stdin forwarding is explicit and captures native output',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'job-private-adapter-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const hostPath=path.join(dir,'host.exe');fs.writeFileSync(hostPath,'mock binary');let invocation;
  const child={stdin:new EventEmitter()};spawnSupervisedProcess('C:\\Caspar\\casparcg.exe',['private.config'],{}, {platform:'win32',hostPath,forwardStdin:true,spawnProcess:(...args)=>{invocation=args;return child;}});
  assert.deepEqual(invocation[1],['--forward-stdin','C:\\Caspar\\casparcg.exe','private.config']);assert.deepEqual(invocation[2].stdio,['pipe','pipe','pipe']);
  assert.throws(()=>spawnSupervisedProcess('node',[],{}, {platform:'linux',forwardStdin:true}),/requires Windows containment/);assert.throws(()=>spawnSupervisedProcess('node',[],{}, {forwardStdin:'yes'}),/Invalid stdin forwarding/);
});


function nativeFixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'job-window-adapter-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const hostPath=path.join(dir,'host.exe');fs.writeFileSync(hostPath,'explicit synthetic OS boundary');
  const raw={start:'2026-11-15T18:00:00-06:00',end:'2026-11-15T19:00:00-06:00'};
  const utc=Date.parse(raw.start),calls=[];
  return {hostPath,raw,utc,calls,execFileCall:(...args)=>{calls.push(args);setImmediate(()=>args[3](null,'PIRAIDERS_CLOCK_V1 1000 '+utc+'\n'));}};
}
test('one trusted native sample creates an immutable timezone-normalized event cutoff reused on every host restart',async t=>{
  const f=nativeFixture(t),policy=await createNativeWindowPolicy(f.raw,{platform:'win32',hostPath:f.hostPath,execFileCall:f.execFileCall});
  assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].slice(0,3),[f.hostPath,['--sample-clock'],{encoding:'utf8',timeout:2000,maxBuffer:128,windowsHide:true,shell:false}]);
  assert.equal(policy.beginMs,Date.parse(f.raw.start)-15*60000);assert.equal(policy.endMs,Date.parse(f.raw.end));assert.equal(policy.anchorTick,1000);assert.equal(policy.deadlineTick,1000+3600000-1);assert.equal(Object.isFrozen(policy),true);
  const invocations=[];f.raw.end='2027-01-01T00:00:00Z';
  for(let restart=0;restart<3;restart++){
    const child={stdin:new EventEmitter()};spawnSupervisedProcess('C:\\Caspar\\casparcg.exe',['private.config'],{}, {platform:'win32',hostPath:f.hostPath,forwardStdin:true,productionWindow:policy,spawnProcess:(...args)=>{invocations.push(args);return child;}});
  }
  assert.equal(f.calls.length,1,'sender restart must never resample its event deadline');
  for(const invocation of invocations)assert.deepEqual(invocation[1],['--forward-stdin','--production-window',String(policy.beginMs),String(policy.endMs),'1000',String(policy.deadlineTick),'C:\\Caspar\\casparcg.exe','private.config']);
  for(const productionWindow of [{...policy},f.raw,null])assert.throws(()=>spawnSupervisedProcess('C:\\safe.exe',[],{}, {platform:'win32',hostPath:f.hostPath,productionWindow}),/Unverified native/);
  assert.throws(()=>spawnSupervisedProcess('node',[],{}, {platform:'linux',productionWindow:policy}),/requires Windows containment/);
});
test('native sample rejects malformed, overflowing or failed clock protocols without copying native error text',async t=>{
 const f=nativeFixture(t);
 for(const output of ['',null,'PIRAIDERS_CLOCK_V1 -1 1000\n','PIRAIDERS_CLOCK_V1 01 1000\n','PIRAIDERS_CLOCK_V1 1 1000','PIRAIDERS_CLOCK_V1 1 1000\nPRIVATE','PIRAIDERS_CLOCK_V1 9007199254740992 '+f.utc+'\n','PIRAIDERS_CLOCK_V1 9007199254740991 '+f.utc+'\n','PIRAIDERS_CLOCK_V1 1 253402300800000\n','PIRAIDERS_CLOCK_V1 1 -62135596800001\n']){
  await assert.rejects(createNativeWindowPolicy(f.raw,{platform:'win32',hostPath:f.hostPath,execFileCall:(exe,args,opts,done)=>done(null,output)}),error=>error.message==='Native clock sample invalid');
 }
 await assert.rejects(createNativeWindowPolicy(f.raw,{platform:'win32',hostPath:f.hostPath,execFileCall:(exe,args,opts,done)=>done(Error('PRIVATE native path and stderr'))}),error=>error.message==='Native clock sample failed');
 const expired=await createNativeWindowPolicy(f.raw,{platform:'win32',hostPath:f.hostPath,execFileCall:(exe,args,opts,done)=>done(null,'PIRAIDERS_CLOCK_V1 1000 '+(Date.parse(f.raw.end)+100)+'\n')});
 assert.equal(expired.deadlineTick,expired.anchorTick,'expired sample cannot receive a new positive lifetime');
});
test('production profiles cannot supply clock controls or bypass native policy sampling',async t=>{
 const f=nativeFixture(t);let sampled=false;const execFileCall=()=>{sampled=true;};
 for(const raw of [null,[],{...f.raw,testMode:true},{...f.raw,anchorTick:100},{...f.raw,[Symbol('clock')]:1},{...f.raw,end:f.raw.start},{start:'2026-11-15T18:00:00',end:f.raw.end},{...f.raw,prewarmMinutes:61}])await assert.rejects(createNativeWindowPolicy(raw,{platform:'win32',hostPath:f.hostPath,execFileCall}));
 assert.equal(sampled,false);
 await assert.rejects(createNativeWindowPolicy(f.raw,{platform:'linux',hostPath:f.hostPath}),/requires Windows containment/);
});

test('sampling is asynchronous and does not spawn a sender while its bounded native read is pending',async t=>{
 const f=nativeFixture(t);let finish,settled=false;
 const pending=createNativeWindowPolicy(f.raw,{platform:'win32',hostPath:f.hostPath,execFileCall:(exe,args,opts,done)=>{finish=done;}}).then(value=>{settled=true;return value;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
 finish(null,'PIRAIDERS_CLOCK_V1 1000 '+f.utc+'\n');assert.equal((await pending).anchorTick,1000);
});
