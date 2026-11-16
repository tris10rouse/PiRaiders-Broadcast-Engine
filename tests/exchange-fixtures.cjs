'use strict';
// Independently authored synthetic structural documents, not owner fixture data.
function fixtures(){
 const feedId='00000000-0000-4000-8000-000000000001',selectionId='sel_'+'a'.repeat(32),identityTuple=['2026-2027','EV-SYNTHETIC','BOARD-SYNTHETIC','event','synthetic'],generation='e1-g0000000001-'+'b'.repeat(12),stamp='2026-10-01T12:00:00Z';
 const timing={timeZone:'America/Chicago',eventStartsAt:null,startSource:'missing',eventEndsAt:null,endSource:'missing',broadcastWindow:{startsAt:null,endsAt:null,startSource:'missing',endSource:'missing'},operatingWindow:null,unavailableReasons:['START_NOT_DEFINED','END_NOT_DEFINED']};
 const event={eventKey:'EV-SYNTHETIC',displayName:'Synthetic event',eventDate:'2026-10-01',eligibility:{eligible:true,reasonCodes:[]},timing};
 const current={contractVersion:'piraiders-event-current/1',feedId,epoch:1,selectionId,identityTuple,generation,generationSequence:1,manifestPath:'selections/'+selectionId+'/generations/'+generation+'/manifest.json',manifestSha256:'c'.repeat(64),playbackFingerprint:'d'.repeat(64),metadataFingerprint:'b'.repeat(64),manifestState:'empty'};
 const selection={contractVersion:'piraiders-event-selection/1',feedId,epoch:1,selectionId,identityTuple,generation,generationSequence:1,generatedAt:stamp,manifestState:'empty',problems:[],schoolYear:'2026-2027',event,board:{boardKey:'BOARD-SYNTHETIC',displayName:'Synthetic board'},button:{origin:'event',displayLabel:'synthetic',normalizedLabel:'synthetic',templateButtonKey:null},sourceTicks:{onBoardAll:false,eventBoardLoaded:false,loadedForYear:null},occurrences:[],assets:[],playbackFingerprint:'d'.repeat(64),metadataFingerprint:'b'.repeat(64)};
 return {feed:{contractVersion:'piraiders-event-feed/1',feedId,epoch:1,createdAt:stamp,publisher:'PiRaiders Scheduler'},catalog:{contractVersion:'piraiders-event-catalog/1',feedId,epoch:1,catalogSequence:1,generatedAt:stamp,sourceVersion:'0.0.0',schoolYear:'2026-2027',events:[]},current,selection};
}
module.exports={fixtures};
