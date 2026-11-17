'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {fixture,source,profileFor,providerFor,latch,until,copy}=require('./exchange-provider-fixtures.cjs');
const {createExchangeApprovalStore}=require('../scripts/lib/exchange-approval-store.cjs');
const {canonicalExchangeJSON}=require('../scripts/lib/exchange-fingerprints.cjs');
const {createGameDayManager}=require('../scripts/lib/game-day-manager.cjs');
const BASE=Date.parse('2026-11-17T12:00:00Z');
async function setup(t,{holdStart=false}={}){
  const f=await fixture(t),m=source();await f.publish(m);const profile=profileFor(f,m),provider=providerFor(t,f);
  const directory=path.join(f.parent,'approvals'),storeId=crypto.randomUUID(),store=createExchangeApprovalStore(),fingerprint='a'.repeat(64);
  let head=await store.initialize(directory,storeId);assert.equal(head.ok,true);
  const confirm={type:'confirm',providerId:'approved-feed',machinePolicyFingerprint:fingerprint,binding:copy(f.config.binding),
    identityTuple:[...m.identityTuple],productionWindow:copy(profile.productionWindow),offline:null,confirmation:true};
  head=await store.append(directory,{expectedStoreId:storeId,expectedRevision:head.revision,expectedHeadSha256:head.headSha256,approval:confirm});assert.equal(head.ok,true);
  const held=latch(),state={starts:0,closes:0,opens:0,actions:[],prepared:null};let latest=null;
  function allowed(context){return latest?.ok===true&&latest.approvals.some(a=>a.providerId===context.profile.media.providerId&&
    a.machinePolicyFingerprint===fingerprint&&canonicalExchangeJSON(a.binding)===canonicalExchangeJSON(context.profile.media.binding)&&
    canonicalExchangeJSON(a.identityTuple)===canonicalExchangeJSON(context.profile.media.identityTuple)&&
    canonicalExchangeJSON(a.productionWindow)===canonicalExchangeJSON(context.profile.productionWindow));}
  const manager=createGameDayManager({clock:()=>BASE,catalog:{list:async()=>[],read:async()=>Object.freeze({profile,
    descriptor:Object.freeze({eventId:profile.eventId,displayName:'Persisted synthetic approval'}),revision:'b'.repeat(64)})},
    refreshAdmission:async context=>{state.opens++;latest=await store.open(directory,storeId);return allowed(context);},admitCandidate:allowed,
    runtimeFactory:async normalized=>{const driver=provider.createPreparedMedia(normalized);state.prepared=await driver.initial();return{
      candidateAdmissionToken:()=>driver.admissionToken(),start:async()=>{state.starts++;if(holdStart)await held.promise;},
      close:async()=>{state.closes++;driver.close();},snapshot:()=>({preparing:false,state:'prepared',ready:false,windowAllowed:false}),
      dispatch:async action=>{state.actions.push(action);return{ok:true};}};}});
  t.after(async()=>{held.release();await manager.close();});
  const request=extra=>{const s=manager.snapshot();return{expectedEventId:s.expectedEventId,expectedSelection:s.expectedSelection,...extra};};
  return{...f,m,profile,directory,storeId,store,head,manager,request,state,held};
}
test('real persisted revocation during awaited start is reread before active acknowledgement',async t=>{
  const f=await setup(t,{holdStart:true}),prepared=await f.manager.prepare(f.profile.eventId,f.request());assert.equal(prepared.ok,true);
  const pending=f.manager.activate(f.request({candidateId:prepared.candidateId}));await until(()=>f.state.starts===1);
  const revoked=await f.store.append(f.directory,{expectedStoreId:f.storeId,expectedRevision:f.head.revision,expectedHeadSha256:f.head.headSha256,
    approval:{type:'revoke',providerId:'approved-feed',binding:copy(f.config.binding),identityTuple:[...f.m.identityTuple],confirmation:true}});assert.equal(revoked.ok,true);
  f.held.release();const outcome=await pending;assert.equal(outcome.code,'ADMISSION_DENIED');assert.equal(outcome.ok,false);
  assert.equal(f.state.closes,1);assert.ok(f.state.opens>=4);assert.equal(f.manager.snapshot().active,null);assert.equal(f.manager.snapshot().candidate,null);
  assert.equal((await fs.stat(f.state.prepared.snapshotDir)).isDirectory(),true,'revocation does not delete verified cached content');
});
test('active playback and priority Stop do not consult a later unavailable approval store',async t=>{
  const f=await setup(t),prepared=await f.manager.prepare(f.profile.eventId,f.request());assert.equal(prepared.ok,true);
  assert.equal((await f.manager.activate(f.request({candidateId:prepared.candidateId}))).ok,true);
  const before=f.manager.snapshot().active.productionWindow,opens=f.state.opens;
  await fs.rename(f.directory,path.join(f.parent,'unavailable-approvals'));
  assert.equal((await f.manager.dispatch('next',f.request())).ok,true);assert.equal((await f.manager.dispatch('stop',f.request())).ok,true);
  assert.deepEqual(f.state.actions,['next','stop']);assert.equal(f.state.opens,opens);assert.deepEqual(f.manager.snapshot().active.productionWindow,before);
});
