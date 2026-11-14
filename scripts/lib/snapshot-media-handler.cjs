'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadSnapshot } = require('./media-snapshot.cjs');

function invalidOptions() { const error = new Error('Invalid snapshot media options'); error.code = 'INVALID_OPTIONS'; throw error; }
function signature(stat) { return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':'); }
function identity(stat) { return [stat.dev, stat.ino].map(String).join(':'); }
function regular(stat) { if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Unsafe file'); }
function directory(stat) { if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Unsafe directory'); }
function loopback(address) { return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'; }
function samePath(a, b) { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; }

/**
 * Create an unmounted, terminal Node HTTP handler for one verified snapshot.
 * The caller must provide its presentation-session authorization predicate.
 * A UUID is a media identifier, never an authorization credential.
 */
async function createSnapshotMediaHandler(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Reflect.ownKeys(raw).some(key => !['snapshotDir', 'authorize', 'maxConcurrentReads', 'signal'].includes(key)) ||
      typeof raw.authorize !== 'function') invalidOptions();
  const { authorize, snapshotDir, maxConcurrentReads = 4, signal } = raw;
  if (signal !== undefined && !(signal instanceof AbortSignal)) invalidOptions();
  if (!Number.isSafeInteger(maxConcurrentReads) || maxConcurrentReads < 1 || maxConcurrentReads > 16) invalidOptions();
  const snapshot = await loadSnapshot(snapshotDir, {signal});
  if (signal?.aborted) { const error = new Error('Snapshot verification aborted'); error.code = 'IMAGE_ABORTED'; throw error; }
  const root = snapshot.snapshotDir, media = path.join(root, 'media');
  const rootStat = await fs.lstat(root, { bigint: true }), mediaStat = await fs.lstat(media, { bigint: true });
  directory(rootStat); directory(mediaStat);
  if (!samePath(await fs.realpath(root), root) || !samePath(await fs.realpath(media), media)) throw Error('Unsafe snapshot directories');
  const prefix = '/piraiders/media/' + snapshot.manifest.id + '/';
  const entries = new Map(snapshot.manifest.files.map(file => [prefix + file.src, file]));
  const deck = Object.freeze({ id: snapshot.deck.id, slides: Object.freeze(snapshot.deck.slides.map(slide =>
    Object.freeze({ id: slide.id, src: prefix + slide.src }))) });
  let closed = false, reads = 0;
  const responses = new Set();

  async function checkDirectories() {
    const a = await fs.lstat(root, { bigint: true }), b = await fs.lstat(media, { bigint: true });
    directory(a); directory(b);
    if (identity(a) !== identity(rootStat) || identity(b) !== identity(mediaStat) ||
        !samePath(await fs.realpath(root), root) || !samePath(await fs.realpath(media), media)) throw Error('Snapshot changed');
  }
  async function capture(file, canceled) {
    await checkDirectories();
    const absolute = path.join(root, ...file.src.split('/'));
    const before = await fs.lstat(absolute, { bigint: true }); regular(before);
    if (before.size !== BigInt(file.bytes) || !samePath(await fs.realpath(absolute), absolute)) throw Error('Media changed');
    const handle = await fs.open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const opened = await handle.stat({ bigint: true }); regular(opened);
      if (signature(opened) !== signature(before)) throw Error('Media replaced');
      // Length is bounded by the fully validated registration manifest (20 MiB).
      const bytes = Buffer.alloc(file.bytes); let offset = 0;
      while (offset < bytes.length) {
        if (closed || canceled()) throw Error('Closed');
        const read = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!read.bytesRead) throw Error('Media truncated');
        offset += read.bytesRead;
      }
      if ((await handle.read(Buffer.alloc(1), 0, 1, offset)).bytesRead ||
          signature(await handle.stat({ bigint: true })) !== signature(before)) throw Error('Media changed');
      const after = await fs.lstat(absolute, { bigint: true }); regular(after);
      if (signature(after) !== signature(before) || !samePath(await fs.realpath(absolute), absolute) ||
          crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw Error('Media changed');
      await checkDirectories();
      return bytes;
    } finally { await handle.close(); }
  }
  function headers(res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  }
  function empty(res, status) {
    if (res.destroyed || res.writableEnded) return;
    headers(res); res.statusCode = status; res.setHeader('Content-Length', '0'); res.end();
  }
  function authorized(req) {
    try {
      const allowed = authorize(req);
      // Async authorization is unsupported; consume rejected Promises without
      // treating eventual resolution as a current session authorization.
      if (allowed && typeof allowed.then === 'function') Promise.resolve(allowed).catch(() => {});
      return allowed === true;
    } catch { return false; }
  }
  async function handle(req, res) {
    if (closed) { empty(res, 503); return; }
    headers(res);
    if (!loopback(req.socket?.remoteAddress) || req.headers['sec-fetch-site'] === 'cross-site') { empty(res, 403); return; }
    if (!authorized(req)) { empty(res, 403); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); empty(res, 405); return; }
    // Do not normalize/decode user URLs: only exact, generated ASCII names exist.
    const file = entries.get(req.url);
    if (!file) { empty(res, 404); return; }
    if (reads >= maxConcurrentReads) { empty(res, 503); return; }
    reads++; responses.add(res);
    // A slot covers both the descriptor read and response draining. res.end
    // queues bytes; it does not prove a slow client has released that Buffer.
    let readSettled = false, drained = res.destroyed || res.writableFinished, released = false;
    function release() {
      if (released || !readSettled || !drained) return;
      released = true; responses.delete(res); reads--;
      res.off('finish', onDrain); res.off('close', onDrain); res.off('error', onError);
    }
    function onDrain() { drained = true; release(); }
    function onError() { res.destroy(); onDrain(); }
    res.once('finish', onDrain); res.once('close', onDrain); res.once('error', onError);
    try {
      const bytes = await capture(file, () => res.destroyed);
      if (closed) { empty(res, 503); return; }
      if (res.destroyed || res.writableEnded) return;
      if (!authorized(req)) { empty(res, 403); return; }
      res.statusCode = 200;
      res.setHeader('Content-Type', file.format === 'png' ? 'image/png' : 'image/jpeg');
      res.setHeader('Content-Length', String(bytes.length));
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { empty(res, 503); }
    finally { readSettled = true; release(); }
  }
  function close() {
    closed = true;
    for (const res of responses) {
      if (res.headersSent || res.writableEnded) res.destroy();
      else empty(res, 503);
    }
  }
  if (signal?.aborted) { const error = new Error('Snapshot verification aborted'); error.code = 'IMAGE_ABORTED'; throw error; }
  return Object.freeze({ deck, handle, close });
}
module.exports = { createSnapshotMediaHandler };
