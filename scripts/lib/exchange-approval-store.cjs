'use strict';
// Detached persistence only. An approval record is not an authorization decision.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {TextDecoder}=require('node:util');
const {canonicalExchangeJSON}=require('./exchange-fingerprints.cjs');
const {normalizeWindow}=require('./production-window.cjs');
const LIMITS=Object.freeze({records:4096,approvals:2048,recordBytes:65536,totalBytes:67108864,temporaryFiles:32});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/,RECORD=/^[0-9]{12}\.json$/,TEMP=/^\.tmp-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CODES=new Set(['APPROVAL_ARGUMENT_INVALID','APPROVAL_EXISTS','APPROVAL_MISSING','APPROVAL_INVALID','APPROVAL_CAPACITY_EXCEEDED','APPROVAL_CONFLICT','APPROVAL_RECORD_REJECTED','APPROVAL_IO_FAILED','APPROVAL_COMMIT_UNCERTAIN']);
function fail(code){throw Error(code);}
function frozen(v){if(v&&typeof v==='object'){Object.values(v).forEach(frozen);Object.freeze(v);}return v;}
function shape(v,keys,required=keys,code='APPROVAL_ARGUMENT_INVALID'){
 if(!v||typeof v!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail(code);
 const d=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(d);
 if(required.some(k=>!Object.hasOwn(d,k))||names.some(k=>typeof k!=='string'||!keys.includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value')))fail(code);
}
function ownJSON(value){try{return JSON.parse(canonicalExchangeJSON(value));}catch{fail('APPROVAL_RECORD_REJECTED');}}
function identity(raw){
 if(typeof raw.providerId!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.providerId)||raw.providerId.length>64)fail('APPROVAL_RECORD_REJECTED');
 shape(raw.binding,['feedId','epoch'],undefined,'APPROVAL_RECORD_REJECTED');
 if(typeof raw.binding.feedId!=='string'||!UUID.test(raw.binding.feedId)||!Number.isSafeInteger(raw.binding.epoch)||raw.binding.epoch<1||raw.binding.epoch>999999)fail('APPROVAL_RECORD_REJECTED');
 const t=raw.identityTuple;
 if(!Array.isArray(t)||t.length!==5||t.some((v,i)=>typeof v!=='string'||Array.from(v).length>[9,64,64,6,200][i]||/[\x00-\x1f\x7f]/.test(v))||!/^\d{4}-\d{4}$/.test(t[0])||!t[1]||!['event','season'].includes(t[3])||!t[4]||t[3]==='season'&&!t[2])fail('APPROVAL_RECORD_REJECTED');
 return{providerId:raw.providerId,binding:{...raw.binding},identityTuple:[...t]};
}
function normalizeApproval(input){
 const raw=ownJSON(input);
 const common=['type','providerId','binding','identityTuple','confirmation'];
 if(raw?.type==='confirm')shape(raw,[...common,'machinePolicyFingerprint','productionWindow','offline'],[...common,'machinePolicyFingerprint','productionWindow','offline'],'APPROVAL_RECORD_REJECTED');
 else if(raw?.type==='revoke')shape(raw,common,common,'APPROVAL_RECORD_REJECTED');else fail('APPROVAL_RECORD_REJECTED');
 if(raw.confirmation!==true)fail('APPROVAL_RECORD_REJECTED');
 const id=identity(raw);
 if(raw.type==='revoke')return frozen({type:'revoke',...id,confirmation:true});
 if(typeof raw.machinePolicyFingerprint!=='string'||!SHA.test(raw.machinePolicyFingerprint))fail('APPROVAL_RECORD_REJECTED');
 shape(raw.productionWindow,['start','end','prewarmMinutes'],['start','end'],'APPROVAL_RECORD_REJECTED');
 let window;try{window=normalizeWindow(raw.productionWindow);}catch{fail('APPROVAL_RECORD_REJECTED');}
 let offline=null;
 if(raw.offline!==null){shape(raw.offline,['snapshotId','playbackFingerprint'],undefined,'APPROVAL_RECORD_REJECTED');
  if(typeof raw.offline.snapshotId!=='string'||!UUID.test(raw.offline.snapshotId)||typeof raw.offline.playbackFingerprint!=='string'||!SHA.test(raw.offline.playbackFingerprint))fail('APPROVAL_RECORD_REJECTED');offline={...raw.offline};}
 return frozen({type:'confirm',...id,machinePolicyFingerprint:raw.machinePolicyFingerprint,
  productionWindow:{start:new Date(window.startMs).toISOString(),end:new Date(window.endMs).toISOString(),prewarmMinutes:window.prewarmMs/60000},offline,confirmation:true});
}
function key(approval){return canonicalExchangeJSON([approval.providerId,approval.binding.feedId,approval.binding.epoch,approval.identityTuple]);}
function digest(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}
function filename(revision){return String(revision).padStart(12,'0')+'.json';}
function encoded(record){return Buffer.from(canonicalExchangeJSON(record)+'\n');}
function sameFile(a,b){return a.dev===b.dev&&a.ino===b.ino;}
function signature(s){return[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');}
function createExchangeApprovalStore(options={}){
 shape(options,['io','phase','limits'],[]);
 const {io=fs.promises,phase=async()=>{},limits=LIMITS}=options;
 shape(limits,Object.keys(LIMITS));
 for(const name of Object.keys(LIMITS))if(!Number.isSafeInteger(limits[name])||limits[name]<1||limits[name]>LIMITS[name])fail('APPROVAL_ARGUMENT_INVALID');
 if(typeof phase!=='function')fail('APPROVAL_ARGUMENT_INVALID');
 const bounds={...limits};
 function absolute(directory){if(typeof directory!=='string'||directory.length>4096||/[\x00-\x1f\x7f]/.test(directory)||!path.isAbsolute(directory)||path.resolve(directory)!==directory||process.platform==='win32'&&path.parse(directory).root.startsWith('\\\\'))fail('APPROVAL_ARGUMENT_INVALID');}
 async function pinRoot(directory){
  absolute(directory);const ancestry=[],parsed=path.parse(directory);let cursor=parsed.root;
  for(const segment of ['',...path.relative(parsed.root,directory).split(path.sep).filter(Boolean)]){
   if(segment)cursor=path.join(cursor,segment);let stat;
   try{stat=await io.lstat(cursor,{bigint:true});}catch(e){if(e.code==='ENOENT')fail('APPROVAL_MISSING');throw e;}
   if(!stat.isDirectory()||stat.isSymbolicLink())fail('APPROVAL_INVALID');ancestry.push({path:cursor,stat});
  }return ancestry;
 }
 async function currentRoot(pin){for(const p of pin){const stat=await io.lstat(p.path,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink()||(!sameFile(stat,p.stat)||stat.birthtimeNs!==p.stat.birthtimeNs))fail('APPROVAL_INVALID');}}
 async function readFile(directory,name,pin){
  await currentRoot(pin);const target=path.join(directory,name),before=await io.lstat(target,{bigint:true});
  if(!before.isFile()||before.isSymbolicLink()||before.size<1n||before.size>BigInt(bounds.recordBytes))fail('APPROVAL_INVALID');
  const handle=await io.open(target,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try{
   const opened=await handle.stat({bigint:true});if(signature(opened)!==signature(before))fail('APPROVAL_INVALID');
   const bytes=Buffer.alloc(Number(before.size)+1);let offset=0;
   while(offset<bytes.length){const p=await handle.read(bytes,offset,bytes.length-offset,offset);if(!p.bytesRead)break;offset+=p.bytesRead;}
   const after=await handle.stat({bigint:true});await currentRoot(pin);const named=await io.lstat(target,{bigint:true});
   if(offset!==Number(before.size)||signature(after)!==signature(opened)||signature(named)!==signature(opened)||!named.isFile()||named.isSymbolicLink())fail('APPROVAL_INVALID');
   return{bytes:bytes.subarray(0,offset),stat:opened};
  }finally{await handle.close();}
 }
 function apply(approvals,approval){const id=key(approval),old=approvals.get(id);
  if(approval.type==='revoke'){if(!old)return false;approvals.delete(id);return true;}
  if(old&&canonicalExchangeJSON(old)===canonicalExchangeJSON(approval))return false;
  if(!old&&approvals.size>=bounds.approvals)fail('APPROVAL_CAPACITY_EXCEEDED');approvals.set(id,approval);return true;
 }
 async function replay(directory,expectedStoreId){
  if(typeof expectedStoreId!=='string'||!UUID.test(expectedStoreId))fail('APPROVAL_ARGUMENT_INVALID');
  const pin=await pinRoot(directory),names=[];let temps=0;const iterator=await io.opendir(directory);
  for await(const entry of iterator){
   await currentRoot(pin);
   if(RECORD.test(entry.name)){if(!entry.isFile())fail('APPROVAL_INVALID');if(names.length>=bounds.records)fail('APPROVAL_CAPACITY_EXCEEDED');names.push(entry.name);}
   else if(TEMP.test(entry.name)){if(!entry.isFile()||++temps>bounds.temporaryFiles)fail('APPROVAL_CAPACITY_EXCEEDED');const s=await io.lstat(path.join(directory,entry.name),{bigint:true});if(!s.isFile()||s.isSymbolicLink()||s.size>BigInt(bounds.recordBytes))fail('APPROVAL_INVALID');}
   else fail('APPROVAL_INVALID');
  }
  names.sort();if(!names.length)fail('APPROVAL_INVALID');let totalBytes=0,headSha256=null,headIdentity=null;const approvals=new Map();
  for(let revision=0;revision<names.length;revision++){
   if(names[revision]!==filename(revision))fail('APPROVAL_INVALID');const {bytes,stat}=await readFile(directory,names[revision],pin);totalBytes+=bytes.length;if(totalBytes>bounds.totalBytes)fail('APPROVAL_CAPACITY_EXCEEDED');
   let r;try{r=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));shape(r,['schemaVersion','kind','storeId','revision','parentSha256','approval'],undefined,'APPROVAL_INVALID');if(!encoded(r).equals(bytes))fail('APPROVAL_INVALID');}catch{fail('APPROVAL_INVALID');}
   if(r.schemaVersion!==1||r.storeId!==expectedStoreId||r.revision!==revision||r.parentSha256!==headSha256)fail('APPROVAL_INVALID');
   if(revision===0){if(r.kind!=='genesis'||r.approval!==null)fail('APPROVAL_INVALID');}
   else {if(r.kind!=='approval')fail('APPROVAL_INVALID');let approval;try{approval=normalizeApproval(r.approval);}catch{fail('APPROVAL_INVALID');}
    if(canonicalExchangeJSON(approval)!==canonicalExchangeJSON(r.approval)||!apply(approvals,approval))fail('APPROVAL_INVALID');}
   headSha256=digest(bytes);headIdentity=stat;
  }
  await currentRoot(pin);return{storeId:expectedStoreId,revision:names.length-1,headSha256,approvals,totalBytes,records:names.length,pin,headIdentity};
 }
 function snapshot(head,extra={}){return frozen({ok:true,scope:'exchange-approval-store',ready:false,storeId:head.storeId,revision:head.revision,headSha256:head.headSha256,approvals:[...head.approvals.values()].sort((a,b)=>key(a)<key(b)?-1:key(a)>key(b)?1:0),...extra});}
 async function publish(directory,record,pin,previous=null){
  const bytes=encoded(record);if(bytes.length>bounds.recordBytes)fail('APPROVAL_CAPACITY_EXCEEDED');
  const temp=path.join(directory,'.tmp-'+crypto.randomUUID()),target=path.join(directory,filename(record.revision));
  let handle,owned=null,published=false;
  async function parentCurrent(){if(previous){const {bytes,stat}=await readFile(directory,filename(previous.revision),pin);if(!sameFile(stat,previous.headIdentity)||stat.birthtimeNs!==previous.headIdentity.birthtimeNs||stat.mtimeNs!==previous.headIdentity.mtimeNs||stat.size!==previous.headIdentity.size||digest(bytes)!==previous.headSha256)fail('APPROVAL_INVALID');}}
  async function ownTemp(){await currentRoot(pin);const stat=await io.lstat(temp,{bigint:true});if(!stat.isFile()||stat.isSymbolicLink()||!owned||!sameFile(stat,owned)||stat.birthtimeNs!==owned.birthtimeNs||stat.mtimeNs!==owned.mtimeNs||stat.size!==owned.size)fail('APPROVAL_INVALID');return stat;}
  try{
   await currentRoot(pin);handle=await io.open(temp,'wx',0o600);owned=await handle.stat({bigint:true});await phase('created');
   await ownTemp();await handle.writeFile(bytes);owned=await handle.stat({bigint:true});await phase('written');
   await ownTemp();await handle.sync();await phase('synced');
   await ownTemp();await handle.close();handle=null;await phase('before-link');
   await ownTemp();const {bytes:delivered}=await readFile(directory,path.basename(temp),pin);if(!delivered.equals(bytes))fail('APPROVAL_INVALID');
   await ownTemp();await parentCurrent();try{await io.link(temp,target);}catch(e){if(e.code==='EEXIST')fail('APPROVAL_CONFLICT');fail('APPROVAL_COMMIT_UNCERTAIN');}
   published=true;await phase('published');await parentCurrent();const {bytes:check,stat:committed}=await readFile(directory,filename(record.revision),pin);if(!sameFile(committed,owned)||committed.birthtimeNs!==owned.birthtimeNs||committed.mtimeNs!==owned.mtimeNs||committed.size!==owned.size||!check.equals(bytes))fail('APPROVAL_COMMIT_UNCERTAIN');return digest(bytes);
  }catch(e){if(published)fail('APPROVAL_COMMIT_UNCERTAIN');throw e;}
  finally{
   if(handle)await handle.close().catch(()=>{});
   // Never clean by pathname after the original directory or temp was replaced.
   if(owned)try{await ownTemp();await io.unlink(temp);}catch{}
  }
 }
 async function result(operation){try{return await operation();}catch(e){return frozen({ok:false,scope:'exchange-approval-store',ready:false,code:CODES.has(e?.message)?e.message:'APPROVAL_IO_FAILED'});}}
 return Object.freeze({
  initialize(directory,storeId){return result(async()=>{
   if(typeof storeId!=='string'||!UUID.test(storeId))fail('APPROVAL_ARGUMENT_INVALID');absolute(directory);const parent=await pinRoot(path.dirname(directory));await currentRoot(parent);
   try{await io.mkdir(directory,{mode:0o700});}catch(e){if(e.code==='EEXIST')fail('APPROVAL_EXISTS');throw e;}
   await currentRoot(parent);const pin=await pinRoot(directory);const record={schemaVersion:1,kind:'genesis',storeId,revision:0,parentSha256:null,approval:null};
   if(encoded(record).length>bounds.totalBytes)fail('APPROVAL_CAPACITY_EXCEEDED');await publish(directory,record,pin);
   try{await currentRoot(pin);const head=await replay(directory,storeId);await currentRoot(pin);return snapshot(head,{committed:true,changed:true});}catch{fail('APPROVAL_COMMIT_UNCERTAIN');}
  });},
  open(directory,expectedStoreId){return result(async()=>snapshot(await replay(directory,expectedStoreId),{committed:false,changed:false}));},
  append(directory,request){return result(async()=>{
   shape(request,['expectedStoreId','expectedRevision','expectedHeadSha256','approval']);
   const expectedStoreId=request.expectedStoreId,expectedRevision=request.expectedRevision,expectedHeadSha256=request.expectedHeadSha256;
   if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||typeof expectedHeadSha256!=='string'||!SHA.test(expectedHeadSha256))fail('APPROVAL_ARGUMENT_INVALID');
   const approval=normalizeApproval(request.approval),head=await replay(directory,expectedStoreId);
   if(head.revision!==expectedRevision||head.headSha256!==expectedHeadSha256)fail('APPROVAL_CONFLICT');
   const next=new Map(head.approvals);if(!apply(next,approval))return snapshot(head,{committed:false,changed:false});
   const record={schemaVersion:1,kind:'approval',storeId:head.storeId,revision:head.revision+1,parentSha256:head.headSha256,approval};
   if(head.records>=bounds.records||head.totalBytes+encoded(record).length>bounds.totalBytes)fail('APPROVAL_CAPACITY_EXCEEDED');
   const headSha256=await publish(directory,record,head.pin,head);return snapshot({...head,revision:record.revision,headSha256,approvals:next},{committed:true,changed:true});
  });}
 });
}
module.exports={createExchangeApprovalStore,EXCHANGE_APPROVAL_STORE_LIMITS:LIMITS};
