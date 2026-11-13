'use strict';
const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: wait } = require('node:timers/promises');
const { validateImage } = require('./image-validator.cjs');
const DEFAULTS = Object.freeze({ quietMs: 250, maxFiles: 500, maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024, maxPixels: 16777216, maxDimension: 8192,
  maxDepth: 16, maxEntries: 10000, timeoutMs: 10000 });
const RULES = { quietMs: [0, 60000], maxFiles: [1, 10000], maxFileBytes: [1, 20 * 1024 * 1024],
  maxTotalBytes: [1, 10 * 1024 * 1024 * 1024], maxPixels: [1, 16777216], maxDimension: [1, 8192],
  maxDepth: [0, 64], maxEntries: [1, 100000], timeoutMs: [1, 60000] };
const IMAGE_CODES = new Set(['INVALID_OPTIONS', 'IMAGE_TOO_LARGE', 'UNSUPPORTED_IMAGE', 'IMAGE_FORMAT_MISMATCH',
  'INVALID_IMAGE', 'IMAGE_DIMENSION_LIMIT', 'IMAGE_DECODE_FAILED', 'IMAGE_ABORTED', 'IMAGE_TIMEOUT']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
class SnapshotError extends Error {
  constructor(code) { super('Media snapshot ' + code); this.code = code; }
}
function fail(code) { throw new SnapshotError(code); }
function plain(value) { return !!value && typeof value === 'object' && [null, Object.prototype].includes(Object.getPrototypeOf(value)); }
function exact(value, keys) { return plain(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function options(raw = {}, extraKeys = []) {
  if (!plain(raw) || Reflect.ownKeys(raw).some(key => typeof key !== 'string' ||
      (!Object.hasOwn(DEFAULTS, key) && key !== 'signal' && !extraKeys.includes(key)))) fail('INVALID_OPTIONS');
  const result = { signal: raw.signal };
  if (raw.signal !== undefined && !(raw.signal instanceof AbortSignal)) fail('INVALID_OPTIONS');
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = raw[key] === undefined ? fallback : raw[key], [low, high] = RULES[key];
    if (!Number.isSafeInteger(value) || value < low || value > high) fail('INVALID_OPTIONS');
    result[key] = value;
  }
  return result;
}
function aborted(signal) { if (signal?.aborted) fail('IMAGE_ABORTED'); }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function comparable(value) { return process.platform === 'win32' ? value.toLowerCase() : value; }
function inside(root, candidate) {
  const relative = path.relative(comparable(root), comparable(candidate));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function signature(stat) { return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':'); }
function regular(stat) { if (stat.isSymbolicLink() || !stat.isFile()) fail('UNSAFE_SOURCE'); }
async function prospectiveRealPath(candidate) {
  let current = candidate; const tail = [];
  for (;;) {
    try { return path.join(await fs.realpath(current), ...tail.reverse()); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(current); if (parent === current) throw error;
      tail.push(path.basename(current)); current = parent;
    }
  }
}
async function roots(sourceDir, cacheDir) {
  if (typeof sourceDir !== 'string' || !path.isAbsolute(sourceDir) || typeof cacheDir !== 'string' || !path.isAbsolute(cacheDir)) fail('INVALID_OPTIONS');
  sourceDir = path.resolve(sourceDir); cacheDir = path.resolve(cacheDir);
  const sourceStat = await fs.lstat(sourceDir);
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) fail('UNSAFE_SOURCE');
  const source = await fs.realpath(sourceDir), prospective = await prospectiveRealPath(path.resolve(cacheDir));
  if (inside(source, prospective) || inside(prospective, source)) fail('OVERLAPPING_ROOTS');
  await fs.mkdir(cacheDir, { recursive: true });
  const cacheStat = await fs.lstat(cacheDir);
  if (cacheStat.isSymbolicLink() || !cacheStat.isDirectory()) fail('UNSAFE_CACHE');
  const cache = await fs.realpath(cacheDir);
  if (inside(source, cache) || inside(cache, source)) fail('OVERLAPPING_ROOTS');
  return { source, cache };
}
async function boundedNames(directory, limit, signal, code = 'ENTRY_LIMIT') {
  const names = [];
  for await (const entry of await fs.opendir(directory)) {
    aborted(signal); if (names.length >= limit) fail(code); names.push(entry.name);
  }
  return names.sort(compare);
}
async function inventory(root, config) {
  const records = [], media = [], names = new Set(); let entries = 0, total = 0;
  async function visit(absolute, relative, depth) {
    aborted(config.signal);
    const stat = await fs.lstat(absolute, { bigint: true });
    if (stat.isSymbolicLink()) fail('UNSAFE_SOURCE');
    const normalized = relative.split(path.sep).join('/').normalize('NFC');
    const key = normalized.toLowerCase();
    if (names.has(key)) fail('AMBIGUOUS_NAMES'); names.add(key);
    if (stat.isDirectory()) {
      if (depth > config.maxDepth) fail('DEPTH_LIMIT');
      records.push([normalized, 'directory', signature(stat)]);
      const children = await boundedNames(absolute, config.maxEntries - entries, config.signal);
      entries += children.length;
      for (const child of children) {
        if (child.includes('\\')) fail('AMBIGUOUS_NAMES');
        await visit(path.join(absolute, child), relative ? path.join(relative, child) : child, depth + 1);
      }
    } else {
      regular(stat);
      records.push([normalized, 'file', signature(stat)]);
      const extension = path.extname(normalized).toLowerCase();
      if (!['.png', '.jpg', '.jpeg'].includes(extension)) return;
      const bytes = Number(stat.size);
      if (bytes < 1) fail('EMPTY_IMAGE');
      if (bytes > config.maxFileBytes) fail('FILE_LIMIT');
      total += bytes;
      if (!Number.isSafeInteger(total) || total > config.maxTotalBytes) fail('TOTAL_LIMIT');
      if (media.length >= config.maxFiles) fail('FILE_COUNT_LIMIT');
      media.push({ absolute, relative: normalized, extension, bytes, signature: signature(stat) });
    }
  }
  await visit(root, '', 0);
  if (!media.length) fail('EMPTY_DECK');
  media.sort((a, b) => compare(a.relative, b.relative)); records.sort((a, b) => compare(a[0], b[0]));
  return { media, fingerprint: JSON.stringify(records) };
}
async function capturedFile(file, source, config) {
  aborted(config.signal);
  // O_NOFOLLOW protects the final component where supported; identity and
  // realpath rechecks detect ordinary sync replacements on both platforms.
  const handle = await fs.open(file.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat({ bigint: true }); regular(before);
    if (signature(before) !== file.signature) fail('SOURCE_CHANGED');
    const real = await fs.realpath(file.absolute);
    if (!inside(source, real)) fail('UNSAFE_SOURCE');
    const buffer = Buffer.alloc(file.bytes); let offset = 0;
    while (offset < buffer.length) {
      aborted(config.signal);
      const read = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!read.bytesRead) fail('SOURCE_CHANGED'); offset += read.bytesRead;
    }
    const extra = Buffer.alloc(1);
    if ((await handle.read(extra, 0, 1, offset)).bytesRead || signature(await handle.stat({ bigint: true })) !== file.signature) fail('SOURCE_CHANGED');
    const after = await fs.lstat(file.absolute, { bigint: true }); regular(after);
    if (signature(after) !== file.signature || !inside(source, await fs.realpath(file.absolute))) fail('SOURCE_CHANGED');
    return buffer;
  } finally { await handle.close(); }
}
function canonicalFile(file) { return { id: file.id, src: file.src, sha256: file.sha256, bytes: file.bytes,
  width: file.width, height: file.height, format: file.format }; }
function contentHash(files) { return digest(JSON.stringify(files.map(canonicalFile))); }
function result(snapshotDir, manifest) {
  const files = Object.freeze(manifest.files.map(file => Object.freeze(canonicalFile(file))));
  const frozen = Object.freeze({ schemaVersion: 1, id: manifest.id, contentHash: manifest.contentHash, files });
  const slides = Object.freeze(files.map(file => Object.freeze({ id: file.id, src: file.src })));
  return Object.freeze({ snapshotDir, manifest: frozen, deck: Object.freeze({ id: frozen.id, slides }) });
}
async function translated(operation) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof SnapshotError) throw error;
    if (IMAGE_CODES.has(error.code)) throw new SnapshotError(error.code);
    if (error.name === 'AbortError') throw new SnapshotError('IMAGE_ABORTED');
    throw new SnapshotError('SNAPSHOT_IO');
  }
}
/** Prepare only: never changes an active presentation or writes the source. */
async function stageSnapshot(raw = {}) {
  return translated(async () => {
    const config = options(raw, ['sourceDir', 'cacheDir']); aborted(config.signal);
    const { source, cache } = await roots(raw.sourceDir, raw.cacheDir);
    const first = await inventory(source, config);
    await wait(config.quietMs, undefined, { signal: config.signal });
    const second = await inventory(source, config);
    if (first.fingerprint !== second.fingerprint) fail('SOURCE_CHANGED');
    const id = crypto.randomUUID(), temporary = path.join(cache, '.pending-' + id), published = path.join(cache, id);
    let ownsTemporary = false;
    try {
      await fs.mkdir(temporary); ownsTemporary = true;
      await fs.mkdir(path.join(temporary, 'media'));
      const files = [];
      for (const file of second.media) {
        const buffer = await capturedFile(file, source, config);
        const decoded = await validateImage(buffer, { extension: file.extension, maxPixels: config.maxPixels,
          maxDimension: config.maxDimension, timeoutMs: config.timeoutMs, signal: config.signal });
        aborted(config.signal);
        const hash = digest(buffer), mediaId = digest(file.relative);
        const src = 'media/' + mediaId + '-' + hash + (decoded.format === 'png' ? '.png' : '.jpg');
        await fs.writeFile(path.join(temporary, ...src.split('/')), buffer, { flag: 'wx' });
        files.push({ id: mediaId, src, sha256: hash, bytes: buffer.length, width: decoded.width, height: decoded.height, format: decoded.format });
      }
      const finalInventory = await inventory(source, config);
      if (finalInventory.fingerprint !== second.fingerprint) fail('SOURCE_CHANGED');
      const manifest = { schemaVersion: 1, id, contentHash: contentHash(files), files };
      await fs.writeFile(path.join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
      aborted(config.signal);
      try { await fs.lstat(published); fail('PUBLISH_COLLISION'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.rename(temporary, published); ownsTemporary = false;
      return result(published, manifest);
    } finally { if (ownsTemporary) await fs.rm(temporary, { recursive: true, force: true }); }
  });
}
function validatedManifest(raw, folder, config) {
  if (!exact(raw, ['schemaVersion', 'id', 'contentHash', 'files']) || raw.schemaVersion !== 1 || typeof raw.id !== 'string' || typeof raw.contentHash !== 'string' || !UUID.test(raw.id) ||
      path.basename(folder) !== raw.id || !HEX.test(raw.contentHash) || !Array.isArray(raw.files) ||
      !raw.files.length || raw.files.length > config.maxFiles) fail('INVALID_MANIFEST');
  const ids = new Set(), sources = new Set(); let total = 0;
  const files = raw.files.map(file => {
    if (!exact(file, ['id', 'src', 'sha256', 'bytes', 'width', 'height', 'format']) ||
      !['id', 'src', 'sha256', 'format'].every(key => typeof file[key] === 'string') || !HEX.test(file.id) || !HEX.test(file.sha256) ||
      !['png', 'jpeg'].includes(file.format) || file.src !== 'media/' + file.id + '-' + file.sha256 + (file.format === 'png' ? '.png' : '.jpg') ||
      !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > config.maxFileBytes ||
      !Number.isSafeInteger(file.width) || !Number.isSafeInteger(file.height) || file.width < 1 || file.height < 1 ||
      file.width > config.maxDimension || file.height > config.maxDimension || file.width * file.height > config.maxPixels ||
      ids.has(file.id) || sources.has(file.src)) fail('INVALID_MANIFEST');
    total += file.bytes; if (total > config.maxTotalBytes) fail('TOTAL_LIMIT');
    ids.add(file.id); sources.add(file.src); return canonicalFile(file);
  });
  if (contentHash(files) !== raw.contentHash) fail('INVALID_MANIFEST');
  return { schemaVersion: 1, id: raw.id, contentHash: raw.contentHash, files };
}
/** Verify a complete cached snapshot without consulting the synced source. */
async function loadSnapshot(snapshotDir, raw = {}) {
  return translated(async () => {
    const config = options(raw); aborted(config.signal);
    if (typeof snapshotDir !== 'string' || !path.isAbsolute(snapshotDir) || !UUID.test(path.basename(snapshotDir))) fail('INVALID_SNAPSHOT');
    snapshotDir = path.resolve(snapshotDir);
    const rootStat = await fs.lstat(snapshotDir, { bigint: true });
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) fail('UNSAFE_CACHE');
    const folder = await fs.realpath(snapshotDir);
    const manifestPath = path.join(folder, 'manifest.json'), manifestStat = await fs.lstat(manifestPath, { bigint: true });
    regular(manifestStat);
    if (manifestStat.size > BigInt(config.maxFiles * 1024 + 1024)) fail('INVALID_MANIFEST');
    const manifestBuffer = await capturedFile({ absolute: manifestPath, bytes: Number(manifestStat.size),
      signature: signature(manifestStat) }, folder, config);
    let parsed; try { parsed = JSON.parse(manifestBuffer.toString('utf8')); } catch { fail('INVALID_MANIFEST'); }
    const manifest = validatedManifest(parsed, folder, config);
    const expectedRoot = ['manifest.json', 'media'];
    if (JSON.stringify(await boundedNames(folder, 2, config.signal, 'UNEXPECTED_CONTENT')) !== JSON.stringify(expectedRoot)) fail('UNEXPECTED_CONTENT');
    const mediaDir = path.join(folder, 'media'), mediaStat = await fs.lstat(mediaDir, { bigint: true });
    if (mediaStat.isSymbolicLink() || !mediaStat.isDirectory()) fail('UNSAFE_CACHE');
    const expected = manifest.files.map(file => path.basename(file.src)).sort(compare);
    if (JSON.stringify(await boundedNames(mediaDir, Math.min(config.maxFiles, config.maxEntries), config.signal, 'UNEXPECTED_CONTENT')) !== JSON.stringify(expected)) fail('UNEXPECTED_CONTENT');
    const fileSignatures = [];
    for (const file of manifest.files) {
      const absolute = path.join(folder, ...file.src.split('/')), stat = await fs.lstat(absolute, { bigint: true }); regular(stat);
      if (stat.size !== BigInt(file.bytes)) fail('CACHE_CHANGED');
      fileSignatures.push({ absolute, signature: signature(stat) });
      const buffer = await capturedFile({ absolute, bytes: file.bytes, signature: signature(stat) }, folder, config);
      if (digest(buffer) !== file.sha256) fail('CACHE_CHANGED');
      const decoded = await validateImage(buffer, { extension: path.extname(file.src), maxPixels: config.maxPixels,
        maxDimension: config.maxDimension, timeoutMs: config.timeoutMs, signal: config.signal });
      if (decoded.width !== file.width || decoded.height !== file.height || decoded.format !== file.format) fail('CACHE_CHANGED');
    }
    // Ordinary cache replacement/tamper of an earlier file during a later
    // decode invalidates the complete load, not just the changed file.
    if (JSON.stringify(await boundedNames(folder, 2, config.signal, 'UNEXPECTED_CONTENT')) !== JSON.stringify(expectedRoot) ||
        JSON.stringify(await boundedNames(mediaDir, Math.min(config.maxFiles, config.maxEntries), config.signal, 'UNEXPECTED_CONTENT')) !== JSON.stringify(expected) ||
        signature(await fs.lstat(snapshotDir, { bigint: true })) !== signature(rootStat) ||
        signature(await fs.lstat(mediaDir, { bigint: true })) !== signature(mediaStat) ||
        signature(await fs.lstat(manifestPath, { bigint: true })) !== signature(manifestStat)) fail('CACHE_CHANGED');
    for (const file of fileSignatures) {
      const final = await fs.lstat(file.absolute, { bigint: true }); regular(final);
      if (signature(final) !== file.signature) fail('CACHE_CHANGED');
    }
    aborted(config.signal); return result(folder, manifest);
  });
}
module.exports = { stageSnapshot, loadSnapshot };
