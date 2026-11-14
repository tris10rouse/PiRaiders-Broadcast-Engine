(function (global) {
  'use strict';
  // This adapter accepts explicit frames only. Deck order, mode scheduling and
  // media acquisition belong to the future trusted presentation adapter.
  const renderer = new global.PiRaidersSlideshowRenderer({ root: document.getElementById('slideshow') });
  global.piraidersRenderer = renderer;
  let pending = null;
  let playing = false;
  let revision = 0;
  function badPayload() { const error = new Error('INVALID_PAYLOAD'); error.code = 'INVALID_PAYLOAD'; return error; }
  function record(value) { return value && typeof value === 'object' && !Array.isArray(value); }
  function parse(data) {
    if (typeof data !== 'string' || data.length > 32768) throw badPayload();
    let envelope, frame;
    try {
      envelope = JSON.parse(data);
      if (!record(envelope) || Object.keys(envelope).some(key => !['f0', 'comment', 'epochID'].includes(key)) || typeof envelope.f0 !== 'string' || envelope.f0.length > 16384) throw badPayload();
      frame = JSON.parse(envelope.f0);
    } catch (_) { throw badPayload(); }
    if (!record(frame) || Object.keys(frame).some(key => !['src', 'transition', 'mode', 'reload'].includes(key))) throw badPayload();
    if (frame.transition !== undefined && (!record(frame.transition) || Object.keys(frame.transition).some(key => !['type', 'durationMs'].includes(key)))) throw badPayload();
    if (frame.mode !== undefined && !['auto', 'manual'].includes(frame.mode)) throw badPayload();
    if (frame.reload !== undefined && !['loading', 'complete', 'failed'].includes(frame.reload)) throw badPayload();
    const validated = renderer.validateFrame(frame);
    if (frame.mode !== undefined) validated.mode = frame.mode;
    if (frame.reload !== undefined) validated.reload = frame.reload;
    return validated;
  }
  function resultError(error) { return { ok: false, error: error && typeof error.code === 'string' ? error.code : 'INVALID_PAYLOAD' }; }
  function apply() {
    const currentRevision = ++revision;
    if (!playing || !pending) return Promise.resolve({ ok: true });
    const frame = pending;
    const hasFrame = renderer.snapshot().src !== null;
    const feedback = () => {
      if (frame.mode !== undefined) renderer.showMode(frame.mode);
      if (frame.reload !== undefined) renderer.setReloadState(frame.reload);
    };
    if (hasFrame) feedback();
    return renderer.show(frame).then(() => {
      if (!hasFrame && playing && revision === currentRevision) feedback();
      return { ok: true };
    }, resultError);
  }
  global.update = function (data) {
    try { pending = parse(data); return apply(); } catch (error) { return Promise.resolve(resultError(error)); }
  };
  global.play = function () { playing = true; return apply(); };
  global.next = function (data) {
    if (data !== undefined && data !== null) return global.update(data);
    return Promise.resolve({ ok: true });
  };
  global.stop = function () { ++revision; playing = false; renderer.black(); return Promise.resolve({ ok: true }); };
})(window);
