'use strict';
// Detached preparation/cache support only. No source writes or output admission.

const fs = require('node:fs/promises');

const {
  constants
} = require('node:fs');

const path = require('node:path');

const crypto = require('node:crypto');

const {
  canonicalExchangeJSON,
  selectionId
} = require('./exchange-fingerprints.cjs');

const {
  parseExchangeJSON
} = require('./exchange-json.cjs');

const {
  createExchangeTimingGate
} = require('./exchange-timing.cjs');

const {
  validateImage
} = require('./image-validator.cjs');

const LIMITS = Object.freeze({
  maxFiles: 500,
  maxOccurrences: 500,
  maxFileBytes: 20971520,
  maxTotalBytes: 536870912,
  maxPixels: 16777216,
  maxDimension: 8192,
  timeoutMs: 1e4,
  manifestBytes: 2097152
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const HEX = /^[0-9a-f]{64}$/;

const IMAGE_CODES = new Set([ 'INVALID_OPTIONS', 'IMAGE_TOO_LARGE', 'UNSUPPORTED_IMAGE', 'IMAGE_FORMAT_MISMATCH', 'INVALID_IMAGE', 'IMAGE_DIMENSION_LIMIT', 'IMAGE_DECODE_FAILED', 'IMAGE_ABORTED', 'IMAGE_TIMEOUT' ]);

class ExchangeSnapshotError extends Error {
  constructor(code) {
    super('Exchange snapshot ' + code);
    this.code = code;
  }
}

function fail(code) {
  throw new ExchangeSnapshotError(code);
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![ Object.prototype, null ].includes(Object.getPrototypeOf(value))) fail('INVALID_MANIFEST');
  const d = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(d).length !== keys.length || keys.some(k => !Object.hasOwn(d, k)) || Reflect.ownKeys(d).some(k => typeof k !== 'string' || !keys.includes(k) || !d[k].enumerable || !Object.hasOwn(d[k], 'value'))) fail('INVALID_MANIFEST');
}

function integer(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function text(value, max, nullable = false) {
  return nullable && value === null || typeof value === 'string' && Array.from(value).length <= max;
}

function abort(config) {
  if (config.signal?.aborted) fail('IMAGE_ABORTED');
}

function config(raw, stage = false) {
  exactOptions(raw, stage);
  const out = {
    signal: raw.signal,
    maxEntries: raw.maxEntries === undefined ? 1e4 : raw.maxEntries
  };
  if (raw.signal !== undefined && !(raw.signal instanceof AbortSignal)) fail('INVALID_OPTIONS');
  for (const key of [ 'maxFiles', 'maxOccurrences', 'maxFileBytes', 'maxTotalBytes', 'maxPixels', 'maxDimension', 'timeoutMs' ]) {
    const v = raw[key] === undefined ? LIMITS[key] : raw[key];
    if (!integer(v, 1, LIMITS[key])) fail('INVALID_OPTIONS');
    out[key] = v;
  }
  return out;
}

function exactOptions(raw, stage) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![ Object.prototype, null ].includes(Object.getPrototypeOf(raw))) fail('INVALID_OPTIONS');
  const allowed = [ 'signal', 'maxFiles', 'maxOccurrences', 'maxFileBytes', 'maxTotalBytes', 'maxPixels', 'maxDimension', 'timeoutMs', 'quietMs', 'maxDepth', 'maxEntries', ...stage ? [ 'sourceRoot', 'cacheDir', 'manifest' ] : [] ];
  const d = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(d).some(k => typeof k !== 'string' || !allowed.includes(k) || !d[k].enumerable || !Object.hasOwn(d[k], 'value'))) fail('INVALID_OPTIONS');
  for (const [ key, max ] of [ [ 'quietMs', 6e4 ], [ 'maxDepth', 64 ], [ 'maxEntries', 1e5 ] ]) if (raw[key] !== undefined && !integer(raw[key], key === 'maxEntries' ? 1 : 0, max)) fail('INVALID_OPTIONS');
}

function comparable(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function within(root, candidate) {
  const r = path.relative(comparable(root), comparable(candidate));
  return r === '' || !path.isAbsolute(r) && r !== '..' && !r.startsWith('..' + path.sep);
}

function sig(s) {
  return [ s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs ].join(':');
}

function identity(s) {
  return [ s.dev, s.ino ].join(':');
}

function regular(s, code = 'UNSAFE_SOURCE') {
  if (!s.isFile() || s.isSymbolicLink()) fail(code);
}

async function noLinks(file, prospective = false) {
  let cursor = path.parse(file).root;
  for (const segment of path.relative(cursor, file).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    let s;
    try {
      s = await fs.lstat(cursor, {
        bigint: true
      });
    } catch (e) {
      if (prospective && e.code === 'ENOENT') return;
      throw e;
    }
    if (s.isSymbolicLink() || cursor !== file && !s.isDirectory()) fail('UNSAFE_SOURCE');
  }
}

async function prospective(file) {
  let cursor = file, tail = [];
  for (;;) {
    try {
      return path.join(await fs.realpath(cursor), ...tail.reverse());
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const p = path.dirname(cursor);
      if (p === cursor) throw e;
      tail.push(path.basename(cursor));
      cursor = p;
    }
  }
}

async function roots(sourceRoot, cacheDir) {
  if (typeof sourceRoot !== 'string' || !path.isAbsolute(sourceRoot) || typeof cacheDir !== 'string' || !path.isAbsolute(cacheDir)) fail('INVALID_OPTIONS');
  sourceRoot = path.resolve(sourceRoot);
  cacheDir = path.resolve(cacheDir);
  await noLinks(sourceRoot);
  await noLinks(cacheDir, true);
  const s = await fs.lstat(sourceRoot, {
    bigint: true
  });
  if (!s.isDirectory()) fail('UNSAFE_SOURCE');
  const source = await fs.realpath(sourceRoot), future = await prospective(cacheDir);
  if (within(source, future) || within(future, source)) fail('OVERLAPPING_ROOTS');
  await fs.mkdir(cacheDir, {
    recursive: true
  });
  await noLinks(cacheDir);
  const c = await fs.lstat(cacheDir, {
    bigint: true
  });
  if (!c.isDirectory()) fail('UNSAFE_CACHE');
  const cache = await fs.realpath(cacheDir);
  if (within(source, cache) || within(cache, source)) fail('OVERLAPPING_ROOTS');
  return {
    source: source,
    sourceRoot: sourceRoot,
    rootId: identity(s),
    cache: cache,
    cacheDir: cacheDir,
    cacheId: identity(c)
  };
}

async function stableRoot(root, real, id) {
  await noLinks(root);
  const s = await fs.lstat(root, {
    bigint: true
  });
  if (!s.isDirectory() || identity(s) !== id || comparable(await fs.realpath(root)) !== comparable(real)) fail('SOURCE_CHANGED');
}

async function capture(file, root, expectedBytes, c) {
  abort(c);
  await noLinks(file);
  const before = await fs.lstat(file, {
    bigint: true
  });
  regular(before);
  if (before.size !== BigInt(expectedBytes)) fail('LENGTH_MISMATCH');
  if (!within(root, await fs.realpath(file))) fail('UNSAFE_SOURCE');
  let h;
  try {
    h = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    if (sig(await h.stat({
      bigint: true
    })) !== sig(before)) fail('SOURCE_CHANGED');
    const bytes = Buffer.alloc(expectedBytes + 1);
    let offset = 0;
    while (offset < bytes.length) {
      abort(c);
      const part = await h.read(bytes, offset, bytes.length - offset, offset);
      if (!part.bytesRead) break;
      offset += part.bytesRead;
    }
    abort(c);
    await noLinks(file);
    const after = await fs.lstat(file, {
      bigint: true
    });
    regular(after);
    if (offset !== expectedBytes || sig(after) !== sig(before) || sig(await h.stat({
      bigint: true
    })) !== sig(before) || !within(root, await fs.realpath(file))) fail('SOURCE_CHANGED');
    return bytes.subarray(0, offset);
  } finally {
    await h?.close();
  }
}

function physicalFile(f) {
  return {
    id: f.id,
    src: f.src,
    sha256: f.sha256,
    bytes: f.bytes,
    width: f.width,
    height: f.height,
    format: f.format
  };
}

function body(m) {
  return {
    source: {
      feedId: m.source.feedId,
      epoch: m.source.epoch,
      selectionId: m.source.selectionId,
      identityTuple: m.source.identityTuple,
      playbackFingerprint: m.source.playbackFingerprint
    },
    files: m.files.map(physicalFile),
    assets: m.assets.map(a => ({
      assetKey: a.assetKey,
      fileId: a.fileId
    })),
    occurrences: m.occurrences.map(o => ({
      occurrenceKey: o.occurrenceKey,
      fileKey: o.fileKey,
      assetKey: o.assetKey
    }))
  };
}

function contentHash(m) {
  return hash(JSON.stringify(body(m)));
}

function playback(m) {
  const files = new Map(m.files.map(f => [ f.id, f ])), assets = new Map(m.assets.map(a => [ a.assetKey, a.fileId ]));
  return hash(canonicalExchangeJSON({
    state: 'complete',
    occurrences: m.occurrences.map(o => [ o.occurrenceKey, files.get(assets.get(o.assetKey)).sha256, null ])
  }));
}

function result(folder, m) {
  const manifest = freeze({
    schemaVersion: 2,
    id: m.id,
    contentHash: m.contentHash,
    ...body(m)
  }), assets = new Map(manifest.assets.map(a => [ a.assetKey, a.fileId ])), files = new Map(manifest.files.map(f => [ f.id, f ]));
  const slides = manifest.occurrences.map(o => ({
    id: hash('occurrence\0' + o.occurrenceKey),
    src: files.get(assets.get(o.assetKey)).src
  }));
  return freeze({
    snapshotDir: folder,
    manifest: manifest,
    deck: {
      id: m.id,
      slides: slides
    }
  });
}

async function translated(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ExchangeSnapshotError) throw e;
    if (IMAGE_CODES.has(e.code)) throw new ExchangeSnapshotError(e.code);
    if (e.name === 'AbortError') throw new ExchangeSnapshotError('IMAGE_ABORTED');
    throw new ExchangeSnapshotError('SNAPSHOT_IO');
  }
}

let timingGate;

async function stageExchangeSnapshot(raw = {}) {
  return translated(async () => {
    const c = config(raw, true);
    abort(c);
    let owned;
    try {
      owned = JSON.parse(canonicalExchangeJSON(raw.manifest));
    } catch {
      fail('INVALID_SOURCE_MANIFEST');
    }
    timingGate ??= createExchangeTimingGate();
    if (!timingGate.validate(owned).ok) fail('INVALID_SOURCE_MANIFEST');
    if (owned.manifestState !== 'complete' || !owned.occurrences.length || owned.occurrences.some(o => o.assetKey === null || o.problem !== null)) fail('NOT_PLAYABLE');
    if (owned.occurrences.length > c.maxOccurrences || owned.assets.length > c.maxFiles) fail('FILE_COUNT_LIMIT');
    let total = 0;
    const deliveries = new Map();
    for (const a of owned.assets) {
      total += a.byteLength;
      if (total > c.maxTotalBytes) fail('TOTAL_LIMIT');
      if (a.byteLength > c.maxFileBytes) fail('FILE_LIMIT');
      if (a.width > c.maxDimension || a.height > c.maxDimension || a.width * a.height > c.maxPixels) fail('IMAGE_DIMENSION_LIMIT');
      const same = deliveries.get(a.deliveryPath);
      if (same && [ 'sha256', 'byteLength', 'mimeType', 'width', 'height' ].some(k => same[k] !== a[k])) fail('ALIAS_MISMATCH');
      deliveries.set(a.deliveryPath, a);
    }
    if (deliveries.size > c.maxEntries) fail('FILE_COUNT_LIMIT');
    const r = await roots(raw.sourceRoot, raw.cacheDir);
    abort(c);
    const id = crypto.randomUUID(), temporary = path.join(r.cache, '.pending-' + id), published = path.join(r.cache, id);
    let owns = false, temporaryId = null, mediaId = null;
    const mediaDir = path.join(temporary, 'media');
    async function directoryIdentity(directory) {
      await noLinks(directory);
      const stat = await fs.lstat(directory, {bigint: true});
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('SOURCE_CHANGED');
      return identity(stat);
    }
    async function verifyOwnedTree() {
      await stableRoot(r.cacheDir, r.cache, r.cacheId);
      if (temporaryId === null || await directoryIdentity(temporary) !== temporaryId) fail('SOURCE_CHANGED');
      if (mediaId !== null && await directoryIdentity(mediaDir) !== mediaId) fail('SOURCE_CHANGED');
    }
    try {
      await stableRoot(r.cacheDir, r.cache, r.cacheId);
      await fs.mkdir(temporary);
      owns = true;
      await stableRoot(r.cacheDir, r.cache, r.cacheId);
      temporaryId = await directoryIdentity(temporary);
      await fs.mkdir(mediaDir);
      await verifyOwnedTree();
      mediaId = await directoryIdentity(mediaDir);
      const files = [], byPath = new Map();
      let physicalTotal = 0;
      for (const [ delivery, a ] of deliveries) {
        abort(c);
        await stableRoot(r.sourceRoot, r.source, r.rootId);
        const b = await capture(path.join(r.source, ...delivery.split('/')), r.source, a.byteLength, c);
        await stableRoot(r.sourceRoot, r.source, r.rootId);
        if (hash(b) !== a.sha256) fail('HASH_MISMATCH');
        const decoded = await validateImage(b, {
          extension: path.extname(delivery),
          maxPixels: c.maxPixels,
          maxDimension: c.maxDimension,
          timeoutMs: c.timeoutMs,
          signal: c.signal
        });
        abort(c);
        if (decoded.width !== a.width || decoded.height !== a.height || decoded.format !== (a.mimeType === 'image/png' ? 'png' : 'jpeg')) fail('IMAGE_METADATA_MISMATCH');
        physicalTotal += b.length;
        if (physicalTotal > c.maxTotalBytes) fail('TOTAL_LIMIT');
        const f = {
          id: a.sha256,
          src: 'media/' + a.sha256 + '-' + a.sha256 + (decoded.format === 'png' ? '.png' : '.jpg'),
          sha256: a.sha256,
          bytes: b.length,
          width: decoded.width,
          height: decoded.height,
          format: decoded.format
        };
        await verifyOwnedTree();
        await fs.writeFile(path.join(temporary, ...f.src.split('/')), b, {
          flag: 'wx'
        });
        files.push(f);
        byPath.set(delivery, f.id);
      }
      files.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const m = {
        schemaVersion: 2,
        id: id,
        contentHash: '',
        source: {
          feedId: owned.feedId,
          epoch: owned.epoch,
          selectionId: owned.selectionId,
          identityTuple: owned.identityTuple,
          playbackFingerprint: owned.playbackFingerprint
        },
        files: files,
        assets: owned.assets.map(a => ({
          assetKey: a.assetKey,
          fileId: byPath.get(a.deliveryPath)
        })),
        occurrences: owned.occurrences.map(o => ({
          occurrenceKey: o.occurrenceKey,
          fileKey: o.fileKey,
          assetKey: o.assetKey
        }))
      };
      m.contentHash = contentHash(m);
      const json = JSON.stringify(m, null, 2) + '\n';
      if (Buffer.byteLength(json) > LIMITS.manifestBytes) fail('INVALID_MANIFEST');
      await verifyOwnedTree();
      await fs.writeFile(path.join(temporary, 'manifest.json'), json, {
        flag: 'wx'
      });
      abort(c);
      await verifyOwnedTree();
      try {
        await fs.lstat(published);
        fail('PUBLISH_COLLISION');
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      await fs.rename(temporary, published);
      owns = false;
      abort(c);
      return result(published, m);
    } finally {
      if (owns && temporaryId !== null) {
        let removable = false;
        try {
          await verifyOwnedTree();
          removable = true;
        } catch (error) {
          // A pathname is not ownership: preserve a moved/replaced directory.
          // Permission and other I/O failures still fail the operation.
          if (!(error instanceof ExchangeSnapshotError &&
              ['SOURCE_CHANGED', 'UNSAFE_SOURCE'].includes(error.code)) &&
              !['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
        }
        if (removable) await fs.rm(temporary, {recursive: true, force: true});
      }
    }
  });
}

function validateManifest(m, folder, c) {
  exact(m, [ 'schemaVersion', 'id', 'contentHash', 'source', 'files', 'assets', 'occurrences' ]);
  if (m.schemaVersion !== 2 || typeof m.id !== 'string' || !UUID.test(m.id) || path.basename(folder) !== m.id || typeof m.contentHash !== 'string' || !HEX.test(m.contentHash)) fail('INVALID_MANIFEST');
  exact(m.source, [ 'feedId', 'epoch', 'selectionId', 'identityTuple', 'playbackFingerprint' ]);
  const s = m.source;
  if (typeof s.feedId !== 'string' || !UUID.test(s.feedId) || !integer(s.epoch, 1, 999999) || typeof s.playbackFingerprint !== 'string' || !HEX.test(s.playbackFingerprint) || !Array.isArray(s.identityTuple) || s.identityTuple.length !== 5 || s.identityTuple.some(x => typeof x !== 'string') || selectionId(s.identityTuple) !== s.selectionId) fail('INVALID_MANIFEST');
  const limits = [ 9, 64, 64, 6, 200 ];
  if (s.identityTuple.some((x, i) => Array.from(x).length > limits[i]) || !/^\d{4}-\d{4}$/.test(s.identityTuple[0]) || !s.identityTuple[1] || ![ 'event', 'season' ].includes(s.identityTuple[3]) || !s.identityTuple[4] || s.identityTuple[3] === 'season' && !s.identityTuple[2]) fail('INVALID_MANIFEST');
  if (!Array.isArray(m.files) || !m.files.length || m.files.length > c.maxFiles || !Array.isArray(m.assets) || !m.assets.length || m.assets.length > c.maxFiles || !Array.isArray(m.occurrences) || !m.occurrences.length || m.occurrences.length > c.maxOccurrences) fail('INVALID_MANIFEST');
  const files = new Map(), assetMap = new Map(), usedFiles = new Set(), usedAssets = new Set(), occurrences = new Set();
  let physicalTotal = 0, rowTotal = 0, previous = '';
  for (const f of m.files) {
    exact(f, [ 'id', 'src', 'sha256', 'bytes', 'width', 'height', 'format' ]);
    if (typeof f.id !== 'string' || !HEX.test(f.id) || f.id !== f.sha256 || f.id <= previous || ![ 'png', 'jpeg' ].includes(f.format) || f.src !== 'media/' + f.id + '-' + f.sha256 + (f.format === 'png' ? '.png' : '.jpg') || !integer(f.bytes, 1, c.maxFileBytes) || !integer(f.width, 1, c.maxDimension) || !integer(f.height, 1, c.maxDimension) || f.width * f.height > c.maxPixels) fail('INVALID_MANIFEST');
    previous = f.id;
    physicalTotal += f.bytes;
    if (physicalTotal > c.maxTotalBytes) fail('TOTAL_LIMIT');
    files.set(f.id, f);
  }
  for (const a of m.assets) {
    exact(a, [ 'assetKey', 'fileId' ]);
    if (typeof a.assetKey !== 'string' || !/^a[0-9]{1,3}$/.test(a.assetKey) || assetMap.has(a.assetKey) || !files.has(a.fileId)) fail('INVALID_MANIFEST');
    assetMap.set(a.assetKey, a.fileId);
    usedFiles.add(a.fileId);
    rowTotal += files.get(a.fileId).bytes;
    if (rowTotal > c.maxTotalBytes) fail('TOTAL_LIMIT');
  }
  for (const o of m.occurrences) {
    exact(o, [ 'occurrenceKey', 'fileKey', 'assetKey' ]);
    if (!text(o.occurrenceKey, 200) || !o.occurrenceKey || !text(o.fileKey, 64, true) || occurrences.has(o.occurrenceKey) || !assetMap.has(o.assetKey)) fail('INVALID_MANIFEST');
    occurrences.add(o.occurrenceKey);
    usedAssets.add(o.assetKey);
  }
  if (usedFiles.size !== files.size || usedAssets.size !== assetMap.size || playback(m) !== s.playbackFingerprint || contentHash(m) !== m.contentHash) fail('INVALID_MANIFEST');
  return m;
}

async function names(dir, max, c) {
  const out = [];
  for await (const entry of await fs.opendir(dir)) {
    abort(c);
    if (out.length >= max) fail('UNEXPECTED_CONTENT');
    out.push(entry.name);
  }
  return out.sort();
}

async function loadExchangeSnapshot(snapshotDir, raw = {}) {
  return translated(async () => {
    const c = config(raw);
    abort(c);
    if (typeof snapshotDir !== 'string' || !path.isAbsolute(snapshotDir) || !UUID.test(path.basename(snapshotDir))) fail('INVALID_SNAPSHOT');
    snapshotDir = path.resolve(snapshotDir);
    await noLinks(snapshotDir);
    const rootStat = await fs.lstat(snapshotDir, {
      bigint: true
    });
    if (!rootStat.isDirectory()) fail('UNSAFE_CACHE');
    const folder = await fs.realpath(snapshotDir), manifestPath = path.join(folder, 'manifest.json'), ms = await fs.lstat(manifestPath, {
      bigint: true
    });
    regular(ms, 'UNSAFE_CACHE');
    if (ms.size < 1 || ms.size > BigInt(LIMITS.manifestBytes)) fail('INVALID_MANIFEST');
    const b = await capture(manifestPath, folder, Number(ms.size), c);
    let m;
    try {
      m = parseExchangeJSON(b);
      validateManifest(m, folder, c);
    } catch (e) {
      if (e instanceof ExchangeSnapshotError) throw e;
      fail('INVALID_MANIFEST');
    }
    const expectedRoot = JSON.stringify([ 'manifest.json', 'media' ]);
    if (JSON.stringify(await names(folder, 2, c)) !== expectedRoot) fail('UNEXPECTED_CONTENT');
    const mediaDir = path.join(folder, 'media'), mediaStat = await fs.lstat(mediaDir, {
      bigint: true
    });
    if (!mediaStat.isDirectory() || mediaStat.isSymbolicLink()) fail('UNSAFE_CACHE');
    const expected = m.files.map(f => path.basename(f.src)).sort();
    if (JSON.stringify(await names(mediaDir, Math.min(c.maxFiles, c.maxEntries), c)) !== JSON.stringify(expected)) fail('UNEXPECTED_CONTENT');
    const signatures = [];
    for (const f of m.files) {
      const file = path.join(folder, ...f.src.split('/')), before = await fs.lstat(file, {
        bigint: true
      });
      regular(before, 'UNSAFE_CACHE');
      const data = await capture(file, folder, f.bytes, c);
      if (hash(data) !== f.sha256) fail('CACHE_CHANGED');
      const d = await validateImage(data, {
        extension: path.extname(f.src),
        maxPixels: c.maxPixels,
        maxDimension: c.maxDimension,
        timeoutMs: c.timeoutMs,
        signal: c.signal
      });
      if (d.width !== f.width || d.height !== f.height || d.format !== f.format) fail('CACHE_CHANGED');
      signatures.push([ file, sig(before) ]);
    }
    abort(c);
    await noLinks(snapshotDir);
    if (sig(await fs.lstat(snapshotDir, {
      bigint: true
    })) !== sig(rootStat) || sig(await fs.lstat(mediaDir, {
      bigint: true
    })) !== sig(mediaStat) || sig(await fs.lstat(manifestPath, {
      bigint: true
    })) !== sig(ms) || JSON.stringify(await names(folder, 2, c)) !== expectedRoot || JSON.stringify(await names(mediaDir, Math.min(c.maxFiles, c.maxEntries), c)) !== JSON.stringify(expected)) fail('CACHE_CHANGED');
    for (const [ file, signature ] of signatures) {
      await noLinks(file);
      const after = await fs.lstat(file, {
        bigint: true
      });
      regular(after, 'UNSAFE_CACHE');
      if (sig(after) !== signature) fail('CACHE_CHANGED');
    }
    abort(c);
    return result(folder, m);
  });
}

module.exports = {
  stageExchangeSnapshot: stageExchangeSnapshot,
  loadExchangeSnapshot: loadExchangeSnapshot,
  EXCHANGE_SNAPSHOT_LIMITS: LIMITS,
  ExchangeSnapshotError: ExchangeSnapshotError
};
