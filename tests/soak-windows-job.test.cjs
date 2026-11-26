'use strict';
// 5e-2: the soak job's Linux-testable parts (run length, usage sample, step
// wait) and its workflow's shape. The Windows numbers come only from the job
// on GitHub; these tests never claim them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const job = require('../scripts/soak-windows-job.cjs');
const soak = require('../scripts/soak-proof.cjs');
const root = path.join(__dirname, '..');

const MiB = 1024 * 1024;
const parent = { ProcessId: 100, ParentProcessId: 1, CreationUtcTicks: '638000000000000000', ExecutablePath: 'c:\\n\\node.exe' };
function rows(extra = []) {
  return [
    { ProcessId: process.pid, ParentProcessId: 0, CreationUtcTicks: '637000000000000000', ExecutablePath: 'C:\\n\\node.exe', WorkingSetSize: 1, HandleCount: 1 },
    { ProcessId: 100, ParentProcessId: 1, CreationUtcTicks: '638000000000000000', ExecutablePath: 'C:\\n\\node.exe', WorkingSetSize: 100 * MiB, HandleCount: 400 },
    { ProcessId: 101, ParentProcessId: 100, CreationUtcTicks: '638000000000000100', ExecutablePath: 'C:\\n\\node.exe', WorkingSetSize: 200 * MiB, HandleCount: 600 },
    { ProcessId: 102, ParentProcessId: 101, CreationUtcTicks: '638000000000000200', ExecutablePath: 'C:\\c\\casparcg.exe', WorkingSetSize: 300 * MiB, HandleCount: 1000 },
    // Not owned: another process, and a stale child whose parent id was reused.
    { ProcessId: 200, ParentProcessId: 1, CreationUtcTicks: '638000000000000300', ExecutablePath: 'C:\\x\\other.exe', WorkingSetSize: 999 * MiB, HandleCount: 9999 },
    { ProcessId: 103, ParentProcessId: 100, CreationUtcTicks: '637999999999999999', ExecutablePath: 'C:\\x\\stale.exe', WorkingSetSize: 999 * MiB, HandleCount: 9999 },
    ...extra];
}

test('soak job: the input names the run; under four hours is a check run, never the soak', () => {
  const check = job.soakDuration('5');
  assert.equal(check.run, 'check-run'); assert.equal(check.cycles, 5);
  assert.equal(job.soakDuration('239').run, 'check-run');
  const full = job.soakDuration('240');
  assert.equal(full.run, 'soak'); assert.equal(full.cycles, 240); assert.equal(full.durationMs, soak.DEFAULT_SOAK_MS);
  assert.equal(job.soakDuration('300').cycles, 300);
  for (const bad of ['', '4', '301', '0', '05', '5.5', ' 5', '-5', '1e3', '99999', undefined, 5])
    assert.throws(() => job.soakDuration(bad), { code: 'SOAK_DURATION_INVALID' }, String(bad));
});

test('soak job: the sample sums the application process and its descendants only', () => {
  assert.deepEqual(job.ownedUsage(rows(), parent), { workingSetBytes: 600 * MiB, handles: 2000, processes: 3 });
  const s = job.sampleCycle(7, parent, () => rows());
  assert.deepEqual(s, { cycle: 7, workingSetBytes: 600 * MiB, handles: 2000, processes: 3 });
});

test('soak job: a gone, replaced or unreadable application is an unreadable sample, never a skipped one', () => {
  assert.throws(() => job.ownedUsage(rows().filter(r => r.ProcessId !== 100), parent), { code: 'SOAK_SAMPLE_PARENT_GONE' });
  const reused = rows().map(r => r.ProcessId === 100 ? { ...r, CreationUtcTicks: '638000000000000001' } : r);
  assert.throws(() => job.ownedUsage(reused, parent), { code: 'SOAK_SAMPLE_PARENT_GONE' });
  const noSize = rows().map(r => r.ProcessId === 102 ? { ...r, WorkingSetSize: null } : r);
  assert.throws(() => job.ownedUsage(noSize, parent), { code: 'SOAK_SAMPLE_INVALID' });
  const noHandles = rows().map(r => r.ProcessId === 101 ? { ...r, HandleCount: -1 } : r);
  assert.throws(() => job.ownedUsage(noHandles, parent), { code: 'SOAK_SAMPLE_INVALID' });
  // An owned child without an image or start time cannot be told apart: unreadable.
  assert.throws(() => job.ownedUsage(rows([{ ProcessId: 104, ParentProcessId: 101, CreationUtcTicks: null, ExecutablePath: null, WorkingSetSize: 1, HandleCount: 1 }]), parent));
  for (const read of [() => { throw Object.assign(Error('t'), { code: 'ETIMEDOUT' }); }, () => 'not rows', () => rows().filter(r => r.ProcessId !== 100)])
    assert.deepEqual(job.sampleCycle(3, parent, read), { cycle: 3, unreadable: true });
  // The samples go straight into the 5e-1 rules.
  const plan = soak.soakPlan({ durationMs: 5 * 60000, checkRun: true });
  const samples = Array.from({ length: 5 }, (_, c) => job.sampleCycle(c, parent, () => rows()));
  assert.equal(soak.checkSamples(samples, plan).baseline.workingSetBytes, 600 * MiB);
});

test('soak job: a step waits for its offset, is never started early and reports how late it starts', async () => {
  let clock = 1000; const slept = [];
  const late = await job.waitFor(5000, { now: () => clock, sleep: async ms => { slept.push(ms); clock += ms; } });
  assert.equal(late, 0); assert.deepEqual(slept, [4000]); assert.equal(clock, 5000);
  // A timer that wakes early is waited out again.
  clock = 0; slept.length = 0;
  await job.waitFor(1000, { now: () => clock, sleep: async ms => { slept.push(ms); clock += Math.ceil(ms / 2); } });
  assert.ok(clock >= 1000); assert.ok(slept.length >= 2);
  clock = 7300;
  assert.equal(await job.waitFor(5000, { now: () => clock, sleep: async () => assert.fail('no wait when late') }), 2300);
});

test('soak job: the usage query holds no double quote, so Windows quoting leaves it whole', () => {
  assert.equal(job.USAGE_QUERY.includes('"'), false);
  assert.match(job.USAGE_QUERY, /WorkingSetSize/); assert.match(job.USAGE_QUERY, /HandleCount/);
});

test('soak job: the workflow is triggered by hand for the soak; pull requests get a named check run', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'soak-proof.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:\s+inputs:\s+minutes:[\s\S]*?default: '240'/);
  assert.doesNotMatch(workflow, /^\s+push:/m);
  const checkRun = workflow.slice(workflow.indexOf('actual-soak-check-run:'), workflow.indexOf('actual-soak-dispatched:'));
  assert.match(checkRun, /if: github\.event_name == 'pull_request'/);
  assert.match(checkRun, /PIRAIDERS_SOAK_MINUTES: '5'/);
  assert.match(checkRun, /proof-evidence-privacy\.cjs soak build\/soak-proof-evidence/);
  const dispatched = workflow.slice(workflow.indexOf('actual-soak-dispatched:'));
  assert.match(dispatched, /if: github\.event_name == 'workflow_dispatch'/);
  assert.match(dispatched, /PIRAIDERS_SOAK_MINUTES: \$\{\{ inputs\.minutes \}\}/);
  // The longest plan (five hours) fits the job's timeout, which fits a hosted job's six hours.
  const timeout = Number(/timeout-minutes: (\d+)/.exec(dispatched)[1]);
  assert.ok(timeout * 60000 > soak.MAX_SOAK_MS + 20 * 60000 && timeout <= 360, String(timeout));
  // The soak's own files start the check run (shared helpers are proven by the activation job).
  for (const file of ['scripts/smoke-soak-windows.cjs', 'scripts/soak-proof.cjs', 'scripts/soak-windows-job.cjs', '.github/workflows/soak-proof.yml'])
    assert.ok(workflow.includes("- '" + file + "'"), file);
});

test('soak job: the script maps every plan action to the allowlisted RossTalk map and switches to Manual first', () => {
  const { GPI, STOP_LOOK_MS } = require('../scripts/smoke-soak-windows.cjs');
  for (const s of soak.CYCLE_STEPS) assert.ok(Number.isInteger(GPI[s.action]), s.action);
  const source = fs.readFileSync(path.join(root, 'scripts', 'smoke-soak-windows.cjs'), 'utf8');
  const map = /commandMap:\{([^}]*)\}/.exec(source)[1];
  for (const [action, gpi] of Object.entries(GPI)) assert.ok(map.includes(gpi + ":'" + action + "'"), action);
  assert.ok(source.indexOf("routes.command(client,'manual')") > 0 && source.indexOf("routes.command(client,'manual')") < source.indexOf('for(const s of plan.steps)'));
  // A Stop's black is looked for past the 5e-1 bound, so a slow black is measured and judged by the rules, not by a timeout.
  assert.ok(STOP_LOOK_MS > soak.STOP_BLACK_BOUND_MS);
  assert.match(source, /soak\.soakRecord\(\{plan,cyclesCompleted,samples,stops\}\)/);
});
