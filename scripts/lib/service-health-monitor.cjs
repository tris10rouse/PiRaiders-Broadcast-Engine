'use strict';
const { EventEmitter } = require('node:events');
const { performance } = require('node:perf_hooks');
const { normalizeHealthConfig, probeServiceHealth } = require('./service-health-probes.cjs');

// Diagnostic endpoint health is intentionally separate from process ownership,
// graphics output and NDI state. It never restarts or terminates a service.
class ServiceHealthMonitor extends EventEmitter {
  constructor(specs, { probe = probeServiceHealth, schedule = setTimeout, cancel = clearTimeout,
    clock = () => performance.now(), intervalMs = 2000, startupGraceMs = 10000, failureThreshold = 3 } = {}) {
    super();
    if (!Array.isArray(specs) || new Set(specs.map(s => s.name)).size !== specs.length) throw Error('Invalid health services');
    if (!Number.isInteger(intervalMs) || intervalMs < 250 || intervalMs > 10000 ||
        !Number.isInteger(startupGraceMs) || startupGraceMs < 0 || startupGraceMs > 120000 ||
        !Number.isInteger(failureThreshold) || failureThreshold < 1 || failureThreshold > 10) throw Error('Invalid health timing');
    Object.assign(this, { probe, schedule, cancel, clock, intervalMs, startupGraceMs, failureThreshold });
    this.closed = false;
    this.entries = new Map(specs.map(spec => [spec.name, { name: spec.name,
      config: normalizeHealthConfig(spec.name, spec.health), generation: 0, active: false,
      timer: null, controller: null, pending: null, failures: 0, onceReady: false,
      since: 0, snapshot: { name: spec.name, status: 'stopped', scope: 'loopback-endpoint' } }]));
  }
  entry(name) {
    const entry = this.entries.get(name);
    if (!entry) throw Error('Unknown health service');
    return entry;
  }
  invalidate(entry) {
    entry.generation++;
    entry.active = false;
    if (entry.timer !== null) this.cancel(entry.timer);
    entry.timer = null;
    entry.controller?.abort();
    entry.controller = null;
    entry.pending = null;
  }
  publish(entry, status, code, version) {
    const next = { name: entry.name, status, scope: 'loopback-endpoint' };
    if (entry.pid !== undefined) next.pid = entry.pid;
    if (code) next.code = code;
    if (version) next.version = version;
    const changed = JSON.stringify(next) !== JSON.stringify(entry.snapshot);
    entry.snapshot = next;
    if (changed) this.emit('status', { ...next });
  }
  activate(name, pid) {
    if (this.closed) return;
    const entry = this.entry(name);
    this.invalidate(entry);
    entry.pid = pid;
    entry.failures = 0; entry.onceReady = false; entry.since = this.clock();
    entry.active = true;
    if (!entry.config) { this.publish(entry, 'not-configured', 'HEALTH_NOT_CONFIGURED'); return; }
    this.publish(entry, 'starting');
    void this.check(name);
  }
  deactivate(name, status = 'stopped', code) {
    if (!['starting', 'stopping', 'stopped', 'unhealthy'].includes(status)) throw Error('Invalid inactive health state');
    const entry = this.entry(name);
    this.invalidate(entry);
    if (status === 'starting' || status === 'stopped') entry.pid = undefined;
    this.publish(entry, status, code);
  }
  check(name) {
    const entry = this.entry(name);
    if (this.closed || !entry.active || !entry.config) return Promise.resolve();
    if (entry.pending) return entry.pending;
    if (entry.timer !== null) this.cancel(entry.timer);
    entry.timer = null;
    const token = entry.generation;
    const controller = new AbortController();
    entry.controller = controller;
    const current = () => !this.closed && entry.active && token === entry.generation && !controller.signal.aborted;
    const apply = result => {
      if (!current()) return;
      if (result?.healthy === true) {
        entry.failures = 0; entry.onceReady = true;
        this.publish(entry, 'ready', undefined, result.version);
      } else {
        entry.failures++;
        const elapsed = this.clock() - entry.since;
        const graceExpired = !Number.isFinite(elapsed) || elapsed < 0 || elapsed >= this.startupGraceMs;
        const status = entry.failures >= this.failureThreshold && (entry.onceReady || graceExpired)
          ? 'unhealthy' : entry.onceReady ? 'degraded' : 'starting';
        // Only the probe's bounded fixed diagnostic codes cross this boundary.
        const allowed = ['ABORTED', 'TIMEOUT', 'CONNECTION_FAILED', 'RESPONSE_TOO_LARGE', 'HTTP_STATUS', 'INVALID_RESPONSE', 'IDENTITY_MISMATCH', 'INVALID_CONFIG'];
        this.publish(entry, status, allowed.includes(result?.code) ? result.code : 'PROBE_FAILED');
      }
    };
    entry.pending = Promise.resolve().then(() => current() ? this.probe(entry.config, { signal: controller.signal }) : null)
      .then(apply, () => apply({ healthy: false, code: 'PROBE_FAILED' }))
      .finally(() => {
        if (!current()) return;
        entry.controller = null; entry.pending = null;
        entry.timer = this.schedule(() => { entry.timer = null; void this.check(name); }, this.intervalMs);
      });
    return entry.pending;
  }
  snapshot() { return [...this.entries.values()].map(entry => ({ ...entry.snapshot })); }
  close() {
    this.closed = true;
    for (const entry of this.entries.values()) {
      if (entry.active || ['starting', 'ready', 'degraded', 'unhealthy', 'not-configured'].includes(entry.snapshot.status)) {
        this.deactivate(entry.name, 'stopping');
      } else this.invalidate(entry);
    }
    // Never await an in-flight probe: process shutdown has higher priority.
  }
}
module.exports = { ServiceHealthMonitor };
