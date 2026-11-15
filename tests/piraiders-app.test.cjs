'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {spawn,fork}=require('node:child_process');
const {randomBytes,createHmac}=require('node:crypto');
const {once}=require('node:events');
const {loadAppSettings,assertPortFree,probeStartupIdentity,PersistentAppLauncher}=require('../scripts/piraiders-app.cjs');
const {processTable,descendants,treeState}=require('../scripts/windows-process-evidence.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<600;n++){if(await fn())return;await wait(10);}throw Error('fixture timeout');}
async function listen(t,handler){const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));return server;}
async function free(){const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
const key=()=>randomBytes(32).toString('hex');
const proof=(secret,nonce)=>createHmac('sha256',Buffer.from(secret,'hex')).update(nonce,'ascii').digest('hex');
function reply(response,value,status=200){response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(value));}
async function fixture(t,{mode='good',descendant=false}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders app 鷹 ')),children=[],cleanups=[];let app;
 t.after(async()=>{
  let cleanupFailure;
  try{for(const cleanup of cleanups)await cleanup();await app?.close();}catch(error){cleanupFailure=error;}
  try{for(const child of children){if(child.exitCode===null&&child.signalCode===null)child.kill();await child.done;}}
  finally{await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
  if(cleanupFailure)throw cleanupFailure;
 });
 await fs.mkdir(path.join(root,'config'));const port=await free(),file=path.join(root,'config','machine.json'),spxFile=path.join(root,'config','spx.json');
 const configBytes=JSON.stringify({general:{port,launchBrowser:true},privateOwnerData:'do not rewrite'});await fs.writeFile(spxFile,configBytes);
 await fs.writeFile(path.join(root,'server.js'),`const fs=require('node:fs'),http=require('node:http'),crypto=require('node:crypto');const cfg=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const descendant=${descendant?"require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}).pid":"null"};fs.writeFileSync('captured.json',JSON.stringify({pid:process.pid,descendant,cwd:process.cwd(),args:process.argv.slice(2),appConfig:process.env.PIRAIDERS_APP_CONFIG,keyPresent:/^[a-f0-9]{64}$/.test(process.env.PIRAIDERS_APP_STARTUP_SECRET)}));http.createServer((q,s)=>{s.setHeader('Content-Type','application/json');const nonce=q.headers['x-piraiders-startup-probe'];s.end(JSON.stringify({app:'piraiders',proof:${mode==='good'?"crypto.createHmac('sha256',Buffer.from(process.env.PIRAIDERS_APP_STARTUP_SECRET,'hex')).update(nonce||'','ascii').digest('hex')":"'0'.repeat(64)"}}));}).listen(cfg.general.port,'127.0.0.1');`);
 const raw={schemaVersion:1,spxConfigFile:'config/spx.json',catalogDirectory:'events',mediaRoot:'media',cacheRoot:'cache',runtimeRoot:'run',caspar:{executable:'components/casparcg.exe',cwd:'components'},output:{type:'none'},rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}}};await fs.writeFile(file,JSON.stringify(raw));
 const settings=await loadAppSettings(file,{appRoot:root,nodeExecutable:process.execPath});
 const calls=[],opened=[];
 const spawnProcess=(command,args,options)=>{calls.push({command,args,options});const child=spawn(command,args,{...options,stdio:['ignore','ignore','ignore']});child.done=new Promise(r=>child.once('close',r));children.push(child);return child;};
 return{root,file,spxFile,configBytes,raw,settings,calls,children,opened,spawnProcess,cleanup:fn=>cleanups.push(fn),create(extra={}){app=new PersistentAppLauncher(settings,{spawnProcess,openBrowser:async url=>opened.push(url),startupTimeoutMs:3000,probeIntervalMs:20,...extra});return app;}};
}
test('identity proves fresh nonce possession without sending the secret or accepting replay',async t=>{
 const secret=key(),seen=[];let previous;
 const server=await listen(t,(q,s)=>{const nonce=q.headers['x-piraiders-startup-probe'];seen.push(nonce);assert.equal(q.url,'/game-day/internal/startup-identity');assert.equal(JSON.stringify(q.headers).includes(secret),false,'key never crosses HTTP');const current=proof(secret,nonce);reply(s,{app:'piraiders',proof:previous||current});previous=current;});
 await probeStartupIdentity(server.address().port,secret);await assert.rejects(probeStartupIdentity(server.address().port,secret),{code:'APP_IDENTITY_INVALID'});assert.notEqual(seen[0],seen[1]);
});
test('foreign VERSION, echoed nonce/key, redirects and unknown response fields cannot authorize browser startup',async t=>{
 const secret=key();let mode=0;
 const server=await listen(t,(q,s)=>{const nonce=q.headers['x-piraiders-startup-probe'];const values=[{version:'2.5.1'},{app:'piraiders',proof:nonce},{app:'piraiders',proof:secret},{app:'piraiders',proof:proof(secret,nonce),path:'private'}];if(mode===4){s.writeHead(302,{Location:'/other','Content-Type':'application/json'});s.end('{}');}else reply(s,values[mode]);});
 for(mode=0;mode<5;mode++)await assert.rejects(probeStartupIdentity(server.address().port,secret),{code:'APP_IDENTITY_INVALID'});
});
test('identity enforces body/header limits and an absolute deadline against continuous slow bytes',async t=>{
 const secret=key();let mode='body';
 const server=await listen(t,(q,s)=>{if(mode==='header'){s.writeHead(200,{'Content-Type':'application/json','X-Large':'x'.repeat(4096)});s.end('{}');return;}s.writeHead(200,{'Content-Type':'application/json'});if(mode==='body'){s.end('x'.repeat(1025));return;}s.write('{');const timer=setInterval(()=>s.write(' '),5);s.once('close',()=>clearInterval(timer));});
 await assert.rejects(probeStartupIdentity(server.address().port,secret),{code:'APP_IDENTITY_LIMIT'});mode='header';await assert.rejects(probeStartupIdentity(server.address().port,secret),{code:'APP_IDENTITY_UNAVAILABLE'});mode='drip';const now=Date.now();await assert.rejects(probeStartupIdentity(server.address().port,secret,{timeoutMs:80}),{code:'APP_IDENTITY_TIMEOUT'});assert.ok(Date.now()-now<1500,'absolute deadline is not extended by byte activity');
});
test('identity cancellation closes pending network work promptly',async t=>{
 const server=await listen(t,()=>{}),controller=new AbortController();const pending=probeStartupIdentity(server.address().port,key(),{signal:controller.signal,timeoutMs:2000});controller.abort();await assert.rejects(pending,{code:'APP_CLOSED'});
});
test('settings require existing bounded SPX config with explicit valid port and never generate or change files',async t=>{
 const f=await fixture(t);assert.equal(await fs.readFile(f.spxFile,'utf8'),f.configBytes);assert.deepEqual(f.settings.url,'http://127.0.0.1:'+f.settings.port+'/game-day');
 for(const value of [{general:{port:0}},{general:{port:'5656'}},{general:{port:65536}},'bad']){await fs.writeFile(f.spxFile,JSON.stringify(value));await assert.rejects(loadAppSettings(f.file,{appRoot:f.root,nodeExecutable:process.execPath}),{code:'APP_CONFIG_INVALID'});}
 await fs.rm(f.spxFile);await assert.rejects(loadAppSettings(f.file,{appRoot:f.root,nodeExecutable:process.execPath}),{code:'APP_CONFIG_INVALID'});await assert.rejects(fs.stat(f.spxFile),{code:'ENOENT'});assert.equal(f.children.length,0);
});
test('actual Node application stand-in starts only SPX and browser opens after owned proof with unchanged config and argv',async t=>{
 const f=await fixture(t),app=f.create(),events=[];app.on('status',v=>events.push(v));const first=app.start();assert.strictEqual(app.start(),first);await first;
 assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].args,[path.join(f.root,'server.js'),'config/spx.json']);assert.equal(f.calls[0].options.cwd,f.root);assert.equal(f.calls[0].options.shell,false);assert.deepEqual(f.calls[0].options.stdio,['pipe','ignore','ignore']);assert.equal(f.opened.length,1);assert.equal(f.opened[0],f.settings.url);
 const captured=JSON.parse(await fs.readFile(path.join(f.root,'captured.json'),'utf8'));assert.deepEqual(captured.args,['config/spx.json']);assert.equal(captured.cwd,f.root);assert.equal(captured.appConfig,f.file);assert.equal(captured.keyPresent,true);assert.equal(await fs.readFile(f.spxFile,'utf8'),f.configBytes);
 const secret=f.calls[0].options.env.PIRAIDERS_APP_STARTUP_SECRET;assert.equal(JSON.stringify([app.snapshot(),events]).includes(secret),false,'public state has no launch secret');await app.close();await f.children[0].done;assert.equal(app.snapshot().state,'closed');assert.equal(f.calls.length,1);
});
test('occupied foreign endpoint refuses before spawn and is never killed or opened',async t=>{
 const f=await fixture(t),server=http.createServer((q,s)=>reply(s,{version:'SPX'}));await new Promise(r=>server.listen(f.settings.port,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const app=f.create();await assert.rejects(app.start(),{code:'APP_PORT_BUSY'});assert.equal(f.calls.length,0);assert.equal(f.opened.length,0);assert.equal(server.listening,true);
});
test('bad owned identity times out, closes only owned child and never opens browser',async t=>{
 const f=await fixture(t,{mode:'bad'}),app=f.create({startupTimeoutMs:300,probeTimeoutMs:50});await assert.rejects(app.start(),{code:'APP_STARTUP_TIMEOUT'});await Promise.all(f.children.map(child=>child.done));assert.equal(app.snapshot().closed,true);assert.equal(f.opened.length,0);assert.equal(f.calls.length,1);
});
test('close cancels a pending ownership handshake immediately and is idempotent',async t=>{
 const f=await fixture(t,{mode:'bad'}),app=f.create();const starting=app.start();const rejected=assert.rejects(starting,{code:'APP_CLOSED'});await until(()=>f.children.length===1);const closing=app.close();assert.strictEqual(app.close(),closing);await closing;await rejected;assert.equal(f.opened.length,0);await f.children[0].done;
});
test('close before scheduled startup cannot create a process or browser',async t=>{
 const f=await fixture(t),app=f.create();const starting=app.start(),rejected=assert.rejects(starting,{code:'APP_CLOSED'});await app.close();await rejected;assert.equal(f.calls.length,0);assert.equal(f.opened.length,0);
});
test('headless mode and browser-open failure preserve the actual owned application service',async t=>{
 const f=await fixture(t),app=f.create({openBrowser:async()=>{throw Error('private exception');}});await app.start();assert.equal(app.snapshot().lastError,'BROWSER_OPEN_FAILED');assert.equal(app.snapshot().state,'ready');assert.equal(f.children[0].exitCode,null);await app.close();
 const g=await fixture(t),headless=g.create();await headless.start({browser:false});assert.equal(g.opened.length,0);assert.equal(headless.snapshot().state,'ready');
});
test('crash restart rotates secret and re-verifies fresh ownership without reopening browser',async t=>{
 const f=await fixture(t),app=f.create({supervisorOptions:{restartDelayMs:20,maxRestarts:1}});await app.start();f.children[0].kill();await until(()=>f.children.length===2&&app.snapshot().state==='ready');assert.equal(f.opened.length,1);assert.ok(f.calls[0].options.env.PIRAIDERS_APP_STARTUP_SECRET!==f.calls[1].options.env.PIRAIDERS_APP_STARTUP_SECRET,'fresh launch key required');await app.close();
});
test('failed native stop keeps ownership and close retry; reentrant abort observes the reserved close barrier',async t=>{
 const f=await fixture(t);let fail=true,kills=0;const app=f.create({platform:'win32',supervisorOptions:{maxRestarts:0,execFileProcess(exe,args,opts,callback){kills++;if(fail)callback(Error('private native detail'));else{f.children[0].kill();callback(null);}}}});await app.start({browser:false});let nested;app.controller.signal.addEventListener('abort',()=>{nested=app.close();},{once:true});const first=app.close();assert.strictEqual(nested,first);await assert.rejects(first,{code:'APP_CLOSE_FAILED'});assert.equal(app.supervisor.children.size,1);fail=false;await app.close();assert.equal(kills,2);assert.equal(app.supervisor.children.size,0);await f.children[0].done;
});
test('exhausted restart budget exposes a terminal fixed fault instead of an indefinite restarting state',async t=>{
 const f=await fixture(t),app=f.create({supervisorOptions:{maxRestarts:0}}),faults=[];app.on('fault',value=>faults.push(value));await app.start({browser:false});f.children[0].kill();await until(()=>app.snapshot().state==='faulted');assert.deepEqual(faults,[{code:'APP_PROCESS_FAILED'}]);assert.equal(f.calls.length,1);assert.equal(app.snapshot().lastError,'SPX_PROCESS_FAULT');await app.close();
});
test('ready observer invalidates an old generation before browser authorization',async t=>{
 const f=await fixture(t),app=f.create({supervisorOptions:{restartDelayMs:20,maxRestarts:1}});
 let observed=0;app.on('status',value=>{if(value.event==='ready'&&!observed++){f.children[0].kill();}});
 await assert.rejects(app.start(),{code:'APP_IDENTITY_STALE'});assert.equal(observed,1);assert.equal(f.opened.length,0);assert.equal(app.snapshot().browserOpened,false);assert.equal(app.snapshot().closed,true);await wait(40);assert.equal(f.calls.length,1,'stale startup cancels queued restart');
});
test('held browser completion cannot authorize a replacement generation from an older proof',async t=>{
 const f=await fixture(t);let release,entered=false,opens=0;const held=new Promise(resolve=>release=resolve);
 const app=f.create({supervisorOptions:{restartDelayMs:20,maxRestarts:1},openBrowser:async()=>{opens++;entered=true;await held;}}),starting=app.start(),rejected=assert.rejects(starting,{code:'APP_IDENTITY_STALE'});
 await until(()=>entered);f.children[0].kill();await until(()=>f.children.length===2&&app.snapshot().state==='ready');release();await rejected;assert.equal(opens,1);assert.equal(app.snapshot().browserOpened,false);assert.equal(app.snapshot().closed,true);
});
test('close settles startup before an ignored browser opener and late completion cannot mark opened',async t=>{
 const f=await fixture(t);let release,entered=false;const held=new Promise(resolve=>release=resolve);const app=f.create({openBrowser:async()=>{entered=true;await held;}}),starting=app.start(),rejected=assert.rejects(starting,{code:'APP_CLOSED'});
 await until(()=>entered);await app.close();await rejected;assert.equal(app.snapshot().browserOpened,false);release();await wait(20);assert.equal(app.snapshot().browserOpened,false);assert.equal(app.snapshot().state,'closed');
});
test('ignored browser work cannot extend the whole startup deadline',async t=>{
 const f=await fixture(t);let release,entered=false;const held=new Promise(resolve=>release=resolve),app=f.create({startupTimeoutMs:2000,openBrowser:async()=>{entered=true;await held;}});const now=Date.now();await assert.rejects(app.start(),{code:'APP_STARTUP_TIMEOUT'});assert.equal(entered,true);assert.ok(Date.now()-now<4000,'startup budget remains bounded');assert.equal(app.snapshot().browserOpened,false);assert.equal(app.snapshot().closed,true);release();
});
test('actual Windows JobHost contains application stand-in and terminates it on close',{skip:process.platform!=='win32'?'Requires real Windows JobHost; Linux OS boundary is explicitly not simulated evidence':false,timeout:20000},async t=>{
 const f=await fixture(t),app=f.create({spawnProcess:undefined});await app.start({browser:false});assert.equal(app.snapshot().state,'ready');await app.close();await assertPortFree(f.settings.port,{timeoutMs:1000});
});

test('actual Windows launcher-parent termination removes its owned SPX stand-in and descendant',{skip:process.platform!=='win32'?'Requires actual Windows parent-death/JobHost containment; no mock native claim':false,timeout:30000},async t=>{
 const f=await fixture(t,{descendant:true}),wrapper=path.join(f.root,'launcher-parent.cjs');
 await fs.writeFile(wrapper,"const{loadAppSettings,PersistentAppLauncher}=require(process.argv[2]);(async()=>{const app=new PersistentAppLauncher(await loadAppSettings(process.argv[3],{appRoot:process.argv[4],nodeExecutable:process.execPath}));await app.start({browser:false});process.send({ready:true});})().catch(()=>process.exit(1));");
 const parent=fork(wrapper,[path.resolve(__dirname,'../scripts/piraiders-app.cjs'),f.file,f.root],{stdio:['ignore','ignore','ignore','ipc']}),parentClosed=once(parent,'close');
 f.cleanup(async()=>{if(parent.exitCode===null&&parent.signalCode===null)parent.kill('SIGKILL');await parentClosed;await until(async()=>{try{await assertPortFree(f.settings.port);return true;}catch{return false;}});});
 const [message]=await once(parent,'message');assert.equal(message.ready,true);const captured=JSON.parse(await fs.readFile(path.join(f.root,'captured.json'),'utf8'));assert.ok(Number.isSafeInteger(captured.pid)&&Number.isSafeInteger(captured.descendant));
 const tree=descendants(processTable(),parent.pid);
 assert.ok(tree.some(row=>row.ProcessId===captured.pid)&&tree.some(row=>row.ProcessId===captured.descendant),'both owned generations captured before parent death');
 parent.kill('SIGKILL');await parentClosed;
 const deadline=Date.now()+10000;let surviving;
 do{surviving=treeState(processTable(),tree).surviving;if(!surviving)break;await wait(100);}while(Date.now()<deadline);
 assert.equal(surviving,0,'owned process generations must terminate');await assertPortFree(f.settings.port,{timeoutMs:1000});
});
