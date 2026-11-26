#!/usr/bin/env node
'use strict';
// 5d-2: builds the CI-only console helper (native/windows/ConsoleProof.cs) the
// exchange activation proof uses to press Ctrl+C in, and close, the
// application's console window. Never part of the Windows bundle.
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {CONSOLE_PROOF:output}=require('./console-close-proof.cjs');
const root=path.resolve(__dirname,'..');
function buildConsoleProof(){
  if(process.platform!=='win32')throw Error('Console proof helper builds only on Windows');
  const windows=process.env.SystemRoot||process.env.WINDIR;
  if(!windows||!path.isAbsolute(windows))throw Error('Windows system directory unavailable');
  const compiler=['Framework64','Framework'].map(part=>path.join(windows,'Microsoft.NET',part,'v4.0.30319','csc.exe')).find(file=>fs.existsSync(file));
  if(!compiler)throw Error('Installed Framework compiler unavailable');
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.rmSync(output,{force:true});
  const temporary=path.join(path.dirname(output),'ConsoleProof.'+process.pid+'.exe');
  try{
    execFileSync(compiler,['/nologo','/target:exe','/platform:anycpu','/optimize+','/debug-','/warn:4','/out:'+temporary,path.join(root,'native','windows','ConsoleProof.cs')],{cwd:root,stdio:'inherit',windowsHide:true,timeout:60000});
    fs.renameSync(temporary,output);console.log('Built console proof helper (CI only).');return output;
  }finally{fs.rmSync(temporary,{force:true});}
}
if(require.main===module){try{buildConsoleProof();}catch(error){console.error('Console proof helper build failed: '+error.message);process.exitCode=1;}}
module.exports={buildConsoleProof,output};
