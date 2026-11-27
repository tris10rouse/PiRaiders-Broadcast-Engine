'use strict';
// Q-031: the bench test's steps on Linux over a bundle-shaped folder, with
// the real Verify, Setup and Diagnose commands in-process. The real
// Test-PiRaiders.cmd and the Windows job come with Q-033; nothing here is a
// Windows claim.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const bundle=require('../scripts/lib/windows-bundle.cjs');
const bench=require('../scripts/lib/bench-test.cjs');
const entry=require('../scripts/piraiders-bench-test.cjs');
const setupCommand=require('../scripts/piraiders-setup.cjs'),diagnoseCommand=require('../scripts/piraiders-diagnose.cjs'),verifyCommand=require('../scripts/piraiders-verify-bundle.cjs');
const METADATA={commitSHA:'c'.repeat(40),spxVersion:'1.3.0',node:{version:'v22.0.0',platform:'win32',arch:'x64'}};
const ROOT=path.join(__dirname,'..');
const UUID4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function bundleShape(t){
  const parent=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders bench 鷹 ! ')));
  t.after(()=>fs.rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const root=path.join(parent,'Extracted','PiRaiders-Development');
  for(const [source,target] of bundle.TEMPLATES){const file=path.join(root,...target.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.copyFile(path.join(ROOT,source),file);}
  await fs.writeFile(path.join(root,'BUILD-MANIFEST.json'),JSON.stringify(bundle.createManifest(root,METADATA),null,2)+'\n');
  return{parent,root,app:path.join(root,'app')};
}
// The app's three command scripts in-process, as the entry runs them as
// processes; `override` replaces one script's answer.
function inProcess(app,calls=[],override={}){
  return async(script,args)=>{
    calls.push(script);
    if(override[script])return override[script](args);
    let r;
    if(script==='piraiders-verify-bundle.cjs')r=verifyCommand.main(args,{root:path.dirname(app)});
    else if(script==='piraiders-setup.cjs')r=await setupCommand.main(args,{appRoot:app});
    else if(script==='piraiders-diagnose.cjs')r=await diagnoseCommand.main(args,{appRoot:app});
    else throw Error('unknown script');
    return{exitCode:r.exitCode,stdout:JSON.stringify(r.answer)+'\n'};
  };
}
async function run(app,options={}){
  const lines=[],calls=[];
  const out=await bench.runBenchTest({appRoot:app,print:l=>lines.push(l),runCommand:inProcess(app,calls,options.override),...(options.extra||{})});
  return{...out,lines,calls};
}
const exists=async p=>{try{await fs.lstat(p);return true;}catch{return false;}};

test('a fresh extraction passes every step, writes only its own folder and a path-free summary',async t=>{
  const {parent,root,app}=await bundleShape(t);
  const out=await run(app);
  assert.equal(out.exitCode,0,out.lines.join('\n'));
  assert.match(out.lines[0],/^Bench test: works only in its own folder app\\bench-test\\ with demo data/);
  assert.deepEqual(out.lines.slice(1,-1),['VERIFY BUNDLE_VERIFIED','DEMO_EXCHANGE DEMO_EXCHANGE_WRITTEN','MACHINE_FILE MACHINE_FILE_WRITTEN','SETUP SETUP_DONE','DIAGNOSE DIAGNOSE_APP_NOT_RUNNING']);
  assert.equal(out.lines.at(-1),'PASS  Summary to send back: '+path.join(app,'bench-test','bench-summary.txt'));
  assert.deepEqual(out.calls,['piraiders-verify-bundle.cjs','piraiders-setup.cjs','piraiders-diagnose.cjs']);
  // The operator's own files are never made.
  for(const p of [path.join(app,'config','piraiders-app.json'),path.join(app,'config.json'),path.join(app,'data'),path.join(app,'events'),path.join(app,'DATAROOT')])assert.equal(await exists(p),false,p);
  // Only bench-test is new under app/.
  assert.deepEqual((await fs.readdir(app)).sort(),['bench-test','config']);
  const machine=JSON.parse(await fs.readFile(path.join(app,'bench-test','machine.json'),'utf8'));
  assert.ok(UUID4.test(machine.source.journalStoreId)&&UUID4.test(machine.source.approvalStoreId));
  assert.notEqual(machine.source.journalStoreId,machine.source.approvalStoreId);
  assert.ok(!JSON.stringify(machine).includes('REPLACE'));
  assert.equal(machine.spxConfigFile,'bench-test/spx-config.json');
  for(const key of ['catalogDirectory','cacheRoot','runtimeRoot'])assert.match(machine[key],/^bench-test\//);
  for(const key of ['journalDirectory','approvalDirectory'])assert.match(machine.source[key],/^bench-test\/private\//);
  assert.equal(machine.mediaRoot,path.join(app,'bench-test','exchange'));
  assert.equal(machine.rossTalk.port,bench.BENCH_PORTS.rossTalk);assert.equal(machine.output.name,bench.BENCH_NDI_NAME);
  assert.equal(machine.caspar,undefined);
  const spx=JSON.parse(await fs.readFile(path.join(app,'bench-test','spx-config.json'),'utf8'));
  assert.equal(spx.general.port,bench.BENCH_PORTS.spx);assert.equal(spx.general.dataroot,'bench-test/DATAROOT');
  const summary=await fs.readFile(out.summaryFile,'utf8');
  assert.match(summary,/^PiRaiders bench test summary\n/);
  assert.ok(summary.includes(bench.BENCH_NOT_PROVEN));
  assert.match(summary,/\nresult PASS\n/);
  assert.match(summary,/\nstep VERIFY BUNDLE_VERIFIED \d+ms files=\d+ extra=0\n/);
  assert.match(summary,/\nstep DIAGNOSE DIAGNOSE_APP_NOT_RUNNING \d+ms catalogSequence=1\n/);
  for(const p of [parent,root,app,'鷹',machine.source.journalStoreId,machine.source.approvalStoreId,machine.source.binding.feedId,os.hostname(),os.userInfo().username,'/','\\'])
    assert.ok(!summary.includes(p),'summary must not name '+p);
  // Each line: a fixed sentence, or words, codes, counts and timings.
  for(const line of summary.trim().split('\n').slice(3))assert.match(line,/^(step [A-Z_]+ [A-Z0-9_]+ \d+ms( [a-zA-Z]+=\d+)*|total \d+ms)$/);
});

test('a second run removes only its own folder and starts clean with new store ids',async t=>{
  const {app}=await bundleShape(t);
  const first=await run(app);assert.equal(first.exitCode,0);
  const ids=JSON.parse(await fs.readFile(path.join(app,'bench-test','machine.json'),'utf8')).source;
  await fs.writeFile(path.join(app,'bench-test','left-over.txt'),'x');
  const second=await run(app);
  assert.equal(second.exitCode,0,second.lines.join('\n'));
  assert.equal(await exists(path.join(app,'bench-test','left-over.txt')),false);
  const again=JSON.parse(await fs.readFile(path.join(app,'bench-test','machine.json'),'utf8')).source;
  assert.notEqual(again.journalStoreId,ids.journalStoreId);assert.notEqual(again.approvalStoreId,ids.approvalStoreId);
});

test('an operator who already set up the PC passes, and their files stay byte for byte',async t=>{
  const {app}=await bundleShape(t);
  await fs.writeFile(path.join(app,'config','piraiders-app.json'),'{"operator":true}\n');await fs.writeFile(path.join(app,'config.json'),'{"spx":true}\n');
  const out=await run(app);
  assert.equal(out.exitCode,0,out.lines.join('\n'));
  assert.equal(out.lines[1],'VERIFY BUNDLE_VERIFIED_OPERATOR_FILES_EXTRA');
  assert.equal(await fs.readFile(path.join(app,'config','piraiders-app.json'),'utf8'),'{"operator":true}\n');
  assert.equal(await fs.readFile(path.join(app,'config.json'),'utf8'),'{"spx":true}\n');
  assert.match(await fs.readFile(out.summaryFile,'utf8'),/step VERIFY BUNDLE_VERIFIED_OPERATOR_FILES_EXTRA \d+ms extra=2\n/);
});

test('a bench-test folder without the marker, or a link, is refused and left alone',async t=>{
  const {parent,app}=await bundleShape(t);
  await fs.mkdir(path.join(app,'bench-test'));await fs.writeFile(path.join(app,'bench-test','mine.txt'),'keep');
  let out=await run(app);
  assert.equal(out.exitCode,1);assert.equal(out.lines.at(-1),'FAIL START BENCH_FOLDER_NOT_OURS  (no summary file written)');
  assert.deepEqual(out.calls,[]);
  assert.deepEqual(await fs.readdir(path.join(app,'bench-test')),['mine.txt']);
  await fs.rm(path.join(app,'bench-test'),{recursive:true});
  const elsewhere=path.join(parent,'elsewhere');await fs.mkdir(elsewhere);
  await fs.writeFile(path.join(elsewhere,bench.BENCH_MARKER),'');await fs.writeFile(path.join(elsewhere,'keep.txt'),'keep');
  await fs.symlink(elsewhere,path.join(app,'bench-test'),'dir');
  out=await run(app);
  assert.equal(out.lines.at(-1),'FAIL START BENCH_FOLDER_NOT_OURS  (no summary file written)');
  assert.deepEqual((await fs.readdir(elsewhere)).sort(),[bench.BENCH_MARKER,'keep.txt'].sort());
});

test('a damaged extraction fails at VERIFY with its code, and the summary says so',async t=>{
  const {root,app}=await bundleShape(t);
  await fs.appendFile(path.join(root,'README-WINDOWS.md'),'changed');
  const out=await run(app);
  assert.equal(out.exitCode,1);
  assert.deepEqual(out.lines.slice(1),['VERIFY BUNDLE_DIFFERS','FAIL VERIFY BUNDLE_DIFFERS  Summary to send back: '+out.summaryFile]);
  assert.deepEqual(out.calls,['piraiders-verify-bundle.cjs']);
  const summary=await fs.readFile(out.summaryFile,'utf8');
  assert.match(summary,/\nresult FAIL VERIFY BUNDLE_DIFFERS\n/);
  assert.deepEqual((await fs.readdir(path.join(app,'bench-test'))).sort(),[bench.BENCH_MARKER,'bench-summary.txt'].sort());
});

test('a refusing Setup, an unreadable answer and a running app each fail with a fixed code',async t=>{
  const {app}=await bundleShape(t);
  let out=await run(app,{override:{'piraiders-setup.cjs':()=>({exitCode:1,stdout:JSON.stringify({ok:false,step:'feed',code:'FEED_BINDING_MISMATCH',done:{}})+'\n'})}});
  assert.equal(out.lines.at(-1).split('  ')[0],'FAIL SETUP FEED_BINDING_MISMATCH');
  out=await run(app,{override:{'piraiders-setup.cjs':()=>({exitCode:1,stdout:'C:\\Users\\someone\\x is not json'})}});
  assert.equal(out.lines.at(-1).split('  ')[0],'FAIL SETUP SETUP_ANSWER_UNREADABLE');
  assert.ok(!(await fs.readFile(out.summaryFile,'utf8')).includes('someone'));
  out=await run(app,{override:{'piraiders-setup.cjs':()=>({exitCode:0,stdout:JSON.stringify({ok:true,step:'done',code:null,done:{machine:'checked',source:'direct',feed:'checked',journal:'present',approvals:'present'}})})}});
  assert.equal(out.lines.at(-1).split('  ')[0],'FAIL SETUP SETUP_UNEXPECTED');
  const running=args=>diagnoseCommand.main(args,{appRoot:app}).then(r=>({exitCode:0,stdout:JSON.stringify({...r.answer,app:'running'})}));
  out=await run(app,{override:{'piraiders-diagnose.cjs':running}});
  assert.equal(out.lines.at(-1).split('  ')[0],'FAIL DIAGNOSE DIAGNOSE_UNEXPECTED');
  out=await run(app,{override:{'piraiders-verify-bundle.cjs':()=>({exitCode:1,stdout:'nonsense'})}});
  assert.equal(out.lines.at(-1).split('  ')[0],'FAIL VERIFY VERIFY_ANSWER_UNREADABLE');
});

test('the entry refuses any argument with a plain sentence and exit 2, before anything is written',async t=>{
  const {app}=await bundleShape(t),lines=[];
  assert.equal(await entry.main(['--fast'],{appRoot:app,print:l=>lines.push(l),run:()=>{throw Error('must not run');}}),2);
  assert.deepEqual(lines,['The bench test takes no arguments. Read OPERATOR-CHECKLIST.md.']);
  assert.equal(await exists(path.join(app,'bench-test')),false);
  await assert.rejects(bench.runBenchTest({appRoot:'relative',runCommand:()=>{}}),{code:'BENCH_OPTIONS_INVALID'});
});

test('the entry runs each command script as its own process from app/',async t=>{
  const {app}=await bundleShape(t);
  await fs.mkdir(path.join(app,'scripts'));
  await fs.writeFile(path.join(app,'scripts','echo.cjs'),"process.stdout.write(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)})+'\\n');process.exitCode=3;");
  const r=await entry.runCommand('echo.cjs',['--machine','x'],{appRoot:app});
  assert.equal(r.exitCode,3);
  assert.deepEqual(JSON.parse(r.stdout),{cwd:await fs.realpath(app),args:['--machine','x']});
});
