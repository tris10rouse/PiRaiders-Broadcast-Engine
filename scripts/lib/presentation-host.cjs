'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Server } = require('socket.io');
const { SlideshowController } = require('./slideshow-controller.cjs');
const { createSnapshotMediaHandler } = require('./snapshot-media-handler.cjs');
const ACTIONS = new Set(['launch', 'next', 'previous', 'auto', 'manual', 'toggle-auto', 'stop']);
const ERROR_CODES = new Set(['INVALID_SOURCE', 'INVALID_TRANSITION', 'INVALID_SIGNAL', 'LOAD_FAILED', 'LOAD_TIMEOUT',
  'INVALID_PAYLOAD', 'CANCELED', 'DISPOSED', 'TRANSITION_FAILED', 'BUSY', 'PROTOCOL_ERROR']);
const SESSION_CODES = new Set(['DISCONNECTED','SESSION_TIMEOUT','PROTOCOL_ERROR','BLACK_UNVERIFIED','CANCELED','CLOSED','LISTEN_FAILED']);
const TEMPLATE_ROOT = '/templates/piraiders/slideshow/';
const ASSETS = new Map([['SLIDESHOW.html','text/html; charset=utf-8'], ['slideshow-renderer.js','text/javascript; charset=utf-8'],
  ['slideshow.css','text/css; charset=utf-8'], ['template-interface.js','text/javascript; charset=utf-8'], ['presentation-client.js','text/javascript; charset=utf-8']]);
function record(value) { return !!value && typeof value === 'object' && [null, Object.prototype].includes(Object.getPrototypeOf(value)); }
function exact(value, keys) { return record(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function known(value, keys) { return record(value) && Reflect.ownKeys(value).every(key => keys.includes(key)); }
function fail(code) { const error = new Error('Presentation ' + code); error.code = code; return error; }
function invalid() { throw fail('INVALID_OPTIONS'); }
function loopback(address) { return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address); }
function result(action, code) { return Object.freeze({ action: ACTIONS.has(action) ? action : null, ok:false, code }); }
function sameSecret(actual, expected) {
  if (typeof actual !== 'string') return false;
  const value = Buffer.from(actual), reference = Buffer.from(expected);
  return value.length === reference.length && crypto.timingSafeEqual(value, reference);
}
/** Trusted Node API only. No browser-originated control, filesystem scan or sender. */
async function createPresentationHost(raw = {}) {
  if (!known(raw, ['snapshotDir','port','commandTimeoutMs','controllerOptions'])) invalid();
  const { snapshotDir, port = 0, commandTimeoutMs = 12000, controllerOptions = {} } = raw;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535 || !Number.isSafeInteger(commandTimeoutMs) || commandTimeoutMs < 100 || commandTimeoutMs > 59000 ||
      !known(controllerOptions, ['mode','intervalMs','transition','maxQueue'])) invalid();
  // Normalize/copy settings before any network bind, without accepting injected
  // renderer/scheduler/deck objects through the public configuration boundary.
  let settings;
  try {
    const probe = new SlideshowController({ ...controllerOptions, deck:{ id:'validation', slides:[{id:'validation',src:'validation'}] },
      renderer:{ show() {}, black() {} }, handlerTimeoutMs:commandTimeoutMs + 500 });
    settings = { mode:probe.mode, intervalMs:probe.intervalMs, transition:probe.transition, maxQueue:probe.maxQueue };
    await probe.close();
  } catch { invalid(); }
  const token = crypto.randomBytes(32).toString('base64url'), cookieValue = crypto.randomBytes(32).toString('base64url');
  const cookieName = 'piraidersPresentation_' + crypto.randomBytes(6).toString('hex');
  let origin = '', closed = false, closePromise, socket = null, epoch = null, ready = false, initTimer;
  let presentation = 'unverified', lastError = null, serial = 0, controller, invalidating = false;
  const pending = new Map(), connections = new Set(), assets = new Map();
  function trusted(req, requireOrigin = false) {
    const site = req.headers['sec-fetch-site'];
    return loopback(req.socket?.remoteAddress) && req.headers.host === origin.slice('http://'.length) &&
      (!requireOrigin || req.headers.origin === origin) && (req.headers.origin === undefined || req.headers.origin === origin) &&
      (site === undefined || site === 'same-origin' || site === 'none');
  }
  function cookie(req) {
    const entries = typeof req.headers.cookie === 'string' ? req.headers.cookie.split(';').map(value => value.trim()).filter(value => value.startsWith(cookieName + '=')) : [];
    return entries.length === 1 && sameSecret(entries[0].slice(cookieName.length + 1), cookieValue);
  }
  const media = await createSnapshotMediaHandler({ snapshotDir, authorize:req => !closed && trusted(req) && cookie(req) });
  function settle(id, error) {
    const operation = pending.get(id); if (!operation) return;
    pending.delete(id); clearTimeout(operation.timer); operation.signal?.removeEventListener('abort', operation.abort);
    if (error) operation.reject(error); else operation.resolve();
  }
  function newController(deck = media.deck, mode = settings.mode) {
    const instance = new SlideshowController({ ...settings, mode, deck, handlerTimeoutMs:commandTimeoutMs + 500,
      renderer:{ show:({ slide, transition, signal }) => rpc('show', {src:slide.src,transition}, signal), black:({signal}) => rpc('black', {}, signal) } });
    instance.on('fault', () => { if (controller === instance && !closed) invalidate('SESSION_TIMEOUT'); });
    return instance;
  }
  function invalidate(code = 'DISCONNECTED') {
    if (invalidating) return;
    invalidating = true; lastError = SESSION_CODES.has(code) ? code : 'PROTOCOL_ERROR';
    const previous = socket; socket = null; epoch = null; ready = false; presentation = 'unverified'; clearTimeout(initTimer);
    for (const id of [...pending.keys()]) settle(id, fail(code));
    if (controller) {
      const deck = controller.deck, mode = controller.snapshot().mode;
      void controller.close();
      if (!closed) controller = newController(deck, mode);
    }
    if (previous) { previous.disconnect(true); if (previous.conn.readyState !== 'closed') previous.conn.close(); }
    invalidating = false;
  }
  function rpc(type, frame, signal) {
    if (closed || !ready || !socket) return Promise.reject(fail(closed ? 'CLOSED' : 'NOT_READY'));
    if (signal.aborted) return Promise.reject(fail('CANCELED'));
    if (pending.size >= 2 || serial === Number.MAX_SAFE_INTEGER) { invalidate('PROTOCOL_ERROR'); return Promise.reject(fail('PROTOCOL_ERROR')); }
    const id = ++serial, current = socket, currentEpoch = epoch;
    return new Promise((resolve, reject) => {
      const operation = { type, signal, resolve, reject, aborted:false };
      operation.abort = () => {
        if (!pending.has(id) || operation.aborted) return;
        operation.aborted = true;
        if (type === 'show') current.emit('cancel', {epoch:currentEpoch,id});
        else invalidate('CANCELED');
      };
      operation.timer = setTimeout(() => { if (socket === current && epoch === currentEpoch) invalidate('SESSION_TIMEOUT'); }, commandTimeoutMs);
      pending.set(id, operation); signal.addEventListener('abort', operation.abort, {once:true});
      current.emit('command', {epoch:currentEpoch,id,type,...frame});
    });
  }
  controller = newController();
  function headers(res) {
    res.setHeader('Cache-Control','private, no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cross-Origin-Resource-Policy','same-origin'); res.setHeader('Referrer-Policy','no-referrer');
  }
  function empty(res, status) {
    if (res.destroyed || res.writableEnded) return;
    headers(res); res.statusCode = status; res.setHeader('Content-Length','0'); res.end();
  }
  const httpHandler = (req, res) => {
    // Catch all async work: HTTP clients never receive exception paths/tokens.
    void handle(req, res).catch(() => { if (res.headersSent) res.destroy(); else empty(res,503); });
  };
  const server = http.createServer({ maxHeaderSize:16384 }, httpHandler);
  server.maxConnections = 32; server.maxRequestsPerSocket = 64;
  server.headersTimeout = 5000; server.requestTimeout = 5000; server.keepAliveTimeout = 1000;
  server.setTimeout(15000, connection => connection.destroy());
  server.on('connection', connection => { connections.add(connection); connection.on('error', () => {}); connection.once('close', () => connections.delete(connection)); });
  server.on('clientError', (_error, connection) => connection.destroy());
  async function handle(req, res) {
    headers(res);
    if (closed) { empty(res,503); return; }
    if (!trusted(req)) { empty(res,403); return; }
    if (req.url === '/piraiders/session') {
      if (req.method !== 'POST') { res.setHeader('Allow','POST'); empty(res,405); return; }
      if (!trusted(req,true) || !sameSecret(req.headers.authorization, 'Bearer ' + token)) { empty(res,403); return; }
      if (req.headers['transfer-encoding'] !== undefined || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')) {
        res.setHeader('Connection','close'); empty(res,400); return;
      }
      res.setHeader('Set-Cookie', cookieName + '=' + cookieValue + '; Path=/piraiders/; HttpOnly; SameSite=Strict'); empty(res,204); return;
    }
    if (req.url.startsWith('/piraiders/media/')) { await media.handle(req,res); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow','GET, HEAD'); empty(res,405); return; }
    const asset = assets.get(req.url);
    if (!asset) { empty(res,404); return; }
    res.setHeader('Content-Type',asset.type); res.setHeader('Content-Length',String(asset.bytes.length));
    res.end(req.method === 'HEAD' ? undefined : asset.bytes);
  }
  const io = new Server(server, { path:'/piraiders/socket.io', serveClient:false, transports:['websocket'], allowUpgrades:false,
    maxHttpBufferSize:16384, perMessageDeflate:false, pingInterval:1000, pingTimeout:1500, connectTimeout:commandTimeoutMs,
    allowRequest:(req, done) => done(null, !closed && trusted(req,true) && cookie(req)) });
  // Engine.IO normally wraps HTTP requests for polling. This host supports
  // websocket upgrades only; restore our single guarded HTTP owner so even
  // the explicitly served client library obeys exact-path/Host/Origin policy.
  server.removeAllListeners('request'); server.on('request',httpHandler);
  io.use((candidate, next) => {
    if (closed || !trusted(candidate.request,true) || !cookie(candidate.request) || !exact(candidate.handshake.auth,['token']) ||
        !sameSecret(candidate.handshake.auth.token,token)) { next(fail('UNAUTHORIZED')); return; }
    if (socket) { next(fail('RENDERER_IN_USE')); return; }
    // Reserve synchronously in middleware so simultaneous authenticated sockets
    // cannot both pass admission before the connection callback executes.
    socket = candidate;
    // Socket.IO defers namespace connection to nextTick. Engine close can occur
    // after reservation but before its connection callback/listeners exist.
    candidate.conn.once('close', () => { if (socket === candidate) invalidate('DISCONNECTED'); });
    initTimer = setTimeout(() => { if (socket === candidate && !ready) invalidate('SESSION_TIMEOUT'); }, commandTimeoutMs);
    next();
  });
  io.on('connection', current => {
    if (closed || socket !== current) { current.disconnect(true); return; }
    epoch = crypto.randomUUID(); ready = false; presentation = 'unverified'; clearTimeout(initTimer);
    const currentEpoch = epoch;
    initTimer = setTimeout(() => { if (socket === current && !ready) invalidate('SESSION_TIMEOUT'); }, commandTimeoutMs);
    current.on('ready', value => {
      if (socket !== current) return;
      if (!exact(value,['epoch']) || typeof value.epoch !== 'string') { invalidate('PROTOCOL_ERROR'); return; }
      if (value.epoch !== currentEpoch || ready) return;
      clearTimeout(initTimer); ready = true; presentation = 'black'; lastError = null;
    });
    current.on('ack', value => {
      if (socket !== current) return;
      if ((!exact(value,['epoch','id','ok']) || value.ok !== true) &&
          (!exact(value,['epoch','id','ok','code']) || value.ok !== false || !ERROR_CODES.has(value.code))) { invalidate('PROTOCOL_ERROR'); return; }
      if (typeof value.epoch !== 'string' || !Number.isSafeInteger(value.id) || value.id < 1) { invalidate('PROTOCOL_ERROR'); return; }
      if (value.epoch !== currentEpoch) return;
      const operation = pending.get(value.id);
      if (!operation) { if (value.id > serial) invalidate('PROTOCOL_ERROR'); return; }
      if (!ready) { invalidate('PROTOCOL_ERROR'); return; }
      if (operation.aborted) { settle(value.id,fail('CANCELED')); return; }
      if (value.ok) { presentation = operation.type === 'black' ? 'black' : 'frame'; settle(value.id); }
      else if (operation.type === 'black') invalidate('BLACK_UNVERIFIED');
      else settle(value.id,fail(value.code));
    });
    current.on('disconnect', () => { if (socket === current) invalidate('DISCONNECTED'); });
    current.on('error', () => { if (socket === current) invalidate('PROTOCOL_ERROR'); });
    // Only ready/ack are input capabilities; other messages cannot control play.
    current.onAny(event => { if (!['ready','ack'].includes(event) && socket === current) invalidate('PROTOCOL_ERROR'); });
    current.emit('init',{epoch:currentEpoch});
  });
  try {
    const folder = path.resolve(__dirname,'../../ASSETS/templates/piraiders/slideshow');
    for (const [name,type] of ASSETS) {
      const bytes = await fs.readFile(path.join(folder,name));
      if (bytes.length > 128 * 1024) throw fail('ASSET_LIMIT');
      assets.set(TEMPLATE_ROOT + name,{type,bytes});
    }
    const clientPath = path.resolve(path.dirname(require.resolve('socket.io')), '../client-dist/socket.io.min.js');
    const clientBytes = await fs.readFile(clientPath);
    if (clientBytes.length > 256 * 1024) throw fail('ASSET_LIMIT');
    assets.set('/piraiders/socket.io/socket.io.js', {type:'text/javascript; charset=utf-8',bytes:clientBytes});
    await new Promise((resolve,reject) => {
      const failed = () => { server.off('listening',listening); reject(fail('LISTEN_FAILED')); };
      const listening = () => { server.off('error',failed); resolve(); };
      server.once('error',failed); server.once('listening',listening); server.listen(port,'127.0.0.1');
    });
    origin = new URL('http://127.0.0.1:' + server.address().port).origin;
  } catch {
    closed = true; invalidate('CLOSED'); media.close(); io.close();
    for (const connection of connections) connection.destroy();
    throw fail('START_FAILED');
  }
  server.on('error', () => { if (!closed) invalidate('LISTEN_FAILED'); });
  function snapshot() { return Object.freeze({ controller:controller.snapshot(), renderer:Object.freeze({connected:!!socket,ready,presentation,epoch,pending:pending.size,lastError}),closed }); }
  function dispatch(action) {
    if (typeof action !== 'string' || !ACTIONS.has(action)) return Promise.resolve(result(null,'INVALID_COMMAND'));
    if (closed) return Promise.resolve(result(action,'CLOSED'));
    if (!ready) return Promise.resolve(result(action,'NOT_READY'));
    return controller.dispatch(action);
  }
  function close() {
    if (closePromise) return closePromise;
    closed = true; socket?.emit('shutdown'); invalidate('CLOSED'); media.close();
    for (const connection of connections) connection.destroy();
    closePromise = new Promise(resolve => {
      const timer = setTimeout(resolve,1000); timer.unref();
      io.close(() => { clearTimeout(timer); resolve(); });
    });
    return closePromise;
  }
  return Object.freeze({origin,getProgramURL() { if (closed) throw fail('CLOSED'); return origin + TEMPLATE_ROOT + 'SLIDESHOW.html#piraiders=' + token; },dispatch,snapshot,close});
}
module.exports = { createPresentationHost };
