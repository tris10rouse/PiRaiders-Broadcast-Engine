'use strict';
// These are source-level safeguards, not SPX runtime, browser, CasparCG, NDI, or DMP integration tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('SPX HTML and OGraf runtime entry points still exist', () => {
  assert.match(read('static/js/ograf_functions.js'), /ograf/i);
  assert.match(read('routes/routes-application.js'), /view-renderer/);
  assert.match(read('utils/playout_casparCG.js'), /playoutController/);
});
test('SPX controller keeps existing plugin and socket pathways', () => {
  assert.match(read('server.js'), /hookLoadControllerPlugins/);
  assert.match(read('static/js/spx_gc.js'), /SPXMessage2Client/);
  assert.match(read('views/view-controller.handlebars'), /controllerPluginButtons/);
});
test('Roadmap records separation of iPad and PC operator responsibilities', () => {
  assert.match(read('ROADMAP.md'), /iPad operator/);
  assert.match(read('AGENTS.md'), /never sees or controls PiRaiders UI/i);
});
