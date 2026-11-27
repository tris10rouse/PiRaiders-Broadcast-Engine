'use strict';
// Q-017 (part 1 of Q-016): the one list of third-party runtime components the
// Windows ZIP will carry, the notices written from it and the layout rule that
// keeps Mesa's opengl32.dll away from the Caspar executable that uses the GPU.
const test = require('node:test');
const assert = require('node:assert/strict');
const components = require('../scripts/lib/bundled-components.cjs');
const casparProof = require('../scripts/prepare-caspar-proof.cjs');
const ndiProof = require('../scripts/prepare-ndi-proof.cjs');

const { COMPONENTS, NDI_TRADEMARK, NDI_LINK, renderNotices, checkRuntimeLayout } = components;
const byId = id => COMPONENTS.find(item => item.id === id);

test('the list names CasparCG 2.5.1, Mesa 26.2.6 and the NDI 6 runtime, each pinned by SHA-256', () => {
  assert.deepEqual(COMPONENTS.map(item => item.id), ['casparcg', 'mesa', 'ndi-runtime']);
  for (const item of COMPONENTS) {
    assert.match(item.sha256, /^[a-f0-9]{64}$/);
    assert.match(item.url, /^https:\/\//);
    assert.ok(item.licence && item.version && item.folder.startsWith('runtime/'));
    assert.ok(Object.isFrozen(item));
  }
  assert.equal(byId('casparcg').version, '2.5.1-stable');
  assert.equal(byId('mesa').version, '26.2.6');
  assert.equal(byId('ndi-runtime').version, '6.4.0.2');
  assert.equal(byId('ndi-runtime').files.join(), 'Processing.NDI.Lib.x64.dll');
  assert.ok(Object.isFrozen(COMPONENTS));
});

test('the CI proofs download exactly the pins the ZIP will carry (they must agree)', () => {
  const caspar = casparProof.PINS.find(pin => pin.name === 'caspar');
  const mesa = casparProof.PINS.find(pin => pin.name === 'mesa');
  assert.equal(caspar.url, byId('casparcg').url); assert.equal(caspar.sha256, byId('casparcg').sha256);
  assert.equal(mesa.url, byId('mesa').url); assert.equal(mesa.sha256, byId('mesa').sha256);
  assert.equal(ndiProof.PIN.url, byId('ndi-runtime').url);
  assert.equal(ndiProof.PIN.sha256, byId('ndi-runtime').sha256);
});

test('Caspar is GPL v3 or later with a link to its exact corresponding source', () => {
  const caspar = byId('casparcg');
  assert.equal(caspar.licence, 'GPL-3.0-or-later');
  assert.equal(caspar.source, 'https://github.com/CasparCG/server/tree/v2.5.1-stable');
});

test('notices list every component with version, licence, SHA-256, folder and the NDI attribution', () => {
  const text = renderNotices();
  assert.match(text, /^# Third-party notices/m);
  for (const item of COMPONENTS) {
    assert.ok(text.includes(item.name), item.id);
    assert.ok(text.includes(item.version), item.id);
    assert.ok(text.includes(item.licence), item.id);
    assert.ok(text.includes(item.sha256), item.id);
    assert.ok(text.includes(item.folder + '/'), item.id);
  }
  assert.ok(text.includes('https://github.com/CasparCG/server/tree/v2.5.1-stable'));
  assert.ok(text.includes(NDI_TRADEMARK));
  assert.equal(NDI_TRADEMARK, 'NDI® is a registered trademark of Vizrt NDI AB.');
  assert.ok(text.includes(NDI_LINK));
  assert.equal(NDI_LINK, 'https://ndi.video');
  // The mark carries ® on its first use only (and in the trademark sentence).
  assert.equal(text.indexOf('NDI®'), text.indexOf('NDI'));
  assert.equal(text.split('NDI®').length - 1, 2);
  assert.doesNotMatch(text, /\r/);
  assert.equal(renderNotices(), text, 'the same text every time');
});

test('notices refuse an empty or invalid component list', () => {
  assert.throws(() => renderNotices([]), /COMPONENTS_EMPTY/);
  assert.throws(() => renderNotices([{ ...byId('mesa'), sha256: 'nothex' }]), /COMPONENT_INVALID/);
  assert.throws(() => renderNotices([{ ...byId('mesa'), folder: '../mesa' }]), /COMPONENT_INVALID/);
  // Review round: nothing may add a line or a heading, or print a non-text file entry.
  for (const change of [{ files: [1, {}] }, { files: [''] }, { url: 'https://x\n# injected' }, { name: 'Mesa\n## x' },
    { note: 'a\rb' }, { version: ' ' }, { sha256: [byId('mesa').sha256] }, { source: 'https://x\ny' }, { licence: ' MIT' }]) {
    assert.throws(() => renderNotices([{ ...byId('mesa'), ...change }]), /COMPONENT_INVALID/, JSON.stringify(change));
  }
  assert.throws(() => renderNotices([byId('mesa'), byId('mesa')]), /COMPONENT_INVALID/);
  assert.throws(() => renderNotices([byId('mesa'), { ...byId('casparcg'), folder: 'runtime/mesa' }]), /COMPONENT_INVALID/);
});

test('layout: Mesa opengl32.dll beside a casparcg.exe is refused, in any letter case', () => {
  const rest = ['runtime/mesa/opengl32.dll', 'runtime/ndi/Processing.NDI.Lib.x64.dll'];
  assert.deepEqual(checkRuntimeLayout(['runtime/caspar/casparcg.exe', 'runtime/caspar/libcef.dll',
    'runtime/mesa/libgallium_wgl.dll', ...rest]), []);
  assert.deepEqual(checkRuntimeLayout(['runtime/caspar/casparcg.exe', 'runtime/caspar/OpenGL32.DLL', ...rest]),
    ['MESA_BESIDE_CASPAR']);
  assert.deepEqual(checkRuntimeLayout(['runtime/caspar/bin/CasparCG.exe', 'runtime/caspar/bin/opengl32.dll', ...rest]),
    ['MESA_BESIDE_CASPAR']);
  // opengl32.dll elsewhere in the Caspar tree is not beside the executable.
  assert.deepEqual(checkRuntimeLayout(['runtime/caspar/casparcg.exe', 'runtime/caspar/other/opengl32.dll', ...rest]), []);
});

test('layout: one Caspar executable, Mesa and the NDI runtime each in their own folder', () => {
  assert.deepEqual(checkRuntimeLayout(['runtime/mesa/opengl32.dll', 'runtime/ndi/Processing.NDI.Lib.x64.dll']),
    ['CASPAR_MISSING']);
  assert.deepEqual(checkRuntimeLayout(['runtime/caspar/casparcg.exe', 'runtime/caspar/b/casparcg.exe',
    'runtime/mesa/opengl32.dll', 'runtime/ndi/Processing.NDI.Lib.x64.dll']), ['CASPAR_NOT_UNIQUE']);
  assert.deepEqual(checkRuntimeLayout(['runtime/caspar/casparcg.exe', 'runtime/ndi/Processing.NDI.Lib.x64.dll']),
    ['MESA_MISSING']);
  assert.deepEqual(checkRuntimeLayout(['runtime/caspar/casparcg.exe', 'runtime/mesa/opengl32.dll']),
    ['NDI_RUNTIME_MISSING']);
  // NDI's distribution page: keep the DLL in the application's folders, never the system path.
  assert.deepEqual(checkRuntimeLayout(['runtime/caspar/casparcg.exe', 'runtime/caspar/Processing.NDI.Lib.x64.dll',
    'runtime/mesa/opengl32.dll']), ['NDI_RUNTIME_MISSING']);
  assert.throws(() => checkRuntimeLayout('runtime/caspar/casparcg.exe'), /LAYOUT_INVALID/);
  assert.throws(() => checkRuntimeLayout(['runtime\\caspar\\casparcg.exe']), /LAYOUT_INVALID/);
});

test('layout: other spellings of a folder or file name are refused, never judged', () => {
  const rest = ['runtime/mesa/opengl32.dll', 'runtime/ndi/Processing.NDI.Lib.x64.dll'];
  for (const odd of ['runtime/caspar//opengl32.dll', 'runtime/caspar/./opengl32.dll', 'runtime/caspar/opengl32.dll.',
    'runtime/caspar/opengl32.dll ', 'runtime/caspar/x/../opengl32.dll', '/runtime/caspar/opengl32.dll',
    './runtime/caspar/casparcg.exe', 'runtime/caspar/a:b', 'runtime/caspar/a\u0000b', '']) {
    assert.throws(() => checkRuntimeLayout(['runtime/caspar/casparcg.exe', odd, ...rest]), /LAYOUT_INVALID/, JSON.stringify(odd));
  }
});
