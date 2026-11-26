'use strict';
const express=require('express');
const path=require('node:path');
const fs=require('node:fs/promises');
const {randomBytes,timingSafeEqual,createHmac}=require('node:crypto');
const {canonicalAddress}=require('./rosstalk-protocol.cjs');
const {loadGameDayMachineConfig,createLocalEventCatalog}=require('./game-day-catalog.cjs');
const {createGameDayManager}=require('./game-day-manager.cjs');
const {createExchangeSourceService}=require('./exchange-source-service.cjs');
const {createPreparedEventRuntime}=require('./prepared-event-runtime.cjs');
const {diagnose}=require('./game-day-diagnostics.cjs');
const ASSETS=Object.freeze({'/css/piraiders-game-day.css':['static/css/piraiders-game-day.css','text/css'],'/js/piraiders-game-day.js':['static/js/piraiders-game-day.js','application/javascript']});
const ACTIONS=new Set(['launch','next','previous','toggle-auto','auto','manual','reload','stop']);
const ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOKEN=/^[a-f0-9]{64}$/;
const MARK=Symbol('game-day-protected');
const CSP="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";
function failure(code){return Object.assign(Error(code),{code});}
function send(res,status,code){if(!res.destroyed&&!res.writableEnded)res.status(status).json({ok:false,code});}
function namespace(value){return /^\/game-day(?:\/|$)/i.test(value)||Object.keys(ASSETS).some(asset=>value.replace(/\/+$/,'').toLowerCase()===asset);}
function inspect(req){
 const target=req.originalUrl||req.url||'',absoluteForm=/^[a-z][a-z0-9+.-]*:\/\//i.test(target);
 const url=absoluteForm?(target.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i,'')||'/'):target,raw=url.split('?')[0];let decoded,normalized;
 try{decoded=decodeURIComponent(raw);normalized=path.posix.normalize(decoded.replace(/\\/g,'/'));}catch{return{protected:namespace(raw),valid:false};}
 const protectedPath=namespace(raw)||namespace(decoded)||namespace(normalized);
 const direct=/^\/game-day(?:\/|$)/i.test(raw)||Object.keys(ASSETS).some(asset=>new RegExp('^'+asset.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/?$','i').test(raw));
 return{protected:protectedPath,valid:!absoluteForm&&direct&&raw===decoded&&raw===normalized&&!url.includes('?')};
}
function headers(res){res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':CSP,'X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});}
function countHeader(req,name){let count=0;for(let i=0;i<req.rawHeaders.length;i+=2)if(req.rawHeaders[i].toLowerCase()===name)count++;return count;}
function metadata(req,mutation){
 const site=req.headers['sec-fetch-site'],mode=req.headers['sec-fetch-mode'],dest=req.headers['sec-fetch-dest'];
 if(site!==undefined&&!(mutation?site==='same-origin':['none','same-origin'].includes(site)))return false;
 if(mode!==undefined&&!(mutation?['cors','same-origin'].includes(mode):['navigate','cors','same-origin','no-cors'].includes(mode)))return false;
 if(dest!==undefined&&!(mutation?dest==='empty':['document','empty','script','style'].includes(dest)))return false;
 return true;
}
function id(value){return typeof value==='string'&&value.length<=64&&ID.test(value);}
function body(raw,keys){return !!raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.getPrototypeOf(raw)===Object.prototype&&Reflect.ownKeys(raw).length===keys.length&&keys.every(key=>Object.hasOwn(raw,key))&&Reflect.ownKeys(raw).every(key=>typeof key==='string'&&keys.includes(key));}
function tuple(raw){return(raw.expectedEventId===null||id(raw.expectedEventId))&&Number.isSafeInteger(raw.expectedSelection)&&raw.expectedSelection>=0;}
function apiStatus(value){if(value?.ok===true)return 200;switch(value?.code){case'INVALID_REQUEST':return 400;case'STALE_SELECTION':case'STALE_CANDIDATE':case'BUSY':case'WINDOW_ACTIVE':case'CANDIDATE_CLOSED':case'NOT_READY':case'CONTROL_INHIBITED':case'EVENT_NOT_DEAD':return 409;case'CATALOG_INVALID':case'PREPARE_FAILED':return 422;default:return 503;}}
function sourceApiStatus(value){if(value?.ok===true)return 200;switch(value?.code){case'CATALOG_QUERY_INVALID':case'APPROVAL_REQUEST_INVALID':case'APPROVAL_WINDOW_INVALID':case'SOURCE_SELECTION_INVALID':return 400;case'CATALOG_EVENT_MISSING':return 404;
 case'CATALOG_REVISION_STALE':case'CATALOG_UNAVAILABLE':case'CATALOG_REFRESH_SUPERSEDED':case'BUSY':case'APPROVAL_INSPECTION_STALE':case'APPROVAL_SELECTION_INELIGIBLE':case'APPROVAL_CONFLICT':return 409;default:return 503;}}
// Source browsing bodies. The service validates queries itself; these checks
// only keep the HTTP schema exact before anything reaches it.
const REVISION=/^[a-f0-9]{64}$/;
function page(raw){return typeof raw.revision==='string'&&REVISION.test(raw.revision)&&Number.isSafeInteger(raw.offset)&&raw.offset>=0&&Number.isSafeInteger(raw.limit)&&raw.limit>=1&&raw.limit<=64;}
function eventKey(value){return typeof value==='string'&&value.length>=1&&value.length<=128&&!/[\x00-\x1f\x7f]/.test(value);}
// Confirmation bodies (item 4c): five short strings, an inspection revision,
// and a window of two instants plus warm-up minutes. The service and the
// store apply the real tuple and window rules.
function identityTuple(value){return Array.isArray(value)&&value.length===5&&value.every((v,i)=>Object.hasOwn(value,i)&&typeof v==='string'&&v.length<=200&&!/[\x00-\x1f\x7f]/.test(v));}
function windowBody(value){return body(value,['start','end','prewarmMinutes'])&&['start','end'].every(k=>typeof value[k]==='string'&&value[k].length<=40)&&Number.isSafeInteger(value.prewarmMinutes)&&value.prewarmMinutes>=0&&value.prewarmMinutes<=60;}
const SERVICE_KEYS=['refreshCatalog','catalogState','catalogEventsPage','catalogSelectionsPage','reviewSelection','confirmSelection','revokeSelection','status','close'];
/** Trusted Node adapter: injected manager or source service is never accepted through environment/profile/HTTP. */
function createGameDayWeb({manager,sourceService,runtimeFactory,port,appRoot,machineFile,configFile}={}){
 if(!Number.isSafeInteger(port)||port<1||port>65535||typeof appRoot!=='string'||!path.isAbsolute(appRoot)||(manager&&sourceService)||
  (!manager&&!sourceService&&(typeof machineFile!=='string'||machineFile.length>4096||/[\x00-\x1f\x7f]/.test(machineFile)||!path.isAbsolute(machineFile))))throw failure('APP_CONFIG_INVALID');
 if(manager&&!['snapshot','listEvents','prepare','activate','discardCandidate','endDeadEvent','dispatch','close'].every(key=>typeof manager[key]==='function'))throw failure('APP_CONFIG_INVALID');
 if(sourceService&&!SERVICE_KEYS.every(key=>typeof sourceService[key]==='function'))throw failure('APP_CONFIG_INVALID');
 // runtimeFactory is a trusted Node seam for a loaded source machine's
 // playback (tests); it is never read from a profile, the environment or HTTP.
 if(runtimeFactory!==undefined&&(typeof runtimeFactory!=='function'||manager||sourceService))throw failure('APP_CONFIG_INVALID');
 const startupSecret=process.env.PIRAIDERS_APP_STARTUP_SECRET;
 if(startupSecret!==undefined&&!TOKEN.test(startupSecret))throw failure('APP_CONFIG_INVALID');
 const startupKey=startupSecret===undefined?null:Buffer.from(startupSecret,'hex');
 const origin=new URL('http://127.0.0.1:'+port).origin,host=new URL(origin).host;
 // One owned backend per web adapter: a playback manager for a local-folder
 // machine; for a source machine the source catalog service and, since item
 // 4d, a manager whose catalog is that service's approved selections. An
 // injected service alone (tests) has no manager: its playback routes answer
 // SOURCE_PLAYBACK_NOT_READY. The manager closes first; the service (and its
 // provider) only once every runtime has closed, so a failed close is retried.
 const backend=(managerValue,sourceValue)=>Object.freeze({manager:managerValue||null,source:sourceValue||null,
  close:!sourceValue?()=>managerValue.close():!managerValue?()=>{sourceValue.close();return{ok:true};}:
   ()=>Promise.resolve(managerValue.close()).then(value=>{if(value?.ok!==false)sourceValue.close();return value;})});
 function sourceBackend(machine){
  const service=createExchangeSourceService(machine);
  try{
   return backend(createGameDayManager({catalog:service.playbackCatalog,runtimeFactory:service.preparedRuntimeFactory(runtimeFactory||createPreparedEventRuntime),
    sourceRoot:machine.mediaRoot,privateRoots:[machine.runtimeRoot,machine.catalogDirectory,machine.source.approvalDirectory],
    admitCandidate:service.admission.admitCandidate,refreshAdmission:service.admission.refreshAdmission}),service);
  }catch(error){service.close();throw error;}
 }
 let owned=manager||sourceService?backend(manager,sourceService):null,closed=false,closePromise=null;
 const ready=owned?Promise.resolve(owned):loadGameDayMachineConfig(machineFile,{appRoot,nodeExecutable:process.execPath}).then(async machine=>{
  if(typeof configFile!=='string'||!path.isAbsolute(configFile))throw failure('APP_CONFIG_INVALID');
  // CWD/configfileref and __dirname can name the same file through Windows8.3
  // or directory aliases. Compare observed canonical paths without rewriting it.
  const [expectedConfig,actualConfig]=await Promise.all([fs.realpath(path.join(appRoot,machine.spxConfigFile)),fs.realpath(configFile)]);
  const normalize=value=>process.platform==='win32'?value.toLowerCase():value;
  if(normalize(expectedConfig)!==normalize(actualConfig))throw failure('APP_CONFIG_INVALID');
  owned=machine.source?sourceBackend(machine):backend(createGameDayManager({catalog:createLocalEventCatalog(machine),sourceRoot:machine.mediaRoot,privateRoots:[machine.cacheRoot,machine.runtimeRoot,machine.catalogDirectory]}),null);
  if(closed){
   let stopping;try{stopping=owned.close();}catch{stopping=Promise.reject(failure('CLOSE_FAILED'));}
   void Promise.resolve(stopping).then(value=>{if(value?.ok===false)closePromise=null;},()=>{closePromise=null;});return null;
  }return owned;
 }).catch(()=>null);
 function guard(req,res,next){
  const target=inspect(req);if(!target.protected)return next();req[MARK]=true;headers(res);
  let peer;try{peer=canonicalAddress(req.socket.remoteAddress);}catch{}
  if(!['127.0.0.1','::1'].includes(peer)||countHeader(req,'host')!==1||req.headers.host!==host)return send(res,403,'LOCAL_ONLY');
  if(countHeader(req,'origin')>1||(req.headers.origin!==undefined&&req.headers.origin!==origin))return send(res,403,'ORIGIN_DENIED');
  const mutation=!['GET','HEAD'].includes(req.method);
  if(mutation&&(countHeader(req,'origin')!==1||req.headers.origin!==origin))return send(res,403,'ORIGIN_DENIED');
  for(const name of ['sec-fetch-site','sec-fetch-mode','sec-fetch-dest'])if(countHeader(req,name)>1)return send(res,403,'FETCH_DENIED');
  if(!metadata(req,mutation))return send(res,403,'FETCH_DENIED');
  if(req.method==='OPTIONS')return send(res,405,'METHOD_NOT_ALLOWED');
  if(!target.valid)return send(res,400,'INVALID_REQUEST');
  return next();
 }
 const router=express.Router();
 router.all('/game-day/internal/startup-identity',async(req,res,next)=>{
  if(!req[MARK])return next('router');
  if(!startupKey)return send(res,404,'NOT_FOUND');
  let local;try{local=canonicalAddress(req.socket.localAddress);}catch{}
  if(local!=='127.0.0.1')return send(res,403,'LOCAL_ONLY');
  if(req.method!=='GET')return send(res,405,'METHOD_NOT_ALLOWED');
  const probe=req.headers['x-piraiders-startup-probe'];
  if(countHeader(req,'x-piraiders-startup-probe')!==1||typeof probe!=='string'||!/^[a-f0-9]{32}$/.test(probe))return send(res,400,'INVALID_PROBE');
  const value=await ready;if(closed||!value)return send(res,503,closed?'CLOSED':'APP_CONFIG_INVALID');
  res.json({app:'piraiders',proof:createHmac('sha256',startupKey).update(probe,'ascii').digest('hex')});
 });
 router.use((req,res,next)=>{if(!req[MARK])return next('router');if(!req.session)return send(res,500,'SESSION_UNAVAILABLE');next();});
 function auth(req,res,next){
  const general=global.config?.general||{},user=general.username||'';
  if(!user){req.session.user='default';return next();}
  if(!general.password)return send(res,403,'AUTH_POLICY_REQUIRED');
  if(req.session.user===user)return next();return send(res,401,'AUTH_REQUIRED');
 }
 function pageAuth(req,res,next){
  const general=global.config?.general||{},user=general.username||'';
  if(!user){req.session.user='default';return next();}
  if(!general.password)return res.redirect('/');
  if(req.session.user===user)return next();return res.redirect('/login');
 }
 async function backendReady(req,res,next){const value=await ready;if(closed||!value)return send(res,503,closed?'CLOSED':'APP_CONFIG_INVALID');req.gameDayBackend=value;next();}
 function managerReady(req,res,next){if(!req.gameDayBackend.manager)return send(res,503,'SOURCE_PLAYBACK_NOT_READY');req.gameDayManager=req.gameDayBackend.manager;next();}
 function sourceReady(req,res,next){if(!req.gameDayBackend.source)return send(res,404,'NOT_FOUND');req.gameDaySource=req.gameDayBackend.source;next();}
 const available=[backendReady,managerReady];
 function csrf(req,res,next){
  const expected=req.session.piraidersGameDayCsrf,value=req.headers['x-piraiders-csrf'];
  if(countHeader(req,'x-piraiders-csrf')!==1||typeof expected!=='string'||!TOKEN.test(expected)||typeof value!=='string'||!TOKEN.test(value)||!timingSafeEqual(Buffer.from(value),Buffer.from(expected)))return send(res,403,'CSRF_DENIED');
  next();
 }
 // A source machine gets the page too (its CSRF token guards the source
 // routes), marked sourceMode; its selection screen is backlog item 4b.
 router.get('/game-day',pageAuth,backendReady,(req,res)=>{
  if(typeof req.session.piraidersGameDayCsrf!=='string'||!TOKEN.test(req.session.piraidersGameDayCsrf))req.session.piraidersGameDayCsrf=randomBytes(32).toString('hex');
  res.render('view-game-day',{layout:false,csrfToken:req.session.piraidersGameDayCsrf,sourceMode:!!req.gameDayBackend.source});
 });
 for(const [url,[file,type]]of Object.entries(ASSETS))router.get(url,auth,backendReady,(req,res)=>{
  res.type(type).sendFile(path.join(appRoot,file),{cacheControl:false,dotfiles:'deny'},error=>{if(error&&!res.headersSent)send(res,404,'NOT_FOUND');});
 });
 router.get('/game-day/api/state',auth,available,(req,res)=>{try{res.json({ok:true,state:req.gameDayManager.snapshot()});}catch{send(res,500,'STATE_UNAVAILABLE');}});
 router.get('/game-day/api/events',auth,available,(req,res)=>{void Promise.resolve().then(()=>req.gameDayManager.listEvents()).then(value=>{if(!res.destroyed&&!res.writableEnded)res.status(apiStatus(value)).json(value);},()=>send(res,503,'CATALOG_INVALID'));});
 // Source browsing (backlog item 4a). Status is a plain read; refresh and the
 // page reads are POSTs behind the same Origin/CSRF checks as every mutation
 // because the guard refuses query strings. Only approve and revoke (item 4c)
 // write, and only the approval store; nothing here prepares, writes the
 // source or touches playback; every answer is path-free.
 router.get('/game-day/api/source/status',auth,backendReady,sourceReady,(req,res)=>{
  try{res.json({ok:true,ready:false,status:req.gameDaySource.status(),catalog:req.gameDaySource.catalogState()});}catch{send(res,500,'STATE_UNAVAILABLE');}
 });
 // Diagnostics (5c-1): six distinct states, a plain path-free read on every
 // machine; never "on air". The manager may be absent (an injected service).
 router.get('/game-day/api/diagnostics',auth,backendReady,(req,res)=>{
  void diagnose({source:req.gameDayBackend.source,manager:req.gameDayBackend.manager}).then(value=>{if(!res.destroyed&&!res.writableEnded)res.json({ok:true,diagnostics:value});},()=>send(res,500,'STATE_UNAVAILABLE'));
 });
 router.use('/game-day/api',(req,res,next)=>{
  if(req.method!=='POST')return send(res,405,'METHOD_NOT_ALLOWED');
  if(!req.is('application/json'))return send(res,415,'JSON_REQUIRED');next();
 },auth,backendReady,csrf,express.json({limit:4096,strict:true,inflate:false}));
 const sourceRoutes=[['refresh',[],()=>true,source=>source.refreshCatalog()],
  ['events',['revision','offset','limit'],page,(source,raw)=>source.catalogEventsPage({revision:raw.revision,offset:raw.offset,limit:raw.limit})],
  ['selections',['revision','eventKey','offset','limit'],raw=>page(raw)&&eventKey(raw.eventKey),(source,raw)=>source.catalogSelectionsPage({revision:raw.revision,eventKey:raw.eventKey,offset:raw.offset,limit:raw.limit})],
  // PC confirmation (item 4c): review reads the source metadata and the
  // approval store; approve and revoke write the store, nothing else.
  ['review',['identityTuple'],raw=>identityTuple(raw.identityTuple),(source,raw)=>source.reviewSelection([...raw.identityTuple])],
  ['approve',['identityTuple','inspectionRevision','productionWindow'],raw=>identityTuple(raw.identityTuple)&&typeof raw.inspectionRevision==='string'&&REVISION.test(raw.inspectionRevision)&&windowBody(raw.productionWindow),
   (source,raw)=>source.confirmSelection({identityTuple:[...raw.identityTuple],inspectionRevision:raw.inspectionRevision,productionWindow:{start:raw.productionWindow.start,end:raw.productionWindow.end,prewarmMinutes:raw.productionWindow.prewarmMinutes}})],
  ['revoke',['identityTuple'],raw=>identityTuple(raw.identityTuple),(source,raw)=>source.revokeSelection({identityTuple:[...raw.identityTuple]})]];
 for(const[name,keys,valid,invoke]of sourceRoutes)router.post('/game-day/api/source/'+name,sourceReady,(req,res)=>{
  if(!body(req.body,keys)||!valid(req.body))return send(res,400,'INVALID_REQUEST');
  void Promise.resolve().then(()=>invoke(req.gameDaySource,req.body)).then(value=>{if(!res.destroyed&&!res.writableEnded)res.status(sourceApiStatus(value)).json(value);},()=>send(res,503,'SOURCE_SERVICE_FAILED'));
 });
 const mutations=[['prepare',['eventId','expectedEventId','expectedSelection'],raw=>id(raw.eventId), (value,raw)=>value.prepare(raw.eventId,{expectedEventId:raw.expectedEventId,expectedSelection:raw.expectedSelection})],
  ['activate',['candidateId','expectedEventId','expectedSelection'],raw=>typeof raw.candidateId==='string'&&/^[a-f0-9]{48}$/.test(raw.candidateId),(value,raw)=>value.activate(raw)],
  ['discard',['candidateId','expectedEventId','expectedSelection'],raw=>typeof raw.candidateId==='string'&&/^[a-f0-9]{48}$/.test(raw.candidateId),(value,raw)=>value.discardCandidate(raw)],
  // Q-009: end an active event whose renderer is past its restart limit; the manager refuses any other.
  ['end-dead',['expectedEventId','expectedSelection'],()=>true,(value,raw)=>value.endDeadEvent({expectedEventId:raw.expectedEventId,expectedSelection:raw.expectedSelection})],
  ['command',['action','expectedEventId','expectedSelection'],raw=>typeof raw.action==='string'&&ACTIONS.has(raw.action),(value,raw)=>value.dispatch(raw.action,{expectedEventId:raw.expectedEventId,expectedSelection:raw.expectedSelection})]];
 for(const[name,keys,valid,invoke]of mutations)router.post('/game-day/api/'+name,managerReady,(req,res)=>{
  if(!body(req.body,keys)||!tuple(req.body)||!valid(req.body))return send(res,400,'INVALID_REQUEST');
  void Promise.resolve().then(()=>invoke(req.gameDayManager,req.body)).then(value=>{if(!res.destroyed&&!res.writableEnded)res.status(apiStatus(value)).json(value);},()=>send(res,503,'OPERATION_FAILED'));
 });
 router.use((req,res)=>send(res,404,'NOT_FOUND'));
 router.use((error,req,res,next)=>{if(!res.headersSent)send(res,error?.type==='entity.too.large'?413:error?.type==='encoding.unsupported'||error?.type==='charset.unsupported'?415:400,'INVALID_JSON');});
 function close(){
  if(closePromise)return closePromise;closed=true;let resolve;const pending=new Promise(done=>{resolve=done;});closePromise=pending;
  let stopping;try{stopping=owned?owned.close():{ok:true};}catch{stopping=Promise.reject(failure('CLOSE_FAILED'));}
  void Promise.resolve(stopping).then(value=>{if(value?.ok===false)closePromise=null;resolve(value);},()=>{closePromise=null;resolve({ok:false,code:'CLOSE_FAILED'});});return pending;
 }
 return Object.freeze({guard,router,matches:req=>req[MARK]===true||inspect(req).protected,close});
}
module.exports={createGameDayWeb};
