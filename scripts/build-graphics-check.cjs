#!/usr/bin/env node
'use strict';
// Q-019: builds the OpenGL 4.5 check (native/windows/GraphicsCheck.cs) that
// the Windows bundle ships as app/build/windows/PiRaiders.GraphicsCheck.exe,
// with the installed .NET Framework compiler, as JobHost is built. x64, the
// architecture of the bundled Caspar and of the driver it would use.
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'build','windows','PiRaiders.GraphicsCheck.exe');
function buildGraphicsCheck(){
  if(process.platform!=='win32')throw Error('The graphics check builds only on Windows');
  const windows=process.env.SystemRoot||process.env.WINDIR;
  if(!windows||!path.isAbsolute(windows))throw Error('Windows system directory unavailable');
  const compiler=['Framework64','Framework'].map(part=>path.join(windows,'Microsoft.NET',part,'v4.0.30319','csc.exe')).find(file=>fs.existsSync(file));
  if(!compiler)throw Error('Installed Framework compiler unavailable');
  fs.mkdirSync(path.dirname(output),{recursive:true});
  // A failed build must not leave an old binary looking fresh.
  fs.rmSync(output,{force:true});
  const temporary=path.join(path.dirname(output),'PiRaiders.GraphicsCheck.'+process.pid+'.exe');
  try{
    execFileSync(compiler,['/nologo','/target:exe','/platform:x64','/optimize+','/debug-','/warn:4','/out:'+temporary,path.join(root,'native','windows','GraphicsCheck.cs')],{cwd:root,stdio:'inherit',shell:false,windowsHide:true,timeout:60000});
    if(!fs.statSync(temporary).isFile())throw Error('Compiler produced no graphics check');
    fs.renameSync(temporary,output);console.log('Built the OpenGL 4.5 check: '+path.relative(root,output));return output;
  }finally{fs.rmSync(temporary,{force:true});}
}
if(require.main===module){try{buildGraphicsCheck();}catch(error){console.error('Graphics check build failed: '+error.message);process.exitCode=1;}}
module.exports={buildGraphicsCheck,output};
