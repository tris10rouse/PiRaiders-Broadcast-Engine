'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createManifest}=require('../scripts/lib/windows-bundle.cjs');
const {createRuntimeDiagnostics,canonicalImage,cleanAppEnvironment,inventory,verifyOriginalInventory,sourceLocation,extractedLocation,captureAppParent,assertOuterBench}=require('../scripts/extracted-app-proof.cjs');
const {ownedCaspar,privateText}=require('../scripts/smoke-full-app-windows.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'extracted-proof-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 for(const name of ['Launch-PiRaiders.cmd','runtime/node.exe','app/build/windows/PiRaiders.JobHost.exe','app/scripts/piraiders-app.cjs','app/server.js']){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'synthetic '+name);}
 const manifest=createManifest(root,{commitSHA:'a'.repeat(40),spxVersion:'1.4.1',node:{version:'v22.23.4',platform:'win32',arch:'x64'}});fs.writeFileSync(path.join(root,'BUILD-MANIFEST.json'),JSON.stringify(manifest));return root;
}
test('extracted location comes from a complete original inventory and retains bundled paths/version',t=>{
 const root=fixture(t),record=inventory(root),location=extractedLocation(root,record);
 assert.equal(location.appRoot,path.join(root,'app'));assert.equal(location.nodeExecutable,path.join(root,'runtime/node.exe'));assert.equal(location.jobHost,path.join(root,'app/build/windows/PiRaiders.JobHost.exe'));assert.equal(location.entry,path.join(root,'Launch-PiRaiders.cmd'));assert.equal(location.extracted,true);assert.equal(record.nodeVersion,'v22.23.4');assert.equal(record.sourceCommit,'a'.repeat(40));assert.equal(Object.isFrozen(record.files),true);assert.equal(Object.isFrozen(record.files[0]),true);
 assert.throws(()=>extractedLocation(path.dirname(root),record),/PROOF_INVENTORY_ROOT/);
 fs.writeFileSync(path.join(root,'unlisted.js'),'new code');assert.throws(()=>inventory(root),/unlisted/);
});
test('original inventory is never regenerated to admit runtime configuration or hide code mutation',t=>{
 const root=fixture(t),record=inventory(root),original=fs.readFileSync(path.join(root,'app/server.js'));
 fs.mkdirSync(path.join(root,'app/config'));fs.writeFileSync(path.join(root,'app/config/piraiders-app.json'),'synthetic generated config');assert.equal(verifyOriginalInventory(record),true);
 fs.writeFileSync(path.join(root,'app/server.js'),Buffer.alloc(original.length,65));assert.throws(()=>verifyOriginalInventory(record),/ORIGINAL_FILE_HASH/);fs.writeFileSync(path.join(root,'app/server.js'),original);
 fs.appendFileSync(path.join(root,'BUILD-MANIFEST.json'),' ');assert.throws(()=>verifyOriginalInventory(record),/ORIGINAL_MANIFEST_CHANGED/);
});
test('original inventory refuses deletion and directory link substitution',t=>{
 const root=fixture(t),record=inventory(root),target=path.join(root,'app/scripts'),moved=path.join(root,'moved-scripts');fs.renameSync(target,moved);fs.symlinkSync(moved,target,process.platform==='win32'?'junction':'dir');assert.throws(()=>verifyOriginalInventory(record),/PROOF_INVENTORY_LINK/);fs.unlinkSync(target);fs.renameSync(moved,target);fs.unlinkSync(path.join(root,'app/server.js'));assert.throws(()=>verifyOriginalInventory(record),/ENOENT/);
});
test('app proof environment removes inherited Mesa variants and external Node/npm launch mechanisms',()=>{
 const result=cleanAppEnvironment({Path:'private-node-path',PATH:'other',Node_Options:'--require private',node_path:'private',NPM_CONFIG_PREFIX:'private',gallium_driver:'wrong',LIBGL_ALWAYS_SOFTWARE:'wrong',Mesa_gl_version_override:'wrong',SystemRoot:'C:\\Windows',KEEP:'value'},'C:\\Windows');
 assert.deepEqual(result,{SystemRoot:'C:\\Windows',KEEP:'value',Path:'C:\\Windows\\System32;C:\\Windows'});
 assert.throws(()=>cleanAppEnvironment({},'relative'),/PROOF_SYSTEM_ROOT/);
 assert.equal(sourceLocation(path.resolve('synthetic')).extracted,false);assert.throws(()=>sourceLocation('relative'),/PROOF_LOCATION_ABSOLUTE/);
});
function row(id,parent,ticks,image){return{ProcessId:id,ParentProcessId:parent,CreationUtcTicks:String(ticks),ExecutablePath:image};}
function processes(){return[row(10,1,100,'C:\\bundle\\JobHost.exe'),row(11,10,110,'C:\\Windows\\powershell.exe'),row(12,11,120,'C:\\Windows\\cmd.exe'),row(13,12,130,'C:\\bundle\\runtime\\node.exe'),row(14,13,140,'C:\\bundle\\JobHost.exe'),row(15,14,150,'C:\\bundle\\runtime\\node.exe')];}
test('actual bundled CLI capture keeps held outer bench separate from inner Node generations',()=>{
 const rows=processes(),found=captureAppParent(rows,10,'C:\\bundle\\runtime\\node.exe','C:\\Windows\\powershell.exe',{realpath:x=>x});assert.equal(found.parent.ProcessId,13);assert.equal(found.outerRoots[0].ProcessId,11);assertOuterBench(rows,{exitCode:null,signalCode:null},found.outerRoots);
 assert.throws(()=>assertOuterBench(rows,{exitCode:0,signalCode:null},found.outerRoots),/OUTER_CONTAINMENT_REMAINS_ALIVE/);
 assert.throws(()=>assertOuterBench(rows.filter(x=>x.ProcessId!==11),{exitCode:null,signalCode:null},found.outerRoots),/OUTER_BENCH_REMAINS_ALIVE/);
 const reused=rows.map(x=>x.ProcessId===11?{...x,CreationUtcTicks:'200'}:x);assert.throws(()=>assertOuterBench(reused,{exitCode:null,signalCode:null},found.outerRoots),/OUTER_BENCH_REMAINS_ALIVE/);
 rows.push(row(16,12,160,'C:\\bundle\\runtime\\node.exe'));assert.throws(()=>captureAppParent(rows,10,'C:\\bundle\\runtime\\node.exe','C:\\Windows\\powershell.exe',{realpath:x=>x}),/one exact bundled Node CLI parent/);
});
test('packaged sender selection uses the actual packaged host rather than the checkout host',()=>{
 const rows=processes();rows.push(row(16,15,160,'C:\\bundle\\JobHost.exe'),row(17,16,170,'C:\\caspar\\casparcg.exe'),row(18,17,180,'C:\\caspar\\casparcg.exe'));
 assert.equal(ownedCaspar(rows,13,'C:\\caspar\\casparcg.exe',{jobHost:'C:\\bundle\\JobHost.exe'}).root.ProcessId,17);assert.throws(()=>ownedCaspar(rows,13,'C:\\caspar\\casparcg.exe',{jobHost:'C:\\checkout\\JobHost.exe'}),/OWNED_CASPAR_JOB_HOST/);
 const privateURL='http://127.0.0.1:1234/presentation#piraiders='+ 'A'.repeat(43);assert.equal(privateText(Buffer.from(privateURL)),true);assert.equal(privateText(Buffer.from(privateURL,'utf16le')),true);
});

test('packaged image comparison resolves physical aliases and rejects unresolved identity',()=>{
 const long='C:\\bundle 鷹\\app\\JobHost.exe',short='C:\\BUNDLE~1\\app\\JobHost.exe';
 const realpath=value=>{if(value===long||value===short)return long;throw Error('private path');};
 assert.equal(canonicalImage(long,{realpath}),canonicalImage(short,{realpath}));
 assert.throws(()=>canonicalImage('C:\\missing.exe',{realpath}),/^Error: PROOF_IMAGE_IDENTITY_UNVERIFIED$/);
});


test('runtime diagnostics retain only bounded whitelisted readiness fields, never raw state data',()=>{
 const trace=createRuntimeDiagnostics(),secret='http://127.0.0.1/private#piraiders='+ 'A'.repeat(43);
 const forbidden=()=>{throw Error('unselected state read');};
 const runtime={state:'starting',lastError:'EVENT_BOOTSTRAP_FAILED',generation:3,ready:false,windowAllowed:true};
 Object.defineProperty(runtime,'privateURL',{get:forbidden});
 const value={active:{eventId:secret,runtime},privateRoot:secret};trace.record(value);trace.record(value);
 assert.deepEqual(trace.snapshot(),{observations:2,history:[{state:'starting',lastError:'EVENT_BOOTSTRAP_FAILED',generation:3,ready:false,windowAllowed:true}]});
 runtime.state=secret;runtime.lastError='A'.repeat(43);runtime.generation=Infinity;runtime.ready={secret};runtime.windowAllowed=secret;trace.record(value);
 const last=trace.snapshot().history.at(-1);assert.deepEqual(last,{state:'unknown',lastError:'UNRECOGNIZED',generation:null,ready:null,windowAllowed:null});
 assert.equal(JSON.stringify(trace.snapshot()).includes(secret),false);assert.equal(JSON.stringify(trace.snapshot()).includes('A'.repeat(43)),false);
 for(let generation=0;generation<40;generation++)trace.record({active:{runtime:{state:'ready',lastError:null,generation,ready:true,windowAllowed:true,privateRoot:secret}}});
 const snapshot=trace.snapshot();assert.equal(snapshot.history.length,16);assert.equal(snapshot.history.at(-1).generation,39);assert.equal(snapshot.history[0].generation,24);assert.equal(Object.isFrozen(snapshot.history),true);assert.equal(Object.isFrozen(snapshot.history[0]),true);
 trace.record(null);assert.equal(trace.snapshot().history.at(-1).state,'unavailable');
});
