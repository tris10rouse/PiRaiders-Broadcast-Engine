'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const { validateImage, MAX_INPUT_BYTES } = require('../scripts/lib/image-validator.cjs');
const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 128, 255, 255, 255, 255]);
const png = PNG.sync.write({ width: 2, height: 2, data: pixels });
const jpg = jpeg.encode({ width: 2, height: 2, data: pixels }, 90).data;
// Generated once from an original solid-color 2x2 image, not copied artwork.
// Progressive SOF2/multiple scans; no fixture-generation native dependency.
const progressive = Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAL/xAAUAQEAAAAAAAAAAAAAAAAAAAAF/9oADAMBAAIQAxAAAAGg8P8A/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD7/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=', 'base64');
function crc(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = value & 1 ? value >>> 1 ^ 0xedb88320 : value >>> 1; } return (value ^ 0xffffffff) >>> 0; }
function chunk(name, data) {
  const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); result.write(name, 4, 'ascii'); data.copy(result, 8);
  result.writeUInt32BE(crc(result.subarray(4, -4)), result.length - 4); return result;
}
function patchHeader(buffer, callback) {
  const result = Buffer.from(buffer); callback(result.subarray(16, 29)); result.writeUInt32BE(crc(result.subarray(12, 29)), 29); return result;
}
function indexedPng() {
  const header = Buffer.alloc(13); header.writeUInt32BE(2, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 3;
  return Buffer.concat([png.subarray(0, 8), chunk('IHDR', header), chunk('PLTE', Buffer.from([255, 0, 0, 0, 255, 0])),
    chunk('tRNS', Buffer.from([255, 0])), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 0, 1]))), chunk('IEND', Buffer.alloc(0))]);
}
test('full pixel decoding accepts truecolor alpha and palette transparency PNG, baseline and progressive JPEG', async () => {
  for (const [buffer, extension, format, width, height] of [[png, '.PNG', 'png', 2, 2], [indexedPng(), 'png', 'png', 2, 1],
    [jpg, '.jpg', 'jpeg', 2, 2], [progressive, '.jpeg', 'jpeg', 2, 2]]) {
    const before = Buffer.from(buffer), result = await validateImage(buffer, { extension });
    assert.deepEqual(result, { format, width, height }); assert.ok(Object.isFrozen(result)); assert.deepEqual(buffer, before);
  }
});
test('unsupported formats, magic mismatch, input limit and invalid option boundaries reject before decoding', async () => {
  await assert.rejects(validateImage(png, { extension: '.gif' }), { code: 'UNSUPPORTED_IMAGE' });
  await assert.rejects(validateImage(png, { extension: '.jpg' }), { code: 'IMAGE_FORMAT_MISMATCH' });
  await assert.rejects(validateImage(Buffer.from('not an image'), { extension: '.png' }), { code: 'INVALID_IMAGE' });
  await assert.rejects(validateImage(Buffer.alloc(MAX_INPUT_BYTES + 1), { extension: '.png' }), { code: 'IMAGE_TOO_LARGE' });
  await assert.rejects(validateImage(png, null), { code: 'INVALID_OPTIONS' });
  for (const options of [{ maxPixels: 0 }, { maxPixels: 16777217 }, { maxDimension: 8193 }, { timeoutMs: 0 }, { timeoutMs: 60001 }, { maxMemoryUsageInMB: 0 }, { signal: {} }]) {
    await assert.rejects(validateImage(png, { extension: '.png', ...options }), { code: 'INVALID_OPTIONS' });
  }
});
test('headers and truncated compressed images never count as validated snapshots', async () => {
  for (const [buffer, extension] of [[png, '.png'], [jpg, '.jpg'], [progressive, '.jpeg']]) {
    for (const length of [16, Math.floor(buffer.length / 2), buffer.length - 2]) {
      await assert.rejects(validateImage(buffer.subarray(0, length), { extension }), error => ['INVALID_IMAGE', 'IMAGE_DECODE_FAILED'].includes(error.code));
    }
  }
  let offset = 2;
  while (jpg[offset + 1] !== 218) offset += 2 + jpg.readUInt16BE(offset + 2);
  const entropyStart = offset + 2 + jpg.readUInt16BE(offset + 2);
  const earlyEOI = Buffer.concat([jpg.subarray(0, entropyStart), Buffer.from([255, 217])]);
  await assert.rejects(validateImage(earlyEOI, { extension: '.jpg' }), { code: 'IMAGE_DECODE_FAILED' });
});
test('PNG validates CRC even on unknown ancillary chunks and rejects invalid compressed content', async () => {
  const ancillary = chunk('tEXt', Buffer.from('test\0value')); ancillary[ancillary.length - 1] ^= 1;
  await assert.rejects(validateImage(Buffer.concat([png.subarray(0, 33), ancillary, png.subarray(33)]), { extension: '.png' }), { code: 'INVALID_IMAGE' });
  const corrupt = Buffer.from(png); corrupt[corrupt.length - 1] ^= 1;
  await assert.rejects(validateImage(corrupt, { extension: '.png' }), { code: 'INVALID_IMAGE' });
  const invalidStream = Buffer.concat([png.subarray(0, 33), chunk('IDAT', Buffer.from([1, 2, 3, 4])), chunk('IEND', Buffer.alloc(0))]);
  await assert.rejects(validateImage(invalidStream, { extension: '.png' }), { code: 'IMAGE_DECODE_FAILED' });
  const extraCompressed = Buffer.concat([png.subarray(0, 33), chunk('IDAT', Buffer.concat([zlib.deflateSync(Buffer.alloc(18)), Buffer.from('junk')])), chunk('IEND', Buffer.alloc(0))]);
  await assert.rejects(validateImage(extraCompressed, { extension: '.png' }), { code: 'INVALID_IMAGE' });
});
test('APNG and interlaced PNG explicitly reject, including well-formed unsupported metadata', async () => {
  await assert.rejects(validateImage(patchHeader(png, header => { header[12] = 1; }), { extension: '.png' }), { code: 'UNSUPPORTED_IMAGE' });
  const actl = Buffer.alloc(8); actl.writeUInt32BE(1);
  await assert.rejects(validateImage(Buffer.concat([png.subarray(0, 33), chunk('acTL', actl), png.subarray(33)]), { extension: '.png' }), { code: 'UNSUPPORTED_IMAGE' });
});
test('dimension and memory limits are enforced before allocating full pixel output', async () => {
  await assert.rejects(validateImage(png, { extension: '.png', maxPixels: 3 }), { code: 'IMAGE_DIMENSION_LIMIT' });
  await assert.rejects(validateImage(jpg, { extension: '.jpg', maxDimension: 1 }), { code: 'IMAGE_DIMENSION_LIMIT' });
  await assert.rejects(validateImage(patchHeader(png, header => header.writeUInt32BE(0xffffffff)), { extension: '.png' }), { code: 'IMAGE_DIMENSION_LIMIT' });
  const larger = jpeg.encode({ width: 512, height: 512, data: Buffer.alloc(512 * 512 * 4, 255) }, 50).data;
  await assert.rejects(validateImage(larger, { extension: '.jpg', maxMemoryUsageInMB: 1 }), { code: 'IMAGE_DECODE_FAILED' });
});
test('deadline and abort terminate worker; subsequent independent decode still works', async () => {
  const pre = new AbortController(); pre.abort();
  await assert.rejects(validateImage(png, { extension: '.png', signal: pre.signal }), { code: 'IMAGE_ABORTED' });
  const during = new AbortController(), pending = validateImage(png, { extension: '.png', signal: during.signal }); during.abort();
  await assert.rejects(pending, { code: 'IMAGE_ABORTED' });
  await assert.rejects(validateImage(png, { extension: '.png', timeoutMs: 1 }), { code: 'IMAGE_TIMEOUT' });
  assert.deepEqual(await validateImage(png, { extension: '.png' }), { format: 'png', width: 2, height: 2 });
});

test('restart-coded JPEG rejects rather than accepting an incomplete scan as valid pixels', async () => {
  // Original generated64x64 fixture, truncated at first restart interval then EOI.
  const truncatedRestart = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/90ABAAB/9oADAMBAAIRAxEAPwBkFt9na1t/sEVp5MYf7L5m6KDC/fkbAyRngcde3VnwjYJuBF9oKj5vmmuu3T+CMdMY68Y/hpkFt9na1t/sEVp5MYf7L5m6KDC/fkbAyRngcde3VnwjYJuBF9oKj5vmmuu3T+CMdMY68Y/hpr8l92v4f+S+r3M0/wCvn6/5X3vL4j//2Q==', 'base64');
  await assert.rejects(validateImage(truncatedRestart, { extension: '.jpg' }), { code: 'UNSUPPORTED_IMAGE' });
  const dri = Buffer.from([255, 221, 0, 4, 0, 1]);
  await assert.rejects(validateImage(Buffer.concat([jpg.subarray(0, 2), dri, jpg.subarray(2)]), { extension: '.jpg' }), { code: 'UNSUPPORTED_IMAGE' });
  const rst = Buffer.from([255, 208]);
  await assert.rejects(validateImage(Buffer.concat([progressive.subarray(0, -2), rst, progressive.subarray(-2)]), { extension: '.jpg' }), { code: 'UNSUPPORTED_IMAGE' });
  await assert.rejects(validateImage(Buffer.concat([progressive.subarray(0, -2), dri, progressive.subarray(-2)]), { extension: '.jpg' }), { code: 'UNSUPPORTED_IMAGE' });
  // Metadata bytes are length-delimited, not entropy markers.
  const app = Buffer.from([255, 225, 0, 8, 255, 221, 0, 4, 255, 208]);
  assert.deepEqual(await validateImage(Buffer.concat([jpg.subarray(0, 2), app, jpg.subarray(2)]), { extension: '.jpg' }), { format: 'jpeg', width: 2, height: 2 });
});
