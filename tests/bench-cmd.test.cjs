'use strict';
// Q-033 (part of Q-024): the ZIP carries Test-PiRaiders.cmd and the bench
// test's entry script; the two documents start with the quick test; the
// Foundation checks' Windows job runs the entry from the extracted ZIP and
// requires PASS. Linux checks only: the .cmd itself runs on hosted Windows
// (scripts/smoke-windows-bench.cjs). The proof's checks run here over the
// bench test's real output with the stand-in app of tests/bench-test.test.cjs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),fsSync=require('node:fs'),path=require('node:path'),os=require('node:os');
const bundle=require('../scripts/lib/windows-bundle.cjs');
const bench=require('../scripts/lib/bench-test.cjs');
const proof=require('../scripts/bench-cmd-proof.cjs');
const setupCommand=require('../scripts/piraiders-setup.cjs'),diagnoseCommand=require('../scripts/piraiders-diagnose.cjs'),verifyCommand=require('../scripts/piraiders-verify-bundle.cjs');

const ROOT=path.join(__dirname,'..');
const STAND_IN=path.join(__dirname,'fixtures','bench-app-stand-in.cjs');
const METADATA={commitSHA:'c'.repeat(40),spxVersion:'1.3.0',node:{version:'v22.0.0',platform:'win32',arch:'x64'}};
const read=relative=>fsSync.readFileSync(path.join(ROOT,relative),'utf8');

test('the bundle packages Test-PiRaiders.cmd at its root and requires the bench entry script',()=>{
  assert.equal(new Map(bundle.TEMPLATES).get('packaging/windows/Test-PiRaiders.cmd'),'Test-PiRaiders.cmd');
  assert.ok(bundle.REQUIRED_RUNTIME_SOURCES.includes('scripts/piraiders-bench-test.cjs'));
  assert.deepEqual(bundle.selectSourceFiles(ROOT,['scripts/piraiders-bench-test.cjs','scripts/bench-cmd-proof.cjs','scripts/smoke-windows-bench.cjs','scripts/lib/bench-test.cjs']),
    ['scripts/lib/bench-test.cjs','scripts/piraiders-bench-test.cjs']);
});

test('Test-PiRaiders.cmd refuses any argument with a plain sentence, runs only the bundled Node on the bench entry, needs no operator file',()=>{
  const text=read('packaging/windows/Test-PiRaiders.cmd');
  assert.match(text,/^@echo off\r?\n/);
  assert.match(text,/if not "%~1"=="" \(\r?\n  echo Test-PiRaiders\.cmd takes no arguments\. Read OPERATOR-CHECKLIST\.md\.\r?\n  exit \/b 2\r?\n\)/);
  assert.ok(text.includes(proof.BENCH_USAGE));
  assert.match(text,/echo Bundled Node runtime is missing\./);
  assert.doesNotMatch(text,/%\*|%~?[2-9]|piraiders-app\.json|config\.json/);
  const runs=text.split(/\r?\n/).filter(line=>/node\.exe"\s/.test(line)&&!/^\s*if /i.test(line));
  assert.deepEqual(runs,['"%PIRAIDERS_BUNDLE_ROOT%runtime\\node.exe" "%PIRAIDERS_BUNDLE_ROOT%app\\scripts\\piraiders-bench-test.cjs"']);
  // From app/, as the bench entry's commands expect, and its exit code passed on.
  assert.match(text,/pushd "%PIRAIDERS_BUNDLE_ROOT%app" \|\| exit \/b 2/);
  assert.match(text,/exit \/b %PIRAIDERS_BUNDLE_EXIT%\s*$/);
  // Every document it names ships in the ZIP.
  const shipped=new Set(bundle.TEMPLATES.map(item=>item[1]));
  for(const doc of text.match(/[A-Za-z0-9-]+\.md/g)||[])assert.ok(shipped.has(doc),doc);
});

test('OPERATOR-CHECKLIST.md and README-WINDOWS.md start with the quick test and keep the 11 manual steps',()=>{
  for(const relative of ['packaging/windows/OPERATOR-CHECKLIST.md','packaging/windows/README-WINDOWS.md']){
    const text=read(relative);
    const first=text.split(/\r?\n/).filter(Boolean).slice(1).find(line=>!/^## Quick test/.test(line));
    assert.ok(first.startsWith('Quick test: run `Test-PiRaiders.cmd`'),relative+': '+first);
    const quick=text.slice(0,text.search(/^## (?!Quick test)/m));
    // What it proves and what it does not, one line each, and the real exchange stays manual.
    assert.equal(quick.split(/\r?\n/).filter(l=>/What it proves:/.test(l)).length,1,relative);
    assert.equal(quick.split(/\r?\n/).filter(l=>/What it does not prove:/.test(l)).length,1,relative);
    for(const words of [/stadium/,/board/,/on air/,/"NDI sender running" is not "received"/,/real exchange/,/app\\bench-test\\/,/`PASS`/,/`FAIL`/,/summary/])assert.match(quick,words,relative+' '+words);
    assert.match(quick,/11/,relative);
  }
  const checklist=read('packaging/windows/OPERATOR-CHECKLIST.md');
  assert.match(checklist,/the five `\.cmd` entries refuse/);
  assert.doesNotMatch(checklist,/the four `\.cmd` entries/);
  assert.equal(checklist.split(/\r?\n/).filter(l=>/^## \d+\. /.test(l)).length,11);
  // The first line the bench prints is the one the documents describe.
  assert.match(read('scripts/lib/bench-test.cjs'),/Bench test: works only in its own folder app\\\\'\+FOLDER\+'\\\\ with demo data/);
});

test('the Windows job runs Test-PiRaiders.cmd from the extracted ZIP after the build and keeps its evidence',()=>{
  const ci=read('.github/workflows/ci.yml'),pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['smoke:windows-bench'],'node scripts/smoke-windows-bench.cjs build/windows/PiRaiders-Development-win-x64.zip build/windows-bench-evidence');
  const build=ci.indexOf('run: npm run package:windows'),run=ci.indexOf('run: npm run smoke:windows-bench'),keep=ci.indexOf('name: windows-bench-test-evidence');
  assert.ok(build>0&&run>build&&keep>run,JSON.stringify({build,run,keep}));
  const step=ci.slice(ci.lastIndexOf('- name:',run),run);
  assert.match(step,/if: runner\.os == 'Windows'\r?\n/);
  assert.doesNotMatch(step,/continue-on-error/);
  const retain=ci.slice(ci.lastIndexOf('- name:',keep),keep);
  assert.match(retain,/if: always\(\) && runner\.os == 'Windows'/);
  const smoke=read('scripts/smoke-windows-bench.cjs');
  assert.match(smoke,/entryRunner\(root,powershell,work,\{timeoutMs:RUN_TIMEOUT_MS\}\)/);
  assert.match(smoke,/auditEvidence\(evidence,privatePaths\)/);
  assert.match(read('scripts/smoke-windows-entries.cjs'),/'Test-PiRaiders\.cmd'\]\);/);
});

// A bundle-shaped folder (as tests/bench-test.test.cjs makes it) and a
// stand-in for the root entry: an argument gets the .cmd's own refusal; no
// argument runs the real bench steps with the stand-in app, printing what
// the console would show.
async function bundleShape(t){
  const parent=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders bench cmd 鷹 ! ')));
  t.after(()=>fs.rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const root=path.join(parent,'Extracted','PiRaiders-Development');
  for(const [source,target] of bundle.TEMPLATES){const file=path.join(root,...target.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.copyFile(path.join(ROOT,source),file);}
  await fs.writeFile(path.join(root,'BUILD-MANIFEST.json'),JSON.stringify(bundle.createManifest(root,METADATA),null,2)+'\n');
  return{root,app:path.join(root,'app')};
}
function standInEntry(app,{standIn='ok',calls=[]}={}){
  const runCommand=async(script,args)=>{
    let r;
    if(script==='piraiders-verify-bundle.cjs')r=verifyCommand.main(args,{root:path.dirname(app)});
    else if(script==='piraiders-setup.cjs')r=await setupCommand.main(args,{appRoot:app});
    else if(script==='piraiders-diagnose.cjs')r=await diagnoseCommand.main(args,{appRoot:app});
    else throw Error('unknown script');
    return{exitCode:r.exitCode,stdout:JSON.stringify(r.answer)+'\n'};
  };
  return async(name,args)=>{
    calls.push([name,...args]);
    if(name!=='Test-PiRaiders.cmd')throw Error('unexpected entry');
    if(args.length)return{exitCode:2,stdout:proof.BENCH_USAGE+'\r\n'};
    const lines=[];
    const out=await bench.runBenchTest({appRoot:app,print:l=>lines.push(l),runCommand,appEntry:STAND_IN,appEnv:{...process.env,BENCH_STAND_IN:standIn}});
    return{exitCode:out.exitCode,stdout:lines.join('\r\n')+'\r\n'};
  };
}

test('the proof passes a fresh extraction run twice, refuses the wrong argument first, and keeps fixed tokens only',async t=>{
  const {root,app}=await bundleShape(t),calls=[];
  const record=await proof.proveBenchCommand({root,runEntry:standInEntry(app,{calls})});
  assert.deepEqual(calls,[['Test-PiRaiders.cmd','--no-such-option'],['Test-PiRaiders.cmd'],['Test-PiRaiders.cmd']]);
  assert.equal(record.result,'PASS');assert.equal(record.runs,2);assert.equal(record.wrongArgumentExit,2);
  assert.deepEqual(record.steps.map(s=>s.step),bench.BENCH_STEPS);
  assert.equal(record.steps[0].code,'BUNDLE_VERIFIED');
  assert.equal(record.steps.at(-1).code,'DIAGNOSE_APP_NOT_RUNNING');
  assert.equal(record.totalMs.length,2);
  const text=JSON.stringify(record);
  for(const p of [root,app,'鷹',os.hostname(),os.userInfo().username,'/','\\\\'])assert.ok(!text.includes(p),'record must not name '+p);
});

test('a FAIL from the bench, a changed step list, a missing summary or a wrong refusal each fail the proof with a fixed code',async t=>{
  {
    const {root,app}=await bundleShape(t);
    await fs.appendFile(path.join(root,'README-WINDOWS.md'),'changed');
    await assert.rejects(proof.proveBenchCommand({root,runEntry:standInEntry(app)}),{code:'BENCH_FAILED',failedStep:'VERIFY',failedCode:'BUNDLE_DIFFERS',exitCode:1});
  }
  {
    const {root}=await bundleShape(t);
    const usage=async()=>({exitCode:0,stdout:'started\n'});
    await assert.rejects(proof.proveBenchCommand({root,runEntry:usage}),{code:'BENCH_USAGE_NOT_REFUSED',exitCode:0});
  }
  {
    const {root,app}=await bundleShape(t);
    await fs.mkdir(path.join(app,'bench-test'));
    await assert.rejects(proof.proveBenchCommand({root,runEntry:standInEntry(app)}),{code:'BENCH_NOT_FRESH'});
  }
  // Console checks on their own.
  const steps=bench.BENCH_STEPS.map(s=>s+' CODE_'+s);
  const first='Bench test: works only in its own folder app\\bench-test\\ with demo data; x';
  const last='PASS  Summary to send back: '+path.join('/x','app','bench-test','bench-summary.txt');
  assert.equal(Object.keys(proof.checkBenchConsole([first,...steps,last].join('\n'),0)).length,bench.BENCH_STEPS.length);
  assert.throws(()=>proof.checkBenchConsole([first,...steps.slice(1),last].join('\n'),0),{code:'BENCH_STEPS_UNEXPECTED'});
  assert.throws(()=>proof.checkBenchConsole([first,...steps,last].join('\n'),1),{code:'BENCH_EXIT_UNEXPECTED'});
  assert.throws(()=>proof.checkBenchConsole([first,...steps,'PASS'].join('\n'),0),{code:'BENCH_LAST_LINE_UNEXPECTED'});
  assert.throws(()=>proof.checkBenchConsole(['other',...steps,last].join('\n'),0),{code:'BENCH_FIRST_LINE_UNEXPECTED'});
  // Summary checks on their own: a path or an unknown line is refused.
  const codes=Object.fromEntries(bench.BENCH_STEPS.map(s=>[s,'CODE_'+s]));
  const good=['PiRaiders bench test summary',bench.BENCH_NOT_PROVEN,'result PASS',...bench.BENCH_STEPS.map(s=>'step '+s+' CODE_'+s+' 5ms files=3'),'total 9ms',''].join('\n');
  assert.equal(proof.checkBenchSummary(good,codes).steps[0].counts.files,3);
  assert.throws(()=>proof.checkBenchSummary(good.replace('files=3','path=C:\\x'),codes),{code:'BENCH_SUMMARY_UNEXPECTED'});
  assert.throws(()=>proof.checkBenchSummary(good.replace('result PASS','result FAIL'),codes),{code:'BENCH_SUMMARY_UNEXPECTED'});
  assert.throws(()=>proof.checkBenchSummary(good,{...codes,VERIFY:'OTHER'}),{code:'BENCH_SUMMARY_UNEXPECTED'});
  {
    const {root,app}=await bundleShape(t);
    const entry=standInEntry(app);
    const noSummary=async(name,args)=>{const r=await entry(name,args);if(!args.length)await fs.rm(path.join(app,'bench-test','bench-summary.txt'));return r;};
    await assert.rejects(proof.proveBenchCommand({root,runEntry:noSummary}),{code:'BENCH_SUMMARY_MISSING'});
  }
});
