'use strict';
// Q-017 (part 1 of Q-016): the third-party runtime components the Windows ZIP
// is to carry (owner's decision, 2026-11-27: he accepts their licences; bundle,
// no proposal). One frozen list: what each one is, where it comes from, the
// SHA-256 its download must have, its licence and the ZIP folder it goes in.
// The CI proofs keep their own pins; tests/bundled-components.test.cjs fails
// if they ever disagree with this list. Design: docs/design/BUNDLED_RUNTIME.md.
// Nothing here downloads, installs or runs anything.

const NDI_TRADEMARK = 'NDI® is a registered trademark of Vizrt NDI AB.';
const NDI_LINK = 'https://ndi.video';

const COMPONENTS = Object.freeze([
  Object.freeze({
    id: 'casparcg', name: 'CasparCG Server', version: '2.5.1-stable',
    url: 'https://github.com/CasparCG/server/releases/download/v2.5.1-stable/casparcg-server-v2.5.1-windows.zip',
    sha256: 'c0756f53f49908fba94f17a43b83d45fd275201e24ab1676530d7bb26832efc6',
    licence: 'GPL-3.0-or-later', folder: 'runtime/caspar',
    source: 'https://github.com/CasparCG/server/tree/v2.5.1-stable',
    files: Object.freeze(['the official Windows release archive, unchanged']),
    note: 'Its licence text is in licenses/CasparCG-LICENSE.txt. Its exact corresponding source is the upstream tag v2.5.1-stable at the Source link.'
  }),
  Object.freeze({
    id: 'mesa', name: 'Mesa 3D for Windows (MinGW build)', version: '26.2.6',
    url: 'https://github.com/pal1000/mesa-dist-win/releases/download/26.2.6/mesa3d-26.2.6-release-mingw.7z',
    sha256: 'da0f71d9181b672c1918f3c342f11118c687f6059a46b16502845160733cc388',
    licence: 'MIT (with the further notices in licenses/Mesa/)', folder: 'runtime/mesa',
    source: 'https://github.com/pal1000/mesa-dist-win/tree/26.2.6',
    files: Object.freeze(['the x64 OpenGL files only']),
    note: 'The software renderer, used only when this PC\'s graphics driver does not give OpenGL 4.5. It is kept in its own folder, never beside the Caspar executable that uses the graphics card.'
  }),
  Object.freeze({
    id: 'ndi-runtime', name: 'NDI® 6 Runtime', version: '6.4.0.2',
    url: 'https://downloads.ndi.tv/SDK/NDI_SDK/NDI%206%20Runtime.exe',
    sha256: '5972cca54649039318ff5f167fd9940270cafc09678b01e0c35695382270a144',
    licence: 'NDI SDK License Agreement (proprietary)', folder: 'runtime/ndi',
    source: null,
    files: Object.freeze(['Processing.NDI.Lib.x64.dll']),
    note: 'The SHA-256 is that of the vendor\'s runtime installer the DLL is taken from at build time. NDI Tools are not included. ' +
      'The licence terms are in licenses/NDI/. ' + NDI_TRADEMARK + ' More about NDI: ' + NDI_LINK
  })
]);

const SAFE_FOLDER = /^runtime\/[a-z][a-z0-9-]*$/;
function validComponent(item) {
  return item && typeof item === 'object' && typeof item.id === 'string' && /^[a-z][a-z0-9-]*$/.test(item.id) &&
    typeof item.name === 'string' && item.name && typeof item.version === 'string' && item.version &&
    typeof item.licence === 'string' && item.licence && /^[a-f0-9]{64}$/.test(item.sha256 || '') &&
    typeof item.url === 'string' && item.url.startsWith('https://') && SAFE_FOLDER.test(item.folder || '') &&
    Array.isArray(item.files) && item.files.length > 0 && typeof item.note === 'string' &&
    (item.source === null || (typeof item.source === 'string' && item.source.startsWith('https://')));
}

// THIRD-PARTY-NOTICES.md for the ZIP's root. Same text for the same list.
// NDI carries ® on its first use only; the trademark sentence follows it.
function renderNotices(list = COMPONENTS) {
  if (!Array.isArray(list) || !list.length) throw Error('COMPONENTS_EMPTY');
  if (!list.every(validComponent)) throw Error('COMPONENT_INVALID');
  const lines = ['# Third-party notices', '',
    'This development ZIP carries the third-party runtime components below, each at a pinned version whose download was checked against the SHA-256 shown before it was used. Nothing is downloaded when the app runs. Licence texts are in the licenses/ folder. The Node.js runtime, SPX and the image decoders keep their own licence files there too.', ''];
  for (const item of list) {
    lines.push('## ' + item.name + ' ' + item.version, '',
      '- Folder: `' + item.folder + '/`',
      '- Files: ' + item.files.join(', '),
      '- Licence: ' + item.licence,
      '- Download: ' + item.url,
      '- SHA-256: `' + item.sha256 + '`');
    if (item.source) lines.push('- Source: ' + item.source);
    lines.push('', item.note, '');
  }
  return lines.join('\n');
}

// Bundle-relative paths under runtime/ (forward slashes). Returns fixed codes,
// empty when the layout is right. Windows loads opengl32.dll from the
// executable's own folder before the system's, so Mesa's copy there would
// replace the graphics driver for Caspar: refused (Q-016 criterion 3).
function checkRuntimeLayout(paths) {
  if (!Array.isArray(paths) || !paths.every(p => typeof p === 'string' && p && !p.includes('\\'))) throw Error('LAYOUT_INVALID');
  const lower = paths.map(p => p.toLowerCase());
  const dir = p => p.slice(0, p.lastIndexOf('/') + 1);
  const name = p => p.slice(p.lastIndexOf('/') + 1);
  const problems = [];
  const caspar = lower.filter(p => p.startsWith('runtime/caspar/') && name(p) === 'casparcg.exe');
  if (!caspar.length) problems.push('CASPAR_MISSING');
  else if (caspar.length > 1) problems.push('CASPAR_NOT_UNIQUE');
  const casparDirs = new Set(caspar.map(dir));
  if (lower.some(p => name(p) === 'opengl32.dll' && casparDirs.has(dir(p)))) problems.push('MESA_BESIDE_CASPAR');
  if (!lower.includes('runtime/mesa/opengl32.dll')) problems.push('MESA_MISSING');
  if (!lower.includes('runtime/ndi/processing.ndi.lib.x64.dll')) problems.push('NDI_RUNTIME_MISSING');
  return problems;
}

module.exports = { COMPONENTS, NDI_TRADEMARK, NDI_LINK, renderNotices, checkRuntimeLayout };
