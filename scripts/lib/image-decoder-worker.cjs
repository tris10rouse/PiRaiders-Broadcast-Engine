'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const zlib = require('node:zlib');
function fail(code = 'INVALID_IMAGE') { throw Object.assign(Error('Image rejected'), { code }); }
function dimensions(width, height) {
  if (!width || !height) fail();
  if (width > workerData.maxDimension || height > workerData.maxDimension || width * height > workerData.maxPixels) fail('IMAGE_DIMENSION_LIMIT');
}
const CRC = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = CRC[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function png(buffer) {
  let offset = 8, width, height, depth, channels, ended = false, sawData = false, dataEnded = false;
  const compressed = [];
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) fail();
    const size = buffer.readUInt32BE(offset), end = offset + 12 + size;
    if (end > buffer.length) fail();
    const type = buffer.toString('ascii', offset + 4, offset + 8), body = buffer.subarray(offset + 8, end - 4);
    if (![...buffer.subarray(offset + 4, offset + 8)].every(byte => byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122) ||
      (buffer[offset + 6] & 32) || crc32(buffer.subarray(offset + 4, end - 4)) !== buffer.readUInt32BE(end - 4)) fail();
    if (offset === 8 && (type !== 'IHDR' || size !== 13)) fail();
    if (type === 'IHDR') {
      if (width !== undefined || size !== 13) fail();
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); dimensions(width, height);
      depth = body[8]; const color = body[9]; channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
      if (!channels || !({ 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }[color].includes(depth)) || body[10] !== 0 || body[11] !== 0) fail();
      if (body[12] !== 0) fail('UNSUPPORTED_IMAGE');
    } else if (['acTL', 'fcTL', 'fdAT'].includes(type)) fail('UNSUPPORTED_IMAGE');
    else if (type === 'IDAT') { if (dataEnded) fail(); sawData = true; compressed.push(body); }
    else if (type === 'IEND') { if (size || !sawData || end !== buffer.length) fail(); ended = true; offset = end; break; }
    else { if (sawData) dataEnded = true; }
    offset = end;
  }
  if (!ended) fail();
  // pngjs bounds the ordinary path, but a separate full zlib check also rejects
  // truncated streams/extra inflated bytes and validates the stream checksum.
  const expected = (Math.ceil(width * channels * depth / 8) + 1) * height;
  const idat = Buffer.concat(compressed);
  const inflated = zlib.inflateSync(idat, { maxOutputLength: expected, info: true });
  if (inflated.buffer.length !== expected || inflated.engine.bytesWritten !== idat.length) fail();
  const decoded = require('pngjs').PNG.sync.read(buffer, { checkCRC: true });
  if (decoded.width !== width || decoded.height !== height || decoded.data.length !== width * height * 4) fail();
  return { width, height };
}
function jpeg(buffer) {
  if (buffer.length < 4 || buffer[buffer.length - 2] !== 255 || buffer[buffer.length - 1] !== 217) fail();
  let offset = 2, width, height, sawScan = false, ended = false;
  while (offset < buffer.length - 2) {
    if (buffer[offset++] !== 255) fail();
    while (buffer[offset] === 255) offset++;
    const marker = buffer[offset++];
    if (marker === 221 || marker >= 208 && marker <= 215) fail('UNSUPPORTED_IMAGE');
    if ([0, 1, 216, 217].includes(marker) || offset + 2 > buffer.length) fail();
    const size = buffer.readUInt16BE(offset);
    if (size < 2 || offset + size > buffer.length - 2) fail();
    if ([192, 193, 194].includes(marker)) {
      if (width !== undefined || size < 8 || buffer[offset + 2] !== 8) fail();
      height = buffer.readUInt16BE(offset + 3); width = buffer.readUInt16BE(offset + 5); dimensions(width, height);
    } else if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) fail('UNSUPPORTED_IMAGE');
    offset += size;
    if (marker === 218) {
      sawScan = true;
      // Traverse every entropy scan, including progressive scans. jpeg-js can
      // silently accept early EOI after a restart interval, even in strict mode;
      // DRI/restart-coded images are explicitly outside this initial subset.
      while (offset < buffer.length - 2) {
        if (buffer[offset] !== 255) { offset++; continue; }
        if (buffer[offset + 1] === 0) { offset += 2; continue; }
        let markerAt = offset + 1; while (buffer[markerAt] === 255) markerAt++;
        if (buffer[markerAt] >= 208 && buffer[markerAt] <= 215) fail('UNSUPPORTED_IMAGE');
        break;
      }
    }
  }
  ended = offset === buffer.length - 2;
  if (!sawScan || width === undefined || !ended) fail();
  const decoded = require('jpeg-js').decode(buffer, { useTArray: true, formatAsRGBA: true, tolerantDecoding: false,
    maxResolutionInMP: workerData.maxPixels / 1000000, maxMemoryUsageInMB: workerData.maxMemoryUsageInMB });
  if (decoded.width !== width || decoded.height !== height || decoded.data.length !== width * height * 4) fail();
  return { width, height };
}
try {
  const buffer = Buffer.from(workerData.bytes.buffer, workerData.bytes.byteOffset, workerData.bytes.byteLength);
  const result = workerData.format === 'png' ? png(buffer) : jpeg(buffer);
  parentPort.postMessage({ ok: true, format: workerData.format, ...result });
} catch (error) {
  parentPort.postMessage({ ok: false, code: ['INVALID_IMAGE', 'UNSUPPORTED_IMAGE', 'IMAGE_DIMENSION_LIMIT'].includes(error?.code) ? error.code : 'IMAGE_DECODE_FAILED' });
}
