'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const CODES = new Set(['INVALID_IMAGE', 'UNSUPPORTED_IMAGE', 'IMAGE_DIMENSION_LIMIT', 'IMAGE_DECODE_FAILED']);
function failure(code) { return Object.assign(Error('Image validation rejected'), { code }); }
/** Full decoding, isolated from service timers. Sources remain opaque bytes.
 * APNG, interlaced PNG and restart-coded JPEG are explicitly unsupported in
 * this first increment. jpeg-js strict mode alone can accept truncated restarts.
 * Worker heap limits complement decoder limits, not a total process RSS bound.
 */
async function validateImage(buffer, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw failure('INVALID_OPTIONS');
  const { extension, maxPixels = 16777216, maxDimension = 8192,
    timeoutMs = 10000, signal, maxMemoryUsageInMB = 128 } = options;
  if (!Buffer.isBuffer(buffer) || typeof extension !== 'string' ||
    !Number.isInteger(maxPixels) || maxPixels < 1 || maxPixels > 16777216 ||
    !Number.isInteger(maxDimension) || maxDimension < 1 || maxDimension > 8192 ||
    !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 ||
    !Number.isInteger(maxMemoryUsageInMB) || maxMemoryUsageInMB < 1 || maxMemoryUsageInMB > 512 ||
    (signal !== undefined && !(signal instanceof AbortSignal))) throw failure('INVALID_OPTIONS');
  if (signal?.aborted) throw failure('IMAGE_ABORTED');
  if (buffer.length > MAX_INPUT_BYTES) throw failure('IMAGE_TOO_LARGE');
  const ext = extension.toLowerCase().replace(/^\./, '');
  if (!['png', 'jpg', 'jpeg'].includes(ext)) throw failure('UNSUPPORTED_IMAGE');
  const format = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' :
    buffer.length >= 2 && buffer[0] === 255 && buffer[1] === 216 ? 'jpeg' : null;
  if (!format) throw failure('INVALID_IMAGE');
  if (format !== (ext === 'png' ? 'png' : 'jpeg')) throw failure('IMAGE_FORMAT_MISMATCH');
  // Copy into a dedicated transferable allocation: never detach/mutate the
  // caller's Buffer, shared slabs, or bytes the stager is about to hash/write.
  const bytes = Uint8Array.from(buffer);
  return new Promise((resolve, reject) => {
    let worker, timer, settled = false;
    const abort = () => finish(failure('IMAGE_ABORTED'));
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      Promise.resolve(worker?.terminate()).then(() => {
        if (error) reject(error); else resolve(Object.freeze(result));
      }, () => reject(failure('IMAGE_DECODE_FAILED')));
    };
    try {
      worker = new Worker(path.join(__dirname, 'image-decoder-worker.cjs'), {
        workerData: { bytes, format, maxPixels, maxDimension, maxMemoryUsageInMB }, transferList: [bytes.buffer],
        resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 }
      });
    } catch { finish(failure('IMAGE_DECODE_FAILED')); return; }
    timer = setTimeout(() => finish(failure('IMAGE_TIMEOUT')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', message => {
      if (message?.ok === true && message.format === format && Number.isInteger(message.width) && Number.isInteger(message.height)) {
        finish(null, { format, width: message.width, height: message.height });
      } else finish(failure(CODES.has(message?.code) ? message.code : 'IMAGE_DECODE_FAILED'));
    });
    worker.once('error', () => finish(failure('IMAGE_DECODE_FAILED')));
    worker.once('exit', () => { if (!settled) finish(failure('IMAGE_DECODE_FAILED')); });
  });
}
module.exports = { validateImage, MAX_INPUT_BYTES };
