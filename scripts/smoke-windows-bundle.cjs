#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { performance } = require('node:perf_hooks');
const { verifyManifest } = require('./lib/windows-bundle.cjs');

async function reservePort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function waitUntil(predicate, label, timeoutMs = 15000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) { if (await predicate()) return; await delay(25); }
  throw Error('Bundle smoke timed out: ' + label);
}
function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    let bytes = 0; const chunks = [];
    const request = http.get({ host: '127.0.0.1', port, path: urlPath, agent: false }, response => {
      response.on('data', data => {
        bytes += data.length;
        if (bytes > 2 * 1024 * 1024) request.destroy(Error('Fixture response exceeds limit'));
        else chunks.push(data);
      });
      response.once('error', reject);
      response.once('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    const timer = setTimeout(() => request.destroy(Error('Fixture HTTP timeout')), 3000);
    request.once('error', reject); request.once('close', () => clearTimeout(timer));
  });
}

async function smokeWindowsBundle(archive) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Windows x64 is required for artifact smoke validation');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'PiRaiders smoke 鷹 ! '));
  const extraction = path.join(work, 'Extracted package');
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const root = path.join(extraction, 'PiRaiders-Development'), app = path.join(root, 'app');
  const hosts = new Set(); let outer;
  const stopOuter = async child => {
    if (!child || !Number.isSafeInteger(child.pid) || child.exitCode !== null || child.signalCode !== null) return;
    child.stdin.end();
    try { await waitUntil(() => child.exitCode !== null || child.signalCode !== null, 'outer job cleanup', 10000); }
    catch (error) { child.kill('SIGKILL'); await waitUntil(() => !alive(child.pid), 'forced outer job cleanup', 10000); throw error; }
  };
  try {
    fs.mkdirSync(extraction);
  // Paths enter PowerShell only as environment data, never executable source.
  execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:PIRAIDERS_SMOKE_ARCHIVE, $env:PIRAIDERS_SMOKE_EXTRACT)'], {
    env: { ...process.env, PIRAIDERS_SMOKE_ARCHIVE: path.resolve(archive), PIRAIDERS_SMOKE_EXTRACT: extraction },
    stdio: 'inherit', windowsHide: true, timeout: 300000
  });
    const manifest = verifyManifest(root);
    assert.equal(manifest.developmentOnly, true);
    assert.ok(fs.existsSync(path.join(app, 'locales', 'english.json')));
    assert.equal(fs.existsSync(path.join(app, 'node_modules', 'nodemon')), false, 'development dependencies must not ship');
    const original = fs.readFileSync(path.join(app, 'server.js'));
    fs.appendFileSync(path.join(app, 'server.js'), '\n// smoke tamper');
    assert.throws(() => verifyManifest(root), /hash|checksum|size|integrity/i);
    fs.writeFileSync(path.join(app, 'server.js'), original); verifyManifest(root);

    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^path$/i.test(key) || /^node_(?:options|path)$/i.test(key) || /^npm_/i.test(key)) delete env[key];
    env.Path = [path.join(process.env.SystemRoot, 'System32'), process.env.SystemRoot].join(';');
    env.PIRAIDERS_SMOKE_ENTRY = path.join(root, 'Launch-PiRaiders.cmd');
    for (const notice of ['PNGJS-LICENSE.txt', 'JPEG-JS-LICENSE.txt']) {
      assert.ok(fs.statSync(path.join(root, 'licenses', notice)).size > 500);
    }
    // Exercise workers and production-only decoder resolution from the actual
    // archive, with no global Node or NODE_PATH and no repository dependency.
    const mediaBench = path.join(work, 'bundled-media-bench.cjs');
    fs.writeFileSync(mediaBench, String.raw`
'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const app = process.argv[2], work = process.argv[3];
const bundledRequire = require('node:module').createRequire(path.join(app, 'package.json'));
const { PNG } = bundledRequire('pngjs'), jpeg = bundledRequire('jpeg-js');
assert.equal(bundledRequire('pngjs/package.json').version, '7.0.0');
assert.equal(bundledRequire('jpeg-js/package.json').version, '0.4.4');
const { stageSnapshot, loadSnapshot } = bundledRequire('./scripts/lib/media-snapshot.cjs');
async function main() {
  const sourceDir = path.join(work, 'Simulated synced media'), cacheDir = path.join(work, 'Immutable media cache');
  fs.mkdirSync(sourceDir);
  const image = { width: 2, height: 2, data: Buffer.from([255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,128]) };
  fs.writeFileSync(path.join(sourceDir, '01.png'), PNG.sync.write(image));
  fs.writeFileSync(path.join(sourceDir, '02.jpg'), jpeg.encode(image, 90).data);
  const prepared = await stageSnapshot({ sourceDir, cacheDir, quietMs: 0 });
  assert.equal(prepared.deck.slides.length, 2);
  assert.deepEqual(prepared.manifest.files.map(file => [file.format, file.width, file.height]), [['png',2,2],['jpeg',2,2]]);
  fs.rmSync(sourceDir, { recursive: true });
  const offline = await loadSnapshot(prepared.snapshotDir);
  assert.deepEqual(offline.deck, prepared.deck);
  assert.equal(offline.manifest.contentHash, prepared.manifest.contentHash);
  console.log(JSON.stringify({ event: 'media-snapshot-smoke-passed', platform: process.platform, decoded: ['png','jpeg'], offlineHashAndDecode: true }));
}
main().catch(() => { console.error('Bundled media validation failed'); process.exitCode = 1; });
`);
    const mediaOutput = execFileSync(path.join(root, 'runtime', 'node.exe'), [mediaBench, app, work], {
      cwd: work, env, windowsHide: true, shell: false, timeout: 30000, encoding: 'utf8', maxBuffer: 65536
    });
    assert.match(mediaOutput, /media-snapshot-smoke-passed/);
    process.stdout.write(mediaOutput);

    const start = () => {
      const events = [], errors = [];
      const child = spawn(path.join(app, 'build', 'windows', 'PiRaiders.JobHost.exe'), [powershell,
        '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '& $env:PIRAIDERS_SMOKE_ENTRY; exit $LASTEXITCODE'], {
        cwd: work, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe']
      });
      let text = '', buffered = '';
      child.stdin.on('error', () => {}); // Host exit races with deliberate EOF.
      child.on('error', error => errors.push(error));
      const exited = once(child, 'exit'); exited.catch(() => {});
      child.stdout.on('data', data => {
        if (text.length < 65536) text += data.toString().slice(0, 65536 - text.length);
        buffered += data.toString();
        if (buffered.length > 65536) buffered = buffered.slice(-65536);
        let newline;
        while ((newline = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, newline).trim(); buffered = buffered.slice(newline + 1);
          if (line.startsWith('{')) try {
            const event = JSON.parse(line); events.push(event);
            if (event.event === 'started' && Number.isSafeInteger(event.pid)) hosts.add(event.pid);
          } catch { /* SPX splash output is not a structured launcher event. */ }
        }
      });
      child.stderr.on('data', data => { if (text.length < 65536) text += data.toString().slice(0, 65536 - text.length); });
      return { child, events, errors, exited, output: () => text };
    };
    let missing = start(); outer = missing.child;
    const [missingCode] = await Promise.race([missing.exited, delay(10000, undefined, { ref: false }).then(() => { throw Error('Missing-config launcher did not exit'); })]);
    assert.equal(missingCode, 2); assert.equal(missing.events.length, 0);
    assert.equal(fs.existsSync(path.join(app, 'config.json')), false, 'SPX must not start without launcher settings');

    const spxPort = await reservePort(); let amcpPort = await reservePort();
    while (amcpPort === spxPort) amcpPort = await reservePort();
    const dataRoot = path.join(app, 'DATAROOT-smoke'), logRoot = path.join(app, 'LOG-smoke');
    fs.mkdirSync(path.join(dataRoot, 'SmokeProject', 'data'), { recursive: true }); fs.mkdirSync(logRoot);
    fs.writeFileSync(path.join(dataRoot, 'SmokeProject', 'profile.json'), JSON.stringify({ general: {}, templates: [], showExtras: { CustomControls: [] } }));
    fs.writeFileSync(path.join(dataRoot, 'SmokeProject', 'data', 'SmokeRundown.json'), JSON.stringify({ templates: [] }));
    fs.writeFileSync(path.join(app, 'config.json'), JSON.stringify({
      general: { port: spxPort, hostname: 'bundled-smoke-fixture', launchBrowser: false, loglevel: 'error',
        dataroot: dataRoot, logfolder: logRoot, username: '', password: '', apikey: '', langfile: 'english.json',
        resolution: 'HD', recents: [], renderer: 'normal', preview: 'none', templatesource: 'spx-ip-address' },
      casparcg: { servers: [] }, osc: { enable: false }, globalExtras: { CustomControls: [] }
    }));
    const stateFile = path.join(work, 'simulator-pid.json'), commandsFile = path.join(work, 'amcp-commands.json');
    const fixture = path.join(work, 'amcp-stand-in.cjs');
    fs.writeFileSync(fixture, `
'use strict';
const fs=require('node:fs'),net=require('node:net');
const commands=[];
const server=net.createServer(socket=>{let data='';socket.on('error',()=>{});socket.on('data',chunk=>{
  data+=chunk.toString();if(data.length>64){socket.destroy();return;}
  if(data.endsWith('\\r\\n')){commands.push(data);fs.writeFileSync(process.argv[3],JSON.stringify(commands));
    if(data==='VERSION\\r\\n')socket.end('201 VERSION OK\\r\\n2.4.0 SMOKE-SIMULATOR\\r\\n');else socket.destroy();}
});});
server.listen(Number(process.argv[4]),'127.0.0.1',()=>fs.writeFileSync(process.argv[2],JSON.stringify({pid:process.pid})));
setTimeout(()=>process.exit(2),45000);
`);
    const windowEnd = Date.now() + 20000;
    fs.writeFileSync(path.join(app, 'config', 'piraiders-launcher.json'), JSON.stringify({
      productionWindow: { start: new Date(Date.now() - 1000).toISOString(), end: new Date(windowEnd).toISOString(), prewarmMinutes: 0 },
      services: [
        { name: 'spx', executable: '../runtime/node.exe', args: ['server.js'], cwd: '.', health: { protocol: 'spx-http', port: spxPort } },
        { name: 'casparcg', executable: '../runtime/node.exe', args: [fixture, stateFile, commandsFile, String(amcpPort)], cwd: '.', health: { protocol: 'casparcg-amcp', port: amcpPort } }
      ]
    }));
    const running = start(); outer = running.child;
    await waitUntil(() => {
      if (running.errors.length) throw running.errors[0];
      if (outer.exitCode !== null) throw Error('Extracted launcher exited: ' + running.output());
      return ['spx', 'casparcg'].every(name => running.events.some(e => e.event === 'service-health' && e.name === name && e.status === 'ready'));
    }, 'both real process endpoints ready');
    const simulatorPid = JSON.parse(fs.readFileSync(stateFile)).pid;
    assert.equal(alive(simulatorPid), true);
    const admin = await get(spxPort, '/admin'); assert.equal(admin.status, 200, 'bundled admin route'); assert.match(admin.body, /<title>[^<]*Admin/); assert.doesNotMatch(admin.body, /missing from english/);
    const controller = await get(spxPort, '/gc/SmokeProject/SmokeRundown'); assert.equal(controller.status, 200, 'bundled controller route'); assert.match(controller.body, /SPX/); assert.doesNotMatch(controller.body, /missing from english/);
    const renderer = await get(spxPort, '/renderer/index.html'); assert.equal(renderer.status, 200, 'bundled renderer route'); assert.match(renderer.body, /<html/i);
    const html = await get(spxPort, '/templates/softpix/html/Template_Pack_1.4.0/INFO_LEFT.html'); assert.equal(html.status, 200, 'bundled HTML template route'); assert.match(html.body, /SPXGCTemplateDefinition/);
    const ograf = await get(spxPort, '/templates/softpix/ograf/Template_Pack_1.4.0/INFO_LEFT.ograf.json'); assert.equal(ograf.status, 200, 'bundled OGraf manifest route'); assert.equal(typeof JSON.parse(ograf.body), 'object');
    await waitUntil(() => running.events.some(e => e.event === 'service-health' && e.name === 'casparcg' && e.status === 'stopped' && Date.parse(e.at) >= windowEnd),
      'production end stops simulated sender', 30000);
    await waitUntil(() => !alive(simulatorPid), 'simulated sender process exit');
    assert.equal((await get(spxPort, '/api/v1/version')).status, 200, 'SPX must persist after sender window ends');
    const commands = JSON.parse(fs.readFileSync(commandsFile)); assert.ok(commands.length > 0); assert.ok(commands.every(c => c === 'VERSION\r\n'));
    assert.equal(running.events.filter(e => e.event === 'fault' || e.event === 'restarting').length, 0, 'smoke services must remain stable until the window end');
    await stopOuter(outer);
    for (const pid of hosts) await waitUntil(() => !alive(pid), 'contained service host exit');
    await assert.rejects(get(spxPort, '/api/v1/version'));
    console.log(JSON.stringify({ event: 'windows-bundle-smoke-passed', sourceCommit: manifest.commitSHA,
      node: manifest.node.version, actualBundledSPX: true, casparcg: 'AMCP simulator only',
      pathSpacesAndUnicode: true, noSystemNode: true, manifestVerified: true, senderWindowEnd: true, bundledMediaSnapshots: true }));
    return manifest;
  } finally {
    try { await stopOuter(outer); }
    finally { fs.rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  }
}
if (require.main === module) smokeWindowsBundle(path.resolve(process.argv[2] || 'build/windows/PiRaiders-Development-win-x64.zip'))
  .catch(error => { console.error('Windows bundle smoke failed:', error.message); process.exitCode = 1; });
module.exports = { smokeWindowsBundle };
