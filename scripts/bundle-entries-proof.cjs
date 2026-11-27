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
const fs=require('node:fs/promises'),path=require('node:path');
const {buildExchangeActivationFixture}=require('./exchange-activation-fixture.cjs');
const {checkSetupTwice,storeBytes,fixedAnswer}=require('./exchange-activation-setup.cjs');
const {CHECK_CODES,chooseRenderer}=require('./lib/graphics-check.cjs');
const {sourceMachineFromExample,checkDiagnose}=require('./lib/bench-test.cjs');

function fail(code,extra){throw Object.assign(Error(code),{code},extra);}

// The machine file from the shipped example and the diagnose check live in
// scripts/lib/bench-test.cjs since Q-031 (the bench test uses them too).

// Q-019: an answer's `graphics` reduced to its fixed words. The proof runs on
// hosted Windows, which has no GPU: the check must not say 4.5 and the
// renderer must be software. ranRequired (the Windows job): the bundled check
// itself must have run, not been missing or failed.
const PROBES=['ran','failed','missing','not-windows'];
function checkGraphics(text,{ranRequired=false}={}){
  let value;try{value=JSON.parse(String(text).trim());}catch{fail('GRAPHICS_UNEXPECTED');}
  const g=value&&value.graphics;
  const fixed={check:CHECK_CODES.includes(g?.check)?g.check:null,probe:PROBES.includes(g?.probe)?g.probe:null,
    setting:['auto','gpu','software'].includes(g?.setting)?g.setting:null,renderer:['gpu','software'].includes(g?.renderer)?g.renderer:null};
  if(!g||typeof g!=='object'||JSON.stringify(Object.keys(g))!=='["check","probe","setting","renderer"]'||Object.values(fixed).includes(null))fail('GRAPHICS_UNEXPECTED',{graphics:fixed});
  if(fixed.renderer!==chooseRenderer(fixed.check,fixed.setting)||fixed.setting!=='auto'||fixed.check==='GPU_OPENGL_45'||fixed.renderer!=='software')fail('GRAPHICS_UNEXPECTED',{graphics:fixed});
  if(fixed.probe!=='ran'&&(ranRequired||fixed.check!=='GPU_OPENGL_UNKNOWN'))fail('GRAPHICS_UNEXPECTED',{graphics:fixed});
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
async function proveBundleEntries({root,work,runEntry,graphicsRanRequired=false}){
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
  const example=JSON.parse(await fs.readFile(path.join(config,'piraiders-app.source.example.json'),'utf8'));
  const machine=sourceMachineFromExample(example,{mediaRoot:built.sourceRoot,canonicalRoot:fixture.source.expectedCanonicalRoot,binding:fixture.source.binding});
  await fs.writeFile(machineFile,JSON.stringify(machine,null,2)+'\n',{flag:'wx'});
  const source={journalDirectory:path.resolve(app,machine.source.journalDirectory),approvalDirectory:path.resolve(app,machine.source.approvalDirectory)};
  for(const p of Object.values(source))if(await exists(p))fail('STORES_NOT_FRESH');

  const setup=async args=>{const r=await runEntry('Setup-PiRaiders.cmd',args);return{exitCode:r.exitCode,answer:fixedAnswer(r.stdout),stdout:r.stdout};};
  const first=await setup([]);
  const before=await storeBytes(source).catch(()=>fail('STORES_MISSING'));
  if(Object.keys(before).length<2)fail('STORES_EMPTY');
  const second=await setup([]);
  const stores=checkSetupTwice(first,second);
  const after=await storeBytes(source);
  if(JSON.stringify(after)!==JSON.stringify(before))fail('SETUP_SECOND_RUN_WROTE');
  // Q-019: both setup runs report the same OpenGL check and renderer.
  const graphics=[first,second].map(r=>checkGraphics(r.stdout,{ranRequired:graphicsRanRequired}));
  if(JSON.stringify(graphics[0])!==JSON.stringify(graphics[1]))fail('GRAPHICS_UNEXPECTED',{graphics:graphics[1]});
  // A wrong argument is refused by the entry itself, before any command runs.
  const usage=await runEntry('Setup-PiRaiders.cmd',['--no-such-option']);
  if(usage.exitCode!==2)fail('SETUP_USAGE_NOT_REFUSED',{exitCode:Number.isInteger(usage.exitCode)?usage.exitCode:null});
  if(JSON.stringify(await storeBytes(source))!==JSON.stringify(before))fail('SETUP_USAGE_WROTE');
  const diagnosed=await runEntry('Diagnose-PiRaiders.cmd',[]);
  const diagnose={...checkDiagnose(diagnosed),graphics:checkGraphics(diagnosed.stdout,{ranRequired:graphicsRanRequired})};
  // After configuration the operator's own files are extra, and only extra.
  const afterSetup=checkVerify(await runEntry('Verify-PiRaiders.cmd',[]));
  if(afterSetup.exitCode!==1||afterSetup.code!=='BUNDLE_DIFFERS'||JSON.stringify(afterSetup.differences)!=='["extra"]')fail('VERIFY_UNEXPECTED',{fixed:afterSetup});
  return{event:'windows-bundle-entries-proof',verify:{fresh:verified,afterSetup},setup:{...stores,firstCode:first.answer.code,secondCode:second.answer.code,storeFiles:Object.keys(before).length,
    secondRunWroteNothing:true,wrongArgumentExit:2,graphics:graphics[1]},diagnose};
}

module.exports={proveBundleEntries,sourceMachineFromExample,checkDiagnose,checkVerify,checkGraphics};
