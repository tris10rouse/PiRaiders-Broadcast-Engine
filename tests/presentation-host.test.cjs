'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { WebSocket } = require('ws');
const { PNG } = require('pngjs');
const { stageSnapshot } = require('../scripts/lib/media-snapshot.cjs');
const { createPresentationHost } = require('../scripts/lib/presentation-host.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
async function until(predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { if (Date.now() >= deadline) throw Error('Fixture state deadline'); await wait(5); }
}
async function fixture(t, options = {}) {
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'piraiders-session-')));
  const sourceDir = path.join(temporary,'source'), cacheDir = path.join(temporary,'cache');
  await fs.mkdir(sourceDir);
  const png = PNG.sync.write({width:2,height:2,data:Buffer.alloc(16,255)});
  await fs.writeFile(path.join(sourceDir,'01.png'),png); await fs.writeFile(path.join(sourceDir,'02.png'),png);
  const prepared = await stageSnapshot({sourceDir,cacheDir,quietMs:0});
  const host = await createPresentationHost({snapshotDir:prepared.snapshotDir,commandTimeoutMs:1000,controllerOptions:{mode:'manual'},...options});
  t.after(async () => { await host.close(); await fs.rm(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:50}); });
  const token = new URL(host.getProgramURL()).hash.slice('#piraiders='.length);
  return {host,prepared,png,temporary,token};
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
  await client.init(); client.ready(); await until(()=>f.host.snapshot().renderer.ready);
  return {client,cookie};
}

test('host serves exact native assets and offline verified image bytes with no credential-bearing diagnostics', async t => {
  const f = await fixture(t), {host} = f;
  await fs.rm(path.join(f.temporary,'source'),{recursive:true});
  assert.ok(Object.isFrozen(host)); assert.equal(new URL(host.origin).hostname,'127.0.0.1');
  assert.equal(new URL(host.getProgramURL()).search,''); assert.match(f.token,/^[\w-]{43}$/);
  assert.ok(!JSON.stringify(host.snapshot()).includes(f.token)); assert.ok(!JSON.stringify(host).includes(f.token));
  for (const url of ['/templates/piraiders/slideshow/SLIDESHOW.html','/templates/piraiders/slideshow/presentation-client.js','/piraiders/socket.io/socket.io.js']) {
    const response = await request(host,url); assert.equal(response.status,200); assert.ok(response.bytes.length > 100);
    assert.equal(response.headers['cache-control'],'private, no-store'); assert.equal(response.headers['x-content-type-options'],'nosniff');
    assert.equal(response.headers['cross-origin-resource-policy'],'same-origin'); assert.equal(response.headers['referrer-policy'],'no-referrer');
    assert.equal(response.headers['access-control-allow-origin'],undefined); assert.ok(!response.bytes.includes(Buffer.from(f.token)));
  }
  const src = '/piraiders/media/' + f.prepared.manifest.id + '/' + f.prepared.manifest.files[0].src;
  assert.equal((await request(host,src)).status,403);
  const cookie = await bootstrap(f);
  const response = await request(host,src,{headers:{cookie}}); assert.equal(response.status,200); assert.deepEqual(response.bytes,f.png);
  for (const url of ['/', '/server.js','/templates/piraiders/slideshow/../SLIDESHOW.html','/templates/piraiders/slideshow/%53LIDESHOW.html',src+'?private=anything'])
    assert.equal((await request(host,url,{headers:{cookie}})).status,404);
  const head = await request(host,src,{method:'HEAD',headers:{cookie}}); assert.equal(head.status,200); assert.equal(head.bytes.length,0);
});

test('bootstrap and media enforce actual Host/Origin/site and separate per-host HttpOnly cookies', async t => {
  const a = await fixture(t), b = await fixture(t);
  for (const headers of [{},{origin:a.host.origin},{origin:a.host.origin,authorization:'Bearer invalid'},
    {origin:'http://example.invalid',authorization:'Bearer '+a.token},{origin:a.host.origin,authorization:'Bearer '+a.token,'sec-fetch-site':'same-site'},
    {origin:a.host.origin,authorization:'Bearer '+a.token,host:'example.invalid'}, {origin:a.host.origin,authorization:'Bearer '+'é'.repeat(43)}]) {
    const response = await request(a.host,'/piraiders/session',{method:'POST',headers}); assert.equal(response.status,403); assert.equal(response.bytes.length,0);
  }
  assert.equal((await request(a.host,'/piraiders/session',{method:'POST',headers:{origin:a.host.origin,authorization:'Bearer '+a.token},body:'x'})).status,400);
  const ac = await bootstrap(a), bc = await bootstrap(b); assert.notEqual(ac.split('=')[0],bc.split('=')[0]);
  const full = await request(a.host,'/piraiders/session',{method:'POST',headers:{origin:a.host.origin,authorization:'Bearer '+a.token}});
  assert.match(full.headers['set-cookie'][0],/; Path=\/piraiders\/; HttpOnly; SameSite=Strict$/);
  const src = '/piraiders/media/'+a.prepared.manifest.id+'/'+a.prepared.manifest.files[0].src;
  for (const headers of [{cookie:bc},{cookie:ac,origin:b.host.origin},{cookie:ac,'sec-fetch-site':'same-site'},{cookie:ac,'sec-fetch-site':'cross-site'},
    {cookie:ac,host:'127.0.0.1:1','x-forwarded-host':new URL(a.host.origin).host},{cookie:ac+'; '+ac}])
    assert.equal((await request(a.host,src,{headers})).status,403);
  assert.equal((await request(a.host,src,{headers:{cookie:ac+'; '+bc}})).status,200);
  assert.equal((await request(a.host,'/piraiders/socket.io/socket.io.js',{headers:{host:'example.invalid'}})).status,403);
});

test('socket admission requires both capability and cookie plus exact origin, and cannot evict existing program', async t => {
  const f = await fixture(t), cookie = await bootstrap(f);
  for (const options of [{token:'é'.repeat(43)},{origin:'http://example.invalid'},{token:'invalid'}]) {
    const client=rawClient(t,f,cookie,options);
    await until(()=>client.closed||client.error||client.events.some(e=>e.name==='connect_error'));
    assert.equal(f.host.snapshot().renderer.connected,false);
  }
  const noCookie=rawClient(t,f,''); await until(()=>noCookie.closed||noCookie.error); assert.equal(f.host.snapshot().renderer.connected,false);
  const first=rawClient(t,f,cookie); await first.init(); first.ready(); await until(()=>f.host.snapshot().renderer.ready);
  const second=rawClient(t,f,cookie); const denied=await second.next('connect_error'); assert.match(denied.message,/RENDERER_IN_USE/);
  assert.equal(f.host.snapshot().renderer.epoch,first.epoch); assert.equal(f.host.snapshot().renderer.ready,true);
});

test('an authenticated client disappearing during namespace admission releases its reservation promptly', async t => {
  const f=await fixture(t,{commandTimeoutMs:3000}), cookie=await bootstrap(f);
  for (let attempt=0;attempt<3;attempt++) {
    const vanished=rawClient(t,f,cookie,{closeAfterAuth:true});
    await until(()=>vanished.closed); await until(()=>!f.host.snapshot().renderer.connected,1000);
    const replacement=rawClient(t,f,cookie); await replacement.init(); replacement.ready(); await until(()=>f.host.snapshot().renderer.ready);
    replacement.ws.terminate(); await until(()=>!f.host.snapshot().renderer.connected);
  }
});

test('readiness requires matching initial-black acknowledgment and a fresh Launch, not navigation', async t => {
  const f=await fixture(t), cookie=await bootstrap(f), client=rawClient(t,f,cookie);
  assert.deepEqual(await f.host.dispatch({action:'launch'}),{action:null,ok:false,code:'INVALID_COMMAND'});
  assert.equal((await f.host.dispatch('reload')).code,'INVALID_COMMAND'); assert.equal((await f.host.dispatch('launch')).code,'NOT_READY');
  await client.init(); assert.equal(f.host.snapshot().renderer.connected,true); assert.equal(f.host.snapshot().renderer.presentation,'unverified');
  client.send('ready',{epoch:'old'}); await wait(20); assert.equal(f.host.snapshot().renderer.ready,false);
  client.ready(); await until(()=>f.host.snapshot().renderer.ready); assert.equal(f.host.snapshot().renderer.presentation,'black');
  assert.equal((await f.host.dispatch('next')).code,'NOT_PLAYING');
  const pending=f.host.dispatch('launch'), command=await client.next('command');
  assert.equal(command.type,'show'); assert.equal(f.host.snapshot().controller.index,null); assert.equal(f.host.snapshot().renderer.pending,1);
  assert.ok(command.src.startsWith('/piraiders/media/'+f.prepared.manifest.id+'/'));
  client.ack(command); assert.equal((await pending).ok,true); assert.equal(f.host.snapshot().controller.index,0); assert.equal(f.host.snapshot().renderer.presentation,'frame');
});

test('stale, wrong-epoch and duplicate ACK cannot commit current work; ordinary render failure retains committed frame', async t => {
  const f=await fixture(t), {client}=await program(t,f);
  const launch=f.host.dispatch('launch'), first=await client.next('command');
  client.send('ack',{epoch:'stale',id:first.id,ok:true}); await wait(20); assert.equal(f.host.snapshot().controller.index,null);
  client.ack(first); await launch;
  const next=f.host.dispatch('next'), second=await client.next('command');
  client.ack(first); await wait(20); assert.equal(f.host.snapshot().controller.index,0); assert.equal(f.host.snapshot().renderer.pending,1);
  client.ack(second,false,'LOAD_FAILED'); assert.equal((await next).code,'RENDER_FAILED');
  assert.equal(f.host.snapshot().controller.index,0); assert.equal(f.host.snapshot().controller.autoSuspended,true); assert.equal(f.host.snapshot().renderer.presentation,'frame');
  const retry=f.host.dispatch('next'), third=await client.next('command'); client.ack(third); await retry; assert.equal(f.host.snapshot().controller.index,1);
});

test('Stop sends cancellation and one black while late show ACK cannot overwrite acknowledged black', async t => {
  const f=await fixture(t), {client}=await program(t,f);
  const launch=f.host.dispatch('launch'), first=await client.next('command'); client.ack(first); await launch;
  const next=f.host.dispatch('next'), shown=await client.next('command'), stop=f.host.dispatch('stop');
  assert.equal((await next).code,'CANCELLED'); assert.deepEqual(await client.next('cancel'),{epoch:client.epoch,id:shown.id});
  const black=await client.next('command'); assert.equal(black.type,'black');
  const repeats=Array.from({length:30},()=>f.host.dispatch('stop')); assert.ok(repeats.every(value=>value===stop));
  assert.equal(f.host.snapshot().renderer.pending,2); client.ack(black); assert.equal((await stop).ok,true);
  assert.equal(f.host.snapshot().renderer.presentation,'black'); assert.equal(f.host.snapshot().controller.state,'stopped');
  client.ack(shown); await until(()=>f.host.snapshot().renderer.pending===0);
  assert.equal(f.host.snapshot().renderer.presentation,'black'); assert.equal(f.host.snapshot().controller.index,null);
  assert.equal(client.events.some(value=>value.name==='command'),false);
});

test('negative black paint acknowledgment invalidates readiness and requires fresh session instead of claiming old frame', async t => {
  const f=await fixture(t), {client}=await program(t,f);
  const launch=f.host.dispatch('launch'), first=await client.next('command'); client.ack(first); await launch;
  const stop=f.host.dispatch('stop'), black=await client.next('command'); client.ack(black,false,'TRANSITION_FAILED');
  assert.equal((await stop).ok,false); await until(()=>!f.host.snapshot().renderer.connected);
  assert.equal(f.host.snapshot().renderer.presentation,'unverified'); assert.equal(f.host.snapshot().controller.state,'stopped');
  assert.equal((await f.host.dispatch('launch')).code,'NOT_READY'); assert.equal(f.host.snapshot().renderer.lastError,'BLACK_UNVERIFIED');
});

test('disconnect rejects active and queued work, preserves mode, and fresh connection requires Launch', async t => {
  const f=await fixture(t), {client,cookie}=await program(t,f);
  const launch=f.host.dispatch('launch'), command=await client.next('command'); client.ack(command); await launch;
  await f.host.dispatch('auto'); await f.host.dispatch('manual');
  const next=f.host.dispatch('next'); await client.next('command'); const queued=f.host.dispatch('previous'); client.ws.terminate();
  assert.equal((await next).ok,false); assert.equal((await queued).ok,false); await until(()=>!f.host.snapshot().renderer.connected);
  assert.equal(f.host.snapshot().renderer.presentation,'unverified'); assert.equal(f.host.snapshot().controller.state,'stopped');
  assert.equal(f.host.snapshot().controller.mode,'manual'); assert.equal(f.host.snapshot().controller.nextAdvanceAt,null);
  const reconnect=rawClient(t,f,cookie); await reconnect.init(); assert.notEqual(reconnect.epoch,client.epoch); reconnect.ready(); await until(()=>f.host.snapshot().renderer.ready);
  assert.equal((await f.host.dispatch('next')).code,'NOT_PLAYING');
  const fresh=f.host.dispatch('launch'), shown=await reconnect.next('command'); reconnect.ack(shown); await fresh; assert.equal(f.host.snapshot().controller.index,0);
});

test('initialization deadline disconnects an unready renderer and permits a fresh session', async t => {
  const f=await fixture(t,{commandTimeoutMs:200}), cookie=await bootstrap(f), client=rawClient(t,f,cookie);
  await client.init(); await until(()=>!f.host.snapshot().renderer.connected); assert.equal(f.host.snapshot().renderer.lastError,'SESSION_TIMEOUT'); assert.equal(f.host.snapshot().renderer.ready,false); assert.equal(f.host.snapshot().controller.state,'stopped');
  const reconnect=rawClient(t,f,cookie); await reconnect.init(); assert.equal(f.host.snapshot().renderer.lastError,'SESSION_TIMEOUT');
  reconnect.ready(); await until(()=>f.host.snapshot().renderer.ready); assert.equal(f.host.snapshot().renderer.lastError,null);
});

test('unacknowledged command and orphan cancellation deadlines close session rather than allowing concurrent normal work', async t => {
  const f=await fixture(t,{commandTimeoutMs:200}), {client}=await program(t,f);
  const launch=f.host.dispatch('launch'); await client.next('command');
  assert.equal((await launch).ok,false); await until(()=>!f.host.snapshot().renderer.connected); assert.equal(f.host.snapshot().controller.state,'stopped');
  assert.equal(f.host.snapshot().renderer.lastError,'SESSION_TIMEOUT');
  const {client:again}=await program(t,f); const nextLaunch=f.host.dispatch('launch'), first=await again.next('command'); again.ack(first); await nextLaunch;
  const next=f.host.dispatch('next'); await again.next('command'); const stop=f.host.dispatch('stop'); await next; await again.next('cancel');
  const black=await again.next('command'); again.ack(black); await stop;
  const later=f.host.dispatch('launch'); assert.equal(f.host.snapshot().renderer.pending,1); // old canceled show only
  await until(()=>!f.host.snapshot().renderer.connected); assert.equal((await later).ok,false); assert.equal(f.host.snapshot().controller.state,'stopped');
});

test('malformed/future ACK or browser-originated controller command fails session closed without raw error details', async t => {
  const f=await fixture(t);
  for (const send of [client=>client.send('ack',{epoch:client.epoch,id:100000,ok:true}),
    client=>client.send('ack',{epoch:client.epoch,id:1,ok:false,code:'/private/student.png'}),
    client=>client.send('ready',{epoch:client.epoch,extra:'secret'}), client=>client.send('dispatch','launch')]) {
    const {client}=await program(t,f); send(client); await until(()=>!f.host.snapshot().renderer.connected);
    assert.equal(f.host.snapshot().renderer.presentation,'unverified'); assert.equal(f.host.snapshot().controller.state,'stopped');
  }
});

test('close is bounded/idempotent, cancels pending work, frees listener and never returns another program credential', async t => {
  const f=await fixture(t), {client}=await program(t,f);
  const pending=f.host.dispatch('launch'); await client.next('command');
  const start=Date.now(), first=f.host.close(); assert.equal(f.host.close(),first); await first;
  assert.ok(Date.now()-start<2000); assert.equal((await pending).ok,false); assert.equal(f.host.snapshot().closed,true);
  assert.equal((await f.host.dispatch('launch')).code,'CLOSED'); assert.throws(()=>f.host.getProgramURL(),{code:'CLOSED'});
  await until(()=>client.closed); const address=new URL(f.host.origin);
  const port=net.createServer(); await new Promise((resolve,reject)=>{port.once('error',reject);port.listen(Number(address.port),'127.0.0.1',resolve);});
  await new Promise(resolve=>port.close(resolve));
});

test('invalid host/controller options and occupied port fail before leaving an orphan listener', async t => {
  for (const raw of [null,[],{host:'0.0.0.0'},{port:-1},{commandTimeoutMs:99},{commandTimeoutMs:60000},
    {controllerOptions:{scheduler:{}}},{controllerOptions:{mode:'invalid'}},{controllerOptions:{transition:{type:'fade',durationMs:1000}},commandTimeoutMs:100}])
    await assert.rejects(createPresentationHost(raw),{code:'INVALID_OPTIONS'});
  const f=await fixture(t), address=new URL(f.host.origin);
  await assert.rejects(createPresentationHost({snapshotDir:f.prepared.snapshotDir,port:Number(address.port)}),{code:'START_FAILED'});
  assert.equal((await request(f.host,'/templates/piraiders/slideshow/SLIDESHOW.html')).status,200);
});
