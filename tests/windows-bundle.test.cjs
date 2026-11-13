'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { selectSourceFiles, copySourceFiles, createManifest, verifyManifest } = require('../scripts/lib/windows-bundle.cjs');

const metadata = { commitSHA: 'a'.repeat(40), spxVersion: '1.4.1', node: { version: 'v22.0.0', platform: 'win32', arch: 'x64' } };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piraiders-bundle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function write(root, relative, content = relative) {
  const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); return file;
}
function manifest(root) {
  const value = createManifest(root, metadata);
  fs.writeFileSync(path.join(root, 'BUILD-MANIFEST.json'), JSON.stringify(value));
  return value;
}
test('tracked runtime selection keeps SPX formats/locales while excluding operator files and credentials', t => {
  const root = fixture(t);
  const allowed = ['server.js', 'package.json', 'package-lock.json', 'LICENSE.txt', 'locales/english.json',
    'routes/router.js', 'utils/helper.js', 'views/controller.handlebars', 'static/style.css',
    'ASSETS/templates/native.html', 'ASSETS/templates/graphic.ograf', 'scripts/piraiders-launcher.cjs', 'scripts/lib/launcher-runtime.cjs'];
  const excluded = ['DATAROOT/operator.json', 'DATAROOT_DEMO/operator.json', 'LOG/engine.log', 'config.json',
    '.env', '.npmrc', '.gitcredentials', 'node_modules/package/index.js', 'static/.env.production',
    'static/.netrc', 'ASSETS/.ssh/id_ed25519', 'static/.gitconfig',
    'ASSETS/credentials.json', 'ASSETS/secrets.json', 'scripts/agent-lease.mjs', 'scripts/lib/agent-lease-state.mjs',
    '.git/config', 'docs/README.md'];
  for (const file of [...allowed, ...excluded]) write(root, file);
  // Untracked assets must not be copied merely because they are under ASSETS.
  write(root, 'ASSETS/private-untracked.png');
  assert.deepEqual(selectSourceFiles(root, [...allowed, ...excluded]), [...allowed].sort());
  const destination = path.join(root, 'out'); fs.mkdirSync(destination);
  copySourceFiles(root, destination, [...allowed, ...excluded]);
  assert.equal(fs.existsSync(path.join(destination, 'locales', 'english.json')), true);
  assert.equal(fs.existsSync(path.join(destination, 'ASSETS', 'private-untracked.png')), false);
  assert.equal(fs.existsSync(path.join(destination, 'DATAROOT')), false);
});
test('source selection rejects traversal, absolute paths, case collisions and symlink ancestors', t => {
  const root = fixture(t);
  write(root, 'server.js'); write(root, 'static/file.js');
  for (const candidate of ['../server.js', '/server.js', 'C:/server.js', 'static/../server.js', 'static\\file.js', 'static//file.js']) {
    assert.throws(() => selectSourceFiles(root, [candidate]), /Unsafe/);
  }
  assert.throws(() => selectSourceFiles(root, ['server.js', 'server.js']), /Duplicate/);
  const elsewhere = fixture(t); write(elsewhere, 'file.js');
  fs.mkdirSync(path.join(root, 'utils'));
  fs.symlinkSync(elsewhere, path.join(root, 'utils', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => selectSourceFiles(root, ['utils/linked/file.js']), /Symlink/);
});
test('manifest records sorted exact file hashes and detects mutation, omission and unexpected files', t => {
  const root = fixture(t);
  write(root, 'runtime/node.exe', 'runtime'); write(root, 'app/server.js', 'SPX');
  const value = manifest(root);
  assert.deepEqual(value.files.map(item => item.path), ['app/server.js', 'runtime/node.exe']);
  assert.equal(value.developmentOnly, true); assert.equal(verifyManifest(root).commitSHA, metadata.commitSHA);
  write(root, 'app/server.js', 'tampered'); assert.throws(() => verifyManifest(root), /integrity mismatch/);
  write(root, 'app/server.js', 'SPX');
  write(root, 'unlisted.txt', 'extra'); assert.throws(() => verifyManifest(root), /unlisted/);
  fs.unlinkSync(path.join(root, 'unlisted.txt'));
  fs.unlinkSync(path.join(root, 'runtime', 'node.exe')); assert.throws(() => verifyManifest(root));
});
test('manifest validation rejects escaping or duplicate entries, symlinks and false release metadata', t => {
  const root = fixture(t); write(root, 'app/server.js', 'SPX'); const value = manifest(root);
  const rewrite = candidate => fs.writeFileSync(path.join(root, 'BUILD-MANIFEST.json'), JSON.stringify(candidate));
  rewrite({ ...value, files: [{ ...value.files[0], path: '../escape' }] }); assert.throws(() => verifyManifest(root), /Unsafe/);
  rewrite({ ...value, files: [value.files[0], value.files[0]] }); assert.throws(() => verifyManifest(root), /Duplicate/);
  rewrite({ ...value, developmentOnly: false }); assert.throws(() => verifyManifest(root), /metadata/);
  rewrite(value);
  const elsewhere = fixture(t); write(elsewhere, 'file.txt');
  fs.symlinkSync(elsewhere, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => verifyManifest(root), /Symlink/);
});
