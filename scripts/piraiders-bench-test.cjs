#!/usr/bin/env node
'use strict';
// Q-031 (part of Q-024): the one-click bench test, from the ZIP's app folder:
//
//   node app/scripts/piraiders-bench-test.cjs
//
// No arguments. It works only in its own folder app/bench-test/ with demo
// data (scripts/lib/bench-test.cjs says which steps and what each proves),
// prints each step's fixed code as it finishes, then one last line: PASS, or
// FAIL with the failing step and code, and the path of the summary file to
// send back (fixed codes, counts and timings only). Exit 0 PASS, 1 FAIL,
// 2 wrong arguments. A bench check of this PC with demo data: not the
// stadium, not the board, not on air.
const path=require('node:path'),{execFile}=require('node:child_process');
const {runBenchTest}=require('./lib/bench-test.cjs');

const APP_ROOT=path.resolve(__dirname,'..');
// One of the app's own command scripts, as its own process from app/, the
// way the .cmd entries run it; only its one-line answer is read.
function runCommand(script,args,{appRoot=APP_ROOT,timeoutMs=180000}={}){
  return new Promise(resolve=>{
    execFile(process.execPath,[path.join(appRoot,'scripts',script),...args],{cwd:appRoot,timeout:timeoutMs,windowsHide:true,shell:false,maxBuffer:1<<20,encoding:'utf8'},(error,stdout)=>{
      resolve({exitCode:error?(typeof error.code==='number'?error.code:null):0,stdout:String(stdout||'')});
    });
  });
}
async function main(argv,{appRoot=APP_ROOT,print=line=>process.stdout.write(line+'\n'),run=runCommand}={}){
  if(argv.length){print('The bench test takes no arguments. Read OPERATOR-CHECKLIST.md.');return 2;}
  return(await runBenchTest({appRoot,print,runCommand:(script,args)=>run(script,args,{appRoot})})).exitCode;
}
if(require.main===module){
  main(process.argv.slice(2)).then(code=>{process.exitCode=code;},()=>{process.stdout.write('FAIL START BENCH_FAILED  (no summary file written)\n');process.exitCode=1;});
}
module.exports={main,runCommand};
