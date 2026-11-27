'use strict';
// Q-018 (part 2 of Q-016): staging the pinned CasparCG, Mesa and NDI runtime
// for the Windows ZIP, and copying that stage into a bundle. Stand-in archives
// on Linux; the real downloads and the ZIP are built on hosted Windows only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const runtime = require('../scripts/bundle-runtime.cjs');
const bundle = require('../scripts/lib/windows-bundle.cjs');
const { COMPONENTS, renderNotices, checkRuntimeLayout } = require('../scripts/lib/bundled-components.cjs');
const { download } = require('../scripts/prepare-caspar-proof.cjs');

const repo = path.resolve(__dirname, '..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
// A well-formed stand-in PE (machine, version resource, imports): Q-026's
// import check reads every runtime .exe and .dll.
const { peFile } = require('./fixtures/pe-file.cjs');
const pe = (machine = 0x8664, version = [6, 4, 0, 2], imports = []) => peFile({ machine, version, imports });
// Microsoft's installer stand-in: its bytes are pinned by the test's own hash.
const VC_BYTES = pe(0x14c, [14, 44, 35211, 0]);
const write = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
const GPL = 'GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007\n';
function standIns({ dll = pe(), casparExtra = {}, vcBytes = VC_BYTES } = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'q018-'));
  const casparcg = path.join(work, 'caspar'), mesa = path.join(work, 'mesa'), ndi = path.join(work, 'ndi', 'app');
  write(path.join(casparcg, 'casparcg.exe'), pe(0x8664, [2, 5, 1, 0], ['KERNEL32.dll', 'MSVCP140.dll', 'VCRUNTIME140.dll', 'VCRUNTIME140_1.dll', 'libEGL.dll', 'OPENGL32.dll']));
  write(path.join(casparcg, 'LICENSE'), GPL);
  write(path.join(casparcg, 'libEGL.dll'), pe(0x8664, [1, 0, 0, 0], ['d3d9.dll']));
  write(path.join(casparcg, 'locales', 'en-US.pak'), 'pak');
  for (const [name, bytes] of Object.entries(casparExtra)) write(path.join(casparcg, name), bytes);
  write(path.join(mesa, 'x64', 'opengl32.dll'), pe(0x8664, [26, 2, 6, 0]));
  write(path.join(mesa, 'x64', 'libgallium_wgl.dll'), pe(0x8664, [26, 2, 6, 0]));
  write(path.join(mesa, 'x64', 'vulkan_lvp.dll'), pe());
  write(path.join(mesa, 'x86', 'opengl32.dll'), pe(0x14c));
  write(path.join(ndi, 'Processing.NDI.Lib.x64.dll'), dll);
  write(path.join(ndi, 'Processing.NDI.Lib.x86.dll'), pe(0x14c));
  write(path.join(ndi, 'Processing.NDI.Lib.DirectShow.x64.dll'), pe());
  write(path.join(ndi, 'NDI License Agreement.pdf'), 'pdf');
  write(path.join(ndi, 'Processing.NDI.Lib.Licenses.txt'), 'licences');
  const vcredist = path.join(work, 'downloads', 'vc-redist.exe');
  write(vcredist, vcBytes);
  const ndiFiles = { dll: { name: 'Processing.NDI.Lib.x64.dll', sha256: sha(dll), version: '6.4.0.2' },
    licences: [{ name: 'NDI License Agreement.pdf', sha256: sha('pdf') }, { name: 'Processing.NDI.Lib.Licenses.txt', sha256: sha('licences') }] };
  const vcRedist = { ...runtime.VC_REDIST, sha256: sha(VC_BYTES) };
  return { work, stage: path.join(work, 'stage'), extracted: { casparcg, mesa, ndi, vcredist }, ndiFiles, vcRedist };
}
const tree = dir => {
  const out = [];
  const walk = prefix => { for (const e of fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })) { const r = prefix ? prefix + '/' + e.name : e.name; if (e.isDirectory()) walk(r); else out.push(r); } };
  walk(''); return out.sort();
};

test('the pins: the NDI DLL and its licence files taken from the installer, the build-only extractor', () => {
  assert.match(runtime.NDI_FILES.dll.sha256, /^[a-f0-9]{64}$/);
  assert.equal(runtime.NDI_FILES.dll.version, COMPONENTS.find(item => item.id === 'ndi-runtime').version);
  assert.deepEqual(runtime.NDI_FILES.licences.map(item => item.name), ['NDI License Agreement.pdf', 'Processing.NDI.Lib.Licenses.txt']);
  for (const item of runtime.NDI_FILES.licences) assert.match(item.sha256, /^[a-f0-9]{64}$/);
  assert.match(runtime.INNOEXTRACT.sha256, /^[a-f0-9]{64}$/);
  assert.match(runtime.INNOEXTRACT.url, /^https:\/\/github\.com\/dscharrer\/innoextract\/releases\/download\/1\.9\//);
  assert.deepEqual(runtime.MESA_FILES, ['opengl32.dll', 'libgallium_wgl.dll']);
  for (const name of ['MIT.txt', 'Mesa-license.rst', 'mesa-dist-win-LICENSE.txt', 'SGI-B-2.0.txt'])
    assert.ok(fs.statSync(path.join(repo, runtime.MESA_LICENCE_DIRECTORY, name)).size > 500, name);
});

test('peInfo reads the PE machine and the version resource, skipping a chance signature in code', () => {
  assert.deepEqual(runtime.peInfo(pe()), { machine: 0x8664, version: '6.4.0.2' });
  assert.deepEqual(runtime.peInfo(pe(0x14c, null)), { machine: 0x14c, version: null });
  const chance = pe(); chance.writeUInt32LE(0xfeef04bd, 96); chance.writeUInt32LE(0x12345678, 100);
  assert.equal(runtime.peInfo(chance).version, '6.4.0.2');
  assert.throws(() => runtime.peInfo(Buffer.from('not a pe file at all, not even close to one, no.................')), /RUNTIME_PE_INVALID/);
});

test('staging places Caspar unchanged, Mesa x64 OpenGL only, the one NDI DLL, licences and notices', () => {
  const s = standIns();
  const paths = runtime.stageRuntime({ ...s, repoRoot: repo });
  assert.deepEqual(checkRuntimeLayout(paths), []);
  const files = tree(s.stage);
  for (const file of ['runtime/caspar/casparcg.exe', 'runtime/caspar/LICENSE', 'runtime/caspar/libEGL.dll', 'runtime/caspar/locales/en-US.pak',
    'runtime/mesa/opengl32.dll', 'runtime/mesa/libgallium_wgl.dll', 'runtime/ndi/Processing.NDI.Lib.x64.dll',
    'licenses/CasparCG-LICENSE.txt', 'licenses/Mesa/MIT.txt', 'licenses/NDI/NDI License Agreement.pdf',
    'licenses/NDI/Processing.NDI.Lib.Licenses.txt', 'THIRD-PARTY-NOTICES.md', 'runtime/vcredist/VC_redist.x64.exe']) assert.ok(files.includes(file), file);
  assert.deepEqual(files.filter(file => file.startsWith('runtime/vcredist/')), ['runtime/vcredist/VC_redist.x64.exe']);
  assert.ok(fs.readFileSync(path.join(s.stage, 'runtime/vcredist/VC_redist.x64.exe')).equals(VC_BYTES), 'the installer is copied unchanged');
  assert.deepEqual(files.filter(file => file.startsWith('runtime/mesa/')), ['runtime/mesa/libgallium_wgl.dll', 'runtime/mesa/opengl32.dll']);
  assert.deepEqual(files.filter(file => file.startsWith('runtime/ndi/')), ['runtime/ndi/Processing.NDI.Lib.x64.dll']);
  assert.equal(fs.readFileSync(path.join(s.stage, 'THIRD-PARTY-NOTICES.md'), 'utf8'), renderNotices());
  assert.equal(fs.readFileSync(path.join(s.stage, 'licenses/CasparCG-LICENSE.txt'), 'utf8'), GPL);
});

test('staging refuses wrong NDI bytes, an x86 or wrong-version DLL and changed licence files', () => {
  let s = standIns();
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo, ndiFiles: { ...s.ndiFiles, dll: { ...s.ndiFiles.dll, sha256: 'a'.repeat(64) } } }), /^StageError: NDI_RUNTIME_HASH$|NDI_RUNTIME_HASH/);
  s = standIns({ dll: pe(0x14c) });
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo }), /NDI_RUNTIME_X64_REQUIRED/);
  s = standIns({ dll: pe(0x8664, [6, 3, 0, 0]) });
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo }), /NDI_RUNTIME_VERSION/);
  s = standIns(); fs.writeFileSync(path.join(s.extracted.ndi, 'Processing.NDI.Lib.Licenses.txt'), 'changed');
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo }), /NDI_LICENCE_HASH/);
  s = standIns(); fs.rmSync(path.join(s.extracted.ndi, 'NDI License Agreement.pdf'));
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo }), /NDI_LICENCE_MISSING/);
});

test('staging refuses an opengl32.dll beside casparcg.exe, a missing GPL text, a link and x86-only Mesa', () => {
  let s = standIns({ casparExtra: { 'OpenGL32.DLL': pe() } });
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo }), /RUNTIME_LAYOUT_MESA_BESIDE_CASPAR/);
  s = standIns(); fs.rmSync(path.join(s.extracted.casparcg, 'LICENSE'));
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo }), /CASPAR_LICENCE_MISSING/);
  s = standIns(); fs.writeFileSync(path.join(s.extracted.casparcg, 'LICENSE'), 'MIT License');
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo }), /CASPAR_LICENCE_MISSING/);
  s = standIns(); fs.symlinkSync(os.tmpdir(), path.join(s.extracted.casparcg, 'outside'));
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo }), /RUNTIME_ENTRY_INVALID/);
  s = standIns(); fs.rmSync(path.join(s.extracted.mesa, 'x64'), { recursive: true });
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo }), /MESA_LAYOUT/);
  s = standIns(); fs.writeFileSync(path.join(s.extracted.mesa, 'x64', 'opengl32.dll'), pe(0x14c));
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo }), /MESA_X64_REQUIRED/);
  s = standIns(); fs.rmSync(path.join(s.extracted.casparcg, 'casparcg.exe'));
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo }), /CASPAR_LAYOUT/);
  s = standIns(); fs.mkdirSync(s.stage);
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo }), /STAGE_EXISTS/);
});

test('Q-026: the VC++ installer pin is the component\'s, and staging refuses other bytes, another version or none', () => {
  const vc = COMPONENTS.find(item => item.id === 'vc-redist');
  assert.deepEqual(runtime.VC_REDIST, { name: 'VC_redist.x64.exe', version: vc.version + '.0', sha256: vc.sha256 });
  assert.ok(Object.isFrozen(runtime.VC_REDIST));
  let s = standIns();
  // The real pin: the stand-in's bytes are not Microsoft's.
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo, vcRedist: runtime.VC_REDIST }), /VC_REDIST_HASH/);
  s = standIns({ vcBytes: pe(0x14c, [14, 44, 35210, 0]) });
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo, vcRedist: { ...s.vcRedist, sha256: sha(pe(0x14c, [14, 44, 35210, 0])) } }), /VC_REDIST_VERSION/);
  s = standIns();
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo, vcRedist: { ...s.vcRedist, version: '14.45.1.0' } }), /VC_REDIST_VERSION/);
  s = standIns(); fs.rmSync(s.extracted.vcredist);
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo }), /VC_REDIST_LAYOUT/);
  s = standIns(); fs.rmSync(s.extracted.vcredist); fs.mkdirSync(s.extracted.vcredist);
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo }), /VC_REDIST_LAYOUT/);
  s = standIns(); fs.rmSync(s.extracted.vcredist); fs.symlinkSync(path.join(s.extracted.ndi, 'Processing.NDI.Lib.Licenses.txt'), s.extracted.vcredist);
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo }), /VC_REDIST_LAYOUT/);
});

test('Q-026: staging refuses a runtime file whose import nobody provides, naming it, and a runtime .dll that is not a PE', () => {
  let s = standIns({ casparExtra: { 'sfml-system-2.dll': pe(0x8664, [2, 6, 0, 0], ['VCRUNTIME140.dll', 'tbb12.dll']) } });
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo }), error =>
    error instanceof runtime.StageError && error.message === 'RUNTIME_IMPORT_MISSING' && error.detail === 'caspar/sfml-system-2.dll imports tbb12.dll');
  s = standIns({ casparExtra: { 'a.dll': pe(0x8664, null, ['one.dll']), 'b.dll': pe(0x8664, null, ['two.dll']) } });
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo }), error => error.detail === 'caspar/a.dll imports one.dll (and 1 more)');
  s = standIns({ casparExtra: { 'libGLESv2.dll': 'not a PE' } });
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo }), error => error.message === 'RUNTIME_PE_INVALID' && error.detail === 'caspar/libGLESv2.dll');
  // Mesa's opengl32.dll needs libgallium_wgl.dll beside it.
  s = standIns(); fs.writeFileSync(path.join(s.extracted.mesa, 'x64', 'opengl32.dll'), pe(0x8664, [26, 2, 6, 0], ['libgallium_wgl.dll', 'missing_mesa.dll']));
  assert.throws(() => runtime.stageRuntime({ ...s, repoRoot: repo }), error => error.detail === 'mesa/opengl32.dll imports missing_mesa.dll');
  // The failure line names only the code and that detail.
  const source = fs.readFileSync(path.join(repo, 'scripts', 'bundle-runtime.cjs'), 'utf8');
  assert.match(source, /console\.error\('Bundled runtime failed: ' \+ code\(error\) \+ detail\(error\)\)/);
});

test('every download is checked against its pin and a mismatch is refused', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'q018-dl-'));
  const seen = [];
  await runtime.downloadAll(work, { download: async (pin, file) => { seen.push({ ...pin, file: path.basename(file) }); } });
  assert.deepEqual(seen.map(pin => pin.name), ['casparcg', 'mesa', 'ndi-runtime', 'vc-redist', 'innoextract']);
  assert.equal(seen.find(pin => pin.name === 'vc-redist').file, 'vc-redist.exe');
  for (const item of COMPONENTS) assert.equal(seen.find(pin => pin.name === item.id).sha256, item.sha256);
  assert.equal(seen.find(pin => pin.name === 'innoextract').sha256, runtime.INNOEXTRACT.sha256);
  assert.ok(seen.every(pin => pin.maxBytes > 0));
  const wrong = async () => ({ ok: true, body: (async function* () { yield Buffer.from('not the pinned bytes'); })() });
  await assert.rejects(runtime.downloadAll(work, { download: (pin, file) => download(pin, file, { fetchImpl: wrong }) }), /DOWNLOAD_HASH/);
  assert.deepEqual(fs.readdirSync(work), []);
});

function fakeBundle(stageOptions) {
  const s = standIns(stageOptions);
  runtime.stageRuntime({ ...s, repoRoot: repo });
  const root = path.join(s.work, 'bundle');
  write(path.join(root, 'runtime', 'node.exe'), pe());
  write(path.join(root, 'licenses', 'Node-LICENSE.txt'), 'node');
  return { ...s, root };
}

test('the ZIP build copies the stage into the bundle and checks the layout and notices again', () => {
  const b = fakeBundle();
  const copied = bundle.copyRuntimeStage(b.stage, b.root);
  assert.ok(copied.includes('runtime/ndi/Processing.NDI.Lib.x64.dll'));
  const files = tree(b.root);
  assert.ok(files.includes('runtime/node.exe') && files.includes('THIRD-PARTY-NOTICES.md') && files.includes('licenses/Mesa/MIT.txt'));
  const manifest = bundle.createManifest(b.root, { commitSHA: 'a'.repeat(40), spxVersion: '1.0.0', node: { version: 'v22.0.0', platform: 'win32', arch: 'x64' } });
  for (const file of ['THIRD-PARTY-NOTICES.md', 'runtime/caspar/casparcg.exe', 'runtime/mesa/opengl32.dll', 'licenses/NDI/NDI License Agreement.pdf', 'runtime/vcredist/VC_redist.x64.exe'])
    assert.ok(manifest.files.some(item => item.path === file), file);
});

test('the ZIP build refuses a missing stage, a collision, a file outside its places, changed notices or a bad layout', () => {
  let b = fakeBundle();
  assert.throws(() => bundle.copyRuntimeStage(path.join(b.work, 'nothing'), b.root), /RUNTIME_STAGE_MISSING/);
  write(path.join(b.root, 'licenses', 'CasparCG-LICENSE.txt'), 'already');
  assert.throws(() => bundle.copyRuntimeStage(b.stage, b.root), /RUNTIME_STAGE_COLLISION/);
  b = fakeBundle(); write(path.join(b.stage, 'app', 'server.js'), 'x');
  assert.throws(() => bundle.copyRuntimeStage(b.stage, b.root), /RUNTIME_STAGE_UNEXPECTED/);
  b = fakeBundle(); write(path.join(b.stage, 'runtime', 'node.exe'), 'x');
  assert.throws(() => bundle.copyRuntimeStage(b.stage, b.root), /RUNTIME_STAGE_UNEXPECTED/);
  b = fakeBundle(); fs.appendFileSync(path.join(b.stage, 'THIRD-PARTY-NOTICES.md'), 'more');
  assert.throws(() => bundle.copyRuntimeStage(b.stage, b.root), /RUNTIME_NOTICES_MISMATCH/);
  b = fakeBundle(); write(path.join(b.stage, 'runtime', 'caspar', 'opengl32.dll'), pe());
  assert.throws(() => bundle.copyRuntimeStage(b.stage, b.root), /RUNTIME_LAYOUT_MESA_BESIDE_CASPAR/);
  b = fakeBundle(); fs.rmSync(path.join(b.stage, 'runtime', 'ndi'), { recursive: true });
  assert.throws(() => bundle.copyRuntimeStage(b.stage, b.root), /RUNTIME_LAYOUT_NDI_RUNTIME_MISSING/);
  b = fakeBundle(); fs.rmSync(path.join(b.stage, 'runtime', 'vcredist'), { recursive: true });
  assert.throws(() => bundle.copyRuntimeStage(b.stage, b.root), /RUNTIME_LAYOUT_VC_REDIST_MISSING/);
});

test('the build entry stages the runtime before the ZIP and the ZIP build demands the stage', () => {
  const entry = fs.readFileSync(path.join(repo, 'scripts', 'build-windows-bundle.cjs'), 'utf8');
  assert.match(entry, /stageRuntime\(\)[\s\S]*buildWindowsBundle\(\{ runtimeStage \}\)/);
  const lib = fs.readFileSync(path.join(repo, 'scripts', 'lib', 'windows-bundle.cjs'), 'utf8');
  assert.match(lib, /if \(typeof runtimeStage !== 'string' \|\| !runtimeStage\) throw Error\('RUNTIME_STAGE_MISSING'\)/);
  assert.match(lib, /copyRuntimeStage\(runtimeStage, bundle\);\r?\n/);
  // The staging script and its downloader are build recipes, not packaged sources.
  assert.equal(bundle.selectSourceFiles(repo, ['scripts/bundle-runtime.cjs', 'scripts/prepare-caspar-proof.cjs']).length, 0);
});
