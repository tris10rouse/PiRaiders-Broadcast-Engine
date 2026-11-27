'use strict';
// Q-028: after the installer check, each step of the NDI proof's preparation
// answers its own fixed code, so a CI failure names its step.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const ndi=require('../scripts/prepare-ndi-proof.cjs');

function x64Pe(){const b=Buffer.alloc(256);b.write('MZ',0,'ascii');b.writeUInt32LE(64,60);b.writeUInt32LE(0x00004550,64);b.writeUInt16LE(0x8664,68);return b;}
async function layout(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ndi-steps-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const installRoot=path.join(root,'ndi-runtime');await fs.mkdir(path.join(installRoot,'bin'),{recursive:true});
  await fs.writeFile(path.join(installRoot,'bin','Processing.NDI.Lib.x64.dll'),x64Pe());
  await fs.writeFile(path.join(installRoot,'NDI License.txt'),'stand-in');
  return{root,installRoot,installerProvenance:{name:'ndi-runtime'},signature:{signatureStatus:'Valid',signer:'stand-in'}};
}
function quiet(t){const errors=[];t.mock.method(console,'error',line=>errors.push(String(line)));return errors;}

test('an unnamed error inside a step becomes that step\'s code, never the generic one, and prints no path',async t=>{
  const errors=quiet(t);
  await assert.rejects(ndi.step('RUNTIME_DLL_READ_FAILED',()=>fs.readFile(path.join(os.tmpdir(),'no-such-dir-q028','x.dll'))),{message:'RUNTIME_DLL_READ_FAILED'});
  assert.deepEqual(JSON.parse(errors[0]),{event:'ndi-runtime-step-failed',code:'RUNTIME_DLL_READ_FAILED',errno:'ENOENT'});
  assert.ok(!errors.join('\n').includes('q028'));
  await assert.rejects(ndi.step('RUNTIME_DLL_METADATA_FAILED',()=>JSON.parse('not json')),{message:'RUNTIME_DLL_METADATA_FAILED'});
  await assert.rejects(ndi.step('RUNTIME_LISTING_FAILED',()=>{throw Error('RUNTIME_LAYOUT_INVALID');}),{message:'RUNTIME_LAYOUT_INVALID'},'a coded error passes through');
  assert.equal(await ndi.step('X_FAILED',async()=>7),7);
  assert.equal(ndi.failureCode(Error('RUNTIME_DLL_READ_FAILED')),'RUNTIME_DLL_READ_FAILED');
  assert.equal(ndi.failureCode(Error('ENOENT: /secret/path')),'RUNTIME_PREPARATION_FAILED');
  assert.equal(ndi.failureCode('text'),'RUNTIME_PREPARATION_FAILED');
});

test('recording the installed runtime names the step that failed',async t=>{
  quiet(t);
  const ok=await layout(t);
  const provenance=await ndi.recordInstalledRuntime({...ok,metadata:()=>({fileVersion:'6.4.0.2'})});
  assert.equal(provenance.dll.fileVersion,'6.4.0.2');assert.deepEqual(provenance.notices,['NDI License.txt']);
  const record=JSON.parse(await fs.readFile(path.join(ok.root,'ndi-runtime.json'),'utf8'));assert.equal(path.basename(record.dllPath),'Processing.NDI.Lib.x64.dll');

  const missing=await layout(t);await fs.rm(missing.installRoot,{recursive:true});
  await assert.rejects(ndi.recordInstalledRuntime({...missing,metadata:()=>({})}),{message:'RUNTIME_LISTING_FAILED'});

  const badMeta=await layout(t);
  await assert.rejects(ndi.recordInstalledRuntime({...badMeta,metadata:()=>JSON.parse('')}),{message:'RUNTIME_DLL_METADATA_FAILED'});

  const badWrite=await layout(t);await fs.mkdir(path.join(badWrite.root,'ndi-runtime.json'));
  await assert.rejects(ndi.recordInstalledRuntime({...badWrite,metadata:()=>({})}),{message:'RUNTIME_RECORD_WRITE_FAILED'});

  const twoDlls=await layout(t);await fs.writeFile(path.join(twoDlls.installRoot,'processing.ndi.lib.x64.dll'),x64Pe());
  await assert.rejects(ndi.recordInstalledRuntime({...twoDlls,metadata:()=>({})}),{message:'RUNTIME_LAYOUT_INVALID'});
});

test('the script\'s entry prints only failureCode, and main names every step after the installer check',async()=>{
  const source=await fs.readFile(path.join(__dirname,'..','scripts','prepare-ndi-proof.cjs'),'utf8');
  assert.match(source,/main\(\)\.catch\(error=>\{console\.error\(failureCode\(error\)\);/);
  const after=source.slice(source.indexOf("event:'ndi-installer-verified'"));
  assert.match(after,/recordInstalledRuntime\(\{root,installRoot,installerProvenance,signature\}\)/);
});
