'use strict';
const { EventEmitter } = require('node:events');
const { ProcessSupervisor } = require('./process-supervisor.cjs');
const { normalizeWindow, senderAllowed, nextBoundary } = require('./production-window.cjs');
const { ServiceHealthMonitor } = require('./service-health-monitor.cjs');

/** Owns local processes, not NDI discovery, receiver state or board routing. */
class LauncherRuntime extends EventEmitter {
  constructor(settings, { clock = Date.now, schedule = setTimeout, cancel = clearTimeout,
    pollMs = 1000, supervisorOptions = {}, healthOptions = {} } = {}) {
    super();
    this.window = normalizeWindow(settings?.productionWindow);
    if (!Array.isArray(settings.services) || settings.services.length !== 2 ||
        new Set(settings.services.map(s => s.name)).size !== 2 ||
        !settings.services.some(s => s.name === 'spx') || !settings.services.some(s => s.name === 'casparcg')) {
      throw Error('Exactly one spx and one casparcg service required');
    }
    for (const service of settings.services) {
      if (typeof service.command !== 'string' || !service.command || !Array.isArray(service.args) || !service.args.every(arg => typeof arg === 'string')) throw Error('Invalid service specification');
    }
    if (!Number.isInteger(pollMs) || pollMs < 1 || pollMs > 1000) throw Error('pollMs must be 1 through 1000');
    Object.assign(this, { clock, schedule, cancel, pollMs, supervisorOptions });
    this.health = new ServiceHealthMonitor(settings.services, healthOptions);
    this.health.on('status', data => this.emit('service-health', data));
    this.senderSpec = settings.services.find(s => s.name === 'casparcg');
    this.spx = this.supervise([settings.services.find(s => s.name === 'spx')]);
    this.sender = null;
    this.closed = false;
    this.started = false;
    this.queue = Promise.resolve();
    this.timer = null;
    this.closePromise = null;
  }
  allowed() { return !this.closed && senderAllowed(this.window, this.clock()); }
  supervise(specs, canStart = () => !this.closed) {
    const supervisor = new ProcessSupervisor(specs, { ...this.supervisorOptions, canStart });
    for (const event of ['starting', 'started', 'exited', 'restarting', 'inhibited', 'fault']) {
      supervisor.on(event, data => {
        // A confirmed stop can precede the old host's JS exit callback. Old
        // sender events must never invalidate a replacement's health generation.
        const current = data.name === 'spx' ? this.spx : this.sender;
        if (current === supervisor) {
          if (event === 'starting') this.health.deactivate(data.name, 'starting');
          if (event === 'started') this.health.activate(data.name, data.pid);
          if (event === 'exited') this.health.deactivate(data.name, 'stopped', 'PROCESS_EXITED');
          if (event === 'fault') this.health.deactivate(data.name, 'unhealthy', supervisor.stopping ? 'SHUTDOWN_FAILED' : 'PROCESS_FAULT');
        }
        this.emit(event, data);
      });
    }
    return supervisor;
  }
  start() {
    if (this.closed) return Promise.reject(Error('Launcher is closed'));
    if (this.started) return this.reconcile();
    this.started = true;
    this.spx.start();
    return this.reconcile().finally(() => this.arm());
  }
  reconcile() {
    const run = async () => {
      if (this.closed) return;
      // A previous failed stop must complete before another sender may exist.
      if (this.sender && (!this.allowed() || this.sender.stopping)) {
        this.health.deactivate('casparcg', 'stopping');
        await this.sender.stop();
        this.sender = null;
        this.health.deactivate('casparcg', 'stopped');
      }
      if (this.allowed() && this.sender) this.sender.resumeEligible();
      if (this.allowed() && !this.sender) {
        this.sender = this.supervise([this.senderSpec], () => this.allowed());
        this.sender.start();
        // Spawn itself may take time. Never wait for a later timer to notice
        // that the boundary crossed while submitting a process start.
        if (!this.allowed()) {
          this.health.deactivate('casparcg', 'stopping');
          await this.sender.stop();
          this.sender = null;
          this.health.deactivate('casparcg', 'stopped');
        }
      }
    };
    this.queue = this.queue.catch(() => {}).then(run);
    return this.queue;
  }
  arm() {
    if (this.closed) return;
    if (this.timer !== null) this.cancel(this.timer);
    const now = this.clock();
    const boundary = Number.isFinite(now) ? nextBoundary(this.window, now) : null;
    const wait = boundary === null ? this.pollMs : Math.min(this.pollMs, Math.max(1, boundary - now));
    this.timer = this.schedule(() => {
      this.timer = null;
      this.reconcile().catch(error => this.emit('fault', { name: 'launcher', error: error.message }))
        .finally(() => this.arm());
    }, wait);
  }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.health.close();
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.closePromise = this.queue.catch(() => {}).then(async () => {
      const results = await Promise.allSettled([this.spx.stop(), this.sender?.stop()]);
      for (const [index, name] of ['spx', 'casparcg'].entries()) {
        this.health.deactivate(name, results[index].status === 'fulfilled' ? 'stopped' : 'unhealthy',
          results[index].status === 'fulfilled' ? undefined : 'SHUTDOWN_FAILED');
      }
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length) {
        this.closePromise = null;
        throw new AggregateError(failures.map(result => result.reason), 'Launcher shutdown failed');
      }
      this.sender = null;
    });
    this.queue = this.closePromise;
    return this.closePromise;
  }
}
module.exports = { LauncherRuntime };
