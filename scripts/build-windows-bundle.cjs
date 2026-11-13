#!/usr/bin/env node
'use strict';
const { buildWindowsBundle } = require('./lib/windows-bundle.cjs');
if (require.main === module) {
  try { buildWindowsBundle(); }
  catch (error) { console.error('Windows development bundle failed: ' + error.message); process.exitCode = 1; }
}
module.exports = { buildWindowsBundle };
