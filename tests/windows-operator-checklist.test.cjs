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
const VERIFY_FILES = ['scripts/piraiders-verify-bundle.cjs'];
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
  const printable = union(...[...SETUP_FILES, ...DIAGNOSE_FILES, ...LAUNCH_FILES, ...VERIFY_FILES, ...FORWARDED_FILES].map(file => literals(file)));
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
  // Q-013: every code the verify command prints, success included.
  const verify = union(...VERIFY_FILES.map(file => literals(file, /'((?:BUNDLE|MANIFEST|VERIFY)_[A-Z0-9_]+)'/g)));
  assert.deepEqual([...verify].sort(), ['BUNDLE_DIFFERS', 'BUNDLE_VERIFIED', 'MANIFEST_INVALID', 'VERIFY_FAILED', 'VERIFY_USAGE']);
  for (const code of [...setup, ...diagnose, ...verify, ...SETUP_FORWARDED]) assert.ok(codes.has(code), code + ' missing from the checklist');
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

// Review round (5f-2): what the entries and Diagnose really print.
test('the entries\' own refusals are their sentences, not codes, and Diagnose states are not refusals', () => {
  const text = checklist();
  for (const name of ['Setup-PiRaiders.cmd', 'Diagnose-PiRaiders.cmd', 'Launch-PiRaiders.cmd']) {
    const entry = read('packaging/windows/' + name);
    // Each of an entry's refusals before Node runs prints a sentence and exits 2.
    assert.match(entry, /echo Application configuration is missing\. Read README-WINDOWS\.md before starting\./);
    assert.match(entry, /echo Bundled Node runtime is missing\./);
    assert.match(entry, /exit \/b 2/);
  }
  assert.match(text, /Application configuration is missing/);
  assert.match(text, /Bundled Node runtime is missing/);
  // SETUP_USAGE and DIAGNOSE_USAGE come only from the scripts run directly.
  for (const usage of ['SETUP_USAGE', 'DIAGNOSE_USAGE']) {
    const line = text.split(/\r?\n/).find(l => l.startsWith('| `' + usage + '`'));
    assert.ok(line && /directly/.test(line), usage + ' row says it comes only from the script run directly');
  }
  // Diagnose answers ok:true, exit 0, with a state's code; only these two refuse.
  const diagnose = read('scripts/piraiders-diagnose.cjs');
  assert.match(diagnose, /exitCode:answer\.ok\?0:1/);
  assert.match(read('scripts/lib/game-day-diagnose.cjs'), /return Object\.freeze\(\{ok:true,scope:'game-day-diagnostics-command'/);
  assert.match(text, /state codes inside an exit-0 line/);
  // Diagnose sends no credential, so a browser sign-in cannot clear APP_AUTH_REQUIRED.
  assert.doesNotMatch(read('scripts/lib/game-day-diagnose.cjs'), /[Cc]ookie|[Aa]uthorization/);
  const auth = text.split(/\r?\n/).find(l => l.startsWith('| `APP_AUTH_REQUIRED`'));
  assert.ok(auth && /cannot sign in/.test(auth) && /Diagnostics/.test(auth), auth);
});

// 5f-4: the ZIP's own documents say what the evaluation build is and is not,
// and the Windows job prints the ZIP's SHA-256 so the record can quote it.
function section(text, heading) {
  const start = text.search(new RegExp('^#+ ' + heading + '\\s*$', 'm'));
  assert.ok(start >= 0, 'missing section: ' + heading);
  const rest = text.slice(start).split(/\r?\n/);
  const end = rest.findIndex((line, i) => i > 0 && /^#+ /.test(line));
  return rest.slice(0, end < 0 ? undefined : end).join('\n');
}

test('README-WINDOWS.md and the checklist say what the evaluation build is and is not', () => {
  for (const relative of ['packaging/windows/README-WINDOWS.md', SOURCE]) {
    const part = section(read(relative), 'Evaluation build');
    // What it is: one master commit, every check green, recorded outside the ZIP.
    assert.match(part, /master commit/, relative);
    assert.match(part, /every check/, relative);
    assert.match(part, /docs\/agent\/CLAUDE_HANDOFF\.md/, relative);
    assert.match(part, /SHA-256/, relative);
    // What it is not.
    for (const not of [/not signed/, /not a release/, /not deployed/, /stadium PC/, /board/, /on air/])
      assert.match(part, not, relative + ' ' + not);
    assert.doesNotMatch(part, /https?:\/\/|\b[0-9a-f]{40}\b/, relative);
  }
});

test('README-WINDOWS.md no longer calls the extracted ZIP\'s setup and diagnose run a later part', () => {
  const readme = read('packaging/windows/README-WINDOWS.md');
  assert.doesNotMatch(readme, /until then they are tested on Linux only/);
  assert.doesNotMatch(readme, /setup and diagnostics run from the extracted ZIP on Windows \(part 5f-3\)/);
});

test('the Windows job prints the ZIP\'s SHA-256 sidecar after the ZIP is built and before it is uploaded', () => {
  const ci = read('.github/workflows/ci.yml');
  const build = ci.indexOf('run: npm run package:windows');
  const print = ci.search(/run: Get-Content -LiteralPath build\/windows\/PiRaiders-Development-win-x64\.zip\.sha256/);
  const upload = ci.indexOf('name: piraiders-windows-development');
  assert.ok(build > 0 && print > build && upload > print, JSON.stringify({ build, print, upload }));
  const step = ci.slice(ci.lastIndexOf('- name:', print), print);
  assert.match(step, /if: runner\.os == 'Windows'/);
});

// Q-015: the opening paragraph, the "Extract and configure" lead and the
// evidence paragraph agree with the "Evaluation build" section.
test('README-WINDOWS.md opening, extract lead and evidence paragraph match the evaluation build', () => {
  const readme = read('packaging/windows/README-WINDOWS.md');
  const opening = readme.split(/\r?\n\r?\n/)[1];
  const extract = section(readme, 'Extract and configure a disposable workstation').split(/\r?\n\r?\n/)[1];
  const evidence = section(readme, 'Compatibility and automated evidence');
  for (const [name, part] of [['opening', opening], ['extract', extract]]) {
    assert.match(part, /evaluation build/i, name);
    assert.match(part, /disposable,? nonproduction Windows x64 PC/, name);
  }
  // Opening: what it is not, and the stadium warning until the owner's off-air test.
  for (const not of [/not signed/, /not a release/, /not deployed/, /CasparCG, Mesa and NDI binaries are not included/,
    /Do not install on stadium equipment/, /owner approves an off-air test/])
    assert.match(opening, not, 'opening ' + not);
  // Extracted-app output is CI evidence from the named hosted-Windows check.
  for (const part of [opening, evidence]) assert.match(part, /actual-extracted-full-app-private-ndi/);
  assert.match(evidence, /hosted Windows/);
  // The old wording is gone everywhere.
  for (const old of [/not the first user-testable release/, /output from this extracted artifact .* remain unverified/,
    /No manual testing is requested from the project owner until/, /extracted full application, reproducible legal/, /does not yet configure CI.s explicit software-Mesa/,
    /Do not describe this ZIP as a user-testable build/, /Actual output from the extracted application still requires/])
    assert.doesNotMatch(readme, old, String(old));
});
