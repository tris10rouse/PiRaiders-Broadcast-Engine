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
  const closed = once(child, 'close');
  closed.catch(() => {});
  let captured = '';
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', data => {
    if (captured.length < 16384) captured += data.toString().slice(0, 16384 - captured.length);
  });
  const health = normalizeHealthConfig('spx', { protocol: 'spx-http', host: '127.0.0.1', port, timeoutMs: 250 });
  t.after(async () => {
    try {
      if (child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') {
          // Normal cleanup uses the host's cooperative EOF path, which waits
          // for all contained processes. Killing the host then observing only
          // its exit can race Windows working-directory handle release.
          child.stdin.end();
        } else child.kill('SIGTERM');
      }
      try { await Promise.race([closed, delay(8000, undefined, { ref: false }).then(() => { throw Error('SPX fixture shutdown timed out'); })]); }
      catch (error) {
        if (child.exitCode === null && child.signalCode === null) {
          if (process.platform === 'win32') await terminateProcessTree(child);
          else child.kill('SIGKILL');
          await Promise.race([closed, delay(5000, undefined, { ref: false }).then(() => { throw Error('SPX fallback cleanup timed out'); })]);
        }
        throw error; // Cleanup fallback must not turn a shutdown failure into PASS.
      }
      assert.equal((await probeServiceHealth(health)).healthy, false, 'SPX fixture must no longer be healthy after close');
    } finally {
      // Async retries let Windows close handles between attempts; exhaustion
      // still fails the test rather than silently abandoning the fixture.
      await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
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
  const renderer = await fetch('http://127.0.0.1:' + port + '/renderer/index.html', { redirect: 'error', signal: AbortSignal.timeout(3000) });
  assert.equal(renderer.status, 200); assert.match(await renderer.text(), /<html/i);
  assert.equal(fs.existsSync(path.join(dir, 'config.json')), true);
  // This proves an actual SPX endpoint responds, not ownership of a listening
  // port by a PID, HTML/OGraf rendering, CasparCG, NDI or receiver operation.
});
