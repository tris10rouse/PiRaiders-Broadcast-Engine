'use strict';
// BE-006 source catalog service (slice 3b). One object, built only from a
// loader-made source machine, that owns the exchange source provider and the
// exact approval revalidator for that machine. It checks the retained
// canonical source spelling before every operation that reads the source,
// keeps catalog browsing behind its own refresh fence, and hands the manager
// and the provider the revalidator's hooks. Item 4c adds the PC confirmation:
// review (inspection plus the saved approval), confirm and revoke, written to
// this machine's approval store. No journal setup, store setup or source write.
const fs=require('node:fs/promises'),path=require('node:path');
const {isGameDayMachineConfig}=require('./game-day-catalog.cjs');
const {createExchangeSourceProvider}=require('./exchange-source-provider.cjs');
const {createApprovalRevalidator}=require('./exchange-approval-policy.cjs');
const {normalizePreparedEventProfile}=require('./prepared-event-profile.cjs');
const {createExchangeApprovalStore}=require('./exchange-approval-store.cjs');
const {canonicalExchangeJSON}=require('./exchange-fingerprints.cjs');
const {normalizeWindow}=require('./production-window.cjs');

const CODE=/^[A-Z][A-Z0-9_]{1,63}$/,SHA=/^[a-f0-9]{64}$/;
function fault(code){const e=Error(code);e.code=code;return e;}
function codeOf(error){return error&&typeof error.code==='string'&&CODE.test(error.code)?error.code:'SOURCE_SERVICE_FAILED';}
function denied(code){return Object.freeze({ok:false,ready:false,code});}
function comparable(value){const resolved=path.resolve(value);return process.platform==='win32'?resolved.toLowerCase():resolved;}
function plainOptions(value,allowed){
  if(value===undefined)return{};
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return null;
  const d=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(d).some(k=>typeof k!=='string'||!allowed.includes(k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))return null;
  if(d.signal&&d.signal.value!==undefined&&!(d.signal.value instanceof AbortSignal))return null;
  return d.signal&&d.signal.value!==undefined?{signal:d.signal.value}:{};
}
// Exact plain request objects for the confirmation writes: own enumerable
// data properties, exactly the listed keys.
function plainRequest(value,keys){
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
  const d=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(d);
  return names.length===keys.length&&names.every(k=>typeof k==='string'&&keys.includes(k)&&Object.hasOwn(d[k],'value')&&d[k].enumerable);
}
function canonical(value){try{return canonicalExchangeJSON(value);}catch{return null;}}
// A copy of a five-string identity tuple; the provider and the store apply
// the real tuple rules.
function ownTuple(value){
  if(!Array.isArray(value)||value.length!==5)return null;
  const copy=[];for(let i=0;i<5;i++){if(!Object.hasOwn(value,i)||typeof value[i]!=='string')return null;copy.push(value[i]);}
  return copy;
}
// The confirmed production window in the store's normal form, or null.
function confirmedWindow(value){
  if(!plainRequest(value,['start','end','prewarmMinutes'])&&!plainRequest(value,['start','end']))return null;
  try{const w=normalizeWindow({start:value.start,end:value.end,prewarmMinutes:value.prewarmMinutes});
    return{start:new Date(w.startMs).toISOString(),end:new Date(w.endMs).toISOString(),prewarmMinutes:w.prewarmMs/60000};}catch{return null;}
}

function createExchangeSourceService(machine,trusted={}){
  if(!isGameDayMachineConfig(machine)||!machine.source||typeof machine.source!=='object')throw fault('SOURCE_SERVICE_MACHINE_INVALID');
  if(!trusted||typeof trusted!=='object'||Reflect.ownKeys(trusted).some(k=>!['provider','approvalStore','realpath'].includes(k)))throw fault('SOURCE_SERVICE_OPTIONS_INVALID');
  const s=machine.source,realpath=trusted.realpath??fs.realpath;
  if(typeof realpath!=='function')throw fault('SOURCE_SERVICE_OPTIONS_INVALID');
  // One store object reads for the revalidator and writes PC confirmations.
  const store=trusted.approvalStore===undefined?createExchangeApprovalStore():trusted.approvalStore;
  const revalidator=createApprovalRevalidator({machine,store});
  let provider;
  try{
    provider=createExchangeSourceProvider({providerId:s.providerId,sourceRoot:machine.mediaRoot,cacheDir:machine.cacheRoot,
      journalDir:s.journalDirectory,storeId:s.journalStoreId,binding:{feedId:s.binding.feedId,epoch:s.binding.epoch}},trusted.provider??{});
  }catch(error){revalidator.close();throw error;}
  let closed=false,attempt=0,browsable=false,catalogCode='CATALOG_NOT_READ',writing=false;

  // The configured media root may be an alias, but what it resolves to now
  // must be the canonical spelling retained in machine policy. The loader
  // already keeps that spelling apart from every private root, so a match
  // also proves the live source is not one of them. Checked per operation:
  // a remounted or redirected folder is caught on the next read.
  async function sourceRootCode(){
    let actual;try{actual=await realpath(machine.mediaRoot);}catch{return'SOURCE_UNAVAILABLE';}
    if(typeof actual!=='string'||!path.isAbsolute(actual))return'SOURCE_UNAVAILABLE';
    return comparable(actual)===comparable(s.expectedCanonicalRoot)?null:'SOURCE_ROOT_MISMATCH';
  }

  // Browsing authority exists only after this service's newest refresh
  // completed with a matching source root and a provider catalog. Entry to a
  // refresh withdraws it; any failure or newer attempt leaves it withdrawn.
  async function refreshCatalog(options){
    const mine=++attempt;browsable=false;
    if(closed)return denied('SOURCE_SERVICE_CLOSED');
    const opts=plainOptions(options,['signal']);
    if(!opts){catalogCode='SOURCE_SERVICE_OPTIONS_INVALID';return denied(catalogCode);}
    const rootCode=await sourceRootCode();
    if(closed)return denied('SOURCE_SERVICE_CLOSED');
    if(mine!==attempt)return denied('CATALOG_REFRESH_SUPERSEDED');
    if(rootCode){catalogCode=rootCode;return denied(rootCode);}
    let value;
    try{value=await provider.refreshCatalog(opts);}
    catch(error){if(mine===attempt&&!closed)catalogCode=codeOf(error);return denied(closed?'SOURCE_SERVICE_CLOSED':mine!==attempt?'CATALOG_REFRESH_SUPERSEDED':codeOf(error));}
    if(closed)return denied('SOURCE_SERVICE_CLOSED');
    if(mine!==attempt)return denied('CATALOG_REFRESH_SUPERSEDED');
    browsable=true;catalogCode=null;
    return Object.freeze({ok:true,ready:false,catalogSequence:value.catalogSequence,catalog:value.catalog});
  }
  function browse(method,query){
    if(closed)return denied('SOURCE_SERVICE_CLOSED');
    if(!browsable)return denied('CATALOG_UNAVAILABLE');
    try{return provider[method](query);}catch(error){return denied(codeOf(error));}
  }
  function catalogState(){
    if(closed||!browsable)return Object.freeze({available:false,catalog:null});
    return provider.catalogState();
  }
  // Metadata only: the selected manifest and timing gate, never assets. An
  // inspection is review data for the PC confirmation, not an approval.
  async function inspectSelection(tuple,options){
    if(closed)return denied('SOURCE_SERVICE_CLOSED');
    const opts=plainOptions(options,['signal']);if(!opts)return denied('SOURCE_SERVICE_OPTIONS_INVALID');
    const rootCode=await sourceRootCode();
    if(closed)return denied('SOURCE_SERVICE_CLOSED');
    if(rootCode)return denied(rootCode);
    try{return await provider.inspectSelection(tuple,opts);}catch(error){return denied(closed?'SOURCE_SERVICE_CLOSED':codeOf(error));}
  }
  // PC confirmation (backlog item 4c). The store holds data only; the
  // revalidator stays the one place that decides admission. Every answer is
  // path-free and carries codes, never store or source paths.
  function recordFor(approvals,tuple){
    const binding=canonical(s.binding),key=canonical(tuple);
    return approvals.find(a=>a&&a.providerId===s.providerId&&canonical(a.binding)===binding&&canonical(a.identityTuple)===key)||null;
  }
  function describe(record){
    if(!record||record.type!=='confirm')return null;
    return Object.freeze({productionWindow:Object.freeze({...record.productionWindow}),
      // An approval saved under another machine policy (moved folders, new
      // store or feed) no longer admits anything; the screen says so.
      current:record.machinePolicyFingerprint===revalidator.policyFingerprint,offlinePinned:record.offline!==null});
  }
  async function openStore(){
    let head;try{head=await store.open(s.approvalDirectory,s.approvalStoreId);}catch{head=null;}
    if(!head||head.ok!==true||!Array.isArray(head.approvals)||!Number.isSafeInteger(head.revision)||typeof head.headSha256!=='string')
      return{ok:false,code:head&&typeof head.code==='string'&&CODE.test(head.code)?head.code:'APPROVAL_IO_FAILED'};
    return head;
  }
  async function approvalState(tuple){
    const head=await openStore();
    if(!head.ok)return Object.freeze({read:false,code:head.code,record:null});
    return Object.freeze({read:true,code:null,revision:head.revision,record:describe(recordFor(head.approvals,tuple))});
  }
  // Review data for the confirmation screen: a fresh metadata inspection and
  // what the store says now. It approves nothing.
  async function reviewSelection(tuple,options){
    if(closed)return denied('SOURCE_SERVICE_CLOSED');
    const owned=ownTuple(tuple);if(!owned)return denied('SOURCE_SELECTION_INVALID');
    const inspected=await inspectSelection(owned,options);
    if(closed)return denied('SOURCE_SERVICE_CLOSED');
    if(!inspected||inspected.ok!==true||!inspected.inspection)return denied(inspected&&typeof inspected.code==='string'?inspected.code:'SOURCE_SERVICE_FAILED');
    const approval=await approvalState(owned);
    if(closed)return denied('SOURCE_SERVICE_CLOSED');
    return Object.freeze({ok:true,ready:false,admissionEligible:inspected.admissionEligible===true,inspection:inspected.inspection,approval});
  }
  // One write at a time per service. The store's own expected revision and
  // head make a concurrent writer elsewhere an APPROVAL_CONFLICT. After any
  // attempt the revalidator rereads, so a revocation withdraws admission at
  // once and nothing admits from a read older than this write.
  async function write(approval,tuple){
    const head=await openStore();
    if(closed)return denied('SOURCE_SERVICE_CLOSED');
    if(!head.ok)return denied(head.code);
    let next;
    try{next=await store.append(s.approvalDirectory,{expectedStoreId:s.approvalStoreId,expectedRevision:head.revision,expectedHeadSha256:head.headSha256,approval});}
    catch{next=null;}
    await revalidator.refresh();
    if(!next||next.ok!==true||!Array.isArray(next.approvals))return denied(next&&typeof next.code==='string'&&CODE.test(next.code)?next.code:'APPROVAL_IO_FAILED');
    return Object.freeze({ok:true,ready:false,changed:next.changed===true,revision:next.revision,approval:describe(recordFor(next.approvals,tuple))});
  }
  async function exclusive(operation){
    if(closed)return denied('SOURCE_SERVICE_CLOSED');
    if(writing)return denied('BUSY');
    writing=true;try{return await operation();}catch{return denied('SOURCE_SERVICE_FAILED');}finally{writing=false;}
  }
  // Confirm: the operator saw one inspection (its revision) and chose one
  // production window. The selection is inspected again here; a changed
  // generation, an ineligible event or an unreachable source writes nothing.
  // Online confirmations only (offline:null); a cached-startup pin is later work.
  function confirmSelection(request){
    if(closed)return Promise.resolve(denied('SOURCE_SERVICE_CLOSED'));
    if(!plainRequest(request,['identityTuple','inspectionRevision','productionWindow']))return Promise.resolve(denied('APPROVAL_REQUEST_INVALID'));
    const tuple=ownTuple(request.identityTuple),revision=request.inspectionRevision,window=confirmedWindow(request.productionWindow);
    if(!tuple||typeof revision!=='string'||!SHA.test(revision))return Promise.resolve(denied('APPROVAL_REQUEST_INVALID'));
    if(!window)return Promise.resolve(denied('APPROVAL_WINDOW_INVALID'));
    return exclusive(async()=>{
      const inspected=await inspectSelection(tuple);
      if(closed)return denied('SOURCE_SERVICE_CLOSED');
      if(!inspected||inspected.ok!==true||!inspected.inspection)return denied(inspected&&typeof inspected.code==='string'?inspected.code:'SOURCE_SERVICE_FAILED');
      if(inspected.inspection.revision!==revision)return denied('APPROVAL_INSPECTION_STALE');
      if(inspected.admissionEligible!==true)return denied('APPROVAL_SELECTION_INELIGIBLE');
      return write({type:'confirm',providerId:s.providerId,binding:{feedId:s.binding.feedId,epoch:s.binding.epoch},identityTuple:tuple,
        confirmation:true,machinePolicyFingerprint:revalidator.policyFingerprint,productionWindow:window,offline:null},tuple);
    });
  }
  // Revoke never reads the source: it works with the exchange folder gone.
  function revokeSelection(request){
    if(closed)return Promise.resolve(denied('SOURCE_SERVICE_CLOSED'));
    if(!plainRequest(request,['identityTuple']))return Promise.resolve(denied('APPROVAL_REQUEST_INVALID'));
    const tuple=ownTuple(request.identityTuple);if(!tuple)return Promise.resolve(denied('APPROVAL_REQUEST_INVALID'));
    return exclusive(()=>write({type:'revoke',providerId:s.providerId,binding:{feedId:s.binding.feedId,epoch:s.binding.epoch},identityTuple:tuple,confirmation:true},tuple));
  }
  // The branded prepared-media driver for one exact exchange profile, with
  // this machine's offline authorizer. Online startup checks the source root
  // first. Cached startup never contacts the source: it rereads the approval
  // store so the offline decision is from a completed, current read.
  async function preparedMedia(rawProfile){
    if(closed)throw fault('SOURCE_SERVICE_CLOSED');
    let profile;try{profile=normalizePreparedEventProfile(rawProfile);}catch{throw fault('SOURCE_SERVICE_PROFILE_INVALID');}
    if(profile.provider!=='exchange-v1')throw fault('SOURCE_SERVICE_PROFILE_INVALID');
    if(profile.media.startup.mode==='cached')await revalidator.refresh();
    else{const rootCode=await sourceRootCode();if(rootCode)throw fault(rootCode);}
    if(closed)throw fault('SOURCE_SERVICE_CLOSED');
    return provider.createPreparedMedia(profile,{authorizeOffline:revalidator.authorizeOffline});
  }
  function status(){
    const p=provider.snapshot(),a=revalidator.status();
    return Object.freeze({scope:'exchange-source-service',ready:false,providerId:s.providerId,closed,
      catalog:Object.freeze({available:!closed&&browsable,code:closed?'SOURCE_SERVICE_CLOSED':browsable?null:catalogCode}),
      provider:Object.freeze({busy:p.busy,closed:p.closed,observationRevision:p.observationRevision}),
      approvals:Object.freeze({read:a.read,revision:a.revision,code:a.code,rolledBack:a.rolledBack,closed:a.closed})});
  }
  function close(){if(closed)return;closed=true;browsable=false;attempt++;revalidator.close();provider.close();}
  return Object.freeze({
    policyFingerprint:revalidator.policyFingerprint,
    refreshCatalog,catalogState,
    catalogEventsPage:query=>browse('catalogEventsPage',query),
    catalogSelectionsPage:query=>browse('catalogSelectionsPage',query),
    inspectSelection,reviewSelection,confirmSelection,revokeSelection,preparedMedia,
    refreshApprovals:()=>revalidator.refresh(),
    // Pass these to createGameDayManager as {admitCandidate,refreshAdmission}.
    admission:Object.freeze({admitCandidate:revalidator.admitCandidate,refreshAdmission:revalidator.refreshAdmission}),
    status,close});
}
module.exports={createExchangeSourceService};
