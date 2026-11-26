'use strict';
// 5e-1: the soak's rules, written down before any Windows run. The Windows
// soak job (5e-2) plays one synthetic approved button for four hours through
// this plan: every cycle, at fixed offsets from its start, Launch, Next, Next,
// Previous and Reload over allowlisted RossTalk, then Stop (over RossTalk on
// even cycles, over the command route on odd cycles), then black until the
// next cycle. The owned processes' summed working set and handle count are
// sampled once per cycle and must stay within a fixed growth over a baseline;
// every Stop must be seen as full-frame black within a fixed bound.
// Hosted-CI evidence only, never target-PC evidence. A shorter run is a check
// run of the job itself and is named as such, never as the soak.
// See docs/design/SOAK_PROOF.md.

const MINUTE_MS=60000;
const DEFAULT_SOAK_MS=4*60*MINUTE_MS;
const MAX_SOAK_MS=5*60*MINUTE_MS;
const CYCLE_MS=MINUTE_MS;
const MIN_CYCLES=5;
// One cycle: offsets from the cycle's start (ms) and the picture the receiver
// must then see: an index into the published order, or 'black'.
const CYCLE_STEPS=Object.freeze([
  Object.freeze({step:'launch',atMs:0,action:'launch',expect:0}),
  Object.freeze({step:'next-1',atMs:8000,action:'next',expect:1}),
  Object.freeze({step:'next-2',atMs:16000,action:'next',expect:2}),
  Object.freeze({step:'previous',atMs:24000,action:'previous',expect:1}),
  Object.freeze({step:'reload',atMs:32000,action:'reload',expect:1}),
  Object.freeze({step:'stop',atMs:40000,action:'stop',expect:'black'})]);
// Every Stop must be followed by full-frame black within this bound.
const STOP_BLACK_BOUND_MS=5000;
// Baseline: the median of the samples taken in these cycles (the first cycle
// is the warm-up and is never part of it); at least two must be readable.
const BASELINE_CYCLES=Object.freeze([1,2,3]);
const BASELINE_MIN_READABLE=2;
// Growth allowed over the baseline: the larger of a share and a floor.
const WORKING_SET_GROWTH_SHARE=0.25;
const WORKING_SET_GROWTH_FLOOR_BYTES=128*1024*1024;
const HANDLE_GROWTH_SHARE=0.20;
const HANDLE_GROWTH_FLOOR=500;
// More unreadable samples than this share of all samples fails the soak.
const UNREADABLE_SHARE_LIMIT=0.05;

function fail(code,extra={}){return Object.assign(Error(code),{code,...extra});}
function count(value){return Number.isSafeInteger(value)&&value>=0;}
function time(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0;}

// The plan. `checkRun` names a shorter run of the job itself; the soak is at
// least four hours. Durations are whole cycles.
function soakPlan({durationMs=DEFAULT_SOAK_MS,checkRun=false}={}){
  if(typeof checkRun!=='boolean'||!Number.isSafeInteger(durationMs)||durationMs<=0||durationMs%CYCLE_MS!==0)throw fail('SOAK_PLAN_INVALID');
  if(checkRun?durationMs>=DEFAULT_SOAK_MS:durationMs<DEFAULT_SOAK_MS)throw fail('SOAK_PLAN_INVALID');
  if(durationMs>MAX_SOAK_MS)throw fail('SOAK_PLAN_INVALID');
  const cycles=durationMs/CYCLE_MS;
  if(cycles<MIN_CYCLES)throw fail('SOAK_PLAN_INVALID');
  const steps=[];
  for(let cycle=0;cycle<cycles;cycle+=1)for(const s of CYCLE_STEPS)
    steps.push({cycle,step:s.step,atMs:cycle*CYCLE_MS+s.atMs,action:s.action,expect:s.expect,
      transport:s.action==='stop'&&cycle%2===1?'route':'rosstalk'});
  return Object.freeze({run:checkRun?'check-run':'soak',durationMs,cycleMs:CYCLE_MS,cycles,steps:Object.freeze(steps.map(Object.freeze))});
}

function median(values){const v=[...values].sort((a,b)=>a-b),m=Math.floor(v.length/2);return v.length%2?v[m]:Math.round((v[m-1]+v[m])/2);}
// Rounded down: a fraction of a byte or handle never loosens the bound.
function allowance(baseline,share,floor){return Math.max(Math.floor(baseline*share),floor);}

// Samples: one per cycle, in order: {cycle, workingSetBytes, handles} or
// {cycle, unreadable: true}. Sizes are the owned processes' sums.
function checkSamples(samples,plan){
  if(!Array.isArray(samples)||samples.length!==plan.cycles)throw fail('SOAK_SAMPLES_MISSING');
  // An index loop: a hole in the array is a missing sample, never a skipped one.
  for(let i=0;i<samples.length;i+=1){const s=samples[i];if(!s||s.cycle!==i)throw fail('SOAK_SAMPLES_MISSING');}
  for(const s of samples)if(s.unreadable!==true&&!(count(s.workingSetBytes)&&count(s.handles)&&s.workingSetBytes>0))throw fail('SOAK_SAMPLES_MISSING');
  const unreadable=samples.filter(s=>s.unreadable===true).length;
  const base=BASELINE_CYCLES.map(c=>samples[c]).filter(s=>s.unreadable!==true);
  const summary={samplesTaken:samples.length,samplesUnreadable:unreadable,unreadableShareLimit:UNREADABLE_SHARE_LIMIT,baselineCycles:[...BASELINE_CYCLES]};
  if(base.length<BASELINE_MIN_READABLE)throw fail('SOAK_BASELINE_UNREADABLE',{summary});
  const baseline={workingSetBytes:median(base.map(s=>s.workingSetBytes)),handles:median(base.map(s=>s.handles))};
  const bounds={workingSetBytes:baseline.workingSetBytes+allowance(baseline.workingSetBytes,WORKING_SET_GROWTH_SHARE,WORKING_SET_GROWTH_FLOOR_BYTES),
    handles:baseline.handles+allowance(baseline.handles,HANDLE_GROWTH_SHARE,HANDLE_GROWTH_FLOOR)};
  const later=samples.slice(BASELINE_CYCLES[BASELINE_CYCLES.length-1]+1).filter(s=>s.unreadable!==true);
  const largest={workingSetBytes:Math.max(baseline.workingSetBytes,...later.map(s=>s.workingSetBytes)),handles:Math.max(baseline.handles,...later.map(s=>s.handles))};
  Object.assign(summary,{baseline,bounds,largest,
    largestGrowth:{workingSetBytes:largest.workingSetBytes-baseline.workingSetBytes,handles:largest.handles-baseline.handles}});
  if(unreadable>samples.length*UNREADABLE_SHARE_LIMIT)throw fail('SOAK_SAMPLES_UNREADABLE',{summary});
  const memoryOver=later.find(s=>s.workingSetBytes>bounds.workingSetBytes);
  if(memoryOver)throw fail('SOAK_MEMORY_OVER_BOUND',{summary:{...summary,firstOverCycle:memoryOver.cycle}});
  const handlesOver=later.find(s=>s.handles>bounds.handles);
  if(handlesOver)throw fail('SOAK_HANDLES_OVER_BOUND',{summary:{...summary,firstOverCycle:handlesOver.cycle}});
  return summary;
}

// Stops: one per cycle, in order: {cycle, transport, issuedAt, blackAt}
// (performance.now() readings of the job; blackAt null when black was never seen).
function checkStops(stops,plan){
  const planned=plan.steps.filter(s=>s.action==='stop');
  if(!Array.isArray(stops))throw fail('SOAK_STOP_LOST');
  let issued=0,seen=0,slowest=0;const lost=[];
  for(const [i,p] of planned.entries()){
    const s=stops[i];
    if(!s||s.cycle!==p.cycle||s.transport!==p.transport||!time(s.issuedAt)){lost.push(p.cycle);continue;}
    issued+=1;
    if(!time(s.blackAt)||s.blackAt<s.issuedAt||s.blackAt-s.issuedAt>STOP_BLACK_BOUND_MS){lost.push(p.cycle);continue;}
    seen+=1;slowest=Math.max(slowest,Math.round(s.blackAt-s.issuedAt));
  }
  const summary={stopsPlanned:planned.length,stopsIssued:issued,stopsSeenBlack:seen,stopBlackBoundMs:STOP_BLACK_BOUND_MS,slowestStopToBlackMs:slowest,
    stopsOverRossTalk:planned.filter(p=>p.transport==='rosstalk').length,stopsOverRoute:planned.filter(p=>p.transport==='route').length};
  if(stops.length!==planned.length||lost.length)throw fail('SOAK_STOP_LOST',{summary:{...summary,firstLostCycle:lost.length?lost[0]:null}});
  return summary;
}

// The record for result.json: numbers, booleans and fixed words only (no
// path, command line or machine name). A broken rule throws with `soak`.
function soakRecord({plan,cyclesCompleted,samples,stops}){
  const head={evidence:'hosted-ci',targetPcEvidence:false,run:plan.run,soak:plan.run==='soak',durationMs:plan.durationMs,cycleMs:plan.cycleMs,cycles:plan.cycles,cyclesCompleted};
  const broken=(error,part)=>{error.soak={...head,...part,rule:error.code};return error;};
  if(!Number.isSafeInteger(cyclesCompleted)||cyclesCompleted!==plan.cycles)throw Object.assign(fail('SOAK_INCOMPLETE'),{soak:{...head,rule:'SOAK_INCOMPLETE'}});
  let stopSummary,sampleSummary;
  try{stopSummary=checkStops(stops,plan);}catch(error){throw broken(error,error.summary);}
  try{sampleSummary=checkSamples(samples,plan);}catch(error){throw broken(error,{...stopSummary,...error.summary});}
  return{...head,...stopSummary,...sampleSummary,noLostStop:true,withinBounds:true};
}

module.exports={DEFAULT_SOAK_MS,MAX_SOAK_MS,CYCLE_MS,MIN_CYCLES,CYCLE_STEPS,STOP_BLACK_BOUND_MS,BASELINE_CYCLES,BASELINE_MIN_READABLE,
  WORKING_SET_GROWTH_SHARE,WORKING_SET_GROWTH_FLOOR_BYTES,HANDLE_GROWTH_SHARE,HANDLE_GROWTH_FLOOR,UNREADABLE_SHARE_LIMIT,
  soakPlan,checkSamples,checkStops,soakRecord};
