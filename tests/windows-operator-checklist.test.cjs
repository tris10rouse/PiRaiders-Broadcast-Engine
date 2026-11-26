'use strict';
// 5f-2: the Windows ZIP carries OPERATOR-CHECKLIST.md at its root. Every code
// the checklist names is one the setup, diagnose or launch command can print;
// every code those commands print on a refusal has a first thing to do in it;
// every Game Day page control it names exists on the page. Linux checks only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const bundle = require('../scripts/lib/windows-bundle.cjs');

const repo = path.resolve(__dirname, '..');
const SOURCE = 'packaging/windows/OPERATOR-CHECKLIST.md';
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const literals = (relative, pattern = /'([A-Z][A-Z0-9_]{3,})'/g) => new Set([...read(relative).matchAll(pattern)].map(m => m[1]));
const union = (...sets) => new Set(sets.flatMap(set => [...set]));

// What each command prints: the command file, the library it answers from and
// the store codes the setup step forwards as they are.
const SETUP_FILES = ['scripts/piraiders-setup.cjs', 'scripts/lib/exchange-setup.cjs'];
const DIAGNOSE_FILES = ['scripts/piraiders-diagnose.cjs', 'scripts/lib/game-day-diagnose.cjs'];
const LAUNCH_FILES = ['scripts/piraiders-app.cjs'];
const FORWARDED_FILES = ['scripts/lib/game-day-catalog.cjs', 'scripts/lib/exchange-journal.cjs',
  'scripts/lib/exchange-approval-store.cjs', 'scripts/lib/exchange-source-service.cjs'];
// The launcher's codes that reach its console (main's catch, a fault or a
// failed close). The others in that file are mapped to APP_STARTUP_TIMEOUT
// before they are printed, or are never printed (SPX_PROCESS_FAULT,
// BROWSER_OPEN_FAILED: browserOpened false instead).
const LAUNCH_PRINTED = ['APP_OPTIONS_INVALID', 'APP_CONFIG_INVALID', 'APP_HOST_MISSING', 'WINDOWS_REQUIRED', 'APP_PORT_BUSY',
  'APP_PORT_UNAVAILABLE', 'APP_PROCESS_FAILED', 'APP_IDENTITY_STALE', 'APP_STARTUP_TIMEOUT', 'APP_CLOSED', 'APP_START_FAILED', 'APP_CLOSE_FAILED'];
// Store codes setup forwards that an operator can meet (EXCHANGE_SETUP.md).
const SETUP_FORWARDED = ['MACHINE_CONFIG_INVALID', 'JOURNAL_INVALID', 'APPROVAL_INVALID', 'APPROVAL_CONFLICT', 'OFFLINE_PIN_CACHE_TOO_LARGE'];

function checklist() { return read(SOURCE); }
function named(text) { return new Set([...text.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map(m => m[1])); }

test('the bundle packages the operator checklist at the ZIP root from a tracked file', () => {
  const map = new Map(bundle.TEMPLATES);
  assert.equal(map.get(SOURCE), 'OPERATOR-CHECKLIST.md');
  const tracked = execFileSync('git', ['ls-files', '--', SOURCE], { cwd: repo, encoding: 'utf8' }).trim();
  assert.equal(tracked, SOURCE, 'the checklist is tracked (the build refuses untracked templates)');
});

test('every code the checklist names is one the commands can print', () => {
  const printable = union(...[...SETUP_FILES, ...DIAGNOSE_FILES, ...LAUNCH_FILES, ...FORWARDED_FILES].map(file => literals(file)));
  const codes = named(checklist());
  assert.ok(codes.size >= 20, 'the checklist names the commands\' codes');
  for (const code of codes) assert.ok(printable.has(code), code + ' is not printed by any command');
});

test('every refusal code of setup, diagnose and launch has its own line in the checklist', () => {
  const codes = named(checklist());
  const setup = union(...SETUP_FILES.map(file => literals(file, /'(SETUP_[A-Z0-9_]+)'/g)));
  const diagnose = union(...DIAGNOSE_FILES.map(file => literals(file, /'((?:APP|DIAGNOSE|SOURCE|APPROVAL|CATALOG|STATE)_[A-Z0-9_]+)'/g)));
  const launch = literals(LAUNCH_FILES[0]);
  assert.ok(setup.size >= 10 && diagnose.size >= 10, 'codes found in the command sources');
  // 'SETUP_FEED_' is the prefix of SETUP_FEED_<reader code>, named as such.
  assert.ok(setup.delete('SETUP_FEED_'), 'the feed prefix is in the setup step');
  assert.match(checklist(), /`SETUP_FEED_…`/);
  for (const code of [...setup, ...diagnose, ...SETUP_FORWARDED]) assert.ok(codes.has(code), code + ' missing from the checklist');
  for (const code of LAUNCH_PRINTED) {
    assert.ok(launch.has(code), code + ' is printed by the launcher');
    assert.ok(codes.has(code), code + ' missing from the checklist');
  }
  // A code's line says what to do: every table row with a code has a non-empty action.
  for (const line of checklist().split(/\r?\n/).filter(l => /^\|\s*`[A-Z]/.test(l))) {
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    assert.ok(cells.length >= 2 && cells[cells.length - 1].length > 10, 'no action on: ' + line);
  }
});

test('the success words it names are the ones the commands print', () => {
  const text = checklist();
  assert.match(read('scripts/piraiders-app.cjs'), /event:'controller-available'/);
  assert.match(text, /`controller-available`/);
  assert.match(read('scripts/lib/exchange-setup.cjs'), /\{ok:true,step:'done',code:null,done\}/);
  assert.match(text, /`\{"ok":true,"step":"done"`/);
  for (const word of ['initialized', 'present', 'bound']) assert.match(text, new RegExp('`' + word + '`'));
  for (const word of ['pinned', 'unchanged', 'notPrepared', 'ineligible']) {
    assert.match(read('scripts/lib/exchange-setup.cjs') + read('docs/design/EXCHANGE_SETUP.md'), new RegExp(word));
    assert.match(text, new RegExp('`' + word + '`'));
  }
  const diagnose = read('scripts/lib/game-day-diagnose.cjs');
  for (const word of ['reachable', 'readable', 'not-running', 'not-used']) {
    assert.ok(diagnose.includes("'" + word + "'"), word);
    assert.match(text, new RegExp('`' + word + '`'));
  }
});

test('the steps come in the evaluation order', () => {
  const headings = checklist().split(/\r?\n/).filter(line => /^## \d+\. /.test(line));
  const order = ['Check the download', 'Choose local or source mode', 'Write the machine file', 'Run Setup', 'Run Diagnose',
    'Launch', 'Approve, prepare and activate', 'Stop', 'Close', 'Pin offline', 'Cached start'];
  assert.equal(headings.length, order.length, headings.join('\n'));
  headings.forEach((heading, index) => assert.ok(heading.startsWith('## ' + (index + 1) + '. ' + order[index]), heading));
});

test('every Game Day control it names is on the page', () => {
  const page = read('views/view-game-day.handlebars');
  const controls = [...checklist().matchAll(/\[([^\]\n]+)\](?!\()/g)].map(m => m[1]);
  assert.ok(controls.length >= 8, 'names the page controls');
  for (const control of controls) {
    const label = control.replace(/&/g, '&amp;');
    // A label is a button's whole text, or one branch of a mode switch in it.
    assert.ok(page.includes('>' + label + '<') || page.includes('}}' + label + '{{'), control + ' is not on the page');
  }
});

test('it says plainly what is not shown, and holds no private data', () => {
  const text = checklist();
  for (const gap of [/stadium PC/, /Windows 10/, /board/, /NDI over a network/, /Drive/, /on air/i]) assert.match(text, gap);
  assert.doesNotMatch(text, /\b(?:\d{1,3}\.){3}\d{1,3}\b(?<!127\.0\.0\.1)/);
  assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  assert.doesNotMatch(text, /(drive|docs|sheets)\.google\.com|https?:\/\//i);
  assert.doesNotMatch(text, /[A-Za-z]:\\Users\\|\\\\[A-Za-z0-9]/);
});

test('README-WINDOWS.md points to the checklist and no longer calls setup, diagnostics or the checklist missing', () => {
  const readme = read('packaging/windows/README-WINDOWS.md');
  assert.match(readme, /OPERATOR-CHECKLIST\.md/);
  assert.doesNotMatch(readme, /operator checklist remain/i);
  assert.doesNotMatch(readme, /diagnostics\/preflight\/soak/i);
  assert.doesNotMatch(readme, /exchange importer, diagnostics/i);
});
