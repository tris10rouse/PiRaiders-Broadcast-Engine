'use strict';
// 5d-1: a console close reaches Node on Windows as SIGHUP (CTRL_CLOSE_EVENT),
// Ctrl+Break as SIGBREAK. Both entries must close what they own on either,
// as they already do on SIGINT and SIGTERM. Linux sends a real SIGHUP here;
// the Windows console close itself is proven by the Windows job (5d-2).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const repository = path.resolve(__dirname, '..');

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function gone(pid, ms = 8000) {
  const end = Date.now() + ms;
  while (alive(pid) && Date.now() < end) await delay(50);
  return !alive(pid);
}
function lines(child, onEvent) {
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (let end; (end = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { onEvent(JSON.parse(line)); } catch {}
    }
  });
}

test('shutdown signals: the console close and Ctrl+Break signals are included', () => {
  const { SHUTDOWN_SIGNALS } = require('../scripts/lib/shutdown-signals.cjs');
  assert.deepEqual([...SHUTDOWN_SIGNALS].sort(), ['SIGBREAK', 'SIGHUP', 'SIGINT', 'SIGTERM']);
  assert.ok(Object.isFrozen(SHUTDOWN_SIGNALS));
});

test('shutdown signals: each one runs the same shutdown, repeats do not stack listeners', () => {
  const { bindShutdownSignals } = require('../scripts/lib/shutdown-signals.cjs');
  const { EventEmitter } = require('node:events');
  const fake = new EventEmitter(); let calls = 0;
  bindShutdownSignals(fake, () => { calls++; });
  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) { assert.equal(fake.listenerCount(name), 1, name); fake.emit(name); }
  assert.equal(calls, 4);
  assert.throws(() => bindShutdownSignals(fake, 'not a function'));
});

test('both entries bind the shared shutdown signals', async () => {
  for (const entry of ['piraiders-app.cjs', 'piraiders-launcher.cjs']) {
    const text = await fs.readFile(path.join(repository, 'scripts', entry), 'utf8');
    assert.match(text, /bindShutdownSignals\(process,\s*shutdown\)/, entry);
    assert.doesNotMatch(text, /process\.on\('SIG/, entry + ' binds signals only through the shared list');
  }
});

test('launcher: a console close (SIGHUP) closes both owned services and exits', {
  skip: process.platform === 'win32' && 'POSIX signal delivery; the Windows console close is the Windows job (5d-2)',
  timeout: 30000
}, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'piraiders-console-close-'));
  const config = path.join(root, 'config'); await fs.mkdir(config);
  const now = Date.now();
  const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const idle = ['-e', 'setInterval(()=>{},1000)'];
  const file = path.join(config, 'piraiders-launcher.json');
  await fs.writeFile(file, JSON.stringify({
    productionWindow: { start: iso(now - 60000), end: iso(now + 3600000), prewarmMinutes: 0 },
    services: [
      { name: 'spx', executable: process.execPath, args: idle, cwd: '.' },
      { name: 'casparcg', executable: process.execPath, args: idle, cwd: '.' }
    ]
  }));
  const launcher = spawn(process.execPath, [path.join(repository, 'scripts', 'piraiders-launcher.cjs'), file], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(launcher, 'exit');
  const pids = new Map();
  lines(launcher, event => { if (event.event === 'started' && Number.isSafeInteger(event.pid)) pids.set(event.name, event.pid); });
  t.after(async () => {
    for (const pid of pids.values()) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    if (launcher.exitCode === null && launcher.signalCode === null) launcher.kill('SIGKILL');
    await fs.rm(root, { recursive: true, force: true });
  });
  const end = Date.now() + 10000;
  while (pids.size < 2 && Date.now() < end) await delay(50);
  assert.equal(pids.size, 2, 'both services started');
  for (const pid of pids.values()) assert.ok(alive(pid));
  launcher.kill('SIGHUP');
  const [code, signal] = await exited;
  assert.equal(signal, null, 'the launcher handled the console close itself');
  assert.equal(code, 0);
  for (const [name, pid] of pids) assert.ok(await gone(pid), name + ' must not survive a console close');
});
