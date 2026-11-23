'use strict';
// BE-006 item 5a part 2: the route steps of the Windows exchange activation
// proof, kept apart from the Windows script so Linux tests run the very same
// steps against the real web adapter.
//
// `client` is {get(url), post(url, body)} returning {status, value}; the
// Windows proof implements it with fetch inside the real Game Day page (its
// session cookie and CSRF token), the Linux test with plain HTTP. Every answer
// is checked to be path-free by the caller; this module only walks the
// routes in operator order and stops at the first refusal with a fixed code.
function fail(code,extra){throw Object.assign(Error(code),{code},extra);}
const FIXED=/^[A-Z][A-Z0-9_]{0,63}$/;
// The refused answer's HTTP status and its own fixed code travel with the
// error (never its text), so a CI failure line names why a route refused.
function ok(result,code){
  if(!result||result.status!==200||!result.value||result.value.ok===false){
    const answerCode=result&&result.value&&typeof result.value.code==='string'&&FIXED.test(result.value.code)?result.value.code:null;
    fail(code,{routeStatus:result&&Number.isInteger(result.status)?result.status:null,answerCode});
  }
  return result.value;
}
// Only the fixed-vocabulary parts of the source status answer (codes, flags,
// numbers), for a failure line. Anything else is dropped.
function sourceStatusCodes(value){
  const s=value&&value.status&&typeof value.status==='object'?value.status:value;
  if(!s||typeof s!=='object')return null;
  const code=v=>typeof v==='string'&&FIXED.test(v)?v:null,flag=v=>typeof v==='boolean'?v:null,count=v=>Number.isSafeInteger(v)?v:null;
  const c=s.catalog||{},p=s.provider||{},a=s.approvals||{};
  return{closed:flag(s.closed),catalog:{available:flag(c.available),code:code(c.code)},provider:{busy:flag(p.busy),closed:flag(p.closed)},
    approvals:{read:flag(a.read),revision:count(a.revision),code:code(a.code),rolledBack:flag(a.rolledBack),closed:flag(a.closed)}};
}

// A window that contains `nowMs`: started a minute ago, ends after the proof.
// Prewarm 0, so the window alone decides when the renderer may start.
function approvalWindow(nowMs,{beforeMs=60000,afterMs=15*60000}={}){
  if(!Number.isSafeInteger(nowMs)||!Number.isSafeInteger(beforeMs)||!Number.isSafeInteger(afterMs)||beforeMs<0||afterMs<=0)fail('WINDOW_OPTIONS_INVALID');
  const iso=ms=>new Date(Math.floor(ms/1000)*1000).toISOString().replace('.000Z','Z');
  return{start:iso(nowMs-beforeMs),end:iso(nowMs+afterMs),prewarmMinutes:0};
}

async function expectation(client,extra){
  const state=ok(await client.get('/game-day/api/state'),'STATE_FAILED').state;
  return{expectedEventId:state.expectedEventId,expectedSelection:state.expectedSelection,...extra};
}

// The Game Day page refreshes the source catalog once by itself when it
// opens in source mode. A second refresh while that one runs is refused
// (superseded or busy), so the proof waits until the page's own refresh has
// settled, read from the source status (codes and flags only).
async function pageRefreshSettled(client,{timeoutMs=30000,intervalMs=200,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  const end=now()+timeoutMs;let last=null;
  while(now()<end){
    const r=await client.get('/game-day/api/source/status');
    last=r&&r.status===200?sourceStatusCodes(r.value):null;
    if(last&&last.provider.busy===false&&(last.catalog.available===true||(last.catalog.code!==null&&last.catalog.code!=='CATALOG_NOT_READ')))return last;
    await sleep(intervalMs);
  }
  fail('PAGE_SOURCE_REFRESH_NOT_SETTLED',{answerCode:last&&last.catalog.code});
}

// refresh → events → selections → review → approve → approved list →
// prepare → activate. Returns the path-free ids it used and every answer
// (for the caller's privacy check).
async function approveAndActivate(client,{identityTuple,window}){
  if(!client||typeof client.get!=='function'||typeof client.post!=='function'||!Array.isArray(identityTuple)||identityTuple.length!==5)fail('ROUTE_OPTIONS_INVALID');
  const answers=[],keep=(r,code)=>{answers.push(r);return ok(r,code);};
  const refreshed=keep(await client.post('/game-day/api/source/refresh',{}),'SOURCE_REFRESH_FAILED');
  const revision=refreshed.catalog&&refreshed.catalog.revision;if(typeof revision!=='string')fail('SOURCE_REVISION_MISSING');
  const events=keep(await client.post('/game-day/api/source/events',{revision,offset:0,limit:50}),'SOURCE_EVENTS_FAILED').events;
  if(!Array.isArray(events)||events.filter(e=>e.eventKey===identityTuple[1]).length!==1)fail('SOURCE_EVENT_NOT_LISTED');
  const selections=keep(await client.post('/game-day/api/source/selections',{revision,eventKey:identityTuple[1],offset:0,limit:50}),'SOURCE_SELECTIONS_FAILED').selections;
  const same=x=>Array.isArray(x.identityTuple)&&x.identityTuple.length===5&&x.identityTuple.every((v,i)=>v===identityTuple[i]);
  if(!Array.isArray(selections)||selections.filter(same).length!==1)fail('SOURCE_SELECTION_NOT_LISTED');
  const review=keep(await client.post('/game-day/api/source/review',{identityTuple}),'SOURCE_REVIEW_FAILED');
  if(!review.inspection||review.inspection.revision===undefined)fail('SOURCE_REVIEW_INCOMPLETE');
  if(!review.approval||review.approval.read!==true||review.approval.record!==null)fail('SOURCE_APPROVAL_LIST_NOT_EMPTY');
  keep(await client.post('/game-day/api/source/approve',{identityTuple,inspectionRevision:review.inspection.revision,productionWindow:window}),'SOURCE_APPROVE_FAILED');
  const listed=keep(await client.get('/game-day/api/events'),'APPROVED_LIST_FAILED').events;
  if(!Array.isArray(listed)||listed.length!==1||typeof listed[0].eventId!=='string')fail('APPROVED_BUTTON_NOT_LISTED');
  const eventId=listed[0].eventId;
  const prepared=keep(await client.post('/game-day/api/prepare',await expectation(client,{eventId})),'PREPARE_FAILED');
  if(typeof prepared.candidateId!=='string')fail('PREPARE_FAILED');
  keep(await client.post('/game-day/api/activate',await expectation(client,{candidateId:prepared.candidateId})),'ACTIVATE_FAILED');
  return{eventId,candidateId:prepared.candidateId,answers};
}

// The cached start (5b-4): with the exchange folder gone there is no source
// catalog to review or approve, only the approved list (it reads the approval
// list alone). approved list → prepare → activate of its one button; the
// service decides whether the button may start from the cache.
async function startApproved(client){
  if(!client||typeof client.get!=='function'||typeof client.post!=='function')fail('ROUTE_OPTIONS_INVALID');
  const listed=ok(await client.get('/game-day/api/events'),'APPROVED_LIST_FAILED').events;
  if(!Array.isArray(listed)||listed.length!==1||typeof listed[0].eventId!=='string')fail('APPROVED_BUTTON_NOT_LISTED');
  const eventId=listed[0].eventId;
  const prepared=ok(await client.post('/game-day/api/prepare',await expectation(client,{eventId})),'PREPARE_FAILED');
  if(typeof prepared.candidateId!=='string')fail('PREPARE_FAILED');
  ok(await client.post('/game-day/api/activate',await expectation(client,{candidateId:prepared.candidateId})),'ACTIVATE_FAILED');
  return{eventId,candidateId:prepared.candidateId};
}

async function command(client,action){
  return ok(await client.post('/game-day/api/command',await expectation(client,{action})),'COMMAND_FAILED');
}

// True when any answer's text names one of the private paths (raw or JSON-escaped).
function namesPrivatePath(texts,paths){
  return texts.some(text=>typeof text==='string'&&paths.some(p=>typeof p==='string'&&p.length>0&&(text.includes(p)||text.includes(JSON.stringify(p).slice(1,-1)))));
}

module.exports={approvalWindow,approveAndActivate,startApproved,command,namesPrivatePath,sourceStatusCodes,pageRefreshSettled};
