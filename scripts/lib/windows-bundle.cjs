'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const MANIFEST = 'BUILD-MANIFEST.json';
const SOURCE_ROOT_FILES = new Set(['server.js', 'package.json', 'package-lock.json', 'LICENSE.txt']);
const SOURCE_DIRECTORIES = new Set(['routes', 'utils', 'views', 'static', 'ASSETS', 'locales']);
const TEMPLATES = [
  ['packaging/windows/Launch-PiRaiders.cmd', 'Launch-PiRaiders.cmd'],
  ['packaging/windows/README-WINDOWS.md', 'README-WINDOWS.md'],
  ['packaging/windows/piraiders-launcher.example.json', 'app/config/piraiders-launcher.example.json']
];

function relativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') ||
      /[\x00-\x1f\x7f]/.test(value) || value.startsWith('/') ||
      value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw Error('Unsafe bundle-relative path');
  }
  return value;
}
function safePath(root, relative, allowMissing = false) {
  relativePath(relative);
  const base = path.resolve(root);
  if (fs.lstatSync(base).isSymbolicLink()) throw Error('Symlink bundle root is not allowed');
  let current = base;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw Error('Symlink bundle path is not allowed: ' + relative);
    } catch (error) {
      if (allowMissing && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return current;
}
function sensitiveSource(relative) {
  return relative.split('/').some(part => /^(?:\.git|node_modules|\.npmrc|\.gitcredentials|\.gitconfig|\.netrc|\.ssh)$/i.test(part) ||
    /^\.env(?:\.|$)/i.test(part) || /^(?:credentials?|secrets?)(?:\.|$)/i.test(part));
}
function allowedSource(relative) {
  relativePath(relative);
  if (sensitiveSource(relative)) return false;
  if (SOURCE_ROOT_FILES.has(relative) || relative === 'scripts/piraiders-launcher.cjs') return true;
  if (relative.startsWith('scripts/lib/')) return relative !== 'scripts/lib/agent-lease-state.mjs';
  return relative.includes('/') && SOURCE_DIRECTORIES.has(relative.split('/')[0]);
}
function selectSourceFiles(root, trackedPaths) {
  if (!Array.isArray(trackedPaths)) throw Error('Tracked source inventory required');
  const selected = [], seen = new Set();
  for (const relative of trackedPaths) {
    relativePath(relative);
    if (!allowedSource(relative)) continue;
    const key = relative.toLowerCase();
    if (seen.has(key)) throw Error('Duplicate or case-colliding source path');
    seen.add(key);
    const source = safePath(root, relative);
    if (!fs.lstatSync(source).isFile()) throw Error('Bundle source must be a regular file: ' + relative);
    selected.push(relative);
  }
  return selected.sort();
}
function copyFile(root, relative, destinationRoot, destinationRelative = relative) {
  const source = safePath(root, relative);
  if (!fs.lstatSync(source).isFile()) throw Error('Bundle source must be a regular file');
  const destination = safePath(destinationRoot, destinationRelative, true);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
function copySourceFiles(root, appRoot, trackedPaths) {
  const files = selectSourceFiles(root, trackedPaths);
  for (const relative of files) copyFile(root, relative, appRoot);
  return files;
}
function filesUnder(root, prefix = '') {
  const directory = prefix ? safePath(root, prefix) : path.resolve(root);
  if (fs.lstatSync(directory).isSymbolicLink()) throw Error('Symlink bundle root is not allowed');
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    const absolute = safePath(root, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) files.push(...filesUnder(root, relative));
    else if (stat.isFile()) files.push(relative);
    else throw Error('Non-regular bundle entry: ' + relative);
  }
  return files.sort();
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function validMetadata(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.developmentOnly !== true ||
      !/^[a-f0-9]{40}$/.test(manifest.commitSHA || '') ||
      typeof manifest.spxVersion !== 'string' || !manifest.spxVersion ||
      !manifest.node || !/^v?\d+\.\d+\.\d+$/.test(manifest.node.version || '') ||
      manifest.node.platform !== 'win32' || manifest.node.arch !== 'x64') {
    throw Error('Invalid development bundle manifest metadata');
  }
}
function createManifest(root, metadata) {
  const manifest = { schemaVersion: 1, developmentOnly: true, commitSHA: metadata.commitSHA,
    spxVersion: metadata.spxVersion, node: { ...metadata.node } };
  validMetadata(manifest);
  manifest.files = filesUnder(root).filter(file => file !== MANIFEST).map(relative => {
    const file = safePath(root, relative);
    return { path: relative, bytes: fs.statSync(file).size, sha256: sha256(file) };
  });
  return manifest;
}
function verifyManifest(root) {
  const file = safePath(root, MANIFEST);
  if (!fs.lstatSync(file).isFile() || fs.statSync(file).size > 16 * 1024 * 1024) throw Error('Invalid manifest file');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  validMetadata(manifest);
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw Error('Empty bundle inventory');
  const seen = new Set(), expected = [];
  for (const item of manifest.files) {
    relativePath(item.path);
    if (item.path === MANIFEST || !Number.isSafeInteger(item.bytes) || item.bytes < 0 ||
        !/^[a-f0-9]{64}$/.test(item.sha256 || '')) throw Error('Invalid bundle file record');
    const key = item.path.toLowerCase();
    if (seen.has(key)) throw Error('Duplicate or case-colliding manifest path');
    seen.add(key); expected.push(item.path);
    const absolute = safePath(root, item.path);
    if (!fs.lstatSync(absolute).isFile() || fs.statSync(absolute).size !== item.bytes || sha256(absolute) !== item.sha256) {
      throw Error('Bundle file integrity mismatch: ' + item.path);
    }
  }
  const sorted = [...expected].sort();
  if (JSON.stringify(expected) !== JSON.stringify(sorted)) throw Error('Bundle inventory must be sorted');
  const actual = filesUnder(root).filter(relative => relative !== MANIFEST);
  if (JSON.stringify(actual) !== JSON.stringify(sorted)) throw Error('Bundle contains missing or unlisted files');
  return manifest;
}

function buildWindowsBundle() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Windows development bundle requires Windows x64');
  if (!process.env.npm_execpath || !fs.statSync(process.env.npm_execpath).isFile()) throw Error('Run the builder with npm run package:windows');
  const root = path.resolve(__dirname, '..', '..');
  const build = safePath(root, 'build/windows', true); fs.mkdirSync(build, { recursive: true });
  const archive = safePath(root, 'build/windows/PiRaiders-Development-win-x64.zip', true);
  const checksum = safePath(root, 'build/windows/PiRaiders-Development-win-x64.zip.sha256', true);
  const stage = safePath(root, 'build/windows/bundle', true);
  const temporary = fs.mkdtempSync(path.join(build, '.bundle-'));
  const temporaryArchive = safePath(root, 'build/windows/.PiRaiders-Development-' + process.pid + '.zip', true);
  const bundle = path.join(temporary, 'PiRaiders-Development');
  fs.rmSync(archive, { force: true }); fs.rmSync(checksum, { force: true });
  try {
    // Only packaged/build inputs must be clean. Operator files and unrelated
    // documentation do not enter this artifact, whether tracked or untracked.
    const recipes = new Set(['native/windows/JobHost.cs', 'scripts/build-windows-job-host.cjs',
      'scripts/build-windows-bundle.cjs', ...TEMPLATES.map(item => item[0])]);
    const assertClean = () => {
      const changed = execFileSync('git', ['diff', '--name-only', '-z', 'HEAD', '--'], { cwd: root, encoding: 'utf8', shell: false }).split('\0').filter(Boolean);
      if (changed.some(relative => allowedSource(relative) || recipes.has(relative))) throw Error('Packaged source/build inputs must be committed before packaging');
    };
    assertClean();
    const commitSHA = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', shell: false }).trim();
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', shell: false }).split('\0').filter(Boolean);
    for (const [source] of TEMPLATES) if (!tracked.includes(source)) throw Error('Packaging template must be tracked: ' + source);
    const index = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root, encoding: 'utf8', shell: false }).split('\0').filter(Boolean);
    for (const record of index) {
      const relative = record.slice(record.indexOf('\t') + 1);
      if (record.startsWith('120000 ') && (allowedSource(relative) || recipes.has(relative))) throw Error('Tracked symlink input is not allowed');
    }
    const nodeLicense = ['LICENSE', 'LICENSE.txt'].map(name => path.join(path.dirname(process.execPath), name))
      .find(candidate => fs.existsSync(candidate) && fs.lstatSync(candidate).isFile() && !fs.lstatSync(candidate).isSymbolicLink());
    if (!nodeLicense) throw Error('Installed Node runtime license was not found beside node.exe');
    fs.mkdirSync(path.join(bundle, 'app'), { recursive: true });
    const selected = copySourceFiles(root, path.join(bundle, 'app'), tracked);
    for (const required of ['server.js', 'package.json', 'package-lock.json', 'LICENSE.txt', 'locales/english.json',
      'static/js/ograf_functions.js', 'scripts/piraiders-launcher.cjs']) {
      if (!selected.includes(required)) throw Error('Required runtime source missing: ' + required);
    }
    for (const [source, destination] of TEMPLATES) copyFile(root, source, bundle, destination);
    fs.mkdirSync(path.join(bundle, 'runtime')); fs.mkdirSync(path.join(bundle, 'licenses'));
    if (fs.lstatSync(process.execPath).isSymbolicLink()) throw Error('Node runtime must be a regular executable');
    fs.copyFileSync(process.execPath, path.join(bundle, 'runtime', 'node.exe'));
    fs.copyFileSync(nodeLicense, path.join(bundle, 'licenses', 'Node-LICENSE.txt'));
    copyFile(root, 'LICENSE.txt', bundle, 'licenses/SPX-LICENSE.txt');
    execFileSync(process.execPath, [path.join(root, 'scripts', 'build-windows-job-host.cjs')], { cwd: root, stdio: 'inherit', shell: false, windowsHide: true });
    copyFile(root, 'build/windows/PiRaiders.JobHost.exe', bundle, 'app/build/windows/PiRaiders.JobHost.exe');
    execFileSync(process.execPath, [process.env.npm_execpath, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: path.join(bundle, 'app'), stdio: 'inherit', shell: false, windowsHide: true, timeout: 180000
    });
    assertClean();
    const metadata = { commitSHA, spxVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
      node: { version: process.version, platform: process.platform, arch: process.arch } };
    fs.writeFileSync(path.join(bundle, MANIFEST), JSON.stringify(createManifest(bundle, metadata), null, 2) + '\n');
    verifyManifest(bundle);
    // -File arguments are data, not interpolated PowerShell code. Compress only
    // the application directory, producing one named top-level ZIP directory.
    const script = path.join(temporary, 'archive.ps1');
    fs.writeFileSync(script, "param([string]$Source, [string]$Destination)\r\n$ErrorActionPreference = 'Stop'\r\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\r\n[System.IO.Compression.ZipFile]::CreateFromDirectory($Source, $Destination, [System.IO.Compression.CompressionLevel]::Optimal, $true)\r\n");
    fs.rmSync(temporaryArchive, { force: true });
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, bundle, temporaryArchive], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true, timeout: 300000
    });
    fs.rmSync(script, { force: true });
    if (!fs.statSync(temporaryArchive).isFile() || fs.statSync(temporaryArchive).size === 0) throw Error('No ZIP archive produced');
    fs.rmSync(stage, { recursive: true, force: true });
    fs.renameSync(temporary, stage);
    fs.renameSync(temporaryArchive, archive);
    fs.writeFileSync(checksum, sha256(archive) + '  ' + path.basename(archive) + '\n');
    console.log('Built development-only Windows bundle: ' + path.relative(root, archive));
    return { archive, checksum, root: path.join(stage, 'PiRaiders-Development') };
  } catch (error) {
    fs.rmSync(archive, { force: true }); fs.rmSync(checksum, { force: true });
    throw error;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
    fs.rmSync(temporaryArchive, { force: true });
  }
}

module.exports = { selectSourceFiles, copySourceFiles, createManifest, verifyManifest, buildWindowsBundle };
