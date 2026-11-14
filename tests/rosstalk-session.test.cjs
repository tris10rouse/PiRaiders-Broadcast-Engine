'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const http=require('node:http');
const {WebSocket}=require('ws');
const {PNG}=require('pngjs');
const {stageSnapshot}=require('../scripts/lib/media-snapshot.cjs');
const {createRossTalkSession}=require('../scripts/lib/rosstalk-session.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,timeout=5000){const end=Date.now()+timeout;while(!predicate()){if(Date.now()>=end)throw Error('Fixture deadline');await wait(5);}}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
async function fixture(t,options={}){
  const temporary=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'piraiders-control-')));
  const sourceDir=path.join(temporary,'source'),cacheDir=path.join(temporary,'cache');await fs.mkdir(sourceDir);
  const bytes=PNG.sync.write({width:2,height:2,data:Buffer.alloc(16,255)});
  await fs.writeFile(path.join(sourceDir,'01.png'),bytes);await fs.writeFile(path.join(sourceDir,'02.png'),bytes);
  const prepared=await stageSnapshot({sourceDir,cacheDir,quietMs:0});
  let allowed=true,resolver=()=>prepared.snapshotDir;
  const settings={rossTalk:{host:'127.0.0.1',port:0,allowedSenders:['127.0.0.1'],acknowledgements:true,commandMap:{1:'launch',2:'next',3:'previous',4:'toggle-auto',5:'reload',8:'stop'}},
    resolverTimeoutMs:5000,canControl:()=>typeof allowed==='function'?allowed():allowed,resolvePreparedSnapshot:args=>resolver(args),...options,
    presentation:{snapshotDir:prepared.snapshotDir,commandTimeoutMs:500,prepareTimeoutMs:500,controllerOptions:{mode:'manual'},...options.presentation}};
  const host=await createRossTalkSession(settings,{allowEphemeral:true}),cleanups=[];
  t.after(async()=>{for(const cleanup of cleanups)cleanup();await host.close();await fs.rm(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:50});});
  const token=new URL(host.getProgramURL()).hash.slice('#piraiders='.length);
  return{host,prepared,temporary,token,settings,cleanups,setGate(value){allowed=value;},setResolver(value){resolver=value;}};
}
function request(host, url, {method='GET',headers={},body} = {}) {
  return new Promise((resolve,reject) => {
    const address = new URL(host.origin);
    const req = http.request({hostname:address.hostname,port:address.port || 80,path:url,method,agent:false,headers},res => {
      const chunks = []; res.on('data',bytes=>chunks.push(bytes)); res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(chunks)}));
    });
    req.on('error',reject); req.end(body);
  });
}
async function bootstrap(f, extra = {}) {
  const response = await request(f.host,'/piraiders/session',{method:'POST',headers:{origin:f.host.origin,authorization:'Bearer '+f.token,...extra}});
  assert.equal(response.status,204);
  return response.headers['set-cookie'][0].split(';')[0];
}
function rawClient(t, f, cookie, {token=f.token,origin=f.host.origin,closeAfterAuth=false} = {}) {
  const address = new URL(f.host.origin), events = [], messages = [];
  const ws = new WebSocket('ws://' + address.host + '/piraiders/socket.io/?EIO=4&transport=websocket', {headers:{Origin:origin,Cookie:cookie}});
  let closed = false, error = null;
  ws.on('error',value=>{error=value;}); ws.on('close',()=>{closed=true;});
  ws.on('message',bytes=>{
    const text = bytes.toString(); messages.push(text);
    if (text[0] === '0') { ws.send('40'+JSON.stringify({token})); if (closeAfterAuth) ws.close(); }
    else if (text === '2') ws.send('3');
    else if (text.startsWith('42')) { const value=JSON.parse(text.slice(2)); events.push({name:value[0],value:value[1]}); }
    else if (text.startsWith('44')) events.push({name:'connect_error',value:JSON.parse(text.slice(2))});
  });
  t.after(()=>ws.terminate());
  return {ws,messages,events,get closed(){return closed;},get error(){return error;},
    send(name,value){ws.send('42'+JSON.stringify([name,value]));},
    async next(name,timeout=3000){await until(()=>events.some(e=>e.name===name)||closed||error,timeout);const index=events.findIndex(e=>e.name===name);if(index<0)throw Error('Fixture socket closed before '+name);return events.splice(index,1)[0].value;},
    async init(){const value=await this.next('init');this.epoch=value.epoch;return value;},
    ready(){this.send('ready',{epoch:this.epoch});},
    ack(command,ok=true,code){this.send('ack',{epoch:command.epoch,id:command.id,ok,...(ok?{}:{code})});}
  };
}
async function program(t,f) {
  const cookie = await bootstrap(f), client = rawClient(t,f,cookie);
  await client.init(); client.ready(); await until(()=>f.host.snapshot().presentation.renderer.ready);
  return {client,cookie};
}


async function autoProgram(t,f){
  const p=await program(t,f),commands=[];let hold=()=>false;
  p.client.ws.on('message',raw=>{const text=raw.toString();if(!text.startsWith('42'))return;const[event,value]=JSON.parse(text.slice(2));if(event!=='command')return;commands.push(value);if(!hold(value))p.client.ack(value);});
  return{...p,commands,hold(value){hold=value;}};
}
async function tcp(t,f){
  const socket=net.createConnection({host:'127.0.0.1',port:f.host.address().port}),lines=[];let pending='',sequence=0;
  socket.on('error',()=>{});socket.on('data',data=>{pending+=data;let at;while((at=pending.indexOf('\r\n'))>=0){lines.push(pending.slice(0,at));pending=pending.slice(at+2);}});
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});t.after(()=>socket.destroy());
  // Each fixture has one TCP source. Match the current command's sequence so
  // an unexpected ERR fails immediately instead of becoming a vague deadline.
  return{socket,lines,send(gpi){sequence++;socket.write('GPI '+gpi+'\r\n');},async reply(action){
    const expected=sequence,pattern=new RegExp('^(?:OK|ERR) '+expected+' ');
    await until(()=>lines.some(line=>pattern.test(line)));
    const line=lines.find(value=>pattern.test(value));assert.equal(line,'OK '+expected+' '+action,'unexpected command diagnostic');return line;
  }};
}
test('factory derives a bounded handler budget before host creation and rejects unsafe configuration',async t=>{
  const base={presentation:{snapshotDir:'/does/not/exist'},rossTalk:{allowedSenders:['127.0.0.1'],commandMap:{1:'launch'}},canControl:()=>true,resolvePreparedSnapshot:()=>'/prepared'};
  for(const value of [null,{}, {...base,canControl:true},{...base,resolvePreparedSnapshot:null},{...base,resolverTimeoutMs:99},
    {...base,rossTalk:{...base.rossTalk,handlerTimeoutMs:2000}}, {...base,presentation:{...base.presentation,commandTimeoutMs:59000,prepareTimeoutMs:120000},resolverTimeoutMs:120000},
    {...base,arbitrary:true}])await assert.rejects(createRossTalkSession(value),{code:'INVALID_OPTIONS'});
  const f=await fixture(t);assert.equal(f.host.address(),null);assert.equal(f.host.snapshot().state,'idle');
  assert.ok(!JSON.stringify(f.host.snapshot()).includes(f.token));assert.ok(Object.isFrozen(f.host.snapshot().transport));
  await f.host.start();assert.ok(f.host.address().port>0);assert.equal(f.host.snapshot().state,'listening');
});

test('actual TCP commands await host frame/feedback ACK and drive wrapping, Reload and black',async t=>{
  const f=await fixture(t,{presentation:{commandTimeoutMs:2000,prepareTimeoutMs:5000}}),p=await autoProgram(t,f);await f.host.start();const wire=await tcp(t,f);
  p.hold(c=>c.type==='show');wire.send(1);await until(()=>p.commands.some(c=>c.type==='show'));
  assert.equal(wire.lines.length,0,'receipt cannot acknowledge unpainted frame');
  p.client.ack(p.commands.at(-1));assert.match(await wire.reply('launch'),/^OK /);
  p.hold(()=>false);wire.send(2);await wire.reply('next');assert.equal(f.host.snapshot().presentation.controller.index,1);
  wire.send(4);await wire.reply('toggle-auto');assert.equal(f.host.snapshot().presentation.controller.mode,'auto');
  assert.ok(p.commands.some(c=>c.type==='feedback'&&c.mode==='auto'));
  wire.send(5);await wire.reply('reload');assert.equal(f.host.snapshot().presentation.controller.deckId,f.prepared.deck.id);
  wire.send(8);await wire.reply('stop');assert.equal(f.host.snapshot().presentation.renderer.presentation,'black');
});

test('false, throwing and asynchronous gates reject normal control without changing the frame; Stop bypasses gate',async t=>{
  const f=await fixture(t),p=await autoProgram(t,f);await f.host.start();const wire=await tcp(t,f);
  wire.send(1);await wire.reply('launch');const shows=p.commands.filter(c=>c.type==='show').length;
  for(const gate of [false,()=>{throw Error('/private/network');},()=>Promise.resolve(true),()=>Promise.reject(Error('private'))]){
    f.setGate(gate);const failed=f.host.snapshot().transport.failed;wire.send(2);await until(()=>f.host.snapshot().transport.failed>failed);
    assert.equal(f.host.snapshot().lastError,'CONTROL_INHIBITED');assert.equal(p.commands.filter(c=>c.type==='show').length,shows);
    assert.equal(f.host.snapshot().presentation.renderer.presentation,'frame');
  }
  wire.send(8);assert.match(await wire.reply('stop'),/^OK /);assert.equal(f.host.snapshot().presentation.renderer.presentation,'black');
});

test('Stop aborts a pending resolver and its late result cannot activate or permit a successor around the orphan',async t=>{
  const f=await fixture(t),p=await autoProgram(t,f),gate=deferred();let signal;
  f.cleanups.push(()=>gate.resolve(f.prepared.snapshotDir));f.setResolver(value=>{signal=value.signal;return gate.promise;});
  await f.host.start();const wire=await tcp(t,f);wire.send(1);await wire.reply('launch');
  wire.send(5);await until(()=>!!signal);wire.send(8);await wire.reply('stop');assert.equal(signal.aborted,true);
  const count=p.commands.length;wire.send(2);await wait(40);assert.equal(p.commands.length,count,'old resolver remains serial barrier');
  gate.resolve(f.prepared.snapshotDir);await until(()=>f.host.snapshot().transport.outstandingCallbacks===0);
  assert.equal(f.host.snapshot().presentation.controller.state,'stopped');assert.equal(f.host.snapshot().presentation.controller.deckId,f.prepared.deck.id);
  assert.equal(p.commands.filter(c=>c.type==='show').length,1);assert.ok(wire.lines.some(line=>line.startsWith('ERR ')));
});

test('late resolved path is fenced when the gate closes or a fresh renderer epoch replaces the old one',async t=>{
  const f=await fixture(t),p=await autoProgram(t,f);await f.host.start();const wire=await tcp(t,f);
  wire.send(1);await wire.reply('launch');let gate=deferred(),called=false;
  f.cleanups.push(()=>gate.resolve(f.prepared.snapshotDir));f.setResolver(()=>{called=true;return gate.promise;});
  wire.send(5);await until(()=>called);f.setGate(false);gate.resolve(f.prepared.snapshotDir);
  await until(()=>f.host.snapshot().transport.failed>0);assert.equal(f.host.snapshot().lastError,'CONTROL_INHIBITED');
  assert.equal(f.host.snapshot().presentation.controller.state,'stopped');
  f.setGate(true);gate=deferred();called=false;const failed=f.host.snapshot().transport.failed;wire.send(5);await until(()=>called);
  p.client.ws.terminate();await until(()=>!f.host.snapshot().presentation.renderer.connected);
  const again=await autoProgram(t,f);gate.resolve(f.prepared.snapshotDir);await until(()=>f.host.snapshot().transport.failed>failed);
  assert.equal(f.host.snapshot().lastError,'STALE_SESSION');assert.equal(again.commands.length,0);assert.equal(f.host.snapshot().presentation.controller.state,'stopped');
});

test('resolver timeout blacks promptly but ignored cancellation retains callback until terminal transport deadline',async t=>{
  const f=await fixture(t,{resolverTimeoutMs:100}),p=await autoProgram(t,f),gate=deferred();let signal;
  f.cleanups.push(()=>gate.resolve(f.prepared.snapshotDir));f.setResolver(value=>{signal=value.signal;return gate.promise;});
  await f.host.start();const wire=await tcp(t,f);wire.send(1);await wire.reply('launch');wire.send(5);await until(()=>!!signal);
  await until(()=>signal.aborted);await until(()=>f.host.snapshot().presentation.renderer.presentation==='black');
  assert.equal(f.host.snapshot().lastError,'RESOLVER_TIMEOUT');wire.send(2);await wait(30);
  assert.equal(p.commands.filter(c=>c.type==='show').length,1);
  await until(()=>f.host.snapshot().state==='faulted',6000);assert.equal(f.host.snapshot().lastError,'HANDLER_TIMEOUT');
  assert.equal(f.host.snapshot().presentation.closed,true);gate.resolve(f.prepared.snapshotDir);await wait(20);
  assert.equal(f.host.snapshot().state,'faulted');assert.equal(p.commands.filter(c=>c.type==='show').length,1);
});

test('resolver errors and invalid paths use fixed diagnostics and close is bounded/idempotent with unresolved work',async t=>{
  const f=await fixture(t),p=await autoProgram(t,f);await f.host.start();const wire=await tcp(t,f);
  wire.send(1);await wire.reply('launch');let failed=0;
  for(const resolver of [()=>{throw Error('/private/student/name');},()=> 'relative/student.png']){
    f.setResolver(resolver);wire.send(5);await until(()=>f.host.snapshot().transport.failed>failed);failed=f.host.snapshot().transport.failed;
    assert.ok(['RESOLVER_FAILED','INVALID_SNAPSHOT'].includes(f.host.snapshot().lastError));assert.ok(!JSON.stringify(f.host.snapshot()).includes('student'));
  }
  const gate=deferred();let called=false;f.cleanups.push(()=>gate.resolve(f.prepared.snapshotDir));f.setResolver(()=>{called=true;return gate.promise;});
  wire.send(5);await until(()=>called);const close=f.host.close();assert.equal(f.host.close(),close);await close;
  assert.equal(f.host.snapshot().state,'closed');assert.equal(f.host.snapshot().presentation.closed,true);
  assert.throws(()=>f.host.getProgramURL(),{code:'CLOSED'});gate.resolve(f.prepared.snapshotDir);await wait(20);
  assert.equal(p.commands.filter(c=>c.type==='show').length,1);
});

test('TCP listener startup failure tears down its already-created private presentation host',async t=>{
  const occupied=net.createServer();await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>occupied.close(resolve)));
  const f=await fixture(t,{rossTalk:{host:'127.0.0.1',port:occupied.address().port,allowedSenders:['127.0.0.1'],commandMap:{1:'launch',8:'stop'}}});
  await assert.rejects(f.host.start(),{code:'LISTEN_FAILED'});assert.equal(f.host.snapshot().state,'faulted');assert.equal(f.host.snapshot().presentation.closed,true);
  await assert.rejects(f.host.start(),{code:'CLOSED'});
});
