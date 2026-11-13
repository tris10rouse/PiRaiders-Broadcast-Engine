'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LauncherRuntime } = require('../scripts/lib/launcher-runtime.cjs');
const { loadSettings, shutdownWithRetries } = require('../scripts/piraiders-launcher.cjs');
const start = Date.parse('2026-11-13T19:00:00-06:00');
const end = start + 3600000;
const settings = {
  productionWindow: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
  services: ['spx', 'casparcg'].map(name => ({ name, command: name, args: [] }))
};
function fixture(now = start - 16 * 60000, extra = {}) {
  const state = { now, spawned: [], tasks: [], cancelled: [], kills: [], failStop: false };
  const schedule = (fn, wait) => { const task = { fn, wait }; state.tasks.push(task); return task; };
  const runtime = new LauncherRuntime(settings, {
    clock: () => state.now, schedule, cancel: task => state.cancelled.push(task),
    supervisorOptions: {
      platform: 'win32', schedule, cancel: task => state.cancelled.push(task),
      spawnProcess: (command, args, options) => {
        const child = new EventEmitter(); child.pid = 1000 + state.spawned.length;
        child.kill = () => { throw Error('Mock Windows must use injected taskkill'); };
        state.spawned.push({ command, args, options, child });
        if (command === 'casparcg' && extra.onSenderSpawn) extra.onSenderSpawn(state, child);
        return child;
      },
      execFileProcess: (file, args, options, callback) => {
        state.kills.push({ file, args, options });
        callback(state.failStop ? Error('access denied') : null);
      }
    }
  });
  return { runtime, state };
}
function senderCount(state) { return state.spawned.filter(s => s.command === 'casparcg').length; }

test('launcher validates schedule and services before starting any processes', () => {
  assert.throws(() => new LauncherRuntime({ ...settings, productionWindow: undefined }), /Window/);
  assert.throws(() => new LauncherRuntime({ ...settings, productionWindow: { ...settings.productionWindow, start: '2026-11-13T19:00:00' } }), /timezone/);
  assert.throws(() => new LauncherRuntime({ ...settings, services: [settings.services[0]] }), /Exactly one/);
});
test('SPX persists while sender starts at default prewarm and stops at exclusive end', async () => {
  const { runtime, state } = fixture();
  await runtime.start(); assert.deepEqual(state.spawned.map(s => s.command), ['spx']);
  state.now = start - 15 * 60000;
  await Promise.all([runtime.reconcile(), runtime.reconcile()]);
  assert.equal(senderCount(state), 1);
  state.now = end;
  await runtime.reconcile();
  assert.equal(runtime.sender, null); assert.equal(runtime.spx.children.size, 1);
  assert.deepEqual(state.kills[0].args, ['/PID', '1001', '/T', '/F']);
  await runtime.close();
});
test('queued crash restart checks clock again and cannot spawn after end', async () => {
  const { runtime, state } = fixture(start);
  await runtime.start();
  state.spawned[1].child.emit('exit', 1);
  const retry = state.tasks.find(task => task.wait === 1500);
  assert.ok(retry);
  state.now = end;
  retry.fn();
  assert.equal(senderCount(state), 1);
  await runtime.reconcile(); await runtime.close();
});
test('failed sender shutdown is visible and retried without a second sender', async () => {
  const { runtime, state } = fixture(start);
  await runtime.start(); state.now = end; state.failStop = true;
  await assert.rejects(runtime.reconcile(), /failed to stop/);
  assert.equal(runtime.sender.children.size, 1);
  assert.equal(runtime.sender.stopping, true);
  state.failStop = false; await runtime.reconcile();
  assert.equal(runtime.sender, null); assert.equal(senderCount(state), 1);
  await runtime.close();
});
test('spawn submission crossing the end immediately requests termination', async () => {
  const { runtime, state } = fixture(start, { onSenderSpawn: s => { s.now = end; } });
  await runtime.start();
  assert.equal(senderCount(state), 1); assert.equal(state.kills.length, 1);
  assert.equal(runtime.sender, null);
  await runtime.close();
});
test('late OS spawn crossing end terminates the sender and inhibits restarts', async () => {
  const { runtime, state } = fixture(start);
  await runtime.start(); state.now = end;
  state.spawned[1].child.emit('spawn');
  await runtime.sender.stop();
  assert.equal(runtime.sender.stopping, true);
  await runtime.reconcile();
  assert.equal(runtime.sender, null);
  await runtime.close();
});
test('clock jumps and invalid clocks fail closed; boundary polling is bounded', async () => {
  const { runtime, state } = fixture(start - 15 * 60000 - 100);
  await runtime.start();
  assert.equal(state.tasks.at(-1).wait, 100);
  state.now = start; await state.tasks.at(-1).fn();
  await runtime.queue; assert.equal(senderCount(state), 1);
  state.now = NaN; await runtime.reconcile(); assert.equal(runtime.sender, null);
  state.now = start - 16 * 60000; await runtime.reconcile(); assert.equal(senderCount(state), 1);
  await runtime.close();
});
test('shutdown is idempotent, cancels polling and retries failures', async () => {
  const { runtime, state } = fixture(start);
  await runtime.start(); state.failStop = true;
  const closing = runtime.close(); assert.strictEqual(runtime.close(), closing);
  await assert.rejects(closing, /Launcher shutdown failed/);
  assert.equal(state.cancelled.length, 1);
  state.failStop = false; await runtime.close();
  assert.equal(runtime.spx.children.size, 0); assert.equal(runtime.sender, null);
  for (const task of state.tasks) task.fn();
  await runtime.queue;
  assert.equal(state.spawned.length, 2);
});
test('loadSettings requires schedule, unique services and real executable/cwd paths', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piraiders-settings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'launcher.json');
  const valid = { ...settings, services: settings.services.map(s => ({ name: s.name, executable: process.execPath, args: [], cwd: '.' })) };
  fs.writeFileSync(file, JSON.stringify(valid));
  assert.equal(loadSettings(file).services.length, 2);
  fs.writeFileSync(file, JSON.stringify({ ...valid, productionWindow: undefined }));
  assert.throws(() => loadSettings(file), /Window/);
  fs.writeFileSync(file, JSON.stringify({ ...valid, services: [valid.services[0], valid.services[0]] }));
  assert.throws(() => loadSettings(file), /Exactly one/);
  fs.writeFileSync(file, JSON.stringify({ ...valid, services: valid.services.map(s => ({ ...s, executable: dir })) }));
  assert.throws(() => loadSettings(file), /not a file/);
});

test('invalid sender specification is rejected before SPX startup', () => {
  assert.throws(() => new LauncherRuntime({ ...settings, services: [settings.services[0], { name: 'casparcg', command: '', args: [] }] }), /Invalid service/);
});
test('inhibited restart resumes if the clock returns inside the window', async () => {
  const { runtime, state } = fixture(start);
  await runtime.start();
  state.spawned[1].child.emit('exit', 1);
  state.now = end;
  state.tasks.find(task => task.wait === 1500).fn();
  state.now = start;
  await runtime.reconcile();
  assert.equal(senderCount(state), 2);
  await runtime.close();
});
test('process started diagnostics wait for successful OS spawn', async () => {
  const { runtime, state } = fixture(start);
  const starting = [], started = [];
  runtime.on('starting', event => starting.push(event));
  runtime.on('started', event => started.push(event));
  await runtime.start();
  assert.equal(starting.length, 2); assert.equal(started.length, 0);
  state.spawned[0].child.emit('spawn');
  state.spawned[1].child.emit('error', Error('spawn failed'));
  assert.equal(started.length, 1); assert.equal(started[0].name, 'spx');
  await runtime.close();
});
test('shutdown helper retries transient failure and surfaces exhausted attempts', async () => {
  let attempts = 0; const delays = [];
  await shutdownWithRetries({ close: async () => { if (++attempts < 3) throw Error('blocked'); } }, { delay: async ms => delays.push(ms) });
  assert.equal(attempts, 3); assert.deepEqual(delays, [1000, 1000]);
  attempts = 0;
  await assert.rejects(shutdownWithRetries({ close: async () => { attempts++; throw Error('still blocked'); } }, { delay: async () => {} }), /still blocked/);
  assert.equal(attempts, 3);
});
