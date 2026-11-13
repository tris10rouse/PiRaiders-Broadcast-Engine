'use strict';

/**
 * Fail-closed scheduling policy for CasparCG/NDI process eligibility.
 * All timestamps are ISO 8601 with explicit timezone offsets or Z.
 * Caller controls the actual sender lifecycle; this module never transmits.
 */
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_PREWARM_MS = 60 * 60 * 1000;

function parseInstant(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    throw new Error(label + ' requires an ISO timestamp with explicit timezone');
  }
  // Date.parse normalizes impossible days (e.g. February 30), so validate
  // calendar and clock fields independently before interpreting the offset.
  const parts = value.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/);
  const [, year, month, day, hour, minute, second = '00'] = parts.map((v, i) => i === 0 ? v : Number(v));
  const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > monthDays || hour > 23 || minute > 59 || second > 59) {
    throw Error(label + ' is not a valid calendar instant');
  }
  const offset = value.match(/[+-](\d\d):(\d\d)$/);
  if (offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59)) throw Error(label + ' has an invalid offset');
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(label + ' is not a valid instant');
  return ms;
}
function normalizeWindow(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error('Window configuration required');
  const startMs = parseInstant(config.start, 'start');
  const endMs = parseInstant(config.end, 'end');
  if (endMs <= startMs || endMs - startMs > MAX_WINDOW_MS) throw Error('Production window must be positive and at most 24 hours');
  const prewarmMinutes = config.prewarmMinutes === undefined ? 15 : config.prewarmMinutes;
  if (!Number.isInteger(prewarmMinutes) || prewarmMinutes < 0 || prewarmMinutes * 60000 > MAX_PREWARM_MS) throw Error('Invalid prewarm minutes');
  return Object.freeze({ startMs, endMs, prewarmMs: prewarmMinutes * 60000 });
}
function senderAllowed(window, nowMs) {
  if (!window || !Number.isFinite(window.startMs) || !Number.isFinite(window.endMs) ||
      !Number.isFinite(window.prewarmMs) || !Number.isFinite(nowMs) ||
      window.endMs <= window.startMs || window.endMs - window.startMs > MAX_WINDOW_MS ||
      window.prewarmMs < 0 || window.prewarmMs > MAX_PREWARM_MS) return false;
  return nowMs >= window.startMs - window.prewarmMs && nowMs < window.endMs;
}
function nextBoundary(window, nowMs) {
  if (!Number.isFinite(nowMs)) throw Error('Invalid current time');
  const begin = window.startMs - window.prewarmMs;
  if (nowMs < begin) return begin;
  if (nowMs < window.endMs) return window.endMs;
  return null;
}

/**
 * Safety controller: a failed/invalid schedule cannot keep the sender alive.
 * Reconcile is idempotent and serialized; shutdown always requests stop.
 * Poll periodically to recover from machine sleep or wall-clock adjustments.
 */
class ProductionWindowGate {
  constructor({ window, startSender, stopSender, clock = Date.now }) {
    if (typeof startSender !== 'function' || typeof stopSender !== 'function') throw Error('Sender callbacks required');
    this.window = normalizeWindow(window);
    this.startSender = startSender;
    this.stopSender = stopSender;
    this.clock = clock;
    this.running = false;
    this.closed = false;
    this.queue = Promise.resolve();
  }
  reconcile() {
    const run = async () => {
      if (this.closed) return;
      const allowed = senderAllowed(this.window, this.clock());
      if (allowed === this.running) return;
      if (allowed) {
        // Mark running only after successful start. A failed start can be retried.
        await this.startSender();
        this.running = true;
      } else {
        // Mark stopped only after the stop callback resolves. A failed stop
        // is surfaced and retried on next reconcile.
        await this.stopSender();
        this.running = false;
      }
    };
    this.queue = this.queue.catch(() => {}).then(run);
    return this.queue;
  }
  close() {
    this.closed = true;
    this.queue = this.queue.catch(() => {}).then(async () => {
      // Always request stop, including after a partial start failure.
      await this.stopSender();
      this.running = false;
    });
    return this.queue;
  }
}
module.exports = { normalizeWindow, senderAllowed, nextBoundary, ProductionWindowGate };
