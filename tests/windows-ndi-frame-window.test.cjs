'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
test('actual C# NDI observation policy resets reconnect evidence within one bounded frame deadline',{
  skip:process.platform!=='win32'&&'Requires Windows Framework compiler; no simulated C# or NDI pass',timeout:45000
},t=>{
  const windows=process.env.SystemRoot||process.env.WINDIR;
  assert.ok(windows&&path.isAbsolute(windows),'Windows system directory required');
  const compiler=['Framework64','Framework'].map(folder=>path.join(windows,'Microsoft.NET',folder,'v4.0.30319','csc.exe')).find(file=>fs.existsSync(file));
  assert.ok(compiler,'installed Framework compiler required');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'PiRaiders NDI frame window '));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const executable=path.join(directory,'frame-window.exe');
  execFileSync(compiler,['/nologo','/target:exe','/platform:x64','/warn:4','/main:NdiFrameWindowTest',
    '/reference:System.Web.Extensions.dll','/reference:System.Drawing.dll','/out:'+executable,
    path.join(root,'native/windows/NdiProbe.cs'),path.join(__dirname,'fixtures/ndi-frame-window.cs')
  ],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(execFileSync(executable,[],{encoding:'utf8',windowsHide:true,timeout:5000}).trim(),'NDI_FRAME_WINDOW_PASS');
});
