'use strict';
// BE-006 item 5a part 1: a synthetic exchange folder and a source machine's
// private stores for the Windows exchange activation proof.
//
// Proof and test use only. Every identity, label and picture here is made up;
// it never reads or writes a real exchange folder, Drive or the scheduler.
// The documents follow the exchange contract's shapes (feed, catalog, current,
// selection manifest) and are sealed with the Engine's own fingerprint code.
// The two private stores are set up the way an operator's setup step will
// (item 5b): the journal with its confirmed feed binding, then an empty
// approval list. Nothing is approved here: approval goes through the routes.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {PNG}=require('pngjs'),jpeg=require('jpeg-js');
const {selectionId,selectionFingerprints}=require('./lib/exchange-fingerprints.cjs');
const {createExchangeJournal}=require('./lib/exchange-journal.cjs');
const {createExchangeApprovalStore}=require('./lib/exchange-approval-store.cjs');

const WIDTH=1920,HEIGHT=1080;
// Three distinct full-frame colours, one per picture, played in this order.
// Far apart in every channel so a received frame names its picture by colour.
const PICTURES=Object.freeze([
  Object.freeze({name:'synthetic-red',format:'png',rgb:Object.freeze([220,30,30])}),
  Object.freeze({name:'synthetic-green',format:'jpeg',rgb:Object.freeze([30,200,40])}),
  Object.freeze({name:'synthetic-blue',format:'png',rgb:Object.freeze([30,40,220])})]);
const FEED_ID='00000000-0000-4000-8000-00000000a5a1',EPOCH=1,STAMP='2026-10-01T12:00:00Z';
const TUPLE=Object.freeze(['2026-2027','EV-PROOF-ACTIVATION','BOARD-PROOF','event','proof activation']);
const PROVIDER_ID='activation-proof';

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function picture(p){
  const data=Buffer.alloc(WIDTH*HEIGHT*4);
  for(let i=0;i<data.length;i+=4){data[i]=p.rgb[0];data[i+1]=p.rgb[1];data[i+2]=p.rgb[2];data[i+3]=255;}
  return p.format==='png'?PNG.sync.write({width:WIDTH,height:HEIGHT,data}):jpeg.encode({width:WIDTH,height:HEIGHT,data},95).data;
}
function plain(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function fail(code){throw Object.assign(Error(code),{code});}

// The documents, sealed. Exported for tests so they can be checked against
// the Engine's own readers without writing anything. eligible:false marks the
// event cancelled (tests of what an ineligible button may not do).
// generation:2 is the same button republished with its pictures in reverse
// order (another playback; catalog and generation sequence 2).
function exchangeDocuments({eligible=true,generation=1}={}){
  if(generation!==1&&generation!==2)fail('FIXTURE_OPTIONS_INVALID');
  const pictures=generation===1?PICTURES:Object.freeze([...PICTURES].reverse());
  const blobs=pictures.map(picture),tuple=[...TUPLE];
  const timing={timeZone:'America/Chicago',eventStartsAt:null,startSource:'missing',eventEndsAt:null,endSource:'missing',
    broadcastWindow:{startsAt:null,endsAt:null,startSource:'missing',endSource:'missing'},operatingWindow:null,unavailableReasons:['START_NOT_DEFINED','END_NOT_DEFINED']};
  const event={eventKey:tuple[1],displayName:'Synthetic activation proof',eventDate:'2026-10-01',eligibility:eligible?{eligible:true,reasonCodes:[]}:{eligible:false,reasonCodes:['CANCELLED']},timing};
  const board={boardKey:tuple[2],displayName:'Synthetic proof board'};
  const m={contractVersion:'piraiders-event-selection/1',feedId:FEED_ID,epoch:EPOCH,selectionId:'',identityTuple:tuple,generation:'',generationSequence:generation,
    generatedAt:STAMP,manifestState:'complete',problems:[],schoolYear:tuple[0],event,board,
    button:{origin:'event',displayLabel:tuple[4],normalizedLabel:tuple[4],templateButtonKey:null},
    sourceTicks:{onBoardAll:false,eventBoardLoaded:false,loadedForYear:null},
    occurrences:pictures.map((p,i)=>({position:i+1,occurrenceKey:'row-'+(i+1),fileKey:'FILE-'+(i+1),assetKey:'a'+(i+1),problem:null,sourceName:'Synthetic',lineage:null})),
    assets:blobs.map((b,i)=>({assetKey:'a'+(i+1),originalDriveId:'synthetic-proof-'+(i+1),viaShortcutId:null,
      sourceRevision:{md5:null,size:null,modifiedTime:null,headRevisionId:null},
      mimeType:pictures[i].format==='png'?'image/png':'image/jpeg',deliveryPath:'assets/'+sha(b)+(pictures[i].format==='png'?'.png':'.jpg'),
      byteLength:b.length,sha256:sha(b),width:WIDTH,height:HEIGHT})),
    playbackFingerprint:'',metadataFingerprint:''};
  m.selectionId=selectionId(m.identityTuple);
  const prints=selectionFingerprints(m);m.playbackFingerprint=prints.playbackFingerprint;m.metadataFingerprint=prints.metadataFingerprint;
  m.generation='e'+EPOCH+'-g'+String(m.generationSequence).padStart(10,'0')+'-'+m.metadataFingerprint.slice(0,12);
  const manifestBytes=Buffer.from(JSON.stringify(m)),manifestPath='selections/'+m.selectionId+'/generations/'+m.generation+'/manifest.json';
  const entry={selectionId:m.selectionId,identityTuple:tuple,origin:m.button.origin,targetBoardKey:board.boardKey,displayLabel:m.button.displayLabel,
    templateButtonKey:null,labelShared:false,generation:m.generation,generationSequence:m.generationSequence,manifestPath,manifestSha256:sha(manifestBytes),
    playbackFingerprint:m.playbackFingerprint,metadataFingerprint:m.metadataFingerprint,occurrenceCount:m.occurrences.length,manifestState:m.manifestState};
  const feed={contractVersion:'piraiders-event-feed/1',feedId:FEED_ID,epoch:EPOCH,createdAt:STAMP,publisher:'PiRaiders Scheduler'};
  const catalog={contractVersion:'piraiders-event-catalog/1',feedId:FEED_ID,epoch:EPOCH,catalogSequence:generation,generatedAt:STAMP,sourceVersion:'0.0.0',schoolYear:tuple[0],
    events:[{...event,eventType:'Synthetic',homeSchool:'Synthetic',venue:'Synthetic',playbackArea:'Stadium Playback',boardOnly:true,eventBoard:board,selections:[entry]}]};
  const current={contractVersion:'piraiders-event-current/1',feedId:FEED_ID,epoch:EPOCH,selectionId:m.selectionId,identityTuple:tuple,generation:m.generation,
    generationSequence:m.generationSequence,manifestPath,manifestSha256:entry.manifestSha256,playbackFingerprint:m.playbackFingerprint,
    metadataFingerprint:m.metadataFingerprint,manifestState:m.manifestState};
  const files=new Map([['feed.json',Buffer.from(JSON.stringify(feed))],['catalog.json',Buffer.from(JSON.stringify(catalog))],
    [manifestPath,manifestBytes],['selections/'+m.selectionId+'/current.json',Buffer.from(JSON.stringify(current))]]);
  m.assets.forEach((a,i)=>files.set(a.deliveryPath,blobs[i]));
  return{files,identityTuple:tuple,selectionId:m.selectionId,binding:{feedId:FEED_ID,epoch:EPOCH},
    order:pictures.map(p=>({name:p.name,format:p.format,rgb:[...p.rgb]})),playbackFingerprint:m.playbackFingerprint};
}

// The pictures' content hashes in play order, from the manifest itself.
function pictureHashes(docs){
  const [,bytes]=[...docs.files].find(([name])=>name.endsWith('/manifest.json')),m=JSON.parse(bytes);
  const sha=new Map(m.assets.map(a=>[a.assetKey,a.sha256]));return m.occurrences.map(o=>sha.get(o.assetKey));
}

// Writes, under `root` (an empty proof folder):
//   exchange/            the synthetic exchange folder (the source root)
//   private/journal/     the Engine's journal, binding confirmed
//   private/approvals/   an empty approval list (unless initializeApprovals is false)
//                        (with setUpStores false neither store nor private/ is
//                        made: the setup command makes them, 5b-4)
//   cache/ runtime/ catalog/
//   machine.json         a source machine file for scripts/piraiders-app.cjs
// `machine` carries the PC-specific parts the proof chooses (spxConfigFile
// relative to appRoot, caspar, output, rossTalk, presentation).
async function buildExchangeActivationFixture({root,machine,initializeApprovals=true,setUpStores=true}={}){
  if(typeof root!=='string'||!path.isAbsolute(root)||!plain(machine)||typeof setUpStores!=='boolean')fail('FIXTURE_OPTIONS_INVALID');
  await fs.mkdir(root,{recursive:true});root=await fs.realpath(root);
  if((await fs.readdir(root)).length)fail('FIXTURE_ROOT_NOT_EMPTY');
  const docs=exchangeDocuments(),sourceRoot=path.join(root,'exchange');
  for(const [relative,bytes] of docs.files){const file=path.join(sourceRoot,...relative.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes,{flag:'wx'});}
  const dirs={journal:path.join(root,'private','journal'),approvals:path.join(root,'private','approvals'),cache:path.join(root,'cache'),runtime:path.join(root,'runtime'),catalog:path.join(root,'catalog')};
  for(const key of ['cache','runtime','catalog'])await fs.mkdir(dirs[key]);
  const journalStoreId=crypto.randomUUID(),approvalStoreId=crypto.randomUUID();
  if(setUpStores){
    await fs.mkdir(path.join(root,'private'));
    const journal=createExchangeJournal();
    let head=await journal.initialize(dirs.journal,journalStoreId);if(!head.ok)fail('FIXTURE_JOURNAL_FAILED');
    head=await journal.append(dirs.journal,{expectedStoreId:journalStoreId,expectedRevision:head.revision,expectedHeadSha256:head.headSha256,
      event:{type:'confirm-binding',expectedRevision:head.revision,expectedBinding:null,binding:{...docs.binding},confirm:true}});
    if(!head.ok)fail('FIXTURE_JOURNAL_FAILED');
    if(initializeApprovals&&!(await createExchangeApprovalStore().initialize(dirs.approvals,approvalStoreId)).ok)fail('FIXTURE_APPROVALS_FAILED');
  }
  const raw={schemaVersion:1,...machine,catalogDirectory:dirs.catalog,mediaRoot:sourceRoot,cacheRoot:dirs.cache,runtimeRoot:dirs.runtime,
    source:{providerId:PROVIDER_ID,journalDirectory:dirs.journal,journalStoreId,approvalDirectory:dirs.approvals,approvalStoreId,
      expectedCanonicalRoot:sourceRoot,binding:{...docs.binding}}};
  const machineFile=path.join(root,'machine.json');await fs.writeFile(machineFile,JSON.stringify(raw,null,2),{flag:'wx'});
  return{machineFile,sourceRoot,privateRoots:[dirs.journal,dirs.approvals,dirs.cache,dirs.runtime,dirs.catalog],
    identityTuple:docs.identityTuple,selectionId:docs.selectionId,order:docs.order,playbackFingerprint:docs.playbackFingerprint,pictureHashes:pictureHashes(docs)};
}

module.exports={buildExchangeActivationFixture,exchangeDocuments,ACTIVATION_PICTURES:PICTURES,ACTIVATION_SIZE:Object.freeze({width:WIDTH,height:HEIGHT})};
