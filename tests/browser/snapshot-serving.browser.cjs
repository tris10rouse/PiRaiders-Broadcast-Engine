'use strict';
// Real browser + real HTTP + staged bytes. Browser automation is the test-only
// completion adapter here; no production transport/launcher wiring is implied.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const { stageSnapshot } = require('../../scripts/lib/media-snapshot.cjs');
const { createSnapshotMediaHandler } = require('../../scripts/lib/snapshot-media-handler.cjs');
const { SlideshowController } = require('../../scripts/lib/slideshow-controller.cjs');
const assets = path.resolve(__dirname, '../../ASSETS/templates/piraiders/slideshow');
function solid(width, height, rgb) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
  return { width, height, data };
}
async function center(page) {
  const png = PNG.sync.read(await page.screenshot());
  const i = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
  return [...png.data.subarray(i, i + 3)];
}
function near(actual, expected) {
  assert.ok(actual.every((v, i) => Math.abs(v - expected[i]) <= 8), `${actual} near ${expected}`);
}
test('offline snapshot HTTP reaches real native output; controller wrap, atomic Reload, failures and Stop preserve honest state', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'PiRaiders browser media '));
  let media, server, browser, context, controller;
  const registered = new Map();
  t.after(async () => {
    controller?.close(); for (const handler of registered.values()) handler.close();
    await context?.close(); await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await fs.rm(temporary, { recursive:true, force:true, maxRetries:10, retryDelay:100 });
  });
  const sourceDir = path.join(temporary, 'source'), cacheDir = path.join(temporary, 'cache');
  await fs.mkdir(sourceDir);
  const red = PNG.sync.write(solid(160, 90, [240, 20, 20]));
  const blue = jpeg.encode(solid(90, 160, [20, 20, 240]), 95).data;
  await fs.writeFile(path.join(sourceDir, '01.png'), red);
  await fs.writeFile(path.join(sourceDir, '02.jpg'), blue);
  const staged = await stageSnapshot({ sourceDir, cacheDir, quietMs:0 });
  await fs.rm(sourceDir, { recursive:true });
  // Test-only session. Production session issuance/revocation remains a separate
  // integration task; no route in server.js implicitly grants this credential.
  media = await createSnapshotMediaHandler({snapshotDir:staged.snapshotDir, authorize:req => req.headers.cookie === 'fixture-session=authorized'});
  registered.set(media.deck.id, media);
  server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/piraiders/media/')) {
      const handler = registered.get(req.url.split('/')[3]);
      if (handler) await handler.handle(req, res);
      else { res.writeHead(404); res.end(); }
      return;
    }
    const files = { '/SLIDESHOW.html':['SLIDESHOW.html','text/html'], '/slideshow-renderer.js':['slideshow-renderer.js','text/javascript'], '/template-interface.js':['template-interface.js','text/javascript'], '/slideshow.css':['slideshow.css','text/css'] };
    const file = files[req.url];
    if (!file) { res.writeHead(404); res.end(); return; }
    try { res.setHeader('Content-Type', file[1]); res.end(await fs.readFile(path.join(assets, file[0]))); }
    catch { res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.PIRAIDERS_BROWSER_EXECUTABLE;
  if (executablePath) assert.ok(path.isAbsolute(executablePath));
  browser = await chromium.launch({headless:true, ...(executablePath ? {executablePath} : {}), args:['--no-sandbox']});
  context = await browser.newContext({viewport:{width:960,height:540}});
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(origin + '/SLIDESHOW.html');
  await page.waitForFunction(() => !!window.piraidersRenderer);
  const show = src => page.evaluate(async src => {
    try { await window.piraidersRenderer.show({src}); return 'ok'; }
    catch (error) { return error.code; }
  }, src);
  assert.equal(await show(media.deck.slides[0].src), 'LOAD_FAILED');
  near(await center(page), [0,0,0]);
  await context.addCookies([{name:'fixture-session',value:'authorized',url:origin,httpOnly:true,sameSite:'Strict'}]);
  controller = new SlideshowController({deck:media.deck,mode:'manual',handlerTimeoutMs:5000,renderer:{
    show: ({slide,transition}) => page.evaluate(({src,transition}) => window.piraidersRenderer.show({src,transition}), {src:slide.src,transition}),
    black: () => page.evaluate(() => window.piraidersRenderer.black())
  }});
  for (const [action, index, color] of [['launch',0,[240,20,20]],['previous',1,[20,20,240]],['next',0,[240,20,20]]]) {
    assert.equal((await controller.dispatch(action)).ok, true);
    assert.equal(controller.snapshot().index, index); near(await center(page), color);
  }
  const damaged = path.join(staged.snapshotDir, staged.manifest.files[1].src);
  const corrupted = Buffer.from(blue); corrupted[corrupted.length - 1] ^= 1;
  await fs.writeFile(damaged, corrupted);
  assert.equal((await controller.dispatch('next')).ok, false);
  assert.equal(controller.snapshot().index, 0); assert.equal(controller.snapshot().autoSuspended, true);
  near(await center(page), [240,20,20]);
  await fs.writeFile(damaged, blue);
  assert.equal((await controller.dispatch('next')).ok, true); near(await center(page), [20,20,240]);
  // A second immutable snapshot changes membership/order, while the surviving
  // occurrence keeps its identity. No file in the old snapshot is overwritten.
  await fs.mkdir(sourceDir);
  await fs.writeFile(path.join(sourceDir, '02.jpg'), blue);
  await fs.writeFile(path.join(sourceDir, '03.png'), PNG.sync.write(solid(160, 90, [20,220,20])));
  const candidate = await stageSnapshot({sourceDir,cacheDir,quietMs:0});
  await fs.rm(sourceDir, {recursive:true});
  const candidateMedia = await createSnapshotMediaHandler({snapshotDir:candidate.snapshotDir,authorize:req => req.headers.cookie === 'fixture-session=authorized'});
  registered.set(candidateMedia.deck.id, candidateMedia);
  assert.equal((await controller.replaceDeck(candidateMedia.deck)).ok, true);
  assert.equal(controller.snapshot().deckId, candidateMedia.deck.id);
  assert.equal(controller.snapshot().index, 0, 'surviving blue occurrence moves to its new index');
  near(await center(page), [20,20,240]);
  assert.equal((await controller.dispatch('next')).ok, true); near(await center(page), [20,220,20]);
  const oldRed = path.join(staged.snapshotDir, staged.manifest.files[0].src);
  await fs.writeFile(oldRed, Buffer.alloc(red.length));
  assert.equal((await controller.replaceDeck(media.deck)).ok, false);
  assert.equal(controller.snapshot().deckId, candidateMedia.deck.id);
  assert.equal(controller.snapshot().index, 1); near(await center(page), [20,220,20]);
  await fs.writeFile(oldRed, red);
  assert.equal((await controller.replaceDeck(media.deck)).ok, true);
  assert.equal(controller.snapshot().index, 0, 'removed occurrence falls back to slide1');
  near(await center(page), [240,20,20]);
  assert.equal((await controller.dispatch('stop')).ok, true); near(await center(page), [0,0,0]);
  assert.equal((await controller.dispatch('next')).ok, false); near(await center(page), [0,0,0]);
  assert.equal((await controller.replaceDeck(candidateMedia.deck)).ok, true);
  assert.equal(controller.snapshot().state, 'stopped'); assert.equal(controller.snapshot().index, null);
  near(await center(page), [0,0,0]);
  assert.equal((await controller.dispatch('launch')).ok, true); near(await center(page), [20,20,240]);
  assert.equal((await controller.replaceDeck(media.deck)).ok, true);
  assert.equal((await controller.dispatch('launch')).ok, true); near(await center(page), [240,20,20]);
  media.close();
  assert.equal((await controller.dispatch('next')).ok, false); near(await center(page), [240,20,20]);
  assert.equal((await controller.dispatch('stop')).ok, true); near(await center(page), [0,0,0]);
  const artifactDir = path.resolve(__dirname, '../../build/browser-artifacts');
  await fs.mkdir(artifactDir, {recursive:true});
  await fs.writeFile(path.join(artifactDir, 'snapshot-serving.json'), JSON.stringify({
    scope:'Actual staged/offline PNG and JPEG via restricted HTTP into native Chromium output; browser automation completion adapter only, no production bridge or hardware proof',
    browserVersion:browser.version(),platform:process.platform,checks:['unauthorized black','launch slide 1','previous/next wrap','tamper last-good retention','restore recovery','reload preserves occurrence after reorder','failed reload keeps deck and pixels','removed occurrence falls back to slide1','stopped reload stays black','Stop black','closed media revocation']
  }, null, 2));
});
