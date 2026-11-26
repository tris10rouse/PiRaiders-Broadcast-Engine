'use strict';
// Q-012: how long the test-bench NDI SDK receiver (native/windows/NdiProbe.cs)
// may live. Test bench only; not part of the app bundle.
//
// Every proof keeps the receiver's own default, DEFAULT_MINUTES (8), and passes
// nothing. The soak job keeps one receiver for its whole run, so it asks for
// the run's length plus MARGIN_MINUTES for set-up and close, never more than
// MAX_MINUTES (the soak's own five-hour ceiling plus that margin). The value is
// checked here before the receiver starts and again by the receiver, which
// fails closed (`NDI_PROBE_FAILED_INVALID_LIFETIME`) and echoes what it uses in
// its ready line. NdiProbe.cs carries the same three numbers; a Linux test
// keeps them equal.
const {MAX_SOAK_MS,CYCLE_MS}=require('../soak-proof.cjs');

const DEFAULT_MINUTES=8;
const MARGIN_MINUTES=30;
const MAX_MINUTES=MAX_SOAK_MS/CYCLE_MS+MARGIN_MINUTES;

function fail(code){return Object.assign(Error(code),{code});}

function validLifetime(minutes){
  return Number.isSafeInteger(minutes)&&minutes>=DEFAULT_MINUTES&&minutes<=MAX_MINUTES;
}

// The receiver's extra argument: none for the default, else whole minutes.
function lifetimeArgs(minutes){
  if(minutes===undefined)return [];
  if(!validLifetime(minutes))throw fail('RECEIVER_LIFETIME_INVALID');
  return [String(minutes)];
}

// The soak's receiver: the planned run, rounded up to whole minutes, plus the margin.
function soakReceiverLifetime(plan){
  const durationMs=plan?.durationMs;
  if(!Number.isSafeInteger(durationMs)||durationMs<=0)throw fail('RECEIVER_LIFETIME_INVALID');
  const minutes=Math.max(DEFAULT_MINUTES,Math.ceil(durationMs/CYCLE_MS)+MARGIN_MINUTES);
  if(!validLifetime(minutes))throw fail('RECEIVER_LIFETIME_INVALID');
  return minutes;
}

module.exports={DEFAULT_MINUTES,MARGIN_MINUTES,MAX_MINUTES,validLifetime,lifetimeArgs,soakReceiverLifetime};
