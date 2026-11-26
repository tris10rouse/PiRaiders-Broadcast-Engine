'use strict';
// 5d-2: the Windows activation proof closes the application at its console,
// once by Ctrl+C and once by closing the console window. The Windows part runs
// only on GitHub; these Linux tests cover the proof's own rules and wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const close = require('../scripts/console-close-proof.cjs');

test('console close proof: each close method has one helper command', () => {
  assert.deepEqual(close.helperArgs('graceful', 42), ['ctrl-c', '42']);
  assert.deepEqual(close.helperArgs('console-close', 42), ['close', '42']);
  assert.throws(() => close.helperArgs('kill', 42), /CLOSE_METHOD_UNKNOWN/);
  assert.throws(() => close.helperArgs('__proto__', 42), /CLOSE_METHOD_UNKNOWN/);
  for (const pid of [0, -1, 1.5, '42', 2 ** 32]) assert.throws(() => close.helperArgs('graceful', pid), /CLOSE_PID_INVALID/);
  assert.deepEqual(close.startArgs('C:\\node\\node.exe', ['C:\\app\\scripts\\piraiders-app.cjs', '--no-browser']), ['start', 'C:\\node\\node.exe', 'C:\\app\\scripts\\piraiders-app.cjs', '--no-browser']);
  assert.throws(() => close.startArgs('node.exe', []), /CONSOLE_START_INVALID/);
  assert.throws(() => close.startArgs('C:\\node\\node.exe', ['a\0b']), /CONSOLE_START_INVALID/);
});

test('console close proof: a helper failure becomes a fixed failure name', async () => {
  const calls = [];
  const run = code => (file, args, options, done) => { calls.push({ file, args, options }); done(code === 0 ? null : Object.assign(Error('exit'), { code })); };
  await close.sendClose('graceful', 7, { helper: 'C:\\h.exe', run: run(0) });
  assert.deepEqual(calls[0].args, ['ctrl-c', '7']);
  assert.equal(calls[0].options.shell, false);
  assert.ok(calls[0].options.timeout > 0);
  for (const [code, name] of [[241, 'CONSOLE_ATTACH_FAILED'], [242, 'CONSOLE_CTRL_C_FAILED'], [243, 'CONSOLE_WINDOW_MISSING'], [244, 'CONSOLE_CLOSE_FAILED'], [1, 'CONSOLE_HELPER_FAILED'], ['ETIMEDOUT', 'CONSOLE_HELPER_FAILED']])
    await assert.rejects(close.sendClose('console-close', 7, { helper: 'C:\\h.exe', run: run(code) }), new RegExp('^Error: ' + name + '$'));
});

test('console close proof: the SPX port counts as free only when nothing holds it', async () => {
  const server = net.createServer(socket => socket.destroy());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await assert.rejects(close.portFree(port), /SPX_PORT_BUSY_AFTER_CLOSE/);
  await new Promise(resolve => server.close(resolve));
  assert.equal(await close.portFree(port), true);
});

test('console close proof: a close is kept only inside the bounds and with nothing left running', () => {
  const record = close.closeRecord({ method: 'console-close', exitCode: 3221225786, signal: null, signalToExitMs: 4200.4, signalToGoneMs: 4300.6 });
  assert.deepEqual({ ...record }, { method: 'console-close', exitCode: 3221225786, signal: null, signalToExitMs: 4200, signalToGoneMs: 4301,
    exitBoundMs: 10000, goneBoundMs: 10000, everyOwnedProcessGone: true, spxPortFree: true });
  assert.ok(Object.isFrozen(record));
  const base = { method: 'graceful', exitCode: 0, signal: null, signalToExitMs: 100, signalToGoneMs: 200 };
  assert.throws(() => close.closeRecord({ ...base, signalToExitMs: close.CLOSE_EXIT_BOUND_MS + 1, signalToGoneMs: close.CLOSE_EXIT_BOUND_MS + 2 }), /CLOSE_EXIT_OVER_BOUND/);
  assert.throws(() => close.closeRecord({ ...base, signalToGoneMs: 100 + close.CLOSE_GONE_BOUND_MS + 1 }), /CLOSE_GONE_OVER_BOUND/);
  assert.throws(() => close.closeRecord({ ...base, signalToGoneMs: 50 }), /CLOSE_TIME_ORDER/);
  assert.throws(() => close.closeRecord({ ...base, exitCode: close.OUTLIVED_EXIT_CODE }), /OWNED_PROCESS_OUTLIVED_APPLICATION/);
  assert.throws(() => close.closeRecord({ ...base, method: 'kill' }), /CLOSE_METHOD_UNKNOWN/);
  assert.throws(() => close.closeRecord({ ...base, signalToExitMs: NaN }), /CLOSE_TIME_INVALID/);
  // The helper's own start failure is not the application's exit.
  assert.throws(() => close.closeRecord({ ...base, exitCode: close.START_FAILED_EXIT_CODE }), /CONSOLE_START_FAILED/);
  // Ended by Windows' default Ctrl+C handling: the application did not close itself.
  assert.throws(() => close.closeRecord({ ...base, exitCode: close.CONTROL_C_EXIT_CODE }), /GRACEFUL_CLOSE_NOT_HANDLED/);
  assert.equal(close.closeRecord({ ...base, method: 'console-close', exitCode: close.CONTROL_C_EXIT_CODE }).exitCode, close.CONTROL_C_EXIT_CODE);
  // A failed rule names itself (not ERR_ASSERTION), so the proof's failure line can carry it.
  try { close.closeRecord({ ...base, signalToExitMs: 20000, signalToGoneMs: 20001 }); assert.fail('expected a throw'); }
  catch (error) { assert.equal(error.code, undefined); assert.equal(error.message, 'CLOSE_EXIT_OVER_BOUND'); }
});

test('console close proof: a failed close keeps its timings for the failure line', () => {
  const proof = fs.readFileSync(path.join(root, 'scripts/smoke-exchange-activation-windows.cjs'), 'utf8');
  assert.match(proof, /phase=tag\+'CLOSE_RECORD';closeAttempts\.push\(attempt\);closes\.push\(consoleClose\.closeRecord\(attempt\)\)/);
  assert.match(proof, /closes,closeAttempts,evidenceViolations/);
});

test('console close proof: the application is the console host\'s one direct Node child', () => {
  const { consoleApplication } = require('../scripts/smoke-full-app-windows.cjs');
  const row = (id, parent, ticks, image) => ({ ProcessId: id, ParentProcessId: parent, CreationUtcTicks: String(ticks), ExecutablePath: image });
  const node = 'C:\\Tools\\node.exe';
  const rows = [row(10, 1, 100, 'C:\\proof\\PiRaiders.ConsoleProof.exe'), row(11, 10, 101, 'C:\\Windows\\System32\\conhost.exe'),
    row(12, 10, 102, node), row(13, 12, 103, 'C:\\Windows\\System32\\conhost.exe'), row(14, 12, 104, node)];
  assert.equal(consoleApplication(rows, 10, node).ProcessId, 12);
  assert.throws(() => consoleApplication(rows.filter(r => r.ProcessId !== 12 && r.ProcessId !== 14 && r.ProcessId !== 13), 10, node), /CONSOLE_APP_PARENT/);
  assert.throws(() => consoleApplication([...rows, row(15, 10, 105, node)], 10, node), /CONSOLE_APP_PARENT/);
});

test('console close proof: the activation job closes once by Ctrl+C and once by the console window', () => {
  const proof = fs.readFileSync(path.join(root, 'scripts/smoke-exchange-activation-windows.cjs'), 'utf8');
  assert.match(proof, /closeApplication\('','graceful'\)/);
  assert.match(proof, /closeApplication\('CACHED_','console-close'\)/);
  // Every start of the application runs in a console of its own (5d-3 adds a third).
  const starts = proof.match(/full\.application\([^)]*\)/g) || [];
  assert.equal(starts.length, 3);
  for (const start of starts) assert.match(start, /consoleHost:consoleClose\.CONSOLE_PROOF/);
  assert.doesNotMatch(proof, /app\.child\.kill\(\)/);
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/full-app-proof.yml'), 'utf8');
  const job = workflow.slice(workflow.indexOf('actual-exchange-activation-private-ndi:'), workflow.indexOf('actual-extracted-full-app-private-ndi:'));
  assert.ok(job.indexOf('node scripts/build-console-proof.cjs') > 0 && job.indexOf('node scripts/build-console-proof.cjs') < job.indexOf('node scripts/smoke-exchange-activation-windows.cjs'));
});

test('console close proof: the helper keeps Ctrl+C reachable and stays out of the bundle', () => {
  const source = fs.readFileSync(path.join(root, 'native/windows/ConsoleProof.cs'), 'utf8');
  // A new process group would start the application with Ctrl+C disabled.
  assert.doesNotMatch(source, /CREATE_NEW_PROCESS_GROUP|0x00000200/i);
  assert.match(source, /CreateNewConsole = 0x00000010/);
  assert.match(source, /SetConsoleCtrlHandler\(IntPtr\.Zero, false\)/);
  const bundle = fs.readFileSync(path.join(root, 'scripts/lib/windows-bundle.cjs'), 'utf8');
  assert.doesNotMatch(bundle, /ConsoleProof/);
});
