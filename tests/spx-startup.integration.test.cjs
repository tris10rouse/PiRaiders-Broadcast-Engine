'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { performance } = require('node:perf_hooks');
const { spawnSupervisedProcess } = require('../scripts/lib/windows-job-process.cjs');
const { terminateProcessTree } = require('../scripts/lib/windows-process-tree.cjs');
const packageVersion = require('../package.json').version;

async function reservePort() {
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}

test('real SPX starts with isolated settings and passes its version health probe', { timeout: 45000 }, async t => {
  const { normalizeHealthConfig, probeServiceHealth } = require('../scripts/lib/service-health-probes.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piraiders-spx-smoke-'));
  const dataRoot = path.join(dir, 'DATAROOT');
  const logRoot = path.join(dir, 'LOG');
  fs.mkdirSync(dataRoot); fs.mkdirSync(logRoot); fs.mkdirSync(path.join(dir, 'ASSETS'));
  const port = await reservePort();
  // Existing settings suppress first-run browser launch. No CasparCG server,
  // OSC listener, operator content, API credentials or external route is used.
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    general: { port, hostname: 'automated-smoke-fixture', launchBrowser: false,
      loglevel: 'error', dataroot: dataRoot, logfolder: logRoot,
      templatesource: 'spx-ip-address', langfile: 'english.json',
      username: '', password: '', apikey: '', resolution: 'HD' },
    casparcg: { servers: [] }, osc: { enable: false }, globalExtras: {}
  }));
  const root = path.resolve(__dirname, '..');
  const child = spawnSupervisedProcess(process.execPath, [path.join(root, 'server.js')], {
    cwd: dir, env: { ...process.env, npm_package_version: packageVersion },
    windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe']
  });
  const errors = []; child.on('error', error => errors.push(error));
  const exited = once(child, 'exit');
  exited.catch(() => {});
  let captured = '';
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', data => {
    if (captured.length < 16384) captured += data.toString().slice(0, 16384 - captured.length);
  });
  t.after(async () => {
    try {
      if (child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') {
          try { await terminateProcessTree(child); }
          catch (error) { if (child.exitCode === null && child.signalCode === null) throw error; }
        } else child.kill('SIGTERM');
      }
      try { await Promise.race([exited, delay(5000, undefined, { ref: false }).then(() => { throw Error('SPX fixture shutdown timed out'); })]); }
      catch (error) {
        if (process.platform !== 'win32' && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        throw error;
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
  const health = normalizeHealthConfig('spx', { protocol: 'spx-http', host: '127.0.0.1', port, timeoutMs: 250 });
  const deadline = performance.now() + 10000;
  let result;
  do {
    if (errors.length) throw errors[0];
    if (child.exitCode !== null || child.signalCode !== null) {
      throw Error('Real SPX exited before readiness: ' + child.exitCode + '\n' + captured);
    }
    result = await probeServiceHealth(health);
    if (result.healthy) break;
    await delay(50);
  } while (performance.now() < deadline);
  assert.equal(result?.healthy, true, 'Actual SPX version endpoint did not become healthy: ' + result?.code + '\n' + captured);
  assert.equal(result.version, packageVersion);
  assert.equal(fs.existsSync(path.join(dir, 'config.json')), true);
  // This proves an actual SPX endpoint responds, not ownership of a listening
  // port by a PID, HTML/OGraf rendering, CasparCG, NDI or receiver operation.
});
