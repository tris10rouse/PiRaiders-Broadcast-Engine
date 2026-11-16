'use strict';
// Independently authored synthetic variants of the supplied draft0.3.1 probe
// categories. No attachment script executes and no owner document is copied.
const test=require('node:test'),assert=require('node:assert/strict');
const {fixtures}=require('./exchange-fixtures.cjs');
const {createExchangeSchemaGate}=require('../scripts/lib/exchange-schema-gate.cjs');
const clone=value=>structuredClone(value);
function complete(){const value=fixtures().selection;value.manifestState='complete';value.occurrences=[{position:1,occurrenceKey:'FK-SYNTHETIC',fileKey:'FK-SYNTHETIC',assetKey:'a1',problem:null,sourceName:'synthetic.png',lineage:null}];value.assets=[{assetKey:'a1',originalDriveId:'SYNTHETIC_DRIVE_A',viaShortcutId:null,sourceRevision:{md5:'a'.repeat(32),size:10,modifiedTime:'2026-10-01T12:00:00Z',headRevisionId:null},mimeType:'image/png',deliveryPath:'assets/'+'a'.repeat(64)+'.png',byteLength:10,width:1600,height:900,sha256:'a'.repeat(64)}];return value;}
function catalog(manifest){const root=fixtures().catalog,cur=fixtures().current;root.events=[{...clone(manifest.event),eventType:'Synthetic',homeSchool:'Synthetic school',venue:'Synthetic venue',playbackArea:'Stadium Playback',boardOnly:false,eventBoard:clone(manifest.board),selections:[{selectionId:cur.selectionId,identityTuple:cur.identityTuple,origin:'event',targetBoardKey:'BOARD-SYNTHETIC',displayLabel:'synthetic',templateButtonKey:null,labelShared:false,generation:cur.generation,generationSequence:cur.generationSequence,manifestPath:cur.manifestPath,manifestSha256:cur.manifestSha256,playbackFingerprint:cur.playbackFingerprint,metadataFingerprint:cur.metadataFingerprint,occurrenceCount:1,manifestState:'complete'}]}];return root;}
test('all23 supplied schema-probe categories retain their positive and negative meaning',()=>{
 const gate=createExchangeSchemaGate(),event=complete(),season=clone(event);season.identityTuple[3]='season';season.identityTuple[4]='BUTTON-SYNTHETIC';season.button.origin='season';season.button.templateButtonKey='BUTTON-SYNTHETIC';season.sourceTicks.onBoardAll=null;season.sourceTicks.loadedForYear=true;season.occurrences[0].fileKey=null;
 const unresolved=clone(event);unresolved.identityTuple[2]='';unresolved.board={boardKey:null,displayName:null};unresolved.manifestState='incomplete';unresolved.occurrences[0].assetKey=null;unresolved.occurrences[0].problem={code:'BOARD_UNRESOLVED',detail:null,occurrenceKey:'FK-SYNTHETIC'};unresolved.problems=[{code:'BOARD_UNRESOLVED',detail:null,occurrenceKey:null}];unresolved.assets=[];
 const cases=[['selection',event,true],['selection',season,true],['selection',unresolved,true],['current',fixtures().current,true],['catalog',catalog(event),true]];
 function mutated(kind,base,expected,change){const value=clone(base);change(value);cases.push([kind,value,expected]);}
 mutated('selection',event,false,x=>{x.event.eligibility={eligible:true,reasonCodes:['CANCELLED']};});
 mutated('selection',event,false,x=>{x.event.timing.eventStartsAt='2026-02-30T25:61:00-06:00';});
 mutated('selection',event,false,x=>{x.event.timing.eventStartsAt='2026-02-30T19:00:00-06:00';});
 mutated('selection',event,false,x=>{x.manifestState='incomplete';x.occurrences[0].assetKey=null;x.assets=[];x.occurrences[0].problem={code:'MISSING_FILE',detail:'apng',occurrenceKey:'FK-SYNTHETIC'};x.problems=[x.occurrences[0].problem];});
 mutated('current',fixtures().current,true,x=>{x.manifestPath=x.manifestPath.replace('g0000000001','g0000000002');}); // V15/V17 pending, not suppressed.
 mutated('catalog',catalog(event),false,x=>{x.events[0].selections[0].manifestPath='../../../private';});
 mutated('selection',event,false,x=>{x.assets[0].byteLength=21*1024*1024;});
 mutated('selection',event,false,x=>{x.assets[0].byteLength=9007199254740992;});
 mutated('selection',season,false,x=>{x.identityTuple[2]='';x.board.boardKey=null;});
 mutated('selection',event,false,x=>{x.button.templateButtonKey='unexpected';});
 mutated('selection',event,false,x=>{x.event.timing.eventStartsAt='2026-10-01T19:00:00Z';});
 mutated('selection',event,false,x=>{x.identityTuple[3]='season';});
 mutated('selection',event,true,x=>{x.manifestState='incomplete';x.occurrences=[];x.assets=[];x.problems=[{code:'LIMIT_EXCEEDED',detail:'occurrences',occurrenceKey:null,observed:501,limit:500}];});
 mutated('selection',event,false,x=>{x.manifestState='incomplete';x.occurrences=[];x.assets=[];x.problems=[{code:'LIMIT_EXCEEDED',detail:'total_bytes',occurrenceKey:null}];});
 mutated('selection',event,false,x=>{x.manifestState='incomplete';x.assets=[];x.occurrences[0].assetKey=null;x.occurrences[0].problem={code:'LIMIT_EXCEEDED',detail:'occurrences',occurrenceKey:null,observed:501,limit:500};x.problems=[x.occurrences[0].problem];});
 mutated('selection',event,false,x=>{x.problems=[{code:'LIMIT_EXCEEDED',detail:'assets',occurrenceKey:null,observed:501,limit:500}];});
 mutated('selection',event,true,x=>{x.manifestState='incomplete';x.assets=[];x.occurrences[0].assetKey=null;x.occurrences[0].problem={code:'LIMIT_EXCEEDED',detail:'pixels',occurrenceKey:'FK-SYNTHETIC'};x.problems=[x.occurrences[0].problem];});
 mutated('selection',event,false,x=>{x.manifestState='incomplete';x.occurrences=[];x.assets=[];x.problems=[{code:'MISSING_FILE',detail:'trashed',occurrenceKey:null}];});
 assert.equal(cases.length,23);for(const [index,[kind,value,expected]]of cases.entries()){const result=gate.validate(kind,value);assert.equal(result.ok,expected,'PROBE_'+index+'_'+kind);assert.equal(result.ready,false);assert.equal(result.semanticValidation,'pending');}
});

test('the actual cross-schema catalog accepts a finished event followed by an eligible event',()=>{
 const gate=createExchangeSchemaGate(),doc=catalog(complete()),ready=clone(doc.events[0]),finished=clone(doc.events[0]);finished.eventKey='EV-FINISHED-SYNTHETIC';finished.eligibility={eligible:false,reasonCodes:['FINISHED']};ready.eventKey='EV-READY-SYNTHETIC';doc.events=[finished,ready];
 const result=gate.validate('catalog',doc);assert.equal(result.ok,true);assert.equal(result.ready,false);assert.equal(result.semanticValidation,'pending');
 doc.events[1].eligibility={eligible:true,reasonCodes:['CANCELLED']};assert.equal(gate.validate('catalog',doc).ok,false);
});
