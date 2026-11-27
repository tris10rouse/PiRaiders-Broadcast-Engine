'use strict';
// Q-026 (part 1 of Q-023): reading the DLLs a Windows PE file imports, and the
// build-time check that every DLL a bundled runtime file needs is provided by
// the bundle, Windows or Microsoft's VC++ runtime installer. Stand-in PE
// files on Linux; the ZIP build runs the check on the real staged files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { VC_RUNTIME_DLLS, VC_REDIST_FILE, WINDOWS_DLLS, PeError, peImports, checkRuntimeImports } = require('../scripts/lib/pe-imports.cjs');
const { peFile, SECTION_RAW } = require('./fixtures/pe-file.cjs');

const write = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
function runtimeDir(files, { installer = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q026-'));
  if (installer) write(path.join(dir, ...VC_REDIST_FILE.split('/')), 'the installer is never read as a runtime file');
  for (const [name, bytes] of Object.entries(files)) write(path.join(dir, ...name.split('/')), bytes);
  return dir;
}

test('peImports reads the import and delay-load tables, lower case, sorted, once each', () => {
  const bytes = peFile({ imports: ['KERNEL32.dll', 'MSVCP140.dll', 'kernel32.dll', 'libcef.dll'], delayImports: ['d3d12.dll', 'WinUsb.dll'] });
  assert.deepEqual(peImports(bytes), { imports: ['kernel32.dll', 'libcef.dll', 'msvcp140.dll'], delayImports: ['d3d12.dll', 'winusb.dll'] });
  assert.deepEqual(peImports(peFile()), { imports: [], delayImports: [] });
  // PE32 (32-bit) and the old delay-load form whose name is a virtual address.
  assert.deepEqual(peImports(peFile({ plus: false, machine: 0x14c, imports: ['user32.dll'], delayImports: ['winmm.dll'], oldDelay: true })),
    { imports: ['user32.dll'], delayImports: ['winmm.dll'] });
});

test('peImports refuses a file that is not a well-formed PE, or a DLL name that is not a plain name', () => {
  const refused = bytes => assert.throws(() => peImports(bytes), error => error instanceof PeError && error.message === 'RUNTIME_PE_INVALID');
  refused(Buffer.from('cef'));
  refused('not a buffer');
  refused(peFile().subarray(0, 300));
  const magic = peFile(); magic.writeUInt16LE(0x999, 88); refused(magic);
  const signature = peFile(); signature.writeUInt32LE(0, 64); refused(signature);
  // A minimal header with no optional header (the old stand-in shape).
  const bare = Buffer.alloc(256); bare.write('MZ', 0, 'ascii'); bare.writeUInt32LE(64, 60); bare.writeUInt32LE(0x00004550, 64); refused(bare);
  for (const name of ['..\\evil.dll', 'C:/x.dll', 'a\tb.dll', '', 'x'.repeat(200) + '.dll']) refused(peFile({ imports: [name] }));
  // An import table pointing outside every section.
  const outside = peFile({ imports: ['kernel32.dll'] }); outside.writeUInt32LE(0x9000, 88 + 112 + 8); refused(outside);
  // A table or name in the section's zero-filled tail (beyond the bytes the file holds).
  const tail = peFile({ imports: ['kernel32.dll'] }); tail.writeUInt32LE(0x100, 88 + 240 + 16); refused(tail);
  // A name with no end inside the file.
  const endless = peFile({ imports: ['kernel32.dll'] }); endless.fill(0x41, SECTION_RAW + 0x800); refused(endless);
});

test('the Windows and VC++ lists: lower case, frozen, apart; opengl32 is Windows\' own', () => {
  for (const list of [WINDOWS_DLLS, VC_RUNTIME_DLLS]) {
    assert.ok(Object.isFrozen(list));
    for (const name of list) assert.match(name, /^[a-z0-9_]+\.(dll|cpl|drv)$/);
    assert.deepEqual([...list].sort(), [...list]);
  }
  assert.deepEqual(VC_RUNTIME_DLLS, ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']);
  assert.ok(!WINDOWS_DLLS.some(name => VC_RUNTIME_DLLS.includes(name)));
  assert.ok(WINDOWS_DLLS.includes('opengl32.dll') && WINDOWS_DLLS.includes('kernel32.dll'));
  for (const bundled of ['libcef.dll', 'libgallium_wgl.dll', 'glew32.dll', 'tbb12.dll', 'processing.ndi.lib.x64.dll'])
    assert.ok(!WINDOWS_DLLS.includes(bundled), bundled);
  assert.equal(VC_REDIST_FILE, 'vcredist/VC_redist.x64.exe');
});

test('the check passes when the bundle, Windows or the VC++ installer provides every import', () => {
  const dir = runtimeDir({
    'caspar/casparcg.exe': peFile({ imports: ['KERNEL32.dll', 'MSVCP140.dll', 'VCRUNTIME140.dll', 'VCRUNTIME140_1.dll', 'libcef.dll', 'OPENGL32.dll', 'api-ms-win-crt-runtime-l1-1-0.dll'],
      delayImports: ['ext-ms-win-gdi-dc-l1-2-0.dll', 'winspool.drv'] }),
    'caspar/libcef.dll': peFile({ imports: ['chrome_elf.dll'] }),
    'caspar/chrome_elf.dll': peFile({ imports: ['ntdll.dll'] }),
    // A file in a subfolder may use its component's top-folder files.
    'caspar/plugins/x.dll': peFile({ imports: ['libcef.dll'] }),
    'caspar/README.md': 'text files are not read',
    'mesa/opengl32.dll': peFile({ imports: ['libgallium_wgl.dll', 'gdi32.dll'] }),
    'mesa/libgallium_wgl.dll': peFile({ imports: ['version.dll'] }),
    'ndi/Processing.NDI.Lib.x64.dll': peFile({ imports: ['ws2_32.dll', 'd3d11.dll'] })
  });
  assert.deepEqual(checkRuntimeImports(dir), []);
});

test('the check names every import nobody provides: the VC++ DLLs only count with the installer there', () => {
  const files = {
    'caspar/casparcg.exe': peFile({ imports: ['MSVCP140.dll', 'VCRUNTIME140.dll', 'kernel32.dll'] }),
    'caspar/sfml-system-2.dll': peFile({ imports: ['VCRUNTIME140_1.dll'] }),
    'mesa/opengl32.dll': peFile()
  };
  // The Q-018 finding: Caspar's archive lacks the VC++ runtime.
  assert.deepEqual(checkRuntimeImports(runtimeDir(files, { installer: false })), [
    { file: 'caspar/casparcg.exe', dll: 'msvcp140.dll' }, { file: 'caspar/casparcg.exe', dll: 'vcruntime140.dll' },
    { file: 'caspar/sfml-system-2.dll', dll: 'vcruntime140_1.dll' }]);
  assert.deepEqual(checkRuntimeImports(runtimeDir(files)), []);
  // A DLL in neither the bundle, Windows nor the VC++ runtime; a delay-load one too.
  assert.deepEqual(checkRuntimeImports(runtimeDir({ 'caspar/casparcg.exe': peFile({ imports: ['some.dll'], delayImports: ['msvcp140_2.dll'] }) })),
    [{ file: 'caspar/casparcg.exe', dll: 'msvcp140_2.dll' }, { file: 'caspar/casparcg.exe', dll: 'some.dll' }]);
  // Another component's files do not count: Mesa's opengl32.dll is not beside Caspar.
  assert.deepEqual(checkRuntimeImports(runtimeDir({ 'caspar/casparcg.exe': peFile({ imports: ['libgallium_wgl.dll'] }),
    'mesa/libgallium_wgl.dll': peFile() })), [{ file: 'caspar/casparcg.exe', dll: 'libgallium_wgl.dll' }]);
  // A subfolder's own files do not serve the top folder.
  assert.deepEqual(checkRuntimeImports(runtimeDir({ 'caspar/casparcg.exe': peFile({ imports: ['deep.dll'] }),
    'caspar/sub/deep.dll': peFile() })), [{ file: 'caspar/casparcg.exe', dll: 'deep.dll' }]);
});

test('the check refuses a runtime .exe or .dll that is not a PE, naming the file; the installer folder is not read', () => {
  const dir = runtimeDir({ 'caspar/casparcg.exe': peFile(), 'caspar/libEGL.dll': 'cef' });
  assert.throws(() => checkRuntimeImports(dir), error => error instanceof PeError && error.message === 'RUNTIME_PE_INVALID' && error.file === 'caspar/libEGL.dll');
  assert.deepEqual(checkRuntimeImports(runtimeDir({ 'caspar/casparcg.exe': peFile(), 'vcredist/other.dll': 'not a PE' })), []);
});
