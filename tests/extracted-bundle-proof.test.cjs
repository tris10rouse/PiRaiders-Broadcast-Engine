'use strict';
// Q-021: the extracted-ZIP Windows proof runs from the ZIP's own Caspar, Mesa
// and NDI runtime only. Linux tests of the proof's pure parts; the proof
// itself runs only on hosted Windows (full-app-proof.yml).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {proofRuntime,proofMachine,assertNoSeparateRuntime,checkBundledCaspar,graphicsRecord}=require('../scripts/extracted-bundle-proof.cjs');
const {COMPONENTS}=require('../scripts/lib/bundled-components.cjs');
const root=path.resolve('/synthetic/PiRaiders-Development'),appRoot=path.join(root,'app');
const base={schemaVersion:1,spxConfigFile:'c.json',catalogDirectory:'/x/catalog',mediaRoot:'/x/media',cacheRoot:'/x/cache',runtimeRoot:'/x/runtime',
 output:{type:'ndi',name:'Label'},presentation:{port:0},rossTalk:{host:'127.0.0.1',port:1}};

test('extracted: the ZIP\'s software Caspar mirror and NDI DLL, provenance from the bundle pins, no CI tools read',()=>{
 const reads=[];const runtime=proofRuntime({extracted:true,appRoot,toolsRoot:'/tools',readJSON:file=>{reads.push(file);return{};}});
 assert.deepEqual(reads,[],'no CI tools.json or ndi-runtime.json is read');
 assert.equal(runtime.casparExecutable,path.join(root,'runtime-software','caspar','casparcg.exe'));
 assert.equal(runtime.casparDirectory,path.join(root,'runtime-software','caspar'));
 assert.equal(runtime.receiverDll,path.join(root,'runtime','ndi','Processing.NDI.Lib.x64.dll'));
 assert.equal(runtime.bundled,true);
 const pin=id=>{const c=COMPONENTS.find(x=>x.id===id);return{name:id,version:c.version,sha256:c.sha256};};
 assert.deepEqual(runtime.casparProvenance,[pin('casparcg'),pin('mesa')]);
 assert.deepEqual(runtime.ndiProvenance,pin('ndi-runtime'));
});

test('extracted: the machine file names no caspar and no NDI folder, so the app takes the bundle',()=>{
 const runtime=proofRuntime({extracted:true,appRoot,toolsRoot:'/tools',readJSON:()=>{throw Error('unexpected');}});
 const machine=proofMachine(base,runtime);
 assert.equal(Object.hasOwn(machine,'caspar'),false);
 assert.equal(Object.hasOwn(machine.output,'runtimeDirectory'),false);
 assert.equal(Object.hasOwn(machine,'renderer'),false,'renderer left to auto, as the shipped examples do');
 assert.deepEqual(machine.output,{type:'ndi',name:'Label'});
 assert.equal(Object.hasOwn(base.output,'runtimeDirectory'),false,'base not changed');
});

test('source tree: CI-prepared Caspar and NDI exactly as before',()=>{
 const files={[path.join('/tools','tools.json')]:{casparDirectory:'/tools/caspar/bin',provenance:[{name:'caspar'}]},[path.join('/tools','ndi-runtime.json')]:{runtimeDirectory:'/ndi',dllPath:'/ndi/x.dll',provenance:{name:'ndi'}}};
 const runtime=proofRuntime({extracted:false,appRoot,toolsRoot:'/tools',readJSON:file=>files[file]});
 assert.equal(runtime.bundled,false);assert.equal(runtime.casparExecutable,path.join('/tools/caspar/bin','casparcg.exe'));
 assert.equal(runtime.receiverDll,'/ndi/x.dll');
 const machine=proofMachine(base,runtime);
 assert.deepEqual(machine.caspar,{executable:path.join('/tools/caspar/bin','casparcg.exe'),cwd:'/tools/caspar/bin',rendererProfile:'mesa-llvmpipe-compat'});
 assert.equal(machine.output.runtimeDirectory,'/ndi');
});

test('a separately installed NDI runtime variable refuses the bundled-only proof',()=>{
 assert.equal(assertNoSeparateRuntime({Path:'C:\\Windows',SystemRoot:'C:\\Windows'}),true);
 for(const key of ['NDI_RUNTIME_DIR_V6','ndi_runtime_dir_v5','NDI_RUNTIME_DIR_V7'])
  assert.throws(()=>assertNoSeparateRuntime({[key]:'C:\\Program Files\\NDI'}),/SEPARATE_NDI_RUNTIME_PRESENT/);
 for(const key of ['GALLIUM_DRIVER','LIBGL_ALWAYS_SOFTWARE','MESA_GL_VERSION_OVERRIDE'])
  assert.throws(()=>assertNoSeparateRuntime({[key]:'x'}),/SEPARATE_MESA_ENVIRONMENT_PRESENT/);
});

test('the app\'s Diagnostics caspar must say bundle, software, layout ready',()=>{
 assert.deepEqual(checkBundledCaspar({from:'bundle',renderer:'software',layout:'ready',code:null}),{from:'bundle',renderer:'software',layout:'ready'});
 for(const bad of [null,{from:'machine-file',renderer:'software',layout:'not-needed',code:null},{from:'bundle',renderer:'gpu',layout:'not-needed',code:null},
  {from:'bundle',renderer:'software',layout:'failed',code:'SOFTWARE_LAYOUT_FAILED'},{from:'bundle',renderer:'software',layout:'ready',code:null,extra:1}])
  assert.throws(()=>checkBundledCaspar(bad),/BUNDLED_SOFTWARE_CASPAR_EXPECTED/);
});

test('the OpenGL check\'s answer is recorded in fixed words and must choose software on the hosted runner',()=>{
 assert.deepEqual(graphicsRecord({check:'GPU_OPENGL_TOO_OLD',probe:'ran'}),{check:'GPU_OPENGL_TOO_OLD',probe:'ran',renderer:'software'});
 assert.deepEqual(graphicsRecord({check:'GPU_OPENGL_UNKNOWN',probe:'failed'}),{check:'GPU_OPENGL_UNKNOWN',probe:'failed',renderer:'software'});
 assert.throws(()=>graphicsRecord({check:'GPU_OPENGL_45',probe:'ran'}),/HOSTED_RUNNER_CHOSE_GPU/);
 for(const bad of [null,{check:'NVIDIA 4.6',probe:'ran'},{check:'GPU_OPENGL_TOO_OLD',probe:'C:\\x'}])assert.throws(()=>graphicsRecord(bad),/GRAPHICS_ANSWER_INVALID/);
});

test('the extracted job prepares no CI-only Caspar, Mesa or NDI and passes a bench folder, not the CI tools',()=>{
 const yml=fs.readFileSync(path.join(__dirname,'..','.github','workflows','full-app-proof.yml'),'utf8');
 const job=yml.slice(yml.indexOf('  actual-extracted-full-app-private-ndi:'));
 assert.ok(job.length>0&&job.startsWith('  actual-extracted-full-app-private-ndi:'));
 assert.doesNotMatch(job,/prepare-caspar-proof|prepare-ndi-proof|caspar-proof-tools/);
 assert.match(job,/smoke-full-app-windows\.cjs build\/extracted-proof-bench build\/windows\/PiRaiders-Development-win-x64\.zip/);
 // The source-tree job keeps its CI-prepared tools.
 const source=yml.slice(yml.indexOf('  actual-full-app-private-ndi:'),yml.indexOf('  actual-exchange-activation-private-ndi:'));
 assert.match(source,/prepare-caspar-proof\.cjs/);assert.match(source,/prepare-ndi-proof\.cjs/);
});

test('the full-app proof takes its Caspar, receiver DLL and machine file from proofRuntime',()=>{
 const smoke=fs.readFileSync(path.join(__dirname,'..','scripts','smoke-full-app-windows.cjs'),'utf8');
 assert.match(smoke,/proofRuntime\(/);assert.match(smoke,/proofMachine\(/);
 assert.doesNotMatch(smoke,/tools\.casparDirectory|ndi\.dllPath|ndi\.runtimeDirectory/);
});
