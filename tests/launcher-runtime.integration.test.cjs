'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { LauncherRuntime } = require('../scripts/lib/launcher-runtime.cjs');

function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}
async function waitForExit(pid) {
  const deadline = Date.now() + 5000;
  while (isAlive(pid) && Date.now() < deadline) await delay(50);
  assert.equal(isAlive(pid), false, 'test-created process ' + pid + ' must exit');
}
function waitForStarted(runtime, name) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(Error(name + ' OS spawn timed out')), 5000);
    const onStarted = event => { if (event.name === name) finish(null, event.pid); };
    const onFault = event => { if (event.name === name) finish(Error(event.error)); };
    function finish(error, pid) {
      clearTimeout(timeout);
      runtime.off('started', onStarted);
      runtime.off('fault', onFault);
      if (error) reject(error); else resolve(pid);
    }
    runtime.on('started', onStarted);
    runtime.on('fault', onFault);
  });
}

test('real Windows launcher enforces sender boundaries and independently stops SPX', {
  skip: process.platform !== 'win32' && 'Requires real Windows supervisors and taskkill; policy mocks run on every OS',
  timeout: 45000
}, async t => {
  const start = Date.parse('2026-11-13T19:00:00-06:00');
  const end = start + 3600000;
  let now = start - 16 * 60000;
  // These harmless Node timers stand in for local service executables. No SPX
  // server, CasparCG, network sender, socket or stadium hardware is contacted.
  const runtime = new LauncherRuntime({
    productionWindow: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    services: ['spx', 'casparcg'].map(name => ({
      name, command: process.execPath, args: ['-e', 'setTimeout(() => process.exit(0), 30000)']
    }))
  }, { clock: () => now });
  t.after(() => runtime.close());
  const faults = [];
  runtime.on('fault', event => faults.push(event));

  const spxStarted = waitForStarted(runtime, 'spx');
  const [, spxPid] = await Promise.all([runtime.start(), spxStarted]);
  assert.equal(isAlive(spxPid), true);
  assert.equal(runtime.sender, null);

  now = start - 15 * 60000;
  const senderStarted = waitForStarted(runtime, 'casparcg');
  const [, senderPid] = await Promise.all([runtime.reconcile(), senderStarted]);
  assert.notEqual(senderPid, spxPid);
  assert.equal(isAlive(senderPid), true);
  assert.equal(isAlive(spxPid), true);

  now = end;
  await runtime.reconcile();
  await waitForExit(senderPid);
  assert.equal(runtime.sender, null);
  assert.equal(isAlive(spxPid), true, 'SPX must persist after the sender window ends');

  await runtime.close();
  await waitForExit(spxPid);
  assert.deepEqual(faults, []);
});
