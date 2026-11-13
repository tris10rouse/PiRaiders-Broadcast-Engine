'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { assertJobHostAvailable, spawnSupervisedProcess } = require('../scripts/lib/windows-job-process.cjs');

test('Windows containment fails closed when helper is missing', () => {
  let spawned = false;
  assert.throws(() => spawnSupervisedProcess('target.exe', [], {}, {
    platform: 'win32', hostPath: path.join(os.tmpdir(), 'missing-job-host-' + process.pid, 'host.exe'),
    spawnProcess: () => { spawned = true; }
  }), /containment helper missing/);
  assert.equal(spawned, false);
});
test('Windows wrapper preserves argv and keeps a private lifetime pipe without shell fallback', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-adapter-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const hostPath = path.join(dir, 'host.exe'); fs.writeFileSync(hostPath, 'mock binary');
  const args = ['', 'a b', 'a"b', 'trailing\\', 'Unicode: 鷹', '&|%$'];
  let invocation;
  const child = { stdin: new EventEmitter() };
  const result = spawnSupervisedProcess('C:\\Program Files\\target.exe', args, { cwd: dir, shell: true, detached: true }, {
    platform: 'win32', hostPath, spawnProcess: (...values) => { invocation = values; return child; }
  });
  assert.strictEqual(result, child);
  assert.equal(invocation[0], hostPath);
  assert.deepEqual(invocation[1], ['C:\\Program Files\\target.exe', ...args]);
  assert.deepEqual(invocation[2].stdio, ['pipe', 'inherit', 'inherit']);
  assert.equal(invocation[2].shell, false);
  assert.equal(invocation[2].windowsHide, true);
  assert.equal(invocation[2].detached, undefined);
  assert.equal(invocation[2].cwd, dir);
  assert.doesNotThrow(() => child.stdin.emit('error', Error('pipe closed')));
  assert.throws(() => spawnSupervisedProcess('target.exe', ['bad\0argument'], {}, { platform: 'win32', hostPath }), /Invalid contained/);
});
test('non-Windows processes retain direct spawning without a native helper', () => {
  const options = { cwd: '.', shell: false, stdio: 'inherit' };
  const args = ['server.js']; let invocation;
  const child = {};
  assertJobHostAvailable({ platform: 'linux', hostPath: 'missing' });
  assert.strictEqual(spawnSupervisedProcess('node', args, options, {
    platform: 'linux', spawnProcess: (...values) => { invocation = values; return child; }
  }), child);
  assert.deepEqual(invocation, ['node', args, options]);
});
