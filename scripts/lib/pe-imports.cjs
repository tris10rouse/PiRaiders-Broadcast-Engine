'use strict';
// Q-026 (part 1 of Q-023): which DLLs the bundled Windows runtime files need.
// Reads a PE file's import table and delay-load import table (no code is run,
// nothing is loaded) and checks that every DLL a bundled .exe or .dll imports
// is provided: by a file in its own folder or its component's top folder, by
// Windows itself, or by the Microsoft x64 VC++ runtime that the bundled
// VC_redist.x64.exe installs. The ZIP build refuses anything else with
// RUNTIME_IMPORT_MISSING. Design: docs/design/BUNDLED_RUNTIME.md › VC++ runtime.
const fs = require('node:fs');
const path = require('node:path');

class PeError extends Error {}
const invalid = () => { throw new PeError('RUNTIME_PE_INVALID'); };

// The DLLs of Microsoft's x64 VC++ 2015-2022 runtime that the pinned files
// import (read 2026-11-27: casparcg.exe, the SFML and TBB DLLs and others).
// The bundled VC_redist.x64.exe installs them into the system folder. Only
// these three are trusted to it; another runtime DLL fails the build until it
// is checked and added here.
const VC_RUNTIME_DLLS = Object.freeze(['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']);

// DLLs (and the .cpl and .drv modules) that ship with Windows 10 and later
// x64, lower case. Exactly the names the pinned CasparCG, Mesa and NDI files
// import from Windows (read from the real pinned files on 2026-11-27); a new
// one fails the build until it is checked and added here. opengl32.dll is
// Windows' own: Caspar must load the system copy, never Mesa's.
// api-ms-win-* and ext-ms-* are Windows API sets (the Universal CRT among them).
const WINDOWS_DLLS = Object.freeze([
  'advapi32.dll', 'avicap32.dll', 'avrt.dll', 'bcrypt.dll', 'bcryptprimitives.dll', 'bthprops.cpl', 'cfgmgr32.dll',
  'comctl32.dll', 'comdlg32.dll', 'credui.dll', 'crypt32.dll', 'cryptui.dll', 'd2d1.dll', 'd3d11.dll', 'd3d12.dll',
  'd3d9.dll', 'dbgeng.dll', 'dbghelp.dll', 'dcomp.dll', 'dhcpcsvc.dll', 'dwmapi.dll', 'dwrite.dll', 'dxgi.dll',
  'esent.dll', 'fontsub.dll', 'gdi32.dll', 'hid.dll', 'imm32.dll', 'iphlpapi.dll', 'kernel32.dll', 'mf.dll',
  'mfplat.dll', 'mfreadwrite.dll', 'mmdevapi.dll', 'msimg32.dll', 'msvcrt.dll', 'mswsock.dll', 'ncrypt.dll',
  'ndfapi.dll', 'netapi32.dll', 'ntdll.dll', 'ole32.dll', 'oleacc.dll', 'oleaut32.dll', 'opengl32.dll', 'pdh.dll',
  'propsys.dll', 'rpcrt4.dll', 'secur32.dll', 'setupapi.dll', 'shell32.dll', 'shlwapi.dll', 'uiautomationcore.dll',
  'urlmon.dll', 'user32.dll', 'userenv.dll', 'uxtheme.dll', 'version.dll', 'wevtapi.dll', 'winhttp.dll',
  'wininet.dll', 'winmm.dll', 'winspool.drv', 'wintrust.dll', 'winusb.dll', 'ws2_32.dll', 'wtsapi32.dll'
]);
const isWindowsDll = name => WINDOWS_DLLS.includes(name) || /^(api|ext)-ms-[a-z0-9-]+\.dll$/.test(name);

// A DLL name as the import table spells it: plain printable ASCII, no path.
const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.+ -]{0,126}$/;

// The DLL names a PE file imports, lower case, sorted, no repeats:
// { imports, delayImports }. Throws RUNTIME_PE_INVALID on anything malformed.
function peImports(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') invalid();
  const pe = bytes.readUInt32LE(60);
  if (pe < 64 || pe > bytes.length - 24 || bytes.readUInt32LE(pe) !== 0x00004550) invalid();
  const sections = bytes.readUInt16LE(pe + 6), optionalSize = bytes.readUInt16LE(pe + 20);
  const opt = pe + 24;
  if (optionalSize < 2 || opt + optionalSize > bytes.length || sections > 96) invalid();
  const magic = bytes.readUInt16LE(opt);
  const plus = magic === 0x20b;
  if (!plus && magic !== 0x10b) invalid();
  const countAt = opt + (plus ? 108 : 92), dirs = opt + (plus ? 112 : 96);
  if (countAt + 4 > opt + optionalSize) invalid();
  const count = Math.min(bytes.readUInt32LE(countAt), 16);
  if (dirs + count * 8 > opt + optionalSize) invalid();
  const imageBase = plus ? bytes.readBigUInt64LE(opt + 24) : BigInt(bytes.readUInt32LE(opt + 28));
  const table = opt + optionalSize;
  if (table + sections * 40 > bytes.length) invalid();
  const offset = rva => {
    for (let i = 0; i < sections; i++) {
      const at = table + i * 40;
      const rawSize = bytes.readUInt32LE(at + 16), size = Math.max(bytes.readUInt32LE(at + 8), rawSize);
      const va = bytes.readUInt32LE(at + 12), raw = bytes.readUInt32LE(at + 20);
      if (rva >= va && rva < va + size) {
        // Only bytes the file holds: a table in a section's zero-filled tail is refused.
        const file = raw + (rva - va);
        if (rva - va >= rawSize || file >= bytes.length) invalid();
        return file;
      }
    }
    invalid();
  };
  const name = rva => {
    const start = offset(rva), end = bytes.indexOf(0, start);
    if (end < 0 || end - start > 127) invalid();
    const text = bytes.toString('latin1', start, end);
    if (!NAME.test(text)) invalid();
    return text.toLowerCase();
  };
  const directory = index => index < count ? { rva: bytes.readUInt32LE(dirs + index * 8), size: bytes.readUInt32LE(dirs + index * 8 + 4) } : { rva: 0, size: 0 };
  const read = (index, entrySize, nameAt, isEnd, nameRva) => {
    const dir = directory(index), out = new Set();
    if (!dir.rva) return [];
    for (let i = 0; i < 4096; i++) {
      const at = offset(dir.rva + i * entrySize);
      if (at + entrySize > bytes.length) invalid();
      if (isEnd(at)) return [...out].sort();
      out.add(name(nameRva(at, bytes.readUInt32LE(at + nameAt))));
    }
    invalid();
  };
  const imports = read(1, 20, 12, at => bytes.readUInt32LE(at + 12) === 0 && bytes.readUInt32LE(at + 16) === 0, (at, rva) => rva);
  // Delay-load descriptors: bit 0 of the attributes clear means the old form,
  // whose name is a virtual address rather than a relative one.
  const delayImports = read(13, 32, 4, at => bytes.readUInt32LE(at + 4) === 0, (at, value) => {
    if (bytes.readUInt32LE(at) & 1) return value;
    const relative = BigInt(value) - imageBase;
    if (relative < 0n || relative > 0xffffffffn) invalid();
    return Number(relative);
  });
  return { imports, delayImports };
}

// Regular files under dir as forward-slash relative paths.
function filesUnder(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, ...prefix.split('/').filter(Boolean)), { withFileTypes: true })) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) out.push(...filesUnder(dir, relative));
    else if (entry.isFile()) out.push(relative);
  }
  return out.sort();
}

// The installer's place in the runtime folder (ZIP: runtime/vcredist/).
const VC_REDIST_FILE = 'vcredist/VC_redist.x64.exe';

// runtimeDir: a folder holding one subfolder per component (caspar/, mesa/,
// ndi/, ...). skip: top-level folders not loaded by the app (the VC++
// installer is run by Setup, never loaded). The VC++ runtime DLLs count as
// provided only when the installer that provides them is there. Returns [{ file, dll }] for every
// import nobody provides, sorted; empty when all are provided. A malformed PE
// throws RUNTIME_PE_INVALID with its file in `file`.
function checkRuntimeImports(runtimeDir, { skip = ['vcredist'] } = {}) {
  const all = filesUnder(runtimeDir);
  const vcRuntime = all.some(file => file.toLowerCase() === VC_REDIST_FILE.toLowerCase()) ? VC_RUNTIME_DLLS : [];
  const files = all.filter(file => file.includes('/') && !skip.includes(file.split('/')[0]));
  const lower = files.map(file => file.toLowerCase());
  const folderOf = file => file.slice(0, file.lastIndexOf('/') + 1);
  const missing = [];
  for (const file of files) {
    if (!/\.(exe|dll)$/i.test(file)) continue;
    let found;
    try { found = peImports(fs.readFileSync(path.join(runtimeDir, ...file.split('/')))); }
    catch (error) { if (error instanceof PeError) { error.file = file; } throw error; }
    const own = folderOf(file.toLowerCase()), top = file.toLowerCase().split('/')[0] + '/';
    for (const dll of new Set([...found.imports, ...found.delayImports])) {
      if (vcRuntime.includes(dll) || isWindowsDll(dll)) continue;
      if (lower.includes(own + dll) || lower.includes(top + dll)) continue;
      missing.push({ file, dll });
    }
  }
  return missing.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : a.dll < b.dll ? -1 : 1);
}

module.exports = { VC_RUNTIME_DLLS, VC_REDIST_FILE, WINDOWS_DLLS, PeError, peImports, checkRuntimeImports };
