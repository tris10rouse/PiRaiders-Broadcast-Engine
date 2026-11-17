'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const fsSync=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {selectionId}=require('../scripts/lib/exchange-fingerprints.cjs');
const {createExchangeMetadataReader,createExchangeCatalogReader}=require('../scripts/lib/exchange-metadata-reader.cjs');
const FEED='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const bytes=value=>Buffer.from(JSON.stringify(value));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let n=0;n<1000;n++){if(predicate())return;await wait(5);}throw Error('TEST_FLIGHT_DID_NOT_DRAIN');}
async function started(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('TEST_READ_NOT_REACHED')),5000);})]);}finally{clearTimeout(timer);}}
function logicalDeadline(t,delayMs){
 const schedule=global.setTimeout,cancel=global.clearTimeout,timers=new Map();let clock=0,fired=0;
 t.mock.method(performance,'now',()=>clock);
 t.mock.method(global,'setTimeout',(fn,ms,...args)=>{if(ms!==delayMs)return schedule(fn,ms,...args);const timer=schedule(()=>{},3600000);timer.unref();timers.set(timer,()=>{fired++;fn(...args);});return timer;});
 t.mock.method(global,'clearTimeout',timer=>{timers.delete(timer);return cancel(timer);});
 t.after(()=>{for(const timer of timers.keys())cancel(timer);});
 return{pending:()=>timers.size,fired:()=>fired,advance(ms){clock+=ms;},expire(){assert.equal(timers.size,1);clock+=delayMs;const[timer,callback]=timers.entries().next().value;timers.delete(timer);cancel(timer);callback();}};
}
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders catalog capture '));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 const binding={feedId:FEED,epoch:1,identityTuple:['2026-2027','EVENT-SYNTHETIC','BOARD-SYNTHETIC','event','synthetic']};
 const id=selectionId(binding.identityTuple);
 function bundle(sequence=1){
  const metadataFingerprint=hash(Buffer.from('synthetic metadata '+sequence));
  const generation='e1-g'+String(sequence).padStart(10,'0')+'-'+metadataFingerprint.slice(0,12);
  const manifest={contractVersion:'piraiders-event-selection/1',...binding,selectionId:id,generation,generationSequence:sequence,
   manifestState:'empty',playbackFingerprint:'d'.repeat(64),metadataFingerprint,occurrences:[],assets:[],problems:[]};
  const entry={selectionId:id,identityTuple:binding.identityTuple,origin:'event',targetBoardKey:'BOARD-SYNTHETIC',displayLabel:'Synthetic',templateButtonKey:null,
   labelShared:false,generation,generationSequence:sequence,manifestPath:'selections/'+id+'/generations/'+generation+'/manifest.json',manifestSha256:hash(bytes(manifest)),
   playbackFingerprint:manifest.playbackFingerprint,metadataFingerprint,occurrenceCount:0,manifestState:'empty'};
  const event={eventKey:'EVENT-SYNTHETIC',displayName:'Synthetic event',eventDate:'2026-11-16',eventType:'Synthetic',homeSchool:'Synthetic school',venue:'Synthetic venue',playbackArea:'Stadium Playback',boardOnly:true,
   eventBoard:{boardKey:'BOARD-SYNTHETIC',displayName:'Synthetic board'},eligibility:{eligible:true,reasonCodes:[]},timing:{timeZone:'America/Chicago',eventStartsAt:null,startSource:'missing',eventEndsAt:null,endSource:'missing',
    broadcastWindow:{startsAt:null,endsAt:null,startSource:'missing',endSource:'missing'},operatingWindow:null,unavailableReasons:['START_NOT_DEFINED','END_NOT_DEFINED']},selections:[entry]};
  return{feed:{contractVersion:'piraiders-event-feed/1',feedId:FEED,epoch:1,createdAt:'2026-11-16T00:00:00Z',publisher:'PiRaiders Scheduler'},
   catalog:{contractVersion:'piraiders-event-catalog/1',feedId:FEED,epoch:1,catalogSequence:sequence,generatedAt:'2026-11-16T00:00:00Z',sourceVersion:'0.0.0',schoolYear:'2026-2027',events:[event]},manifest,entry};
 }
 async function write(relative,value){const file=path.join(root,...relative.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.isBuffer(value)?value:bytes(value));}
 async function publish(value,{manifest=true}={}){await write('feed.json',value.feed);await write('catalog.json',value.catalog);if(manifest)await write(value.entry.manifestPath,value.manifest);}
 const reader=options=>createExchangeMetadataReader({root,binding,...options});
 const catalogReader=options=>createExchangeCatalogReader({root,binding:{feedId:FEED,epoch:1},...options});
 return{root,binding,id,bundle,write,publish,reader,catalogReader};
}
function receipt(result){assert.equal(result.ok,true,result.code);assert.equal(result.code,'CATALOG_CAPTURED');assert.equal(result.ready,false);assert.equal(result.semanticValidation,'pending');assert.equal(Object.isFrozen(result.receipt),true);assert.equal(Object.hasOwn(result,'pin'),false);return result.receipt;}
test('catalog-only capture needs no selected tuple, current, manifest, asset or directory scan',async t=>{
 const f=await fixture(t),value=f.bundle();await f.publish(value,{manifest:false});
 const reader=f.catalogReader(),opendir=fs.opendir,readdir=fs.readdir,open=fs.open,opened=[];
 fs.opendir=fs.readdir=async()=>{throw Error('NO_SCAN');};fs.open=async(file,...args)=>{opened.push(file);return open.call(fs,file,...args);};
 try{const pin=receipt(await reader.capture());assert.equal(pin.catalogSequence,1);assert.equal(pin.documentDigests.catalog,hash(bytes(value.catalog)));assert.equal(pin.documentDigests.feed,hash(bytes(value.feed)));assert.equal(reader.lastCatalogReceipt(),pin);assert.equal(reader.lastPin(),null);assert.deepEqual(opened,[path.join(f.root,'feed.json'),path.join(f.root,'catalog.json')]);assert.equal(Object.hasOwn(reader,'captureWithCatalogReceipt'),false);}finally{Object.assign(fs,{opendir,readdir,open});}
});
test('catalog capture remains independent of selected year and omission while full transport retains its own pin',async t=>{
 const f=await fixture(t),reader=f.reader(),one=f.bundle();await f.publish(one);const first=await reader.capture();assert.equal(first.ok,true);
 const value=f.bundle(2);value.catalog.schoolYear='2027-2028';value.catalog.events=[];await f.publish(value,{manifest:false});
 const pin=receipt(await reader.captureCatalog());assert.equal(pin.catalog.schoolYear,'2027-2028');assert.equal(reader.lastPin(),first.pin);
 assert.equal((await reader.capture()).code,'SELECTION_ABSENT');assert.equal(reader.lastCatalogReceipt(),pin);
});
test('combined capture returns selected transport plus receipt from its own same raw feed/catalog bytes',async t=>{
 const f=await fixture(t),reader=f.reader(),one=f.bundle();await f.publish(one);
 const captured=await reader.captureWithCatalogReceipt();assert.equal(captured.ok,true,captured.code);assert.equal(captured.ready,false);assert.equal(captured.pin.scope,'transport-metadata');
 assert.equal(captured.pin.catalogReceipt.documentDigests.catalog,captured.pin.documentDigests.catalog);assert.equal(captured.pin.catalogReceipt.documentDigests.feed,captured.pin.documentDigests.feed);
 assert.deepEqual(captured.pin.catalogReceipt.catalog,captured.pin.catalog);assert.equal(reader.lastCatalogReceipt(),captured.pin.catalogReceipt);assert.equal(reader.lastPin(),captured.pin);
 assert.equal(Object.isFrozen(captured.pin.catalogReceipt.catalog),true);
 const legacy=await reader.capture();assert.equal(Object.hasOwn(legacy.pin,'catalogReceipt'),false);assert.equal(reader.lastCatalogReceipt(),captured.pin.catalogReceipt);
});
test('failed combined capture never publishes its separately validated catalog receipt',async t=>{
 const f=await fixture(t),reader=f.reader(),one=f.bundle();await f.publish(one);const first=await reader.captureWithCatalogReceipt();assert.equal(first.ok,true);
 const two=f.bundle(2);await f.publish(two,{manifest:false});assert.equal((await reader.captureWithCatalogReceipt()).code,'INPUT_UNAVAILABLE');
 assert.equal(reader.lastCatalogReceipt(),first.pin.catalogReceipt);assert.equal(reader.lastPin(),first.pin);
 const next=receipt(await reader.captureCatalog());assert.equal(next.catalogSequence,2);assert.equal(reader.lastPin(),first.pin);
});
test('validated catalog floor rejects stale and same-sequence changed bytes across all capture methods',async t=>{
 const f=await fixture(t),reader=f.reader(),two=f.bundle(2);await f.publish(two);const first=receipt(await reader.captureCatalog());
 await f.publish(f.bundle(1));for(const method of ['capture','captureCatalog','captureWithCatalogReceipt'])assert.equal((await reader[method]()).code,'METADATA_STALE');
 await f.publish(two);await f.write('catalog.json',Buffer.concat([bytes(two.catalog),Buffer.from('\n')]));
 for(const method of ['capture','captureCatalog','captureWithCatalogReceipt'])assert.equal((await reader[method]()).code,'METADATA_CONFLICT');
 assert.equal(reader.lastCatalogReceipt(),first);assert.equal(reader.lastPin(),null);
});
test('later full capture reconciles its own changed catalog and cannot reuse an earlier receipt',async t=>{
 const f=await fixture(t),reader=f.reader(),one=f.bundle();await f.publish(one);const first=receipt(await reader.captureCatalog());
 const two=f.bundle(2);await f.publish(two);const full=await reader.captureWithCatalogReceipt();assert.equal(full.ok,true,full.code);
 assert.notEqual(full.pin.documentDigests.catalog,first.documentDigests.catalog);assert.equal(full.pin.catalogReceipt.catalogSequence,2);
 assert.equal(full.pin.catalogReceipt.documentDigests.catalog,hash(bytes(two.catalog)));assert.notEqual(full.pin.catalogReceipt,first);
});
test('legacy schema-invalid high transport headers never poison the independent validated catalog floor',async t=>{
 const f=await fixture(t),reader=f.reader(),high=f.bundle(99);delete high.catalog.generatedAt;await f.publish(high);
 const legacy=await reader.capture();assert.equal(legacy.ok,true,'legacy API remains transport-only');assert.equal(reader.lastCatalogReceipt(),null);
 assert.equal((await reader.captureCatalog()).code,'CATALOG_RECEIPT_SCHEMA_INVALID');assert.equal(reader.lastCatalogReceipt(),null);
 await f.publish(f.bundle(1));const valid=receipt(await reader.captureCatalog());assert.equal(valid.catalogSequence,1);assert.equal(reader.lastPin(),legacy.pin);
 const combined=await reader.captureWithCatalogReceipt();assert.equal(combined.ok,true,combined.code);assert.equal(combined.pin.descriptor.generationSequence,1);assert.equal(combined.pin.catalogReceipt,reader.lastCatalogReceipt());
});
test('full catalog schemas and expected binding fail without receipt or raw diagnostics',async t=>{
 const f=await fixture(t),reader=f.catalogReader(),one=f.bundle();await f.publish(one);const first=receipt(await reader.capture());
 for(const mutate of [x=>delete x.catalog.generatedAt,x=>x.catalog.events=[{eventKey:'private-source-value',selections:[]}],x=>x.catalog.events[0].selections[0].manifestPath='../private-source-value']){
  const next=f.bundle(2);mutate(next);await f.publish(next,{manifest:false});const result=await reader.capture();assert.equal(result.ok,false);assert.equal(result.code,'CATALOG_RECEIPT_SCHEMA_INVALID');assert.doesNotMatch(JSON.stringify(result),/private-source-value|stack/);assert.equal(reader.lastCatalogReceipt(),first);
 }
 const foreign=f.bundle(2);foreign.feed.epoch=2;await f.publish(foreign,{manifest:false});assert.equal((await reader.capture()).code,'REBIND_REQUIRED');assert.equal(reader.lastCatalogReceipt(),first);
});
test('all modes share BUSY and timeout retains physical flight until actual handle cleanup',async t=>{
 const f=await fixture(t),deadline=logicalDeadline(t,1000),reader=f.reader({timeoutMs:1000});await f.publish(f.bundle());const first=receipt(await reader.captureCatalog());await f.publish(f.bundle(2));
 const open=fs.open,catalog=path.join(f.root,'catalog.json');let release,entered;const block=new Promise(resolve=>release=resolve),start=new Promise(resolve=>entered=resolve);
 fs.open=async(file,...args)=>{if(file===catalog){entered();await block;}return open.call(fs,file,...args);};
 try{const pending=reader.captureCatalog();await started(start);for(const method of ['capture','captureCatalog','captureWithCatalogReceipt'])assert.equal((await reader[method]()).code,'READER_BUSY');deadline.expire();assert.equal((await pending).code,'CAPTURE_TIMEOUT');assert.equal(reader.snapshot().busy,true);assert.equal(reader.lastCatalogReceipt(),first);assert.equal(reader.lastPin(),null);release();await until(()=>!reader.snapshot().busy);assert.equal(reader.lastCatalogReceipt(),first);}finally{release();fs.open=open;}
 assert.equal(receipt(await reader.captureCatalog()).catalogSequence,2);
});
test('close fences a blocked combined flight and preserves previously committed receipt and pin',async t=>{
 const f=await fixture(t),reader=f.reader();await f.publish(f.bundle());const first=await reader.captureWithCatalogReceipt();assert.equal(first.ok,true);await f.publish(f.bundle(2));
 const open=fs.open;let release,entered;const block=new Promise(resolve=>release=resolve),start=new Promise(resolve=>entered=resolve);
 fs.open=async(file,...args)=>{if(file===path.join(f.root,'catalog.json')){entered();await block;}return open.call(fs,file,...args);};
 try{const pending=reader.captureWithCatalogReceipt();await started(start);for(const method of ['capture','captureCatalog','captureWithCatalogReceipt'])assert.equal((await reader[method]()).code,'READER_BUSY');reader.close();assert.equal((await pending).code,'READER_CLOSED');assert.equal(reader.snapshot().busy,true);assert.equal((await reader.captureCatalog()).code,'READER_CLOSED');release();await until(()=>!reader.snapshot().busy);assert.equal(reader.lastPin(),first.pin);assert.equal(reader.lastCatalogReceipt(),first.pin.catalogReceipt);}finally{release();fs.open=open;}
});
test('late synchronous raw validation is fenced by the original monotonic deadline before timer callbacks',{timeout:10000},async t=>{
 const f=await fixture(t),deadline=logicalDeadline(t,1000),reader=f.reader({timeoutMs:1000});await f.publish(f.bundle());const first=receipt(await reader.captureCatalog());
 const two=f.bundle(2),catalogBytes=bytes(two.catalog);await f.publish(two);let matches=0;
 const createHash=crypto.createHash;
 t.mock.method(crypto,'createHash',(...args)=>{const instance=createHash(...args),update=instance.update.bind(instance);instance.update=(value,...rest)=>{if(Buffer.isBuffer(value)&&value.equals(catalogBytes)&&++matches===2){assert.equal(deadline.pending(),1,'original capture timer remains armed');deadline.advance(1000);}return update(value,...rest);};return instance;});
 const value=await reader.captureCatalog();assert.equal(matches,2,'read digest then independent raw validation digest');assert.equal(value.code,'CAPTURE_TIMEOUT');assert.equal(deadline.fired(),0);assert.equal(deadline.pending(),0);assert.equal(reader.lastCatalogReceipt(),first);assert.equal(reader.snapshot().busy,false);
});
test('catalog backend initializes lazily inside capture and fixed backend failure can recover',async t=>{
 const f=await fixture(t),read=fsSync.readFileSync;let reads=0;
 t.mock.method(fsSync,'readFileSync',(file,...args)=>{if(String(file).includes('exchange-schemas')){reads++;throw Error('private-schema-path');}return read(file,...args);});
 const reader=f.catalogReader();assert.equal(reads,0);assert.equal((await reader.capture()).code,'INPUT_UNAVAILABLE');assert.equal(reads,0);
 await f.publish(f.bundle(),{manifest:false});const failure=await reader.capture();assert.equal(failure.code,'CATALOG_RECEIPT_BACKEND_UNAVAILABLE');assert.equal(reader.lastCatalogReceipt(),null);assert.doesNotMatch(JSON.stringify(failure),/private-schema-path|stack/);assert.ok(reads>0);
 t.mock.restoreAll();assert.equal(receipt(await reader.capture()).catalogSequence,1);
});
test('catalog-only binding rejects selected tuples, accessors and invalid epochs before source reads',()=>{
 const root=path.resolve(os.tmpdir(),'synthetic-catalog-reader');
 for(const binding of [{feedId:FEED,epoch:0},{feedId:FEED,epoch:1,identityTuple:[]},{feedId:FEED.toUpperCase(),epoch:1}])assert.throws(()=>createExchangeCatalogReader({root,binding}),{message:'METADATA_INVALID'});
 let calls=0;const binding={feedId:FEED,epoch:1};Object.defineProperty(binding,'epoch',{enumerable:true,get(){calls++;throw Error('private');}});
 assert.throws(()=>createExchangeCatalogReader({root,binding}),{message:'METADATA_INVALID'});assert.equal(calls,0);
});


test('combined mode accepts identical selected entries with one pointer/manifest read while legacy stays strict',async t=>{
 const f=await fixture(t),value=f.bundle(),reader=f.reader();value.catalog.events[0].selections.push(JSON.parse(JSON.stringify(value.entry)));await f.publish(value);
 const current={contractVersion:'piraiders-event-current/1',feedId:FEED,epoch:1};
 for(const key of ['selectionId','identityTuple','generation','generationSequence','manifestState','playbackFingerprint','metadataFingerprint','manifestPath','manifestSha256'])current[key]=value.entry[key];
 await f.write('selections/'+f.id+'/current.json',current);
 const open=fs.open,currentFile=path.join(f.root,'selections',f.id,'current.json'),manifestFile=path.join(f.root,...value.entry.manifestPath.split('/'));let currentReads=0,manifestReads=0;
 fs.open=async(file,...args)=>{if(file===currentFile)currentReads++;if(file===manifestFile)manifestReads++;return open.call(fs,file,...args);};
 try{const combined=await reader.captureWithCatalogReceipt();assert.equal(combined.ok,true,combined.code);assert.equal(currentReads,1);assert.equal(manifestReads,1);assert.equal(combined.pin.catalogReceipt.catalog.events[0].selections.length,2);
  assert.equal((await reader.capture()).code,'METADATA_INVALID');assert.equal(currentReads,1);assert.equal(manifestReads,1);assert.equal(reader.lastPin(),combined.pin);
  value.catalog.events[0].selections[1].occurrenceCount=1;await f.publish(value);const rejected=await reader.captureWithCatalogReceipt();assert.equal(rejected.code,'CATALOG_RECEIPT_CONTEXT_INVALID');assert.equal(currentReads,1);assert.equal(manifestReads,1);assert.equal(reader.lastCatalogReceipt(),combined.pin.catalogReceipt);
 }finally{fs.open=open;}
});

test('combined current-ahead capture keeps catalog receipt and selected generation distinct',async t=>{
 const f=await fixture(t),one=f.bundle(1),two=f.bundle(2);await f.publish(one);await f.write(two.entry.manifestPath,two.manifest);
 const current={contractVersion:'piraiders-event-current/1',feedId:FEED,epoch:1};
 for(const key of ['selectionId','identityTuple','generation','generationSequence','manifestState','playbackFingerprint','metadataFingerprint','manifestPath','manifestSha256'])current[key]=two.entry[key];
 await f.write('selections/'+f.id+'/current.json',current);
 const result=await f.reader().captureWithCatalogReceipt();assert.equal(result.ok,true,result.code);assert.equal(result.ready,false);
 assert.equal(result.pin.descriptor.generationSequence,2);assert.equal(result.pin.manifest.generationSequence,2);
 assert.equal(result.pin.catalogReceipt.catalog.events[0].selections[0].generationSequence,1);
 assert.equal(result.pin.catalogReceipt.documentDigests.catalog,hash(bytes(one.catalog)));
 assert.equal(result.pin.documentDigests.manifest,hash(bytes(two.manifest)));
});

test('catalog timeout retains physical ownership through a blocked real file-handle close',{timeout:10000},async t=>{
 const f=await fixture(t),deadline=logicalDeadline(t,1000),reader=f.reader({timeoutMs:1000});await f.publish(f.bundle());const first=receipt(await reader.captureCatalog());await f.publish(f.bundle(2));
 const open=fs.open,catalog=path.join(f.root,'catalog.json');let release,entered,closed=false;
 const block=new Promise(resolve=>release=resolve),start=new Promise(resolve=>entered=resolve);
 fs.open=async(file,...args)=>{const handle=await open.call(fs,file,...args);if(file!==catalog)return handle;return{stat:handle.stat.bind(handle),read:handle.read.bind(handle),close:async()=>{entered();await block;await handle.close();closed=true;}};};
 try{const pending=reader.captureCatalog();await started(start);deadline.expire();assert.equal((await pending).code,'CAPTURE_TIMEOUT');assert.equal(closed,false);assert.equal(reader.snapshot().busy,true);assert.equal((await reader.captureWithCatalogReceipt()).code,'READER_BUSY');assert.equal(reader.lastCatalogReceipt(),first);release();await until(()=>!reader.snapshot().busy);assert.equal(closed,true);assert.equal(reader.lastCatalogReceipt(),first);}finally{release();fs.open=open;}
 assert.equal(receipt(await reader.captureCatalog()).catalogSequence,2);
});
