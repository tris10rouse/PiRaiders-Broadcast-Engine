'use strict';
// 5d-2: the two ways the operator ends the application at its console window,
// for the Windows exchange activation proof. The application runs in a console
// of its own (native/windows/ConsoleProof.cs `start`), as Launch-PiRaiders.cmd
// does; the proof then presses Ctrl+C in that console (a graceful close) or
// closes the console window (Windows sends CTRL_CLOSE_EVENT, which Node reports
// as SIGHUP, and ends the processes a few seconds later). Either way every owned
// process must be gone and the SPX port free within the proof's close bounds.
// CI evidence on hosted Windows only: no stadium PC or hardware claim.
const net = require('node:net');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { assertPortFree } = require('./piraiders-app.cjs');

const CONSOLE_PROOF = path.resolve(__dirname, '..', 'build', 'windows', 'PiRaiders.ConsoleProof.exe');
// The proof's close bounds, unchanged from before 5d-2: the application exits
// within 10 s of the close, and its owned processes are gone 10 s after that.
const CLOSE_EXIT_BOUND_MS = 10000;
const CLOSE_GONE_BOUND_MS = 10000;
// The console host's own exit code when a process the application started
// still ran 10 s after the application ended (ConsoleProof.cs).
const OUTLIVED_EXIT_CODE = 246;
// The console host could not start or watch the application (ConsoleProof.cs).
const START_FAILED_EXIT_CODE = 245;
// STATUS_CONTROL_C_EXIT: Windows' default Ctrl+C handling ended the process. On
// a console close Windows may end the application this way after it closed what
// it owns; after Ctrl+C it means the application never handled the close.
const CONTROL_C_EXIT_CODE = 0xC000013A;
const CLOSE_METHODS = Object.freeze({ graceful: 'ctrl-c', 'console-close': 'close' });
const HELPER_FAILURES = Object.freeze({ 240: 'CONSOLE_HELPER_USAGE', 241: 'CONSOLE_ATTACH_FAILED', 242: 'CONSOLE_CTRL_C_FAILED', 243: 'CONSOLE_WINDOW_MISSING', 244: 'CONSOLE_CLOSE_FAILED', 245: 'CONSOLE_START_FAILED' });

function helperArgs(method, pid) {
  if (!Object.hasOwn(CLOSE_METHODS, method)) throw Error('CLOSE_METHOD_UNKNOWN');
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > 0xFFFFFFFF) throw Error('CLOSE_PID_INVALID');
  return [CLOSE_METHODS[method], String(pid)];
}
function startArgs(executable, args) {
  if (typeof executable !== 'string' || !path.win32.isAbsolute(executable) || !Array.isArray(args) || [executable, ...args].some(value => typeof value !== 'string' || value.includes('\0'))) throw Error('CONSOLE_START_INVALID');
  return ['start', executable, ...args];
}
// Run the helper once; its own exit code becomes a fixed failure name.
function sendClose(method, pid, { helper = CONSOLE_PROOF, run = execFile } = {}) {
  const args = helperArgs(method, pid);
  return new Promise((resolve, reject) => run(helper, args, { windowsHide: true, shell: false, timeout: 10000, maxBuffer: 1024 }, error => {
    if (!error) return resolve();
    reject(Error(HELPER_FAILURES[error.code] || 'CONSOLE_HELPER_FAILED'));
  }));
}
// Free means nothing answers on loopback and a new listener can take the port.
async function portFree(port, { host = '127.0.0.1' } = {}) {
  try { await assertPortFree(port); } catch { throw Error('SPX_PORT_BUSY_AFTER_CLOSE'); }
  const server = net.createServer();
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }); }
  catch { throw Error('SPX_PORT_BUSY_AFTER_CLOSE'); }
  await new Promise(resolve => server.close(resolve));
  return true;
}
// One close as kept in result.json: times are whole milliseconds from the close.
// `signalToExitMs` ends when the console host exits: the application has ended
// and nothing it started is still running.
// A broken rule throws an Error whose message is its fixed name (no `code`),
// so the proof's failure line reports that name.
function check(condition, name) { if (!condition) throw Error(name); }
function closeRecord({ method, exitCode, signal, signalToExitMs, signalToGoneMs }) {
  check(Object.hasOwn(CLOSE_METHODS, method), 'CLOSE_METHOD_UNKNOWN');
  check(Number.isInteger(exitCode) || exitCode === null, 'CLOSE_EXIT_CODE');
  check(exitCode !== OUTLIVED_EXIT_CODE, 'OWNED_PROCESS_OUTLIVED_APPLICATION');
  check(exitCode !== START_FAILED_EXIT_CODE, 'CONSOLE_START_FAILED');
  check(method !== 'graceful' || exitCode !== CONTROL_C_EXIT_CODE, 'GRACEFUL_CLOSE_NOT_HANDLED');
  check(signal === null || (typeof signal === 'string' && /^SIG[A-Z]{1,10}$/.test(signal)), 'CLOSE_EXIT_SIGNAL');
  for (const value of [signalToExitMs, signalToGoneMs]) check(Number.isFinite(value) && value >= 0, 'CLOSE_TIME_INVALID');
  check(signalToGoneMs >= signalToExitMs, 'CLOSE_TIME_ORDER');
  check(signalToExitMs <= CLOSE_EXIT_BOUND_MS, 'CLOSE_EXIT_OVER_BOUND');
  check(signalToGoneMs - signalToExitMs <= CLOSE_GONE_BOUND_MS, 'CLOSE_GONE_OVER_BOUND');
  return Object.freeze({ method, exitCode, signal, signalToExitMs: Math.round(signalToExitMs), signalToGoneMs: Math.round(signalToGoneMs),
    exitBoundMs: CLOSE_EXIT_BOUND_MS, goneBoundMs: CLOSE_GONE_BOUND_MS, everyOwnedProcessGone: true, spxPortFree: true });
}

// Q-034: the console host did not end within the close bound. What the failure
// line can say, fixed fields only: how long the proof waited, whether the host's
// own exit was seen (its stdio still open), whether the application process and
// the tree it owned at the close still run, and how many browser processes
// started after the snapshot still run (they belong to the host's job, and the
// host waits for its job; ConsoleProof.cs). No ids, paths or names.
const COUNTS = ['tracked', 'surviving', 'gone', 'unknown'];
function counts(value) {
  if (value === null || value === undefined) return null;
  const out = {};
  for (const key of COUNTS) { check(value && Number.isSafeInteger(value[key]) && value[key] >= 0, 'CLOSE_WAIT_INVALID'); out[key] = value[key]; }
  return Object.freeze(out);
}
function closeWaitRecord({ waitedMs, hostExited, appProcess = null, appTree = null, browserLeft = null } = {}) {
  check(Number.isFinite(waitedMs) && waitedMs >= 0, 'CLOSE_WAIT_INVALID');
  check(typeof hostExited === 'boolean', 'CLOSE_WAIT_INVALID');
  const app = counts(appProcess), tree = counts(appTree);
  let left = null;
  if (browserLeft !== null) {
    check(browserLeft && Number.isSafeInteger(browserLeft.running) && browserLeft.running >= 0 && Number.isSafeInteger(browserLeft.unreadable) && browserLeft.unreadable >= 0, 'CLOSE_WAIT_INVALID');
    left = Object.freeze({ running: browserLeft.running, unreadable: browserLeft.unreadable });
  }
  const appState = !app ? 'unknown' : app.surviving > 0 ? 'running' : app.unknown > 0 ? 'unknown' : 'gone';
  return Object.freeze({ step: 'application', waitedMs: Math.round(waitedMs), boundMs: CLOSE_EXIT_BOUND_MS, hostExited,
    // The host outlives the application only while something in its job still runs.
    hostStillWaitsForJobProcesses: appState === 'unknown' || hostExited ? null : appState === 'gone',
    appProcess: appState, appTree: tree, browserLeft: left });
}
module.exports = { CONSOLE_PROOF, OUTLIVED_EXIT_CODE, START_FAILED_EXIT_CODE, CONTROL_C_EXIT_CODE, CLOSE_EXIT_BOUND_MS, CLOSE_GONE_BOUND_MS, CLOSE_METHODS, HELPER_FAILURES, helperArgs, startArgs, sendClose, portFree, closeRecord, closeWaitRecord };
