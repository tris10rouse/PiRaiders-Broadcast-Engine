'use strict';
const path = require('node:path');
const { RossTalkBridge } = require('./rosstalk-bridge.cjs');
const { createPresentationHost } = require('./presentation-host.cjs');
const ACTIONS = new Set(['launch','next','previous','toggle-auto','auto','manual','reload','stop']);
const HOST_CODES = new Set(['NOT_READY','CLOSED','CANCELLED','FAULTED','BUSY','RENDER_FAILED','RENDER_TIMEOUT',
  'INVALID_SNAPSHOT','PREPARE_FAILED','PREPARE_TIMEOUT','SNAPSHOT_CONFLICT','NOT_PLAYING']);
const FAULT_CODES = new Set(['HANDLER_TIMEOUT','LISTENER_FAILED','SEQUENCE_LIMIT']);
function plain(value) { return !!value && typeof value === 'object' && [null,Object.prototype].includes(Object.getPrototypeOf(value)); }
function known(value,keys) { return plain(value) && Reflect.ownKeys(value).every(key=>keys.includes(key)); }
function error(code) { return Object.assign(Error('Managed RossTalk '+code),{code}); }
function integer(value,min,max) { return Number.isSafeInteger(value)&&value>=min&&value<=max; }
/** Owns a real host and transport; no browser controls, source staging or sender. */
async function createRossTalkSession(raw = {}, options = {}) {
  let presentation, rossTalk, canControl, resolvePreparedSnapshot, resolverTimeoutMs, allowEphemeral, budget;
  try {
    if (!known(raw,['presentation','rossTalk','canControl','resolvePreparedSnapshot','resolverTimeoutMs']) ||
      !known(options,['allowEphemeral']) || !plain(raw.presentation) || !plain(raw.rossTalk) ||
      typeof raw.canControl !== 'function' || typeof raw.resolvePreparedSnapshot !== 'function') throw error('INVALID_OPTIONS');
    ({canControl,resolvePreparedSnapshot,resolverTimeoutMs=5000}=raw);
    ({allowEphemeral=false}=options);
    if (typeof allowEphemeral !== 'boolean' || !integer(resolverTimeoutMs,100,120000)) throw error('INVALID_OPTIONS');
    presentation={...raw.presentation};rossTalk={...raw.rossTalk};
    const command=presentation.commandTimeoutMs===undefined?12000:presentation.commandTimeoutMs;
    const prepare=presentation.prepareTimeoutMs===undefined?30000:presentation.prepareTimeoutMs;
    if (!integer(command,100,59000)||!integer(prepare,100,120000)) throw error('INVALID_OPTIONS');
    budget=resolverTimeoutMs+prepare+3*(command+500)+1000;
    if (!integer(budget,50,300000) || (rossTalk.handlerTimeoutMs!==undefined &&
      (!integer(rossTalk.handlerTimeoutMs,budget,300000)))) throw error('INVALID_OPTIONS');
    rossTalk.handlerTimeoutMs=rossTalk.handlerTimeoutMs===undefined?budget:rossTalk.handlerTimeoutMs;
  } catch { throw error('INVALID_OPTIONS'); }
  let host, bridge, state='idle', closed=false, closePromise, lastError=null, generation=0, resolver=null, stopPromise=null;
  function diagnostic(code) { if (state!=='faulted' && !closed) lastError=code; }
  function gate() {
    try {
      const value=canControl();
      if (value && typeof value.then==='function') Promise.resolve(value).catch(()=>{});
      return value===true;
    } catch { return false; }
  }
  function fence() {
    generation++;
    if (resolver) { clearTimeout(resolver.timer); resolver.abort.abort(); }
  }
  function stopHost() {
    if (stopPromise) return stopPromise;
    const pending=Promise.resolve().then(()=>host.dispatch('stop')).catch(()=>({ok:false,code:'STOP_FAILED'}));
    stopPromise=pending;
    void pending.then(()=>{if(stopPromise===pending)stopPromise=null;});
    return pending;
  }
  function requestStop() { fence(); return stopHost(); }
  function requireSuccess(outcome) {
    if (!outcome || outcome.ok!==true) throw error(HOST_CODES.has(outcome?.code)?outcome.code:'PRESENTATION_FAILED');
  }
  function stillCurrent(signal, stamp, epoch) {
    if (closed || signal.aborted || stamp!==generation) throw error('CANCELLED');
    if (host.snapshot().renderer.epoch!==epoch) throw error('STALE_SESSION');
  }
  async function handleCommand({action,signal}) {
    if (closed || !ACTIONS.has(action)) throw error('CLOSED');
    if (action==='stop') {
      const outcome=await requestStop();
      try { requireSuccess(outcome);diagnostic(null); }
      catch(e){diagnostic(e.code);throw e;}
      return;
    }
    if (signal.aborted) { void requestStop();throw error('CANCELLED'); }
    if (!gate()) { diagnostic('CONTROL_INHIBITED');throw error('CONTROL_INHIBITED'); }
    const stamp=generation,epoch=host.snapshot().renderer.epoch;
    const onAbort=()=>{void requestStop();};
    signal.addEventListener('abort',onAbort,{once:true});
    try {
      stillCurrent(signal,stamp,epoch);
      if (action==='reload') {
        const job={abort:new AbortController(),timer:null,timedOut:false};
        if (resolver) throw error('BUSY');
        resolver=job;
        job.timer=setTimeout(()=>{
          if (resolver!==job) return;
          job.timedOut=true;diagnostic('RESOLVER_TIMEOUT');void requestStop();
        },resolverTimeoutMs);
        let candidate;
        try {
          // Deliberately await actual settlement: a timeout/abort must not let
          // a successor run around an uncooperative asynchronous resolver.
          try { candidate=await resolvePreparedSnapshot(Object.freeze({signal:job.abort.signal})); }
          catch { throw error(job.timedOut?'RESOLVER_TIMEOUT':job.abort.signal.aborted?'CANCELLED':'RESOLVER_FAILED'); }
          if (job.timedOut) throw error('RESOLVER_TIMEOUT');
          stillCurrent(signal,stamp,epoch);
          if (!gate()) { diagnostic('CONTROL_INHIBITED');await requestStop();throw error('CONTROL_INHIBITED'); }
          if (typeof candidate!=='string'||!path.isAbsolute(candidate)) throw error('INVALID_SNAPSHOT');
        } finally { clearTimeout(job.timer);if(resolver===job)resolver=null; }
        requireSuccess(await host.reloadSnapshot(candidate));
      } else {
        requireSuccess(await host.dispatch(action));
      }
      stillCurrent(signal,stamp,epoch);
      if (!gate()) { diagnostic('CONTROL_INHIBITED');await requestStop();throw error('CONTROL_INHIBITED'); }
      diagnostic(null);
    } catch(e) {
      const code=HOST_CODES.has(e?.code)||['STALE_SESSION','CONTROL_INHIBITED','RESOLVER_TIMEOUT','RESOLVER_FAILED'].includes(e?.code)?e.code:'PRESENTATION_FAILED';
      if (stamp===generation&&!signal.aborted) diagnostic(code);throw error(code);
    } finally { signal.removeEventListener('abort',onAbort); }
  }
  function closeOwned(faulted=false) {
    if (closePromise) return closePromise;
    closed=true;state=faulted?'faulted':'closing';fence();
    closePromise=Promise.allSettled([bridge.close(),host?.close()]).then(results=>{
      if (!faulted) state='closed';
      if (results.some(value=>value.status==='rejected')) {
        state='faulted';lastError='CLOSE_FAILED';throw error('CLOSE_FAILED');
      }
    });
    return closePromise;
  }
  try { bridge=new RossTalkBridge(rossTalk,{handleCommand,prioritizeStop:true,allowEphemeral}); }
  catch { throw error('INVALID_OPTIONS'); }
  bridge.on('fault',value=>{
    if (closed) return;
    lastError=FAULT_CODES.has(value?.code)?value.code:'TRANSPORT_FAULT';state='faulted';
    void closeOwned(true).catch(()=>{});
  });
  try { host=await createPresentationHost(presentation); }
  catch(e) { await bridge.close().catch(()=>{});throw error(e?.code==='INVALID_OPTIONS'?'INVALID_OPTIONS':'START_FAILED'); }
  async function start() {
    if (closed) throw error('CLOSED');
    try { const address=await bridge.start();if(!closed)state='listening';return address; }
    catch { const code=closed?'CLOSED':'LISTEN_FAILED';if(!closed){lastError='LISTEN_FAILED';state='faulted';await closeOwned(true).catch(()=>{});}throw error(code); }
  }
  function snapshot() {
    return Object.freeze({state,lastError,transport:Object.freeze({...bridge.snapshot()}),presentation:host.snapshot()});
  }
  return Object.freeze({origin:host.origin,getProgramURL:()=>host.getProgramURL(),start,address:()=>bridge.address(),snapshot,close:()=>closeOwned(state==='faulted')});
}
module.exports={createRossTalkSession};
