'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {PNG}=require('pngjs');
const {randomBytes,createHmac,createCipheriv,scryptSync}=require('node:crypto');
const repository=path.resolve(__dirname,'..','..');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function port(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value;}
async function link(from,to){await fs.symlink(from,to,process.platform==='win32'?'junction':'dir');}
function passwordHash(value){const cipher=createCipheriv('aes-192-cbc',scryptSync('Password used to generate key','salt',24),Buffer.alloc(16));return cipher.update(value,'utf8','hex')+cipher.final('hex');}
async function fixture(t,{appMode=true,auth=false,policy=false,badMachine=false,startup=true,softwareSuccess=false}={}){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders actual SPX Game Day '))),httpPort=await port(),secret=randomBytes(32).toString('hex');
 const appRoot=path.join(root,'app');await fs.mkdir(appRoot);await fs.copyFile(path.join(repository,'server.js'),path.join(appRoot,'server.js'));await fs.copyFile(path.join(repository,'package.json'),path.join(appRoot,'package.json'));
 for(const name of ['utils','routes','views','static','ASSETS','locales','node_modules'])await link(path.join(repository,name),path.join(appRoot,name));
 await fs.mkdir(path.join(appRoot,'scripts','lib'),{recursive:true});await fs.copyFile(path.join(repository,'scripts','lib','game-day-web.cjs'),path.join(appRoot,'scripts','lib','game-day-web.cjs'));
 const names=await fs.readdir(path.join(repository,'scripts','lib'));for(const name of names)if(name!=='game-day-web.cjs')await fs.copyFile(path.join(repository,'scripts','lib',name),path.join(appRoot,'scripts','lib',name));
 // Copy runtime workers too, so actual production requires remain rooted at the isolated app.
 for(const name of await fs.readdir(path.join(repository,'scripts')))if(name.endsWith('.cjs'))await fs.copyFile(path.join(repository,'scripts',name),path.join(appRoot,'scripts',name));
 const dataRoot=path.join(appRoot,'DATAROOT'),logRoot=path.join(appRoot,'LOG'),catalog=path.join(appRoot,'catalog');await fs.mkdir(path.join(dataRoot,'Bench','data'),{recursive:true});await fs.mkdir(logRoot);await fs.mkdir(catalog);
 await fs.writeFile(path.join(dataRoot,'Bench','profile.json'),JSON.stringify({general:{name:'Synthetic bench'},templates:[]}));await fs.writeFile(path.join(dataRoot,'Bench','data','Run.json'),JSON.stringify({templates:[],rundown:[]}));
 const config={general:{port:httpPort,hostname:'automated-game-day-fixture',launchBrowser:false,loglevel:'error',dataroot:dataRoot,logfolder:logRoot,templatesource:'spx-ip-address',langfile:'english.json',username:auth||policy?'bench-operator':'',password:auth&&!policy?passwordHash('fixture-password'):'',apikey:'',resolution:'HD',recents:[]},casparcg:{servers:[]},osc:{enable:false},globalExtras:{}};
 const configFile=path.join(appRoot,'config.json');await fs.writeFile(configFile,JSON.stringify(config));
 const machineFile=path.join(appRoot,'machine.json');await fs.writeFile(machineFile,badMachine?'{invalid':JSON.stringify({schemaVersion:1,spxConfigFile:'config.json',catalogDirectory:catalog,mediaRoot:path.join(appRoot,'media'),cacheRoot:path.join(appRoot,'cache'),runtimeRoot:path.join(appRoot,'runtime'),caspar:{executable:softwareSuccess?process.execPath:path.join(appRoot,'uninstalled-caspar.exe'),cwd:appRoot},output:{type:'none'},rossTalk:{host:'127.0.0.1',port:await port(),allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}}}));
 await fs.writeFile(path.join(catalog,'football.json'),JSON.stringify({schemaVersion:1,provider:'local-manual',eventId:'football',displayName:'Synthetic football',productionWindow:{start:new Date(Date.now()+3600000).toISOString(),end:new Date(Date.now()+7200000).toISOString()},relativeSourcePath:'football',startup:{mode:'source'}}));await fs.writeFile(path.join(catalog,'broken.json'),'{private student path');
 const mediaFile=path.join(appRoot,'media','football','01.png'),nativeMarker=path.join(appRoot,'native-boundary-attempted');let preload;
 if(softwareSuccess){
  await fs.mkdir(path.dirname(mediaFile),{recursive:true});await fs.writeFile(mediaFile,PNG.sync.write({width:2,height:2,data:Buffer.alloc(16,255)}));
  preload=path.join(appRoot,'trusted-test-preload.cjs');
  await fs.writeFile(preload,"const path=require('node:path'),fs=require('node:fs');const api=require(path.join(__dirname,'scripts/lib/prepared-event-runtime.cjs')),original=api.createPreparedEventRuntime;api.createPreparedEventRuntime=(profile,options)=>original(profile,{...options,spawnProcess(){fs.writeFileSync(path.join(__dirname,'native-boundary-attempted'),'unexpected');throw Error('NATIVE_BOUNDARY_REACHED');}});");
 }
 const env={...process.env};delete env.PIRAIDERS_APP_CONFIG;delete env.PIRAIDERS_APP_STARTUP_SECRET;if(appMode)env.PIRAIDERS_APP_CONFIG=machineFile;if(appMode&&startup)env.PIRAIDERS_APP_STARTUP_SECRET=secret;
 const child=spawn(process.execPath,[...(preload?['--require',preload]:[]),'server.js','config.json'],{cwd:appRoot,env,stdio:['ignore','pipe','pipe'],windowsHide:true});let captured='';for(const stream of[child.stdout,child.stderr])stream.on('data',data=>{if(captured.length<32768)captured+=data.toString().slice(0,32768-captured.length);});const closed=once(child,'close');closed.catch(()=>{});
 const origin='http://127.0.0.1:'+httpPort;
 function request(url,{method='GET',headers={},body,json}={}){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:httpPort,path:url,method,agent:false,headers:{Host:'127.0.0.1:'+httpPort,...(json===undefined?{}:{'Content-Type':'application/json'}),...headers}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const text=Buffer.concat(chunks).toString();let value;try{value=JSON.parse(text);}catch{}resolve({status:res.statusCode,headers:res.headers,text,value});});});req.setTimeout(5000,()=>req.destroy(Error('HTTP fixture deadline')));req.on('error',reject);req.end(json===undefined?body:JSON.stringify(json));});}
 t.after(async()=>{try{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await Promise.race([closed,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Actual SPX fixture did not close')),10000);timer.unref();})]);assert.ok(!captured.includes(secret),'startup key must not enter SPX output');}finally{await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}});
 const deadline=Date.now()+15000;for(;;){if(child.exitCode!==null||child.signalCode!==null)throw Error('SPX exited before fixture readiness: '+captured);try{if((await request('/api/v1/version')).status===200)break;}catch{}if(Date.now()>deadline)throw Error('SPX fixture readiness failed: '+captured);await wait(50);}
 return{root,appRoot,child,secret,origin,request,pid:child.pid,configFile,logRoot,mediaFile,nativeMarker};
}

module.exports={fixture};
