'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fork } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { terminateProcessTree } = require('../scripts/lib/windows-process-tree.cjs');

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
function waitForTree(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(Error('Process tree handshake timed out')), 5000);
    const onError = error => finish(error);
    const onExit = () => finish(Error('Fixture exited before process tree handshake'));
    const onMessage = message => finish(null, message);
    function finish(error, message) {
      clearTimeout(timeout);
      child.off('error', onError);
      child.off('exit', onExit);
      child.off('message', onMessage);
      if (error) reject(error); else resolve(message);
    }
    child.once('error', onError);
    child.once('exit', onExit);
    child.once('message', onMessage);
  });
}

test('real Windows taskkill stops a parent and its Node descendant', {
  skip: process.platform !== 'win32' && 'Requires a real Windows runner; mocked coverage runs on every OS',
  timeout: 45000
}, async t => {
  const child = fork(path.join(__dirname, 'fixtures', 'process-tree.cjs'), [], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });
  let descendantPid;
  t.after(async () => {
    // Only target PIDs returned by our own child-process fixture. Fixtures also
    // have a 30-second self-expiry if the test runner is interrupted.
    if (child.pid && isAlive(child.pid)) {
      await terminateProcessTree(child);
    }
    if (descendantPid && isAlive(descendantPid)) {
      await terminateProcessTree({ pid: descendantPid, kill() {} });
    }
  });
  const message = await waitForTree(child);
  assert.equal(message.parentPid, child.pid);
  assert.ok(Number.isSafeInteger(message.descendantPid) && message.descendantPid > 0);
  assert.notEqual(message.descendantPid, child.pid);
  descendantPid = message.descendantPid;
  assert.equal(isAlive(child.pid), true);
  assert.equal(isAlive(descendantPid), true);

  await terminateProcessTree(child);
  await Promise.all([waitForExit(child.pid), waitForExit(descendantPid)]);
});
