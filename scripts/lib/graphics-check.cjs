'use strict';
// Q-019: whether this PC's graphics driver gives OpenGL 4.5, and the renderer
// choice that follows. The check is the bundled native helper
// app/build/windows/PiRaiders.GraphicsCheck.exe (native/windows/GraphicsCheck.cs),
// which loads only the system opengl32.dll and prints one fixed code. Its
// output is taken only when it is exactly one code; nothing it prints is ever
// echoed, so no GPU name or driver path can reach an answer. The machine
// file's `renderer` (auto, gpu or software) may force the choice. Running
// Caspar with the choice is bundled-caspar.cjs's (Q-020); this module only answers.
const fs=require('node:fs/promises'),path=require('node:path'),{execFile}=require('node:child_process');

const CHECK_CODES=Object.freeze(['GPU_OPENGL_45','GPU_OPENGL_TOO_OLD','GPU_OPENGL_UNKNOWN']);
const RENDERER_SETTINGS=Object.freeze(['auto','gpu','software']);
const CHECK_TIMEOUT_MS=15000,CHECK_MAX_BYTES=256;
function fail(code){throw Object.assign(Error(code),{code});}

function normalizeRendererSetting(value){
  if(value===undefined)return'auto';
  if(typeof value!=='string'||!RENDERER_SETTINGS.includes(value))fail('RENDERER_SETTING_INVALID');
  return value;
}
// gpu only when the check said 4.5 (or the setting forces it).
function chooseRenderer(check,setting){
  const s=normalizeRendererSetting(setting);
  if(s!=='auto')return s;
  return check==='GPU_OPENGL_45'?'gpu':'software';
}
function graphicsCheckExecutable(appRoot){
  if(typeof appRoot!=='string'||!path.isAbsolute(appRoot))fail('GRAPHICS_CHECK_OPTIONS_INVALID');
  return path.join(appRoot,'build','windows','PiRaiders.GraphicsCheck.exe');
}

// One bounded run: a regular file only (no link), output capped, killed at
// the deadline. Answers {missing:true} or {exitCode, stdout}.
async function defaultRun(executable,{timeoutMs=CHECK_TIMEOUT_MS}={}){
  try{const info=await fs.lstat(executable);if(!info.isFile())return{missing:true};}catch{return{missing:true};}
  return new Promise(resolve=>{
    execFile(executable,[],{cwd:path.dirname(executable),encoding:'utf8',windowsHide:true,shell:false,timeout:timeoutMs,killSignal:'SIGKILL',maxBuffer:CHECK_MAX_BYTES},
      (error,stdout)=>resolve({exitCode:error?(Number.isInteger(error.code)?error.code:null):0,stdout}));
  });
}

async function runGraphicsCheck({appRoot,executable,platform=process.platform,run=defaultRun,timeoutMs=CHECK_TIMEOUT_MS}={}){
  const answer=(check,probe)=>Object.freeze({check,probe});
  if(platform!=='win32')return answer('GPU_OPENGL_UNKNOWN','not-windows');
  const file=executable??graphicsCheckExecutable(appRoot);
  let result;try{result=await run(file,{timeoutMs});}catch{return answer('GPU_OPENGL_UNKNOWN','failed');}
  if(result&&result.missing===true)return answer('GPU_OPENGL_UNKNOWN','missing');
  const line=result&&result.exitCode===0&&typeof result.stdout==='string'?result.stdout.replace(/\r?\n$/,''):null;
  return CHECK_CODES.includes(line)?answer(line,'ran'):answer('GPU_OPENGL_UNKNOWN','failed');
}

// What Setup and Diagnose print: {check, probe, setting, renderer}.
async function graphicsFor(machine,trusted={}){
  // Required here, not at the top: the machine loader requires this module.
  const {isGameDayMachineConfig}=require('./game-day-catalog.cjs');
  if(!isGameDayMachineConfig(machine))fail('MACHINE_CONFIG_INVALID');
  // Q-020: a machine on the bundled Caspar ran the check when it loaded and
  // runs the renderer that answer chose; report that answer, not a new one.
  if(machine.graphics)return machine.graphics;
  const {check,probe}=await runGraphicsCheck({appRoot:machine.appRoot,...trusted});
  return Object.freeze({check,probe,setting:machine.renderer,renderer:chooseRenderer(check,machine.renderer)});
}

module.exports={CHECK_CODES,RENDERER_SETTINGS,normalizeRendererSetting,chooseRenderer,graphicsCheckExecutable,runGraphicsCheck,graphicsFor};
