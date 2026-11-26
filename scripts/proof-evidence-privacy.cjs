#!/usr/bin/env node
'use strict';
// BE-006 item 5a part 3: what a Windows proof job may retain. Every entry of
// the evidence folder is listed; an entry outside the allowed names (a
// lower-case `<name>.png` or `<name>.json` file directly in the folder: no
// folders, no `.partial` leftovers of the receiver) or a file whose bytes name
// a private path fails. A private path is matched in any letter case, with
// either separator, JSON-escaped, and as UTF-16 text. Answers carry entry
// names (fixed by the allowed pattern or the probe) and fixed reasons only,
// never the matched text.
//
// Command line (the activation job's step before its upload):
//   node scripts/proof-evidence-privacy.cjs activation <evidence> <checkout> <tools>
//   node scripts/proof-evidence-privacy.cjs soak <evidence> <checkout> <tools>   (the soak job, 5e-2)
// Removes offending entries so the upload stays clean, exits 1 if any were found.
const fs=require('node:fs/promises');
const path=require('node:path');
function fail(code){throw Object.assign(Error(code),{code});}
const ALLOWED=/^[a-z0-9][a-z0-9-]{0,127}\.(png|json)$/;

function privateVariants(paths){
  if(!Array.isArray(paths)||paths.length===0)fail('PRIVATE_PATHS_REQUIRED');
  const out=new Set();
  for(const p of paths){
    if(typeof p!=='string'||p.length<4||!(path.isAbsolute(p)||path.win32.isAbsolute(p)))fail('PRIVATE_PATH_INVALID');
    const lower=p.toLowerCase().replace(/[\\/]+$/,'');
    for(const form of [lower,lower.split('\\').join('/'),lower.split('/').join('\\')]){
      out.add(form);out.add(JSON.stringify(form).slice(1,-1));
    }
  }
  return[...out];
}
// latin1 keeps one character per byte, so UTF-8 paths and UTF-16 (as
// interleaved zero bytes) can both be searched in one lower-cased string.
function bytesName(bytes,variants){
  const text=bytes.toString('latin1').toLowerCase();
  return variants.some(v=>{
    // The needles get the same latin1 lower-casing as the text, or a UTF-8
    // lead byte (0xC3 for é) would differ between the two and never match.
    const utf8=Buffer.from(v,'utf8').toString('latin1').toLowerCase(),utf16=Buffer.from(v,'utf16le').toString('latin1').toLowerCase();
    return text.includes(utf8)||text.includes(utf16);
  });
}

async function auditEvidence(dir,privatePaths){
  const variants=privateVariants(privatePaths);
  let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{fail('EVIDENCE_FOLDER_MISSING');}
  const files=[],violations=[];
  for(const entry of entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    if(!entry.isFile()||!ALLOWED.test(entry.name)){violations.push({name:ALLOWED.test(entry.name)||/^[\w.-]{1,160}$/.test(entry.name)?entry.name:'UNPRINTABLE_NAME',reason:'NAME_NOT_ALLOWED'});continue;}
    const bytes=await fs.readFile(path.join(dir,entry.name));
    if(bytesName(bytes,variants)){violations.push({name:entry.name,reason:'NAMES_PRIVATE_PATH'});continue;}
    files.push({name:entry.name,bytes:bytes.length});
  }
  return{files,violations};
}

async function removeViolations(dir,violations){
  let removed=0;const names=new Set(violations.map(v=>v.name));
  for(const entry of await fs.readdir(dir)){
    const shown=ALLOWED.test(entry)||/^[\w.-]{1,160}$/.test(entry)?entry:'UNPRINTABLE_NAME';
    if(names.has(shown)){await fs.rm(path.join(dir,entry),{recursive:true,force:true});removed++;}
  }
  return removed;
}

// The activation job's private paths: its proof folder (holding the exchange
// folder and every private store), the proof tools and Caspar's folder, each
// also as its real path when it exists. The soak job (5e-2) builds the same
// fixture in its own work folder.
const WORK_FOLDERS=Object.freeze({activation:'exchange-activation-proof',soak:'soak-proof'});
async function activationPrivatePaths(checkout,tools,job='activation'){
  if(!Object.hasOwn(WORK_FOLDERS,job))fail('USAGE');
  const work=path.join(checkout,'build',WORK_FOLDERS[job]),proof=path.join(work,'proof');
  const list=[work,proof,path.join(proof,'exchange'),path.join(proof,'private'),path.join(proof,'private','journal'),path.join(proof,'private','approvals'),
    path.join(proof,'cache'),path.join(proof,'runtime'),path.join(proof,'catalog'),tools];
  try{const info=JSON.parse(await fs.readFile(path.join(tools,'tools.json'),'utf8'));if(typeof info.casparDirectory==='string')list.push(info.casparDirectory);}catch{}
  for(const p of [...list])try{const real=await fs.realpath(p);if(!list.includes(real))list.push(real);}catch{}
  return list;
}

async function main(argv){
  const [mode,evidence,checkout,tools]=argv;
  if(!Object.hasOwn(WORK_FOLDERS,mode||'')||!evidence||!checkout||!tools)fail('USAGE');
  const privatePaths=await activationPrivatePaths(path.resolve(checkout),path.resolve(tools),mode);
  const dir=path.resolve(evidence),audit=await auditEvidence(dir,privatePaths);
  if(audit.violations.length){
    const removed=await removeViolations(dir,audit.violations);
    console.error(JSON.stringify({event:'proof-evidence-privacy-failed',code:'EVIDENCE_NAMES_PRIVATE_PATH',violations:audit.violations,removed}));
    process.exitCode=1;return;
  }
  console.log(JSON.stringify({event:'proof-evidence-privacy-passed',files:audit.files.length,names:audit.files.map(f=>f.name)}));
}
if(require.main===module)main(process.argv.slice(2)).catch(error=>{
  console.error(JSON.stringify({event:'proof-evidence-privacy-failed',code:error&&typeof error.code==='string'&&/^[A-Z_]{1,64}$/.test(error.code)?error.code:'CHECK_FAILED'}));process.exitCode=1;});
module.exports={auditEvidence,removeViolations,privateVariants,activationPrivatePaths};
