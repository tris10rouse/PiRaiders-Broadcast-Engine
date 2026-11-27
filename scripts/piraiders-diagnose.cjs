#!/usr/bin/env node
'use strict';
// BE-006 item 5c part 3: the operator's diagnostics command.
//
//   node scripts/piraiders-diagnose.cjs --machine <absolute path to machine.json>
//
// Prints one JSON line with the six diagnostic states of the Game Day page
// (names, values and codes only; no paths or ids). The exchange folder, the
// catalog sequence and the approval list are read from this machine's folder
// and stores, with the app open or closed; nothing is written. Prepared,
// renderer and NDI sender come from the running app on this machine, or are
// 'unknown' with a code saying why (APP_NOT_RUNNING when nothing answers).
// `graphics` (Q-019): the OpenGL 4.5 check code, whether the check ran, the
// renderer setting and the renderer chosen; a check, not a render claim.
// `vcRuntime` (Q-027): whether this PC has the Microsoft x64 VC++ runtime
// Caspar needs ({check, probe}); Diagnose only reports, it never installs.
// Nothing here is a source seen on a network, a receiver, the board or on air.
// Exit 0 read, 1 refused, 2 wrong arguments.
const path=require('node:path');
const {graphicsFor}=require('./lib/graphics-check.cjs');
const {vcRuntimeReport}=require('./lib/vc-runtime.cjs');
const {loadGameDayMachineConfig}=require('./lib/game-day-catalog.cjs');
const {diagnoseMachine}=require('./lib/game-day-diagnose.cjs');

function parsed(argv){
  if(argv.length!==2||argv[0]!=='--machine'||typeof argv[1]!=='string'||!path.isAbsolute(argv[1]))return null;
  return{file:path.resolve(argv[1])};
}
async function main(argv,{appRoot=path.resolve(__dirname,'..'),nodeExecutable=process.execPath,graphicsCheck={},vcRuntime={}}={}){
  const args=parsed(argv);
  if(!args)return{exitCode:2,answer:{ok:false,code:'DIAGNOSE_USAGE'}};
  let machine;
  try{machine=await loadGameDayMachineConfig(args.file,{appRoot,nodeExecutable});}
  catch{return{exitCode:1,answer:{ok:false,code:'MACHINE_CONFIG_INVALID'}};}
  const answer=await diagnoseMachine(machine);
  // Q-019: the OpenGL check and renderer choice, beside the six states.
  return{exitCode:answer.ok?0:1,answer:{...answer,graphics:await graphicsFor(machine,graphicsCheck),vcRuntime:await vcRuntimeReport(vcRuntime)}};
}
if(require.main===module){
  main(process.argv.slice(2)).then(({exitCode,answer})=>{
    process.stdout.write(JSON.stringify(answer)+'\n');process.exitCode=exitCode;
  },()=>{process.stdout.write(JSON.stringify({ok:false,code:'DIAGNOSE_FAILED'})+'\n');process.exitCode=1;});
}
module.exports={main};
