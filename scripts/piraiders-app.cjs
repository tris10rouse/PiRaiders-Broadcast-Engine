#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { randomBytes, createHmac, timingSafeEqual } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { spawn, execFile } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { performance } = require('node:perf_hooks');
const { ProcessSupervisor } = require('./lib/process-supervisor.cjs');
const { loadGameDayMachineConfig } = require('./lib/game-day-catalog.cjs');
const { assertJobHostAvailable, spawnSupervisedProcess } = require('./lib/windows-job-process.cjs');
const { bindShutdownSignals } = require('./lib/shutdown-signals.cjs');
const loaded = new WeakSet();
const HEX64 = /^[a-f0-9]{64}$/, HEX32 = /^[a-f0-9]{32}$/;
function failure(code) { return Object.assign(Error(code), { code }); }
function portValue(port) { return Number.isSafeInteger(port) && port >= 1 && port <= 65535; }
function plain(value) { return !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype; }
async function existingJSON(file) {
  let cursor = path.parse(file).root;
  for (const part of path.relative(cursor, file).split(path.sep)) {
    cursor = path.join(cursor, part);
    if ((await fs.lstat(cursor)).isSymbolicLink()) throw failure('APP_CONFIG_INVALID');
  }
  const before = await fs.lstat(file, { bigint: true });
  if (!before.isFile() || before.size > 65536n) throw failure('APP_CONFIG_INVALID');
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(65537); let size = 0;
    while (size < buffer.length) { const part = await handle.read(buffer, size, buffer.length - size, size); size += part.bytesRead; if (!part.bytesRead) break; }
    const after = await handle.stat({ bigint: true }), named = await fs.lstat(file, { bigint: true });
    const sig = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
    if (size > 65536 || BigInt(size) !== before.size || sig(before) !== sig(after) || sig(before) !== sig(named) || named.isSymbolicLink()) throw failure('APP_CONFIG_INVALID');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, size)));
  } finally { await handle.close(); }
}
async function loadAppSettings(machineFile, { appRoot = path.resolve(__dirname, '..'), nodeExecutable = process.execPath } = {}) {
  try {
    if (typeof machineFile !== 'string' || !path.isAbsolute(machineFile)) throw failure('APP_CONFIG_INVALID');
    const machine = await loadGameDayMachineConfig(machineFile, { appRoot, nodeExecutable });
    const config = await existingJSON(path.join(machine.appRoot, machine.spxConfigFile));
    if (!plain(config) || !plain(config.general) || !portValue(config.general.port) || !(await fs.stat(path.join(machine.appRoot, 'server.js'))).isFile() || !(await fs.stat(machine.nodeExecutable)).isFile()) throw failure('APP_CONFIG_INVALID');
    const settings = Object.freeze({ machineFile: path.resolve(machineFile), appRoot: machine.appRoot, nodeExecutable: machine.nodeExecutable,
      spxConfigFile: machine.spxConfigFile, port: config.general.port, url: 'http://127.0.0.1:' + config.general.port + '/game-day' });
    loaded.add(settings); return settings;
  } catch { throw failure('APP_CONFIG_INVALID'); }
}
function assertPortFree(port, { timeoutMs = 500, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (!portValue(port) || (signal!==undefined&&!(signal instanceof AbortSignal)) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) { reject(failure('APP_OPTIONS_INVALID')); return; }
    let settled = false;
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = code => { if (settled) return; settled = true; signal?.removeEventListener('abort', aborted); socket.destroy(); code ? reject(failure(code)) : resolve(); };
    const aborted = () => finish('APP_CLOSED');
    socket.setTimeout(timeoutMs, () => finish('APP_PORT_UNAVAILABLE'));
    socket.once('connect', () => finish('APP_PORT_BUSY'));
    socket.once('error', error => finish(error.code === 'ECONNREFUSED' ? null : 'APP_PORT_UNAVAILABLE'));
    signal?.addEventListener('abort', aborted, { once: true }); if (signal?.aborted) aborted();
  });
}
/** The secret remains local to parent/owned child. Only a fresh public nonce crosses HTTP. */
function probeStartupIdentity(port, secret, { timeoutMs = 500, signal } = {}) {
  if (!portValue(port) || typeof secret!=='string' || !HEX64.test(secret) || (signal!==undefined&&!(signal instanceof AbortSignal)) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) return Promise.reject(failure('APP_OPTIONS_INVALID'));
  const nonce = randomBytes(16).toString('hex');
  const expected = createHmac('sha256', Buffer.from(secret, 'hex')).update(nonce, 'ascii').digest();
  return new Promise((resolve, reject) => {
    let settled = false, bytes = 0, chunks = [], timer;
    const finish = code => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', aborted); request.destroy(); code ? reject(failure(code)) : resolve(); };
    const aborted = () => finish('APP_CLOSED');
    const request = http.get({ host: '127.0.0.1', port, path: '/game-day/internal/startup-identity', agent: false, maxHeaderSize: 2048,
      headers: { 'X-PiRaiders-Startup-Probe': nonce, Accept: 'application/json' } }, response => {
      if (response.statusCode !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers['content-type'] || '')) { finish('APP_IDENTITY_INVALID');response.destroy(); return; }
      response.on('data', chunk => { bytes += chunk.length; if (bytes > 1024) { finish('APP_IDENTITY_LIMIT');response.destroy(); } else chunks.push(chunk); });
      response.once('error', () => finish('APP_IDENTITY_INVALID'));response.once('aborted',()=>finish('APP_IDENTITY_INVALID'));
      response.once('end', () => {
        if (settled) return;
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!plain(value) || Object.keys(value).length !== 2 || value.app !== 'piraiders' || typeof value.proof !== 'string' || !HEX64.test(value.proof) || !timingSafeEqual(Buffer.from(value.proof, 'hex'), expected)) throw Error('invalid');
          finish();
        } catch { finish('APP_IDENTITY_INVALID'); }
      });
    });
    timer=setTimeout(()=>finish('APP_IDENTITY_TIMEOUT'),timeoutMs);
    request.once('error', () => finish(signal?.aborted ? 'APP_CLOSED' : 'APP_IDENTITY_UNAVAILABLE'));
    signal?.addEventListener('abort', aborted, { once: true }); if (signal?.aborted) aborted();
  });
}
function systemBrowser(url) {
  return new Promise((resolve, reject) => execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, timeout: 5000, maxBuffer: 1024 }, error => error ? reject(failure('BROWSER_OPEN_FAILED')) : resolve()));
}
class PersistentAppLauncher extends EventEmitter {
  #secret = null;
  #proven = null;
  constructor(settings, { spawnProcess, openBrowser = systemBrowser, supervisorOptions = {}, startupTimeoutMs = 15000, probeTimeoutMs = 500, probeIntervalMs = 100, platform = process.platform } = {}) {
    super();
    if (!loaded.has(settings) || (spawnProcess !== undefined && typeof spawnProcess !== 'function') || typeof openBrowser !== 'function' ||
      !Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 100 || startupTimeoutMs > 120000 || !Number.isInteger(probeTimeoutMs) || probeTimeoutMs < 1 || probeTimeoutMs > 5000 ||
      !Number.isInteger(probeIntervalMs) || probeIntervalMs < 1 || probeIntervalMs > 1000) throw failure('APP_OPTIONS_INVALID');
    if (!plain(supervisorOptions) || Object.keys(supervisorOptions).some(key=>!['maxRestarts','restartDelayMs','windowMs','execFileProcess'].includes(key)) ||
      (supervisorOptions.maxRestarts!==undefined&&(!Number.isInteger(supervisorOptions.maxRestarts)||supervisorOptions.maxRestarts<0||supervisorOptions.maxRestarts>3)) ||
      (supervisorOptions.restartDelayMs!==undefined&&(!Number.isInteger(supervisorOptions.restartDelayMs)||supervisorOptions.restartDelayMs<10||supervisorOptions.restartDelayMs>5000)) ||
      (supervisorOptions.windowMs!==undefined&&(!Number.isInteger(supervisorOptions.windowMs)||supervisorOptions.windowMs<1000||supervisorOptions.windowMs>600000)) ||
      (supervisorOptions.execFileProcess!==undefined&&typeof supervisorOptions.execFileProcess!=='function'))throw failure('APP_OPTIONS_INVALID');
    if (process.platform !== 'win32' && !spawnProcess) throw failure('WINDOWS_REQUIRED');
    if(!spawnProcess){try{assertJobHostAvailable();}catch{throw failure('APP_HOST_MISSING');}}
    Object.assign(this, { settings, openBrowser, startupTimeoutMs, probeTimeoutMs, probeIntervalMs });
    this.closed = false; this.state = 'idle'; this.lastError = null; this.currentChild = null; this.generation = 0; this.browserOpened = false;
    this.controller = new AbortController();
    this.supervisor = new ProcessSupervisor([{ name: 'spx', command: settings.nodeExecutable, args: [path.join(settings.appRoot, 'server.js'), settings.spxConfigFile], cwd: settings.appRoot }], {
      ...supervisorOptions, platform, canStart: () => !this.closed, spawnProcess: (command, args, options) => {
        if (this.closed) throw failure('APP_CLOSED');
        const secret = randomBytes(32).toString('hex'); this.#secret = secret;this.#proven=null;
        const env = { ...process.env, PIRAIDERS_APP_CONFIG: settings.machineFile, PIRAIDERS_APP_STARTUP_SECRET: secret };
        // Preserve JobHost lifetime input while discarding inherited native output.
        const child = spawnProcess ? spawnProcess(command, args, { ...options, env, stdio: ['pipe', 'ignore', 'ignore'] }) :
          spawnSupervisedProcess(command, args, { ...options, env }, { spawnProcess: (exe, argv, opts) => spawn(exe, argv, { ...opts, stdio: ['pipe', 'ignore', 'ignore'] }) });
        this.currentChild = child; const generation = ++this.generation; this.state = 'starting';
        const gone = () => { if (this.currentChild === child) { this.currentChild = null; this.#secret = null;this.#proven=null; if (!this.closed) this.state = 'restarting'; } };
        child.once('exit', gone); child.once('error', gone);
        queueMicrotask(() => { void this.monitor(child, generation, secret); });
        return child;
      }
    });
    for (const name of ['starting', 'started', 'exited', 'restarting', 'fault']) this.supervisor.on(name, data => {
      if (name === 'fault') {
        this.lastError = 'SPX_PROCESS_FAULT';
        if(!this.closed&&(this.supervisor.failures.get('spx')||[]).length>this.supervisor.maxRestarts){this.state='faulted';this.readyReject?.(failure('APP_PROCESS_FAILED'));this.emit('fault',Object.freeze({code:'APP_PROCESS_FAILED'}));}
      }
      this.emit('status', Object.freeze({ event: name, generation: this.generation, ...(Number.isSafeInteger(data.attempt) ? { attempt: data.attempt } : {}) }));
    });
  }
  snapshot() { return Object.freeze({ state: this.state, closed: this.closed, generation: this.generation, browserOpened: this.browserOpened, lastError: this.lastError }); }
  async monitor(child, generation, secret) {
    const end = performance.now() + this.startupTimeoutMs;
    while (!this.closed && this.currentChild === child && generation === this.generation && performance.now() < end) {
      try {
        await probeStartupIdentity(this.settings.port, secret, { timeoutMs: Math.max(1, Math.min(this.probeTimeoutMs, Math.ceil(end - performance.now()))), signal: this.controller.signal });
        if (this.closed || this.currentChild !== child || generation !== this.generation) return;
        const proven=Object.freeze({child,generation});this.#proven=proven;
        this.state = 'ready'; this.lastError = null;
        this.readyResolve?.(proven); this.emit('status', Object.freeze({ event: 'ready', generation })); return;
      } catch { /* Retry fixed bounded ownership probes; no remote body enters logs. */ }
      try { await delay(this.probeIntervalMs, undefined, { signal: this.controller.signal }); } catch { return; }
    }
    if (!this.closed && this.currentChild === child && generation === this.generation) {
      this.lastError = 'APP_STARTUP_TIMEOUT'; this.readyReject?.(failure('APP_STARTUP_TIMEOUT'));this.emit('fault',Object.freeze({code:'APP_STARTUP_TIMEOUT'}));
      void this.close().catch(() => {});
    }
  }
  #currentProof(token) {
    return !!token && !this.closed && this.state==='ready' && this.#proven===token &&
      this.currentChild===token.child && this.generation===token.generation && token.child.killed!==true &&
      (token.child.exitCode===null||token.child.exitCode===undefined) && (token.child.signalCode===null||token.child.signalCode===undefined);
  }
  start({ browser = true } = {}) {
    if (typeof browser !== 'boolean') return Promise.reject(failure('APP_OPTIONS_INVALID'));
    if (this.closed) return Promise.reject(failure('APP_CLOSED'));
    if (this.startPromise) return this.startPromise;
    this.startPromise = Promise.resolve().then(async () => {
      let timer,onAbort;
      try {
        if(this.closed)throw failure('APP_CLOSED');
        const deadline=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(failure('APP_STARTUP_TIMEOUT')),this.startupTimeoutMs);});
        const canceled=new Promise((resolve,reject)=>{onAbort=()=>reject(failure('APP_CLOSED'));this.controller.signal.addEventListener('abort',onAbort,{once:true});});
        const bounded=value=>Promise.race([value,deadline,canceled]);
        await bounded(assertPortFree(this.settings.port,{timeoutMs:Math.min(500,this.startupTimeoutMs),signal:this.controller.signal}));
        if(this.closed)throw failure('APP_CLOSED');
        const ready=new Promise((resolve,reject)=>{this.readyResolve=resolve;this.readyReject=reject;});
        this.supervisor.start();const proven=await bounded(ready);
        if(this.closed)throw failure('APP_CLOSED');
        if(!this.#currentProof(proven))throw failure('APP_IDENTITY_STALE');
        if(browser){
          let failed=false;
          try {
            // No await may separate this exact-generation check and invocation.
            if(!this.#currentProof(proven))throw failure('APP_IDENTITY_STALE');
            await bounded(this.openBrowser(this.settings.url));
          } catch(error) {
            if(['APP_CLOSED','APP_STARTUP_TIMEOUT','APP_IDENTITY_STALE'].includes(error?.code))throw error;
            failed=true;
          }
          if(this.closed)throw failure('APP_CLOSED');
          if(!this.#currentProof(proven))throw failure('APP_IDENTITY_STALE');
          if(failed){this.lastError='BROWSER_OPEN_FAILED';this.emit('status',Object.freeze({event:'browser-open-failed',generation:this.generation}));}
          else this.browserOpened=true;
        }
        if(this.closed)throw failure('APP_CLOSED');
        if(!this.#currentProof(proven))throw failure('APP_IDENTITY_STALE');
        return this.snapshot();
      } catch(error) {
        const code=['APP_PORT_BUSY','APP_PORT_UNAVAILABLE','APP_CLOSED','APP_PROCESS_FAILED','APP_IDENTITY_STALE'].includes(error?.code)?error.code:'APP_STARTUP_TIMEOUT';
        this.lastError=code;await this.close();throw failure(code);
      } finally {
        clearTimeout(timer);if(onAbort)this.controller.signal.removeEventListener('abort',onAbort);
        this.readyResolve=null;this.readyReject=null;
      }
    });
    return this.startPromise;
  }
  close() {
    if (this.closePromise) return this.closePromise;
    let resolve, reject; const pending = new Promise((yes, no) => { resolve = yes; reject = no; }); this.closePromise = pending;
    this.closed = true; this.state = 'closing';this.#proven=null; this.controller.abort(); this.readyReject?.(failure('APP_CLOSED'));
    // Native stop starts in this synchronous turn, independently of HTTP/start work.
    let stopping; try { stopping = this.supervisor.stop(); } catch { stopping = Promise.reject(failure('APP_CLOSE_FAILED')); }
    void Promise.resolve(stopping).then(() => { this.state = 'closed'; this.#secret = null; resolve(); }, () => { this.state = 'faulted'; this.lastError = 'APP_CLOSE_FAILED'; this.closePromise = null; reject(failure('APP_CLOSE_FAILED')); });
    return pending;
  }
}
async function main() {
  const args = process.argv.slice(2), noBrowser = args.includes('--no-browser'), files = args.filter(arg => arg !== '--no-browser');
  if (files.length > 1 || args.filter(arg => arg === '--no-browser').length > 1) throw failure('APP_OPTIONS_INVALID');
  const appRoot = path.resolve(__dirname, '..'), machineFile = path.resolve(files[0] || path.join(appRoot, 'config', 'piraiders-app.json'));
  assertJobHostAvailable();
  const app = new PersistentAppLauncher(await loadAppSettings(machineFile, { appRoot }));
  app.on('status', status => console.log(JSON.stringify({ component: 'piraiders-app', ...status })));
  let stopping;
  const shutdown = () => { if (!stopping) stopping = (async () => { for (let attempt = 0; attempt < 3; attempt++) { try { await app.close(); return; } catch { if (attempt === 2) throw failure('APP_CLOSE_FAILED'); await delay(1000); } } })().catch(() => { console.error('APP_CLOSE_FAILED'); process.exitCode = 1; }).finally(() => { stopping = null; }); return stopping; };
  app.on('fault',value=>{console.error(value.code);process.exitCode=1;void shutdown();});
  bindShutdownSignals(process, shutdown);
  const status=await app.start({ browser: !noBrowser });
  console.log(JSON.stringify({component:'piraiders-app',event:'controller-available',url:app.settings.url,browserOpened:status.browserOpened}));
}
if (require.main === module) main().catch(error => { console.error(/^[A-Z_]+$/.test(error?.code || '') ? error.code : 'APP_START_FAILED'); process.exitCode = 1; });
module.exports = { loadAppSettings, assertPortFree, probeStartupIdentity, PersistentAppLauncher };
