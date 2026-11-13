'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWindow, senderAllowed, nextBoundary, ProductionWindowGate } = require('../scripts/lib/production-window.cjs');

const config = { start: '2026-11-13T19:00:00-06:00', end: '2026-11-13T22:00:00-06:00', prewarmMinutes: 15 };
const t = x => Date.parse(x);
test('fail closed on missing timezone, inverted and excessively long windows', () => {
  assert.throws(() => normalizeWindow({ ...config, start: '2026-11-13T19:00:00' }), /timezone/);
  assert.throws(() => normalizeWindow({ ...config, end: config.start }), /positive/);
  assert.throws(() => normalizeWindow({ ...config, end: '2026-11-15T22:00:00-06:00' }), /24 hours/);
  assert.throws(() => normalizeWindow({ ...config, prewarmMinutes: 999 }), /prewarm/);
});
test('prewarm begins 15 minutes early and sender stops at end exclusive', () => {
  const w = normalizeWindow(config);
  assert.equal(senderAllowed(w, t('2026-11-13T18:44:59-06:00')), false);
  assert.equal(senderAllowed(w, t('2026-11-13T18:45:00-06:00')), true);
  assert.equal(senderAllowed(w, t('2026-11-13T21:59:59-06:00')), true);
  assert.equal(senderAllowed(w, t('2026-11-13T22:00:00-06:00')), false);
  assert.equal(nextBoundary(w, t('2026-11-13T18:30:00-06:00')), t('2026-11-13T18:45:00-06:00'));
  assert.equal(nextBoundary(w, t('2026-11-13T19:00:00-06:00')), t('2026-11-13T22:00:00-06:00'));
  assert.equal(nextBoundary(w, t('2026-11-13T23:00:00-06:00')), null);
});
test('explicit offsets preserve correct instants through daylight saving time', () => {
  const w = normalizeWindow({ start: '2026-11-01T01:30:00-05:00', end: '2026-11-01T01:30:00-06:00', prewarmMinutes: 0 });
  assert.equal(w.endMs - w.startMs, 3600000);
  assert.equal(senderAllowed(w, t('2026-11-01T01:45:00-05:00')), true);
});
test('controller starts once, stops once, and remains idle outside window', async () => {
  let now = t('2026-11-13T18:30:00-06:00'), starts = 0, stops = 0;
  const gate = new ProductionWindowGate({ window: config, clock: () => now, startSender: async () => { starts++; }, stopSender: async () => { stops++; } });
  await gate.reconcile(); assert.equal(starts, 0);
  now = t('2026-11-13T18:45:00-06:00');
  await Promise.all([gate.reconcile(), gate.reconcile(), gate.reconcile()]);
  assert.equal(starts, 1);
  now = t('2026-11-13T22:00:00-06:00');
  await gate.reconcile(); await gate.reconcile();
  assert.equal(stops, 1);
  await gate.close(); assert.equal(stops, 2);
});
test('failed start is retryable and failed stop does not falsely mark stopped', async () => {
  let now = t('2026-11-13T19:00:00-06:00'), starts = 0, stops = 0;
  const gate = new ProductionWindowGate({ window: config, clock: () => now,
    startSender: async () => { if (++starts === 1) throw Error('start failed'); },
    stopSender: async () => { if (++stops === 1) throw Error('stop failed'); }
  });
  await assert.rejects(gate.reconcile(), /start failed/);
  await gate.reconcile(); assert.equal(starts, 2);
  now = t('2026-11-13T22:00:00-06:00');
  await assert.rejects(gate.reconcile(), /stop failed/);
  await gate.reconcile(); assert.equal(stops, 2);
  await gate.close();
});
test('shutdown serializes with in-flight startup and prevents later restart', async () => {
  let finish, starts = 0, stops = 0;
  const gate = new ProductionWindowGate({ window: config, clock: () => t('2026-11-13T19:00:00-06:00'),
    startSender: () => { starts++; return new Promise(resolve => { finish = resolve; }); },
    stopSender: async () => { stops++; }
  });
  const starting = gate.reconcile();
  // Flush queued microtask to enter start callback.
  await Promise.resolve(); await Promise.resolve();
  const closing = gate.close();
  finish();
  await starting; await closing; await gate.reconcile();
  assert.equal(starts, 1); assert.equal(stops, 1);
});
