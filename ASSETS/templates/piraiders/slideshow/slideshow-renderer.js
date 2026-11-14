(function (global) {
  'use strict';
  const MAX_DURATION = 10000;
  function failure(code) { const error = new Error(code); error.code = code; return error; }
  function sourceURL(src, base) {
    if (typeof src !== 'string' || !src || src.length > 2048 || src !== src.trim() || /[\\?#\u0000-\u001f]/.test(src) || src.startsWith('//')) throw failure('INVALID_SOURCE');
    let url;
    try {
      // Check the original spelling before URL normalization can erase traversal.
      const spelling = src.replace(/^[a-z]+:\/\/[^/]+/i, '');
      if (spelling.split('/').some(part => { const decoded = decodeURIComponent(part); return decoded === '.' || decoded === '..' || /[\\/%?#\u0000-\u001f]/.test(decoded); })) throw failure('INVALID_SOURCE');
      url = new URL(src, base);
    } catch (_) { throw failure('INVALID_SOURCE'); }
    if (!/^https?:$/.test(url.protocol) || url.origin !== base.origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(base.pathname) || !/\.(?:jpe?g|png)$/i.test(url.pathname)) throw failure('INVALID_SOURCE');
    return url.href;
  }
  function transitionOf(value) {
    if (value === undefined) return { type: 'cut', durationMs: 0 };
    if (!value || typeof value !== 'object' || Array.isArray(value) || !['cut', 'fade'].includes(value.type)) throw failure('INVALID_TRANSITION');
    const durationMs = value.durationMs === undefined ? (value.type === 'fade' ? 1000 : 0) : value.durationMs;
    if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > MAX_DURATION || (value.type === 'cut' && durationMs !== 0)) throw failure('INVALID_TRANSITION');
    return { type: value.type, durationMs: value.type === 'cut' ? 0 : durationMs };
  }
  class PiRaidersSlideshowRenderer {
    constructor({ root, mediaRoot = '/piraiders/media/', loadTimeoutMs = 10000 } = {}) {
      if (!root || root.nodeType !== 1) throw failure('INVALID_ROOT');
      if (!Number.isFinite(loadTimeoutMs) || loadTimeoutMs <= 0 || loadTimeoutMs > MAX_DURATION) throw failure('INVALID_TIMEOUT');
      let base;
      try { base = new URL(mediaRoot, global.location.href); } catch (_) { throw failure('INVALID_SOURCE'); }
      if (typeof mediaRoot !== 'string' || !/^https?:$/.test(base.protocol) || base.origin !== global.location.origin || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/') || /[\\?#%\u0000-\u001f]/.test(mediaRoot) || /(?:^|\/)\.\.?\//.test(mediaRoot)) throw failure('INVALID_SOURCE');
      this.root = root; this.base = base; this.loadTimeoutMs = loadTimeoutMs;
      this.disposed = false; this.generation = 0; this.active = null; this.front = null;
      this.source = null; this.mode = null; this.reload = 'complete'; this.state = 'black'; this.lastError = null;
      root.classList.add('piraiders-slideshow');
      this.layers = [new Image(), new Image()];
      this.layers.forEach(layer => { layer.className = 'piraiders-slide'; layer.alt = ''; layer.draggable = false; root.appendChild(layer); });
      this.modeNode = document.createElement('div'); this.modeNode.className = 'piraiders-mode'; root.appendChild(this.modeNode);
      this.reloadNode = document.createElement('div'); this.reloadNode.className = 'piraiders-reload'; this.reloadNode.hidden = true; root.appendChild(this.reloadNode);
      this.modeAnimation = null; this.reloadAnimation = null; this.reloadTimer = null;
    }
    _cancel() { if (this.active) this.active.cancel('CANCELED'); }
    _clearLayer(layer) { layer.onload = null; layer.onerror = null; layer.style.opacity = '0'; layer.removeAttribute('src'); }
    validateFrame(frame) {
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw failure('INVALID_PAYLOAD');
      return { src: sourceURL(frame.src, this.base), transition: transitionOf(frame.transition) };
    }
    show(frame) {
      if (this.disposed) return Promise.reject(failure('DISPOSED'));
      let src, transition;
      try { src = sourceURL(frame && frame.src, this.base); transition = transitionOf(frame.transition); } catch (error) { this.lastError = error.code; return Promise.reject(error); }
      const signal = frame.signal;
      if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) return Promise.reject(failure('INVALID_SIGNAL'));
      if (signal && signal.aborted) return Promise.reject(failure('CANCELED'));
      this._cancel();
      const generation = ++this.generation;
      const layer = this.layers.find(item => item !== this.front);
      this._clearLayer(layer); this.state = 'loading'; this.lastError = null;
      return new Promise((resolve, reject) => {
        let settled = false, timeout = null, transitionTimeout = null, animation = null;
        const rafs = new Set();
        const valid = () => !settled && !this.disposed && generation === this.generation;
        const cleanup = () => {
          clearTimeout(timeout); clearTimeout(transitionTimeout);
          rafs.forEach(id => { try { global.cancelAnimationFrame(id); } catch (_) { /* Already fenced. */ } }); rafs.clear();
          if (animation) { try { animation.cancel(); } catch (_) { /* Already fenced. */ } }
          layer.onload = null; layer.onerror = null; if (signal) signal.removeEventListener('abort', abort);
        };
        const fail = code => { if (settled) return; settled = true; cleanup(); this._clearLayer(layer); if (this.active === operation) this.active = null; this.state = this.front ? 'ready' : 'black'; this.lastError = code; reject(failure(code)); };
        const abort = () => fail('CANCELED');
        const operation = { cancel: fail }; this.active = operation;
        const tick = callback => {
          try {
            const id = global.requestAnimationFrame(() => {
              rafs.delete(id);
              if (valid()) { try { callback(); } catch (_) { fail('TRANSITION_FAILED'); } }
            });
            rafs.add(id);
          } catch (_) { if (valid()) fail('TRANSITION_FAILED'); }
        };
        const commit = () => {
          if (!valid()) return;
          layer.style.opacity = '1';
          // Two frame boundaries ensure the successful promise follows a presented DOM frame.
          tick(() => tick(() => {
            if (this.front) this._clearLayer(this.front);
            this.front = layer; this.source = src; this.state = 'ready'; this.lastError = null;
            settled = true; cleanup(); layer.style.opacity = '1'; this.active = null;
            resolve(this.snapshot());
          }));
        };
        const decoded = () => {
          if (!valid()) return;
          clearTimeout(timeout); timeout = null;
          if (!layer.naturalWidth || !layer.naturalHeight) { fail('LOAD_FAILED'); return; }
          transitionTimeout = setTimeout(() => { if (valid()) fail('TRANSITION_FAILED'); }, transition.durationMs + 1000);
          try {
            layer.style.zIndex = '2'; if (this.front) this.front.style.zIndex = '1';
            if (transition.type === 'fade' && transition.durationMs > 0) {
              this.state = 'transitioning';
              animation = layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: transition.durationMs, easing: 'linear', fill: 'forwards' });
              animation.finished.then(() => {
                if (valid()) { try { commit(); } catch (_) { fail('TRANSITION_FAILED'); } }
              }, () => { if (valid()) fail('TRANSITION_FAILED'); });
            } else commit();
          } catch (_) { if (valid()) fail('TRANSITION_FAILED'); }
        };
        if (signal) signal.addEventListener('abort', abort, { once: true });
        timeout = setTimeout(() => fail('LOAD_TIMEOUT'), this.loadTimeoutMs);
        layer.onerror = () => { if (valid()) fail('LOAD_FAILED'); };
        layer.src = src;
        // decode() checks the actual image bytes, including cached image candidates.
        try { layer.decode().then(decoded, () => { if (valid()) fail('LOAD_FAILED'); }); } catch (_) { fail('LOAD_FAILED'); }
      });
    }
    showMode(mode) {
      if (this.disposed) throw failure('DISPOSED');
      if (!['auto', 'manual'].includes(mode)) throw failure('INVALID_MODE');
      if (this.modeAnimation) this.modeAnimation.cancel();
      this.modeAnimation = null;
      this.mode = mode;
      if (!this.front) { this.modeNode.textContent = ''; this.modeNode.style.opacity = '0'; return; }
      this.modeNode.textContent = mode.toUpperCase();
      const rise = 12 * this.root.clientHeight / 1080;
      this.modeAnimation = this.modeNode.animate([
        { opacity: 0, transform: `translateY(${rise}px)`, offset: 0, easing: 'cubic-bezier(.16,1,.3,1)' },
        { opacity: .75, transform: 'translateY(0)', offset: .1875, easing: 'linear' },
        { opacity: .75, transform: 'translateY(0)', offset: .8125 },
        { opacity: 0, transform: 'translateY(0)', offset: 1 }
      ], { duration: 1600, easing: 'linear', fill: 'forwards' });
    }
    setReloadState(state) {
      if (this.disposed) throw failure('DISPOSED');
      if (!['loading', 'complete', 'failed'].includes(state)) throw failure('INVALID_RELOAD');
      clearTimeout(this.reloadTimer); this.reloadTimer = null;
      if (this.reloadAnimation) this.reloadAnimation.cancel(); this.reloadAnimation = null;
      this.reload = state; this.reloadNode.replaceChildren(); this.reloadNode.dataset.state = state; this.reloadNode.hidden = state === 'complete';
      if (!this.front) { this.reloadNode.hidden = true; return; }
      if (state === 'loading') {
        const spinner = document.createElement('span'); spinner.className = 'piraiders-spinner'; this.reloadNode.appendChild(spinner);
        this.reloadAnimation = spinner.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 800, iterations: Infinity });
      } else if (state === 'failed') {
        this.reloadNode.textContent = 'RELOAD FAILED';
        this.reloadTimer = setTimeout(() => { this.reloadNode.hidden = true; this.reloadTimer = null; }, 1800);
      }
    }
    black() {
      ++this.generation; this._cancel(); this.layers.forEach(layer => this._clearLayer(layer)); this.front = null; this.source = null; this.state = 'black'; this.lastError = null;
      if (this.modeAnimation) this.modeAnimation.cancel(); this.modeAnimation = null; this.modeNode.textContent = ''; this.modeNode.style.opacity = '0'; this.mode = null;
      if (this.reloadAnimation) this.reloadAnimation.cancel(); this.reloadAnimation = null; clearTimeout(this.reloadTimer); this.reloadTimer = null;
      this.reloadNode.replaceChildren(); this.reloadNode.hidden = true; this.reload = 'complete';
    }
    snapshot() { return Object.freeze({ state: this.disposed ? 'disposed' : this.state, src: this.source, mode: this.mode, reload: this.reload, pending: !!this.active, error: this.lastError }); }
    dispose() { if (this.disposed) return; this.black(); this.disposed = true; this.layers.forEach(layer => layer.remove()); this.modeNode.remove(); this.reloadNode.remove(); }
  }
  global.PiRaidersSlideshowRenderer = PiRaidersSlideshowRenderer;
})(window);
