'use strict';
const { execFile } = require('node:child_process');

/**
 * On Windows, taskkill /T terminates descendants spawned by an executable
 * (for example, CasparCG's subprocesses). No shell is involved.
 * Reject invalid PIDs to avoid unbounded or accidental process targeting.
 */
function terminateProcessTree(child, { platform = process.platform, execFileProcess = execFile } = {}) {
  if (!child || typeof child.kill !== 'function') return Promise.reject(Error('Invalid child process'));
  if (platform !== 'win32') {
    try { child.kill('SIGTERM'); return Promise.resolve(); }
    catch (error) { return Promise.reject(error); }
  }
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
    // A failed spawn may never have a PID. Do not call taskkill with bad input.
    return Promise.reject(Error('Cannot terminate Windows process without a valid PID'));
  }
  return new Promise((resolve, reject) => {
    execFileProcess('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true, timeout: 15000, maxBuffer: 65536
    }, (error) => {
      // No silent success on failed taskkill: an orphaned CasparCG process
      // could continue NDI output outside the production window.
      if (error) reject(Error('taskkill failed for PID ' + child.pid + ': ' + error.message));
      else resolve();
    });
  });
}
module.exports = { terminateProcessTree };
