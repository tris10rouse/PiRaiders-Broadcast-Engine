'use strict';
// 5e-1: the soak's rules. The Windows numbers come only from the soak job on
// GitHub (5e-2, 5e-3); these Linux tests cover the plan, the memory and handle
// bounds, the no-lost-Stop rule and the record.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const soak = require('../scripts/soak-proof.cjs');

const MiB = 1024 * 1024;
const checkPlan = () => soak.soakPlan({ durationMs: 10 * 60000, checkRun: true });
function samples(plan, at = () => ({ workingSetBytes: 600 * MiB, handles: 3000 })) {
  return Array.from({ length: plan.cycles }, (_, cycle) => ({ cycle, ...at(cycle) }));
}
function stops(plan, blackAfter = () => 1200) {
  return plan.steps.filter(s => s.action === 'stop').map(s => ({ cycle: s.cycle, transport: s.transport, issuedAt: 1000 + s.atMs, blackAt: 1000 + s.atMs + blackAfter(s.cycle) }));
}

test('soak plan: four hours by default, one-minute cycles, fixed steps and offsets', () => {
  const plan = soak.soakPlan();
  assert.equal(plan.run, 'soak');
  assert.equal(plan.durationMs, 4 * 3600000);
  assert.equal(plan.cycles, 240);
  assert.equal(plan.steps.length, 240 * 6);
  assert.deepEqual(plan.steps.slice(0, 6).map(s => [s.step, s.atMs, s.action, s.expect, s.transport]), [
    ['launch', 0, 'launch', 0, 'rosstalk'], ['next-1', 8000, 'next', 1, 'rosstalk'], ['next-2', 16000, 'next', 2, 'rosstalk'],
    ['previous', 24000, 'previous', 1, 'rosstalk'], ['reload', 32000, 'reload', 1, 'rosstalk'], ['stop', 40000, 'stop', 'black', 'rosstalk']]);
  // Stop alternates: RossTalk on even cycles, the command route on odd ones; nothing else uses the route.
  const stopSteps = plan.steps.filter(s => s.action === 'stop');
  assert.deepEqual(stopSteps.slice(0, 4).map(s => s.transport), ['rosstalk', 'route', 'rosstalk', 'route']);
  assert.ok(plan.steps.filter(s => s.action !== 'stop').every(s => s.transport === 'rosstalk'));
  // Every offset is fixed: cycle n starts at n minutes, steps inside the cycle, Stop leaves black time before the next.
  for (const s of plan.steps) assert.equal(s.atMs - s.cycle * 60000, soak.CYCLE_STEPS.find(c => c.step === s.step).atMs);
  assert.ok(soak.CYCLE_STEPS.at(-1).atMs + soak.STOP_BLACK_BOUND_MS < soak.CYCLE_MS);
  assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.steps) && Object.isFrozen(plan.steps[0]));
});

test('soak plan: a shorter run is only a check run, named as such; the soak is never shorter than four hours', () => {
  assert.equal(checkPlan().run, 'check-run');
  assert.equal(checkPlan().cycles, 10);
  assert.throws(() => soak.soakPlan({ durationMs: 10 * 60000 }), { code: 'SOAK_PLAN_INVALID' });
  assert.throws(() => soak.soakPlan({ durationMs: 4 * 3600000, checkRun: true }), { code: 'SOAK_PLAN_INVALID' });
  assert.equal(soak.soakPlan({ durationMs: 5 * 3600000 }).cycles, 300);
  for (const bad of [{ durationMs: 5 * 3600000 + 60000 }, { durationMs: 4 * 60000, checkRun: true }, { durationMs: 90000, checkRun: true },
    { durationMs: -60000, checkRun: true }, { durationMs: '600000', checkRun: true }, { durationMs: 600000, checkRun: 'yes' }])
    assert.throws(() => soak.soakPlan(bad), { code: 'SOAK_PLAN_INVALID' }, JSON.stringify(bad));
});

test('soak bounds: baseline is the median of cycles 1 to 3 (never the warm-up cycle); growth is the larger of share and floor', () => {
  const plan = checkPlan();
  const list = samples(plan, cycle => ({ workingSetBytes: cycle === 0 ? 100 * MiB : [0, 500, 520, 510][cycle] * MiB || 520 * MiB, handles: cycle === 0 ? 10 : 2000 }));
  const summary = soak.checkSamples(list, plan);
  assert.deepEqual(summary.baseline, { workingSetBytes: 510 * MiB, handles: 2000 });
  // 25% of 510 MiB (127.5 MiB) is below the 128 MiB floor; 20% of 2000 (400) is below the 500 floor.
  assert.equal(summary.bounds.workingSetBytes, 510 * MiB + 128 * MiB);
  assert.equal(summary.bounds.handles, 2500);
  // A large baseline takes the share.
  const big = soak.checkSamples(samples(plan, () => ({ workingSetBytes: 2048 * MiB, handles: 10000 })), plan);
  assert.equal(big.bounds.workingSetBytes, 2560 * MiB);
  assert.equal(big.bounds.handles, 12000);
  assert.equal(big.largestGrowth.workingSetBytes, 0);
  // The share is never rounded up (review, fence 92): 20% of 2503 handles is 500.6, so 3004 is over.
  assert.throws(() => soak.checkSamples(samples(plan, () => ({ workingSetBytes: 600 * MiB, handles: 2503 })).map(x => (x.cycle >= 4 ? { ...x, handles: 3004 } : x)), plan), { code: 'SOAK_HANDLES_OVER_BOUND' });
  assert.equal(soak.checkSamples(samples(plan, () => ({ workingSetBytes: 4000000001, handles: 3000 })), plan).bounds.workingSetBytes, 4000000001 + 1000000000);
});

test('soak bounds: exactly the bound passes, one byte or one handle over fails with the first cycle over', () => {
  const plan = checkPlan();
  const base = { workingSetBytes: 600 * MiB, handles: 3000 };
  const atBound = soak.checkSamples(samples(plan, c => (c === 7 ? { workingSetBytes: 750 * MiB, handles: 3600 } : base)), plan);
  assert.equal(atBound.largestGrowth.workingSetBytes, 150 * MiB);
  assert.equal(atBound.largestGrowth.handles, 600);
  assert.throws(() => soak.checkSamples(samples(plan, c => (c >= 6 ? { workingSetBytes: 750 * MiB + 1, handles: 3000 } : base)), plan), error => {
    assert.equal(error.code, 'SOAK_MEMORY_OVER_BOUND');
    assert.equal(error.summary.firstOverCycle, 6);
    return true;
  });
  assert.throws(() => soak.checkSamples(samples(plan, c => (c === 9 ? { workingSetBytes: 600 * MiB, handles: 3601 } : base)), plan), error => {
    assert.equal(error.code, 'SOAK_HANDLES_OVER_BOUND');
    assert.equal(error.summary.firstOverCycle, 9);
    return true;
  });
});

test('soak bounds: unreadable samples are counted; a baseline needs two readable, past 5% unreadable fails', () => {
  const plan = soak.soakPlan({ durationMs: 40 * 60000, checkRun: true });
  const base = { workingSetBytes: 600 * MiB, handles: 3000 };
  // 2 of 40 = 5%: passes, and is counted.
  const two = soak.checkSamples(samples(plan, c => (c === 10 || c === 20 ? { unreadable: true } : base)), plan);
  assert.equal(two.samplesUnreadable, 2);
  assert.throws(() => soak.checkSamples(samples(plan, c => (c === 10 || c === 20 || c === 30 ? { unreadable: true } : base)), plan), { code: 'SOAK_SAMPLES_UNREADABLE' });
  assert.throws(() => soak.checkSamples(samples(plan, c => (c === 1 || c === 2 ? { unreadable: true } : base)), plan), { code: 'SOAK_BASELINE_UNREADABLE' });
  // A growth hidden behind an unreadable baseline sample still counts against the readable median.
  assert.equal(soak.checkSamples(samples(plan, c => (c === 2 ? { unreadable: true } : base)), plan).baseline.workingSetBytes, 600 * MiB);
});

test('soak bounds: one sample per cycle, in order, with real numbers', () => {
  const plan = checkPlan();
  const good = samples(plan);
  for (const bad of [good.slice(1), [...good, { cycle: 10, workingSetBytes: 1, handles: 1 }], good.map((s, i) => (i === 4 ? { ...s, cycle: 5 } : s)),
    good.map((s, i) => (i === 4 ? { cycle: 4, workingSetBytes: -1, handles: 1 } : s)), good.map((s, i) => (i === 4 ? { cycle: 4, workingSetBytes: 0, handles: 1 } : s)),
    good.map((s, i) => (i === 4 ? { cycle: 4, workingSetBytes: 1.5, handles: 1 } : s)), good.map((s, i) => (i === 4 ? { cycle: 4 } : s)), null])
    assert.throws(() => soak.checkSamples(bad, plan), { code: 'SOAK_SAMPLES_MISSING' });
  // Holes are missing samples, not skipped ones (review, fence 92), and the record names the rule.
  const holed = samples(plan);
  delete holed[5];
  for (const bad of [holed, new Array(plan.cycles)]) {
    assert.throws(() => soak.checkSamples(bad, plan), { code: 'SOAK_SAMPLES_MISSING' });
    assert.throws(() => soak.soakRecord({ plan, cyclesCompleted: 10, samples: bad, stops: stops(plan) }), error => {
      assert.equal(error.code, 'SOAK_SAMPLES_MISSING');
      assert.equal(error.soak.rule, 'SOAK_SAMPLES_MISSING');
      return true;
    });
  }
});

test('no lost Stop: every planned Stop issued on its transport and seen black within the bound', () => {
  const plan = checkPlan();
  const ok = soak.checkStops(stops(plan, c => (c === 3 ? soak.STOP_BLACK_BOUND_MS : 800)), plan);
  assert.equal(ok.stopsPlanned, 10);
  assert.equal(ok.stopsIssued, 10);
  assert.equal(ok.stopsSeenBlack, 10);
  assert.equal(ok.slowestStopToBlackMs, 5000);
  assert.equal(ok.stopsOverRossTalk, 5);
  assert.equal(ok.stopsOverRoute, 5);
  const lost = (list, cycle) => assert.throws(() => soak.checkStops(list, plan), error => {
    assert.equal(error.code, 'SOAK_STOP_LOST');
    assert.equal(error.summary.firstLostCycle, cycle);
    return true;
  });
  lost(stops(plan, c => (c === 4 ? soak.STOP_BLACK_BOUND_MS + 1 : 800)), 4);
  lost(stops(plan).map(s => (s.cycle === 6 ? { ...s, blackAt: null } : s)), 6);
  lost(stops(plan).map(s => (s.cycle === 2 ? { ...s, blackAt: s.issuedAt - 1 } : s)), 2);
  lost(stops(plan).map(s => (s.cycle === 1 ? { ...s, transport: 'rosstalk' } : s)), 1);
  lost(stops(plan).slice(0, 9), 9);
  // Only Stops issued on their cycle and transport at a real time count as issued (review, fence 92).
  assert.throws(() => soak.checkStops(Array.from({ length: 10 }, (_, cycle) => ({ cycle })), plan), error => {
    assert.equal(error.summary.stopsIssued, 0);
    assert.equal(error.summary.stopsSeenBlack, 0);
    return true;
  });
  assert.throws(() => soak.checkStops(stops(plan).map(s => (s.cycle === 6 ? { ...s, blackAt: null } : s)), plan), error => {
    assert.equal(error.summary.stopsIssued, 10);
    assert.equal(error.summary.stopsSeenBlack, 9);
    return true;
  });
  assert.throws(() => soak.checkStops([...stops(plan), { cycle: 10, transport: 'rosstalk', issuedAt: 1, blackAt: 2 }], plan), error => {
    assert.equal(error.code, 'SOAK_STOP_LOST');
    assert.equal(error.summary.firstLostCycle, null);
    return true;
  });
});

test('soak record: hosted-CI evidence, numbers and fixed words only; a broken rule keeps the record and names the rule', () => {
  const plan = checkPlan();
  const record = soak.soakRecord({ plan, cyclesCompleted: 10, samples: samples(plan), stops: stops(plan) });
  assert.equal(record.evidence, 'hosted-ci');
  assert.equal(record.targetPcEvidence, false);
  assert.equal(record.run, 'check-run');
  assert.equal(record.soak, false);
  assert.equal(record.noLostStop, true);
  assert.equal(record.withinBounds, true);
  for (const value of Object.values(record).flatMap(v => (v && typeof v === 'object' ? Object.values(v) : [v])))
    assert.ok(typeof value === 'number' || typeof value === 'boolean' || /^[a-z-]+$/.test(value), String(value));
  assert.equal(soak.soakRecord({ plan: soak.soakPlan(), cyclesCompleted: 240, samples: samples(soak.soakPlan()), stops: stops(soak.soakPlan()) }).soak, true);
  assert.throws(() => soak.soakRecord({ plan, cyclesCompleted: 9, samples: samples(plan), stops: stops(plan) }), error => {
    assert.equal(error.code, 'SOAK_INCOMPLETE');
    assert.equal(error.soak.rule, 'SOAK_INCOMPLETE');
    assert.equal(error.soak.cyclesCompleted, 9);
    return true;
  });
  assert.throws(() => soak.soakRecord({ plan, cyclesCompleted: 10, samples: samples(plan, c => ({ workingSetBytes: (c > 5 ? 900 : 600) * MiB, handles: 3000 })), stops: stops(plan) }), error => {
    assert.equal(error.soak.rule, 'SOAK_MEMORY_OVER_BOUND');
    assert.equal(error.soak.stopsSeenBlack, 10);
    assert.equal(error.soak.firstOverCycle, 6);
    assert.equal(error.soak.evidence, 'hosted-ci');
    return true;
  });
  assert.throws(() => soak.soakRecord({ plan, cyclesCompleted: 10, samples: samples(plan), stops: stops(plan).slice(1) }), error => {
    assert.equal(error.soak.rule, 'SOAK_STOP_LOST');
    return true;
  });
});

test('soak rules: the design note states the same bounds as the module', () => {
  const note = fs.readFileSync(path.join(__dirname, '..', 'docs', 'design', 'SOAK_PROOF.md'), 'utf8');
  assert.ok(soak.WORKING_SET_GROWTH_SHARE === 0.25 && note.includes('25%') && note.includes('128 MiB'));
  assert.ok(soak.HANDLE_GROWTH_SHARE === 0.2 && note.includes('20%') && note.includes('500 handles'));
  assert.ok(soak.STOP_BLACK_BOUND_MS === 5000 && note.includes('5 s'));
  assert.ok(soak.UNREADABLE_SHARE_LIMIT === 0.05 && note.includes('5%'));
  assert.match(note, /hosted-CI evidence/);
});
