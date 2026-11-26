'use strict';
// Q-012: the soak's test-bench NDI SDK receiver lives for the whole planned run
// plus its close; every other proof keeps the receiver's 8-minute default. The
// receiver itself (native/windows/NdiProbe.cs) is compiled and run only on
// hosted Windows; these tests check the Node side, the stand-in's arguments and
// that the C# source carries the same numbers. They never claim Windows.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {readFileSync}=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const lifetime=require('../scripts/lib/receiver-lifetime.cjs');
const soak=require('../scripts/soak-proof.cjs');
const {receiver}=require('../scripts/smoke-full-app-windows.cjs');
const root=path.join(__dirname,'..');

test('the soak asks for its run plus a 30-minute margin, never more than the five-hour ceiling plus that margin',()=>{
  assert.equal(lifetime.DEFAULT_MINUTES,8);assert.equal(lifetime.MARGIN_MINUTES,30);assert.equal(lifetime.MAX_MINUTES,330);
  assert.equal(lifetime.soakReceiverLifetime(soak.soakPlan({durationMs:5*60000,checkRun:true})),35);
  assert.equal(lifetime.soakReceiverLifetime(soak.soakPlan()),270,'the four-hour soak');
  assert.equal(lifetime.soakReceiverLifetime(soak.soakPlan({durationMs:soak.MAX_SOAK_MS})),330);
  for(const plan of [null,{},{durationMs:0},{durationMs:-60000},{durationMs:1.5},{durationMs:soak.MAX_SOAK_MS+60000}])
    assert.throws(()=>lifetime.soakReceiverLifetime(plan),{code:'RECEIVER_LIFETIME_INVALID'});
});

test('a bad lifetime fails closed before any receiver starts; no lifetime passes no argument',()=>{
  assert.deepEqual(lifetime.lifetimeArgs(undefined),[]);
  assert.deepEqual(lifetime.lifetimeArgs(8),['8']);assert.deepEqual(lifetime.lifetimeArgs(330),['330']);
  for(const bad of [7,331,0,-1,8.5,NaN,Infinity,'35',null,35n])
    assert.throws(()=>lifetime.lifetimeArgs(bad),{code:'RECEIVER_LIFETIME_INVALID'},String(bad));
});

test('the C# receiver carries the same numbers, parses a fourth argument and fails closed on a bad one',()=>{
  const source=readFileSync(path.join(root,'native/windows/NdiProbe.cs'),'utf8');
  assert.doesNotMatch(source,/const int GlobalDeadlineMs\s*=\s*8\s*\*\s*60\s*\*\s*1000/,'no fixed 8-minute lifetime');
  assert.match(source,new RegExp('DefaultLifetimeMinutes\\s*=\\s*'+lifetime.DEFAULT_MINUTES+';'));
  assert.match(source,new RegExp('MaxLifetimeMinutes\\s*=\\s*'+lifetime.MAX_MINUTES+';'));
  assert.match(source,/args\.Length == 3 \|\| args\.Length == 4/);
  assert.match(source,/"INVALID_LIFETIME"/);
  assert.match(source,/\{ "lifetimeMinutes", LifetimeMinutes \}/,'the ready line echoes the lifetime in use');
});

test('the soak job starts its receiver with the plan\'s lifetime; the workflow checks it on pull requests that touch it',()=>{
  const script=readFileSync(path.join(root,'scripts/smoke-soak-windows.cjs'),'utf8');
  assert.match(script,/full\.receiver\(tools,ndi\.dllPath,label,evidence,\{\},\{lifetimeMinutes:receiverLifetime\.soakReceiverLifetime\(plan\)\}\)/);
  const activation=readFileSync(path.join(root,'scripts/smoke-exchange-activation-windows.cjs'),'utf8');
  assert.match(activation,/full\.receiver\(tools,ndi\.dllPath,label,evidence\);/,'other proofs keep the default');
  const workflow=readFileSync(path.join(root,'.github/workflows/soak-proof.yml'),'utf8');
  for(const file of ['native/windows/NdiProbe.cs','scripts/lib/receiver-lifetime.cjs','scripts/smoke-full-app-windows.cjs'])
    assert.ok(workflow.includes("- '"+file+"'"),file);
});

// A stand-in receiver: its ready line carries the arguments it got and the
// lifetime it says it uses (the last argument, else 8, unless told to lie).
const BENCH=`'use strict';
const net=require('node:net');
const args=process.argv.slice(2),mode=args.shift();
const claimed=mode==='lie'?99:mode==='silent'?undefined:(args.length===4?Number(args[3]):8);
const server=net.createServer(socket=>{let text='';socket.on('data',chunk=>{text+=chunk;if(!text.includes('\\n'))return;
  const request=JSON.parse(text);socket.end(JSON.stringify({id:request.id,ok:true})+'\\n');if(request.command==='close'){server.close();process.exit(0);}});});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({event:'ndi-probe-ready',port:server.address().port,abiValid:true,runtimeVersion:'bench',args,lifetimeMinutes:claimed})));
process.stdin.on('end',()=>process.exit(0));process.stdin.resume();`;

test('the receiver gets the lifetime as its fourth argument and must echo it; a mismatch or a bad value never starts a run',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'receiver-lifetime-'));
  try{
    const script=path.join(dir,'bench.cjs');await fs.writeFile(script,BENCH);
    const bench=mode=>({executable:process.execPath,args:real=>[script,mode,...real.slice(1)]});
    const long=await receiver(dir,'unused.dll','label',dir,bench('echo'),{lifetimeMinutes:35});
    assert.deepEqual(long.info.args,['unused.dll','label',dir,'35']);assert.equal(long.info.lifetimeMinutes,35);await long.close();
    const plain=await receiver(dir,'unused.dll','label',dir,bench('echo'));
    assert.deepEqual(plain.info.args,['unused.dll','label',dir],'the default passes nothing');assert.equal(plain.info.lifetimeMinutes,8);await plain.close();
    await assert.rejects(receiver(dir,'unused.dll','label',dir,bench('lie'),{lifetimeMinutes:35}),/RECEIVER_LIFETIME_MISMATCH/);
    await assert.rejects(receiver(dir,'unused.dll','label',dir,bench('silent'),{lifetimeMinutes:35}),/RECEIVER_LIFETIME_MISMATCH/,'an old receiver that ignores it');
    await assert.rejects(receiver(dir,'unused.dll','label',dir,bench('lie')),/RECEIVER_LIFETIME_MISMATCH/,'the default is checked too');
    let spawned=false;
    await assert.rejects(receiver(dir,'unused.dll','label',dir,{executable:process.execPath,args:()=>{spawned=true;return [script,'echo'];}},{lifetimeMinutes:331}),{code:'RECEIVER_LIFETIME_INVALID'});
    assert.equal(spawned,false,'refused before any spawn');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
