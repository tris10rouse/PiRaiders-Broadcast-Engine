'use strict';
// BE-006 source catalog service (slice 3b). One object, built only from a
// loader-made source machine, that owns the exchange source provider and the
// exact approval revalidator for that machine. It checks the retained
// canonical source spelling before every operation that reads the source,
// keeps catalog browsing behind its own refresh fence, and hands the manager
// and the provider the revalidator's hooks. No route, screen, approval write,
// journal setup or source write: the PC selector (backlog item 4) uses this.
const fs=require('node:fs/promises'),path=require('node:path');
const {isGameDayMachineConfig}=require('./game-day-catalog.cjs');
const {createExchangeSourceProvider}=require('./exchange-source-provider.cjs');
const {createApprovalRevalidator}=require('./exchange-approval-policy.cjs');
const {normalizePreparedEventProfile}=require('./prepared-event-profile.cjs');

const CODE=/^[A-Z][A-Z0-9_]{1,63}$/;
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

function createExchangeSourceService(machine,trusted={}){
  if(!isGameDayMachineConfig(machine)||!machine.source||typeof machine.source!=='object')throw fault('SOURCE_SERVICE_MACHINE_INVALID');
  if(!trusted||typeof trusted!=='object'||Reflect.ownKeys(trusted).some(k=>!['provider','approvalStore','realpath'].includes(k)))throw fault('SOURCE_SERVICE_OPTIONS_INVALID');
  const s=machine.source,realpath=trusted.realpath??fs.realpath;
  if(typeof realpath!=='function')throw fault('SOURCE_SERVICE_OPTIONS_INVALID');
  const revalidator=createApprovalRevalidator(trusted.approvalStore===undefined?{machine}:{machine,store:trusted.approvalStore});
  let provider;
  try{
    provider=createExchangeSourceProvider({providerId:s.providerId,sourceRoot:machine.mediaRoot,cacheDir:machine.cacheRoot,
      journalDir:s.journalDirectory,storeId:s.journalStoreId,binding:{feedId:s.binding.feedId,epoch:s.binding.epoch}},trusted.provider??{});
  }catch(error){revalidator.close();throw error;}
  let closed=false,attempt=0,browsable=false,catalogCode='CATALOG_NOT_READ';

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
    inspectSelection,preparedMedia,
    refreshApprovals:()=>revalidator.refresh(),
    // Pass these to createGameDayManager as {admitCandidate,refreshAdmission}.
    admission:Object.freeze({admitCandidate:revalidator.admitCandidate,refreshAdmission:revalidator.refreshAdmission}),
    status,close});
}
module.exports={createExchangeSourceService};
