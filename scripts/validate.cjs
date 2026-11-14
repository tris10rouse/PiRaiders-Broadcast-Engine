#!/usr/bin/env node
'use strict';
// Cross-platform setup/validation with no dependency on shell glob expansion.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const mode = process.argv[2];
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
function filesIn(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(dir, entry.name);
    return entry.isDirectory() ? filesIn(relative) : [relative];
  });
}
function check() {
  const files = ['server.js', 'routes/routes-api-v1.js', 'static/js/spx_gc.js', 'static/js/ograf_functions.js',
    'ASSETS/templates/softpix/ograf/Template_Pack_1.4.0/INFO_LEFT.mjs',
    ...filesIn('ASSETS/templates/piraiders/slideshow'),
    ...filesIn('scripts'), ...filesIn('tests')].filter(file => /\.(?:cjs|mjs|js)$/.test(file));
  for (const file of files) run(['--check', file]);
  console.log('Syntax checks passed (' + files.length + ' files).');
}
function test() {
  const files = filesIn('tests').filter(file => /\.test\.(?:cjs|mjs|js)$/.test(file)).sort();
  if (!files.length) throw Error('No test suites found');
  run(['--test', ...files]);
}
try {
  if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Node 22 or newer required; CI uses Node 22');
  if (mode === 'setup') {
    // npm supplies its own CLI path on both Windows and Linux. No token required.
    if (!process.env.npm_execpath) throw Error('Run setup using npm run setup');
    run([process.env.npm_execpath, 'ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    if (process.platform === 'win32') run(['scripts/build-windows-job-host.cjs']);
    check(); test();
  } else if (mode === 'check') check();
  else if (mode === 'test') test();
  else throw Error('Use npm run setup, npm run check or npm test');
} catch (error) {
  console.error('Validation failed: ' + error.message);
  process.exitCode = 1;
}
