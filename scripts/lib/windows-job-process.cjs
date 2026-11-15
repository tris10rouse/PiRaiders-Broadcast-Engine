'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { normalizeWindow } = require('./production-window.cjs');
const WINDOW_EXPIRED_EXIT_CODE = 251;
const nativeWindowPolicies = new WeakSet();

const JOB_HOST = path.resolve(__dirname, '..', '..', 'build', 'windows', 'PiRaiders.JobHost.exe');

function assertJobHostAvailable({ platform = process.platform, hostPath = JOB_HOST } = {}) {
  if (platform !== 'win32') return;
  try {
    if (!fs.statSync(hostPath).isFile()) throw Error('Not a file');
  } catch {
    throw Error('Windows process containment helper missing; run npm run setup on Windows before launching');
  }
}

/** Sample the native boot clock exactly once for an event, before preparation.
 * The returned capability is immutable and reused across every sender restart.
 * Native flags can only tighten UTC admission with this absolute boot deadline.
 * execFileCall/platform are trusted OS boundaries for tests, never profile data.
 */
async function createNativeWindowPolicy(raw, { platform = process.platform, hostPath = JOB_HOST, execFileCall = execFile } = {}) {
  if (platform !== 'win32') throw Error('Native production window requires Windows containment');
  if (!raw || Object.getPrototypeOf(raw) !== Object.prototype || Reflect.ownKeys(raw).some(key => !['start','end','prewarmMinutes'].includes(key))) throw Error('Invalid native production window');
  const window = normalizeWindow(raw), beginMs = window.startMs-window.prewarmMs, endMs = window.endMs;
  if (!Number.isSafeInteger(beginMs) || beginMs < -62135596800000 || endMs > 253402300799999) throw Error('Invalid native production window');
  assertJobHostAvailable({platform,hostPath});
  let output;
  try {
    output = await new Promise((resolve,reject) => execFileCall(hostPath,['--sample-clock'],{encoding:'utf8',timeout:2000,maxBuffer:128,windowsHide:true,shell:false},(error,stdout) => error ? reject(error) : resolve(stdout)));
  } catch { throw Error('Native clock sample failed'); }
  const match = typeof output === 'string' && /^PIRAIDERS_CLOCK_V1 (0|[1-9][0-9]{0,15}) (-?(?:0|[1-9][0-9]{0,14}))\r?\n$/.exec(output);
  if (!match) throw Error('Native clock sample invalid');
  const anchorTick = Number(match[1]), utc = Number(match[2]);
  // Tick is sampled BEFORE UTC. Round the UTC millisecond upward so even the
  // sub-millisecond truncation cannot extend the native budget. Expired means0.
  const remaining = Math.max(0,endMs-utc-1), deadlineTick = anchorTick+remaining;
  if (!Number.isSafeInteger(anchorTick) || !Number.isSafeInteger(utc) || utc < -62135596800000 || utc > 253402300799999 || !Number.isSafeInteger(remaining) || !Number.isSafeInteger(deadlineTick)) throw Error('Native clock sample invalid');
  const policy = Object.freeze({beginMs,endMs,anchorTick,deadlineTick});
  nativeWindowPolicies.add(policy);
  return policy;
}

/**
 * The returned PID belongs to the containment host, not to the service.
 * Keep stdin open: its EOF tells the host the Node launcher has disappeared.
 * There is deliberately no fallback to an uncontained Windows process.
 */
function spawnSupervisedProcess(command, args, options, {
  platform = process.platform, hostPath = JOB_HOST, spawnProcess = spawn, forwardStdin = false, productionWindow
} = {}) {
  let windowArgs = [];
  if (productionWindow !== undefined) {
    if (platform !== 'win32') throw Error('Native production window requires Windows containment');
    if (!productionWindow || !nativeWindowPolicies.has(productionWindow)) throw Error('Unverified native production window');
    windowArgs = ['--production-window', String(productionWindow.beginMs), String(productionWindow.endMs), String(productionWindow.anchorTick), String(productionWindow.deadlineTick)];
  }
  if (typeof forwardStdin !== 'boolean') throw Error('Invalid stdin forwarding option');
  if (forwardStdin && platform !== 'win32') throw Error('Private stdin forwarding requires Windows containment');
  if (platform !== 'win32') return spawnProcess(command, args, options);
  assertJobHostAvailable({ platform, hostPath });
  if (typeof command !== 'string' || !command || command.includes('\0') ||
      !Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
    throw Error('Invalid contained process command');
  }
  const child = spawnProcess(hostPath, [...(forwardStdin ? ['--forward-stdin'] : []), ...windowArgs, command, ...args], {
    cwd: options?.cwd, env: options?.env, windowsHide: true, shell: false,
    // Default remains NUL; opt-in uses a separate bounded native relay.
    // Keep output private when it can contain echoed commands/capabilities.
    stdio: ['pipe', forwardStdin ? 'pipe' : 'inherit', forwardStdin ? 'pipe' : 'inherit']
  });
  // A host can exit before Node writes/closes the pipe. Do not let a pipe error
  // become an unhandled EventEmitter error; child exit/error reports its fate.
  child.stdin?.on('error', () => {});
  return child;
}

module.exports = { JOB_HOST, WINDOW_EXPIRED_EXIT_CODE, assertJobHostAvailable, createNativeWindowPolicy, spawnSupervisedProcess };
