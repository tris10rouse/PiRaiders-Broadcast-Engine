#!/usr/bin/env node
'use strict';
// Q-013: the operator's check of the extracted Windows ZIP against its
// BUILD-MANIFEST.json, before any operator file exists (OPERATOR-CHECKLIST.md
// step 1). Run by Verify-PiRaiders.cmd from the ZIP's root, no arguments:
//
//   node app/scripts/piraiders-verify-bundle.cjs
//
// The bundle root is fixed: two folders above this script (app/scripts).
// Prints one JSON line of fixed codes and counts, never a path or a file name:
//   {"ok":true,"code":"BUNDLE_VERIFIED","files":N}                    exit 0
//   {"ok":false,"code":"BUNDLE_DIFFERS","differences":[...],"counts":{...}} exit 1
//     differences: the kinds found, in this order: missing, changed, extra
//   {"ok":false,"code":"MANIFEST_INVALID"}                             exit 1
//   {"ok":false,"code":"VERIFY_USAGE"}                                 exit 2
//   {"ok":false,"code":"VERIFY_FAILED"}                                exit 1
//     a file or folder could not be read (held open by another program,
//     no permission), or the check stopped unexpectedly
// The manifest is unsigned: it finds accidental drift, not a forged download.
// Nothing is written.
const path=require('node:path');
const {inspectBundle}=require('./lib/windows-bundle.cjs');

const KINDS=['missing','changed','extra'];
function main(argv,{root=path.resolve(__dirname,'..','..')}={}){
  if(!Array.isArray(argv)||argv.length!==0)return{exitCode:2,answer:{ok:false,code:'VERIFY_USAGE'}};
  let found;
  try{found=inspectBundle(root);}
  catch(error){return{exitCode:1,answer:{ok:false,code:error&&error.manifestInvalid===true?'MANIFEST_INVALID':'VERIFY_FAILED'}};}
  const differences=KINDS.filter(kind=>found.counts[kind]>0);
  if(!differences.length)return{exitCode:0,answer:{ok:true,code:'BUNDLE_VERIFIED',files:found.files}};
  return{exitCode:1,answer:{ok:false,code:'BUNDLE_DIFFERS',differences,counts:{...found.counts}}};
}
if(require.main===module){
  let result;
  try{result=main(process.argv.slice(2));}catch{result={exitCode:1,answer:{ok:false,code:'VERIFY_FAILED'}};}
  process.stdout.write(JSON.stringify(result.answer)+'\n');process.exitCode=result.exitCode;
}
module.exports={main};
