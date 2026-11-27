#!/usr/bin/env node
'use strict';
// Q-018: the pinned CasparCG, Mesa and NDI runtime are downloaded, checked and
// staged first (scripts/bundle-runtime.cjs); the ZIP build refuses to run
// without that stage.
const { buildWindowsBundle } = require('./lib/windows-bundle.cjs');
if (require.main === module) {
  (async () => {
    const { main: stageRuntime } = require('./bundle-runtime.cjs');
    const runtimeStage = await stageRuntime();
    buildWindowsBundle({ runtimeStage });
  })().catch(error => {
    const code = /^[A-Z][A-Z0-9_]{1,80}$/.test(error?.message) ? error.message : error?.message;
    console.error('Windows development bundle failed: ' + code); process.exitCode = 1;
  });
}
module.exports = { buildWindowsBundle };
