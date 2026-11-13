'use strict';
const { EventEmitter } = require('node:events');
const { performance } = require('node:perf_hooks');
const ACTIONS = new Set(['launch', 'next', 'previous', 'auto', 'manual', 'toggle-auto', 'stop']);
function plain(value) { return value && typeof value === 'object' && [null, Object.prototype].includes(Object.getPrototypeOf(value)); }
function exact(value, keys) { return plain(value) && Reflect.ownKeys(value).every(key => keys.includes(key)); }
function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function integer(value, low, high) { return Number.isInteger(value) && value >= low && value <= high; }
function normalizeDeck(deck) {
  if (!exact(deck, ['id', 'slides']) || !text(deck.id) || !Array.isArray(deck.slides) || !deck.slides.length) throw Error('Invalid slideshow deck');
  const ids = new Set();
  const slides = Array.from(deck.slides, slide => {
    if (!exact(slide, ['id', 'src']) || !text(slide.id) || !text(slide.src) || ids.has(slide.id)) throw Error('Invalid slideshow slide');
    ids.add(slide.id); return Object.freeze({ id: slide.id, src: slide.src });
  });
  return Object.freeze({ id: deck.id, slides: Object.freeze(slides) });
}
/**
 * State authority only: the renderer owns presentation, never media discovery or
 * sender lifetime. Renderer promises must resolve after presentation commits.
 * show/black MUST honor signal cancellation before any later physical effect.
 * Generation fences prevent stale state commits but cannot undo physical effects
 * from an adapter that ignores cancellation. A timeout therefore faults terminally.
 * Stop may overlap one aborted show with one black; repeated Stops share black.
 * A preempted operation keeps its watchdog and blocks new shows until settlement.
 * dispatch resolves fixed result objects; callers must explicitly translate
 * {ok:false} into rejection when integrating a transport that expects throws.
 */
class SlideshowController extends EventEmitter {
  constructor({ deck, renderer, scheduler = { now: () => performance.now(), setTimeout, clearTimeout },
    intervalMs = 10000, mode = 'auto', transition = { type: 'cut', durationMs: 0 }, maxQueue = 32, handlerTimeoutMs = 2000 } = {}) {
    super(); this.deck = normalizeDeck(deck);
    if (!renderer || typeof renderer.show !== 'function' || typeof renderer.black !== 'function') throw Error('Explicit renderer required');
    if (!scheduler || !['now', 'setTimeout', 'clearTimeout'].every(key => typeof scheduler[key] === 'function')) throw Error('Invalid scheduler');
    if (!integer(intervalMs, 1, 3600000) || !integer(maxQueue, 1, 256) || !integer(handlerTimeoutMs, 1, 60000) || !['auto', 'manual'].includes(mode)) throw Error('Invalid slideshow configuration');
    if (!exact(transition, ['type', 'durationMs']) || !['cut', 'fade'].includes(transition.type)) throw Error('Invalid transition');
    transition = { ...transition, durationMs: transition.durationMs === undefined ? (transition.type === 'fade' ? 1000 : 0) : transition.durationMs };
    if (!integer(transition.durationMs, 0, 10000) || (transition.type === 'cut' && transition.durationMs !== 0) ||
      handlerTimeoutMs <= transition.durationMs) throw Error('Invalid transition duration or render timeout');
    Object.assign(this, { renderer, scheduler, intervalMs, maxQueue, handlerTimeoutMs, mode });
    this.transition = Object.freeze({ ...transition }); this.state = 'stopped'; this.index = null;
    this.autoSuspended = false; this.closed = false; this.faulted = false;
    this.queue = []; this.active = null; this.operations = new Set(); this.stopRequest = null;
    this.generation = 0; this.timerFence = 0; this.timer = null; this.nextAdvanceAt = null;
  }
  snapshot() { return Object.freeze({ state: this.state, mode: this.mode, deckId: this.deck.id,
    index: this.index, slide: this.index === null ? null : this.deck.slides[this.index],
    transition: this.transition, autoSuspended: this.autoSuspended, nextAdvanceAt: this.nextAdvanceAt,
    queued: this.queue.length, busy: this.active !== null || this.operations.size > 0,
    outstandingRenders: this.operations.size, closed: this.closed, faulted: this.faulted }); }
  changed() { this.emit('change', this.snapshot()); }
  clearTimer() {
    this.timerFence++; if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null; this.nextAdvanceAt = null;
  }
  armTimer() {
    this.clearTimer();
    if (this.closed || this.faulted || this.state !== 'playing' || this.mode !== 'auto' || this.autoSuspended) return;
    const fence = this.timerFence; this.nextAdvanceAt = this.scheduler.now() + this.intervalMs;
    this.timer = this.scheduler.setTimeout(() => {
      if (fence !== this.timerFence || this.closed || this.faulted) return;
      this.timer = null; this.nextAdvanceAt = null;
      void this.enqueue('next', true);
    }, this.intervalMs);
  }
  result(action, ok, code) { const value = Object.freeze({ action, ok, ...(code ? { code } : {}) }); this.emit('result', value); return value; }
  dispatch(input) {
    const action = typeof input === 'string' ? input : input?.action;
    const signal = typeof input === 'object' && input !== null ? input.signal : undefined;
    if (!ACTIONS.has(action)) return Promise.resolve(this.result(typeof action === 'string' && ACTIONS.has(action) ? action : null, false, 'UNKNOWN_ACTION'));
    if (signal !== undefined && !(signal instanceof AbortSignal)) return Promise.resolve(this.result(action, false, 'INVALID_SIGNAL'));
    if (this.closed || this.faulted) return Promise.resolve(this.result(action, false, this.faulted ? 'FAULTED' : 'CLOSED'));
    if (signal?.aborted) return Promise.resolve(this.result(action, false, 'CANCELLED'));
    if (action === 'stop') {
      // Coalesce repeated black requests while black or its preempted show is
      // outstanding. A completed black does not release an orphan's barrier.
      if (this.stopRequest) {
        this.clearTimer();
        for (const request of this.queue.splice(0)) this.finish(request, false, 'CANCELLED');
        return this.stopRequest.promise;
      }
      this.preempt();
    }
    return this.enqueue(action, false, signal);
  }
  enqueue(action, automatic, signal) {
    if (this.closed || this.faulted) return Promise.resolve(this.result(action, false, this.faulted ? 'FAULTED' : 'CLOSED'));
    if (this.queue.length >= this.maxQueue) return Promise.resolve(this.result(action, false, 'BUSY'));
    const request = { action, automatic, signal };
    const promise = new Promise(resolve => { request.resolve = resolve; });
    request.promise = promise;
    if (action === 'stop') this.stopRequest = request;
    request.abort = () => {
      if (request.done) return;
      if (this.active === request) {
        // Settle the caller now, but retain the serial barrier until the
        // cancelled adapter returns (or faults on timeout). Stop alone may
        // preempt this barrier under the renderer cancellation contract.
        request.cancelled = true; request.controller?.abort(); this.clearTimer(); this.autoSuspended = true;
        if (!request.responded) { request.responded = true; request.resolve(this.result(action, false, 'CANCELLED')); }
        this.changed();
      } else {
        this.queue = this.queue.filter(item => item !== request); this.finish(request, false, 'CANCELLED');
      }
    };
    this.queue.push(request); signal?.addEventListener('abort', request.abort, { once: true }); this.pump();
    return promise;
  }
  finish(request, ok, code) {
    if (request.done) return; request.done = true;
    request.signal?.removeEventListener('abort', request.abort);
    // Preemption settles callers, but keeps the independent physical-operation
    // deadline until the adapter really returns. Never abandon a stuck render.
    if (request.timeout !== undefined && (!this.operations.has(request) || this.closed || this.faulted)) this.scheduler.clearTimeout(request.timeout);
    if (this.active === request) this.active = null;
    if (!request.responded) { request.responded = true; request.resolve(this.result(request.action, ok, code)); }
    if (!this.operations.size && this.stopRequest?.done) this.stopRequest = null;
  }
  preempt() {
    this.generation++; this.clearTimer();
    for (const request of this.queue.splice(0)) this.finish(request, false, 'CANCELLED');
    if (this.active) { const request = this.active; request.controller?.abort(); this.finish(request, false, 'CANCELLED'); }
  }
  pump() {
    if (this.active || this.closed || this.faulted || !this.queue.length) return;
    if (this.operations.size && this.queue[0].action !== 'stop') return;
    const request = this.queue.shift(); this.active = request;
    const { action } = request;
    if (['auto', 'manual', 'toggle-auto'].includes(action)) {
      this.mode = action === 'toggle-auto' ? (this.mode === 'auto' ? 'manual' : 'auto') : action;
      this.autoSuspended = false; this.armTimer(); this.finish(request, true); this.changed(); this.pump(); return;
    }
    if (action !== 'launch' && action !== 'stop' && this.state !== 'playing') {
      this.finish(request, false, 'NOT_PLAYING'); this.pump(); return;
    }
    this.clearTimer();
    const index = action === 'launch' ? 0 : action === 'stop' ? null :
      (this.index + (action === 'previous' ? -1 : 1) + this.deck.slides.length) % this.deck.slides.length;
    const generation = this.generation;
    request.controller = new AbortController();
    request.timeout = this.scheduler.setTimeout(() => {
      if (this.closed || this.faulted || (request.done && !this.operations.has(request))) return;
      this.faulted = true; this.state = 'faulted'; request.controller.abort();
      this.finish(request, false, 'RENDER_TIMEOUT'); this.preempt();
      for (const operation of this.operations) this.scheduler.clearTimeout(operation.timeout);
      this.emit('fault', Object.freeze({ code: 'RENDER_TIMEOUT' })); this.changed();
    }, this.handlerTimeoutMs);
    Promise.resolve().then(() => {
      if (request.done || request.cancelled || generation !== this.generation) return;
      const signal = request.controller.signal;
      this.operations.add(request);
      return action === 'stop' ? this.renderer.black(Object.freeze({ signal })) :
        this.renderer.show(Object.freeze({ deckId: this.deck.id, slide: this.deck.slides[index], index, transition: this.transition, signal }));
    }).then(() => {
      this.operationSettled(request);
      if (request.done || generation !== this.generation) { this.pump(); return; }
      if (request.cancelled) { this.finish(request, false, 'CANCELLED'); this.pump(); return; }
      this.index = index; this.state = action === 'stop' ? 'stopped' : 'playing'; this.autoSuspended = false;
      this.armTimer(); this.finish(request, true); this.changed(); this.pump();
    }, () => {
      this.operationSettled(request);
      if (request.done || generation !== this.generation) { this.pump(); return; }
      if (request.cancelled) { this.finish(request, false, 'CANCELLED'); this.pump(); return; }
      this.autoSuspended = true; this.finish(request, false, 'RENDER_FAILED'); this.changed(); this.pump();
    });
  }
  operationSettled(request) {
    this.operations.delete(request); this.scheduler.clearTimeout(request.timeout);
    if (!this.operations.size && this.stopRequest?.done) this.stopRequest = null;
  }
  close() {
    if (this.closed) return Promise.resolve();
    this.closed = true; this.preempt();
    for (const operation of this.operations) this.scheduler.clearTimeout(operation.timeout);
    this.operations.clear(); this.stopRequest = null;
    this.state = this.faulted ? 'faulted' : 'closed'; this.changed(); return Promise.resolve();
  }
  dispose() { return this.close(); }
}
module.exports = { SlideshowController, normalizeDeck };
