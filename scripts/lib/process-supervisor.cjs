'use strict';
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
class ProcessSupervisor extends EventEmitter {
  constructor(specs, { spawnProcess = spawn, schedule = setTimeout, cancel = clearTimeout, restartDelayMs = 1500, maxRestarts = 3, windowMs = 60000 } = {}) {
    super();
    if (!Array.isArray(specs) || !specs.length || new Set(specs.map(s => s.name)).size !== specs.length) throw Error('Invalid/duplicate services');
    for (const s of specs) if (!s.name || !s.command || !Array.isArray(s.args) || !s.args.every(a => typeof a === 'string')) throw Error('Invalid service specification');
    Object.assign(this, { specs, spawnProcess, schedule, cancel, restartDelayMs, maxRestarts, windowMs });
    this.children = new Map(); this.timers = new Map(); this.failures = new Map(); this.stopping = false;
  }
  start() { if (this.stopping) throw Error('Stopping'); for (const spec of this.specs) this.launch(spec); }
  launch(spec) {
    if (this.stopping || this.children.has(spec.name)) return;
    let child;
    try { child = this.spawnProcess(spec.command, spec.args, { cwd: spec.cwd, windowsHide: true, stdio: 'inherit', shell: false }); }
    catch (error) { this.emit('fault', { name: spec.name, error: error.message }); this.restart(spec); return; }
    this.children.set(spec.name, child); this.emit('started', { name: spec.name, pid: child.pid });
    let handled = false;
    const ended = (code, signal, error) => {
      if (handled) return; handled = true;
      if (this.children.get(spec.name) === child) this.children.delete(spec.name);
      this.emit('exited', { name: spec.name, code, signal, error: error?.message });
      if (!this.stopping) this.restart(spec);
    };
    child.once('exit', (code, signal) => ended(code, signal));
    child.once('error', error => ended(null, null, error));
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
    if (this.stopping) return;
    this.stopping = true;
    for (const timer of this.timers.values()) this.cancel(timer);
    this.timers.clear();
    for (const child of this.children.values()) try { child.kill(); } catch (error) { this.emit('fault', { error: error.message }); }
  }
}
module.exports = { ProcessSupervisor };
