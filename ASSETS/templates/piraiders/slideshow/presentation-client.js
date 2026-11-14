(function (global) {
  'use strict';
  // Returning to the credential-bearing program URL can be a same-document
  // navigation after fragment redaction. Only that explicit navigation reloads
  // the document; a disconnected session never retries on its own.
  const managedFragment = /^#piraiders=([A-Za-z0-9_-]{43})$/;
  global.addEventListener('hashchange', () => {
    if (managedFragment.test(global.location.hash)) global.location.reload();
  });
  // Ordinary SPX use never starts a session or changes lifecycle functions.
  let fragment = managedFragment.exec(global.location.hash);
  if (!fragment) return;
  let capability = fragment[1]; fragment = null;
  const renderer = global.piraidersRenderer;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const CODES = new Set(['INVALID_SOURCE', 'INVALID_TRANSITION', 'INVALID_SIGNAL', 'INVALID_PAYLOAD',
    'LOAD_FAILED', 'LOAD_TIMEOUT', 'CANCELED', 'DISPOSED', 'TRANSITION_FAILED']);
  let socket = null, epoch = null, ready = false, closed = false, lastID = 0;
  let bootstrap = null, library = null, initialPaint = null;
  const operations = new Map();
  function record(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function exact(value, keys) { return record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
  function identifier(value) { return Number.isSafeInteger(value) && value > 0; }
  function failure(code) { const error = new Error(code); error.code = code; return error; }
  function black() { try { renderer?.black(); } catch (_) { /* Teardown must remain bounded. */ } }
  function clearAuth() {
    if (!socket) return;
    if (record(socket.auth)) delete socket.auth.token;
    socket.auth = {};
  }
  function terminate() {
    if (closed) return;
    closed = true; ready = false; capability = null;
    bootstrap?.abort(); bootstrap = null;
    library?.cancel(); library = null;
    initialPaint?.cancel(); initialPaint = null;
    for (const operation of operations.values()) operation.cancel();
    operations.clear(); black();
    if (socket) { clearAuth(); socket.disconnect(); }
  }
  const managed = () => Promise.resolve({ ok: false, error: 'MANAGED_OUTPUT' });
  global.play = managed; global.next = managed; global.update = managed;
  global.stop = function () { terminate(); return Promise.resolve({ ok: true }); };
  global.addEventListener('pagehide', terminate, { once: true });
  global.addEventListener('beforeunload', terminate, { once: true });
  // A fragment is never sent over HTTP; remove it before creating requests or
  // loading the transport. No credential is written into HTML or frame URLs.
  try {
    global.history.replaceState(global.history.state, '', global.location.pathname + global.location.search);
    if (!renderer || typeof renderer.show !== 'function' || typeof renderer.black !== 'function') throw failure('DISPOSED');
    renderer.black();
    if (!stylesReady()) throw failure('TRANSITION_FAILED');
  } catch (_) { terminate(); return; }

  function stylesReady() {
    try {
      const link = document.querySelector('link[rel="stylesheet"][href="slideshow.css"]');
      if (!link || !link.sheet || link.sheet.disabled || !link.sheet.cssRules.length) return false;
      const root = document.getElementById('slideshow'), image = root?.querySelector('.piraiders-slide');
      if (!root || !image || global.innerWidth <= 0 || global.innerHeight <= 0) return false;
      const rect = root.getBoundingClientRect(), rootStyle = global.getComputedStyle(root), imageStyle = global.getComputedStyle(image);
      return Math.abs(rect.x) <= 1 && Math.abs(rect.y) <= 1 &&
        Math.abs(rect.width - global.innerWidth) <= 1 && Math.abs(rect.height - global.innerHeight) <= 1 &&
        rootStyle.position === 'relative' && rootStyle.overflow === 'hidden' && rootStyle.backgroundColor === 'rgb(0, 0, 0)' &&
        imageStyle.position === 'absolute' && imageStyle.objectFit === 'contain';
    } catch (_) { return false; }
  }

  function painted() {
    let done = false, timer = null, rejectWait;
    const frames = new Set();
    const cleanup = () => {
      clearTimeout(timer);
      for (const id of frames) { try { global.cancelAnimationFrame(id); } catch (_) { /* Fenced. */ } }
      frames.clear();
    };
    const finish = (resolve, reject, ok) => {
      if (done) return; done = true; cleanup();
      if (ok) resolve(); else reject(failure('TRANSITION_FAILED'));
    };
    const promise = new Promise((resolve, reject) => {
      rejectWait = () => finish(resolve, reject, false);
      timer = setTimeout(rejectWait, 1000);
      const tick = callback => {
        try {
          const id = global.requestAnimationFrame(() => {
            frames.delete(id); if (!done) callback();
          });
          frames.add(id);
        } catch (_) { rejectWait(); }
      };
      tick(() => tick(() => finish(resolve, reject, true)));
    });
    return { promise, cancel() { rejectWait(); } };
  }
  function acknowledge(operation, ok, error) {
    if (operations.get(operation.id) !== operation) return;
    operations.delete(operation.id);
    if (closed || !ready || operation.epoch !== epoch || !socket?.connected) return;
    const message = { epoch, id: operation.id, ok };
    if (!ok) message.code = CODES.has(error?.code) ? error.code : 'TRANSITION_FAILED';
    socket.emit('ack', message);
  }
  function onInit(value) {
    if (closed || !exact(value, ['epoch']) || typeof value.epoch !== 'string' || !UUID.test(value.epoch) || epoch !== null) { terminate(); return; }
    epoch = value.epoch;
    try {
      renderer.black();
      if (!stylesReady()) throw failure('TRANSITION_FAILED');
    } catch (_) { terminate(); return; }
    const pending = painted(); initialPaint = pending;
    pending.promise.then(() => {
      if (closed || initialPaint !== pending || !socket?.connected) return;
      if (!stylesReady()) { terminate(); return; }
      initialPaint = null; ready = true; socket.emit('ready', { epoch });
    }, terminate);
  }
  function onCommand(value) {
    if (closed) return;
    if (!ready || !record(value) || value.epoch !== epoch || !identifier(value.id) || value.id <= lastID ||
        (value.type === 'show' ? !exact(value, ['epoch', 'id', 'type', 'src', 'transition']) :
          value.type !== 'black' || !exact(value, ['epoch', 'id', 'type']))) { terminate(); return; }
    if (value.type === 'show') {
      if (operations.size || typeof value.src !== 'string' || value.src.length > 2048 ||
          !exact(value.transition, ['type', 'durationMs'])) { terminate(); return; }
      lastID = value.id;
      const abort = new AbortController();
      const operation = { id: value.id, epoch, type: 'show', cancel: () => abort.abort() };
      operations.set(value.id, operation);
      try {
        Promise.resolve(renderer.show({ src: value.src, transition: value.transition, signal: abort.signal }))
          .then(() => acknowledge(operation, true), error => acknowledge(operation, false, error));
      } catch (error) { acknowledge(operation, false, error); }
      return;
    }
    // Stop may overlap exactly one canceled show with one black. The native
    // renderer's generation fence prevents its late decode/paint from returning.
    if (operations.size > 1 || [...operations.values()].some(operation => operation.type !== 'show')) { terminate(); return; }
    lastID = value.id;
    for (const operation of operations.values()) operation.cancel();
    try { renderer.black(); } catch (_) { terminate(); return; }
    const wait = painted();
    const operation = { id: value.id, epoch, type: 'black', cancel: () => wait.cancel() };
    operations.set(value.id, operation);
    wait.promise.then(() => acknowledge(operation, true), error => {
      acknowledge(operation, false, error); terminate();
    });
  }
  function onCancel(value) {
    if (closed) return;
    if (!ready || !exact(value, ['epoch', 'id']) || value.epoch !== epoch || !identifier(value.id) || value.id > lastID) { terminate(); return; }
    const operation = operations.get(value.id);
    if (operation?.type === 'show') operation.cancel();
    else if (operation) terminate();
    // A completed show may already have its ACK in flight when Stop aborts it.
    // The following black command remains the required Stop completion fence.
  }
  function loadLibrary() {
    let script, timer, resolveWait, rejectWait, done = false;
    const cleanup = () => { clearTimeout(timer); if (script) { script.onload = null; script.onerror = null; script.remove(); } };
    const finish = ok => {
      if (done) return; done = true; cleanup();
      if (ok) resolveWait(); else rejectWait(failure('TRANSITION_FAILED'));
    };
    const promise = new Promise((resolve, reject) => {
      resolveWait = resolve; rejectWait = reject;
      script = document.createElement('script'); script.src = '/piraiders/socket.io/socket.io.js'; script.async = true;
      script.onload = () => finish(typeof global.io === 'function'); script.onerror = () => finish(false);
      timer = setTimeout(() => finish(false), 3000);
      document.head.appendChild(script);
    });
    return { promise, cancel() { finish(false); } };
  }
  async function connect() {
    const controller = new AbortController(); bootstrap = controller;
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await global.fetch('/piraiders/session', {
        method: 'POST', headers: { Authorization: 'Bearer ' + capability },
        credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal
      });
      if (closed || response.status !== 204) throw failure('TRANSITION_FAILED');
    } finally { clearTimeout(timer); if (bootstrap === controller) bootstrap = null; }
    if (closed) return;
    const pendingLibrary = loadLibrary(); library = pendingLibrary;
    await pendingLibrary.promise;
    if (library === pendingLibrary) library = null;
    if (closed) return;
    socket = global.io(global.location.origin, {
      path: '/piraiders/socket.io', transports: ['websocket'], upgrade: false,
      auth: { token: capability }, reconnection: false, timeout: 3000
    });
    socket.on('connect', () => { clearAuth(); capability = null; });
    socket.on('init', onInit); socket.on('command', onCommand); socket.on('cancel', onCancel);
    socket.on('shutdown', terminate); socket.on('disconnect', terminate); socket.on('connect_error', terminate); socket.on('error', terminate);
  }
  connect().catch(terminate);
})(window);
