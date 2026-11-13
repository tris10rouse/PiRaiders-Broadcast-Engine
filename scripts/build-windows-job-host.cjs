#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build', 'windows', 'PiRaiders.JobHost.exe');

function buildWindowsJobHost() {
  if (process.platform !== 'win32') throw Error('Windows JobHost must be built on Windows using the installed .NET Framework compiler');
  const windows = process.env.SystemRoot || process.env.WINDIR;
  if (!windows || !path.isAbsolute(windows)) throw Error('Windows system directory is unavailable');
  const compiler = ['Framework64', 'Framework'].map(folder => path.join(windows, 'Microsoft.NET', folder, 'v4.0.30319', 'csc.exe'))
    .find(file => fs.existsSync(file));
  if (!compiler) throw Error('Installed .NET Framework v4 C# compiler was not found; Windows containment cannot be built');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  // A failed build must not leave an old binary looking like fresh validation.
  fs.rmSync(output, { force: true });
  const temporary = path.join(path.dirname(output), 'PiRaiders.JobHost.' + process.pid + '.exe');
  try {
    execFileSync(compiler, ['/nologo', '/target:exe', '/optimize+', '/debug-', '/platform:anycpu', '/warn:4',
      '/out:' + temporary, path.join(root, 'native', 'windows', 'JobHost.cs')], {
      cwd: root, stdio: 'inherit', shell: false, windowsHide: true, timeout: 60000
    });
    if (!fs.statSync(temporary).isFile()) throw Error('Compiler produced no Windows JobHost executable');
    fs.renameSync(temporary, output);
    console.log('Built Windows containment host: ' + path.relative(root, output));
    return output;
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
if (require.main === module) {
  try { buildWindowsJobHost(); }
  catch (error) { console.error('Windows JobHost build failed: ' + error.message); process.exitCode = 1; }
}
module.exports = { buildWindowsJobHost, output };
