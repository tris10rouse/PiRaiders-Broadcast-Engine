#!/usr/bin/env node
'use strict';
// BE-006 item 5b part 1: the operator's setup command for a source machine.
//
//   node scripts/piraiders-setup.cjs --machine <absolute path to machine.json>
//
// Checks the machine file and the source root, reads the feed with the
// retained binding, and sets up the journal and the approval list once.
// Safe to run again: it changes nothing when both stores are there.
// Prints one JSON line with steps and codes only (no paths or ids).
// Exit 0 done, 1 refused, 2 wrong arguments.
const path=require('node:path');
const {loadGameDayMachineConfig}=require('./lib/game-day-catalog.cjs');
const {setupSourceMachine}=require('./lib/exchange-setup.cjs');

function machineArgument(argv){
  if(argv.length!==2||argv[0]!=='--machine'||typeof argv[1]!=='string'||!path.isAbsolute(argv[1]))return null;
  return path.resolve(argv[1]);
}
async function main(argv,{appRoot=path.resolve(__dirname,'..'),nodeExecutable=process.execPath}={}){
  const file=machineArgument(argv);
  if(!file)return{exitCode:2,answer:{ok:false,step:'arguments',code:'SETUP_USAGE',done:{}}};
  let machine;
  try{machine=await loadGameDayMachineConfig(file,{appRoot,nodeExecutable});}
  catch{return{exitCode:1,answer:{ok:false,step:'machine',code:'MACHINE_CONFIG_INVALID',done:{}}};}
  const answer=await setupSourceMachine(machine);
  return{exitCode:answer.ok?0:1,answer};
}
if(require.main===module){
  main(process.argv.slice(2)).then(({exitCode,answer})=>{
    process.stdout.write(JSON.stringify(answer)+'\n');process.exitCode=exitCode;
  },()=>{process.stdout.write(JSON.stringify({ok:false,step:'unexpected',code:'SETUP_FAILED',done:{}})+'\n');process.exitCode=1;});
}
module.exports={main};
