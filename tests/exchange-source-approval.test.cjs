'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {fixture,source,profileFor,providerFor,copy}=require('./exchange-provider-fixtures.cjs');
const {createExchangeApprovalStore}=require('../scripts/lib/exchange-approval-store.cjs');
const {canonicalExchangeJSON}=require('../scripts/lib/exchange-fingerprints.cjs');
const {admitExchangeCandidate}=require('../scripts/lib/exchange-source-provider.cjs');

test('persisted exact approval data can support explicit offline policy; policy change and revoke deny new admission',async t=>{
  const f=await fixture(t),m=source();await f.publish(m);
  const staged=await f.coordinator.prepareSelection(m.identityTuple);assert.equal(staged.ok,true);
  const profile=profileFor(f,m);profile.media.startup={mode:'cached',snapshotId:path.basename(staged.prepared.snapshotDir),playbackFingerprint:m.playbackFingerprint};
  const directory=path.join(f.parent,'approvals'),storeId=crypto.randomUUID(),store=createExchangeApprovalStore();
  let head=await store.initialize(directory,storeId);assert.equal(head.ok,true);
  const approvedPolicy='a'.repeat(64),approval={type:'confirm',providerId:'approved-feed',machinePolicyFingerprint:approvedPolicy,
    binding:copy(f.config.binding),identityTuple:[...m.identityTuple],productionWindow:copy(profile.productionWindow),
    offline:{snapshotId:profile.media.startup.snapshotId,playbackFingerprint:m.playbackFingerprint},confirmation:true};
  head=await store.append(directory,{expectedStoreId:storeId,expectedRevision:head.revision,expectedHeadSha256:head.headSha256,approval});assert.equal(head.ok,true);
  // Simulate application reopen. Persistence is data only: this explicit trusted
  // test callback performs matching; the store does not grant runtime authority.
  let effective=await createExchangeApprovalStore().open(directory,storeId),policy=approvedPolicy;
  assert.equal(effective.ok,true);assert.equal(effective.ready,false);
  await fs.rename(f.config.sourceRoot,path.join(f.parent,'disconnected-source'));
  let coordinatorCalls=0;
  const provider=providerFor(t,f,{createCoordinator:()=>{coordinatorCalls++;throw Error('OFFLINE_SOURCE_FORBIDDEN');}});
  const authorizeOffline=context=>effective.ok&&effective.approvals.some(record=>record.providerId===context.providerId&&
    record.machinePolicyFingerprint===policy&&canonicalExchangeJSON(record.binding)===canonicalExchangeJSON(context.binding)&&
    canonicalExchangeJSON(record.identityTuple)===canonicalExchangeJSON(context.identityTuple)&&
    canonicalExchangeJSON(record.productionWindow)===canonicalExchangeJSON(context.productionWindow)&&
    record.offline?.snapshotId===context.startup.snapshotId&&record.offline?.playbackFingerprint===context.startup.playbackFingerprint);
  const driver=provider.createPreparedMedia(profile,{authorizeOffline});const prepared=await driver.initial(),token=driver.admissionToken();
  assert.equal(prepared.snapshotDir,staged.prepared.snapshotDir);assert.equal(admitExchangeCandidate(token,profile),true);
  policy='b'.repeat(64);assert.equal(admitExchangeCandidate(token,profile),false);
  policy=approvedPolicy;assert.equal(admitExchangeCandidate(token,profile),true);
  const revoke={type:'revoke',providerId:approval.providerId,binding:approval.binding,identityTuple:approval.identityTuple,confirmation:true};
  head=await store.append(directory,{expectedStoreId:storeId,expectedRevision:head.revision,expectedHeadSha256:head.headSha256,approval:revoke});assert.equal(head.ok,true);
  effective=await createExchangeApprovalStore().open(directory,storeId);assert.deepEqual(effective.approvals,[]);
  assert.equal(admitExchangeCandidate(token,profile),false);
  await assert.rejects(provider.createPreparedMedia(profile,{authorizeOffline}).initial(),{code:'OFFLINE_AUTHORIZATION_REQUIRED'});
  assert.equal(coordinatorCalls,0);assert.deepEqual(profile.productionWindow,approval.productionWindow);
  assert.equal((await fs.stat(prepared.snapshotDir)).isDirectory(),true);
});
