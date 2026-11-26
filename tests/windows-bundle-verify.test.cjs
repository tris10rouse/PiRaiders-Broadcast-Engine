'use strict';
// Q-013: the extracted ZIP carries Verify-PiRaiders.cmd, which checks every
// extracted file against BUILD-MANIFEST.json and prints fixed codes only.
// Linux checks on a built inventory; the Windows run of the entry is in the
// entries proof (scripts/bundle-entries-proof.cjs, Foundation checks).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bundle = require('../scripts/lib/windows-bundle.cjs');

const repo = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(repo, relative), 'utf8');
const COMMAND = 'scripts/piraiders-verify-bundle.cjs';
const METADATA = { commitSHA: 'a'.repeat(40), spxVersion: '1.3.0', node: { version: 'v22.0.0', platform: 'win32', arch: 'x64' } };

// A bundle-shaped folder under a path with spaces, Unicode and `!`, with its manifest.
function built(t) {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'PiRaiders verify 鷹 ! ')));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'PiRaiders-Development');
  const files = { 'Launch-PiRaiders.cmd': '@echo off\n', 'README-WINDOWS.md': '# readme\n', 'app/server.js': 'console.log(1)\n',
    'app/config/piraiders-app.example.json': '{}\n', 'app/node_modules/pkg/index.js': 'module.exports=1\n', 'runtime/node.exe': 'MZ' };
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
  }
  fs.writeFileSync(path.join(root, 'BUILD-MANIFEST.json'), JSON.stringify(bundle.createManifest(root, METADATA), null, 2) + '\n');
  return { parent, root, count: Object.keys(files).length };
}
function verify(root, argv = []) {
  const { main } = require('../' + COMMAND);
  const result = main(argv, { root });
  // One JSON line, as printed.
  const line = JSON.stringify(result.answer);
  assert.ok(!line.includes('\n'));
  return { ...result, line };
}
function noPaths(line, parent) {
  for (const word of [parent, 'PiRaiders-Development', 'app/', 'server.js', 'node.exe', 'README', '鷹', 'operator']) {
    assert.ok(!line.includes(word), 'the answer must not name ' + word + ': ' + line);
  }
}

test('a fresh inventory is verified, with the file count only', t => {
  const { parent, root, count } = built(t);
  const r = verify(root);
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.answer, { ok: true, code: 'BUNDLE_VERIFIED', files: count });
  noPaths(r.line, parent);
});

test('a changed file is refused as changed', t => {
  const { parent, root } = built(t);
  fs.writeFileSync(path.join(root, 'app', 'server.js'), 'console.log(2)\n'); // same size, other bytes
  const r = verify(root);
  assert.equal(r.exitCode, 1);
  assert.deepEqual(r.answer, { ok: false, code: 'BUNDLE_DIFFERS', differences: ['changed'], counts: { missing: 0, changed: 1, extra: 0 } });
  noPaths(r.line, parent);
});

test('a missing file is refused as missing, also when its whole folder is gone', t => {
  const { parent, root } = built(t);
  fs.rmSync(path.join(root, 'README-WINDOWS.md'));
  fs.rmSync(path.join(root, 'app', 'node_modules'), { recursive: true });
  const r = verify(root);
  assert.equal(r.exitCode, 1);
  assert.deepEqual(r.answer, { ok: false, code: 'BUNDLE_DIFFERS', differences: ['missing'], counts: { missing: 2, changed: 0, extra: 0 } });
  noPaths(r.line, parent);
});

test('an extra file is refused as extra: an operator file written before the check', t => {
  const { parent, root } = built(t);
  fs.writeFileSync(path.join(root, 'app', 'config', 'piraiders-app.json'), '{"operator":true}\n');
  const r = verify(root);
  assert.equal(r.exitCode, 1);
  assert.deepEqual(r.answer, { ok: false, code: 'BUNDLE_DIFFERS', differences: ['extra'], counts: { missing: 0, changed: 0, extra: 1 } });
  noPaths(r.line, parent);
});

test('all three kinds at once are each counted, in a fixed order', t => {
  const { root } = built(t);
  fs.writeFileSync(path.join(root, 'runtime', 'node.exe'), 'MZ-longer');
  fs.rmSync(path.join(root, 'Launch-PiRaiders.cmd'));
  fs.mkdirSync(path.join(root, 'app', 'LOG')); fs.writeFileSync(path.join(root, 'app', 'LOG', 'a.log'), 'x');
  const r = verify(root);
  assert.deepEqual(r.answer, { ok: false, code: 'BUNDLE_DIFFERS', differences: ['missing', 'changed', 'extra'], counts: { missing: 1, changed: 1, extra: 1 } });
});

test('a listed file replaced by a folder or a symbolic link is changed, and the link is never followed', t => {
  const { parent, root } = built(t);
  const target = path.join(parent, 'outside.js'); fs.writeFileSync(target, 'console.log(1)\n'); // same bytes as listed
  fs.rmSync(path.join(root, 'app', 'server.js')); fs.symlinkSync(target, path.join(root, 'app', 'server.js'));
  fs.rmSync(path.join(root, 'README-WINDOWS.md')); fs.mkdirSync(path.join(root, 'README-WINDOWS.md'));
  const r = verify(root);
  assert.deepEqual(r.answer, { ok: false, code: 'BUNDLE_DIFFERS', differences: ['changed'], counts: { missing: 0, changed: 2, extra: 0 } });
});

test('an unlisted symbolic link or empty folder: the link is extra, the empty folder is nothing', t => {
  const { root } = built(t);
  fs.symlinkSync(path.join(root, 'app'), path.join(root, 'app-link'));
  fs.mkdirSync(path.join(root, 'app', 'DATAROOT'));
  const r = verify(root);
  assert.deepEqual(r.answer, { ok: false, code: 'BUNDLE_DIFFERS', differences: ['extra'], counts: { missing: 0, changed: 0, extra: 1 } });
});

test('a missing, unreadable or invalid manifest is MANIFEST_INVALID, never verified', t => {
  const { parent, root } = built(t);
  const manifestFile = path.join(root, 'BUILD-MANIFEST.json'), original = fs.readFileSync(manifestFile, 'utf8');
  const cases = [
    () => fs.rmSync(manifestFile),
    () => fs.writeFileSync(manifestFile, '{not json'),
    () => fs.writeFileSync(manifestFile, JSON.stringify({ ...JSON.parse(original), files: [] })),
    () => fs.writeFileSync(manifestFile, JSON.stringify({ ...JSON.parse(original), developmentOnly: false })),
    () => { const m = JSON.parse(original); m.files.reverse(); fs.writeFileSync(manifestFile, JSON.stringify(m)); },
    () => { const m = JSON.parse(original); m.files[0].path = '../outside'; fs.writeFileSync(manifestFile, JSON.stringify(m)); },
    () => { const m = JSON.parse(original); m.files[0] = null; fs.writeFileSync(manifestFile, JSON.stringify(m)); }
  ];
  for (const damage of cases) {
    fs.writeFileSync(manifestFile, original); damage();
    const r = verify(root);
    assert.equal(r.exitCode, 1);
    assert.deepEqual(r.answer, { ok: false, code: 'MANIFEST_INVALID' });
    noPaths(r.line, parent);
  }
  const gone = verify(path.join(parent, 'no such folder'));
  assert.deepEqual(gone.answer, { ok: false, code: 'MANIFEST_INVALID' });
});

test('any argument is refused with VERIFY_USAGE, exit 2, before reading anything', t => {
  const { root } = built(t);
  for (const argv of [['--root'], ['x', 'y'], ['--machine', root]]) {
    const r = verify(root, argv);
    assert.equal(r.exitCode, 2);
    assert.deepEqual(r.answer, { ok: false, code: 'VERIFY_USAGE' });
  }
});

test('the command run as a process checks the bundle two folders above it and prints one line', t => {
  const { root } = built(t);
  const { execFileSync } = require('node:child_process');
  const scripts = path.join(root, 'app', 'scripts');
  fs.mkdirSync(path.join(scripts, 'lib'), { recursive: true });
  fs.copyFileSync(path.join(repo, COMMAND), path.join(scripts, 'piraiders-verify-bundle.cjs'));
  fs.copyFileSync(path.join(repo, 'scripts/lib/windows-bundle.cjs'), path.join(scripts, 'lib', 'windows-bundle.cjs'));
  // The copied command is not in the manifest yet: extra, exit 1.
  let out;
  try { execFileSync(process.execPath, [path.join(scripts, 'piraiders-verify-bundle.cjs')], { encoding: 'utf8' }); assert.fail('must refuse'); }
  catch (error) { assert.equal(error.status, 1); out = error.stdout; }
  assert.deepEqual(JSON.parse(out), { ok: false, code: 'BUNDLE_DIFFERS', differences: ['extra'], counts: { missing: 0, changed: 0, extra: 2 } });
  assert.equal(out.split('\n').filter(Boolean).length, 1);
  fs.writeFileSync(path.join(root, 'BUILD-MANIFEST.json'), JSON.stringify(bundle.createManifest(root, METADATA), null, 2) + '\n');
  out = execFileSync(process.execPath, [path.join(scripts, 'piraiders-verify-bundle.cjs')], { encoding: 'utf8' });
  assert.equal(JSON.parse(out).code, 'BUNDLE_VERIFIED');
});

test('the bundle ships the command and its root entry from tracked templates', () => {
  assert.ok(bundle.REQUIRED_RUNTIME_SOURCES.includes(COMMAND));
  assert.deepEqual(bundle.selectSourceFiles(repo, [COMMAND, 'scripts/other-tool.cjs']), [COMMAND]);
  assert.equal(new Map(bundle.TEMPLATES).get('packaging/windows/Verify-PiRaiders.cmd'), 'Verify-PiRaiders.cmd');
});

test('Verify-PiRaiders.cmd runs only the bundled Node on the command, takes no arguments and needs no operator file', () => {
  const text = read('packaging/windows/Verify-PiRaiders.cmd');
  const runs = text.split(/\r?\n/).filter(line => /node\.exe"\s/.test(line) && !/^\s*if /i.test(line));
  assert.deepEqual(runs, ['"%PIRAIDERS_BUNDLE_ROOT%runtime\\node.exe" "%PIRAIDERS_BUNDLE_ROOT%app\\scripts\\piraiders-verify-bundle.cjs"']);
  assert.match(text, /if not "%~1"=="" \(\r?\n  echo Verify-PiRaiders\.cmd takes no arguments\./);
  assert.match(text, /echo Bundled Node runtime is missing\./);
  assert.doesNotMatch(text, /piraiders-app\.json|config\.json|%\*|%~?[2-9]/);
  const shipped = new Set(bundle.TEMPLATES.map(item => item[1]));
  for (const doc of text.match(/[A-Za-z0-9-]+\.md/g) || []) assert.ok(shipped.has(doc), 'names ' + doc);
});

test('the checklist\'s step 1 and README-WINDOWS.md name the entry, before any configuration', () => {
  const checklist = read('packaging/windows/OPERATOR-CHECKLIST.md');
  const step1 = checklist.split('## 1. Check the download')[1].split('## 2.')[0];
  assert.match(step1, /`Verify-PiRaiders\.cmd`/);
  for (const code of ['BUNDLE_VERIFIED', 'BUNDLE_DIFFERS', 'MANIFEST_INVALID']) assert.match(step1, new RegExp('`' + code + '`'));
  for (const kind of ['missing', 'changed', 'extra']) assert.match(step1, new RegExp('`' + kind + '`'));
  assert.doesNotMatch(checklist, /no command of its own/);
  assert.ok(checklist.indexOf('Verify-PiRaiders.cmd') < checklist.indexOf('## 3. Write the machine file'));
  const readme = read('packaging/windows/README-WINDOWS.md');
  assert.match(readme, /Verify-PiRaiders\.cmd/);
  assert.ok(readme.indexOf('Verify-PiRaiders.cmd') < readme.indexOf('Launch-PiRaiders.cmd` from the extracted root'));
});

// Review round (Q-013): a read error is not a manifest fault.
test('a listed file or a folder that cannot be read is VERIFY_FAILED, not MANIFEST_INVALID', t => {
  const { parent, root } = built(t);
  for (const [method, target] of [['readFileSync', path.join(root, 'app', 'server.js')], ['readdirSync', path.join(root, 'app', 'config')]]) {
    const original = fs[method];
    t.mock.method(fs, method, function (file, ...rest) {
      if (path.resolve(String(file)) === target) throw Object.assign(Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
      return original.call(this, file, ...rest);
    });
    const r = verify(root);
    t.mock.restoreAll();
    assert.equal(r.exitCode, 1);
    assert.deepEqual(r.answer, { ok: false, code: 'VERIFY_FAILED' }, method);
    noPaths(r.line, parent);
  }
});

test('the checklist does not say Verify refuses for a missing machine file', () => {
  const intro = read('packaging/windows/OPERATOR-CHECKLIST.md').split('## 1.')[0];
  assert.match(intro, /Setup, Diagnose and Launch also refuse with "Application configuration is missing" \(step 3\), Verify never does/);
  assert.doesNotMatch(read('packaging/windows/Verify-PiRaiders.cmd'), /Application configuration is missing/);
});
