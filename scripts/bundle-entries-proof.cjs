'use strict';
// BE-006 item 5f part 3: the extracted ZIP's setup and diagnose entries in
// source mode, the steps an operator follows in OPERATOR-CHECKLIST.md:
// Verify-PiRaiders.cmd on the fresh extraction (Q-013), copy the shipped SPX example to app/config.json, write
// app/config/piraiders-app.json from the shipped source-mode example (only
// its placeholders replaced), run Setup-PiRaiders.cmd twice and
// Diagnose-PiRaiders.cmd, then Verify-PiRaiders.cmd again (only the
// operator's own files extra). Kept apart from the Windows script so Linux tests
// run the very same steps with the commands in-process; only the Windows job
// (scripts/smoke-windows-entries.cjs) runs the real .cmd entries.
//
// `runEntry(name, args)` runs one root entry and answers {exitCode, stdout}.
// Only fixed words, codes and counts are kept from its answers, never paths.
// Proof and test use only; the exchange folder is synthetic.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {buildExchangeActivationFixture}=require('./exchange-activation-fixture.cjs');
const {checkSetupTwice,storeBytes,fixedAnswer}=require('./exchange-activation-setup.cjs');

function fail(code,extra){throw Object.assign(Error(code),{code},extra);}
const PLACEHOLDER=/<REPLACE:[^>]*>/;
const FIXED=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

// The shipped source example with each placeholder replaced, nothing else:
// the exchange folder and binding come from the synthetic fixture, the ids are new.
function sourceMachineFromExample(example,{mediaRoot,canonicalRoot,binding,ndiRuntimeDirectory}){
  const value=JSON.parse(JSON.stringify(example));
  const set={mediaRoot:()=>{value.mediaRoot=mediaRoot;},runtimeDirectory:()=>{value.output.runtimeDirectory=ndiRuntimeDirectory;},
    journalStoreId:()=>{value.source.journalStoreId=crypto.randomUUID();},approvalStoreId:()=>{value.source.approvalStoreId=crypto.randomUUID();},
    expectedCanonicalRoot:()=>{value.source.expectedCanonicalRoot=canonicalRoot;},
    feedId:()=>{value.source.binding.feedId=binding.feedId;},epoch:()=>{value.source.binding.epoch=binding.epoch;}};
  const at={mediaRoot:value.mediaRoot,runtimeDirectory:value.output?.runtimeDirectory,journalStoreId:value.source?.journalStoreId,
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
  const word=v=>typeof v==='string'&&FIXED.test(v)?v:null,code=v=>v===null?null:(typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(v)?v:'UNPRINTABLE');
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

// The verify answer reduced to its code, exit, file count and difference kinds.
function checkVerify(result){
  let value;try{value=JSON.parse(String(result&&result.stdout).trim());}catch{fail('VERIFY_ANSWER_UNREADABLE');}
  const kinds=Array.isArray(value?.differences)?value.differences.filter(k=>['missing','changed','extra'].includes(k)):null;
  return{exitCode:Number.isInteger(result.exitCode)?result.exitCode:null,
    code:typeof value?.code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(value.code)?value.code:null,
    files:Number.isSafeInteger(value?.files)?value.files:null,differences:kinds};
}

const exists=async p=>{try{await fs.lstat(p);return true;}catch{return false;}};

// root: the extracted bundle folder (holding app/ and the root entries).
// work: an empty folder of the proof's own for the synthetic exchange.
async function proveBundleEntries({root,work,runEntry}){
  if(typeof root!=='string'||!path.isAbsolute(root)||typeof work!=='string'||!path.isAbsolute(work)||typeof runEntry!=='function')fail('PROOF_OPTIONS_INVALID');
  const app=path.join(root,'app'),config=path.join(app,'config'),machineFile=path.join(config,'piraiders-app.json'),spxConfig=path.join(app,'config.json');
  for(const p of [machineFile,spxConfig])if(await exists(p))fail('BUNDLE_NOT_FRESH');
  // Checklist step 1 (Q-013): the fresh extraction matches its manifest.
  const verified=checkVerify(await runEntry('Verify-PiRaiders.cmd',[]));
  if(verified.exitCode!==0||verified.code!=='BUNDLE_VERIFIED'||verified.differences!==null)fail('VERIFY_UNEXPECTED',{fixed:verified});
  // Checklist step: a new SPX bench copies the shipped SPX example and makes its folders.
  await fs.copyFile(path.join(config,'spx-app.example.json'),spxConfig,fs.constants.COPYFILE_EXCL);
  for(const dir of ['DATAROOT','LOG','events'])await fs.mkdir(path.join(app,dir),{recursive:true});
  // The synthetic exchange folder; its own machine file is only read for the binding.
  const built=await buildExchangeActivationFixture({root:path.join(work,'proof'),setUpStores:false,machine:{}});
  const fixture=JSON.parse(await fs.readFile(built.machineFile,'utf8'));
  const ndiRuntimeDirectory=path.join(work,'ndi-runtime');await fs.mkdir(ndiRuntimeDirectory);
  const example=JSON.parse(await fs.readFile(path.join(config,'piraiders-app.source.example.json'),'utf8'));
  const machine=sourceMachineFromExample(example,{mediaRoot:built.sourceRoot,canonicalRoot:fixture.source.expectedCanonicalRoot,binding:fixture.source.binding,ndiRuntimeDirectory});
  await fs.writeFile(machineFile,JSON.stringify(machine,null,2)+'\n',{flag:'wx'});
  const source={journalDirectory:path.resolve(app,machine.source.journalDirectory),approvalDirectory:path.resolve(app,machine.source.approvalDirectory)};
  for(const p of Object.values(source))if(await exists(p))fail('STORES_NOT_FRESH');

  const setup=async args=>{const r=await runEntry('Setup-PiRaiders.cmd',args);return{exitCode:r.exitCode,answer:fixedAnswer(r.stdout)};};
  const first=await setup([]);
  const before=await storeBytes(source).catch(()=>fail('STORES_MISSING'));
  if(Object.keys(before).length<2)fail('STORES_EMPTY');
  const second=await setup([]);
  const stores=checkSetupTwice(first,second);
  const after=await storeBytes(source);
  if(JSON.stringify(after)!==JSON.stringify(before))fail('SETUP_SECOND_RUN_WROTE');
  // A wrong argument is refused by the entry itself, before any command runs.
  const usage=await runEntry('Setup-PiRaiders.cmd',['--no-such-option']);
  if(usage.exitCode!==2)fail('SETUP_USAGE_NOT_REFUSED',{exitCode:Number.isInteger(usage.exitCode)?usage.exitCode:null});
  if(JSON.stringify(await storeBytes(source))!==JSON.stringify(before))fail('SETUP_USAGE_WROTE');
  const diagnose=checkDiagnose(await runEntry('Diagnose-PiRaiders.cmd',[]));
  // After configuration the operator's own files are extra, and only extra.
  const afterSetup=checkVerify(await runEntry('Verify-PiRaiders.cmd',[]));
  if(afterSetup.exitCode!==1||afterSetup.code!=='BUNDLE_DIFFERS'||JSON.stringify(afterSetup.differences)!=='["extra"]')fail('VERIFY_UNEXPECTED',{fixed:afterSetup});
  return{event:'windows-bundle-entries-proof',verify:{fresh:verified,afterSetup},setup:{...stores,firstCode:first.answer.code,secondCode:second.answer.code,storeFiles:Object.keys(before).length,
    secondRunWroteNothing:true,wrongArgumentExit:2},diagnose};
}

module.exports={proveBundleEntries,sourceMachineFromExample,checkDiagnose,checkVerify};
