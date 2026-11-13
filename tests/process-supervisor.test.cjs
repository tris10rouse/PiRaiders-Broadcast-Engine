'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ProcessSupervisor } = require('../scripts/lib/process-supervisor.cjs');
function fixture() {
  const spawned = [], scheduled = [], cancelled = [];
  const spawnProcess = (command, args, options) => {
    const child = new EventEmitter(); child.pid = spawned.length + 1;
    child.kill = () => { child.killed = true; child.emit('exit', null, 'SIGTERM'); };
    spawned.push({ command, args, options, child }); return child;
  };
  const supervisor = new ProcessSupervisor([{ name: 'spx', command: 'node', args: ['server.js'] }], {
    // Fake PIDs must never reach the host's real taskkill command.
    platform: 'linux', spawnProcess, schedule: fn => { scheduled.push(fn); return fn; }, cancel: timer => cancelled.push(timer), maxRestarts: 2
  });
  return { supervisor, spawned, scheduled, cancelled };
}
test('validates duplicate services', () => assert.throws(() => new ProcessSupervisor([{ name: 'spx', command: 'node', args: [] }, { name: 'spx', command: 'node', args: [] }])));
test('launches without shell and restarts crashed child', async () => {
  const f = fixture(); f.supervisor.start();
  assert.equal(f.spawned.length, 1); assert.equal(f.spawned[0].options.shell, false);
  f.spawned[0].child.emit('exit', 1); f.scheduled.shift()(); assert.equal(f.spawned.length, 2);
  await f.supervisor.stop(); assert.equal(f.spawned[1].child.killed, true);
});
test('stop cancels queued restart', async () => {
  const f = fixture(); f.supervisor.start(); f.spawned[0].child.emit('exit', 1);
  await f.supervisor.stop(); assert.equal(f.cancelled.length, 1);
  f.scheduled[0](); assert.equal(f.spawned.length, 1);
});
test('bounded restart prevents endless crash loop', () => {
  const f = fixture(); const faults = []; f.supervisor.on('fault', x => faults.push(x)); f.supervisor.start();
  for (let i = 0; i < 3; i++) { f.spawned[i].child.emit('exit', 1); if (f.scheduled[i]) f.scheduled[i](); }
  assert.equal(f.spawned.length, 3); assert.equal(faults.length, 1);
});
test('error plus exit counts once', () => {
  const f = fixture(); f.supervisor.start(); const child = f.spawned[0].child;
  child.emit('error', new Error('spawn failed')); child.emit('exit', 1);
  assert.equal(f.scheduled.length, 1);
});
