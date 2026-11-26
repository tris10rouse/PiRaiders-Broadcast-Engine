'use strict';
// 5f-1: the Windows ZIP carries the setup and diagnose commands, a source-mode
// machine example and fixed root entries for both. Linux checks only; the
// Windows run of the entries is 5f-3.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const bundle = require('../scripts/lib/windows-bundle.cjs');
const { loadGameDayMachineConfig } = require('../scripts/lib/game-day-catalog.cjs');

const repo = path.resolve(__dirname, '..');
const EXAMPLE = 'packaging/windows/piraiders-app.source.example.json';
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');

test('the bundle selects the setup and diagnose commands and requires them', () => {
  const tracked = ['server.js', 'scripts/piraiders-app.cjs', 'scripts/piraiders-setup.cjs', 'scripts/piraiders-diagnose.cjs',
    'scripts/smoke-exchange-activation-windows.cjs', 'scripts/exchange-activation-fixture.cjs'];
  assert.deepEqual(bundle.selectSourceFiles(repo, tracked),
    ['scripts/piraiders-app.cjs', 'scripts/piraiders-diagnose.cjs', 'scripts/piraiders-setup.cjs', 'server.js']);
  for (const required of ['scripts/piraiders-setup.cjs', 'scripts/piraiders-diagnose.cjs']) {
    assert.ok(bundle.REQUIRED_RUNTIME_SOURCES.includes(required), required);
  }
});

test('the bundle packages the source example and both root entries from tracked templates', () => {
  const map = new Map(bundle.TEMPLATES);
  assert.equal(map.get(EXAMPLE), 'app/config/piraiders-app.source.example.json');
  assert.equal(map.get('packaging/windows/Setup-PiRaiders.cmd'), 'Setup-PiRaiders.cmd');
  assert.equal(map.get('packaging/windows/Diagnose-PiRaiders.cmd'), 'Diagnose-PiRaiders.cmd');
  for (const [source] of bundle.TEMPLATES) assert.ok(fs.statSync(path.join(repo, source)).isFile(), source);
});

function entry(name) {
  const text = read('packaging/windows/' + name);
  assert.match(text, /\r?\n/);
  // Only the bundled Node runs, on the fixed machine file.
  const runs = text.split(/\r?\n/).filter(line => /node\.exe"\s/.test(line) && !/^\s*if /i.test(line));
  assert.equal(runs.length, 1, name + ' runs one command');
  assert.ok(runs[0].startsWith('"%PIRAIDERS_BUNDLE_ROOT%runtime\\node.exe" "%PIRAIDERS_BUNDLE_ROOT%app\\scripts\\'), name);
  assert.ok(runs[0].includes('--machine "%PIRAIDERS_BUNDLE_ROOT%app\\config\\piraiders-app.json"'), name);
  assert.doesNotMatch(text, /%\*|%[3-9]|\bnode\.exe"\s.*%~?2/);
  return { text, run: runs[0] };
}
test('Setup-PiRaiders.cmd runs the setup command with only an optional --pin-offline', () => {
  const { text, run } = entry('Setup-PiRaiders.cmd');
  assert.ok(run.includes('app\\scripts\\piraiders-setup.cjs"'));
  assert.ok(run.trimEnd().endsWith('%PIRAIDERS_SETUP_PIN%'));
  assert.match(text, /if "%~1"=="--pin-offline" set "PIRAIDERS_SETUP_PIN=--pin-offline"/);
  assert.match(text, /if not "%~1"=="" if not "%~1"=="--pin-offline" \(/);
  assert.match(text, /if not "%~2"=="" \(/);
});
test('Diagnose-PiRaiders.cmd runs the diagnose command and takes no arguments', () => {
  const { text, run } = entry('Diagnose-PiRaiders.cmd');
  assert.ok(run.includes('app\\scripts\\piraiders-diagnose.cjs"'));
  assert.ok(run.trimEnd().endsWith('piraiders-app.json"'));
  assert.match(text, /if not "%~1"=="" \(/);
});

// Windows absolute paths in the example are not absolute on Linux: map them to
// a temporary folder there so the loader judges the same field set.
function filled(raw, dir) {
  const value = JSON.parse(JSON.stringify(raw));
  const local = p => process.platform === 'win32' ? p : path.join(dir, p.replace(/^[A-Za-z]:\//, '').replace(/[^A-Za-z0-9/-]/g, '_'));
  value.caspar.executable = local(value.caspar.executable); value.caspar.cwd = local(value.caspar.cwd);
  const exchange = path.join(dir, 'exchange'); fs.mkdirSync(exchange, { recursive: true });
  return { value, replace: {
    mediaRoot: v => { v.mediaRoot = exchange; },
    runtimeDirectory: v => { v.output.runtimeDirectory = path.join(dir, 'ndi'); },
    journalStoreId: v => { v.source.journalStoreId = crypto.randomUUID(); },
    approvalStoreId: v => { v.source.approvalStoreId = crypto.randomUUID(); },
    expectedCanonicalRoot: v => { v.source.expectedCanonicalRoot = exchange; },
    feedId: v => { v.source.binding.feedId = crypto.randomUUID(); },
    epoch: v => { v.source.binding.epoch = 1; }
  } };
}
test('the source example is refused as shipped, accepted once every placeholder is replaced, and refused with any one left', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piraiders-source-example-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const raw = JSON.parse(read(EXAMPLE));
  const placeholders = JSON.stringify(raw).match(/<REPLACE:[^>]*>/g) || [];
  const { value, replace } = filled(raw, dir);
  assert.equal(placeholders.length, Object.keys(replace).length, 'one placeholder per field to replace');
  const options = { appRoot: path.join(dir, 'app'), nodeExecutable: process.execPath };
  fs.mkdirSync(options.appRoot);
  const load = async candidate => {
    const file = path.join(dir, crypto.randomUUID() + '.json'); fs.writeFileSync(file, JSON.stringify(candidate));
    return loadGameDayMachineConfig(file, options);
  };
  await assert.rejects(load(value), { code: 'MACHINE_CONFIG_INVALID' });
  const complete = JSON.parse(JSON.stringify(value)); for (const set of Object.values(replace)) set(complete);
  assert.doesNotMatch(JSON.stringify(complete), /REPLACE/);
  const machine = await load(complete);
  assert.equal(machine.source.providerId, raw.source.providerId);
  assert.equal(machine.output.type, 'ndi');
  for (const left of Object.keys(replace)) {
    const partial = JSON.parse(JSON.stringify(value));
    for (const [name, set] of Object.entries(replace)) if (name !== left) set(partial);
    await assert.rejects(load(partial), { code: 'MACHINE_CONFIG_INVALID' }, left + ' left as a placeholder');
  }
});
