'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomBytes,createHmac}=require('node:crypto');
const {fixture}=require('./fixtures/game-day-spx.cjs');
test('opt-in actual SPX serves Game Day and guarded assets; failed preparation preserves its PID, projects and native routes',{timeout:45000},async t=>{
 const f=await fixture(t),page=await f.request('/game-day');assert.equal(page.status,200);const token=/name="piraiders-csrf" content="([a-f0-9]{64})"/.exec(page.text)?.[1];assert.match(token,/^[a-f0-9]{64}$/);assert.match(page.text,/Game Day/);const cookie=page.headers['set-cookie'][0].split(';')[0];
 const events=await f.request('/game-day/api/events',{headers:{Cookie:cookie}});assert.equal(events.status,200);assert.equal(events.value.events.find(v=>v.eventId==='football').status,'available');assert.equal(events.value.events.find(v=>v.eventId==='broken').status,'invalid');assert.ok(!events.text.includes('private student'));
 const prepare=await f.request('/game-day/api/prepare',{method:'POST',headers:{Origin:f.origin,Cookie:cookie,'X-PiRaiders-CSRF':token},json:{eventId:'football',expectedEventId:null,expectedSelection:0}});assert.equal(prepare.status,422);assert.equal(prepare.value.code,'PREPARE_FAILED');assert.equal(f.child.pid,f.pid);assert.equal(f.child.exitCode,null);
 const state=await f.request('/GAME-DAY/API/STATE/');assert.equal(state.status,200);assert.equal(state.headers['access-control-allow-origin'],undefined);assert.equal(state.value.state.active,null);assert.ok(!state.text.includes(f.appRoot));
 for(const url of ['/css/piraiders-game-day.css','/js/piraiders-game-day.js']){const asset=await f.request(url);assert.equal(asset.status,200);assert.equal(asset.headers['cache-control'],'no-store');assert.equal(asset.headers['access-control-allow-origin'],undefined);}
 for(const url of ['/shows','/gc/Bench/Run','/renderer/index.html','/templates/softpix/html/Template_Pack_1.4.0/INFO_LEFT.html','/templates/softpix/ograf/Template_Pack_1.4.0/INFO_LEFT.ograf.json']){const response=await f.request(url);assert.equal(response.status,200,url);}
 assert.match((await f.request('/shows')).text,/href="\/game-day"/i,'opt-in SPX navigation links back to Game Day');
 const version=await f.request('/api/v1/version',{headers:{Origin:'https://foreign.invalid'}});assert.equal(version.status,200);assert.equal(version.headers['access-control-allow-origin'],'*');assert.equal(f.child.pid,f.pid);assert.equal(f.child.exitCode,null);
});

test('actual SPX login session authorizes Game Day while owned startup proof needs no login',{timeout:45000},async t=>{
 const f=await fixture(t,{auth:true}),nonce=randomBytes(16).toString('hex');const identity=await f.request('/game-day/internal/startup-identity',{headers:{'X-PiRaiders-Startup-Probe':nonce}});assert.equal(identity.status,200);assert.deepEqual(identity.value,{app:'piraiders',proof:createHmac('sha256',Buffer.from(f.secret,'hex')).update(nonce,'ascii').digest('hex')});assert.equal(identity.headers['set-cookie'],undefined);
 assert.equal((await f.request('/game-day')).headers.location,'/login');assert.equal((await f.request('/game-day/api/state')).status,401);const login=await f.request('/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'bench-operator',password:'fixture-password'}).toString()});assert.equal(login.status,302);const cookie=login.headers['set-cookie'][0].split(';')[0];
 const page=await f.request('/game-day',{headers:{Cookie:cookie}});assert.equal(page.status,200);assert.match(page.text,/name="piraiders-csrf"/);assert.equal((await f.request('/game-day/api/state',{headers:{Cookie:cookie}})).status,200);
 const log=await fs.readFile(path.join(f.logRoot,'access.log'),'utf8').catch(()=>'');assert.ok(!log.includes(f.secret));assert.ok(!log.includes(nonce));assert.ok(!log.includes('fixture-password'));
});

test('invalid machine initialization refuses ready proof and Game Day but leaves actual legacy SPX usable',{timeout:45000},async t=>{
 const f=await fixture(t,{badMachine:true}),probe=randomBytes(16).toString('hex');const response=await f.request('/game-day/internal/startup-identity',{headers:{'X-PiRaiders-Startup-Probe':probe}});assert.equal(response.status,503);assert.equal(response.value.code,'APP_CONFIG_INVALID');const page=await f.request('/game-day');assert.equal(page.status,503);assert.ok(!page.text.includes(f.appRoot));const shows=await f.request('/shows');assert.equal(shows.status,200);assert.match(shows.text,/href="\/game-day"/i,'enabled app mode keeps its navigation entry');assert.equal(f.child.exitCode,null);
});

test('default actual SPX startup has no Game Day routes and preserves upstream CORS/static behavior',{timeout:45000},async t=>{
 const f=await fixture(t,{appMode:false});const missing=await f.request('/game-day');assert.equal(missing.status,404);assert.equal(missing.headers['content-security-policy'],"default-src 'none'");assert.equal(missing.headers['x-frame-options'],undefined);assert.equal((await f.request('/api/v1/version',{headers:{Origin:'https://foreign.invalid'}})).headers['access-control-allow-origin'],'*');assert.equal((await f.request('/renderer/index.html')).status,200);const shows=await f.request('/shows');assert.equal(shows.status,200);assert.doesNotMatch(shows.text,/href="\/game-day"/i,'default SPX navigation unchanged');assert.equal(f.child.exitCode,null);
});


test('empty-password Game Day page redirects to existing usable SPX policy workflow without relaxing CSP',{timeout:45000},async t=>{
 const f=await fixture(t,{policy:true}),page=await f.request('/game-day');assert.equal(page.status,302);assert.equal(page.headers.location,'/');assert.match(page.headers['content-security-policy'],/script-src 'self'/);
 const policy=await f.request('/');assert.equal(policy.status,200);assert.match(policy.text,/action="\/saveauthpolicy"/);assert.equal(policy.headers['content-security-policy'],undefined,'legacy policy keeps its own upstream behavior');const api=await f.request('/game-day/api/state');assert.equal(api.status,403);assert.equal(api.value.code,'AUTH_POLICY_REQUIRED');
});
