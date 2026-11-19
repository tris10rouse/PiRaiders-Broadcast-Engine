'use strict';
// BE-006 exact approval revalidation. A saved approval record is data only:
// this module is the one place that decides whether a persisted PC
// confirmation still matches the exact machine policy, source identity,
// production window and (for cached startup) the exact cached snapshot.
// Every decision returns literal true or false and never throws.
const crypto=require('node:crypto');
const {canonicalExchangeJSON}=require('./exchange-fingerprints.cjs');
const {createExchangeApprovalStore}=require('./exchange-approval-store.cjs');
const {isGameDayMachineConfig}=require('./game-day-catalog.cjs');
const {normalizeWindow}=require('./production-window.cjs');

const POLICY_KIND='piraiders-machine-policy-v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,SHA=/^[0-9a-f]{64}$/;
function fault(code){const e=Error(code);e.code=code;return e;}
function canonical(value){try{return canonicalExchangeJSON(value);}catch{return null;}}
function sourceMachine(machine){
  if(!isGameDayMachineConfig(machine)||!machine.source||typeof machine.source!=='object')throw fault('APPROVAL_POLICY_MACHINE_INVALID');
  return machine.source;
}
// The fingerprint binds an approval to this machine's retained source policy:
// provider, feed binding, both private store identities, their directories,
// the approved canonical source spelling and the media/cache roots. Moving any
// of them (including the install folder) requires a fresh PC confirmation.
function compileMachinePolicyFingerprint(machine){
  const s=sourceMachine(machine);
  const projection={kind:POLICY_KIND,providerId:s.providerId,binding:{feedId:s.binding.feedId,epoch:s.binding.epoch},
    journalStoreId:s.journalStoreId,journalDirectory:s.journalDirectory,approvalStoreId:s.approvalStoreId,approvalDirectory:s.approvalDirectory,
    expectedCanonicalRoot:s.expectedCanonicalRoot,mediaRoot:machine.mediaRoot,cacheRoot:machine.cacheRoot};
  const text=canonical(projection);if(text===null)throw fault('APPROVAL_POLICY_MACHINE_INVALID');
  return crypto.createHash('sha256').update(text,'utf8').digest('hex');
}
function windowText(value){
  try{const w=normalizeWindow(value);return canonical({start:new Date(w.startMs).toISOString(),end:new Date(w.endMs).toISOString(),prewarmMinutes:w.prewarmMs/60000});}
  catch{return null;}
}
// Pure exact comparison of one approval snapshot against one expectation.
// expected: {policyFingerprint,providerId,binding,identityTuple,productionWindow,offline:null|{snapshotId,playbackFingerprint}}
// offline:null means online source startup; a cached startup requires the
// approval's own offline pin to equal it exactly.
function approvalMatches(approvals,expected){
  try{
    if(!Array.isArray(approvals)||!expected||typeof expected!=='object')return false;
    if(typeof expected.policyFingerprint!=='string'||!SHA.test(expected.policyFingerprint))return false;
    const binding=canonical(expected.binding),tuple=canonical(expected.identityTuple),window=windowText(expected.productionWindow);
    if(binding===null||tuple===null||window===null)return false;
    if(expected.offline!==null&&(typeof expected.offline!=='object'||!UUID.test(String(expected.offline.snapshotId))||!SHA.test(String(expected.offline.playbackFingerprint))))return false;
    const hits=approvals.filter(a=>a&&a.providerId===expected.providerId&&canonical(a.binding)===binding&&canonical(a.identityTuple)===tuple);
    if(hits.length!==1)return false;
    const a=hits[0];
    if(a.type!=='confirm'||a.confirmation!==true||a.machinePolicyFingerprint!==expected.policyFingerprint)return false;
    if(windowText(a.productionWindow)!==window)return false;
    if(expected.offline!==null&&(!a.offline||a.offline.snapshotId!==expected.offline.snapshotId||a.offline.playbackFingerprint!==expected.offline.playbackFingerprint))return false;
    return true;
  }catch{return false;}
}
function createApprovalRevalidator(options={}){
  if(!options||typeof options!=='object'||Reflect.ownKeys(options).some(k=>!['machine','store'].includes(k)))throw fault('APPROVAL_POLICY_OPTIONS_INVALID');
  const {machine,store=createExchangeApprovalStore()}=options;
  const s=sourceMachine(machine),policyFingerprint=compileMachinePolicyFingerprint(machine);
  if(!store||typeof store.open!=='function')throw fault('APPROVAL_POLICY_OPTIONS_INVALID');
  let latest=null,seen=null,rolledBack=false,closed=false,generation=0,code='APPROVAL_NOT_READ';
  function sameSource(providerId,binding){return providerId===s.providerId&&canonical(binding)===canonical(s.binding);}
  // Authority exists only between a completed, newest refresh and the next
  // refresh start. A failed, overtaken or rolled-back read grants nothing.
  async function refresh(){
    const mine=++generation;latest=null;
    if(closed||rolledBack){code=closed?'APPROVAL_POLICY_CLOSED':'APPROVAL_ROLLBACK';return false;}
    let head;try{head=await store.open(s.approvalDirectory,s.approvalStoreId);}catch{head=null;}
    if(mine!==generation||closed)return false;
    if(!head||head.ok!==true||head.storeId!==s.approvalStoreId||!Number.isSafeInteger(head.revision)||typeof head.headSha256!=='string'||!Array.isArray(head.approvals)){
      code=head&&typeof head.code==='string'?head.code:'APPROVAL_IO_FAILED';return false;}
    if(seen&&(head.revision<seen.revision||head.revision===seen.revision&&head.headSha256!==seen.headSha256)){
      // An approval history never shrinks or changes in place. Seeing that
      // means the store was replaced or restored: deny until a restart.
      rolledBack=true;code='APPROVAL_ROLLBACK';return false;}
    seen={revision:head.revision,headSha256:head.headSha256};latest=head;code=null;return true;
  }
  function decide(providerId,binding,identityTuple,productionWindow,offline){
    if(closed||rolledBack||!latest||!sameSource(providerId,binding))return false;
    return approvalMatches(latest.approvals,{policyFingerprint,providerId,binding,identityTuple,productionWindow,offline});
  }
  function startupOffline(startup){
    if(!startup||typeof startup!=='object')return undefined;
    if(startup.mode==='source')return null;
    if(startup.mode==='cached')return{snapshotId:startup.snapshotId,playbackFingerprint:startup.playbackFingerprint};
    return undefined;
  }
  // Manager hook: synchronous, passive, no I/O.
  function admitCandidate(context){
    try{
      const p=context&&context.profile,m=p&&p.media;
      if(!p||p.provider!=='exchange-v1'||!m||m.provider!=='exchange-ordered-v1')return false;
      const offline=startupOffline(m.startup);if(offline===undefined)return false;
      return decide(m.providerId,m.binding,m.identityTuple,p.productionWindow,offline)===true;
    }catch{return false;}
  }
  // Manager hook: rereads the persisted approvals, then decides.
  async function refreshAdmission(context){
    try{return (await refresh())===true&&admitCandidate(context)===true;}catch{return false;}
  }
  // Provider hook for explicit cached startup. Requires the source journal's
  // retained store identity as well as an exact offline pin.
  function authorizeOffline(context){
    try{
      if(!context||context.storeId!==s.journalStoreId)return false;
      const offline=startupOffline(context.startup);if(!offline)return false;
      return decide(context.providerId,context.binding,context.identityTuple,context.productionWindow,offline)===true;
    }catch{return false;}
  }
  function status(){return Object.freeze({scope:'exchange-approval-policy',ready:false,read:latest!==null,
    revision:latest?latest.revision:null,code:latest?null:code,rolledBack,closed});}
  function close(){closed=true;latest=null;generation++;}
  return Object.freeze({policyFingerprint,refresh,refreshAdmission,admitCandidate,authorizeOffline,status,close});
}
module.exports={compileMachinePolicyFingerprint,approvalMatches,createApprovalRevalidator,MACHINE_POLICY_KIND:POLICY_KIND};
