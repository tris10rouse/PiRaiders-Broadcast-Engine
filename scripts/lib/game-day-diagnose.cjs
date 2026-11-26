'use strict';
// BE-006 item 5c part 3: the diagnostics command's reads. The same six state
// names as the 5c-1 model. The three exchange states are read here from the
// machine's own folder and stores, without the app and without writing:
// the media root against its retained canonical spelling, the catalog with
// the retained binding (read-only reader), and the approval list by replay
// (read-only open). The three playback states exist only inside a running
// app, so they come from its GET /game-day/api/diagnostics on the SPX
// config's port, or are 'unknown' with a code saying why. Never "on air".
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {isGameDayMachineConfig}=require('./game-day-catalog.cjs');
const {createExchangeCatalogReader}=require('./exchange-metadata-reader.cjs');
const {createExchangeApprovalStore}=require('./exchange-approval-store.cjs');
const {DIAGNOSTIC_STATES,NEVER_CLAIMED}=require('./game-day-diagnostics.cjs');

const CODE=/^[A-Z][A-Z0-9_]{0,63}$/;
// The values the 5c-1 model can give for each runtime state; anything else
// in an app's answer makes the whole answer invalid.
const RUNTIME=Object.freeze({prepared:['prepared','preparing','cleanup','none','unknown'],renderer:['acknowledged','waiting','not-active','unknown'],
  ndiSender:['running','starting','not-running','not-configured','unknown']});
const APP_TIMEOUT_MS=2000,APP_MAX_BYTES=65536,DEFAULT_PORT=5656;
function code(value){return typeof value==='string'&&CODE.test(value)?value:value?'STATE_UNAVAILABLE':null;}
function store(state,c=null,extra={}){return Object.freeze({state,code:code(c),...extra,from:'stores'});}
function comparable(value){return process.platform==='win32'?value.toLowerCase():value;}

async function storeStates(machine,trusted={}){
  if(!machine.source)return{exchangeFolder:store('not-used'),catalogSequence:store('not-used',null,{sequence:null}),approvals:store('not-used')};
  const s=machine.source,realpath=trusted.realpath??fs.realpath,stat=trusted.stat??fs.stat;
  // Exchange folder: as the source service's rootState, a folder now at the
  // retained canonical spelling (direct or through a link).
  let folder;
  try{const actual=await realpath(machine.mediaRoot);
    if(typeof actual!=='string'||comparable(path.resolve(actual))!==comparable(s.expectedCanonicalRoot))folder=store('mismatch','SOURCE_ROOT_MISMATCH');
    else folder=(await stat(actual)).isDirectory()?store('reachable'):store('unreachable','SOURCE_UNAVAILABLE');}
  catch{folder=store('unreachable','SOURCE_UNAVAILABLE');}
  // Catalog: only from a folder just shown reachable, read from the canonical
  // spelling with the retained binding; the reader opens files read-only.
  let catalog;
  if(folder.state!=='reachable')catalog=store('unavailable',folder.code,{sequence:null});
  else{
    let read;const reader=createExchangeCatalogReader({root:s.expectedCanonicalRoot,binding:{feedId:s.binding.feedId,epoch:s.binding.epoch}});
    try{read=await reader.captureCatalog();}catch{read={ok:false,code:'CATALOG_UNAVAILABLE'};}finally{reader.close();}
    const sequence=read.ok?read.receipt?.catalogSequence:undefined;
    catalog=Number.isSafeInteger(sequence)&&sequence>=0?store('read',null,{sequence}):store('unavailable',read.ok?'CATALOG_UNAVAILABLE':read.code,{sequence:null});
  }
  // Approvals: the store's own replay, which never writes.
  let approvals;
  try{const list=await(trusted.approvalStore??createExchangeApprovalStore()).open(s.approvalDirectory,s.approvalStoreId);
    approvals=list.ok?store('readable'):store('unreadable',list.code||'APPROVAL_UNREADABLE');}
  catch{approvals=store('unreadable','APPROVAL_UNREADABLE');}
  return{exchangeFolder:folder,catalogSequence:catalog,approvals};
}

// The port the app listens on: the SPX config's general.port, else 5656,
// exactly as server.js chooses it.
async function appPort(machine){
  try{const config=JSON.parse(await fs.readFile(path.join(machine.appRoot,machine.spxConfigFile),'utf8'));
    const port=config?.general?.port;
    if(!port)return DEFAULT_PORT;
    const n=typeof port==='string'&&/^[0-9]{1,5}$/.test(port)?Number(port):port;
    return Number.isSafeInteger(n)&&n>=1&&n<=65535?n:null;}
  catch{return null;}
}
// One read with a hard overall deadline (not only an idle-socket timeout).
// Only a refused connection means nothing listens on the port; a connection
// that does not give a whole answer in time is an app that did not answer.
function get(port,timeoutMs=APP_TIMEOUT_MS){
  return new Promise(resolve=>{
    let done=false,req=null;
    const finish=value=>{if(done)return;done=true;clearTimeout(deadline);req?.destroy();resolve(value);};
    const deadline=setTimeout(()=>finish({answered:true,status:null,text:null}),timeoutMs);
    req=http.request({hostname:'127.0.0.1',port,path:'/game-day/api/diagnostics',method:'GET',agent:false,
      headers:{Host:'127.0.0.1:'+port,Accept:'application/json'}},res=>{
      const chunks=[];let size=0;
      res.on('data',c=>{size+=c.length;if(size>APP_MAX_BYTES)finish({answered:true,status:res.statusCode,text:null});else chunks.push(c);});
      res.on('end',()=>finish({answered:true,status:res.statusCode,text:Buffer.concat(chunks).toString('utf8')}));
      res.on('error',()=>finish({answered:true,status:null,text:null}));
    });
    req.on('error',error=>finish(error?.code==='ECONNREFUSED'?{answered:false}:{answered:true,status:null,text:null}));
    req.end();
  });
}
function valid(d,mode){
  if(!d||typeof d!=='object'||d.scope!=='game-day-diagnostics'||d.ready!==false||!['source','local'].includes(d.mode))return null;
  if(!d.states||typeof d.states!=='object'||JSON.stringify(Object.keys(d.states))!==JSON.stringify(DIAGNOSTIC_STATES))return null;
  if(!Array.isArray(d.neverClaimed)||JSON.stringify(d.neverClaimed)!==JSON.stringify(NEVER_CLAIMED))return null;
  for(const [name,values] of Object.entries(RUNTIME)){const e=d.states[name];
    if(!e||typeof e!=='object'||!values.includes(e.state)||!(e.code===null||typeof e.code==='string'&&CODE.test(e.code)))return null;}
  return d.mode===mode?'answered':'mode-mismatch';
}
function unknown(appState,c){const e=Object.freeze({state:'unknown',code:c,from:'app'});return{app:appState,states:{prepared:e,renderer:e,ndiSender:e}};}
async function runtimeStates(machine,trusted={}){
  const port=await appPort(machine);
  if(port===null)return unknown('config-invalid','APP_PORT_INVALID');
  const answer=await(trusted.get??get)(port);
  if(!answer.answered)return unknown('not-running','APP_NOT_RUNNING');
  if(answer.status===null)return unknown('no-answer','APP_NO_ANSWER');
  if(answer.status===401||answer.status===403)return unknown('auth-required','APP_AUTH_REQUIRED');
  if(answer.status===503)return unknown('unavailable','APP_UNAVAILABLE');
  let value;try{value=answer.status===200&&answer.text!==null?JSON.parse(answer.text):null;}catch{value=null;}
  const verdict=value?.ok===true?valid(value.diagnostics,machine.source?'source':'local'):null;
  if(verdict===null)return unknown('invalid-answer','APP_ANSWER_INVALID');
  if(verdict==='mode-mismatch')return unknown('mode-mismatch','APP_MODE_MISMATCH');
  const states={};for(const name of Object.keys(RUNTIME)){const e=value.diagnostics.states[name];states[name]=Object.freeze({state:e.state,code:e.code,from:'app'});}
  return{app:'answered',states};
}

async function diagnoseMachine(machine,trusted={}){
  if(!isGameDayMachineConfig(machine))return Object.freeze({ok:false,code:'MACHINE_CONFIG_INVALID'});
  const [stores,runtime]=await Promise.all([storeStates(machine,trusted),runtimeStates(machine,trusted)]);
  const states={};for(const name of DIAGNOSTIC_STATES)states[name]=stores[name]??runtime.states[name];
  return Object.freeze({ok:true,scope:'game-day-diagnostics-command',ready:false,mode:machine.source?'source':'local',app:runtime.app,
    states:Object.freeze(states),neverClaimed:NEVER_CLAIMED});
}
module.exports={diagnoseMachine};
