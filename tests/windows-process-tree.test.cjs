'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { terminateProcessTree } = require('../scripts/lib/windows-process-tree.cjs');
const { ProcessSupervisor } = require('../scripts/lib/process-supervisor.cjs');

function fakeChild(pid = 4321) {
  const child = new EventEmitter();
  child.pid = pid;
  child.kill = () => { child.killed = true; child.emit('exit', null, 'SIGTERM'); };
  return child;
}
test('Windows tree termination uses taskkill with no shell and descendants flag', async () => {
  const child = fakeChild();
  let invoked;
  await terminateProcessTree(child, { platform: 'win32', execFileProcess: (file, args, options, cb) => {
    invoked = { file, args, options }; cb(null, '', '');
  } });
  assert.equal(invoked.file, 'taskkill.exe');
  assert.deepEqual(invoked.args, ['/PID', '4321', '/T', '/F']);
  assert.equal(invoked.options.windowsHide, true);
  assert.equal(child.killed, undefined);
});
test('rejects invalid Windows PID without executing taskkill', async () => {
  let called = false;
  await assert.rejects(terminateProcessTree(fakeChild(0), {
    platform: 'win32', execFileProcess: () => { called = true; }
  }), /valid PID/);
  assert.equal(called, false);
});
test('propagates taskkill failure rather than reporting successful shutdown', async () => {
  await assert.rejects(terminateProcessTree(fakeChild(), {
    platform: 'win32', execFileProcess: (_f, _a, _o, cb) => cb(Error('access denied'))
  }), /access denied/);
});
test('non-Windows termination uses direct child kill', async () => {
  const child = fakeChild();
  await terminateProcessTree(child, { platform: 'linux' });
  assert.equal(child.killed, true);
});
test('supervisor stop awaits Windows descendant termination and is idempotent', async () => {
  const child = fakeChild();
  let finished;
  const supervisor = new ProcessSupervisor([{ name: 'casparcg', command: 'casparcg.exe', args: [] }], {
    platform: 'win32', spawnProcess: () => child,
    execFileProcess: (_f, _a, _o, cb) => { finished = cb; }
  });
  supervisor.start();
  const stopping = supervisor.stop();
  assert.strictEqual(supervisor.stop(), stopping);
  assert.equal(supervisor.stopping, true);
  assert.equal(typeof finished, 'function');
  finished(null);
  await stopping;
  assert.equal(child.killed, undefined);
});
test('supervisor surfaces failed Windows shutdown', async () => {
  const faults = [];
  const supervisor = new ProcessSupervisor([{ name: 'casparcg', command: 'casparcg.exe', args: [] }], {
    platform: 'win32', spawnProcess: () => fakeChild(),
    execFileProcess: (_f, _a, _o, cb) => cb(Error('blocked'))
  });
  supervisor.on('fault', event => faults.push(event));
  supervisor.start();
  await assert.rejects(supervisor.stop(), /failed to stop/);
  assert.match(faults[0].error, /blocked/);
});
