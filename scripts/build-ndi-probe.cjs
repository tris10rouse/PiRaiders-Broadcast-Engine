#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),output=path.join(root,'build','windows','PiRaiders.NdiProbe.exe');
function buildNdiProbe(){
  if(process.platform!=='win32')throw Error('NDI test receiver builds only on Windows');
  const windows=process.env.SystemRoot||process.env.WINDIR;
  if(!windows||!path.isAbsolute(windows))throw Error('Windows system directory unavailable');
  const compiler=['Framework64','Framework'].map(part=>path.join(windows,'Microsoft.NET',part,'v4.0.30319','csc.exe')).find(file=>fs.existsSync(file));
  if(!compiler)throw Error('Installed Framework compiler unavailable');
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.rmSync(output,{force:true});
  const temporary=path.join(path.dirname(output),'NdiProbe.'+process.pid+'.exe');
  try{
    execFileSync(compiler,['/nologo','/target:exe','/platform:x64','/optimize+','/debug-','/warn:4','/reference:System.Web.Extensions.dll','/reference:System.Drawing.dll','/out:'+temporary,path.join(root,'native','windows','NdiProbe.cs')],{cwd:root,stdio:'inherit',windowsHide:true,timeout:60000});
    fs.renameSync(temporary,output);console.log('Built x64 NDI test receiver (component only).');return output;
  }finally{fs.rmSync(temporary,{force:true});}
}
if(require.main===module){try{buildNdiProbe();}catch(error){console.error('NDI receiver build failed: '+error.message);process.exitCode=1;}}
module.exports={buildNdiProbe,output};
