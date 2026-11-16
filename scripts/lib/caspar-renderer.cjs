'use strict';
// Explicit workstation policy only. Event catalog rows cannot supply arbitrary
// environment variables; omitted profiles preserve the established environment.
const fs=require('node:fs/promises');
const path=require('node:path');
const PROFILE='mesa-llvmpipe-compat';
const VARIABLES=Object.freeze({GALLIUM_DRIVER:'llvmpipe',LIBGL_ALWAYS_SOFTWARE:'1',MESA_GL_VERSION_OVERRIDE:'4.5COMPAT'});
const NAMES=new Set(Object.keys(VARIABLES).map(key=>key.toLowerCase()));
function normalizeRendererProfile(value){if(value!==undefined&&value!==PROFILE)throw Error('Invalid Caspar renderer profile');return value;}
function casparRendererEnvironment(parent,value){
  normalizeRendererProfile(value);
  const result=Object.fromEntries(Object.entries(parent).filter(([key])=>value===undefined||!NAMES.has(key.toLowerCase())));
  return value===undefined?result:{...result,...VARIABLES};
}
async function preflightRenderer(caspar){
  normalizeRendererProfile(caspar.rendererProfile);
  if(caspar.rendererProfile===undefined)return;
  // Windows loads app-local WGL beside the actual executable, not its cwd.
  // Presence is preflight only; it is not a provenance or loaded-driver claim.
  try{
    const executable=await fs.realpath(caspar.executable),library=path.join(path.dirname(executable),'opengl32.dll');
    const info=await fs.lstat(library);
    if(!info.isFile()||info.isSymbolicLink()||info.size<1)throw Error('missing');
  }catch{throw Object.assign(Error('MESA_RUNTIME_MISSING'),{code:'MESA_RUNTIME_MISSING'});}
}
module.exports={normalizeRendererProfile,casparRendererEnvironment,preflightRenderer};
