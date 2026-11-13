'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { JOB_HOST, spawnSupervisedProcess } = require('../scripts/lib/windows-job-process.cjs');
const { terminateProcessTree } = require('../scripts/lib/windows-process-tree.cjs');

const windows = { skip: process.platform !== 'win32' && 'Requires real Windows Job Objects; adapter tests run on every OS', timeout: 45000 };
const service = path.join(__dirname, 'fixtures', 'job-service.cjs');
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function gone(pid) {
  const deadline = Date.now() + 10000;
  while (alive(pid) && Date.now() < deadline) await delay(25);
  assert.equal(alive(pid), false, 'test-created process ' + pid + ' must exit');
}
async function readState(file, child) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    if (child.exitCode !== null || child.signalCode !== null) throw Error('Fixture host exited before readiness: ' + child.exitCode);
    await delay(25);
  }
  throw Error('Fixture process handshake timed out');
}
function resources(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-containment-'));
  const owned = new Set();
  t.after(async () => {
    // Never discover or target arbitrary processes; only PIDs from our fixtures.
    for (const pid of owned) if (alive(pid)) await terminateProcessTree({ pid, kill() {} });
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, file: path.join(dir, 'state.json'), owned };
}
async function startTree(t, mode = 'hold', args = []) {
  const r = resources(t);
  const child = spawnSupervisedProcess(process.execPath, [service, 'root', r.file, mode, ...args], { cwd: r.dir });
  const errors = []; child.on('error', error => errors.push(error));
  if (child.pid) r.owned.add(child.pid);
  const exit = once(child, 'exit');
  // readState reports startup failure; retain a handler until it can do so.
  exit.catch(() => {});
  const state = await readState(r.file, child);
  for (const pid of [state.rootPid, state.descendantPid]) { assert.ok(Number.isSafeInteger(pid) && pid > 0); r.owned.add(pid); }
  assert.deepEqual(errors, []);
  return { ...r, child, state, exit };
}

test('Windows Job Object closes root and descendants on launcher pipe EOF', windows, async t => {
  const { child, state, exit } = await startTree(t);
  assert.equal(alive(state.rootPid), true); assert.equal(alive(state.descendantPid), true);
  child.stdin.end();
  const [code] = await exit;
  assert.equal(code, 252); // Parent-loss cleanup is diagnostic exit 252.
  await Promise.all([gone(state.rootPid), gone(state.descendantPid)]);
});
test('Windows root crash closes its job before host exit and preserves exit code', windows, async t => {
  const { state, exit } = await startTree(t, 'exit17');
  const [code] = await exit;
  assert.equal(code, 17);
  assert.equal(alive(state.descendantPid), false, 'descendant must be gone before host exit');
  await gone(state.rootPid);
});
test('killing only the Windows containment host kills every job descendant', windows, async t => {
  const { child, state, exit } = await startTree(t);
  // No taskkill /T: this must prove kernel Job Object ownership itself.
  child.kill('SIGKILL'); await exit;
  await Promise.all([gone(state.rootPid), gone(state.descendantPid)]);
});
test('abrupt death of only the Node launcher closes its Windows service job', windows, async t => {
  const r = resources(t);
  const launcher = fork(path.join(__dirname, 'fixtures', 'job-launcher.cjs'), [r.file], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'inherit', 'ipc']
  });
  r.owned.add(launcher.pid);
  const message = once(launcher, 'message', { signal: AbortSignal.timeout(10000) });
  const [event] = await message;
  assert.ok(Number.isSafeInteger(event.hostPid) && event.hostPid > 0); r.owned.add(event.hostPid);
  const state = await readState(r.file, launcher);
  r.owned.add(state.rootPid); r.owned.add(state.descendantPid);
  launcher.kill('SIGKILL');
  await Promise.all([gone(event.hostPid), gone(state.rootPid), gone(state.descendantPid)]);
});
test('Windows native host forwards exact Unicode/quoted argv and working directory', windows, async t => {
  const args = ['', 'a b', 'a"b', 'tail\\', '\\\\"quoted', 'multiple\\\\', '鷹 🏴‍☠️', '&|%$`'];
  const { child, state, dir, exit } = await startTree(t, 'hold', args);
  assert.deepEqual(state.args, args);
  assert.equal(state.cwd.toLowerCase(), dir.toLowerCase());
  child.stdin.end(); await exit;
});
test('Windows native host fails nonzero without executing an invalid target', windows, async t => {
  const r = resources(t);
  const { spawn } = require('node:child_process');
  const child = spawn(JOB_HOST, [path.join(r.dir, 'does-not-exist.exe')], {
    cwd: r.dir, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe']
  });
  r.owned.add(child.pid);
  const chunks = []; child.stderr.on('data', data => chunks.push(data));
  const [code] = await once(child, 'exit');
  assert.notEqual(code, 0); assert.match(Buffer.concat(chunks).toString(), /fail|error|create/i);
  assert.equal(fs.existsSync(r.file), false);
});

test('Windows native CreateProcess failure never runs an existing invalid executable', windows, async t => {
  const r = resources(t);
  const invalid = path.join(r.dir, 'invalid.exe');
  fs.writeFileSync(invalid, 'This is deliberately not a Windows executable');
  const { spawn } = require('node:child_process');
  const child = spawn(JOB_HOST, [invalid], { cwd: r.dir, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  if (child.pid) r.owned.add(child.pid);
  const chunks = []; child.stderr.on('data', data => chunks.push(data));
  const [code] = await once(child, 'exit', { signal: AbortSignal.timeout(10000) });
  assert.notEqual(code, 0);
  assert.match(Buffer.concat(chunks).toString(), /CreateProcess/);
  assert.equal(fs.existsSync(r.file), false);
});
