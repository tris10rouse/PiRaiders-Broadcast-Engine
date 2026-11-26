'use strict';
// BE-006 item 5c part 1: six distinct diagnostic states for the Game Day page
// and the diagnostics command. Each state has its own name, value and code;
// none implies another, and none is "on air": a sender running is not a
// source discovered, a receiver connected or a board input selected, and this
// module never reports those. Inputs are the source service (source machine
// only) and the Game Day manager; every answer is path-free and id-free.
const STATES=Object.freeze(['exchangeFolder','catalogSequence','approvals','prepared','renderer','ndiSender']);
const NEVER_CLAIMED=Object.freeze(['sourceDiscovered','receiverConnected','boardInputSelected','onAir']);
const CODE=/^[A-Z][A-Z0-9_]{0,63}$/;
function code(value){return typeof value==='string'&&CODE.test(value)?value:value?'STATE_UNAVAILABLE':null;}
function entry(state,codeValue=null,extra={}){return Object.freeze({state,code:code(codeValue),...extra});}
async function exchangeFolder(source){
  if(!source)return entry('not-used');
  if(typeof source.rootState!=='function')return entry('unknown','STATE_UNAVAILABLE');
  let value;try{value=await source.rootState();}catch{return entry('unknown','STATE_UNAVAILABLE');}
  const c=value?.code;
  if(c===null)return entry('reachable');
  if(c==='SOURCE_UNAVAILABLE')return entry('unreachable',c);
  if(c==='SOURCE_ROOT_MISMATCH')return entry('mismatch',c);
  if(c==='SOURCE_SERVICE_CLOSED')return entry('unknown',c);
  return entry('unknown','STATE_UNAVAILABLE');
}
function catalogSequence(source,status){
  if(!source)return entry('not-used',null,{sequence:null});
  let catalog;try{catalog=source.catalogState();}catch{return entry('unknown','STATE_UNAVAILABLE',{sequence:null});}
  const sequence=catalog?.available===true?catalog.catalog?.catalogSequence:undefined;
  if(Number.isSafeInteger(sequence)&&sequence>=0)return entry('read',null,{sequence});
  return entry('unavailable',status?.catalog?.code||'CATALOG_UNAVAILABLE',{sequence:null});
}
function approvals(source,status){
  if(!source)return entry('not-used');
  const a=status?.approvals;
  if(!a||typeof a!=='object')return entry('unknown','STATE_UNAVAILABLE');
  if(a.closed===true)return entry('unknown','SOURCE_SERVICE_CLOSED');
  if(a.read===true)return entry('readable');
  // The app reads the list when it lists, prepares or admits a button; before
  // its first read it has no answer either way.
  if(!a.code||a.code==='APPROVAL_NOT_READ')return entry('not-read',a.code);
  return entry('unreadable',a.code);
}
function prepared(snapshot,missing){
  if(!snapshot||typeof snapshot!=='object')return entry('unknown',missing);
  const c=snapshot.candidate;
  if(c&&c.cleanup==='open')return entry('prepared');
  if(c)return entry('cleanup',c.cleanup==='failed'?'CLOSE_FAILED':null);
  if(snapshot.preparing===true||snapshot.operation==='preparing')return entry('preparing');
  return entry('none');
}
function activeRuntime(snapshot){const a=snapshot?.active;return a&&a.cleanup==='open'?a.runtime||null:null;}
function renderer(snapshot,missing){
  if(!snapshot||typeof snapshot!=='object')return entry('unknown',missing);
  const r=activeRuntime(snapshot);
  if(!r||r.state==='closed'||r.state==='closing')return entry('not-active');
  if(r.ready===true)return entry('acknowledged');
  if(r.state==='unknown')return entry('unknown',r.lastError||'STATE_UNAVAILABLE');
  return entry('waiting',r.lastError);
}
function ndiSender(snapshot,missing){
  if(!snapshot||typeof snapshot!=='object')return entry('unknown',missing);
  const r=activeRuntime(snapshot);
  if(!r)return entry('not-running');
  if(r.output!=='ndi')return entry(r.output==='none'?'not-configured':'unknown',r.output==='none'?null:'STATE_UNAVAILABLE');
  // Running means this event's Caspar generation is up with its NDI consumer
  // and its renderer acknowledged; nothing here has seen the source on a network.
  if(r.state==='ready'&&r.ready===true)return entry('running');
  if(r.state==='starting')return entry('starting');
  return entry('not-running',r.lastError);
}
async function diagnose({source=null,manager=null}={}){
  let status=null;if(source){try{status=source.status();}catch{status=null;}}
  let snapshot=null,missing='SOURCE_PLAYBACK_NOT_READY';
  if(manager){try{snapshot=manager.snapshot();}catch{snapshot=null;}missing='STATE_UNAVAILABLE';}
  const states={exchangeFolder:await exchangeFolder(source),catalogSequence:catalogSequence(source,status),approvals:approvals(source,status),
    prepared:prepared(snapshot,missing),renderer:renderer(snapshot,missing),ndiSender:ndiSender(snapshot,missing)};
  return Object.freeze({scope:'game-day-diagnostics',ready:false,mode:source?'source':'local',
    states:Object.freeze(states),neverClaimed:NEVER_CLAIMED});
}
module.exports={diagnose,DIAGNOSTIC_STATES:STATES,NEVER_CLAIMED};
