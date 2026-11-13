'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWindow, senderAllowed } = require('../scripts/lib/production-window.cjs');
const valid = { start: '2026-11-13T19:00:00-06:00', end: '2026-11-13T22:00:00-06:00' };
test('rejects normalized impossible calendar dates and clock fields', () => {
  for (const start of ['2026-02-30T19:00:00-06:00', '2026-11-13T24:00:00-06:00', '2026-11-13T19:60:00-06:00', '2026-11-13T19:00:60-06:00', '2026-11-13T19:00:00+24:00']) {
    assert.throws(() => normalizeWindow({ ...valid, start }));
  }
  assert.doesNotThrow(() => normalizeWindow({ start: '2028-02-29T19:00:00Z', end: '2028-02-29T20:00:00Z' }));
});
test('raw invalid windows fail closed rather than permitting sender', () => {
  for (const window of [null, {}, { startMs: 1, endMs: 0, prewarmMs: 0 }, { startMs: 0, endMs: 100, prewarmMs: -1 }, { startMs: 0, endMs: 100, prewarmMs: 3600001 }]) {
    assert.equal(senderAllowed(window, 50), false);
  }
});
