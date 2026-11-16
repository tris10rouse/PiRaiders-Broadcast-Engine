'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {normalizeRendererProfile,casparRendererEnvironment,preflightRenderer}=require('../scripts/lib/caspar-renderer.cjs');
const PROFILE='mesa-llvmpipe-compat';
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders renderer boundary '));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 const bin=path.join(root,'bin'),cwd=path.join(root,'different cwd');await fs.mkdir(bin);await fs.mkdir(cwd);
 const executable=path.join(bin,'casparcg.exe');await fs.writeFile(executable,'synthetic executable boundary only');
 return{root,bin,cwd,executable};
}
function missing(error){assert.equal(error.code,'MESA_RUNTIME_MISSING');assert.equal(error.message,'MESA_RUNTIME_MISSING');assert.deepEqual(Object.keys(error),['code']);return true;}
test('fixed renderer selection rejects arbitrary environment maps and unrecognized profiles',()=>{
 assert.equal(normalizeRendererProfile(undefined),undefined);assert.equal(normalizeRendererProfile(PROFILE),PROFILE);
 for(const value of [null,false,true,'','Mesa','MESA-LLVMPipe-COMPAT','llvmpipe',{},[],{GALLIUM_DRIVER:'llvmpipe'}])assert.throws(()=>normalizeRendererProfile(value),/Invalid Caspar renderer profile/);
});
test('explicit renderer replaces every Windows case variant without mutating the parent or unrelated environment',()=>{
 const parent={Path:'private-path',GALLIUM_DRIVER:'other',gallium_driver:'duplicate',LiBgL_AlWaYs_SoFtWaRe:'0',mesa_gl_version_override:'9.9',NDI_RUNTIME_DIR_V6:'private-ndi',EXTRA:'kept'};
 const before={...parent};const result=casparRendererEnvironment(parent,PROFILE);
 assert.deepEqual(parent,before);
 assert.deepEqual(result,{Path:'private-path',NDI_RUNTIME_DIR_V6:'private-ndi',EXTRA:'kept',GALLIUM_DRIVER:'llvmpipe',LIBGL_ALWAYS_SOFTWARE:'1',MESA_GL_VERSION_OVERRIDE:'4.5COMPAT'});
 assert.deepEqual(casparRendererEnvironment(parent,undefined),parent);assert.notEqual(casparRendererEnvironment(parent,undefined),parent);
});
test('omitted renderer never adds DLL requirements to the established component boundary',async()=>{
 await preflightRenderer({executable:path.join(os.tmpdir(),'missing-optional-renderer','casparcg.exe')});
});
test('renderer preflight checks beside executable rather than cwd, and returns only a fixed failure',async t=>{
 const f=await fixture(t),caspar={executable:f.executable,cwd:f.cwd,rendererProfile:PROFILE};
 await fs.writeFile(path.join(f.cwd,'opengl32.dll'),'synthetic library boundary only');
 await assert.rejects(preflightRenderer(caspar),missing);
 await fs.writeFile(path.join(f.bin,'opengl32.dll'),'synthetic library boundary only');
 await preflightRenderer(caspar);
});
test('renderer preflight rejects empty, directory and symbolic library substitutions',async t=>{
 const f=await fixture(t),caspar={executable:f.executable,cwd:f.cwd,rendererProfile:PROFILE},library=path.join(f.bin,'opengl32.dll');
 await fs.writeFile(library,'');await assert.rejects(preflightRenderer(caspar),missing);await fs.unlink(library);
 await fs.mkdir(library);await assert.rejects(preflightRenderer(caspar),missing);await fs.rmdir(library);
 const external=path.join(f.root,'other.dll');await fs.writeFile(external,'synthetic library boundary only');await fs.symlink(external,library,'file');await assert.rejects(preflightRenderer(caspar),missing);
});
