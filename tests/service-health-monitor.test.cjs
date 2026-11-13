'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ServiceHealthMonitor } = require('../scripts/lib/service-health-monitor.cjs');
const config = { protocol: 'spx-http', port: 5656 };
function fixture(probe, options = {}, health = config) {
  let now = 0; const tasks = [], cancelled = [], events = [];
  const monitor = new ServiceHealthMonitor([{ name: 'spx', health }], {
    probe, clock: () => now, schedule: fn => { tasks.push(fn); return fn; },
    cancel: timer => cancelled.push(timer), intervalMs: 250, startupGraceMs: 1000, failureThreshold: 2, ...options
  });
  monitor.on('status', event => events.push(event));
  return { monitor, tasks, cancelled, events, now: value => { now = value; }, state: () => monitor.snapshot()[0] };
}
test('missing configuration remains explicitly not configured without any network probe', async () => {
  let calls = 0;
  const monitor = new ServiceHealthMonitor([{ name: 'spx' }], { probe: async () => { calls++; } });
  monitor.activate('spx', 1); await monitor.check('spx');
  assert.equal(monitor.snapshot()[0].status, 'not-configured'); assert.equal(calls, 0);
  monitor.close();
});
test('startup grace, degraded state, failure threshold and recovery are distinct', async () => {
  let result = { healthy: false, code: 'TIMEOUT' };
  const f = fixture(async () => result);
  f.monitor.activate('spx', 123); await f.monitor.check('spx');
  assert.equal(f.state().status, 'starting');
  f.now(1500); await f.monitor.check('spx'); assert.equal(f.state().status, 'unhealthy');
  result = { healthy: true, version: '1.4.1' }; await f.monitor.check('spx');
  assert.equal(f.state().status, 'ready'); assert.equal(f.state().scope, 'loopback-endpoint');
  result = { healthy: false, code: 'CONNECTION_FAILED' }; await f.monitor.check('spx');
  assert.equal(f.state().status, 'degraded');
  await f.monitor.check('spx'); assert.equal(f.state().status, 'unhealthy');
  result = { healthy: true, version: '1.4.1' }; await f.monitor.check('spx'); assert.equal(f.state().status, 'ready');
  f.monitor.close();
});
test('concurrent checks share one probe and old generation cannot publish success', async () => {
  const pending = [];
  const f = fixture((_config, { signal }) => new Promise(resolve => pending.push({ resolve, signal })));
  f.monitor.activate('spx', 1);
  const first = f.monitor.check('spx'); assert.strictEqual(f.monitor.check('spx'), first);
  await Promise.resolve(); assert.equal(pending.length, 1);
  f.monitor.deactivate('spx', 'starting'); f.monitor.activate('spx', 2);
  const second = f.monitor.check('spx'); await Promise.resolve();
  assert.equal(pending.length, 2); assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve({ healthy: true, version: 'new' }); await second;
  pending[0].resolve({ healthy: true, version: 'stale' }); await first;
  assert.equal(f.state().version, 'new'); assert.equal(f.state().pid, 2);
  f.monitor.close();
});
test('close aborts immediately and late ignored cancellation never re-arms health polling', async () => {
  let finish, signal;
  const f = fixture((_config, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
  f.monitor.activate('spx', 1); const pending = f.monitor.check('spx'); await Promise.resolve();
  assert.equal(f.monitor.close(), undefined); assert.equal(signal.aborted, true);
  assert.equal(f.state().status, 'stopping');
  finish({ healthy: true, version: 'stale' }); await pending;
  assert.equal(f.state().status, 'stopping'); assert.equal(f.tasks.length, 0);
  f.monitor.deactivate('spx', 'stopped'); assert.equal(f.state().status, 'stopped');
});
test('probe exceptions and unknown codes are sanitized and unchanged states do not flood logs', async () => {
  let throwing = true;
  const f = fixture(async () => { if (throwing) throw Error('secret-body-token'); return { healthy: false, code: 'secret-body-token', body: 'secret' }; }, { startupGraceMs: 0, failureThreshold: 1 });
  f.monitor.activate('spx', 5); await f.monitor.check('spx');
  assert.equal(f.state().status, 'unhealthy'); assert.equal(f.state().code, 'PROBE_FAILED');
  const count = f.events.length;
  throwing = false; await f.monitor.check('spx'); await f.monitor.check('spx');
  assert.equal(f.events.length, count); assert.equal(JSON.stringify(f.events).includes('secret'), false);
  const snapshot = f.monitor.snapshot(); snapshot[0].status = 'made-up';
  assert.equal(f.state().status, 'unhealthy'); f.monitor.close();
});
test('invalid health service/configuration/timings fail before activation', () => {
  assert.throws(() => new ServiceHealthMonitor([{ name: 'spx', health: { ...config, host: '192.0.2.1' } }]));
  assert.throws(() => new ServiceHealthMonitor([{ name: 'spx', health: config }], { intervalMs: 1 }));
  assert.throws(() => new ServiceHealthMonitor([{ name: 'spx' }, { name: 'spx' }]));
});
