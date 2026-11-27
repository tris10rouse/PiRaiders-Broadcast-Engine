'use strict';
// 5d-3: the application opens Game Day in the system's default browser. The
// Windows part (a real default browser on hosted Windows) runs only on GitHub;
// these Linux tests cover the opener's failure path and the proof's own rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const app = require('../scripts/piraiders-app.cjs');
const proof = require('../scripts/default-browser-proof.cjs');
const full = require('../scripts/smoke-full-app-windows.cjs');

const URL = 'http://127.0.0.1:5656/game-day';

test('default browser: the opener hands exactly the Game Day URL to the system handler', async () => {
  const calls = [];
  await app.systemBrowser(URL, { run: (file, args, options, done) => { calls.push({ file, args, options }); done(null); } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'rundll32.exe');
  assert.deepEqual(calls[0].args, ['url.dll,FileProtocolHandler', URL]);
  assert.equal(calls[0].options.windowsHide, true);
  assert.ok(calls[0].options.timeout > 0 && calls[0].options.timeout <= 5000);
});

test('default browser: a failed or timed-out opener is BROWSER_OPEN_FAILED, nothing more', async () => {
  for (const error of [Object.assign(Error('C:\\private\\path spawn failed'), { code: 'ENOENT' }), Object.assign(Error('timeout'), { killed: true, signal: 'SIGTERM' }), Object.assign(Error('exit'), { code: 1 })]) {
    await assert.rejects(app.systemBrowser(URL, { run: (file, args, options, done) => done(error) }), err => {
      assert.equal(err.code, 'BROWSER_OPEN_FAILED');
      assert.doesNotMatch(String(err.message), /private/);
      return true;
    });
  }
  // A throwing runner is the same failure, not an exception out of the opener.
  await assert.rejects(app.systemBrowser(URL, { run: () => { throw Error('C:\\private'); } }), { code: 'BROWSER_OPEN_FAILED' });
});

test('default browser: the proof starts the app with or without --no-browser and expects that answer', () => {
  const location = { appRoot: 'C:\\app' };
  assert.deepEqual(full.appEntry(location, 'C:\\m.json'), [path.join('C:\\app', 'scripts', 'piraiders-app.cjs'), 'C:\\m.json', '--no-browser']);
  assert.deepEqual(full.appEntry(location, 'C:\\m.json', { browser: false }), [path.join('C:\\app', 'scripts', 'piraiders-app.cjs'), 'C:\\m.json', '--no-browser']);
  assert.deepEqual(full.appEntry(location, 'C:\\m.json', { browser: true }), [path.join('C:\\app', 'scripts', 'piraiders-app.cjs'), 'C:\\m.json']);
  assert.throws(() => full.appEntry(location, 'C:\\m.json', { browser: 'yes' }), /APP_BROWSER_OPTION/);
  assert.throws(() => full.appEntry({ appRoot: 'C:\\app', extracted: true }, 'C:\\m.json', { browser: true }), /APP_BROWSER_SOURCE_ONLY/);
});

test('default browser: only a process started after the snapshot with the exact URL is the browser', () => {
  const before = proof.processKeys([{ ProcessId: 10, CreationUtcTicks: '100' }, { ProcessId: 11, CreationUtcTicks: '101' }]);
  const rows = [
    { ProcessId: 10, CreationUtcTicks: '100', ExecutablePath: 'C:\\b\\msedge.exe', HasUrl: true }, // older than the start
    { ProcessId: 11, CreationUtcTicks: '999', ExecutablePath: 'C:\\b\\msedge.exe', HasUrl: true }, // pid reused after the snapshot
    { ProcessId: 12, CreationUtcTicks: '200', ExecutablePath: 'C:\\b\\msedge.exe', HasUrl: false },
    { ProcessId: 13, CreationUtcTicks: '201', ExecutablePath: 'C:\\b\\msedge.exe', HasUrl: 'true' }];
  assert.deepEqual(proof.browserRoots(rows, before).map(row => row.ProcessId), [11]);
  assert.deepEqual(proof.browserRoots(rows.slice(2), before), []);
  assert.throws(() => proof.browserRoots('rows', before), /BROWSER_TABLE_INVALID/);
});

test('default browser: the query matches the URL as a whole word and never prints a command line', () => {
  assert.match(proof.BROWSER_QUERY, /\$env:PIRAIDERS_PROOF_BROWSER_URL/);
  assert.match(proof.BROWSER_QUERY, /\[regex\]::Escape/);
  assert.doesNotMatch(proof.BROWSER_QUERY, /Select-Object[^;]*\bCommandLine\b\s*[,;]/);
  assert.doesNotMatch(proof.BROWSER_QUERY, /Name='CommandLine'/);
  // The PowerShell pattern, applied here with the same rules.
  const pattern = new RegExp(proof.urlPattern(URL));
  assert.ok(pattern.test('"C:\\b\\msedge.exe" --single-argument ' + URL));
  assert.ok(pattern.test('"C:\\b\\chrome.exe" -- "' + URL + '"'));
  assert.ok(!pattern.test('"C:\\b\\msedge.exe" --single-argument ' + URL + '/api/state'));
  assert.ok(!pattern.test('"C:\\b\\msedge.exe" ' + URL.replace('5656', '56567')));
  assert.ok(!pattern.test('"C:\\b\\msedge.exe" x' + URL));
  assert.throws(() => proof.urlPattern('http://example.com/game-day'), /BROWSER_URL_INVALID/);
});

test('default browser: the kept record names the browser image only, and needs the app to report it opened', () => {
  const record = proof.browserRecord({ appReportedOpened: true, image: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', roots: 1, tracked: 7, closeMs: 812.4 });
  assert.deepEqual(record, { opener: 'rundll32 url.dll,FileProtocolHandler', appReportedOpened: true, browserImage: 'msedge.exe', urlInCommandLine: true, browserRoots: 1, browserProcessesTracked: 7, closedByProofMs: 812, everyBrowserProcessGone: true });
  assert.throws(() => proof.browserRecord({ appReportedOpened: false, image: 'C:\\b\\msedge.exe', roots: 1, tracked: 1, closeMs: 1 }), /APP_DID_NOT_REPORT_BROWSER_OPENED/);
  assert.throws(() => proof.browserRecord({ appReportedOpened: true, image: 'C:\\b\\msedge.exe', roots: 0, tracked: 0, closeMs: 1 }), /BROWSER_PROCESS_NOT_SEEN/);
  assert.throws(() => proof.browserRecord({ appReportedOpened: true, image: 'C:\\b\\my private name.exe', roots: 1, tracked: 1, closeMs: 1 }), /BROWSER_IMAGE_INVALID/);
});

test('default browser: the activation job runs a third start with the browser and keeps its record', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'smoke-exchange-activation-windows.cjs'), 'utf8');
  assert.match(source, /browser:true/);
  assert.match(source, /defaultBrowser/);
  assert.match(source, /BROWSER_CLOSE/);
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'full-app-proof.yml'), 'utf8');
  assert.match(workflow, /5d-3/);
});

test('default browser: the query text holds no double quote, so Windows quoting leaves it whole', () => {
  assert.equal(proof.BROWSER_QUERY.includes('"'), false);
});

test('default browser: a tree that cannot be read whole still closes its root, and roots need an image and a start time', () => {
  const before = new Set();
  const rows = [
    { ProcessId: process.pid, ParentProcessId: 0, CreationUtcTicks: '1', ExecutablePath: 'C:\\n\\node.exe', HasUrl: false },
    { ProcessId: 20, ParentProcessId: 1, CreationUtcTicks: '300', ExecutablePath: 'C:\\b\\msedge.exe', HasUrl: true },
    { ProcessId: 21, ParentProcessId: 20, CreationUtcTicks: null, ExecutablePath: null, HasUrl: false }, // unreadable child
    { ProcessId: 22, ParentProcessId: 1, CreationUtcTicks: '301', ExecutablePath: null, HasUrl: true },
    { ProcessId: 23, ParentProcessId: 1, CreationUtcTicks: null, ExecutablePath: 'C:\\b\\msedge.exe', HasUrl: true }];
  const roots = proof.browserRoots(rows, before);
  assert.deepEqual(roots.map(row => row.ProcessId), [20]);
  assert.deepEqual(proof.browserTree(rows, roots, before).map(row => row.ProcessId), [20]);
  // The job hands the found roots to its cleanup before anything else can fail.
  const source = fs.readFileSync(path.join(root, 'scripts', 'smoke-exchange-activation-windows.cjs'), 'utf8');
  assert.ok(source.indexOf('browserTree=roots;') > 0 && source.indexOf('browserTree=roots;') < source.indexOf("'BROWSER_IMAGES_DIFFER'"));
});

// Q-034: PR #145's e6ac176 (job 140725654245) failed with phase BROWSER_CLOSE and
// OWNED_PROCESS_CLOSE_TIMEOUT. That code comes only from the console host's 10 s
// close wait (settledChild), which closeApplication('BROWSER_') also named
// BROWSER_CLOSE (tag + 'CLOSE'): the failure line could not say which close it was.
test('default browser: no phase of an application close has the name of another phase (Q-034)', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'smoke-exchange-activation-windows.cjs'), 'utf8');
  const literals = new Set([...source.matchAll(/phase='([A-Z_]+)'/g)].map(m => m[1]));
  const tags = [...source.matchAll(/closeApplication\('([A-Z_]*)'/g)].map(m => m[1]);
  const suffixes = [...source.matchAll(/phase=tag\+'([A-Z_]+)'/g)].map(m => m[1]);
  assert.ok(literals.has('BROWSER_CLOSE') && tags.length === 3 && suffixes.includes('CLOSE'));
  const made = tags.flatMap(tag => suffixes.map(suffix => tag + suffix));
  for (const name of made) assert.equal(literals.has(name), false, name);
  assert.equal(new Set(made).size, made.length);
});

test('default browser: a browser close over its bound says how many processes stayed and how long it waited (Q-034)', async () => {
  const row = (id, ticks) => ({ ProcessId: id, ParentProcessId: 1, CreationUtcTicks: String(ticks), ExecutablePath: 'C:\\b\\msedge.exe' });
  const tree = [row(20, 300), row(21, 301), row(22, 302)];
  const killed = [];
  const table = () => [row(20, 300), { ...row(21, 301), CreationUtcTicks: null }];
  const started = Date.now();
  await assert.rejects(proof.closeBrowser(tree, { until: full.until, kill: pid => killed.push(pid), table, boundMs: 300 }), error => {
    assert.equal(error.message, 'BROWSER_SURVIVED_CLOSE');
    const wait = error.closeWait;
    assert.equal(wait.step, 'browser');
    assert.equal(wait.boundMs, 300);
    assert.ok(Number.isInteger(wait.waitedMs) && wait.waitedMs >= 300 && wait.waitedMs <= Date.now() - started + 1);
    assert.deepEqual({ tracked: wait.tree.tracked, surviving: wait.tree.surviving, gone: wait.tree.gone, unknown: wait.tree.unknown }, { tracked: 3, surviving: 1, gone: 1, unknown: 1 });
    assert.doesNotMatch(JSON.stringify(wait), /msedge|C:\\\\|\b20\b|\b21\b/);
    return true;
  });
  assert.deepEqual(killed, [20, 21, 22]);
  // A table that cannot be read fails at once with its own code, and still answers the time waited.
  let reads = 0;
  await assert.rejects(proof.closeBrowser(tree, { until: full.until, kill: () => {}, table: () => { reads++; throw Error('PROCESS_IDENTITY_UNVERIFIED'); }, boundMs: 5000 }), error => {
    assert.equal(error.message, 'PROCESS_IDENTITY_UNVERIFIED');
    assert.equal(error.closeWait.tree, null);
    assert.ok(Number.isInteger(error.closeWait.waitedMs) && error.closeWait.waitedMs < 5000);
    return true;
  });
  assert.equal(reads, 1);
});

test('default browser: processes of the browser image started after the snapshot are counted, nothing more (Q-034)', () => {
  const before = proof.processKeys([{ ProcessId: 10, CreationUtcTicks: '100' }]);
  const rows = [
    { ProcessId: 10, CreationUtcTicks: '100', ExecutablePath: 'C:\\b\\msedge.exe' }, // before the start
    { ProcessId: 11, CreationUtcTicks: '200', ExecutablePath: 'C:\\B\\MSEDGE.EXE' },
    { ProcessId: 12, CreationUtcTicks: '201', ExecutablePath: 'C:\\b\\msedge.exe' },
    { ProcessId: 13, CreationUtcTicks: '202', ExecutablePath: 'C:\\b\\other.exe' },
    { ProcessId: 14, CreationUtcTicks: null, ExecutablePath: 'C:\\b\\msedge.exe' }];
  assert.deepEqual(proof.browserLeftovers(rows, 'C:\\b\\msedge.exe', before), { running: 2, unreadable: 1 });
  assert.throws(() => proof.browserLeftovers('rows', 'C:\\b\\msedge.exe', before), /BROWSER_TABLE_INVALID/);
  assert.throws(() => proof.browserLeftovers(rows, '', before), /BROWSER_TABLE_INVALID/);
});

test('default browser: an application close over its bound prints what still runs, fixed fields only (Q-034)', () => {
  const close = require('../scripts/console-close-proof.cjs');
  const tree = { tracked: 4, surviving: 0, reused: 0, gone: 4, unknown: 0, reasons: [] };
  const record = close.closeWaitRecord({ waitedMs: 10012.6, hostExited: false, appProcess: { tracked: 1, surviving: 0, reused: 0, gone: 1, unknown: 0, reasons: [] }, appTree: tree, browserLeft: { running: 3, unreadable: 0 } });
  assert.deepEqual(record, { step: 'application', waitedMs: 10013, boundMs: 10000, hostExited: false, hostStillWaitsForJobProcesses: true,
    appProcess: 'gone', appTree: { tracked: 4, surviving: 0, gone: 4, unknown: 0 }, browserLeft: { running: 3, unreadable: 0 } });
  assert.equal(close.closeWaitRecord({ waitedMs: 1, hostExited: true, appProcess: { tracked: 1, surviving: 1, gone: 0, unknown: 0 }, appTree: null, browserLeft: null }).appProcess, 'running');
  const unread = close.closeWaitRecord({ waitedMs: 1, hostExited: false, appProcess: null, appTree: null, browserLeft: null });
  assert.equal(unread.appProcess, 'unknown');
  assert.equal(unread.hostStillWaitsForJobProcesses, null);
  assert.throws(() => close.closeWaitRecord({ waitedMs: -1, hostExited: false }), /CLOSE_WAIT_INVALID/);
  assert.throws(() => close.closeWaitRecord({ waitedMs: 1, hostExited: 'no' }), /CLOSE_WAIT_INVALID/);
  assert.throws(() => close.closeWaitRecord({ waitedMs: 1, hostExited: false, browserLeft: { running: 'C:\\x' } }), /CLOSE_WAIT_INVALID/);
  // The activation proof puts it on its failure line, and its cleanup line names each part's fixed code.
  const source = fs.readFileSync(path.join(root, 'scripts', 'smoke-exchange-activation-windows.cjs'), 'utf8');
  assert.match(source, /closeWait:error&&error\.closeWait\|\|null/);
  assert.match(source, /consoleClose\.closeWaitRecord\(/);
  assert.match(source, /exchange-activation-proof-cleanup-failed',parts:cleanup,codes:/);
});
