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
