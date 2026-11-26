'use strict';
// 5d-4: cold start against the production window's warm-up. The exchange
// activation job (scripts/smoke-exchange-activation-windows.cjs) times its
// first application start on a fresh hosted Windows runner: from the moment it
// spawns the real application to the application's `controller-available`
// line, and to the owned Caspar sender running (renderer ready and the owned
// process captured: NDI sender running, not discovered, not on air). Either
// figure over the default warm-up fails the job with the margin on the failure
// line. Hosted-CI evidence only, never target-PC evidence. See
// docs/design/CLOSE_AND_STARTUP_PROOFS.md.
const {DEFAULT_PREWARM_MINUTES}=require('./lib/production-window.cjs');

const DEFAULT_WARM_UP_MS=DEFAULT_PREWARM_MINUTES*60000;

function instant(value,name){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Object.assign(Error('COLD_START_TIMES_INVALID'),{code:'COLD_START_TIMES_INVALID',field:name});
  return value;
}
// Times are performance.now() readings of one process (ms). The record holds
// numbers and fixed words only: no path, no command line, no machine name.
function coldStartRecord({spawnedAt,controllerAvailableAt,senderRunningAt},{warmUpMs=DEFAULT_WARM_UP_MS}={}){
  const spawned=instant(spawnedAt,'spawnedAt'),controller=instant(controllerAvailableAt,'controllerAvailableAt'),sender=instant(senderRunningAt,'senderRunningAt');
  if(!Number.isSafeInteger(warmUpMs)||warmUpMs<=0)throw Object.assign(Error('COLD_START_TIMES_INVALID'),{code:'COLD_START_TIMES_INVALID',field:'warmUpMs'});
  if(controller<spawned||sender<controller)throw Object.assign(Error('COLD_START_TIMES_INVALID'),{code:'COLD_START_TIMES_INVALID',field:'order'});
  const toControllerMs=Math.round(controller-spawned),toSenderRunningMs=Math.round(sender-spawned);
  const record={evidence:'hosted-ci',targetPcEvidence:false,run:'first-application-start-fresh-runner',
    senderState:'sender-running',senderDiscoveredCounted:false,onAirCounted:false,
    warmUpMs,warmUpSource:'production-window-default-prewarm',
    processStartToControllerAvailableMs:toControllerMs,processStartToSenderRunningMs:toSenderRunningMs,
    controllerMarginMs:warmUpMs-toControllerMs,senderMarginMs:warmUpMs-toSenderRunningMs};
  const over=[];
  if(toControllerMs>warmUpMs)over.push('controller-available');
  if(toSenderRunningMs>warmUpMs)over.push('sender-running');
  record.withinWarmUp=over.length===0;
  if(over.length)throw Object.assign(Error('COLD_START_OVER_WARM_UP'),{code:'COLD_START_OVER_WARM_UP',coldStart:{...record,over}});
  return record;
}

module.exports={DEFAULT_WARM_UP_MS,coldStartRecord};
