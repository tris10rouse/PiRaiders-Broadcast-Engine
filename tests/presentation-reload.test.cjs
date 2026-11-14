'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { WebSocket } = require('ws');
const crypto = require('node:crypto');
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
  const cleanups=[];
  t.after(async () => { for(const cleanup of cleanups) await cleanup(); await host.close(); await until(()=>host.snapshot().reload.state==='idle'); await fs.rm(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:50}); });
  const token = new URL(host.getProgramURL()).hash.slice('#piraiders='.length);
  return {host,prepared,png,temporary,token,cleanups};
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

async function candidate(f, names=['01.png','02.png'], value=100) {
  const sourceDir=path.join(f.temporary,'source-'+crypto.randomUUID());await fs.mkdir(sourceDir);
  const data=Buffer.alloc(16,value);for(let i=3;i<16;i+=4)data[i]=255;
  const png=PNG.sync.write({width:2,height:2,data});
  for(const name of names)await fs.writeFile(path.join(sourceDir,name),png);
  return stageSnapshot({sourceDir,cacheDir:path.join(f.temporary,'candidates'),quietMs:0});
}
async function autoProgram(t,f,{hold=()=>false}={}) {
  const p=await program(t,f), commands=[];
  p.client.ws.on('message',raw=>{
    const text=raw.toString();if(!text.startsWith('42'))return;
    const [event,value]=JSON.parse(text.slice(2));if(event!=='command')return;
    commands.push(value);if(!hold(value))p.client.ack(value);
  });
  return {...p,commands};
}
function blockedManifest(t,f,snapshotDir) {
  const original=fs.open;let release,entered,used=false;
  const blocked=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  t.mock.method(fs,'open',async(...args)=>{
    const handle=await original(...args);
    if(args[0]===path.join(snapshotDir,'manifest.json')&&!used){used=true;
      const read=handle.read.bind(handle);let first=true;
      handle.read=async(...values)=>{if(first){first=false;entered();await gate;}return read(...values);};
    }
    return handle;
  });
  f.cleanups.push(()=>release());
  return {blocked,release};
}
function imageURL(prepared,index=0){return '/piraiders/media/'+prepared.deck.id+'/'+prepared.deck.slides[index].src;}

test('stopped offline replacement registers only the new verified deck without creating visible output',async t=>{
  const f=await fixture(t), next=await candidate(f,['02.png','03.png']);
  assert.equal((await f.host.reloadSnapshot(next.snapshotDir)).ok,true);
  assert.equal(f.host.snapshot().controller.deckId,next.deck.id);assert.equal(f.host.snapshot().controller.index,null);
  assert.equal(f.host.snapshot().controller.state,'stopped');assert.equal(f.host.snapshot().renderer.connected,false);
  assert.deepEqual(f.host.snapshot().media,{registered:1,retained:0});
  const p=await autoProgram(t,f);await f.host.dispatch('launch');
  assert.equal(f.host.snapshot().controller.index,0);assert.ok(p.commands[0].src.includes(next.deck.id));
  assert.equal(p.commands.some(c=>c.type==='feedback'),false,'stopped preparation never queues a later loading label');
});

test('playing replacement preserves surviving occurrence and retires old routes only after confirmed candidate frame',async t=>{
  const f=await fixture(t), p=await autoProgram(t,f),next=await candidate(f,['02.png','03.png']);
  await f.host.dispatch('launch');await f.host.dispatch('next');
  assert.equal((await f.host.reloadSnapshot(next.snapshotDir)).ok,true);
  await until(()=>p.commands.some(c=>c.type==='feedback'&&c.reload==='complete'));
  assert.equal(f.host.snapshot().controller.deckId,next.deck.id);assert.equal(f.host.snapshot().controller.index,0);
  assert.equal(f.host.snapshot().controller.slide.id,next.deck.slides[0].id);
  assert.equal((await request(f.host,imageURL(f.prepared),{headers:{cookie:p.cookie}})).status,404);
  assert.equal((await request(f.host,imageURL(next),{headers:{cookie:p.cookie}})).status,200);
  assert.deepEqual(f.host.snapshot().media,{registered:1,retained:0});
  assert.ok((await fs.stat(path.join(f.prepared.snapshotDir,'manifest.json'))).isFile(),'retirement never deletes cache/source files');
});

test('failed verification and identical immutable snapshot preserve old Auto deadline and last good deck',async t=>{
  const f=await fixture(t,{controllerOptions:{mode:'auto',intervalMs:10000}}),p=await autoProgram(t,f);
  await f.host.dispatch('launch');const deadline=f.host.snapshot().controller.nextAdvanceAt;
  const bad=await candidate(f);await fs.writeFile(path.join(bad.snapshotDir,bad.manifest.files[0].src),'bad');
  assert.deepEqual(await f.host.reloadSnapshot(bad.snapshotDir),{action:'reload',ok:false,code:'PREPARE_FAILED'});
  await until(()=>p.commands.some(c=>c.type==='feedback'&&c.reload==='failed'));
  assert.equal(f.host.snapshot().controller.deckId,f.prepared.deck.id);assert.equal(f.host.snapshot().controller.nextAdvanceAt,deadline);
  assert.equal(f.host.snapshot().controller.autoSuspended,false);
  assert.equal((await f.host.reloadSnapshot(f.prepared.snapshotDir)).ok,true);
  assert.equal(f.host.snapshot().controller.nextAdvanceAt,deadline);assert.deepEqual(f.host.snapshot().media,{registered:1,retained:0});
  assert.equal(p.commands.filter(c=>c.type==='show').length,1,'identical version does not rerender/reset playback');
});

test('a consistently rewritten different deck with the active UUID cannot replace its existing route owner',async t=>{
  const f=await fixture(t),p=await autoProgram(t,f),other=await candidate(f,['03.png']);await f.host.dispatch('launch');
  const manifest=JSON.parse(await fs.readFile(path.join(other.snapshotDir,'manifest.json'),'utf8'));manifest.id=f.prepared.deck.id;
  await fs.writeFile(path.join(other.snapshotDir,'manifest.json'),JSON.stringify(manifest));
  const sameID=path.join(path.dirname(other.snapshotDir),f.prepared.deck.id);await fs.rename(other.snapshotDir,sameID);
  assert.equal((await f.host.reloadSnapshot(sameID)).code,'SNAPSHOT_CONFLICT');
  assert.equal(f.host.snapshot().controller.deckId,f.prepared.deck.id);
  const original=await request(f.host,imageURL(f.prepared),{headers:{cookie:p.cookie}});assert.equal(original.status,200);assert.deepEqual(original.bytes,f.png);
  assert.deepEqual(f.host.snapshot().media,{registered:1,retained:0});
});

test('Stop cancels verification immediately but admission remains BUSY until the descriptor actually settles',async t=>{
  const f=await fixture(t),p=await autoProgram(t,f),next=await candidate(f);await f.host.dispatch('launch');
  const gate=blockedManifest(t,f,next.snapshotDir),reload=f.host.reloadSnapshot(next.snapshotDir);await gate.blocked;
  const stop=f.host.dispatch('stop');assert.equal((await reload).code,'CANCELLED');assert.equal((await stop).ok,true);
  assert.equal(f.host.snapshot().reload.state,'cancelling');assert.equal((await f.host.reloadSnapshot(next.snapshotDir)).code,'BUSY');
  const feedbackCount=p.commands.filter(c=>c.type==='feedback').length;
  gate.release();await until(()=>f.host.snapshot().reload.state==='idle');
  assert.equal(f.host.snapshot().controller.deckId,f.prepared.deck.id);assert.equal(f.host.snapshot().controller.state,'stopped');
  await wait(30);assert.equal(p.commands.filter(c=>c.type==='feedback').length,feedbackCount,'late canceled prepare cannot restore loading/error overlays');
  assert.equal((await f.host.reloadSnapshot(next.snapshotDir)).ok,true);assert.equal(f.host.snapshot().controller.state,'stopped');
});

test('candidate route stays retained through early cancellation until its actual orphan frame ACK settles',async t=>{
  const f=await fixture(t),next=await candidate(f),p=await autoProgram(t,f,{hold:c=>c.type==='show'&&c.src.includes(next.deck.id)});
  await f.host.dispatch('launch');const reload=f.host.reloadSnapshot(next.snapshotDir);
  await until(()=>p.commands.some(c=>c.type==='show'&&c.src.includes(next.deck.id)));
  const shown=p.commands.find(c=>c.type==='show'&&c.src.includes(next.deck.id));
  const stop=f.host.dispatch('stop');assert.equal((await reload).code,'CANCELLED');assert.equal((await stop).ok,true);
  assert.deepEqual(f.host.snapshot().media,{registered:2,retained:1});assert.equal(f.host.snapshot().reload.state,'retiring');
  assert.equal((await f.host.reloadSnapshot(next.snapshotDir)).code,'BUSY');
  assert.equal((await request(f.host,imageURL(next),{headers:{cookie:p.cookie}})).status,200);
  p.client.ack(shown,false,'CANCELED');await until(()=>f.host.snapshot().media.registered===1);
  assert.equal((await request(f.host,imageURL(next),{headers:{cookie:p.cookie}})).status,404);
  assert.equal(f.host.snapshot().controller.deckId,f.prepared.deck.id);assert.equal(f.host.snapshot().controller.state,'stopped');
});

test('failed candidate rendering retains old active routes and suspends Auto without leaking registrations',async t=>{
  const f=await fixture(t,{controllerOptions:{mode:'auto',intervalMs:10000}}),next=await candidate(f),p=await autoProgram(t,f,{hold:c=>c.type==='show'&&c.src.includes(next.deck.id)});
  await f.host.dispatch('launch');const reload=f.host.reloadSnapshot(next.snapshotDir);
  await until(()=>p.commands.some(c=>c.type==='show'&&c.src.includes(next.deck.id)));
  p.client.ack(p.commands.find(c=>c.type==='show'&&c.src.includes(next.deck.id)),false,'LOAD_FAILED');
  assert.equal((await reload).code,'RENDER_FAILED');assert.equal(f.host.snapshot().controller.deckId,f.prepared.deck.id);
  assert.equal(f.host.snapshot().controller.autoSuspended,true);assert.equal(f.host.snapshot().renderer.presentation,'frame');
  assert.equal((await request(f.host,imageURL(f.prepared),{headers:{cookie:p.cookie}})).status,200);
  assert.equal((await request(f.host,imageURL(next),{headers:{cookie:p.cookie}})).status,404);assert.equal(f.host.snapshot().media.registered,1);
});

test('prepare timeout sends current terminal feedback, preserves Auto, and fences late verification cleanup',async t=>{
  const f=await fixture(t,{prepareTimeoutMs:150,controllerOptions:{mode:'auto',intervalMs:10000}}),p=await autoProgram(t,f),next=await candidate(f);
  await f.host.dispatch('launch');const deadline=f.host.snapshot().controller.nextAdvanceAt;
  const gate=blockedManifest(t,f,next.snapshotDir),reload=f.host.reloadSnapshot(next.snapshotDir);await gate.blocked;
  await until(()=>p.commands.some(c=>c.type==='feedback'&&c.reload==='loading'));
  assert.equal((await reload).code,'PREPARE_TIMEOUT');
  await until(()=>p.commands.some(c=>c.type==='feedback'&&c.reload==='failed'));
  assert.equal(f.host.snapshot().controller.nextAdvanceAt,deadline);assert.equal(f.host.snapshot().controller.autoSuspended,false);
  gate.release();await until(()=>f.host.snapshot().reload.state==='idle');
  assert.equal(f.host.snapshot().controller.deckId,f.prepared.deck.id);assert.equal(f.host.snapshot().reload.lastError,'PREPARE_TIMEOUT');
});

test('disconnect aborts preparation and fresh program cannot inherit late candidate or feedback',async t=>{
  const f=await fixture(t),p=await autoProgram(t,f),next=await candidate(f);await f.host.dispatch('launch');
  const gate=blockedManifest(t,f,next.snapshotDir),reload=f.host.reloadSnapshot(next.snapshotDir);await gate.blocked;
  p.client.ws.terminate();assert.equal((await reload).code,'CANCELLED');await until(()=>!f.host.snapshot().renderer.connected);
  const again=await autoProgram(t,f);gate.release();await until(()=>f.host.snapshot().reload.state==='idle');await wait(30);
  assert.equal(f.host.snapshot().controller.deckId,f.prepared.deck.id);assert.equal(f.host.snapshot().controller.state,'stopped');assert.equal(again.commands.length,0);
  await f.host.dispatch('launch');assert.ok(again.commands[0].src.includes(f.prepared.deck.id));
});

test('close never waits on blocked verification and invalid Reload input does not expose private errors',async t=>{
  const f=await fixture(t),next=await candidate(f);
  for(const input of [null,{},'relative/private.png'])assert.equal((await f.host.reloadSnapshot(input)).code,'INVALID_SNAPSHOT');
  const gate=blockedManifest(t,f,next.snapshotDir),reload=f.host.reloadSnapshot(next.snapshotDir);await gate.blocked;
  const closed=f.host.close();assert.equal((await reload).code,'CANCELLED');await closed;assert.equal(f.host.snapshot().closed,true);
  assert.equal(f.host.snapshot().media.registered,0);assert.equal((await f.host.reloadSnapshot(next.snapshotDir)).code,'CLOSED');
  gate.release();await until(()=>f.host.snapshot().reload.state==='idle');
});

test('congested Reload feedback is bounded, Stop preempts it, and no late terminal label appears over black',async t=>{
  const f=await fixture(t,{controllerOptions:{mode:'manual',maxQueue:2}}),next=await candidate(f),p=await autoProgram(t,f,{hold:c=>c.type==='feedback'});
  await f.host.dispatch('launch');const reload=f.host.reloadSnapshot(next.snapshotDir);
  await until(()=>p.commands.some(c=>c.type==='feedback'&&c.reload==='loading'));
  const loading=p.commands.find(c=>c.type==='feedback');await until(()=>f.host.snapshot().reload.state==='activating');
  for(let i=0;i<100;i++)assert.equal((await f.host.reloadSnapshot(next.snapshotDir)).code,'BUSY');
  assert.equal(p.commands.filter(c=>c.type==='feedback').length,1);assert.equal(f.host.snapshot().renderer.pending,1);
  const stop=f.host.dispatch('stop');assert.equal((await reload).code,'CANCELLED');assert.equal((await stop).ok,true);
  assert.equal(f.host.snapshot().renderer.pending,1,'canceled feedback retains its real acknowledgment barrier');
  p.client.ack(loading,false,'CANCELED');await until(()=>f.host.snapshot().renderer.pending===0);await wait(30);
  assert.equal(p.commands.filter(c=>c.type==='feedback').length,1);assert.equal(f.host.snapshot().renderer.presentation,'black');
  assert.equal(f.host.snapshot().controller.state,'stopped');assert.equal(f.host.snapshot().media.registered,1);
});

test('negative mode-feedback paint acknowledgment resets the session without committing mode intent',async t=>{
  const f=await fixture(t),p=await autoProgram(t,f,{hold:c=>c.type==='feedback'});await f.host.dispatch('launch');
  const change=f.host.dispatch('auto');await until(()=>p.commands.some(c=>c.type==='feedback'));
  const command=p.commands.find(c=>c.type==='feedback');assert.equal(command.mode,'auto');
  assert.equal(f.host.snapshot().controller.mode,'manual');p.client.ack(command,false,'TRANSITION_FAILED');
  assert.equal((await change).ok,false);await until(()=>!f.host.snapshot().renderer.connected);
  assert.equal(f.host.snapshot().renderer.lastError,'FEEDBACK_UNVERIFIED');assert.equal(f.host.snapshot().renderer.presentation,'unverified');
  assert.equal(f.host.snapshot().controller.mode,'manual');assert.equal(f.host.snapshot().controller.state,'stopped');
});

test('new program epoch cancels an offline verification rather than applying its deck to a fresh renderer',async t=>{
  const f=await fixture(t),next=await candidate(f),gate=blockedManifest(t,f,next.snapshotDir);
  const reload=f.host.reloadSnapshot(next.snapshotDir);await gate.blocked;const p=await autoProgram(t,f);
  assert.equal((await reload).code,'CANCELLED');gate.release();await until(()=>f.host.snapshot().reload.state==='idle');
  assert.equal(f.host.snapshot().controller.deckId,f.prepared.deck.id);assert.equal(p.commands.length,0);
  await f.host.dispatch('launch');assert.ok(p.commands[0].src.includes(f.prepared.deck.id));
});
