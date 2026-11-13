'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LauncherRuntime } = require('../scripts/lib/launcher-runtime.cjs');
const { loadSettings } = require('../scripts/piraiders-launcher.cjs');
const begin = Date.parse('2026-11-13T19:00:00Z'), end = begin + 3600000;
function fixture(probe) {
  const state = { now: begin, children: [], kills: [], failedStop: false, events: [] };
  const runtime = new LauncherRuntime({
    productionWindow: { start: new Date(begin).toISOString(), end: new Date(end).toISOString() },
    services: [{ name: 'spx', command: 'node', args: [] }, { name: 'casparcg', command: 'casparcg', args: [], health: { protocol: 'casparcg-amcp', port: 5250 } }]
  }, {
    clock: () => state.now, schedule: () => 1, cancel() {},
    healthOptions: { probe, schedule: () => 2, cancel() {} },
    supervisorOptions: { platform: 'win32', schedule: () => 3, cancel() {},
      spawnProcess: () => { const child = new EventEmitter(); child.pid = 9000 + state.children.length; child.kill = () => {}; state.children.push(child); return child; },
      execFileProcess: (_file, args, _options, callback) => { state.kills.push(args); callback(state.failedStop ? Error('blocked') : null); }
    }
  });
  runtime.on('service-health', event => state.events.push(event));
  return { runtime, state, sender: () => runtime.health.snapshot().find(s => s.name === 'casparcg') };
}
test('only OS spawn starts endpoint probing; process launch alone never reports ready', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { healthy: true, version: '2.4.0' }; });
  await f.runtime.start(); assert.equal(calls, 0); assert.equal(f.sender().status, 'starting');
  f.state.children[1].emit('spawn'); await f.runtime.health.check('casparcg');
  assert.equal(calls, 1); assert.equal(f.sender().status, 'ready');
  assert.equal(f.sender().scope, 'loopback-endpoint');
  await f.runtime.close(); assert.equal(f.sender().status, 'stopped');
});
test('window end does not await a stalled probe and discards its late success', async () => {
  let finish, signal;
  const f = fixture((_config, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
  await f.runtime.start(); f.state.children[1].emit('spawn');
  const pending = f.runtime.health.check('casparcg'); await Promise.resolve();
  f.state.now = end; await f.runtime.reconcile();
  assert.equal(f.state.kills.length, 1); assert.equal(signal.aborted, true); assert.equal(f.sender().status, 'stopped');
  finish({ healthy: true, version: 'stale' }); await pending;
  assert.equal(f.sender().status, 'stopped'); await f.runtime.close();
});
test('delayed old sender exit cannot invalidate replacement sender health', async () => {
  const f = fixture(async () => ({ healthy: true, version: '2.4.0' }));
  await f.runtime.start(); const old = f.state.children[1]; old.emit('spawn'); await f.runtime.health.check('casparcg');
  f.state.now = end; await f.runtime.reconcile();
  f.state.now = begin; await f.runtime.reconcile(); const next = f.state.children[2];
  next.emit('spawn'); await f.runtime.health.check('casparcg');
  old.emit('exit', 0); assert.equal(f.sender().status, 'ready'); assert.equal(f.sender().pid, next.pid);
  await f.runtime.close();
});
test('failed shutdown reports unhealthy, then confirmed retry reports stopped', async () => {
  const f = fixture(async () => ({ healthy: true, version: '2.4.0' }));
  await f.runtime.start(); f.state.children[1].emit('spawn'); await f.runtime.health.check('casparcg');
  f.state.failedStop = true; await assert.rejects(f.runtime.close(), /shutdown failed/);
  assert.equal(f.sender().status, 'unhealthy'); assert.equal(f.sender().code, 'SHUTDOWN_FAILED');
  f.state.failedStop = false; await f.runtime.close(); assert.equal(f.sender().status, 'stopped');
});
test('settings retain validated probe configuration and reject remote endpoints', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-health-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  const settings = { productionWindow: { start: new Date(begin).toISOString(), end: new Date(end).toISOString() }, services: [
    { name: 'spx', executable: process.execPath, args: [], health: { protocol: 'spx-http', port: 5656 } },
    { name: 'casparcg', executable: process.execPath, args: [] }
  ] };
  fs.writeFileSync(file, JSON.stringify(settings));
  assert.equal(loadSettings(file).services[0].health.host, '127.0.0.1');
  settings.services[0].health.host = '192.0.2.1'; fs.writeFileSync(file, JSON.stringify(settings));
  assert.throws(() => loadSettings(file), /loopback/);
});
