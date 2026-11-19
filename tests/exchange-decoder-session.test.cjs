'use strict';
// Public synthetic regression: no private fixture pack or supplied publisher code.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {Worker}=require('node:worker_threads');
const {PNG}=require('pngjs');
const {fixtures}=require('./exchange-fixtures.cjs');
const {selectionId,selectionFingerprints}=require('../scripts/lib/exchange-fingerprints.cjs');
const {createExchangeJournal}=require('../scripts/lib/exchange-journal.cjs');
const {createExchangeSourceCoordinator}=require('../scripts/lib/exchange-source-coordinator.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const clone=v=>JSON.parse(JSON.stringify(v));
function seal(m){m.selectionId=selectionId(m.identityTuple);const fp=selectionFingerprints(m);m.playbackFingerprint=fp.playbackFingerprint;m.metadataFingerprint=fp.metadataFingerprint;m.generation='e'+m.epoch+'-g'+String(m.generationSequence).padStart(10,'0')+'-'+m.metadataFingerprint.slice(0,12);return m;}
function build(){
 const manifest=fixtures().selection;manifest.manifestState='complete';
 const bytes=Array.from({length:500},(_,i)=>{const data=Buffer.alloc(8*8*4);for(let pixel=0;pixel<64;pixel++){data[pixel*4]=i%256;data[pixel*4+1]=Math.floor(i/256);data[pixel*4+2]=87;data[pixel*4+3]=255;}return PNG.sync.write({width:8,height:8,data});});
 manifest.assets=bytes.map((b,i)=>({assetKey:'a'+(i+1),originalDriveId:'synthetic-image-'+i,viaShortcutId:null,sourceRevision:{md5:null,size:null,modifiedTime:null,headRevisionId:null},mimeType:'image/png',deliveryPath:'assets/'+hash(b)+'.png',byteLength:b.length,sha256:hash(b),width:8,height:8}));
 manifest.occurrences=manifest.assets.map((_,i)=>({position:i+1,occurrenceKey:'synthetic-row-'+i,fileKey:'synthetic-file-'+i,assetKey:'a'+(500-i),problem:null,sourceName:'Synthetic PNG',lineage:null}));
 return{manifest:seal(manifest),bytes};
}
async function drained(coordinator){while(coordinator.snapshot().busy)await new Promise(resolve=>setTimeout(resolve,10));}
function within(root,file){const comparable=v=>process.platform==='win32'?v.toLowerCase():v;const rel=path.relative(comparable(root),comparable(String(file)));return rel===''||!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);}

test('500 actual source PNGs and offline verified cache complete under existing coordinator budgets',{timeout:150000},async t=>{
 const parent=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'PiRaiders decoder session 500 ')));
 const sourceRoot=path.join(parent,'source'),cacheDir=path.join(parent,'cache'),journalDir=path.join(parent,'journal');
 await fs.mkdir(sourceRoot);assert.equal(sourceRoot,await fs.realpath(sourceRoot),'fault/read probes use canonical source spelling');
 let coordinator;
 t.after(async()=>{if(coordinator){coordinator.close();await drained(coordinator);}await fs.rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const {manifest,bytes}=build();assert.equal(new Set(manifest.assets.map(a=>a.sha256)).size,500);
 async function write(relative,value){const file=path.join(sourceRoot,...relative.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});const raw=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));await fs.writeFile(file,raw);return raw;}
 async function publish(m){
  const entry={selectionId:m.selectionId,identityTuple:m.identityTuple,origin:m.button.origin,targetBoardKey:m.board.boardKey,displayLabel:m.button.displayLabel,templateButtonKey:m.button.templateButtonKey,labelShared:false,generation:m.generation,generationSequence:m.generationSequence,manifestPath:'selections/'+m.selectionId+'/generations/'+m.generation+'/manifest.json',manifestSha256:hash(Buffer.from(JSON.stringify(m))),playbackFingerprint:m.playbackFingerprint,metadataFingerprint:m.metadataFingerprint,occurrenceCount:m.occurrences.length,manifestState:m.manifestState};
  const base=fixtures();
  const catalog={...base.catalog,catalogSequence:m.generationSequence,events:[{...m.event,eventType:'Synthetic',homeSchool:'Synthetic',venue:'Synthetic',playbackArea:'Stadium Playback',boardOnly:true,eventBoard:m.board,selections:[entry]}]};
  const current={...base.current};for(const key of Object.keys(current))if(Object.hasOwn(entry,key))current[key]=entry[key];
  const raw=new Map();for(const [name,value]of [['feed.json',base.feed],['catalog.json',catalog],[entry.manifestPath,m],['selections/'+m.selectionId+'/current.json',current]])raw.set(name,await write(name,value));return raw;
 }
 const documents=await publish(manifest);
 for(let i=0;i<500;i++)await write(manifest.assets[i].deliveryPath,bytes[i]);
 const binding={feedId:manifest.feedId,epoch:manifest.epoch},storeId=crypto.randomUUID(),journal=createExchangeJournal();
 let head=await journal.initialize(journalDir,storeId);assert.equal(head.ok,true);
 head=await journal.append(journalDir,{expectedStoreId:storeId,expectedRevision:head.revision,expectedHeadSha256:head.headSha256,event:{type:'confirm-binding',expectedRevision:head.revision,expectedBinding:null,binding,confirm:true}});assert.equal(head.ok,true);
 coordinator=createExchangeSourceCoordinator({sourceRoot,cacheDir,journalDir,storeId,binding,timeoutMs:60000});
 const post=Worker.prototype.postMessage,open=fs.open,sourceAssets=path.join(sourceRoot,'assets');let phase='source',sourceAssetReads=0;
 const requests={source:0,reuse:0},workers={source:new Set(),reuse:new Set()};
 t.mock.method(Worker.prototype,'postMessage',function(message,...args){if(message&&Object.hasOwn(message,'id')&&Object.hasOwn(message,'bytes')){requests[phase]++;workers[phase].add(this);assert.equal(this.resourceLimits.maxOldGenerationSizeMb,384);assert.equal(this.resourceLimits.maxYoungGenerationSizeMb,16);assert.equal(message.maxMemoryUsageInMB,512,'source staging and cache reload both pass the fixed JPEG budget');}return post.call(this,message,...args);});
 t.mock.method(fs,'open',(file,...args)=>{if(phase==='reuse'&&within(sourceAssets,file))sourceAssetReads++;return open.call(fs,file,...args);});
 const firstStart=performance.now(),first=await coordinator.prepareSelection(manifest.identityTuple);await drained(coordinator);
 t.diagnostic('500-file source preparation real elapsed ms: '+Math.round(performance.now()-firstStart));
 assert.equal(first.code,'CONTENT_PREPARED');assert.equal(first.ready,false);assert.equal(first.contentPrepared,true);assert.equal(first.prepared.manifest.files.length,500);assert.equal(first.prepared.deck.slides.length,500);
 assert.deepEqual(first.prepared.manifest.occurrences.map(o=>[o.occurrenceKey,o.fileKey,o.assetKey]),manifest.occurrences.map(o=>[o.occurrenceKey,o.fileKey,o.assetKey]));
 assert.equal((await fs.readdir(path.join(first.prepared.snapshotDir,'media'))).length,500);assert.equal(requests.source,500);assert.equal(workers.source.size,1);for(const worker of workers.source)assert.equal(worker.threadId,-1,'worker exited before prepared acknowledgement');
 for(const [relative,raw]of documents)assert.deepEqual(await fs.readFile(path.join(sourceRoot,...relative.split('/'))),raw,'source metadata unchanged');
 for(let i=0;i<500;i++)assert.equal(hash(await fs.readFile(path.join(sourceRoot,manifest.assets[i].deliveryPath))),manifest.assets[i].sha256,'source image unchanged');
 const next=clone(manifest);next.generationSequence=2;next.sourceTicks.onBoardAll=true;seal(next);assert.equal(next.playbackFingerprint,manifest.playbackFingerprint);assert.notEqual(next.metadataFingerprint,manifest.metadataFingerprint);
 await publish(next);await fs.rm(sourceAssets,{recursive:true});phase='reuse';
 const secondStart=performance.now(),second=await coordinator.prepareSelection(next.identityTuple);await drained(coordinator);
 t.diagnostic('500-file offline cache verification real elapsed ms: '+Math.round(performance.now()-secondStart));
 assert.equal(second.code,'CONTENT_PREPARED');assert.equal(second.ready,false);assert.equal(second.mediaChanged,false);assert.equal(second.prepared.snapshotDir,first.prepared.snapshotDir);assert.equal(second.prepared.deck.slides.length,500);
 assert.deepEqual(second.prepared.manifest.occurrences,first.prepared.manifest.occurrences);assert.equal(sourceAssetReads,0);assert.equal(requests.reuse,500,'every physical cached PNG decoded again');assert.equal(workers.reuse.size,1);for(const worker of workers.reuse)assert.equal(worker.threadId,-1);
 assert.equal((await fs.readdir(cacheDir)).length,1,'metadata-only verification creates no replacement snapshot');
 head=await journal.open(journalDir,storeId);assert.equal(head.ok,true);assert.equal(head.state.feeds[0].catalog.sequence,2);assert.equal(head.state.feeds[0].selections[0].sequence,2);
});
