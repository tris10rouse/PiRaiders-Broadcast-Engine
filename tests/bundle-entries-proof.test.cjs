'use strict';
// 5f-3: the steps of the Windows job that runs the extracted ZIP's setup and
// diagnose entries in source mode, run here on Linux over a bundle-shaped
// folder with the commands in-process. The real .cmd entries run only in
// the Windows job (scripts/smoke-windows-entries.cjs); nothing here is a
// Windows claim.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {proveBundleEntries,sourceMachineFromExample,checkDiagnose}=require('../scripts/bundle-entries-proof.cjs');
const bundle=require('../scripts/lib/windows-bundle.cjs');
const LINUX_GRAPHICS=process.platform==='win32'?{check:'GPU_OPENGL_UNKNOWN',probe:'missing',setting:'auto',renderer:'software'}:{check:'GPU_OPENGL_UNKNOWN',probe:'not-windows',setting:'auto',renderer:'software'};
const {checkGraphics}=require('../scripts/bundle-entries-proof.cjs');
const setupCommand=require('../scripts/piraiders-setup.cjs'),diagnoseCommand=require('../scripts/piraiders-diagnose.cjs'),verifyCommand=require('../scripts/piraiders-verify-bundle.cjs');
const METADATA={commitSHA:'b'.repeat(40),spxVersion:'1.3.0',node:{version:'v22.0.0',platform:'win32',arch:'x64'}};
const ROOT=path.join(__dirname,'..');

// A folder shaped like the extracted ZIP: the shipped templates where the ZIP puts them.
async function bundleShape(t){
  const parent=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders entries 鷹 ! ')));
  t.after(()=>fs.rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const root=path.join(parent,'Extracted package','PiRaiders-Development'),work=path.join(parent,'work');
  for(const [source,target] of bundle.TEMPLATES){const file=path.join(root,...target.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.copyFile(path.join(ROOT,source),file);}
  await fs.mkdir(work);
  // The example's Caspar paths are Windows paths, not absolute on Linux: map
  // them into the temporary folder in the copy (as windows-bundle-commands does).
  if(process.platform!=='win32'){
    const file=path.join(root,'app','config','piraiders-app.source.example.json'),value=JSON.parse(await fs.readFile(file,'utf8'));
    const local=p=>path.join(parent,'components',p.replace(/^[A-Za-z]:\//,'').replace(/[^A-Za-z0-9/-]/g,'_'));
    value.caspar={executable:local(value.caspar.executable),cwd:local(value.caspar.cwd)};await fs.writeFile(file,JSON.stringify(value,null,2));
  }
  // The extraction's manifest, as the build writes it (Q-013).
  await fs.writeFile(path.join(root,'BUILD-MANIFEST.json'),JSON.stringify(bundle.createManifest(root,METADATA),null,2)+'\n');
  return{parent,root,app:path.join(root,'app'),work};
}
// Stands in for the three .cmd entries: the same command on the fixed machine
// file from the app folder, and the entries' own refusal (exit 2) of any
// other argument. The Windows job runs the real entries instead.
function inProcessEntries(app,calls=[]){
  const machine=path.join(app,'config','piraiders-app.json');
  return async(name,args)=>{
    calls.push([name,...args]);
    let r;
    if(name==='Setup-PiRaiders.cmd'){
      if(args.length>1||args.length===1&&args[0]!=='--pin-offline')return{exitCode:2,stdout:'Only the optional --pin-offline argument is supported.\n'};
      r=await setupCommand.main(['--machine',machine,...args],{appRoot:app});
    }else if(name==='Diagnose-PiRaiders.cmd'){
      if(args.length)return{exitCode:2,stdout:'Diagnose-PiRaiders.cmd takes no arguments.\n'};
      r=await diagnoseCommand.main(['--machine',machine],{appRoot:app});
    }else if(name==='Verify-PiRaiders.cmd'){
      if(args.length)return{exitCode:2,stdout:'Verify-PiRaiders.cmd takes no arguments.\n'};
      r=verifyCommand.main([],{root:path.dirname(app)});
    }else throw Error('unknown entry');
    return{exitCode:r.exitCode,stdout:JSON.stringify(r.answer)+'\n'};
  };
}

test('setup twice, a wrong argument and diagnose pass over the shipped examples and keep fixed codes only',async t=>{
  const {parent,root,app,work}=await bundleShape(t),calls=[];
  const evidence=await proveBundleEntries({root,work,runEntry:inProcessEntries(app,calls)});
  assert.deepEqual(calls,[['Verify-PiRaiders.cmd'],['Setup-PiRaiders.cmd'],['Setup-PiRaiders.cmd'],['Setup-PiRaiders.cmd','--no-such-option'],['Diagnose-PiRaiders.cmd'],['Verify-PiRaiders.cmd']]);
  assert.deepEqual(evidence.verify.fresh,{exitCode:0,code:'BUNDLE_VERIFIED',files:bundle.TEMPLATES.length,differences:null});
  assert.deepEqual(evidence.verify.afterSetup,{exitCode:1,code:'BUNDLE_DIFFERS',files:null,differences:['extra']});
  assert.deepEqual(evidence.setup,{first:{journal:'initialized',approvals:'initialized'},second:{journal:'present',approvals:'present'},
    firstCode:null,secondCode:null,storeFiles:evidence.setup.storeFiles,secondRunWroteNothing:true,wrongArgumentExit:2,graphics:LINUX_GRAPHICS});
  // Q-019: off Windows the check is not run; unknown means software.
  assert.deepEqual(evidence.diagnose.graphics,LINUX_GRAPHICS);
  assert.ok(evidence.setup.storeFiles>=2);
  assert.equal(evidence.diagnose.app,'not-running');assert.equal(evidence.diagnose.mode,'source');
  assert.deepEqual(evidence.diagnose.states.exchangeFolder,{state:'reachable',code:null,from:'stores'});
  assert.equal(evidence.diagnose.states.catalogSequence.state,'read');
  for(const name of ['prepared','renderer','ndiSender'])assert.deepEqual(evidence.diagnose.states[name],{state:'unknown',code:'APP_NOT_RUNNING',from:'app'});
  const text=JSON.stringify(evidence);
  for(const p of [parent,root,work,'鷹','exchange-journal','REPLACE','components'])assert.ok(!text.includes(p),'evidence must not name '+p);
  // The machine file is the shipped example with only its placeholders replaced.
  const example=JSON.parse(await fs.readFile(path.join(app,'config','piraiders-app.source.example.json'),'utf8'));
  const written=JSON.parse(await fs.readFile(path.join(app,'config','piraiders-app.json'),'utf8'));
  assert.deepEqual(written.rossTalk,example.rossTalk);assert.deepEqual(written.caspar,example.caspar);
  assert.equal(written.source.journalDirectory,example.source.journalDirectory);
  assert.deepEqual(await fs.readFile(path.join(app,'config.json')),await fs.readFile(path.join(ROOT,'packaging/windows/spx-app.example.json')));
});

test('the proof refuses a bundle that already holds an operator file',async t=>{
  const {root,app,work}=await bundleShape(t);
  await fs.writeFile(path.join(app,'config.json'),'{}');
  await assert.rejects(proveBundleEntries({root,work,runEntry:inProcessEntries(app)}),{code:'BUNDLE_NOT_FRESH'});
  await assert.rejects(proveBundleEntries({root:'relative',work,runEntry:inProcessEntries(app)}),{code:'PROOF_OPTIONS_INVALID'});
});

test('a second setup run that sets up again, or a wrong argument not refused, fails the proof',async t=>{
  {
    const {root,app,work}=await bundleShape(t),real=inProcessEntries(app);let n=0;
    const again=async(name,args)=>{const r=await real(name,args);if(name==='Setup-PiRaiders.cmd'&&++n===2)return{exitCode:0,stdout:r.stdout.replace(/"present"/g,'"initialized"')};return r;};
    await assert.rejects(proveBundleEntries({root,work,runEntry:again}),{code:'SETUP_SECOND_RUN_CHANGED'});
  }
  {
    const {root,app,work}=await bundleShape(t),real=inProcessEntries(app);
    const lax=async(name,args)=>real(name,args[0]==='--no-such-option'?[]:args);
    await assert.rejects(proveBundleEntries({root,work,runEntry:lax}),{code:'SETUP_USAGE_NOT_REFUSED'});
  }
});

test('a store byte changed by the second setup run or by the refused argument fails the proof',async t=>{
  for(const [call,code] of [[2,'SETUP_SECOND_RUN_WROTE'],[3,'SETUP_USAGE_WROTE']]){
    const {root,app,work}=await bundleShape(t),real=inProcessEntries(app);let n=0;
    const writes=async(name,args)=>{const r=await real(name,args);
      // Counts the setup calls only; the verify entry runs before them.
      if(name!=='Verify-PiRaiders.cmd'&&++n===call)await fs.writeFile(path.join(app,'data','exchange-approvals','extra-file'),'x');return r;};
    await assert.rejects(proveBundleEntries({root,work,runEntry:writes}),{code});
  }
});

test('a first setup run that leaves the stores empty fails the proof',async t=>{
  const {root,app,work}=await bundleShape(t);
  const empty=async(name,args)=>{if(name==='Setup-PiRaiders.cmd'&&!args.length){
      for(const d of ['exchange-journal','exchange-approvals'])await fs.mkdir(path.join(app,'data',d),{recursive:true});
      return{exitCode:0,stdout:JSON.stringify({ok:true,step:'done',code:null,done:{machine:'checked',source:'direct',feed:'checked',journal:'initialized',approvals:'initialized'}})};}
    return inProcessEntries(app)(name,args);};
  await assert.rejects(proveBundleEntries({root,work,runEntry:empty}),{code:'STORES_EMPTY'});
});

test('the example must hold every placeholder and keeps none once filled',()=>{
  const example={mediaRoot:'<REPLACE: a>',output:{runtimeDirectory:'<REPLACE: b>'},source:{journalStoreId:'<REPLACE: c>',approvalStoreId:'<REPLACE: d>',
    expectedCanonicalRoot:'<REPLACE: e>',binding:{feedId:'<REPLACE: f>',epoch:'<REPLACE: g>'}},caspar:{cwd:'C:/x'}};
  const values={mediaRoot:'/m',canonicalRoot:'/m',binding:{feedId:'id',epoch:1},ndiRuntimeDirectory:'/n'};
  const filled=sourceMachineFromExample(example,values);
  assert.doesNotMatch(JSON.stringify(filled),/REPLACE/);assert.equal(filled.source.binding.epoch,1);assert.deepEqual(filled.caspar,{cwd:'C:/x'});
  assert.throws(()=>sourceMachineFromExample({...example,mediaRoot:'/already'},values),{code:'EXAMPLE_PLACEHOLDER_MISSING'});
  assert.throws(()=>sourceMachineFromExample({...example,extra:'<REPLACE: new>'},values),{code:'EXAMPLE_PLACEHOLDER_LEFT'});
});

test('diagnose answers other than stores ready and app not running are refused',()=>{
  const state=(s,c,from)=>({state:s,code:c,from});
  const good={ok:true,mode:'source',app:'not-running',ready:false,states:{exchangeFolder:state('reachable',null,'stores'),catalogSequence:{...state('read',null,'stores'),sequence:1},
    approvals:state('readable',null,'stores'),prepared:state('unknown','APP_NOT_RUNNING','app'),renderer:state('unknown','APP_NOT_RUNNING','app'),ndiSender:state('unknown','APP_NOT_RUNNING','app')}};
  const run=(v,exitCode=0)=>checkDiagnose({exitCode,stdout:JSON.stringify(v)});
  assert.equal(run(good).states.catalogSequence.sequence,1);
  assert.throws(()=>run(good,1),{code:'DIAGNOSE_UNEXPECTED'});
  assert.throws(()=>run({...good,app:'config-invalid'}),{code:'DIAGNOSE_UNEXPECTED'});
  assert.throws(()=>run({...good,states:{...good.states,exchangeFolder:state('unreachable','SOURCE_UNAVAILABLE','stores')}}),{code:'DIAGNOSE_UNEXPECTED'});
  assert.throws(()=>run({...good,states:{...good.states,renderer:state('acknowledged',null,'app')}}),{code:'DIAGNOSE_UNEXPECTED'});
  assert.throws(()=>run({...good,states:{...good.states,catalogSequence:state('read',null,'stores')}}),{code:'DIAGNOSE_UNEXPECTED'});
  assert.throws(()=>checkDiagnose({exitCode:0,stdout:'not json'}),{code:'DIAGNOSE_ANSWER_UNREADABLE'});
});

// Q-013: the verify entry runs on the fresh extraction and after setup.
test('a fresh extraction that differs from its manifest, or extra-only not holding after setup, fails the proof',async t=>{
  {
    const {root,app,work}=await bundleShape(t);
    await fs.appendFile(path.join(root,'README-WINDOWS.md'),'\n');
    await assert.rejects(proveBundleEntries({root,work,runEntry:inProcessEntries(app)}),e=>e.code==='VERIFY_UNEXPECTED'&&e.fixed.code==='BUNDLE_DIFFERS'&&JSON.stringify(e.fixed.differences)==='["changed"]');
    // Nothing of the operator's was written before the refusal.
    await assert.rejects(fs.lstat(path.join(app,'config','piraiders-app.json')),{code:'ENOENT'});
  }
  {
    const {root,app,work}=await bundleShape(t),real=inProcessEntries(app);let n=0;
    const damages=async(name,args)=>{if(name==='Verify-PiRaiders.cmd'&&++n===2)await fs.rm(path.join(root,'Launch-PiRaiders.cmd'));return real(name,args);};
    await assert.rejects(proveBundleEntries({root,work,runEntry:damages}),e=>e.code==='VERIFY_UNEXPECTED'&&JSON.stringify(e.fixed.differences)==='["missing","extra"]');
  }
  {
    const {root,app,work}=await bundleShape(t);
    const unreadable=async(name,args)=>name==='Verify-PiRaiders.cmd'?{exitCode:0,stdout:'not json'}:inProcessEntries(app)(name,args);
    await assert.rejects(proveBundleEntries({root,work,runEntry:unreadable}),{code:'VERIFY_ANSWER_UNREADABLE'});
  }
});

test('Q-019: the graphics answer must be fixed words, the software choice with no GPU, and the check run where required',async t=>{
  const line=g=>JSON.stringify({ok:true,graphics:g});
  const ran={check:'GPU_OPENGL_TOO_OLD',probe:'ran',setting:'auto',renderer:'software'};
  assert.deepEqual(checkGraphics(line(ran),{ranRequired:true}),ran);
  assert.deepEqual(checkGraphics(line({...ran,check:'GPU_OPENGL_UNKNOWN'}),{ranRequired:true}),{...ran,check:'GPU_OPENGL_UNKNOWN'});
  assert.deepEqual(checkGraphics(line({check:'GPU_OPENGL_UNKNOWN',probe:'missing',setting:'auto',renderer:'software'})).probe,'missing');
  for(const [g,options] of [
    [{check:'GPU_OPENGL_UNKNOWN',probe:'missing',setting:'auto',renderer:'software'},{ranRequired:true}],
    [{check:'GPU_OPENGL_UNKNOWN',probe:'not-windows',setting:'auto',renderer:'software'},{ranRequired:true}],
    [{check:'GPU_OPENGL_TOO_OLD',probe:'failed',setting:'auto',renderer:'software'},{}],
    [{check:'GPU_OPENGL_45',probe:'ran',setting:'auto',renderer:'gpu'},{}],
    [{...ran,renderer:'gpu'},{}],[{...ran,setting:'software'},{}],[{...ran,check:'NVIDIA'},{}],[{...ran,probe:'yes'},{}],
    [{...ran,name:'GPU'},{}],[{check:ran.check,probe:ran.probe,setting:ran.setting},{}],[undefined,{}],['software',{}]]){
    assert.throws(()=>checkGraphics(line(g),options),e=>e.code==='GRAPHICS_UNEXPECTED'&&!JSON.stringify(e.graphics??null).includes('NVIDIA'),JSON.stringify(g));
  }
  assert.throws(()=>checkGraphics('not json'),{code:'GRAPHICS_UNEXPECTED'});
  // A setup run whose answer lacks the graphics answer fails the proof.
  const {root,app,work}=await bundleShape(t),entries=inProcessEntries(app);
  const without=async(name,args)=>{const r=await entries(name,args);if(name!=='Setup-PiRaiders.cmd'||args.length)return r;
    const v=JSON.parse(r.stdout);delete v.graphics;return{...r,stdout:JSON.stringify(v)+'\n'};};
  await assert.rejects(proveBundleEntries({root,work,runEntry:without}),{code:'GRAPHICS_UNEXPECTED'});
});
