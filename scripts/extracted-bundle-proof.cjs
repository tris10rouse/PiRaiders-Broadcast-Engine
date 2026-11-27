'use strict';
// Q-021 (part 5 of Q-016): the extracted-ZIP Windows proof
// (`actual-extracted-full-app-private-ndi`) runs from the ZIP's own CasparCG,
// Mesa and NDI runtime only. Disposable proof tooling: it decides which Caspar
// and NDI DLL the full-app proof expects, writes the machine file the way an
// operator's machine file names the bundle (no `caspar`, no NDI folder), and
// checks the app's and the OpenGL check's answers in fixed words.
// The source-tree proof keeps its CI-prepared tools unchanged.
const path=require('node:path');
const {bundledLocations,bundledCaspar,SOFTWARE_PROFILE}=require('./lib/bundled-caspar.cjs');
const {COMPONENTS}=require('./lib/bundled-components.cjs');
const {CHECK_CODES,chooseRenderer}=require('./lib/graphics-check.cjs');

const NDI_DLL='Processing.NDI.Lib.x64.dll';
const PROBES=Object.freeze(['ran','missing','failed','not-windows']);
function fail(code){throw Object.assign(Error(code),{code});}
function pin(id){const c=COMPONENTS.find(x=>x.id===id);if(!c)fail('BUNDLE_PIN_MISSING');return Object.freeze({name:id,version:c.version,sha256:c.sha256});}

// extracted: the ZIP's software mirror (hosted Windows has no OpenGL 4.5) and
// its NDI DLL; nothing read from the CI tools folder. Source tree: the CI
// tools.json and ndi-runtime.json, as before Q-021.
function proofRuntime({extracted,appRoot,toolsRoot,readJSON}){
  if(extracted===true){
    const at=bundledLocations(appRoot),software=bundledCaspar(appRoot,'software');
    return Object.freeze({bundled:true,casparExecutable:software.executable,casparDirectory:software.cwd,receiverDll:path.join(at.ndi,NDI_DLL),
      casparProvenance:Object.freeze([pin('casparcg'),pin('mesa')]),ndiProvenance:pin('ndi-runtime')});
  }
  const tools=readJSON(path.join(toolsRoot,'tools.json')),ndi=readJSON(path.join(toolsRoot,'ndi-runtime.json'));
  return Object.freeze({bundled:false,casparExecutable:path.join(tools.casparDirectory,'casparcg.exe'),casparDirectory:tools.casparDirectory,receiverDll:ndi.dllPath,
    ndiRuntimeDirectory:ndi.runtimeDirectory,casparProvenance:tools.provenance,ndiProvenance:ndi.provenance});
}
// The proof's machine file: base fields plus the runtime's caspar and NDI folder
// for the source tree; for the ZIP neither, so the app's loader takes the bundle
// and runs the OpenGL check (renderer left to its default, auto).
function proofMachine(base,runtime){
  if(runtime.bundled)return{...base,output:{...base.output}};
  return{...base,caspar:{executable:runtime.casparExecutable,cwd:runtime.casparDirectory,rendererProfile:SOFTWARE_PROFILE},output:{...base.output,runtimeDirectory:runtime.ndiRuntimeDirectory}};
}
// A machine-wide NDI runtime (its installer sets NDI_RUNTIME_DIR_Vn) or Mesa
// variables would let the proof pass on something other than the ZIP.
function assertNoSeparateRuntime(env){
  for(const key of Object.keys(env||{})){
    if(/^NDI_RUNTIME_DIR_V\d+$/i.test(key))fail('SEPARATE_NDI_RUNTIME_PRESENT');
    if(/^(?:GALLIUM_DRIVER|LIBGL_ALWAYS_SOFTWARE|MESA_GL_VERSION_OVERRIDE)$/i.test(key))fail('SEPARATE_MESA_ENVIRONMENT_PRESENT');
  }
  return true;
}
// The Diagnostics answer's `caspar` (game-day-web.cjs, Q-020) for the ZIP on
// hosted Windows: the bundle, software renderer, mirror made.
function checkBundledCaspar(value){
  const ok=value&&typeof value==='object'&&JSON.stringify(Object.keys(value).sort())==='["code","from","layout","renderer"]'&&
    value.from==='bundle'&&value.renderer==='software'&&value.layout==='ready'&&value.code===null;
  if(!ok)fail('BUNDLED_SOFTWARE_CASPAR_EXPECTED');
  return Object.freeze({from:'bundle',renderer:'software',layout:'ready'});
}
// The OpenGL check's answer, kept in fixed words only. Hosted runners have no
// OpenGL 4.5 driver; a GPU answer there is a finding, not a pass.
function graphicsRecord(answer){
  if(!answer||typeof answer!=='object'||!CHECK_CODES.includes(answer.check)||!PROBES.includes(answer.probe))fail('GRAPHICS_ANSWER_INVALID');
  const renderer=chooseRenderer(answer.check,'auto');
  if(renderer!=='software')fail('HOSTED_RUNNER_CHOSE_GPU');
  return Object.freeze({check:answer.check,probe:answer.probe,renderer});
}
module.exports={NDI_DLL,proofRuntime,proofMachine,assertNoSeparateRuntime,checkBundledCaspar,graphicsRecord};
