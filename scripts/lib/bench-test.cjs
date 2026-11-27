'use strict';
// Q-031 (part of Q-024, the one-click bench test): the steps of the bench
// test, kept apart from its entry (scripts/piraiders-bench-test.cjs) so Linux
// tests run the very same steps with the commands in-process.
//
// It works only in its own folder app/bench-test/ (marked by its own marker
// file) with demo data: it never reads or writes the operator's machine file
// (app/config/piraiders-app.json), SPX config (app/config.json), stores or
// exchange folder. A second run removes only that folder, and only when the
// marker says it is the bench test's own.
//
// Steps, in order, each answering one fixed code:
//   VERIFY         the ZIP check of Verify-PiRaiders.cmd (the operator's own
//                  files may be extra; nothing missing or changed)
//   DEMO_EXCHANGE  the synthetic exchange folder (scripts/lib/demo-exchange.cjs)
//   MACHINE_FILE   the shipped source-mode example, every placeholder replaced,
//                  two new random v4 store ids; its own SPX config, ports,
//                  NDI name and stores, all inside the bench folder
//   SETUP          scripts/piraiders-setup.cjs on that file
//   DIAGNOSE       scripts/piraiders-diagnose.cjs on that file, app closed
// (Q-032 adds the app steps.) The summary file holds fixed codes, counts and
// millisecond timings only: no paths, ids, user or PC names.
//
// `runCommand(script, args)` runs one of the app's command scripts and
// answers {exitCode, stdout}. Proof and bench use only; demo data only.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {exchangeDocuments}=require('./demo-exchange.cjs');

const FOLDER='bench-test',MARKER='.piraiders-bench-test',SUMMARY='bench-summary.txt';
const STEPS=Object.freeze(['VERIFY','DEMO_EXCHANGE','MACHINE_FILE','SETUP','DIAGNOSE']);
// The bench's own ports and sender name, so it never meets a real app's.
const BENCH_SPX_PORT=5658,BENCH_ROSSTALK_PORT=7789,BENCH_NDI_NAME='PiRaiders Bench Test';
const NOT_PROVEN='Bench check of this PC with demo data only: not the stadium, not the board, not on air; "NDI sender running" is not "received".';
const PLACEHOLDER=/<REPLACE:[^>]*>/;
const CODE=/^[A-Z][A-Z0-9_]{0,63}$/,WORD=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const UUID4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fail(code,extra){throw Object.assign(Error(code),{code},extra);}

// The shipped source example with each placeholder replaced, nothing else:
// the exchange folder and binding are given, the two store ids are new.
// Since Q-020 the example names no Caspar or NDI folder: the bundle's are used.
function sourceMachineFromExample(example,{mediaRoot,canonicalRoot,binding,randomUUID=crypto.randomUUID}){
  const value=JSON.parse(JSON.stringify(example));
  const set={mediaRoot:()=>{value.mediaRoot=mediaRoot;},
    journalStoreId:()=>{value.source.journalStoreId=randomUUID();},approvalStoreId:()=>{value.source.approvalStoreId=randomUUID();},
    expectedCanonicalRoot:()=>{value.source.expectedCanonicalRoot=canonicalRoot;},
    feedId:()=>{value.source.binding.feedId=binding.feedId;},epoch:()=>{value.source.binding.epoch=binding.epoch;}};
  const at={mediaRoot:value.mediaRoot,journalStoreId:value.source?.journalStoreId,
    approvalStoreId:value.source?.approvalStoreId,expectedCanonicalRoot:value.source?.expectedCanonicalRoot,
    feedId:value.source?.binding?.feedId,epoch:value.source?.binding?.epoch};
  for(const [name,current] of Object.entries(at)){
    if(typeof current!=='string'||!PLACEHOLDER.test(current))fail('EXAMPLE_PLACEHOLDER_MISSING',{field:name});
    set[name]();
  }
  if(PLACEHOLDER.test(JSON.stringify(value)))fail('EXAMPLE_PLACEHOLDER_LEFT');
  return value;
}

// The diagnose answer reduced to fixed words and codes; checked against what
// a freshly set-up machine with the app closed must show.
function checkDiagnose(result){
  let value;try{value=JSON.parse(String(result&&result.stdout).trim());}catch{fail('DIAGNOSE_ANSWER_UNREADABLE');}
  const s=value&&value.states;
  const word=v=>typeof v==='string'&&WORD.test(v)?v:null,code=v=>v===null?null:(typeof v==='string'&&CODE.test(v)?v:'UNPRINTABLE');
  const states={};
  for(const name of ['exchangeFolder','catalogSequence','approvals','prepared','renderer','ndiSender']){
    const e=s&&s[name];states[name]={state:word(e&&e.state),code:code(e?e.code:null),from:word(e&&e.from)};
  }
  const fixed={exitCode:Number.isInteger(result.exitCode)?result.exitCode:null,ok:value?.ok===true,mode:word(value?.mode),app:word(value?.app),ready:value?.ready===true,states};
  const expect=(name,state,c,from)=>{const e=states[name];if(e.state!==state||e.code!==c||e.from!==from)fail('DIAGNOSE_UNEXPECTED',{fixed,state:name});};
  if(fixed.exitCode!==0||!fixed.ok||fixed.mode!=='source'||fixed.app!=='not-running'||fixed.ready)fail('DIAGNOSE_UNEXPECTED',{fixed});
  expect('exchangeFolder','reachable',null,'stores');expect('catalogSequence','read',null,'stores');expect('approvals','readable',null,'stores');
  for(const name of ['prepared','renderer','ndiSender'])expect(name,'unknown','APP_NOT_RUNNING','app');
  if(!Number.isSafeInteger(s.catalogSequence.sequence)||s.catalogSequence.sequence<0)fail('DIAGNOSE_UNEXPECTED',{fixed,state:'catalogSequence'});
  fixed.states.catalogSequence.sequence=s.catalogSequence.sequence;
  return fixed;
}

function answerOf(result){
  try{const v=JSON.parse(String(result&&result.stdout).trim());return v&&typeof v==='object'&&!Array.isArray(v)?v:null;}catch{return null;}
}
const fixedCode=(v,fallback)=>typeof v==='string'&&CODE.test(v)?v:fallback;
const exists=async p=>{try{await fs.lstat(p);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};

// Removes the previous run's folder, only when it is a real folder carrying
// the bench's marker file. Anything else of that name is left alone.
async function removePrevious(bench){
  let stat;try{stat=await fs.lstat(bench);}catch(error){if(error.code==='ENOENT')return'none';fail('BENCH_FOLDER_UNREADABLE');}
  if(stat.isSymbolicLink()||!stat.isDirectory())fail('BENCH_FOLDER_NOT_OURS');
  let marker;try{marker=await fs.lstat(path.join(bench,MARKER));}catch{fail('BENCH_FOLDER_NOT_OURS');}
  if(!marker.isFile())fail('BENCH_FOLDER_NOT_OURS');
  try{await fs.rm(bench,{recursive:true,force:false,maxRetries:5,retryDelay:200});}catch{fail('BENCH_FOLDER_NOT_REMOVED');}
  return'removed';
}

// The steps. Each answers {code, counts}; a refusal throws a fixed code.
function steps({appRoot,bench,runCommand,randomUUID}){
  const config=path.join(appRoot,'config'),machineFile=path.join(bench,'machine.json');
  return{
    async VERIFY(){
      const r=await runCommand('piraiders-verify-bundle.cjs',[]),a=answerOf(r);
      if(!a)fail('VERIFY_ANSWER_UNREADABLE');
      if(r.exitCode===0&&a.code==='BUNDLE_VERIFIED'&&Number.isSafeInteger(a.files))return{code:'BUNDLE_VERIFIED',counts:{files:a.files,extra:0}};
      // After the operator's own setup their files are extra, and only extra.
      const c=a.counts||{};
      if(r.exitCode===1&&a.code==='BUNDLE_DIFFERS'&&JSON.stringify(a.differences)==='["extra"]'&&Number.isSafeInteger(c.extra))
        return{code:'BUNDLE_VERIFIED_OPERATOR_FILES_EXTRA',counts:{extra:c.extra}};
      fail(fixedCode(a.code,'VERIFY_UNEXPECTED'));
    },
    async DEMO_EXCHANGE(){
      await fs.mkdir(bench);
      await fs.writeFile(path.join(bench,MARKER),'PiRaiders bench test folder: removed by the next bench test.\n',{flag:'wx'});
      const docs=exchangeDocuments(),root=path.join(bench,'exchange');
      for(const [relative,bytes] of docs.files){const file=path.join(root,...relative.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes,{flag:'wx'});}
      this.exchange={root:await fs.realpath(root),binding:{...docs.binding}};
      return{code:'DEMO_EXCHANGE_WRITTEN',counts:{files:docs.files.size,pictures:docs.order.length}};
    },
    async MACHINE_FILE(){
      let example,spx;
      try{example=JSON.parse(await fs.readFile(path.join(config,'piraiders-app.source.example.json'),'utf8'));
        spx=JSON.parse(await fs.readFile(path.join(config,'spx-app.example.json'),'utf8'));}
      catch{fail('EXAMPLE_UNREADABLE');}
      const m=sourceMachineFromExample(example,{mediaRoot:this.exchange.root,canonicalRoot:this.exchange.root,binding:this.exchange.binding,randomUUID});
      const ids=[m.source.journalStoreId,m.source.approvalStoreId];
      if(!ids.every(id=>UUID4.test(id))||ids[0]===ids[1])fail('STORE_IDS_INVALID');
      // Everything the app writes stays in the bench folder (paths are
      // relative to app/, as the machine file's own rule says).
      Object.assign(m,{spxConfigFile:FOLDER+'/spx-config.json',catalogDirectory:FOLDER+'/events',cacheRoot:FOLDER+'/cache',runtimeRoot:FOLDER+'/event-runtime',
        output:{...m.output,name:BENCH_NDI_NAME},rossTalk:{...m.rossTalk,port:BENCH_ROSSTALK_PORT}});
      Object.assign(m.source,{journalDirectory:FOLDER+'/private/journal',approvalDirectory:FOLDER+'/private/approvals'});
      if(!spx||typeof spx.general!=='object')fail('EXAMPLE_UNREADABLE');
      spx.general={...spx.general,port:BENCH_SPX_PORT,launchBrowser:false,dataroot:FOLDER+'/DATAROOT',logfolder:FOLDER+'/LOG'};
      for(const dir of ['events','DATAROOT','LOG'])await fs.mkdir(path.join(bench,dir));
      await fs.writeFile(path.join(bench,'spx-config.json'),JSON.stringify(spx,null,2)+'\n',{flag:'wx'});
      await fs.writeFile(machineFile,JSON.stringify(m,null,2)+'\n',{flag:'wx'});
      return{code:'MACHINE_FILE_WRITTEN',counts:{storeIds:2}};
    },
    async SETUP(){
      const r=await runCommand('piraiders-setup.cjs',['--machine',machineFile]),a=answerOf(r),d=a&&a.done;
      if(!a)fail('SETUP_ANSWER_UNREADABLE');
      if(r.exitCode!==0||a.ok!==true||a.step!=='done')fail(fixedCode(a.code,'SETUP_UNEXPECTED'));
      if(!d||d.journal!=='initialized'||d.approvals!=='initialized'||d.source!=='direct'||d.feed!=='checked')fail('SETUP_UNEXPECTED');
      return{code:'SETUP_DONE',counts:{}};
    },
    async DIAGNOSE(){
      const r=await runCommand('piraiders-diagnose.cjs',['--machine',machineFile]),a=answerOf(r);
      if(!a)fail('DIAGNOSE_ANSWER_UNREADABLE');
      if(r.exitCode!==0||a.ok!==true)fail(fixedCode(a.code,'DIAGNOSE_UNEXPECTED'));
      const fixed=checkDiagnose(r);
      return{code:'DIAGNOSE_APP_NOT_RUNNING',counts:{catalogSequence:fixed.states.catalogSequence.sequence}};
    }};
}

// The summary text: fixed words, codes, counts and timings only.
function summaryText(result){
  const lines=['PiRaiders bench test summary',NOT_PROVEN,'result '+result.result+(result.result==='FAIL'?' '+result.failed.step+' '+result.failed.code:'')];
  for(const s of result.steps){
    const counts=Object.entries(s.counts).map(([k,v])=>' '+k+'='+v).join('');
    lines.push('step '+s.step+' '+s.code+' '+s.ms+'ms'+counts);
  }
  lines.push('total '+result.ms+'ms');
  return lines.join('\n')+'\n';
}
// Every token checked again before the summary is written.
function checkSummaryRecord(result){
  const int=n=>Number.isSafeInteger(n)&&n>=0;
  if(!['PASS','FAIL'].includes(result.result)||!int(result.ms))return false;
  if(result.result==='FAIL'&&(!STEPS.concat('START').includes(result.failed.step)||!CODE.test(result.failed.code)))return false;
  return result.steps.every(s=>STEPS.includes(s.step)&&CODE.test(s.code)&&int(s.ms)&&Object.entries(s.counts).every(([k,v])=>/^[a-z][A-Za-z]{0,31}$/.test(k)&&int(v)));
}

// appRoot: the ZIP's app/ folder. print(line): one console line.
async function runBenchTest({appRoot,runCommand,print=()=>{},now=Date.now,randomUUID=crypto.randomUUID}={}){
  if(typeof appRoot!=='string'||!path.isAbsolute(appRoot)||typeof runCommand!=='function'||typeof print!=='function')fail('BENCH_OPTIONS_INVALID');
  const bench=path.join(appRoot,FOLDER),summaryFile=path.join(bench,SUMMARY);
  print('Bench test: works only in its own folder app\\'+FOLDER+'\\ with demo data; your machine file, SPX config, stores and exchange folder are not touched.');
  const started=now(),result={result:'PASS',failed:null,steps:[],ms:0};
  let failure=null;
  try{await removePrevious(bench);}catch(error){failure={step:'START',code:fixedCode(error&&error.code,'BENCH_START_FAILED')};}
  const run=steps({appRoot,bench,runCommand,randomUUID}),context={};
  for(const step of failure?[]:STEPS){
    const t=now();let answer;
    try{answer=await run[step].call(context);}
    catch(error){failure={step,code:fixedCode(error&&error.code,step+'_FAILED')};}
    const ms=Math.max(0,Math.round(now()-t));
    if(failure){result.steps.push({step,code:failure.code,ms,counts:{}});print(step+' '+failure.code);break;}
    result.steps.push({step,code:answer.code,ms,counts:answer.counts});print(step+' '+answer.code);
  }
  if(failure){result.result='FAIL';result.failed=failure;}
  result.ms=Math.max(0,Math.round(now()-started));
  // The summary goes in the bench folder; a run refused at START (the
  // folder is not ours) writes nothing.
  let written=null;
  if(!failure||failure.step!=='START'){
    if(!checkSummaryRecord(result))fail('SUMMARY_NOT_FIXED');
    try{
      if(!(await exists(bench))){await fs.mkdir(bench);await fs.writeFile(path.join(bench,MARKER),'PiRaiders bench test folder: removed by the next bench test.\n',{flag:'wx'});}
      await fs.writeFile(summaryFile,summaryText(result),{flag:'wx'});written=summaryFile;
    }catch{written=null;}
  }
  const tail=result.result==='PASS'?'PASS':'FAIL '+failure.step+' '+failure.code;
  print(tail+(written?'  Summary to send back: '+written:'  (no summary file written)'));
  return{exitCode:result.result==='PASS'?0:1,result,summaryFile:written};
}

module.exports={runBenchTest,sourceMachineFromExample,checkDiagnose,summaryText,BENCH_STEPS:STEPS,BENCH_FOLDER:FOLDER,BENCH_MARKER:MARKER,
  BENCH_PORTS:Object.freeze({spx:BENCH_SPX_PORT,rossTalk:BENCH_ROSSTALK_PORT}),BENCH_NDI_NAME,BENCH_NOT_PROVEN:NOT_PROVEN};
