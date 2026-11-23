#!/usr/bin/env node
'use strict';
// BE-006 item 5b part 1: the operator's setup command for a source machine.
//
//   node scripts/piraiders-setup.cjs --machine <absolute path to machine.json> [--pin-offline]
//
// --pin-offline (5b-3): afterwards, save the offline pin of every current
// confirmation whose button was prepared online, so it can start from the
// cache with the exchange folder gone. Run it while the app is closed.
// Checks the machine file and the source root, reads the feed with the
// retained binding, and sets up the journal and the approval list once.
// Safe to run again: it changes nothing when both stores are there.
// Prints one JSON line with steps and codes only (no paths or ids).
// Exit 0 done, 1 refused, 2 wrong arguments.
const path=require('node:path');
const {loadGameDayMachineConfig}=require('./lib/game-day-catalog.cjs');
const {setupSourceMachine,pinOfflineApprovals}=require('./lib/exchange-setup.cjs');

function parsed(argv){
  const pin=argv.length===3&&argv[2]==='--pin-offline';
  if(argv.length!==2&&!pin||argv[0]!=='--machine'||typeof argv[1]!=='string'||!path.isAbsolute(argv[1]))return null;
  return{file:path.resolve(argv[1]),pin};
}
async function main(argv,{appRoot=path.resolve(__dirname,'..'),nodeExecutable=process.execPath}={}){
  const args=parsed(argv);
  if(!args)return{exitCode:2,answer:{ok:false,step:'arguments',code:'SETUP_USAGE',done:{}}};
  let machine;
  try{machine=await loadGameDayMachineConfig(args.file,{appRoot,nodeExecutable});}
  catch{return{exitCode:1,answer:{ok:false,step:'machine',code:'MACHINE_CONFIG_INVALID',done:{}}};}
  const answer=args.pin?await pinOfflineApprovals(machine):await setupSourceMachine(machine);
  return{exitCode:answer.ok?0:1,answer};
}
if(require.main===module){
  main(process.argv.slice(2)).then(({exitCode,answer})=>{
    process.stdout.write(JSON.stringify(answer)+'\n');process.exitCode=exitCode;
  },()=>{process.stdout.write(JSON.stringify({ok:false,step:'unexpected',code:'SETUP_FAILED',done:{}})+'\n');process.exitCode=1;});
}
module.exports={main};
