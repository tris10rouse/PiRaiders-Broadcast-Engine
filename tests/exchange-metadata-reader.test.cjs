'use strict';
// Synthetic envelope-only metadata. These are deliberately not complete schema
// fixtures; the reader must never claim semantic/content readiness for them.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {createExchangeMetadataReader}=require('../scripts/lib/exchange-metadata-reader.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const bytes=value=>Buffer.from(JSON.stringify(value,null,2));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let n=0;n<1000;n++){if(predicate())return;await wait(5);}throw Error('TEST_FLIGHT_DID_NOT_DRAIN');}
async function started(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('TEST_READ_NOT_REACHED')),5000);})]);}finally{clearTimeout(timer);}}
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders metadata capture '));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 const binding={feedId:'00000000-0000-4000-8000-000000000001',epoch:1,identityTuple:['2026-2027','EV-SYNTHETIC','BOARD-SYNTHETIC','event','synthetic button']};
 const selectionId='sel_'+hash(Buffer.from(JSON.stringify(binding.identityTuple))).slice(0,32);
 function bundle(sequence=1){
  const metadataFingerprint=hash(Buffer.from('unverified synthetic metadata '+sequence)),generation='e1-g'+String(sequence).padStart(10,'0')+'-'+metadataFingerprint.slice(0,12);
  const manifest={contractVersion:'piraiders-event-selection/1',...binding,selectionId,generation,generationSequence:sequence,manifestState:'empty',playbackFingerprint:hash(Buffer.from('unverified synthetic playback')),metadataFingerprint,occurrences:[],assets:[],problems:[]};
  const current={...manifest,contractVersion:'piraiders-event-current/1',manifestPath:'selections/'+selectionId+'/generations/'+generation+'/manifest.json',manifestSha256:hash(bytes(manifest))};delete current.occurrences;delete current.assets;delete current.problems;
  const entry={...current};delete entry.feedId;delete entry.epoch;delete entry.contractVersion;
  return{feed:{contractVersion:'piraiders-event-feed/1',feedId:binding.feedId,epoch:1,publisher:'PiRaiders Scheduler',createdAt:'2026-10-01T00:00:00Z'},catalog:{contractVersion:'piraiders-event-catalog/1',feedId:binding.feedId,epoch:1,catalogSequence:sequence,schoolYear:'2026-2027',events:[{eventKey:binding.identityTuple[1],selections:[entry]}]},current,manifest};
 }
 async function write(relative,value){const file=path.join(root,...relative.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,Buffer.isBuffer(value)?value:bytes(value));}
 async function publish(value,{manifest=true,current=true}={}){await write('feed.json',value.feed);await write('catalog.json',value.catalog);if(current)await write('selections/'+selectionId+'/current.json',value.current);if(manifest)await write(value.current.manifestPath,value.manifest);}
 const reader=options=>createExchangeMetadataReader({root,binding,...options});return{root,binding,selectionId,bundle,write,publish,reader};
}
test('captures one exact descriptor and delivered-byte digest without readiness, scans, assets or source writes',async t=>{
 const f=await fixture(t),input=f.bundle();await f.publish(input);await f.write('unreferenced/private.json',{private:'not membership'});
 const original={opendir:fs.opendir,readdir:fs.readdir};let scans=0;fs.opendir=fs.readdir=async()=>{scans++;throw Error('must not scan');};
 try{const reader=f.reader(),value=await reader.capture();assert.equal(value.ok,true);assert.equal(value.code,'METADATA_CAPTURED');assert.equal(value.ready,false);assert.equal(value.semanticValidation,'pending');assert.equal(value.pin.ready,false);assert.equal(value.pin.semanticValidation,'pending');assert.equal(value.pin.scope,'transport-metadata');assert.equal(value.pin.documentDigests.manifest,hash(bytes(input.manifest)));assert.equal(value.pin.descriptor.selectionId,f.selectionId);assert.equal(Object.isFrozen(value.pin.manifest),true);assert.equal(Object.isFrozen(value.pin.descriptor.identityTuple),true);assert.equal(scans,0);assert.equal(reader.lastPin(),value.pin);}finally{Object.assign(fs,original);}
});
test('pointer-before-manifest arrival retains previous pin and recovers without mixing generations',async t=>{
 const f=await fixture(t),reader=f.reader();await f.publish(f.bundle(1));const first=await reader.capture();await f.publish(f.bundle(2),{manifest:false});
 const missing=await reader.capture();assert.equal(missing.code,'INPUT_UNAVAILABLE');assert.equal(reader.lastPin(),first.pin);
 await f.write(f.bundle(2).current.manifestPath,f.bundle(2).manifest);const recovered=await reader.capture();assert.equal(recovered.ok,true);assert.equal(recovered.pin.descriptor.generationSequence,2);assert.equal(recovered.ready,false);
});
test('current is read once per flight; later pointer arrival is considered only on the next capture',async t=>{
 const f=await fixture(t),one=f.bundle(1),two=f.bundle(2),reader=f.reader();await f.publish(one);await f.write(two.current.manifestPath,two.manifest);
 const open=fs.open,currentFile=path.join(f.root,'selections',f.selectionId,'current.json'),manifestFile=path.join(f.root,...one.current.manifestPath.split('/'));let currentReads=0;
 fs.open=async function(file,...args){if(file===currentFile)currentReads++;if(file===manifestFile)await f.write('selections/'+f.selectionId+'/current.json',two.current);return open.call(fs,file,...args);};
 try{const value=await reader.capture();assert.equal(value.pin.descriptor.generationSequence,1);assert.equal(currentReads,1);}finally{fs.open=open;}
 const next=await reader.capture();assert.equal(next.pin.descriptor.generationSequence,2);
});
test('newer delivered catalog descriptor can be pinned while current is older or absent',async t=>{
 const f=await fixture(t),one=f.bundle(1),two=f.bundle(2);await f.publish(one);await f.publish(two,{current:false});const first=await f.reader().capture();assert.equal(first.pin.descriptor.generationSequence,2);
 await fs.unlink(path.join(f.root,'selections',f.selectionId,'current.json'));const second=await f.reader().capture();assert.equal(second.ok,true);assert.equal(second.pin.current,null);
});
test('absence, stale catalog, conflicts and feed rebinding never discard the last pin',async t=>{
 const f=await fixture(t),reader=f.reader(),two=f.bundle(2);await f.publish(two);const first=await reader.capture();
 await f.publish(f.bundle(1));assert.equal((await reader.capture()).code,'METADATA_STALE');assert.equal(reader.lastPin(),first.pin);
 await f.publish(two);two.catalog.events[0].displayName='synthetic changed bytes';await f.write('catalog.json',two.catalog);assert.equal((await reader.capture()).code,'METADATA_CONFLICT');assert.equal(reader.lastPin(),first.pin);
 two.catalog.catalogSequence=3;two.catalog.events[0].selections=[];await f.write('catalog.json',two.catalog);assert.equal((await reader.capture()).code,'SELECTION_ABSENT');assert.equal(reader.lastPin(),first.pin);
 await fs.unlink(path.join(f.root,'catalog.json'));assert.equal((await reader.capture()).code,'INPUT_UNAVAILABLE');assert.equal(reader.lastPin(),first.pin);
 await f.write('feed.json',{...two.feed,epoch:2});assert.equal((await reader.capture()).code,'REBIND_REQUIRED');assert.equal(reader.lastPin(),first.pin);
});
test('same generation with changed delivered bytes conflicts across captures even if pointers agree',async t=>{
 const f=await fixture(t),reader=f.reader(),value=f.bundle();await f.publish(value);const first=await reader.capture();value.manifest.extra='synthetic changed metadata';value.current.manifestSha256=hash(bytes(value.manifest));value.catalog.events[0].selections[0].manifestSha256=value.current.manifestSha256;value.catalog.catalogSequence=2;await f.publish(value);
 assert.equal((await reader.capture()).code,'METADATA_CONFLICT');assert.equal(reader.lastPin(),first.pin);
});
test('unsafe portable descriptor paths and context mismatches fail without exposing private strings',async t=>{
 const f=await fixture(t),open=fs.open;let outsideReads=0;fs.open=async function(file,...args){if(!String(file).startsWith(f.root+path.sep))outsideReads++;return open.call(fs,file,...args);};
 try{for(const invalid of ['../private-token','C:/private-token','\\\\private-token\\share','selections/'+f.selectionId+'/generations/../manifest.json']){const value=f.bundle();value.catalog.events[0].selections[0].manifestPath=invalid;await f.publish(value);const result=await f.reader().capture();assert.equal(result.ok,false);assert.equal(result.code,'UNSAFE_INPUT');assert.equal(JSON.stringify(result).includes('private-token'),false);}assert.equal(outsideReads,0);}finally{fs.open=open;}
 const value=f.bundle();value.manifest.epoch=2;value.current.manifestSha256=hash(bytes(value.manifest));value.catalog.events[0].selections[0].manifestSha256=value.current.manifestSha256;await f.publish(value);assert.equal((await f.reader().capture()).code,'METADATA_INVALID');
});
test('invalid UTF8, duplicate keys, BOM and size limits fail before semantic acceptance',async t=>{
 const f=await fixture(t);for(const invalid of [Buffer.from('\ufeff{}'),Buffer.from('{"feedId":"x","feedId":"y"}'),Buffer.from([0xff]),Buffer.alloc(65537,32)]){await f.publish(f.bundle());await f.write('feed.json',invalid);const value=await f.reader().capture();assert.equal(value.ok,false);assert.equal(value.ready,false);assert.ok(['METADATA_INVALID','LIMIT_EXCEEDED'].includes(value.code));}
});
test('links and observed file replacement are rejected with no accepted pin',async t=>{
 const f=await fixture(t),value=f.bundle();await f.publish(value);const file=path.join(f.root,...value.current.manifestPath.split('/')),outside=path.join(f.root,'outside.json');await fs.writeFile(outside,bytes(value.manifest));await fs.unlink(file);await fs.symlink(outside,file,'file');assert.equal((await f.reader().capture()).code,'UNSAFE_INPUT');await fs.unlink(file);await fs.writeFile(file,bytes(value.manifest));
 const open=fs.open;let changed=false;fs.open=async function(target,...args){const handle=await open.call(fs,target,...args);if(target!==file)return handle;return{stat:handle.stat.bind(handle),close:handle.close.bind(handle),read:async(...readArgs)=>{const result=await handle.read(...readArgs);if(!changed){changed=true;await fs.appendFile(file,' ');}return result;}};};
 try{const reader=f.reader(),result=await reader.capture();assert.equal(result.code,'INPUT_CHANGED');assert.equal(reader.lastPin(),null);}finally{fs.open=open;}
});
test('timeout retains the physical flight and fences its late result; retry recovers after drain',async t=>{
 const f=await fixture(t),reader=f.reader({timeoutMs:1000});await f.publish(f.bundle());const first=await reader.capture();assert.equal(first.ok,true);await f.publish(f.bundle(2));
 const open=fs.open,catalog=path.join(f.root,'catalog.json');let unblock,entered;const blocked=new Promise(resolve=>unblock=resolve),start=new Promise(resolve=>entered=resolve);let opens=0;
 fs.open=async function(file,...args){if(file===catalog){opens++;entered();await blocked;}return open.call(fs,file,...args);};
 try{const pending=reader.capture();await started(start);const timedOut=await pending;assert.equal(timedOut.code,'CAPTURE_TIMEOUT');assert.equal(reader.snapshot().busy,true);assert.equal((await reader.capture()).code,'READER_BUSY');assert.equal(opens,1);assert.equal(reader.lastPin(),first.pin);unblock();await until(()=>!reader.snapshot().busy);assert.equal(reader.lastPin(),first.pin);}finally{unblock();fs.open=open;}
 const recovered=await reader.capture();assert.equal(recovered.ok,true);assert.equal(recovered.pin.descriptor.generationSequence,2);
});
test('close is immediate and fences a blocked flight without clearing its physical ownership',async t=>{
 const f=await fixture(t),reader=f.reader(),open=fs.open;await f.publish(f.bundle());let unblock,entered;const block=new Promise(resolve=>unblock=resolve),start=new Promise(resolve=>entered=resolve);
 fs.open=async function(file,...args){if(file===path.join(f.root,'catalog.json')){entered();await block;}return open.call(fs,file,...args);};
 try{const pending=reader.capture();await started(start);reader.close();assert.equal((await pending).code,'READER_CLOSED');assert.equal(reader.snapshot().busy,true);assert.equal((await reader.capture()).code,'READER_CLOSED');unblock();await until(()=>!reader.snapshot().busy);assert.equal(reader.lastPin(),null);}finally{unblock();fs.open=open;}
});
test('binding options reject accessors, sparse tuples and unapproved hooks before any read',()=>{
 const root=path.resolve(os.tmpdir(),'synthetic-exchange');const binding={feedId:'00000000-0000-4000-8000-000000000001',epoch:1,identityTuple:['2026-2027','EV1','BD1','event','button']};
 for(const options of [{root,binding,fs:fs},{root,binding:{...binding,identityTuple:new Array(5)}},{root,binding:{...binding,epoch:0}},{root,binding:{...binding,feedId:Object.create(null)}},{root,binding:{...binding,identityTuple:['2026-2027','EV1','','season','button']}}])assert.throws(()=>createExchangeMetadataReader(options),/METADATA_INVALID/);
 const options={root,binding};Object.defineProperty(options,'timeoutMs',{enumerable:true,get(){throw Error('private hook');}});assert.throws(()=>createExchangeMetadataReader(options),error=>error.message==='METADATA_INVALID');
});


test('exact delivered manifest bytes are hashed and a changed digest preserves the last pin',async t=>{
 const f=await fixture(t),reader=f.reader(),value=f.bundle();await f.publish(value);const first=await reader.capture();
 await f.write(value.current.manifestPath,Buffer.concat([bytes(value.manifest),Buffer.from(' ')]));
 assert.equal((await reader.capture()).code,'METADATA_INVALID');assert.equal(reader.lastPin(),first.pin);
 await f.write(value.current.manifestPath,value.manifest);assert.equal((await reader.capture()).ok,true);
});

test('catalog, current and manifest byte limits are enforced before parsing',async t=>{
 const f=await fixture(t);for(const [relative,length]of [['catalog.json',5242881],['selections/'+f.selectionId+'/current.json',65537],[f.bundle().current.manifestPath,1048577]]){await f.publish(f.bundle());await f.write(relative,Buffer.alloc(length,32));assert.equal((await f.reader().capture()).code,'LIMIT_EXCEEDED');}
});

test('root and intermediate directory links are refused, including links that remain inside the input tree',async t=>{
 const f=await fixture(t),value=f.bundle();await f.publish(value);const alias=path.join(f.root,'alias');await fs.symlink(f.root,alias,process.platform==='win32'?'junction':'dir');
 assert.equal((await createExchangeMetadataReader({root:alias,binding:f.binding}).capture()).code,'UNSAFE_INPUT');
 const generation=path.dirname(path.join(f.root,...value.current.manifestPath.split('/'))),moved=path.join(f.root,'moved-generation');await fs.rename(generation,moved);await fs.symlink(moved,generation,process.platform==='win32'?'junction':'dir');
 assert.equal((await f.reader().capture()).code,'UNSAFE_INPUT');
});


test('an elapsed monotonic deadline fences a final completion before delayed timer callbacks can run',async t=>{
 const f=await fixture(t),reader=f.reader({timeoutMs:1000});await f.publish(f.bundle(1));const first=await reader.capture();assert.equal(first.ok,true);await f.publish(f.bundle(2));
 const open=fs.open,manifest=path.join(f.root,...f.bundle(2).current.manifestPath.split('/'));let blocked=false,timerRan=false;
 // Complete the final actual close, then hold the event loop. Promise/microtask
 // continuations resume before due timers, so a timer-only fence would accept
 // generation2 late and overwrite the earlier metadata pin.
 fs.open=async function(file,...args){const handle=await open.call(fs,file,...args);if(file!==manifest)return handle;return{stat:handle.stat.bind(handle),read:handle.read.bind(handle),close:async()=>{await handle.close();blocked=true;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1100);}};};
 const timer=setTimeout(()=>{timerRan=true;},1000),began=performance.now();
 try{const value=await reader.capture();assert.equal(blocked,true,'final handle close must have completed');assert.ok(performance.now()-began>=1000,'the capture completed after its immutable budget');assert.equal(timerRan,false,'completion microtasks must precede delayed timer callbacks');assert.equal(value.code,'CAPTURE_TIMEOUT');assert.equal(value.ready,false);assert.equal(reader.lastPin(),first.pin);assert.equal(reader.snapshot().busy,false);}
 finally{clearTimeout(timer);fs.open=open;}
 const recovered=await reader.capture();assert.equal(recovered.ok,true);assert.equal(recovered.pin.descriptor.generationSequence,2);assert.equal(recovered.ready,false);
});
