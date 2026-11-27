'use strict';
// Q-033 (part of Q-024, the one-click bench test): the extracted ZIP's
// Test-PiRaiders.cmd, the steps the Windows job checks. Kept apart from the
// Windows script (scripts/smoke-windows-bench.cjs) so Linux tests run the
// very same checks over the bench test's real output with a stand-in app.
//
//   1. app\bench-test\ does not exist yet (a fresh extraction).
//   2. Test-PiRaiders.cmd with an argument: exit 2, its plain sentence, and
//      nothing written.
//   3. Test-PiRaiders.cmd: exit 0; its first line says it works only in its
//      own folder; every step's fixed code in order; last line PASS with the
//      summary path inside app\bench-test\; the summary file holds the
//      not-proven line, `result PASS`, each step's code and timing.
//   4. The same again: a second run starts clean and passes.
//
// `runEntry(name, args)` runs one root entry and answers {exitCode, stdout}.
// Only fixed words, codes, counts and timings are kept, never paths.
// A bench check with demo data: not the stadium, not the board, not on air.
const fs=require('node:fs/promises'),path=require('node:path');
const {BENCH_STEPS,BENCH_FOLDER,BENCH_NOT_PROVEN}=require('./lib/bench-test.cjs');

const ENTRY='Test-PiRaiders.cmd',SUMMARY='bench-summary.txt';
const CODE=/^[A-Z][A-Z0-9_]{0,63}$/;
const USAGE='Test-PiRaiders.cmd takes no arguments. Read OPERATOR-CHECKLIST.md.';

function fail(code,extra){throw Object.assign(Error(code),{code},extra);}
const exists=async p=>{try{await fs.lstat(p);return true;}catch{return false;}};
const lines=text=>String(text||'').split(/\r?\n/).map(l=>l.trimEnd()).filter(Boolean);

// The console of one run reduced to fixed tokens. Throws BENCH_FAILED with
// the failing step and code when the bench said FAIL.
function checkBenchConsole(stdout,exitCode){
  const all=lines(stdout),last=all.at(-1)||'';
  const failed=/^FAIL ([A-Z_]+) ([A-Z][A-Z0-9_]{0,63})  /.exec(last);
  if(failed)fail('BENCH_FAILED',{failedStep:BENCH_STEPS.concat('START','CLEANUP').includes(failed[1])?failed[1]:null,failedCode:failed[2],exitCode:Number.isInteger(exitCode)?exitCode:null});
  if(exitCode!==0)fail('BENCH_EXIT_UNEXPECTED',{exitCode:Number.isInteger(exitCode)?exitCode:null});
  if(!/^Bench test: works only in its own folder app\\bench-test\\ with demo data/.test(all[0]||''))fail('BENCH_FIRST_LINE_UNEXPECTED');
  const steps=all.slice(1,-1);
  if(steps.length!==BENCH_STEPS.length)fail('BENCH_STEPS_UNEXPECTED',{stepCount:steps.length});
  const codes={};
  steps.forEach((line,i)=>{
    const [step,code,...rest]=line.split(' ');
    if(step!==BENCH_STEPS[i]||!CODE.test(code||'')||rest.length)fail('BENCH_STEPS_UNEXPECTED',{stepIndex:i});
    codes[step]=code;
  });
  const tail='PASS  Summary to send back: ';
  if(!last.startsWith(tail)||!last.endsWith(path.join('app',BENCH_FOLDER,SUMMARY)))fail('BENCH_LAST_LINE_UNEXPECTED');
  return codes;
}

// The summary file: header, the not-proven line, result PASS, one line per
// step (the same codes the console printed), the total. Nothing else.
function checkBenchSummary(text,codes){
  const all=String(text).split('\n');
  if(all.at(-1)!=='')fail('BENCH_SUMMARY_UNEXPECTED');
  all.pop();
  if(all[0]!=='PiRaiders bench test summary'||all[1]!==BENCH_NOT_PROVEN||all[2]!=='result PASS')fail('BENCH_SUMMARY_UNEXPECTED');
  const steps=all.slice(3,-1),total=/^total (\d+)ms$/.exec(all.at(-1)||'');
  if(!total||steps.length!==BENCH_STEPS.length)fail('BENCH_SUMMARY_UNEXPECTED');
  return{totalMs:Number(total[1]),steps:steps.map((line,i)=>{
    const m=/^step ([A-Z_]+) ([A-Z][A-Z0-9_]{0,63}) (\d+)ms((?: [a-z][A-Za-z]{0,31}=\d+)*)$/.exec(line);
    if(!m||m[1]!==BENCH_STEPS[i]||m[2]!==codes[m[1]])fail('BENCH_SUMMARY_UNEXPECTED',{stepIndex:i});
    const counts=Object.fromEntries(m[4].trim().split(' ').filter(Boolean).map(kv=>{const [k,v]=kv.split('=');return[k,Number(v)];}));
    return{step:m[1],code:m[2],ms:Number(m[3]),counts};
  })};
}

// root: the extracted bundle folder (holding app/ and the root entries).
async function proveBenchCommand({root,runEntry,runs=2}){
  if(typeof root!=='string'||!path.isAbsolute(root)||typeof runEntry!=='function'||!Number.isSafeInteger(runs)||runs<1)fail('PROOF_OPTIONS_INVALID');
  const bench=path.join(root,'app',BENCH_FOLDER),summaryFile=path.join(bench,SUMMARY);
  if(await exists(bench))fail('BENCH_NOT_FRESH');
  const usage=await runEntry(ENTRY,['--no-such-option']);
  if(usage.exitCode!==2||!lines(usage.stdout).includes(USAGE))fail('BENCH_USAGE_NOT_REFUSED',{exitCode:Number.isInteger(usage.exitCode)?usage.exitCode:null});
  if(await exists(bench))fail('BENCH_USAGE_WROTE');
  const results=[];
  for(let i=0;i<runs;i++){
    const r=await runEntry(ENTRY,[]);
    const codes=checkBenchConsole(r.stdout,r.exitCode);
    let text;try{text=await fs.readFile(summaryFile,'utf8');}catch{fail('BENCH_SUMMARY_MISSING');}
    results.push(checkBenchSummary(text,codes));
  }
  return{event:'windows-bench-test-proof',result:'PASS',runs:results.length,wrongArgumentExit:2,
    steps:results.at(-1).steps,totalMs:results.map(r=>r.totalMs),notProven:BENCH_NOT_PROVEN};
}

module.exports={proveBenchCommand,checkBenchConsole,checkBenchSummary,BENCH_ENTRY:ENTRY,BENCH_USAGE:USAGE};
