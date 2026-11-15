'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {loadAppSettings,PersistentAppLauncher,assertPortFree}=require('../scripts/piraiders-app.cjs');
const repository=path.resolve(__dirname,'..');
async function free(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const value=s.address().port;await new Promise(r=>s.close(r));return value;}
test('persistent launcher proves actual SPX startup HMAC and serves actual Game Day without altering configuration',{timeout:45000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders actual app 鷹 '));let app,child,closed;
 t.after(async()=>{try{await app?.close();if(closed)await closed;}finally{await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}});
 for(const file of ['server.js','package.json'])await fs.copyFile(path.join(repository,file),path.join(root,file));
 await fs.mkdir(path.join(root,'scripts'));await fs.cp(path.join(repository,'scripts/lib'),path.join(root,'scripts/lib'),{recursive:true,dereference:true});
 for(const dir of ['utils','routes','views','static','ASSETS','locales','node_modules'])await fs.symlink(await fs.realpath(path.join(repository,dir)),path.join(root,dir),process.platform==='win32'?'junction':'dir');
 for(const dir of ['DATAROOT','LOG','events','config'])await fs.mkdir(path.join(root,dir));
 const port=await free(),cfg={general:{port,hostname:'actual-launcher-fixture',launchBrowser:false,loglevel:'error',dataroot:path.join(root,'DATAROOT'),logfolder:path.join(root,'LOG'),templatesource:'spx-ip-address',langfile:'english.json',username:'',password:'',apikey:'',resolution:'HD'},casparcg:{servers:[]},osc:{enable:false},globalExtras:{}};
 const configFile=path.join(root,'config.json'),configBytes=JSON.stringify(cfg);await fs.writeFile(configFile,configBytes);
 const machineFile=path.join(root,'config','machine.json');await fs.writeFile(machineFile,JSON.stringify({schemaVersion:1,spxConfigFile:'config.json',catalogDirectory:'events',mediaRoot:'media',cacheRoot:'cache',runtimeRoot:'run',caspar:{executable:'components/casparcg.exe',cwd:'components'},output:{type:'none'},rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}}}));
 const opened=[],options={openBrowser:async url=>{opened.push(url);},startupTimeoutMs:15000};
 if(process.platform!=='win32')options.spawnProcess=(cmd,args,opts)=>{child=spawn(cmd,args,{...opts,stdio:['ignore','ignore','ignore']});closed=once(child,'close');return child;};
 app=new PersistentAppLauncher(await loadAppSettings(machineFile,{appRoot:root,nodeExecutable:process.execPath}),options);await app.start();
 if(!child){child=app.currentChild;closed=once(child,'close');}
 assert.equal(app.snapshot().state,'ready');assert.deepEqual(opened,['http://127.0.0.1:'+port+'/game-day']);assert.equal(await fs.readFile(configFile,'utf8'),configBytes);
 const response=await fetch(opened[0],{redirect:'error',signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);const text=await response.text();assert.match(text,/Game Day/);assert.match(text,/name="piraiders-csrf"/);assert.equal(response.headers.get('access-control-allow-origin'),null);
 const graphics=await fetch('http://127.0.0.1:'+port+'/shows',{signal:AbortSignal.timeout(5000)});assert.equal(graphics.status,200);const events=await fetch('http://127.0.0.1:'+port+'/game-day/api/events',{signal:AbortSignal.timeout(5000)});assert.deepEqual(await events.json(),{ok:true,events:[]});
 await app.close();await closed;await assertPortFree(port);assert.equal(await fs.readFile(configFile,'utf8'),configBytes);
});
