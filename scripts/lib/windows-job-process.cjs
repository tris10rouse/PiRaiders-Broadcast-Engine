'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const JOB_HOST = path.resolve(__dirname, '..', '..', 'build', 'windows', 'PiRaiders.JobHost.exe');

function assertJobHostAvailable({ platform = process.platform, hostPath = JOB_HOST } = {}) {
  if (platform !== 'win32') return;
  try {
    if (!fs.statSync(hostPath).isFile()) throw Error('Not a file');
  } catch {
    throw Error('Windows process containment helper missing; run npm run setup on Windows before launching');
  }
}

/**
 * The returned PID belongs to the containment host, not to the service.
 * Keep stdin open: its EOF tells the host the Node launcher has disappeared.
 * There is deliberately no fallback to an uncontained Windows process.
 */
function spawnSupervisedProcess(command, args, options, {
  platform = process.platform, hostPath = JOB_HOST, spawnProcess = spawn
} = {}) {
  if (platform !== 'win32') return spawnProcess(command, args, options);
  assertJobHostAvailable({ platform, hostPath });
  if (typeof command !== 'string' || !command || command.includes('\0') ||
      !Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
    throw Error('Invalid contained process command');
  }
  const child = spawnProcess(hostPath, [command, ...args], {
    cwd: options?.cwd, env: options?.env, windowsHide: true, shell: false,
    // The service gets NUL input from the native host, never this lifetime pipe.
    stdio: ['pipe', 'inherit', 'inherit']
  });
  // A host can exit before Node writes/closes the pipe. Do not let a pipe error
  // become an unhandled EventEmitter error; child exit/error reports its fate.
  child.stdin?.on('error', () => {});
  return child;
}

module.exports = { JOB_HOST, assertJobHostAvailable, spawnSupervisedProcess };
