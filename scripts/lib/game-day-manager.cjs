'use strict';
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { types: { isPromise } } = require('node:util');
const { normalizePreparedEventProfile } = require('./prepared-event-profile.cjs');
const { normalizeWindow, senderAllowed } = require('./production-window.cjs');
const { createPreparedEventRuntime } = require('./prepared-event-runtime.cjs');
const ACTIONS = new Set(['launch','next','previous','toggle-auto','auto','manual','reload','stop']);
const EVENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CANDIDATE = /^[a-f0-9]{48}$/;
const RUNTIME_ERRORS = new Set(['SERVICE_FAULT','RESOLVER_FAILED','RESOLVER_TIMEOUT','CONTROL_INHIBITED','CLOSED','CANCELLED','NOT_READY','BUSY','HANDLER_FAILED','HANDLER_TIMEOUT','CONSOLE_FAULT','EVENT_BOOTSTRAP_FAILED','EVENT_START_FAILED','EVENT_CLOSE_FAILED','SESSION_CLOSE_FAILED','STATE_UNAVAILABLE','CONSOLE_CLOSE_FAILED','CLOSE_FAILED','RENDER_FAILED','RENDER_TIMEOUT','PREPARE_FAILED','PREPARE_TIMEOUT','INVALID_SNAPSHOT','STALE_SESSION','NOT_PLAYING','FAULTED','PRESENTATION_FAILED','TRANSPORT_FAULT','LISTENER_FAILED','SEQUENCE_LIMIT','ADMISSION_DENIED']);
function fault(code) { return Object.assign(Error(code), { code }); }
function plain(value) { return value !== null && typeof value === 'object' && [Object.prototype,null].includes(Object.getPrototypeOf(value)); }
function record(value, keys) {
  if (!plain(value) || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value,key))) return false;
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key) &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value') && Object.getOwnPropertyDescriptor(value,key).enumerable);
}
function eventId(value) { return typeof value === 'string' && value.length <= 64 && EVENT.test(value); }
function descriptor(raw,{source=false}={}) {
  if (!record(raw,['eventId','displayName']) || !eventId(raw.eventId) || typeof raw.displayName !== 'string' ||
      !raw.displayName.trim() || (source ? raw.displayName.length > 400 || Array.from(raw.displayName).length > 200 : raw.displayName.length > 128) || /[\x00-\x1f\x7f]/.test(raw.displayName)) throw fault('CATALOG_INVALID');
  return Object.freeze({eventId:raw.eventId,displayName:raw.displayName});
}
function listDescriptor(raw) {
  if(record(raw,['eventId','displayName','status']) && raw.status==='available') {
    return Object.freeze({...descriptor({eventId:raw.eventId,displayName:raw.displayName}),status:'available'});
  }
  if(record(raw,['eventId','displayName','status','code']) && raw.status==='invalid' && raw.code==='CATALOG_INVALID' &&
      (raw.eventId===null||eventId(raw.eventId)) && raw.displayName==='Unavailable event') {
    return Object.freeze({eventId:raw.eventId,displayName:'Unavailable event',status:'invalid',code:'CATALOG_INVALID'});
  }
  throw fault('CATALOG_INVALID');
}
function absolute(value) { return typeof value==='string' && !!value && value.length<=4096 && !/[\x00-\x1f\x7f]/.test(value) && path.isAbsolute(value); }
function privateBoundaries(raw,sourceRoot) {
  if(!Array.isArray(raw)||Object.getPrototypeOf(raw)!==Array.prototype||raw.length>3||Reflect.ownKeys(raw).length!==raw.length+1||
      (raw.length>0&&sourceRoot===undefined))throw fault('MANAGER_OPTIONS_INVALID');
  const values=[];
  for(let index=0;index<raw.length;index++){
    const item=Object.getOwnPropertyDescriptor(raw,String(index));
    if(!item||!Object.hasOwn(item,'value')||!item.enumerable||!absolute(item.value))throw fault('MANAGER_OPTIONS_INVALID');
    values.push(item.value);
  }
  return Object.freeze(values);
}
function result(ok, code, extra) { return Object.freeze({ok,...(code ? {code} : {}),...extra}); }
function expected(raw, candidate = false) {
  return record(raw,['expectedEventId','expectedSelection',...(candidate ? ['candidateId'] : [])]) &&
    (raw.expectedEventId === null || eventId(raw.expectedEventId)) && Number.isSafeInteger(raw.expectedSelection) && raw.expectedSelection >= 0 &&
    (!candidate || (typeof raw.candidateId === 'string' && CANDIDATE.test(raw.candidateId)));
}

/** Trusted Node orchestration only. Catalog/filesystem/HTTP permissions are separate boundaries.
 * One application-owned SPX outlives these sender-only event runtimes.
 */
function createGameDayManager(options = {}) {
  if(!plain(options) || Reflect.ownKeys(options).some(key=>typeof key!=='string' || !['catalog','runtimeFactory','clock','sourceRoot','privateRoots','admitCandidate','refreshAdmission'].includes(key) ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(options,key),'value') || !Object.getOwnPropertyDescriptor(options,key).enumerable)) throw fault('MANAGER_OPTIONS_INVALID');
  const {catalog,runtimeFactory=createPreparedEventRuntime,clock=Date.now,sourceRoot,privateRoots:rawPrivateRoots=[],admitCandidate,refreshAdmission}=options;
  if((admitCandidate!==undefined&&typeof admitCandidate!=='function')||(refreshAdmission!==undefined&&typeof refreshAdmission!=='function'))throw fault('MANAGER_OPTIONS_INVALID');
  if(sourceRoot!==undefined && !absolute(sourceRoot)) throw fault('MANAGER_OPTIONS_INVALID');
  const privateRoots=privateBoundaries(rawPrivateRoots,sourceRoot);
  if (!catalog || typeof catalog.list !== 'function' || typeof catalog.read !== 'function' || typeof runtimeFactory !== 'function' || typeof clock !== 'function') throw fault('MANAGER_OPTIONS_INVALID');
  let selection=0, active=null, candidate=null, operation=null, flight=null, inventory=null, admissionFlight=null, closed=false, closing=false, closePromise=null, lastError=null;
  const records = new Set();
  const activeId = () => active?.descriptor.eventId || null;
  function candidateContext(record) { return Object.freeze({profile:record.profile,descriptor:record.descriptor,
    revision:record.revision,admissionToken:record.admissionToken}); }
  async function refreshedCandidate(record,token) {
    if(!fresh(token))return false;
    const held={record,token};admissionFlight=held;
    let decision;
    try { decision=await refreshAdmission(candidateContext(record)); }
    catch { return false; }
    finally { if(admissionFlight===held)admissionFlight=null; }
    // The caller must run passive admission AFTER awaiting this helper: a queued
    // microtask can invalidate an owner before the caller continuation resumes.
    return fresh(token)&&decision===true;
  }
  function candidatePermitted(record) {
    try {
      if(record.profile.provider==='exchange-v1') {
        const {admitExchangeCandidate}=require('./exchange-source-provider.cjs');
        if(admitExchangeCandidate(record.admissionToken,record.profile)!==true)return false;
      }
      if(admitCandidate===undefined)return true;
      const decision=admitCandidate(candidateContext(record));
      // Consume native/cross-realm rejected Promises without assimilating an
      // arbitrary truthy thenable. Only literal synchronous true authorizes.
      if(isPromise(decision))void Promise.prototype.then.call(decision,undefined,()=>{});
      if(decision!==true)return false;
      // Optional policy may synchronously invalidate the mandatory source owner.
      return record.profile.provider!=='exchange-v1'||require('./exchange-source-provider.cjs').admitExchangeCandidate(record.admissionToken,record.profile)===true;
    } catch {return false;}
  }
  function matches(raw) { return raw.expectedSelection === selection && raw.expectedEventId === activeId(); }
  function status(record) {
    try { const value=record.runtime.snapshot(); if (!plain(value) || typeof value.preparing !== 'boolean') throw fault('STATE_UNAVAILABLE'); return value; }
    catch { return null; }
  }
  function physicalBarrier() {
    let blocked=admissionFlight!==null;
    for (const record of records) {
      const value=status(record);
      if (!value || value.preparing) blocked=true;
      else if (record.closeState==='closed' && record!==active && record!==candidate) records.delete(record);
    }
    return blocked;
  }
  function policy() {
    let now; try { now=clock(); } catch { return 'CLOCK_INVALID'; }
    if (!Number.isFinite(now)) return 'CLOCK_INVALID';
    return active && senderAllowed(active.window,now) ? 'WINDOW_ACTIVE' : null;
  }
  function admission(raw,{withCandidate=false,window=false,physical=false}={}) {
    if (!expected(raw,withCandidate)) return 'INVALID_REQUEST';
    if (closed) return 'CLOSED';
    if (!matches(raw)) return 'STALE_SELECTION';
    if (operation || flight) return 'BUSY';
    if (withCandidate && (!candidate || candidate.id!==raw.candidateId)) return 'STALE_CANDIDATE';
    if (physical && physicalBarrier()) return 'BUSY';
    const currentPolicy=window ? policy() : null;
    // Snapshot/clock dependencies are trusted code but may synchronously reenter.
    if(closed)return 'CLOSED';
    if(!matches(raw))return 'STALE_SELECTION';
    if(operation||flight)return 'BUSY';
    if(withCandidate&&(!candidate||candidate.id!==raw.candidateId))return 'STALE_CANDIDATE';
    return currentPolicy;
  }
  function settle(token,value) {
    if (token.settled) return;
    token.settled=true;token.resolve(value);token.resolve=null;
  }
  function fresh(token) { return !closed && token.selection===selection && operation===token; }
  function reserve(kind,work,{preparing=false}={}) {
    let resolve;
    const promise=new Promise(done=>{resolve=done;});
    const token={kind,selection,promise,resolve,settled:false};operation=token;
    if (preparing) flight=token;
    const complete=value=>{if(operation===token)operation=null;if(flight===token)flight=null;settle(token,value);};
    void Promise.resolve().then(()=>work(token)).then(complete,()=>{
      if (fresh(token)) lastError='OPERATION_FAILED';
      complete(result(false,closed?'CLOSED':'OPERATION_FAILED'));
    });
    return promise;
  }
  function closeRecord(record) {
    if (record.closePromise) return record.closePromise;
    let resolve,reject;
    const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});record.closePromise=pending;record.closeState='closing';
    // Reserve ownership before trusted runtime callbacks can reenter close().
    let stopping;try { stopping=record.runtime.close(); } catch { stopping=Promise.reject(fault('CLOSE_FAILED')); }
    void Promise.resolve(stopping).then(()=>{record.closeState='closed';resolve();},()=>{
      record.closeState='failed';record.closePromise=null;lastError='CLOSE_FAILED';
      if(closed&&!closing)closePromise=null;
      reject(fault('CLOSE_FAILED'));
    });
    return pending;
  }
  async function cleanupRetiredFailures() {
    for(const value of records) if(value!==active && value!==candidate && value.closeState==='failed') await closeRecord(value);
    physicalBarrier();
  }
  function publicRecord(record,{candidateRecord=false}={}) {
    if (!record) return null;
    const value=status(record);
    const runtime=value ? Object.freeze({state:['prepared','waiting','starting','ready','closing','closed'].includes(value.state)?value.state:'unknown',
      ready:value.ready===true,windowAllowed:value.windowAllowed===true,preparing:value.preparing,output:record.profile.output.type,slideCount:Number.isSafeInteger(value.slideCount)&&value.slideCount>=1&&value.slideCount<=500?value.slideCount:null,sourceName:record.profile.output.type==='ndi'?record.profile.output.name:null,
      mode:['auto','manual'].includes(value.mode)?value.mode:null,index:Number.isSafeInteger(value.index)&&value.index>=0?value.index:null,restartsExhausted:value.restartsExhausted===true,
      lastError:RUNTIME_ERRORS.has(value.lastError)?value.lastError:value.lastError?'STATE_UNAVAILABLE':null}) :
      Object.freeze({state:'unknown',ready:false,windowAllowed:false,preparing:true,output:record.profile.output.type,slideCount:null,sourceName:record.profile.output.type==='ndi'?record.profile.output.name:null,mode:null,index:null,restartsExhausted:false,lastError:'STATE_UNAVAILABLE'});
    return Object.freeze({...record.descriptor,revision:record.revision,...(candidateRecord?{candidateId:record.id}:{}),
      productionWindow:record.profile.productionWindow,cleanup:record.closeState,runtime});
  }
  function snapshot() {
    const blocked=physicalBarrier();
    const failed=[...records].some(record=>record.closeState==='failed');
    const state=closed?(failed?'faulted':closing?'closing':'closed'):operation?.kind || (failed?'faulted':active?'active':candidate?'prepared':'idle');
    return Object.freeze({state,closed,expectedEventId:activeId(),expectedSelection:selection,lastError,
      active:publicRecord(active),candidate:publicRecord(candidate,{candidateRecord:true}),operation:operation?.kind||null,
      preparing:flight!==null,listing:inventory!==null,physicalBarrier:blocked,retired: [...records].filter(record=>record!==active&&record!==candidate).length,
      receiverVerified:false,boardVerified:false});
  }
  function listEvents() {
    if(closed)return Promise.resolve(result(false,'CLOSED'));
    if(inventory)return inventory.promise;
    let resolve;
    const promise=new Promise(done=>{resolve=done;});
    const token={promise,resolve,settled:false};inventory=token;
    const complete=value=>{if(inventory===token)inventory=null;settle(token,value);};
    // Reserve one physical inventory flight before invoking trusted callbacks.
    void Promise.resolve().then(()=>closed?null:catalog.list()).then(values=>{
      if(closed)return result(false,'CLOSED');
      if(!Array.isArray(values)||values.length>128)throw fault('CATALOG_INVALID');
      const events=values.map(listDescriptor),ids=events.map(value=>value.eventId).filter(value=>value!==null);
      if(new Set(ids).size!==ids.length)throw fault('CATALOG_INVALID');
      return result(true,null,{events:Object.freeze(events)});
    }).then(complete,()=>complete(result(false,closed?'CLOSED':'CATALOG_INVALID')));
    return promise;
  }
  function prepare(id,raw) {
    if(!eventId(id))return Promise.resolve(result(false,'INVALID_REQUEST'));
    const code=admission(raw,{window:true,physical:true});if(code)return Promise.resolve(result(false,code));
    return reserve('preparing',async token=>{
      if(!fresh(token))return result(false,'CLOSED');
      try{await cleanupRetiredFailures();}catch{return result(false,'CLOSE_FAILED');}
      if(!fresh(token))return result(false,'CLOSED');
      if(candidate){
        const old=candidate;try { await closeRecord(old); } catch { return result(false,'CLOSE_FAILED'); }
        if(!fresh(token))return result(false,'CLOSED');
        if(candidate===old)candidate=null;
        if(physicalBarrier())return result(false,'BUSY');
      }
      const currentPolicy=policy();if(currentPolicy)return result(false,currentPolicy);
      let entry,profile,desc;
      try {
        entry=await catalog.read(id);
        if(!fresh(token))return result(false,'CLOSED');
        if(!Object.isFrozen(entry)||!record(entry,['profile','descriptor','revision'])||typeof entry.revision!=='string'||! /^[a-f0-9]{64}$/.test(entry.revision))throw fault('CATALOG_INVALID');
        profile=normalizePreparedEventProfile(entry.profile);desc=descriptor(entry.descriptor,{source:profile.provider==='exchange-v1'});
        if(desc.eventId!==id||profile.eventId!==id)throw fault('CATALOG_INVALID');
      } catch {if(fresh(token))lastError='CATALOG_INVALID';return result(false,closed?'CLOSED':'CATALOG_INVALID');}
      const beforeFactory=policy();if(beforeFactory)return result(false,beforeFactory);
      if(physicalBarrier())return result(false,'BUSY');
      if(!fresh(token))return result(false,'CLOSED');
      let runtime,candidateId,window;
      try{candidateId=randomBytes(24).toString('hex');window=normalizeWindow(profile.productionWindow);}catch{lastError='PREPARE_FAILED';return result(false,'PREPARE_FAILED');}
      try { runtime=await runtimeFactory(profile,{manageSpx:false,clock,privateRoots,canPrepare:()=>flight===null&&!closed,...(sourceRoot===undefined?{}:{sourceRoot})}); }
      catch {if(fresh(token))lastError='PREPARE_FAILED';return result(false,closed?'CLOSED':'PREPARE_FAILED');}
      const next={runtime,profile,descriptor:desc,revision:entry.revision,id:candidateId,window,closeState:'open',closePromise:null,started:false,admissionToken:null};records.add(next);
      if(!fresh(token)){
        try{await closeRecord(next);}catch{}
        return result(false,'CLOSED');
      }
      let valid=false;try{valid=!!runtime&&['start','snapshot','dispatch','close'].every(key=>typeof runtime[key]==='function')&&!!status(next);}catch{}
      if(!valid){
        try{await closeRecord(next);}catch{return result(false,'CLOSE_FAILED');}
        lastError='RUNTIME_INVALID';return result(false,'RUNTIME_INVALID');
      }
      let permitted=false;
      try{
        if(profile.provider==='exchange-v1')next.admissionToken=runtime.candidateAdmissionToken();
        permitted=refreshAdmission===undefined?candidatePermitted(next):(await refreshedCandidate(next,token))&&fresh(token)&&candidatePermitted(next);
      }catch{}
      if(!fresh(token)||!permitted){
        try{await closeRecord(next);}catch{return result(false,'CLOSE_FAILED');}
        if(!fresh(token))return result(false,'CLOSED');
        lastError='ADMISSION_DENIED';return result(false,'ADMISSION_DENIED');
      }
      const afterFactory=policy();
      const blockedAfterFactory=physicalBarrier();
      if(!fresh(token)||afterFactory||blockedAfterFactory){
        try{await closeRecord(next);}catch{return result(false,'CLOSE_FAILED');}
        return result(false,closed?'CLOSED':afterFactory||'BUSY');
      }
      // Policy/snapshot callbacks above may revoke a source or approval.
      // Keep the last admission check synchronous at publication.
      if((refreshAdmission!==undefined||profile.provider==='exchange-v1')&&!candidatePermitted(next)){
        try{await closeRecord(next);}catch{return result(false,'CLOSE_FAILED');}
        if(!fresh(token))return result(false,'CLOSED');
        lastError='ADMISSION_DENIED';return result(false,'ADMISSION_DENIED');
      }
      if(!fresh(token)){try{await closeRecord(next);}catch{}return result(false,'CLOSED');}
      candidate=next;lastError=null;
      return result(true,null,{candidateId:next.id,expectedSelection:selection});
    },{preparing:true});
  }
  function activate(raw) {
    const code=admission(raw,{withCandidate:true,window:true,physical:true});if(code)return Promise.resolve(result(false,code));
    if(!candidatePermitted(candidate))return Promise.resolve(result(false,closed?'CLOSED':'ADMISSION_DENIED'));
    // A trusted admission callback may synchronously reenter manager methods.
    const afterAdmission=admission(raw,{withCandidate:true,window:true,physical:true});
    if(afterAdmission)return Promise.resolve(result(false,afterAdmission));
    if(closed)return Promise.resolve(result(false,'CLOSED'));
    if(selection>=Number.MAX_SAFE_INTEGER)return Promise.resolve(result(false,'SELECTION_LIMIT'));
    // Epoch reservation happens before any asynchronous shutdown/start work.
    selection++;
    return reserve('activating',async token=>{
      if(!fresh(token))return result(false,'CLOSED');
      try{await cleanupRetiredFailures();}catch{return result(false,'CLOSE_FAILED');}
      if(!fresh(token))return result(false,'CLOSED');
      const next=candidate,retired=active;
      // A new awaited refresh after retirement cannot bypass an old window that
      // entered prewarm while the callback was outstanding. No rollback claimed.
      const activationPolicy=()=>{
        if(refreshAdmission===undefined||active||!retired)return policy();
        let now;try{now=clock();}catch{return 'CLOCK_INVALID';}
        return !Number.isFinite(now)?'CLOCK_INVALID':senderAllowed(retired.window,now)?'WINDOW_ACTIVE':null;
      };
      if(next.closeState!=='open')return result(false,'CANDIDATE_CLOSED');
      if(!(refreshAdmission===undefined?candidatePermitted(next):(await refreshedCandidate(next,token))&&fresh(token)&&candidatePermitted(next)))return result(false,closed?'CLOSED':'ADMISSION_DENIED');
      if(!fresh(token))return result(false,'CLOSED');
      const beforeStop=policy();
      if(!fresh(token))return result(false,'CLOSED');
      if(beforeStop)return result(false,beforeStop);
      if((refreshAdmission!==undefined||next.profile.provider==='exchange-v1')&&!candidatePermitted(next))return result(false,closed?'CLOSED':'ADMISSION_DENIED');
      if(!fresh(token))return result(false,'CLOSED');
      if(active){
        const old=active;
        try{await closeRecord(old);}catch{return result(false,'CLOSE_FAILED');}
        if(!fresh(token))return result(false,'CLOSED');
        if(physicalBarrier())return result(false,'BUSY');
        const afterStop=policy();
        if(!fresh(token))return result(false,'CLOSED');
        if(afterStop)return result(false,afterStop);
        if(active===old)active=null;
      }
      if(physicalBarrier())return result(false,'BUSY');
      if(!(refreshAdmission===undefined?candidatePermitted(next):(await refreshedCandidate(next,token))&&fresh(token)&&candidatePermitted(next)))return result(false,closed?'CLOSED':'ADMISSION_DENIED');
      if(!fresh(token))return result(false,'CLOSED');
      const beforeStart=activationPolicy();
      if(!fresh(token))return result(false,'CLOSED');
      if(beforeStart)return result(false,beforeStart);
      if((refreshAdmission!==undefined||next.profile.provider==='exchange-v1')&&!candidatePermitted(next))return result(false,closed?'CLOSED':'ADMISSION_DENIED');
      if(!fresh(token))return result(false,'CLOSED');
      try{await next.runtime.start();}
      catch{
        try{await closeRecord(next);}catch{return result(false,'CLOSE_FAILED');}
        if(!fresh(token))return result(false,'CLOSED');
        if(candidate===next)candidate=null;
        lastError='START_FAILED';
        return result(false,'START_FAILED');
      }
      if(!fresh(token)){try{await closeRecord(next);}catch{}return result(false,'CLOSED');}
      const refreshed=refreshAdmission===undefined?true:await refreshedCandidate(next,token);
      if(!fresh(token)){try{await closeRecord(next);}catch{}return result(false,'CLOSED');}
      // A policy clock is trusted code too. Run it before the final passive
      // source/approval check, with no further callbacks before publication.
      const afterStartPolicy=refreshed&&refreshAdmission!==undefined?activationPolicy():null;
      if(!fresh(token)||afterStartPolicy){
        try{await closeRecord(next);}catch{return result(false,'CLOSE_FAILED');}
        if(!fresh(token))return result(false,'CLOSED');
        if(candidate===next)candidate=null;
        lastError=afterStartPolicy;return result(false,afterStartPolicy);
      }
      if(!refreshed||!candidatePermitted(next)){
        try{await closeRecord(next);}catch{return result(false,'CLOSE_FAILED');}
        if(!fresh(token))return result(false,'CLOSED');
        if(candidate===next)candidate=null;
        lastError='ADMISSION_DENIED';return result(false,'ADMISSION_DENIED');
      }
      if(!fresh(token)){try{await closeRecord(next);}catch{}return result(false,'CLOSED');}
      next.started=true;active=next;if(candidate===next)candidate=null;lastError=null;
      return result(true,null,{eventId:next.descriptor.eventId,expectedSelection:selection});
    });
  }
  function discardCandidate(raw) {
    const code=admission(raw,{withCandidate:true});if(code)return Promise.resolve(result(false,code));
    return reserve('discarding',async token=>{
      const old=candidate;try{await closeRecord(old);}catch{return result(false,'CLOSE_FAILED');}
      if(!fresh(token))return result(false,'CLOSED');if(candidate===old)candidate=null;lastError=null;physicalBarrier();return result(true);
    });
  }
  // Q-009: the operator ends an active event whose renderer the supervisor gave up on (restart limit) inside
  // its window. Only that dead event: never a live or acknowledged one, never one with a restart pending.
  // Nothing plays afterwards; the next event is prepared and activated as usual.
  function dead(record){const value=status(record);return !!value&&value.restartsExhausted===true&&value.ready!==true&&value.preparing===false;}
  function endDeadEvent(raw) {
    const code=admission(raw);if(code)return Promise.resolve(result(false,code));
    const target=active;
    // A failed close of that dead event stays retryable here (closeRecord allows it); 'closing' is another operation's.
    if(!target||!target.started||!['open','failed'].includes(target.closeState))return Promise.resolve(result(false,'NOT_READY'));
    if(!dead(target))return Promise.resolve(result(false,'EVENT_NOT_DEAD'));
    // The snapshot callback is trusted code and may reenter: check again before the epoch moves.
    const again=admission(raw);if(again)return Promise.resolve(result(false,again));
    if(active!==target||!dead(target))return Promise.resolve(result(false,'EVENT_NOT_DEAD'));
    if(selection>=Number.MAX_SAFE_INTEGER)return Promise.resolve(result(false,'SELECTION_LIMIT'));
    selection++;
    return reserve('ending',async token=>{
      try{await closeRecord(target);}catch{return result(false,'CLOSE_FAILED');}
      if(!fresh(token))return result(false,'CLOSED');
      if(active===target)active=null;lastError=null;physicalBarrier();
      return result(true,null,{expectedSelection:selection});
    });
  }
  function dispatch(action,raw) {
    if(typeof action!=='string'||!ACTIONS.has(action)||!expected(raw))return Promise.resolve(result(false,'INVALID_REQUEST'));
    if(closed)return Promise.resolve(result(false,'CLOSED'));
    if(!matches(raw))return Promise.resolve(result(false,'STALE_SELECTION'));
    const target=active || (action==='stop'&&operation?.kind==='activating'?candidate:null);
    if(!target||target.closeState!=='open'||(action!=='stop'&&!target.started))return Promise.resolve(result(false,'NOT_READY'));
    // Playback, especially priority Stop, never queues behind lifecycle work.
    try{return Promise.resolve(target.runtime.dispatch(action)).then(value=>{
      if(!plain(value)||typeof value.ok!=='boolean')return result(false,'COMMAND_FAILED');
      return value.ok?result(true):result(false,RUNTIME_ERRORS.has(value.code)?value.code:'COMMAND_FAILED');
    },()=>result(false,'COMMAND_FAILED'));}catch{return Promise.resolve(result(false,'COMMAND_FAILED'));}
  }
  function close() {
    if(closePromise)return closePromise;
    let resolve;
    const pendingClose=new Promise(done=>{resolve=done;});closePromise=pendingClose;closing=true;
    if(!closed){closed=true;if(selection<Number.MAX_SAFE_INTEGER)selection++;}
    if(operation)settle(operation,result(false,'CLOSED'));
    if(inventory)settle(inventory,result(false,'CLOSED'));
    // Native cleanup starts now; do not await catalog/factory/start settlement.
    const pending=[...records].map(closeRecord);
    void Promise.allSettled(pending).then(values=>{
      closing=false;
      if(values.some(value=>value.status==='rejected')||[...records].some(value=>value.closeState==='failed')){lastError='CLOSE_FAILED';if(closePromise===pendingClose)closePromise=null;resolve(result(false,'CLOSE_FAILED'));}
      else{physicalBarrier();lastError=null;resolve(result(true));}
    });
    return pendingClose;
  }
  return Object.freeze({listEvents,snapshot,prepare,activate,discardCandidate,endDeadEvent,dispatch,close});
}
module.exports={createGameDayManager};
