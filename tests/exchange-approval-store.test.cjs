'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process');
const {createExchangeApprovalStore,EXCHANGE_APPROVAL_STORE_LIMITS:LIMITS}=require('../scripts/lib/exchange-approval-store.cjs');
const STORE='00000000-0000-4000-8000-000000000001',OTHER='00000000-0000-4000-8000-000000000002';
const name=n=>String(n).padStart(12,'0')+'.json';
function approval(){return{type:'confirm',providerId:'school-feed',machinePolicyFingerprint:'a'.repeat(64),binding:{feedId:OTHER,epoch:1},identityTuple:['2026-2027','EV-SYNTHETIC','BOARD-SYNTHETIC','event','synthetic'],productionWindow:{start:'2026-11-17T12:00:00-06:00',end:'2026-11-17T14:00:00-06:00'},offline:null,confirmation:true};}
function request(head,value=approval()){return{expectedStoreId:head.storeId,expectedRevision:head.revision,expectedHeadSha256:head.headSha256,approval:value};}
function revoke(value=approval()){return{type:'revoke',providerId:value.providerId,binding:value.binding,identityTuple:value.identityTuple,confirmation:true};}
if(process.argv[2]==='--approval-child'){
 const [dir,raw,barrier]=process.argv.slice(3);let unblocked=false;
 const atPhase=async p=>{if(p!==barrier||unblocked)return;unblocked=true;process.send({type:'barrier',phase:p});await new Promise(resolve=>process.once('message',resolve));};
 const io={...fs,async open(...args){const handle=await fs.open(...args);if(args[1]!=='wx'||barrier!=='partial-write')return handle;
  return{stat:handle.stat.bind(handle),sync:handle.sync.bind(handle),close:handle.close.bind(handle),async writeFile(bytes){await handle.writeFile(bytes.subarray(0,10));await atPhase('partial-write');await handle.writeFile(bytes.subarray(10));}};
 }};
 const store=createExchangeApprovalStore({io,phase:atPhase});
 const input=JSON.parse(raw);const pending=input.initialize?(async()=>{if(barrier==='initialize-start'){process.send({type:'barrier'});await new Promise(resolve=>process.once('message',resolve));}return store.initialize(dir,input.storeId);})():store.append(dir,input);
 pending.then(result=>process.send({type:'result',result},()=>process.disconnect()));
}else{
 const test=require('node:test'),assert=require('node:assert/strict');
 async function fixture(t){const raw=await fs.mkdtemp(path.join(os.tmpdir(),'piraiders-approval-')),parent=await fs.realpath(raw);t.after(()=>fs.rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100}));return{parent,directory:path.join(parent,'approvals')};}
 async function initialized(t){const f=await fixture(t),store=createExchangeApprovalStore(),head=await store.initialize(f.directory,STORE);assert.equal(head.ok,true,head.code);return{...f,store,head};}
 function rejected(v,code){assert.deepEqual(v,{ok:false,scope:'exchange-approval-store',ready:false,code});}
 function child(t,dir,input,barrier){const child=cp.fork(__filename,['--approval-child',dir,JSON.stringify(input),barrier],{stdio:['ignore','ignore','ignore','ipc'],execArgv:[]});const messages=[],waits=[];
  child.on('message',v=>{const i=waits.findIndex(w=>w.type===v.type);if(i<0)messages.push(v);else waits.splice(i,1)[0].resolve(v);});const exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exit;});return{child,exit,next(type){const i=messages.findIndex(v=>v.type===type);if(i>=0)return Promise.resolve(messages.splice(i,1)[0]);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CHILD_BARRIER_TIMEOUT')),15000);waits.push({type,resolve:v=>{clearTimeout(timer);resolve(v);}});});}};
 }
 test('explicit initialize/reopen requires retained store UUID and never creates or repairs missing stores',async t=>{
  const f=await fixture(t),store=createExchangeApprovalStore();rejected(await store.open(f.directory,STORE),'APPROVAL_MISSING');await assert.rejects(fs.stat(f.directory),{code:'ENOENT'});
  const head=await store.initialize(f.directory,STORE);assert.equal(head.ok,true);assert.equal(head.revision,0);assert.deepEqual(head.approvals,[]);assert.equal(head.ready,false);assert.equal(Object.isFrozen(head.approvals),true);
  assert.equal((await store.open(f.directory,STORE)).headSha256,head.headSha256);rejected(await store.initialize(f.directory,STORE),'APPROVAL_EXISTS');rejected(await store.open(f.directory,OTHER),'APPROVAL_INVALID');
  await fs.unlink(path.join(f.directory,name(0)));rejected(await store.open(f.directory,STORE),'APPROVAL_INVALID');rejected(await store.initialize(f.directory,STORE),'APPROVAL_EXISTS');
 });
 test('actual child death during initialization leaves an existing incomplete store, never automatic repair',async t=>{
  const f=await fixture(t),p=child(t,f.directory,{initialize:true,storeId:STORE},'partial-write');await p.next('barrier');p.child.kill('SIGKILL');await p.exit;
  const store=createExchangeApprovalStore();rejected(await store.open(f.directory,STORE),'APPROVAL_INVALID');rejected(await store.initialize(f.directory,STORE),'APPROVAL_EXISTS');
  const names=await fs.readdir(f.directory);assert.equal(names.length,1);assert.ok(names[0].startsWith('.tmp-'));assert.equal((await fs.stat(path.join(f.directory,names[0]))).size,10);
 });
 test('confirm canonicalizes explicit window once, preserves full identity, persists offline reference and remains data only',async t=>{
  const f=await initialized(t),value=approval();value.identityTuple[4]='😀'.repeat(200);value.offline={snapshotId:STORE,playbackFingerprint:'b'.repeat(64)};
  const next=await f.store.append(f.directory,request(f.head,value));assert.equal(next.ok,true,next.code);assert.equal(next.revision,1);assert.equal(next.ready,false);
  assert.equal(next.approvals[0].productionWindow.start,'2026-11-17T18:00:00.000Z');assert.equal(next.approvals[0].productionWindow.prewarmMinutes,15);assert.deepEqual(next.approvals[0].identityTuple,value.identityTuple);assert.equal(Object.isFrozen(next.approvals[0].offline),true);
  const reopened=await createExchangeApprovalStore().open(f.directory,STORE);assert.deepEqual(reopened.approvals,next.approvals);assert.equal(reopened.headSha256,next.headSha256);assert.equal(typeof reopened.authorizeOffline,'undefined');
 });
 test('identical confirms and absent revocations are no-ops before history capacity; revocation survives reopen',async t=>{
  const f=await initialized(t),store=createExchangeApprovalStore({limits:{...LIMITS,records:3}});let h=await store.append(f.directory,request(f.head));assert.equal(h.ok,true);
  const same=await store.append(f.directory,request(h));assert.equal(same.changed,false);assert.equal(same.headSha256,h.headSha256);
  h=await store.append(f.directory,request(h,revoke()));assert.equal(h.ok,true);assert.deepEqual(h.approvals,[]);assert.equal(h.revision,2);
  assert.equal((await store.append(f.directory,request(h,revoke()))).changed,false);assert.deepEqual((await store.open(f.directory,STORE)).approvals,[]);
  rejected(await store.append(f.directory,request(h)),'APPROVAL_CAPACITY_EXCEEDED');
 });
 test('machine policy/window/cache change replaces only its exact provider binding tuple; stale CAS and revocations cannot overwrite',async t=>{
  const f=await initialized(t),a=await f.store.append(f.directory,request(f.head));let value=approval();value.machinePolicyFingerprint='b'.repeat(64);value.productionWindow.prewarmMinutes=0;
  const b=await f.store.append(f.directory,request(a,value));assert.equal(b.ok,true);assert.equal(b.approvals.length,1);assert.equal(b.approvals[0].machinePolicyFingerprint,'b'.repeat(64));
  rejected(await f.store.append(f.directory,request(a,revoke())),'APPROVAL_CONFLICT');rejected(await f.store.append(f.directory,{...request(b),expectedHeadSha256:'0'.repeat(64)}),'APPROVAL_CONFLICT');
  value=approval();value.binding.epoch=2;const c=await f.store.append(f.directory,request(b,value));assert.equal(c.approvals.length,2);
 });
 test('strict JSON fields and scalars reject without accessors/coercion/thenable execution or private error echoes',async t=>{
  const f=await initialized(t);let calls=0;
  const invalid=[v=>v.confirmation=false,v=>v.machinePolicyFingerprint='PRIVATE',v=>v.offline={snapshotId:STORE,playbackFingerprint:'bad'},v=>v.identityTuple[4]='x'.repeat(201),v=>v.identityTuple[2]='PRIVATE\u0000',v=>v.productionWindow.start='2026-11-17T12:00:00',v=>v.productionWindow.extra=true,v=>v.providerId='UPPER',v=>v.binding.epoch=1000000,v=>v.extra='PRIVATE',v=>delete v.offline,v=>v.identityTuple[3]='other',v=>{delete v.identityTuple[1];},v=>v.identityTuple.push('extra'),v=>v.identityTuple[4]='\ud800',v=>v.productionWindow={start:'2026-02-30T00:00:00Z',end:'2026-03-01T00:00:00Z'}];
  for(const mutate of invalid){const v=approval();mutate(v);const r=await f.store.append(f.directory,request(f.head,v));rejected(r,'APPROVAL_RECORD_REJECTED');assert.ok(!JSON.stringify(r).includes('PRIVATE'));}
  for(const field of ['productionWindow','binding','identityTuple']){const v=approval();Object.defineProperty(v,field,{enumerable:true,get(){calls++;throw Error('PRIVATE');}});rejected(await f.store.append(f.directory,request(f.head,v)),'APPROVAL_RECORD_REJECTED');}
  const r=request(f.head);Object.defineProperty(r,'approval',{enumerable:true,get(){calls++;return approval();}});rejected(await f.store.append(f.directory,r),'APPROVAL_ARGUMENT_INVALID');assert.equal(calls,0);
 });
 test('caller data is copied before first await and lower effective-state capacity never silently evicts',async t=>{
  const f=await initialized(t),value=approval();const pending=f.store.append(f.directory,request(f.head,value));value.binding.epoch=2;value.productionWindow.start='bad';assert.equal((await pending).approvals[0].binding.epoch,1);
  const head=await f.store.open(f.directory,STORE),store=createExchangeApprovalStore({limits:{...LIMITS,approvals:1}}),other=approval();other.identityTuple[1]='OTHER';rejected(await store.append(f.directory,request(head,other)),'APPROVAL_CAPACITY_EXCEEDED');assert.equal((await f.store.open(f.directory,STORE)).approvals.length,1);
 });
 test('actual child-process competing appenders publish one immutable next record and return one conflict',async t=>{
  const f=await initialized(t),a=child(t,f.directory,request(f.head),'before-link'),other=approval();other.machinePolicyFingerprint='b'.repeat(64);const b=child(t,f.directory,request(f.head,other),'before-link');await Promise.all([a.next('barrier'),b.next('barrier')]);a.child.send('go');b.child.send('go');const results=await Promise.all([a.next('result'),b.next('result')]);
  assert.equal(results.filter(x=>x.result.ok).length,1);assert.equal(results.find(x=>!x.result.ok).result.code,'APPROVAL_CONFLICT');await Promise.all([a.exit,b.exit]);const head=await f.store.open(f.directory,STORE);assert.equal(head.revision,1);assert.equal(head.approvals.length,1);
 });
 test('actual child-process competing initializers cannot both create a store',async t=>{
  const f=await fixture(t),a=child(t,f.directory,{initialize:true,storeId:STORE},'initialize-start'),b=child(t,f.directory,{initialize:true,storeId:STORE},'initialize-start');
  await Promise.all([a.next('barrier'),b.next('barrier')]);a.child.send('go');b.child.send('go');const results=await Promise.all([a.next('result'),b.next('result')]);assert.equal(results.filter(x=>x.result.ok).length,1);assert.equal(results.find(x=>!x.result.ok).result.code,'APPROVAL_EXISTS');await Promise.all([a.exit,b.exit]);assert.equal((await createExchangeApprovalStore().open(f.directory,STORE)).ok,true);
 });
 test('process termination before and after publication preserves only complete old/new prefixes',async t=>{
  for(const phase of ['created','partial-write','written','synced','before-link','published'])await t.test(phase,async t=>{const f=await initialized(t),p=child(t,f.directory,request(f.head),phase);await p.next('barrier');p.child.kill('SIGKILL');await p.exit;const head=await f.store.open(f.directory,STORE);assert.equal(head.ok,true,head.code);assert.equal(head.revision,phase==='published'?1:0);assert.equal(head.approvals.length,phase==='published'?1:0);});
 });
 test('corrupt, gapped, noncanonical, unknown and foreign history fails closed without resetting',async t=>{
  for(const mutate of [async d=>fs.writeFile(path.join(d,name(0)),'{'),async d=>fs.rename(path.join(d,name(0)),path.join(d,name(1))),async d=>fs.writeFile(path.join(d,'foreign.txt'),'PRIVATE'),async d=>{const p=path.join(d,name(0));await fs.writeFile(p,(await fs.readFile(p,'utf8'))+' ');}]){const f=await initialized(t);await mutate(f.directory);rejected(await f.store.open(f.directory,STORE),'APPROVAL_INVALID');rejected(await f.store.initialize(f.directory,STORE),'APPROVAL_EXISTS');}
 });
 test('ambiguous actual hard-link acknowledgement requires reopen and never retries or deletes committed history',async t=>{
  const f=await initialized(t),store=createExchangeApprovalStore({io:{...fs,async link(a,b){await fs.link(a,b);throw Error('PRIVATE');}}});rejected(await store.append(f.directory,request(f.head)),'APPROVAL_COMMIT_UNCERTAIN');const head=await f.store.open(f.directory,STORE);assert.equal(head.revision,1);assert.equal(head.approvals.length,1);rejected(await f.store.append(f.directory,request(f.head)),'APPROVAL_CONFLICT');
 });
 test('byte-identical foreign committed-name replacement is uncertain and never removed',async t=>{
  const f=await initialized(t);let foreign;
  const store=createExchangeApprovalStore({phase:async phase=>{if(phase!=='published')return;const target=path.join(f.directory,name(1));foreign=await fs.readFile(target);await fs.rename(target,path.join(f.parent,'original-commit'));await fs.writeFile(target,foreign);}});
  rejected(await store.append(f.directory,request(f.head)),'APPROVAL_COMMIT_UNCERTAIN');assert.deepEqual(await fs.readFile(path.join(f.directory,name(1))),foreign);
 });
 test('phase-hook exceptions before publication cannot acknowledge and post-publication exceptions are uncertain',async t=>{
  for(const phase of ['written','synced','before-link','published']){const f=await initialized(t),store=createExchangeApprovalStore({phase:async p=>{if(p===phase)throw Error('PRIVATE');}});const result=await store.append(f.directory,request(f.head));rejected(result,phase==='published'?'APPROVAL_COMMIT_UNCERTAIN':'APPROVAL_IO_FAILED');assert.equal((await f.store.open(f.directory,STORE)).revision,phase==='published'?1:0);}
 });
 test('actual write, sync and close operation errors cannot acknowledge incomplete publication',async t=>{
  for(const failed of ['writeFile','sync','close']){const f=await initialized(t);let injected=false;
   const io={...fs,async open(...args){const h=await fs.open(...args);if(args[1]!=='wx')return h;
    return{stat:h.stat.bind(h),async writeFile(bytes){if(failed==='writeFile'){injected=true;await h.writeFile(bytes.subarray(0,10));throw Error('PRIVATE_WRITE');}return h.writeFile(bytes);},
     async sync(){if(failed==='sync'){injected=true;throw Error('PRIVATE_SYNC');}return h.sync();},async close(){if(failed==='close'&&!injected){injected=true;await h.close();throw Error('PRIVATE_CLOSE');}return h.close();}};
   }};
   rejected(await createExchangeApprovalStore({io}).append(f.directory,request(f.head)),'APPROVAL_IO_FAILED');assert.equal(injected,true);
   const reopened=await f.store.open(f.directory,STORE);assert.equal(reopened.ok,true,reopened.code);assert.equal(reopened.revision,0);assert.deepEqual(reopened.approvals,[]);
  }
 });
 test('root replacement before link never writes or cleans foreign directory or its temp',async t=>{
  const f=await initialized(t),moved=path.join(f.parent,'moved');let temp;const store=createExchangeApprovalStore({phase:async phase=>{if(phase!=='before-link')return;temp=(await fs.readdir(f.directory)).find(x=>x.startsWith('.tmp-'));await fs.rename(f.directory,moved);await fs.mkdir(f.directory);await fs.writeFile(path.join(f.directory,temp),'FOREIGN');}});
  rejected(await store.append(f.directory,request(f.head)),'APPROVAL_INVALID');assert.equal(await fs.readFile(path.join(f.directory,temp),'utf8'),'FOREIGN');assert.deepEqual((await fs.readdir(f.directory)),[temp]);assert.equal((await fs.readdir(moved)).filter(x=>x.startsWith('.tmp-')).length,1);assert.equal((await createExchangeApprovalStore().open(moved,STORE)).revision,0);
 });
 test('temp replacement and prior-head mutation are detected before immutable publication and foreign bytes preserved',async t=>{
  for(const replacement of ['temp','head','identical-head']){const f=await initialized(t);let temp;const store=createExchangeApprovalStore({phase:async phase=>{if(phase!=='before-link')return;temp=(await fs.readdir(f.directory)).find(x=>x.startsWith('.tmp-'));if(replacement==='temp'){await fs.unlink(path.join(f.directory,temp));await fs.writeFile(path.join(f.directory,temp),'FOREIGN');}else if(replacement==='head')await fs.writeFile(path.join(f.directory,name(0)),'FOREIGN');else{const p=path.join(f.directory,name(0)),b=await fs.readFile(p);await fs.rename(p,path.join(f.parent,'old-head'));await fs.writeFile(p,b);}}});
   rejected(await store.append(f.directory,request(f.head)),'APPROVAL_INVALID');await assert.rejects(fs.stat(path.join(f.directory,name(1))),{code:'ENOENT'});if(replacement==='temp')assert.equal(await fs.readFile(path.join(f.directory,temp),'utf8'),'FOREIGN');}
 });
 test('pinned ancestry rejects directory aliases without traversing them',async t=>{
  const f=await initialized(t),alias=path.join(f.parent,'alias');
  try{await fs.symlink(f.directory,alias,process.platform==='win32'?'junction':'dir');}catch(e){if(process.platform==='win32'&&['EPERM','EACCES'].includes(e.code)){t.skip('Windows directory-link privilege unavailable');return;}throw e;}
  rejected(await f.store.open(alias,STORE),'APPROVAL_INVALID');
 });
 test('record aliases fail closed when file symlink creation is available',async t=>{
  const f=await initialized(t),record=path.join(f.directory,name(0)),moved=path.join(f.parent,'genesis');await fs.rename(record,moved);
  try{await fs.symlink(moved,record,'file');}catch(e){if(process.platform==='win32'&&['EPERM','EACCES'].includes(e.code)){t.skip('Windows file-symlink privilege unavailable; separate junction test still runs');return;}throw e;}
  rejected(await f.store.open(f.directory,STORE),'APPROVAL_INVALID');
 });
 test('record, aggregate and temporary bounds fail closed and factory cannot raise resource caps',async t=>{
  for(const limits of [{...LIMITS,recordBytes:0},{...LIMITS,records:4097},{...LIMITS,unknown:1}])assert.throws(()=>createExchangeApprovalStore({limits}));
  const f=await initialized(t);rejected(await createExchangeApprovalStore({limits:{...LIMITS,recordBytes:1}}).open(f.directory,STORE),'APPROVAL_INVALID');
  rejected(await createExchangeApprovalStore({limits:{...LIMITS,totalBytes:1}}).open(f.directory,STORE),'APPROVAL_CAPACITY_EXCEEDED');
  await fs.writeFile(path.join(f.directory,'.tmp-'+STORE),'x');await fs.writeFile(path.join(f.directory,'.tmp-'+OTHER),'x');rejected(await createExchangeApprovalStore({limits:{...LIMITS,temporaryFiles:1}}).open(f.directory,STORE),'APPROVAL_CAPACITY_EXCEEDED');
 });
}
