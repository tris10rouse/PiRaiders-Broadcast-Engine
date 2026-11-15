'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter, once } = require('node:events');
const { fork } = require('node:child_process');
const { PNG } = require('pngjs');
const { LauncherRuntime } = require('../scripts/lib/launcher-runtime.cjs');
const { createPreparedEventRuntime } = require('../scripts/lib/prepared-event-runtime.cjs');
const { stageSnapshot } = require('../scripts/lib/media-snapshot.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 500; i++) { if (fn()) return; await wait(10); } throw Error('test timeout'); }
const start = Date.parse('2026-11-15T18:00:00Z'), end = start + 3600000;
const settings = { productionWindow: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
  services: ['spx', 'casparcg'].map(name => ({ name, command: name, args: [] })) };
function launcherFixture(options = {}) {
  const state = { now: start, spawned: [], kills: [], tasks: [], failStop: false };
  const runtime = new LauncherRuntime(settings, { manageSpx: false, ...options,
    clock: () => state.now, schedule: (fn, delay) => { const task = { fn, delay }; state.tasks.push(task); return task; }, cancel() {},
    supervisorOptions: { platform: 'win32', schedule: (fn, delay) => { const task = { fn, delay }; state.tasks.push(task); return task; }, cancel() {},
      spawnProcess(command) { const child = new EventEmitter(); child.pid = 100 + state.spawned.length;
        child.kill = () => { throw Error('must use injected termination'); }; state.spawned.push({ command, child }); return child; },
      execFileProcess(file, args, opts, callback) { state.kills.push(args); callback(state.failStop ? Error('denied') : null); } } });
  return { runtime, state };
}

test('sender-only events preserve independently owned real Node HTTP process through recovery, window end and close', { timeout: 15000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'PiRaiders parent lifetime '));
  const script = path.join(root, 'parent-service.cjs');
  await fs.writeFile(script, "require('node:http').createServer((q,s)=>s.end('parent-alive')).listen(0,'127.0.0.1',function(){process.send({port:this.address().port});});");
  const parentService = fork(script, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  t.after(async () => { if (parentService.exitCode === null) { const exited = once(parentService, 'exit'); parentService.kill(); await exited; } await fs.rm(root, { recursive: true, force: true }); });
  const [{ port }] = await once(parentService, 'message');
  const parentPid = parentService.pid;
  const alive = async () => { assert.equal(parentService.pid, parentPid); assert.equal(parentService.exitCode, null); assert.equal(await (await fetch('http://127.0.0.1:' + port)).text(), 'parent-alive'); };
  const { runtime, state } = launcherFixture(); t.after(() => runtime.close());
  state.now = start - 16 * 60000;
  await runtime.start(); assert.equal(state.spawned.length, 0); await alive();
  state.now = start; await runtime.reconcile();
  assert.deepEqual(state.spawned.map(item => item.command), ['casparcg']);
  assert.deepEqual(runtime.health.snapshot().map(item => item.name), ['casparcg']);
  state.spawned[0].child.emit('spawn'); assert.equal(runtime.health.snapshot()[0].status, 'not-configured');
  state.spawned[0].child.emit('exit', 1);
  state.tasks.find(task => task.delay === 1500).fn();
  assert.deepEqual(state.spawned.map(item => item.command), ['casparcg', 'casparcg']); await alive();
  state.now = end; await runtime.reconcile(); assert.equal(runtime.sender, null);
  assert.deepEqual(state.kills, [['/PID', '101', '/T', '/F']]); await alive();
  await runtime.close(); assert.equal(runtime.health.snapshot()[0].status, 'stopped'); await alive();
  // A subsequent event owns another sender, never the application service.
  const next = launcherFixture(); t.after(() => next.runtime.close()); await next.runtime.start(); await next.runtime.close(); await alive();
  assert.deepEqual(next.state.spawned.map(item => item.command), ['casparcg']);
});

test('sender-only failed stop retains ownership, diagnoses the sender and retries without replacement', async () => {
  const { runtime, state } = launcherFixture(); await runtime.start(); state.failStop = true;
  const closing = runtime.close(); assert.strictEqual(runtime.close(), closing);
  await assert.rejects(closing, /Launcher shutdown failed/);
  assert.deepEqual(runtime.health.snapshot().map(item => [item.name, item.status, item.code]), [['casparcg', 'unhealthy', 'SHUTDOWN_FAILED']]);
  assert.equal(state.spawned.length, 1); assert.equal(runtime.sender.children.size, 1);
  state.failStop = false; await runtime.close(); assert.equal(runtime.sender, null);
  assert.equal(state.kills.length, 2); assert.deepEqual(state.kills[0], state.kills[1]);
});

test('omitted ownership option preserves both services and invalid trusted options fail synchronously', async () => {
  const { runtime, state } = launcherFixture({ manageSpx: undefined });
  await runtime.start(); assert.deepEqual(state.spawned.map(item => item.command), ['spx', 'casparcg']);
  await runtime.close(); assert.equal(state.kills.length, 2);
  for (const value of [null, 0, 1, 'false', {}, []]) assert.throws(() => launcherFixture({ manageSpx: value }), /manageSpx must be a boolean/);
});

async function preparedFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'PiRaiders sender event ')), runtimes = [];
  t.after(async () => { for (const runtime of runtimes) await runtime.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const source = path.join(root, 'source'), cache = path.join(root, 'cache'), component = path.join(root, 'component');
  await fs.mkdir(source); await fs.mkdir(component);
  const executable = path.join(component, 'casparcg.exe'); await fs.writeFile(executable, 'synthetic native boundary');
  async function image(value) { await fs.writeFile(path.join(source, '01.png'), PNG.sync.write({ width: 16, height: 9, data: Buffer.alloc(16 * 9 * 4, value) })); }
  await image(255);
  const profile = { schemaVersion: 1, provider: 'local-manual', eventId: 'ownership-test',
    productionWindow: { start: new Date(Date.now() - 1000).toISOString(), end: new Date(Date.now() + 3600000).toISOString(), prewarmMinutes: 0 },
    spx: { executable: path.join(root, 'unowned-spx-missing.exe'), args: [], cwd: path.join(root, 'unowned-spx-missing-cwd') },
    caspar: { executable, cwd: component, runtimeDir: path.join(root, 'runtime') },
    media: { provider: 'local-lexical-v1', sourceDir: source, cacheDir: cache, startup: { mode: 'source' } },
    rossTalk: { host: '127.0.0.1', port: 7788, allowedSenders: ['127.0.0.1'], commandMap: { 1: 'launch', 8: 'stop' } } };
  const state = { spawned: [], sessions: [], stages: 0 };
  const options = { manageSpx: false, supervisorOptions: { platform: 'linux', maxRestarts: 0 },
    stage: async args => { state.stages++; return stageSnapshot({ ...args, quietMs: 0 }); },
    spawnProcess(command, args, opts, privateInput) { const child = new EventEmitter(); child.pid = 100 + state.spawned.length;
      child.kill = () => { setImmediate(() => child.emit('exit', 0)); }; child.stdin = { end: child.kill };
      state.spawned.push({ command, privateInput }); setImmediate(() => child.emit('spawn')); return child; },
    consoleFactory(child) { const client = new EventEmitter(); client.request = async command => ({ status: command === 'VERSION' ? 201 : 202 }); client.close = () => child.stdin.end(); return client; },
    sessionFactory: async raw => { const entry = { raw, closed: false }; state.sessions.push(entry);
      return { start: async () => {}, close: async () => { entry.closed = true; }, getProgramURL: () => 'http://127.0.0.1/synthetic',
        snapshot: () => ({ presentation: { controller: { deckId: path.basename(raw.presentation.snapshotDir), mode: 'manual', index: null }, renderer: { ready: !entry.closed } } }) }; } };
  return { root, profile, state, image, async create(extra = {}) { const runtime = await createPreparedEventRuntime(profile, { ...options, ...extra }); runtimes.push(runtime); return runtime; } };
}

test('sender-only source preparation and Reload never consult unowned SPX paths; default remains strict', async t => {
  const f = await preparedFixture(t);
  await assert.rejects(f.create({ manageSpx: true }), error => error.code === 'PROFILE_PATHS');
  const originalStat = fs.stat, originalRealpath = fs.realpath; let spxReads = 0;
  const blocked = value => value === f.profile.spx.executable || value === f.profile.spx.cwd;
  fs.stat = async value => { if (blocked(value)) { spxReads++; throw Error('unowned service unavailable'); } return originalStat(value); };
  fs.realpath = async value => { if (blocked(value)) { spxReads++; throw Error('unowned service unavailable'); } return originalRealpath(value); };
  try {
    const runtime = await f.create(); await runtime.start(); await until(() => runtime.snapshot().ready);
    assert.deepEqual(f.state.spawned, [{ command: f.profile.caspar.executable, privateInput: true }]);
    await f.image(127); const next = await f.state.sessions[0].raw.resolvePreparedSnapshot({ signal: new AbortController().signal });
    assert.notEqual(path.basename(next), runtime.snapshot().deckId); assert.equal(f.state.stages, 2); assert.equal(spxReads, 0);
    await runtime.close(); assert.equal(f.state.sessions[0].closed, true);
  } finally { fs.stat = originalStat; fs.realpath = originalRealpath; }
});

test('sender-only cached startup ignores unavailable source but still rejects external cache and missing owned executable', async t => {
  const f = await preparedFixture(t), snapshot = await stageSnapshot({ sourceDir: f.profile.media.sourceDir, cacheDir: f.profile.media.cacheDir, quietMs: 0 });
  await fs.rm(f.profile.media.sourceDir, { recursive: true }); f.profile.media.startup = { mode: 'cached', snapshotDir: snapshot.snapshotDir };
  const original = fs.realpath; let sourceReads = 0;
  fs.realpath = async value => { if (value === f.profile.media.sourceDir) { sourceReads++; throw Error('Drive disconnected'); } return original(value); };
  try { const runtime = await f.create({ stage: () => { throw Error('cached startup must not stage'); } }); await runtime.start(); await until(() => runtime.snapshot().ready); assert.equal(sourceReads, 0); await runtime.close(); }
  finally { fs.realpath = original; }
  f.profile.media.cacheDir = path.join(f.root, 'other-cache'); await fs.mkdir(f.profile.media.cacheDir);
  let loads = 0; await assert.rejects(f.create({ load: async () => { loads++; } }), error => error.code === 'PROFILE_PATHS'); assert.equal(loads, 0);
  f.profile.media.cacheDir = path.join(f.root, 'cache'); f.profile.caspar.executable = path.join(f.root, 'missing-owned.exe');
  await assert.rejects(f.create(), error => error.code === 'PROFILE_PATHS');
  assert.equal(f.state.spawned.length, 1);
});

test('ownership is a trusted boolean option, rejected before any filesystem access and unavailable in profiles', async t => {
  const f = await preparedFixture(t), saved = new Map(); let reads = 0;
  for (const name of ['stat', 'realpath', 'mkdir', 'mkdtemp']) { saved.set(name, fs[name]); fs[name] = async () => { reads++; throw Error('unexpected filesystem access'); }; }
  try { for (const value of [null, 0, 1, 'false', {}, []]) await assert.rejects(f.create({ manageSpx: value }), error => error.code === 'EVENT_OPTIONS_INVALID'); }
  finally { for (const [name, fn] of saved) fs[name] = fn; }
  assert.equal(reads, 0); f.profile.manageSpx = false;
  await assert.rejects(f.create(), error => error.code === 'PROFILE_INVALID'); assert.equal(f.state.stages, 0); assert.equal(f.state.sessions.length, 0); assert.equal(f.state.spawned.length, 0);
});

test('sender-only initial preparation and listener failures leave no child and retain fixed errors', async t => {
  const f = await preparedFixture(t); await fs.writeFile(path.join(f.profile.media.sourceDir, '01.png'), 'corrupt');
  await assert.rejects(f.create(), error => error.code === 'EVENT_PREPARE_FAILED'); assert.equal(f.state.spawned.length, 0); assert.equal(f.state.sessions.length, 0);
  await f.image(255); let closed = 0;
  const runtime = await f.create({ sessionFactory: async () => ({ start: async () => { throw Error('occupied'); }, close: async () => { closed++; } }) });
  await assert.rejects(runtime.start(), error => error.code === 'EVENT_START_FAILED'); assert.equal(closed, 1); assert.equal(f.state.spawned.length, 0);
});
