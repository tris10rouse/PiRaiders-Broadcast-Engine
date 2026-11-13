'use strict';
const { EventEmitter } = require('node:events');
const { execFile } = require('node:child_process');
const { spawnSupervisedProcess } = require('./windows-job-process.cjs');
const { terminateProcessTree } = require('./windows-process-tree.cjs');
class ProcessSupervisor extends EventEmitter {
  constructor(specs, { spawnProcess, schedule = setTimeout, cancel = clearTimeout, restartDelayMs = 1500, maxRestarts = 3, windowMs = 60000, platform = process.platform, execFileProcess = execFile, canStart = () => true } = {}) {
    super();
    if (!Array.isArray(specs) || !specs.length || new Set(specs.map(s => s.name)).size !== specs.length) throw Error('Invalid/duplicate services');
    for (const s of specs) if (!s.name || !s.command || !Array.isArray(s.args) || !s.args.every(a => typeof a === 'string')) throw Error('Invalid service specification');
    const spawnService = spawnProcess || ((command, args, options) => spawnSupervisedProcess(command, args, options, { platform }));
    Object.assign(this, { specs, spawnProcess: spawnService, schedule, cancel, restartDelayMs, maxRestarts, windowMs, platform, execFileProcess, canStart });
    this.children = new Map(); this.timers = new Map(); this.failures = new Map(); this.stopping = false; this.inhibited = new Set();
  }
  start() { if (this.stopping) throw Error('Stopping'); for (const spec of this.specs) this.launch(spec); }
  launch(spec) {
    if (this.stopping || this.children.has(spec.name)) return;
    // Re-evaluate the actual clock at every initial/restart launch.
    let permitted = false;
    try { permitted = this.canStart(spec) === true; }
    catch (error) { this.emit('fault', { name: spec.name, error: 'Eligibility failed: ' + error.message }); }
    if (!permitted) { this.inhibited.add(spec.name); this.emit('inhibited', { name: spec.name }); return; }
    this.inhibited.delete(spec.name);
    let child;
    try { child = this.spawnProcess(spec.command, spec.args, { cwd: spec.cwd, windowsHide: true, stdio: 'inherit', shell: false }); }
    catch (error) { this.emit('fault', { name: spec.name, error: error.message }); this.restart(spec); return; }
    this.children.set(spec.name, child); this.emit('starting', { name: spec.name, pid: child.pid });
    let handled = false;
    const ended = (code, signal, error) => {
      if (handled) return; handled = true;
      if (this.children.get(spec.name) === child) this.children.delete(spec.name);
      this.emit('exited', { name: spec.name, code, signal, error: error?.message });
      if (!this.stopping) this.restart(spec);
    };
    child.once('spawn', () => {
      let allowed = false;
      try { allowed = this.canStart(spec) === true; } catch {}
      // A delayed OS spawn can complete after the window boundary.
      if (!allowed || this.stopping) this.stop().catch(() => {});
      else this.emit('started', { name: spec.name, pid: child.pid });
    });
    child.once('exit', (code, signal) => ended(code, signal));
    child.once('error', error => ended(null, null, error));
  }
  resumeEligible() {
    for (const spec of this.specs) if (this.inhibited.has(spec.name)) this.launch(spec);
  }
  restart(spec) {
    if (this.stopping) return;
    const now = Date.now();
    const failures = (this.failures.get(spec.name) || []).filter(t => now - t < this.windowMs);
    failures.push(now); this.failures.set(spec.name, failures);
    if (failures.length > this.maxRestarts) { this.emit('fault', { name: spec.name, error: 'Restart limit exceeded' }); return; }
    const timer = this.schedule(() => { this.timers.delete(spec.name); this.launch(spec); }, this.restartDelayMs);
    this.timers.set(spec.name, timer); this.emit('restarting', { name: spec.name, attempt: failures.length });
  }
  stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    for (const timer of this.timers.values()) this.cancel(timer);
    this.timers.clear();
    const pending = [...this.children.entries()].map(async ([name, child]) => {
      try {
        await terminateProcessTree(child, { platform: this.platform, execFileProcess: this.execFileProcess });
        if (this.children.get(name) === child) this.children.delete(name);
      } catch (error) {
        this.emit('fault', { name, error: 'Shutdown failed: ' + error.message });
        throw error;
      }
    });
    this.stopPromise = Promise.allSettled(pending).then(results => {
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length) {
        // Keep unconfirmed children tracked and permit a later retry.
        this.stopPromise = null;
        throw new AggregateError(failures.map(result => result.reason), 'One or more services failed to stop');
      }
    });
    return this.stopPromise;
  }
}
module.exports = { ProcessSupervisor };
