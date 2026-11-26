'use strict';
// 5d-4: cold start against the warm-up. The Windows numbers come only from the
// exchange activation job on GitHub; these Linux tests cover the rule itself
// and that the job applies it to its first start.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const proof = require('../scripts/cold-start-proof.cjs');
const { normalizeWindow } = require('../scripts/lib/production-window.cjs');

test('cold start: the bound is the production window default warm-up (15 minutes)', () => {
  const window = normalizeWindow({ start: '2026-01-01T18:00:00Z', end: '2026-01-01T21:00:00Z' });
  assert.equal(proof.DEFAULT_WARM_UP_MS, window.prewarmMs);
  assert.equal(proof.DEFAULT_WARM_UP_MS, 15 * 60000);
});

test('cold start: times and margins from one spawn, hosted-CI evidence only', () => {
  const record = proof.coldStartRecord({ spawnedAt: 1000.4, controllerAvailableAt: 3500.2, senderRunningAt: 41000.9 });
  assert.equal(record.processStartToControllerAvailableMs, 2500);
  assert.equal(record.processStartToSenderRunningMs, 40001);
  assert.equal(record.controllerMarginMs, 900000 - 2500);
  assert.equal(record.senderMarginMs, 900000 - 40001);
  assert.equal(record.withinWarmUp, true);
  assert.equal(record.evidence, 'hosted-ci');
  assert.equal(record.targetPcEvidence, false);
  assert.equal(record.senderState, 'sender-running');
  assert.equal(record.onAirCounted, false);
  assert.equal(record.senderDiscoveredCounted, false);
  // Numbers, booleans and fixed lower-case words only.
  for (const value of Object.values(record)) assert.ok(typeof value === 'number' || typeof value === 'boolean' || /^[a-z-]+$/.test(value), String(value));
});

test('cold start: exactly the warm-up passes, one millisecond over fails with the margin', () => {
  assert.equal(proof.coldStartRecord({ spawnedAt: 0, controllerAvailableAt: 10, senderRunningAt: 900000 }).senderMarginMs, 0);
  assert.throws(() => proof.coldStartRecord({ spawnedAt: 0, controllerAvailableAt: 10, senderRunningAt: 900001 }), error => {
    assert.equal(error.code, 'COLD_START_OVER_WARM_UP');
    assert.deepEqual(error.coldStart.over, ['sender-running']);
    assert.equal(error.coldStart.senderMarginMs, -1);
    assert.equal(error.coldStart.withinWarmUp, false);
    return true;
  });
  assert.throws(() => proof.coldStartRecord({ spawnedAt: 0, controllerAvailableAt: 60001, senderRunningAt: 60002 }, { warmUpMs: 60000 }), error => {
    assert.deepEqual(error.coldStart.over, ['controller-available', 'sender-running']);
    assert.equal(error.coldStart.controllerMarginMs, -1);
    return true;
  });
});

test('cold start: missing, negative or out-of-order times are refused, never read as fast', () => {
  for (const times of [
    { spawnedAt: 0, controllerAvailableAt: 10 },
    { spawnedAt: -1, controllerAvailableAt: 10, senderRunningAt: 20 },
    { spawnedAt: 0, controllerAvailableAt: NaN, senderRunningAt: 20 },
    { spawnedAt: 50, controllerAvailableAt: 10, senderRunningAt: 60 },
    { spawnedAt: 0, controllerAvailableAt: 30, senderRunningAt: 20 }]) {
    assert.throws(() => proof.coldStartRecord(times), { code: 'COLD_START_TIMES_INVALID' });
  }
  for (const warmUpMs of [0, -1, 1.5, Infinity]) assert.throws(() => proof.coldStartRecord({ spawnedAt: 0, controllerAvailableAt: 1, senderRunningAt: 2 }, { warmUpMs }), { code: 'COLD_START_TIMES_INVALID' });
});

test('cold start: the Windows job times its first start and keeps the record in result.json', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'smoke-exchange-activation-windows.cjs'), 'utf8');
  assert.match(source, /require\('\.\/cold-start-proof\.cjs'\)/);
  const first = source.indexOf("phase='APPLICATION'"), cached = source.indexOf("phase='CACHED_APPLICATION'");
  const spawned = source.indexOf('coldSpawnedAt=performance.now()');
  assert.ok(first > 0 && spawned > 0 && spawned < source.indexOf('full.application(', first) && spawned < cached, 'spawn time taken before the first start only');
  assert.ok(source.indexOf('coldControllerAt=performance.now()', first) < cached);
  assert.match(source, /coldSenderAt\?\?=performance\.now\(\)/);
  assert.match(source, /coldStart=coldStartProof\.coldStartRecord\(/);
  assert.match(source, /coldStart,/);
  assert.match(source, /coldStart:coldStart\|\|error\?\.coldStart\|\|null/);
});
