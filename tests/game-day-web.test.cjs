'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {randomBytes,createHmac}=require('node:crypto');
const express=require('express');
const session=require('express-session');
const cors=require('cors');
const signature=require('cookie-signature');
const exphbs=require('express-handlebars');
const {createGameDayWeb}=require('../scripts/lib/game-day-web.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){const end=Date.now()+3000;while(!fn()){if(Date.now()>=end)throw Error('Web fixture deadline');await wait(5);}}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
async function fixture(t,{username='',password='',startupSecret}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders web router ')),priorConfig=global.config,priorSecret=process.env.PIRAIDERS_APP_STARTUP_SECRET;
 global.config={general:{username,password}};if(startupSecret===undefined)delete process.env.PIRAIDERS_APP_STARTUP_SECRET;else process.env.PIRAIDERS_APP_STARTUP_SECRET=startupSecret;
 await fs.mkdir(path.join(root,'views'));await fs.mkdir(path.join(root,'static','css'),{recursive:true});await fs.mkdir(path.join(root,'static','js'),{recursive:true});await fs.mkdir(path.join(root,'static','game-day'),{recursive:true});
 await fs.writeFile(path.join(root,'views','view-game-day.handlebars'),'<!doctype html><meta name="piraiders-csrf" content="{{csrfToken}}"><h1>Game Day route fixture</h1>');await fs.writeFile(path.join(root,'views','view-authpolicy.handlebars'),'<h1>Existing authentication policy for {{user}}</h1>');
 await fs.writeFile(path.join(root,'static','css','piraiders-game-day.css'),'body { color: green; }');await fs.writeFile(path.join(root,'static','js','piraiders-game-day.js'),'/* guarded script fixture */');await fs.writeFile(path.join(root,'static','game-day','index.html'),'UNPROTECTED_STATIC_SHADOW');
 const calls=[],gate={prepare:null,command:null},manager={snapshot:()=>({expectedEventId:null,expectedSelection:0,state:'idle'}),listEvents:async()=>({ok:true,events:[]}),
  prepare:async(id,tuple)=>{calls.push(['prepare',id,tuple]);return gate.prepare?gate.prepare:{ok:true,candidateId:'a'.repeat(48)};},activate:async raw=>{calls.push(['activate',raw]);return{ok:true};},discardCandidate:async raw=>{calls.push(['discard',raw]);return{ok:true};},endDeadEvent:async raw=>{calls.push(['end-dead',raw]);return gate.endDead?gate.endDead:{ok:true};},dispatch:async(action,tuple)=>{calls.push(['command',action,tuple]);return gate.command&&action!=='stop'?gate.command:{ok:true};},close:()=>{calls.push(['close']);return Promise.resolve({ok:true});}};
 const app=express(),store=new session.MemoryStore(),sessionSecret='synthetic-session-fixture';let web;
 app.engine('handlebars',exphbs.engine({extname:'.handlebars'}));app.set('view engine','handlebars');app.set('views',path.join(root,'views'));
 // Reserve the actual server port before constructing exact-origin policy.
 const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port,origin='http://127.0.0.1:'+port;
 web=createGameDayWeb({manager,port,appRoot:root});if(priorSecret===undefined)delete process.env.PIRAIDERS_APP_STARTUP_SECRET;else process.env.PIRAIDERS_APP_STARTUP_SECRET=priorSecret;
 app.use(web.guard);const legacy=middleware=>(req,res,next)=>web.matches(req)?next():middleware(req,res,next);
 app.use(legacy(express.static(path.join(root,'static'))));app.use(legacy(express.json()));app.use(legacy(cors()));app.use(session({secret:sessionSecret,resave:false,saveUninitialized:false,store}));app.use(web.router);
 app.get('/legacy',(req,res)=>res.json({legacy:true}));app.post('/legacy',(req,res)=>res.json({legacy:true,body:req.body}));
 t.after(async()=>{await web.close();await new Promise(resolve=>server.close(resolve));global.config=priorConfig;if(priorSecret===undefined)delete process.env.PIRAIDERS_APP_STARTUP_SECRET;else process.env.PIRAIDERS_APP_STARTUP_SECRET=priorSecret;await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});});
 function request(url,{method='GET',headers={},body,json}={}){const content=json===undefined?body:JSON.stringify(json);return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:url,method,agent:false,headers:{Host:'127.0.0.1:'+port,...(json===undefined?{}:{'Content-Type':'application/json'}),...headers}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const text=Buffer.concat(chunks).toString();let value;try{value=JSON.parse(text);}catch{}resolve({status:res.statusCode,headers:res.headers,text,value});});});req.on('error',reject);req.end(content);});}
 async function page(cookie){const response=await request('/game-day',{headers:cookie?{Cookie:cookie}:{}}),match=/name="piraiders-csrf" content="([a-f0-9]{64})"/.exec(response.text);return{response,token:match?.[1],cookie:response.headers['set-cookie']?.[0].split(';')[0]||cookie};}
 function cookieFor(user){const sid=randomBytes(24).toString('hex');return new Promise((resolve,reject)=>store.set(sid,{cookie:{originalMaxAge:null,expires:null,httpOnly:true,path:'/'},user},error=>error?reject(error):resolve('connect.sid='+encodeURIComponent('s:'+signature.sign(sid,sessionSecret)))));}
 const tuple={expectedEventId:null,expectedSelection:0};
 return{root,app,server,web,manager,calls,gate,request,page,cookieFor,origin,tuple,globalConfig:global.config,mutation:(p)=>({Origin:origin,Cookie:p.cookie,'X-PiRaiders-CSRF':p.token,'Sec-Fetch-Site':'same-origin','Sec-Fetch-Mode':'cors','Sec-Fetch-Dest':'empty'})};
}

test('real HTTP page/token/state/assets are guarded before static/CORS while legacy SPX middleware is preserved',async t=>{
 const f=await fixture(t),p=await f.page();assert.equal(p.response.status,200);assert.match(p.token,/^[a-f0-9]{64}$/);assert.ok(!p.response.text.includes('UNPROTECTED_STATIC_SHADOW'));
 for(const url of ['/game-day/api/state','/GAME-DAY/API/STATE/','/css/piraiders-game-day.css','/JS/PIRAIDERS-GAME-DAY.JS/']){const r=await f.request(url,{headers:{Cookie:p.cookie}});assert.equal(r.status,200,url);assert.equal(r.headers['access-control-allow-origin'],undefined);assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.headers['referrer-policy'],'no-referrer');assert.equal(r.headers['x-frame-options'],'DENY');assert.match(r.headers['content-security-policy'],/script-src 'self'/);assert.match(r.headers['content-security-policy'],/frame-ancestors 'none'/);}
 const old=await f.request('/legacy',{method:'POST',json:{existing:'SPX'},headers:{Origin:'https://foreign.invalid'}});assert.equal(old.status,200);assert.equal(old.headers['access-control-allow-origin'],'*');assert.deepEqual(old.value.body,{existing:'SPX'});
 const again=await f.page(p.cookie);assert.equal(again.token,p.token);const other=await f.page();assert.notEqual(other.token,p.token);
});

test('exact Host, Origin, Fetch Metadata and protected path variants fail closed without CORS',async t=>{
 const f=await fixture(t);
 const cases=[['/game-day',{Host:'localhost:'+new URL(f.origin).port}],['/game-day',{Host:'127.0.0.1:'+new URL(f.origin).port+'.evil'}],['/game-day',{Origin:'https://foreign.invalid'}],['/game-day',{Origin:'null'}],['/game-day',{'Sec-Fetch-Site':'cross-site'}],['/game-day',{'Sec-Fetch-Site':'same-site'}],['/game-day',{'Sec-Fetch-Mode':'websocket'}],['/game-day',{'Sec-Fetch-Dest':'iframe'}]];
 for(const[url,headers]of cases){const r=await f.request(url,{headers});assert.equal(r.status,403);assert.equal(r.headers['access-control-allow-origin'],undefined);}
 for(const url of ['/g%61me-day','/game-day/../legacy','/x/../game-day/api/state','/game-day//api/state','/game-day\\api\\state','/css/piraiders-game-day%2Ecss','/game-day?token=private','http://foreign.invalid/game-day/api/state','http://foreign.invalid/css/piraiders-game-day.css']){const r=await f.request(url);assert.equal(r.status,400,url);assert.equal(r.headers['access-control-allow-origin'],undefined);assert.ok(!r.text.includes('private'));}
 const forwarded=await f.request('/game-day/api/state',{headers:{'X-Forwarded-For':'203.0.113.9','X-Forwarded-Host':'foreign.invalid'}});assert.equal(forwarded.status,200);
 let status,value,next=false;f.web.guard({url:'/game-day',headers:{host:new URL(f.origin).host},rawHeaders:['Host',new URL(f.origin).host],socket:{remoteAddress:'203.0.113.9'},method:'GET'},{set(){},status(v){status=v;return this;},json(v){value=v;}},()=>{next=true;});assert.equal(status,403);assert.equal(value.code,'LOCAL_ONLY');assert.equal(next,false,'simulated remote OS boundary must deny');
});

test('mutation security requires exact Origin and constant-time session-bound CSRF without accepting URL/body tokens',async t=>{
 const f=await fixture(t),p=await f.page(),other=await f.page(),json={action:'stop',...f.tuple};
 const cases=[{}, {Origin:'https://foreign.invalid'}, {Origin:f.origin}, {...f.mutation(p),'X-PiRaiders-CSRF':'f'.repeat(64)}, {...f.mutation(p),'X-PiRaiders-CSRF':other.token}, {...f.mutation(p),'Sec-Fetch-Site':'none'}, {...f.mutation(p),'Sec-Fetch-Mode':'no-cors'}, {...f.mutation(p),'Sec-Fetch-Dest':'document'}];
 for(const headers of cases){const r=await f.request('/game-day/api/command',{method:'POST',headers,json});assert.equal(r.status,403);assert.equal(r.headers['access-control-allow-origin'],undefined);}
 assert.equal(f.calls.length,0);const ok=await f.request('/game-day/api/command',{method:'POST',headers:f.mutation(p),json});assert.equal(ok.status,200);assert.deepEqual(f.calls[0],['command','stop',f.tuple]);
 const query=await f.request('/game-day/api/command?csrf='+p.token,{method:'POST',headers:f.mutation(p),json});assert.equal(query.status,400);assert.ok(!query.text.includes(p.token));
 const options=await f.request('/game-day/api/command',{method:'OPTIONS',headers:{Origin:f.origin,'Access-Control-Request-Headers':'X-PiRaiders-CSRF'}});assert.equal(options.status,405);assert.equal(options.headers['access-control-allow-origin'],undefined);
});

test('strict4KiB JSON and fixed endpoint schemas reject malformed, compressed, unknown and executable-bearing input',async t=>{
 const f=await fixture(t),p=await f.page(),headers=f.mutation(p);
 for(const json of [null,[],{}, {action:'STOP',...f.tuple},{action:'stop',...f.tuple,extra:true},{action:'stop',...f.tuple,expectedSelection:'0'},{action:'stop',...f.tuple,expectedEventId:'../private'}]){const r=await f.request('/game-day/api/command',{method:'POST',headers,json});assert.equal(r.status,400);}
 for(const[url,json]of [['prepare',{eventId:'../private',...f.tuple}],['activate',{candidateId:'not-candidate',...f.tuple}],['discard',{candidateId:'f'.repeat(48),...f.tuple,executable:'/private/path'}]])assert.equal((await f.request('/game-day/api/'+url,{method:'POST',headers,json})).status,400);
 const huge=await f.request('/game-day/api/command',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({action:'stop',...f.tuple,pad:'x'.repeat(5000)})});assert.equal(huge.status,413);assert.equal(huge.value.code,'INVALID_JSON');
 for(const bad of [{headers:{'Content-Type':'text/plain'},body:'private'},{headers:{'Content-Type':'application/json'},body:'{private'},{headers:{'Content-Type':'application/json','Content-Encoding':'gzip'},body:'private'}]){const r=await f.request('/game-day/api/command',{method:'POST',headers:{...headers,...bad.headers},body:bad.body});assert.ok([400,415].includes(r.status));assert.ok(!r.text.includes('private'));}
 assert.equal(f.calls.length,0);assert.equal((await f.request('/game-day/api/quit',{method:'POST',headers,json:{}})).status,404);assert.equal((await f.request('/game-day/api/state',{method:'DELETE',headers})).status,405);
});

test('page and API preserve existing SPX session/login/policy semantics without a new credential endpoint',async t=>{
 const f=await fixture(t,{username:'operator',password:'hashed-existing-policy'});
 const page=await f.request('/game-day');assert.equal(page.status,302);assert.equal(page.headers.location,'/login');assert.equal((await f.request('/game-day/api/state')).value.code,'AUTH_REQUIRED');assert.equal((await f.request('/css/piraiders-game-day.css')).status,401);
 const wrong=await f.cookieFor('other');assert.equal((await f.request('/game-day/api/state',{headers:{Cookie:wrong}})).status,401);
 const cookie=await f.cookieFor('operator'),p=await f.page(cookie);assert.equal(p.response.status,200);assert.match(p.token,/^[a-f0-9]{64}$/);assert.equal((await f.request('/game-day/api/events',{headers:{Cookie:cookie}})).status,200);
 f.globalConfig.general.password='';const redirected=await f.request('/game-day');assert.equal(redirected.status,302);assert.equal(redirected.headers.location,'/');const policy=await f.request('/game-day/api/state',{headers:{Cookie:cookie}});assert.equal(policy.status,403);assert.equal(policy.value.code,'AUTH_POLICY_REQUIRED');
});

test('actual asynchronous manager work survives request disconnect and priority Stop is never queued behind it',async t=>{
 const f=await fixture(t),p=await f.page(),hold=deferred();f.gate.prepare=hold.promise;
 const preparing=f.request('/game-day/api/prepare',{method:'POST',headers:f.mutation(p),json:{eventId:'alpha',...f.tuple}});await until(()=>f.calls.some(v=>v[0]==='prepare'));
 const stop=await f.request('/game-day/api/command',{method:'POST',headers:f.mutation(p),json:{action:'stop',...f.tuple}});assert.equal(stop.status,200);assert.equal(f.calls.filter(v=>v[0]==='close').length,0);hold.resolve({ok:false,code:'PREPARE_FAILED'});assert.equal((await preparing).status,422);
 const gate=deferred();f.gate.command=gate.promise;const address=new URL(f.origin);const dropped=http.request({hostname:address.hostname,port:address.port,path:'/game-day/api/command',method:'POST',agent:false,headers:{...f.mutation(p),'Content-Type':'application/json'}});dropped.on('error',()=>{});dropped.end(JSON.stringify({action:'reload',...f.tuple}));await until(()=>f.calls.some(v=>v[0]==='command'&&v[1]==='reload'));dropped.destroy();const another=await f.request('/game-day/api/command',{method:'POST',headers:f.mutation(p),json:{action:'stop',...f.tuple}});assert.equal(another.status,200);gate.resolve({ok:false,code:'CANCELLED'});await wait(20);
});

test('thrown manager errors never echo paths and close is synchronous/idempotent',async t=>{
 const f=await fixture(t),p=await f.page();f.manager.snapshot=()=>{throw Error('/private/student');};const state=await f.request('/game-day/api/state');assert.equal(state.status,500);assert.deepEqual(state.value,{ok:false,code:'STATE_UNAVAILABLE'});
 f.manager.listEvents=()=>{throw Error('/private/student');};assert.equal((await f.request('/game-day/api/events')).value.code,'CATALOG_INVALID');f.manager.dispatch=()=>{throw Error('/private/student');};const command=await f.request('/game-day/api/command',{method:'POST',headers:f.mutation(p),json:{action:'stop',...f.tuple}});assert.equal(command.value.code,'OPERATION_FAILED');assert.ok(!command.text.includes('student'));
 const closing=f.web.close();assert.equal(f.calls.filter(v=>v[0]==='close').length,1);assert.strictEqual(f.web.close(),closing);await closing;assert.equal((await f.request('/game-day/api/state')).value.code,'CLOSED');
});

test('owned startup HMAC proves readiness without login/session secrets and rejects malformed or foreign probes',async t=>{
 const secret=randomBytes(32).toString('hex'),f=await fixture(t,{username:'operator',password:'existing',startupSecret:secret}),probe=randomBytes(16).toString('hex');
 const r=await f.request('/game-day/internal/startup-identity',{headers:{'X-PiRaiders-Startup-Probe':probe}});assert.equal(r.status,200);assert.deepEqual(r.value,{app:'piraiders',proof:createHmac('sha256',Buffer.from(secret,'hex')).update(probe,'ascii').digest('hex')});assert.equal(r.headers['set-cookie'],undefined);assert.equal(r.headers['access-control-allow-origin'],undefined);assert.ok(!r.text.includes(secret));assert.ok(!r.text.includes(probe));
 for(const value of ['','A'.repeat(32),'x'.repeat(32),'a'.repeat(33)]){const bad=await f.request('/game-day/internal/startup-identity',{headers:{'X-PiRaiders-Startup-Probe':value}});assert.equal(bad.status,400);assert.equal(bad.value.code,'INVALID_PROBE');}
 const missing=await f.request('/game-day/internal/startup-identity');assert.equal(missing.status,400);const foreign=await f.request('/game-day/internal/startup-identity',{headers:{Origin:'https://foreign.invalid','X-PiRaiders-Startup-Probe':probe}});assert.equal(foreign.status,403);const head=await f.request('/game-day/internal/startup-identity',{method:'HEAD',headers:{'X-PiRaiders-Startup-Probe':probe}});assert.equal(head.status,405);
});

test('manual app mode without startup secret exposes no identity proof endpoint',async t=>{
 const f=await fixture(t);const r=await f.request('/game-day/internal/startup-identity',{headers:{'X-PiRaiders-Startup-Probe':'a'.repeat(32)}});assert.equal(r.status,404);assert.equal(r.value.code,'NOT_FOUND');
});


test('web close reserves before reentrant cleanup, preserves failure and retries synchronously',async t=>{
 const f=await fixture(t);let nested,calls=0;f.manager.close=()=>{calls++;nested=f.web.close();return Promise.resolve({ok:false,code:'CLOSE_FAILED'});};const first=f.web.close();assert.equal(calls,1);assert.strictEqual(nested,first);assert.deepEqual(await first,{ok:false,code:'CLOSE_FAILED'});
 f.manager.close=()=>{calls++;nested=f.web.close();throw Error('/private/shutdown');};const second=f.web.close();assert.equal(calls,2);assert.strictEqual(nested,second);assert.deepEqual(await second,{ok:false,code:'CLOSE_FAILED'});
 f.manager.close=()=>{calls++;nested=f.web.close();return Promise.resolve({ok:true});};const third=f.web.close();assert.equal(calls,3);assert.strictEqual(nested,third);assert.deepEqual(await third,{ok:true});assert.strictEqual(f.web.close(),third);
});


test('startup proof rejects a different-interface relay even with allowed loopback peer and numeric Host',async t=>{
 const f=await fixture(t,{startupSecret:randomBytes(32).toString('hex')}),host=new URL(f.origin).host,probe='a'.repeat(32);
 const outcome=await new Promise((resolve,reject)=>{const req={url:'/game-day/internal/startup-identity',originalUrl:'/game-day/internal/startup-identity',method:'GET',headers:{host,'x-piraiders-startup-probe':probe},rawHeaders:['Host',host,'X-PiRaiders-Startup-Probe',probe],socket:{remoteAddress:'::1',localAddress:'::1'}};
  const res={set(){},status(status){this.statusCode=status;return this;},json(value){resolve({status:this.statusCode,value});}};f.web.guard(req,res,()=>f.web.router.handle(req,res,error=>reject(error||Error('missing identity response'))));});
 assert.deepEqual(outcome,{status:403,value:{ok:false,code:'LOCAL_ONLY'}});
 const ordinary=await f.request('/game-day/api/state');assert.equal(ordinary.status,200,'ordinary UI semantics unchanged');
});


test('actual machine initialization accepts a canonical config alias but refuses a different file without source reads',async t=>{
 const f=await fixture(t),configFile=path.join(f.root,'config.json'),other=path.join(f.root,'other-config.json'),alias=path.join(f.root,'config-alias'),source=path.join(f.root,'offline-source'),machineFile=path.join(f.root,'machine.json');
 await fs.writeFile(configFile,'{}');await fs.writeFile(other,'{}');await fs.symlink(f.root,alias,process.platform==='win32'?'junction':'dir');await fs.mkdir(path.join(f.root,'catalog'));
 await fs.writeFile(machineFile,JSON.stringify({schemaVersion:1,spxConfigFile:'config.json',catalogDirectory:path.join(f.root,'catalog'),mediaRoot:source,cacheRoot:path.join(f.root,'cache'),runtimeRoot:path.join(f.root,'runtime'),caspar:{executable:process.execPath,cwd:f.root},output:{type:'none'},rossTalk:{host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}}}));
 const originals=new Map();let sourceReads=0;for(const name of ['stat','lstat','realpath','open','opendir']){const original=fs[name];originals.set(name,original);fs[name]=async(value,...args)=>{if(typeof value==='string'&&(value===source||value.startsWith(source+path.sep))){sourceReads++;throw Error('source unavailable');}return original.call(fs,value,...args);};}
 try{
  for(const [reference,expected]of [[path.join(alias,'config.json'),200],[other,503]]){
   const app=express(),server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port,web=createGameDayWeb({port,appRoot:f.root,machineFile,configFile:reference});app.use(web.guard);app.use(session({secret:'canonical-config-fixture',resave:false,saveUninitialized:false}));app.use(web.router);
   try{const response=await new Promise((resolve,reject)=>{const request=http.get({hostname:'127.0.0.1',port,path:'/game-day/api/state',agent:false,headers:{Host:'127.0.0.1:'+port}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,value:JSON.parse(Buffer.concat(chunks).toString())}));});request.on('error',reject);});assert.equal(response.status,expected);if(expected===200){assert.equal(response.value.state.state,'idle');assert.equal(response.value.state.preparing,false);}else assert.deepEqual(response.value,{ok:false,code:'APP_CONFIG_INVALID'});}
   finally{await web.close();await new Promise(resolve=>server.close(resolve));}
  }
  assert.equal(sourceReads,0);assert.equal(await fs.readFile(configFile,'utf8'),'{}');assert.equal(await fs.readFile(other,'utf8'),'{}');
 }finally{for(const[name,original]of originals)fs[name]=original;}
});

// Q-009: ending a dead event is a protected mutation with an exact body; a live event answers 409.
test('end-dead: CSRF-protected, exact schema, the manager decides; a live event answers 409 EVENT_NOT_DEAD',async t=>{
 const f=await fixture(t),p=await f.page(),headers=f.mutation(p);
 assert.equal((await f.request('/game-day/api/end-dead',{method:'POST',headers:{Origin:f.origin,Cookie:p.cookie},json:f.tuple})).status,403);
 for(const json of [{},{...f.tuple,candidateId:'a'.repeat(48)},{...f.tuple,expectedSelection:'0'},{expectedEventId:'../private',expectedSelection:0}])
  assert.equal((await f.request('/game-day/api/end-dead',{method:'POST',headers,json})).status,400);
 assert.equal(f.calls.length,0);
 const ok=await f.request('/game-day/api/end-dead',{method:'POST',headers,json:f.tuple});assert.equal(ok.status,200);assert.deepEqual(f.calls[0],['end-dead',f.tuple]);
 f.gate.endDead={ok:false,code:'EVENT_NOT_DEAD'};
 const live=await f.request('/game-day/api/end-dead',{method:'POST',headers,json:f.tuple});assert.deepEqual([live.status,live.value.code],[409,'EVENT_NOT_DEAD']);
});
