#!/usr/bin/env node
'use strict';
// Q-018 (part 2 of Q-016): stage the pinned CasparCG, Mesa and NDI runtime
// for the Windows ZIP. Build machine only: this file is not packaged and
// nothing in the ZIP downloads anything. Each download is refused unless its
// SHA-256 is the pin in scripts/lib/bundled-components.cjs; the files taken
// from inside the NDI installer are refused unless their own SHA-256 match
// the pins below and the DLL is an x64 PE of the pinned version. The staged
// tree (runtime/, licenses/, THIRD-PARTY-NOTICES.md) is refused unless
// checkRuntimeLayout() answers no code. Q-026: Microsoft's VC++ runtime
// installer is placed unchanged (pinned bytes and version, never run here),
// and every runtime .exe and .dll must import only DLLs that the bundle,
// Windows or that installer provides (RUNTIME_IMPORT_MISSING otherwise).
// Design: docs/design/BUNDLED_RUNTIME.md.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { COMPONENTS, renderNotices, checkRuntimeLayout } = require('./lib/bundled-components.cjs');
const { checkRuntimeImports } = require('./lib/pe-imports.cjs');

const byId = id => COMPONENTS.find(item => item.id === id);
const LIMITS = Object.freeze({ casparcg: 350000000, mesa: 500000000, 'ndi-runtime': 150 * 1024 * 1024, 'vc-redist': 64 * 1024 * 1024 });
// Microsoft's installer as the ZIP carries it, and the file version its
// version resource must read (the component's version plus ".0").
const VC_REDIST = Object.freeze({ name: 'VC_redist.x64.exe', version: '14.44.35211.0', sha256: byId('vc-redist').sha256 });
// Build tool only (never shipped): reads the NDI runtime installer's files
// without running the installer, so the build machine's own NDI install,
// registry and PATH are never touched.
const INNOEXTRACT = Object.freeze({ name: 'innoextract', version: '1.9',
  url: 'https://github.com/dscharrer/innoextract/releases/download/1.9/innoextract-1.9-windows.zip',
  sha256: '6989342c9b026a00a72a38f23b62a8e6a22cc5de69805cf47d68ac2fec993065', maxBytes: 20 * 1024 * 1024 });
// Files taken from inside the pinned NDI installer (read 2026-11-27).
const NDI_FILES = Object.freeze({
  dll: Object.freeze({ name: 'Processing.NDI.Lib.x64.dll', sha256: 'adca7e9c98ddddb01a1b684f90c97d0bd764990ee2839524fde51ab37f21028a', version: '6.4.0.2' }),
  licences: Object.freeze([
    Object.freeze({ name: 'NDI License Agreement.pdf', sha256: '29956abf482d50495c2fd6baf44aed439d9646119ed04b393758b37cc63a9e74' }),
    Object.freeze({ name: 'Processing.NDI.Lib.Licenses.txt', sha256: '9f18e17e95324b1907c4de45f676ce2fedbc0a5c4ff6ed451b31c3fcb1229b8d' })
  ])
});
// Mesa's x64 OpenGL (WGL) files: opengl32.dll loads libgallium_wgl.dll.
const MESA_FILES = Object.freeze(['opengl32.dll', 'libgallium_wgl.dll']);
// Mesa's release archive carries no licence text: these are committed copies
// of Mesa's licenses/ folder and docs/license.rst at tag mesa-26.2.6 and of the
// mesa-dist-win LICENSE at tag 26.2.6.
const MESA_LICENCE_DIRECTORY = 'packaging/windows/licenses/Mesa';

class StageError extends Error {}
const fail = (code, detail) => { const error = new StageError(code); if (detail) error.detail = detail; throw error; };
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// PE machine and the VS_FIXEDFILEINFO file version (a.b.c.d), or null when the
// file carries none. Throws RUNTIME_PE_INVALID on anything that is not a PE.
function peInfo(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') fail('RUNTIME_PE_INVALID');
  const offset = bytes.readUInt32LE(60);
  if (offset < 64 || offset > bytes.length - 6 || bytes.readUInt32LE(offset) !== 0x00004550) fail('RUNTIME_PE_INVALID');
  const machine = bytes.readUInt16LE(offset + 4);
  const signature = Buffer.from([0xbd, 0x04, 0xef, 0xfe]);
  // The first signature followed by structure version 1.0 (the same four bytes
  // can occur by chance in code before the version resource).
  for (let at = bytes.indexOf(signature); at >= 0 && at + 16 <= bytes.length; at = bytes.indexOf(signature, at + 1)) {
    if (bytes.readUInt32LE(at + 4) !== 0x00010000) continue;
    const ms = bytes.readUInt32LE(at + 8), ls = bytes.readUInt32LE(at + 12);
    return { machine, version: [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff].join('.') };
  }
  return { machine, version: null };
}

// Regular files under dir as forward-slash relative paths. A symbolic link or
// any other non-regular entry is refused: nothing outside the tree is copied.
function regularFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, ...prefix.split('/').filter(Boolean)), { withFileTypes: true })) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) fail('RUNTIME_ENTRY_INVALID');
    if (entry.isDirectory()) out.push(...regularFiles(dir, relative));
    else if (entry.isFile()) out.push(relative);
    else fail('RUNTIME_ENTRY_INVALID');
  }
  return out.sort();
}
function copyInto(sourceRoot, relative, destinationRoot, destinationRelative = relative) {
  const target = path.join(destinationRoot, ...destinationRelative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(sourceRoot, ...relative.split('/')), target, fs.constants.COPYFILE_EXCL);
}
// One file by name (any letter case) directly in dir; exactly one or refused.
function oneFile(dir, name, code) {
  const found = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.name.toLowerCase() === name.toLowerCase()) : [];
  if (found.length !== 1 || !found[0].isFile()) fail(code);
  return path.join(dir, found[0].name);
}

// Builds stage/ from already-extracted inputs. extracted = { casparcg, mesa,
// ndi, vcredist } (folders as the archives unpack: Caspar's files at its root,
// Mesa's x64/ folder, the NDI installer's app/ folder; vcredist is the
// downloaded VC_redist.x64.exe itself). Linux-testable: no download, no
// archive tool. Returns the staged runtime/ paths.
function stageRuntime({ stage, extracted, repoRoot = path.resolve(__dirname, '..'), ndiFiles = NDI_FILES, vcRedist = VC_REDIST }) {
  if (fs.existsSync(stage)) fail('STAGE_EXISTS');
  fs.mkdirSync(stage, { recursive: true });
  const licences = path.join(stage, 'licenses');
  // CasparCG: the release archive's files, unchanged; its GPL text.
  const caspar = byId('casparcg');
  const casparFiles = regularFiles(extracted.casparcg);
  if (!casparFiles.some(file => file.toLowerCase() === 'casparcg.exe')) fail('CASPAR_LAYOUT');
  const casparLicence = casparFiles.filter(file => file.toLowerCase() === 'license');
  if (casparLicence.length !== 1) fail('CASPAR_LICENCE_MISSING');
  if (!/GNU GENERAL PUBLIC LICENSE\s+Version 3/.test(fs.readFileSync(path.join(extracted.casparcg, casparLicence[0]), 'latin1'))) fail('CASPAR_LICENCE_MISSING');
  for (const file of casparFiles) copyInto(extracted.casparcg, file, stage, caspar.folder + '/' + file);
  copyInto(extracted.casparcg, casparLicence[0], licences, 'CasparCG-LICENSE.txt');
  // Mesa: the x64 OpenGL files only, in their own folder.
  const mesa = byId('mesa');
  const mesaX64 = path.join(extracted.mesa, 'x64');
  for (const name of MESA_FILES) {
    const file = oneFile(mesaX64, name, 'MESA_LAYOUT');
    const bytes = fs.readFileSync(file);
    if (peInfo(bytes).machine !== 0x8664) fail('MESA_X64_REQUIRED');
    copyInto(path.dirname(file), path.basename(file), stage, mesa.folder + '/' + name);
  }
  const mesaLicences = path.join(repoRoot, ...MESA_LICENCE_DIRECTORY.split('/'));
  const mesaLicenceFiles = fs.existsSync(mesaLicences) ? regularFiles(mesaLicences) : [];
  if (!mesaLicenceFiles.includes('MIT.txt')) fail('MESA_LICENCE_MISSING');
  for (const file of mesaLicenceFiles) copyInto(mesaLicences, file, licences, 'Mesa/' + file);
  // NDI: the one x64 runtime DLL, pinned bytes and version; its licence files.
  const ndi = byId('ndi-runtime');
  const dllPath = oneFile(extracted.ndi, ndiFiles.dll.name, 'NDI_RUNTIME_LAYOUT');
  const dll = fs.readFileSync(dllPath);
  if (sha256(dll) !== ndiFiles.dll.sha256) fail('NDI_RUNTIME_HASH');
  const info = peInfo(dll);
  if (info.machine !== 0x8664) fail('NDI_RUNTIME_X64_REQUIRED');
  if (info.version !== ndiFiles.dll.version || info.version !== ndi.version) fail('NDI_RUNTIME_VERSION');
  copyInto(path.dirname(dllPath), path.basename(dllPath), stage, ndi.folder + '/' + ndiFiles.dll.name);
  for (const licence of ndiFiles.licences) {
    const file = oneFile(extracted.ndi, licence.name, 'NDI_LICENCE_MISSING');
    if (sha256(fs.readFileSync(file)) !== licence.sha256) fail('NDI_LICENCE_HASH');
    copyInto(path.dirname(file), path.basename(file), licences, 'NDI/' + licence.name);
  }
  // Nothing else of the installer (no x86, DirectShow or File DLLs, no NDI Tools).
  // Microsoft's VC++ runtime installer: the pinned download, unchanged, never run.
  const vc = byId('vc-redist');
  let vcBytes;
  try { vcBytes = fs.lstatSync(extracted.vcredist).isFile() ? fs.readFileSync(extracted.vcredist) : null; } catch { vcBytes = null; }
  if (!vcBytes) fail('VC_REDIST_LAYOUT');
  if (sha256(vcBytes) !== vcRedist.sha256) fail('VC_REDIST_HASH');
  if (peInfo(vcBytes).version !== vcRedist.version || !vcRedist.version.startsWith(vc.version + '.')) fail('VC_REDIST_VERSION');
  const vcTarget = path.join(stage, ...vc.folder.split('/'), vcRedist.name);
  fs.mkdirSync(path.dirname(vcTarget), { recursive: true });
  fs.writeFileSync(vcTarget, vcBytes, { flag: 'wx' });
  const runtimePaths = regularFiles(path.join(stage, 'runtime')).map(file => 'runtime/' + file);
  const problems = checkRuntimeLayout(runtimePaths);
  if (problems.length) fail('RUNTIME_LAYOUT_' + problems[0]);
  // Every DLL a runtime file imports is provided (Q-026); the first gap is named.
  let missing;
  try { missing = checkRuntimeImports(path.join(stage, 'runtime')); }
  catch (error) { fail(error.message === 'RUNTIME_PE_INVALID' ? 'RUNTIME_PE_INVALID' : 'RUNTIME_IMPORT_CHECK_FAILED', error.file); }
  if (missing.length) fail('RUNTIME_IMPORT_MISSING', missing[0].file + ' imports ' + missing[0].dll + (missing.length > 1 ? ' (and ' + (missing.length - 1) + ' more)' : ''));
  fs.writeFileSync(path.join(stage, 'THIRD-PARTY-NOTICES.md'), renderNotices());
  return runtimePaths;
}

// Download with the pin's SHA-256 (refused on mismatch), then unpack.
async function downloadAll(work, { download = require('./prepare-caspar-proof.cjs').download } = {}) {
  const archives = {};
  for (const item of [...COMPONENTS, INNOEXTRACT]) {
    const id = item.id || item.name;
    const pin = { name: id, url: item.url, sha256: item.sha256, maxBytes: item.maxBytes || LIMITS[id] };
    if (!pin.maxBytes) fail('DOWNLOAD_LIMIT');
    const file = path.join(work, id + path.extname(new URL(item.url).pathname));
    await download(pin, file);
    archives[id] = file;
  }
  return archives;
}
function unpackAll(work, archives) {
  const sevenZip = path.join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip', '7z.exe');
  const run = (file, args) => execFileSync(file, args, { stdio: 'ignore', timeout: 300000, windowsHide: true, shell: false });
  const out = name => { const dir = path.join(work, name); fs.mkdirSync(dir); return dir; };
  const casparcg = out('casparcg'), mesa = out('mesa'), tool = out('innoextract'), ndi = out('ndi');
  run(sevenZip, ['x', '-y', '-o' + casparcg, archives.casparcg]);
  run(sevenZip, ['x', '-y', '-o' + mesa, archives.mesa]);
  run(sevenZip, ['x', '-y', '-o' + tool, archives.innoextract]);
  run(path.join(tool, 'innoextract.exe'), ['--extract', '--silent', '--output-dir', ndi, archives['ndi-runtime']]);
  return { casparcg, mesa, ndi: path.join(ndi, 'app'), vcredist: archives['vc-redist'] };
}

// Build entry: stage into build/windows/runtime-stage. Windows x64 only.
async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') fail('WINDOWS_REQUIRED');
  const root = path.resolve(__dirname, '..');
  const stage = path.join(root, 'build', 'windows', 'runtime-stage');
  const work = path.join(root, 'build', 'windows', 'runtime-downloads');
  await fsp.rm(stage, { recursive: true, force: true, maxRetries: 5 });
  await fsp.rm(work, { recursive: true, force: true, maxRetries: 5 });
  await fsp.mkdir(work, { recursive: true });
  try {
    const extracted = unpackAll(work, await downloadAll(work));
    const paths = stageRuntime({ stage, extracted, repoRoot: root });
    console.log(JSON.stringify({ event: 'bundled-runtime-staged', components: COMPONENTS.map(item => item.id + ' ' + item.version), runtimeFiles: paths.length }));
    return stage;
  } catch (error) {
    await fsp.rm(stage, { recursive: true, force: true, maxRetries: 5 });
    throw error;
  } finally {
    await fsp.rm(work, { recursive: true, force: true, maxRetries: 5 });
  }
}
const code = error => /^[A-Z][A-Z0-9_]{1,80}$/.test(error?.message) ? error.message : 'RUNTIME_STAGE_FAILED';
// The detail names only bundle-relative runtime files and DLL names.
const detail = error => error instanceof StageError && typeof error.detail === 'string' && /^[A-Za-z0-9_.+ ()/-]{1,300}$/.test(error.detail) ? ': ' + error.detail : '';
if (require.main === module) main().catch(error => { console.error('Bundled runtime failed: ' + code(error) + detail(error)); process.exitCode = 1; });

module.exports = { INNOEXTRACT, NDI_FILES, VC_REDIST, StageError, MESA_FILES, MESA_LICENCE_DIRECTORY, peInfo, stageRuntime, downloadAll, main };
