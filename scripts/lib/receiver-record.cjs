'use strict';
// Q-011: what the test-bench NDI SDK receiver (native/windows/NdiProbe.cs)
// left behind, so a failed probe request can say whether the receiver died,
// hung or refused. Test bench only; not part of the app bundle.
//
// Kept: its exit (code, signal, milliseconds after its start) and its last
// stderr lines, but only the receiver's own fixed words
// (`NDI_PROBE_FAILED_<CODE>`); any other line is counted, never kept, so no
// path, machine name or runtime text reaches a log. Bounded: the last
// MAX_LINES words; a line longer than MAX_LINE characters is dropped unread
// and counted, so a long stderr never costs memory or hides the last word.
//
// Q-001: the receiver also says each start step (`NDI_PROBE_STEP_<NAME>`).
// Those are kept apart from the failure words, each with its milliseconds
// after the spawn (the first MAX_STEPS; later ones counted), and `ready()`
// records when the ready line came, so a start timeout names the last step
// reached, or shows the receiver never ran its first line.
const {performance}=require('node:perf_hooks');
const FIXED_LINE=/^NDI_PROBE_[A-Z0-9_]{1,70}$/;
const STEP_LINE=/^NDI_PROBE_STEP_([A-Z0-9_]{1,40})$/;
const MAX_LINES=8,MAX_LINE=256,MAX_STEPS=8;
function receiverRecord(now=()=>performance.now()){
  const started=now();let exit=null,pending='',skipping=false,unrecognized=0,overlong=0,readyAfterMs=null,stepsDropped=0;const lines=[],steps=[];
  function line(text){
    const value=text.endsWith('\r')?text.slice(0,-1):text;if(!value)return;
    const step=STEP_LINE.exec(value);
    if(step){if(steps.length<MAX_STEPS)steps.push({step:step[1],afterMs:Math.round(now()-started)});else stepsDropped+=1;return;}
    if(FIXED_LINE.test(value)){lines.push(value);if(lines.length>MAX_LINES)lines.shift();}else unrecognized+=1;
  }
  return{
    stderr(chunk){
      let text=Buffer.isBuffer(chunk)?chunk.toString('latin1'):String(chunk);
      for(;;){
        const end=text.indexOf('\n');
        if(end<0){if(!skipping){pending+=text;if(pending.length>MAX_LINE){pending='';skipping=true;}}return;}
        if(skipping){skipping=false;unrecognized+=1;overlong+=1;}else line(pending+text.slice(0,end));
        pending='';text=text.slice(end+1);
      }
    },
    exited(code,signal){
      if(exit)return;if(skipping){skipping=false;unrecognized+=1;overlong+=1;}else if(pending)line(pending);pending='';
      exit={code:Number.isSafeInteger(code)?code:null,signal:typeof signal==='string'&&/^SIG[A-Z0-9]{1,16}$/.test(signal)?signal:null,afterMs:Math.round(now()-started)};
    },
    ready(){if(readyAfterMs===null)readyAfterMs=Math.round(now()-started);return readyAfterMs;},
    snapshot(){return{running:exit===null,exit:exit&&{...exit},ageMs:Math.round(now()-started),stderrLines:[...lines],stderrOtherLines:unrecognized,stderrOverlongLines:overlong,steps:steps.map(s=>({...s})),stepsDropped,readyAfterMs};}
  };
}
module.exports={receiverRecord,FIXED_LINE,STEP_LINE,MAX_LINES,MAX_LINE,MAX_STEPS};
