'use strict';
// Q-026: stand-in Windows PE files for Linux tests. A minimal but well-formed
// PE (PE32+ by default): MZ header, PE signature, machine, one section that
// holds the import table, the delay-load table and the DLL names, and an
// optional VS_FIXEDFILEINFO version. Nothing here is ever run.
const SECTION_VA = 0x1000, SECTION_RAW = 0x400, IMAGE_BASE = 0x140000000n;

function peFile({ machine = 0x8664, version = [6, 4, 0, 2], imports = [], delayImports = [], plus = true, oldDelay = false } = {}) {
  const bytes = Buffer.alloc(SECTION_RAW + 0x1000);
  bytes.write('MZ', 0, 'ascii'); bytes.writeUInt32LE(64, 60);
  const pe = 64, opt = pe + 24, optionalSize = plus ? 240 : 224;
  bytes.writeUInt32LE(0x00004550, pe); bytes.writeUInt16LE(machine, pe + 4);
  bytes.writeUInt16LE(1, pe + 6); bytes.writeUInt16LE(optionalSize, pe + 20);
  bytes.writeUInt16LE(plus ? 0x20b : 0x10b, opt);
  if (plus) bytes.writeBigUInt64LE(IMAGE_BASE, opt + 24); else bytes.writeUInt32LE(0x400000, opt + 28);
  bytes.writeUInt32LE(16, opt + (plus ? 108 : 92));
  const dirs = opt + (plus ? 112 : 96);
  const table = opt + optionalSize;
  bytes.write('.idata', table, 'ascii');
  bytes.writeUInt32LE(0x1000, table + 8); bytes.writeUInt32LE(SECTION_VA, table + 12);
  bytes.writeUInt32LE(0x1000, table + 16); bytes.writeUInt32LE(SECTION_RAW, table + 20);
  // Section layout: import descriptors, then delay descriptors, then names.
  let names = 0x800;
  const nameRva = text => { const rva = SECTION_VA + names; bytes.write(text + '\0', SECTION_RAW + names, 'latin1'); names += text.length + 1; return rva; };
  if (imports.length) {
    bytes.writeUInt32LE(SECTION_VA, dirs + 8); bytes.writeUInt32LE((imports.length + 1) * 20, dirs + 12);
    imports.forEach((name, i) => {
      const at = SECTION_RAW + i * 20;
      bytes.writeUInt32LE(nameRva(name), at + 12); bytes.writeUInt32LE(SECTION_VA + 0x700, at + 16);
    });
  }
  if (delayImports.length) {
    const start = 0x400;
    bytes.writeUInt32LE(SECTION_VA + start, dirs + 13 * 8); bytes.writeUInt32LE((delayImports.length + 1) * 32, dirs + 13 * 8 + 4);
    const base = plus ? IMAGE_BASE : 0x400000n;
    delayImports.forEach((name, i) => {
      const at = SECTION_RAW + start + i * 32, rva = nameRva(name);
      bytes.writeUInt32LE(oldDelay ? 0 : 1, at);
      bytes.writeUInt32LE(oldDelay ? Number(BigInt(rva) + base) : rva, at + 4);
    });
  }
  if (version) {
    const at = table + 40 + 8;
    bytes.writeUInt32LE(0xfeef04bd, at); bytes.writeUInt32LE(0x00010000, at + 4);
    bytes.writeUInt32LE((version[0] << 16 | version[1]) >>> 0, at + 8); bytes.writeUInt32LE((version[2] << 16 | version[3]) >>> 0, at + 12);
  }
  return bytes;
}

module.exports = { peFile, SECTION_RAW, SECTION_VA };
