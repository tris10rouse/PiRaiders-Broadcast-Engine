'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const { startFixtureServer, repository } = require('./fixture-server.cjs');
const template = '/templates/piraiders/slideshow/SLIDESHOW.html';
const artifacts = path.join(repository, 'build/browser-artifacts');
let fixture, browser, context;
before(async () => {
  fixture = await startFixtureServer();
  const executablePath = process.env.PIRAIDERS_BROWSER_EXECUTABLE;
  if (executablePath) assert.ok(path.isAbsolute(executablePath), 'PIRAIDERS_BROWSER_EXECUTABLE must be absolute');
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
  context = await browser.newContext({ viewport: { width:1920, height:1080 }, deviceScaleFactor:1 });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === fixture.origin || url.protocol === 'data:' ? route.continue() : route.abort();
  });
  await fs.mkdir(artifacts, { recursive:true });
  const hashes = {};
  const sourceFiles = ['SLIDESHOW.html','slideshow-renderer.js','slideshow.css','template-interface.js']
    .map(name => 'ASSETS/templates/piraiders/slideshow/' + name)
    .concat('ASSETS/templates/softpix/ograf/Template_Pack_1.4.0/INFO_LEFT.mjs');
  for (const name of sourceFiles) {
    hashes[name] = crypto.createHash('sha256').update(await fs.readFile(path.join(repository,name))).digest('hex');
  }
  await fs.rm(path.join(artifacts,'ograf-upstream-defect.json'), {force:true});
  await fs.writeFile(path.join(artifacts, 'provenance.json'), JSON.stringify({
    browserVersion:browser.version(), platform:process.platform, architecture:process.arch,
    gitHEAD:execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim(),
    workingTreeDirty:execFileSync('git',['status','--porcelain'],{cwd:repository,encoding:'utf8'}).trim().length > 0,
    sourceSHA:crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex'), sourceFiles:hashes,
    fixture:'synthetic solid-color PNG and JPEG; loopback HTTP only',
    scope:'Chromium browser evidence only; no CasparCG, NDI, receiver or stadium hardware verification'
  }, null, 2));
});
after(async () => { await context?.close(); await browser?.close(); await fixture?.close(); });
async function pageFor(t) {
  const page = await context.newPage();
  t.after(() => page.close());
  await page.goto(fixture.origin + template);
  await page.waitForFunction(() => !!window.piraidersRenderer);
  return page;
}
async function show(page, name, transition) {
  return page.evaluate(({name,transition}) => window.piraidersRenderer.show({src:'/piraiders/media/' + name, ...(transition ? {transition} : {})}), {name,transition});
}
async function capture(page, name) {
  const bytes = await page.screenshot(name ? {path:path.join(artifacts, name)} : {});
  return PNG.sync.read(bytes);
}
function rgb(png, x = Math.floor(png.width / 2), y = Math.floor(png.height / 2)) {
  return [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
}
function near(actual, expected, tolerance = 6) {
  assert.ok(actual.every((value, i) => Math.abs(value - expected[i]) <= tolerance), `${actual} near ${expected}`);
}
function black(png) {
  for (let i=0; i<png.data.length; i+=4) assert.ok(png.data[i] <= 2 && png.data[i+1] <= 2 && png.data[i+2] <= 2, `nonblack pixel at ${i / 4}`);
}
test('decoded PNG/JPEG contain correctly at HD and half-size; black clears every pixel', async t => {
  const page = await pageFor(t);
  black(await capture(page));
  await show(page, 'red.png');
  const hd = await capture(page, 'slideshow-hd.png');
  near(rgb(hd), [240,20,20]); near(rgb(hd, 2, 2), [240,20,20]);
  await show(page, 'portrait.jpg');
  const portrait = await capture(page, 'slideshow-portrait-hd.png');
  near(rgb(portrait), [20,20,240]); near(rgb(portrait, 2, 540), [0,0,0]);
  await page.setViewportSize({width:960,height:540});
  const small = await capture(page, 'slideshow-portrait-960.png');
  near(rgb(small), [20,20,240]); near(rgb(small, 2, 270), [0,0,0]);
  await page.evaluate(() => { window.piraidersRenderer.showMode('auto'); window.piraidersRenderer.setReloadState('loading'); window.piraidersRenderer.black(); });
  black(await capture(page, 'slideshow-stop-black.png'));
});
test('missing, corrupt, timed-out and aborted candidates retain decoded last good frame', async t => {
  const page = await pageFor(t);
  await page.evaluate(() => { window.piraidersRenderer.dispose(); window.piraidersRenderer = new window.PiRaidersSlideshowRenderer({root:document.body,mediaRoot:'/piraiders/media/',loadTimeoutMs:120}); });
  await show(page, 'green.png');
  for (const name of ['missing.png','corrupt.png','delayed.png']) {
    const outcome = await page.evaluate(async name => {
      try { await window.piraidersRenderer.show({src:'/piraiders/media/' + name}); return 'unexpected success'; }
      catch (error) { return error.code; }
    }, name);
    assert.equal(outcome, name === 'delayed.png' ? 'LOAD_TIMEOUT' : 'LOAD_FAILED');
    near(rgb(await capture(page)), [20,220,20]);
  }
  const aborted = await page.evaluate(async () => {
    const abort = new AbortController();
    const pending = window.piraidersRenderer.show({src:'/piraiders/media/delayed.png',signal:abort.signal});
    abort.abort(); return Promise.resolve(pending).then(() => 'unexpected success', error => error.code);
  });
  assert.equal(aborted, 'CANCELED');
  await page.waitForTimeout(750);
  near(rgb(await capture(page, 'slideshow-last-good.png')), [20,220,20]);
});
test('fade produces actual mixed pixels; newer requests and Stop prevent resurrection', async t => {
  const page = await pageFor(t);
  await show(page, 'red.png');
  await page.evaluate(() => { window.pending = window.piraidersRenderer.show({src:'/piraiders/media/green.png',transition:{type:'fade',durationMs:1000}}); });
  await page.waitForTimeout(450);
  const midpoint = rgb(await capture(page, 'slideshow-fade-midpoint.png'));
  assert.ok(midpoint[0] > 55 && midpoint[0] < 220 && midpoint[1] > 50 && midpoint[1] < 205, `visible fade blend: ${midpoint}`);
  await page.evaluate(() => window.pending);
  near(rgb(await capture(page)), [20,220,20]);
  await page.evaluate(async () => {
    const slow = window.piraidersRenderer.show({src:'/piraiders/media/delayed.png'});
    const newer = window.piraidersRenderer.show({src:'/piraiders/media/portrait.jpg'});
    await Promise.allSettled([slow,newer]);
  });
  near(rgb(await capture(page)), [20,20,240]);
  await page.evaluate(() => { window.pending = window.piraidersRenderer.show({src:'/piraiders/media/delayed.png'}); window.piraidersRenderer.black(); });
  await page.waitForTimeout(750); black(await capture(page));
  await show(page, 'red.png');
  await page.evaluate(() => { window.pending = window.piraidersRenderer.show({src:'/piraiders/media/green.png',transition:{type:'fade',durationMs:500}}); });
  await page.waitForTimeout(100);
  await page.evaluate(() => window.piraidersRenderer.black());
  await page.waitForTimeout(650); black(await capture(page));
});
test('wide-to-portrait fade blends letterbox pixels continuously to black', async t => {
  const page = await pageFor(t);
  await show(page, 'red.png');
  await page.evaluate(() => { window.pending = window.piraidersRenderer.show({src:'/piraiders/media/portrait.jpg',transition:{type:'fade',durationMs:1000}}); });
  await page.waitForTimeout(450);
  const midpoint = await capture(page, 'slideshow-portrait-fade-midpoint.png');
  const edge = rgb(midpoint, 20, 540);
  assert.ok(edge[0] > 55 && edge[0] < 200 && edge[1] < 20 && edge[2] < 20, `letterbox fades old red to black: ${edge}`);
  await page.evaluate(() => window.pending);
  near(rgb(await capture(page), 20, 540), [0,0,0]);
});
test('animation platform failures and stalled paint reject promptly, retain last frame and recover', async t => {
  const page = await pageFor(t);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await show(page, 'red.png');
  const thrown = await page.evaluate(async () => {
    const original = Element.prototype.animate;
    Element.prototype.animate = () => { throw new Error('synthetic animation platform failure'); };
    try {
      return await Promise.race([
        window.piraidersRenderer.show({src:'/piraiders/media/green.png',transition:{type:'fade',durationMs:500}}).then(() => 'unexpected success', error => error.code),
        new Promise(resolve => setTimeout(() => resolve('operation hung'), 2200))
      ]);
    } finally { Element.prototype.animate = original; }
  });
  assert.equal(thrown, 'TRANSITION_FAILED');
  assert.equal(await page.evaluate(() => window.piraidersRenderer.snapshot().pending), false);
  near(rgb(await capture(page)), [240,20,20]);
  await page.evaluate(() => {
    window.failureResult = window.piraidersRenderer.show({src:'/piraiders/media/green.png',transition:{type:'fade',durationMs:10000}}).then(() => 'unexpected success', error => error.code);
  });
  await page.waitForFunction(() => window.piraidersRenderer.snapshot().state === 'transitioning');
  await page.evaluate(() => document.querySelectorAll('.piraiders-slide').forEach(el => el.getAnimations().forEach(animation => animation.cancel())));
  const canceled = await page.evaluate(() => Promise.race([window.failureResult,new Promise(resolve => setTimeout(() => resolve('operation hung'), 1800))]));
  assert.equal(canceled, 'TRANSITION_FAILED');
  assert.equal(await page.evaluate(() => window.piraidersRenderer.snapshot().pending), false);
  near(rgb(await capture(page)), [240,20,20]);
  const stalled = await page.evaluate(async () => {
    const original = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 2147483647;
    try {
      return await Promise.race([
        window.piraidersRenderer.show({src:'/piraiders/media/green.png'}).then(() => 'unexpected success', error => error.code),
        new Promise(resolve => setTimeout(() => resolve('operation hung'), 2200))
      ]);
    } finally { window.requestAnimationFrame = original; }
  });
  assert.equal(stalled, 'TRANSITION_FAILED');
  assert.equal(await page.evaluate(() => window.piraidersRenderer.snapshot().pending), false);
  near(rgb(await capture(page)), [240,20,20]);
  await show(page, 'portrait.jpg');
  near(rgb(await capture(page)), [20,20,240]);
  assert.deepEqual(pageErrors, [], 'platform failures are handled promise rejections');
});
test('unsafe URLs are rejected before fetch and disposal cancels active work', async t => {
  const page = await pageFor(t);
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  for (const src of ['https://example.invalid/private.png','//example.invalid/private.png','data:image/png;base64,eA==','javascript:alert(1)','/other.png','/piraiders/media/../secret.png','/piraiders/media/%2e%2e/secret.png']) {
    await page.evaluate(src => Promise.resolve(window.piraidersRenderer.show({src})).catch(() => {}), src);
  }
  assert.deepEqual(requests, [], 'invalid URLs must never enter the network stack');
  await page.evaluate(() => { window.pending = window.piraidersRenderer.show({src:'/piraiders/media/delayed.png'}); window.piraidersRenderer.showMode('manual'); window.piraidersRenderer.setReloadState('loading'); window.piraidersRenderer.dispose(); });
  await page.waitForTimeout(750);
  assert.equal(await page.locator('img').count(), 0, 'dispose removes image layers');
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'dispose removes animations');
  black(await capture(page));
});
test('audience mode rise, 75 percent hold and fade; loading and safe failure feedback retain program image', async t => {
  const page = await pageFor(t);
  await show(page, 'green.png');
  await page.evaluate(() => window.piraidersRenderer.showMode('auto'));
  await page.waitForTimeout(60);
  const entering = await page.locator('.piraiders-mode').evaluate(el => ({opacity:Number(getComputedStyle(el).opacity),transform:getComputedStyle(el).transform}));
  assert.ok(entering.opacity > 0 && entering.opacity < .75, 'mode rises into view');
  assert.notEqual(entering.transform, 'none');
  await page.waitForTimeout(400);
  const mode = page.locator('.piraiders-mode');
  assert.equal(await mode.innerText(), 'AUTO');
  const held = await mode.evaluate(el => ({opacity:Number(getComputedStyle(el).opacity),border:getComputedStyle(el).borderTopColor,rect:el.getBoundingClientRect().toJSON()}));
  assert.ok(held.opacity >= .73 && held.opacity <= .76, `mode hold opacity ${held.opacity}`);
  assert.ok(held.rect.x > 960 && held.rect.y > 540, 'mode is lower right');
  await capture(page, 'slideshow-auto-feedback.png');
  await page.waitForTimeout(550);
  assert.ok(await mode.evaluate(el => Number(getComputedStyle(el).opacity)) >= .73, 'roughly one-second hold');
  await page.waitForTimeout(800);
  assert.ok(await mode.evaluate(el => Number(getComputedStyle(el).opacity)) <= .01, 'feedback fades to zero');
  await page.evaluate(() => window.piraidersRenderer.showMode('manual'));
  assert.equal(await mode.innerText(), 'MANUAL');
  await page.evaluate(() => window.piraidersRenderer.setReloadState('loading'));
  assert.equal(await page.locator('.piraiders-spinner').count(), 1);
  near(rgb(await capture(page, 'slideshow-loading.png')), [20,220,20]);
  await page.evaluate(() => window.piraidersRenderer.setReloadState('failed'));
  assert.equal(await page.locator('.piraiders-reload').innerText(), 'RELOAD FAILED');
  near(rgb(await capture(page, 'slideshow-reload-failed.png')), [20,220,20]);
  await page.waitForTimeout(1900);
  assert.equal(await page.locator('.piraiders-reload').isVisible(), false);
  await page.evaluate(() => { window.piraidersRenderer.setReloadState('loading'); window.piraidersRenderer.setReloadState('complete'); });
  assert.equal(await page.locator('.piraiders-reload').isVisible(), false);
});
test('mode and failure feedback remain separate and readable over white at HD and scaled preview', async t => {
  const page = await pageFor(t);
  await show(page, 'white.png');
  for (const [width,height] of [[1920,1080],[960,540]]) {
    await page.setViewportSize({width,height});
    await page.evaluate(() => { window.piraidersRenderer.showMode('auto'); window.piraidersRenderer.setReloadState('failed'); });
    await page.waitForTimeout(400);
    const bounds = await page.evaluate(() => ['.piraiders-mode','.piraiders-reload'].map(selector => {
      const el = document.querySelector(selector);
      return {rect:el.getBoundingClientRect().toJSON(),background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color};
    }));
    assert.ok(bounds[1].rect.bottom < bounds[0].rect.top, `feedback does not overlap at ${width}`);
    const output = await capture(page, `slideshow-white-feedback-${width}.png`);
    near(rgb(output), [255,255,255]);
    for (const {rect,background,color} of bounds) {
      assert.equal(background, 'rgb(0, 0, 0)');
      assert.equal(color, 'rgb(255, 255, 255)');
      assert.ok(rgb(output,Math.floor(rect.x + 3),Math.floor(rect.y + 3)).every(channel => channel < 110), 'backplate darkens bright slide beneath feedback');
    }
  }
});
test('native template update waits for Play; Continue owns no timer or navigation; Stop is black', async t => {
  const page = await pageFor(t);
  await page.evaluate(() => window.update(JSON.stringify({f0:JSON.stringify({src:'/piraiders/media/red.png'})})));
  black(await capture(page));
  await page.evaluate(() => window.play());
  await page.waitForFunction(() => [...document.images].some(img => img.complete && img.naturalWidth));
  await page.waitForTimeout(80); near(rgb(await capture(page)), [240,20,20]);
  await page.evaluate(() => window.next());
  await page.waitForTimeout(10100); near(rgb(await capture(page)), [240,20,20]);
  await page.evaluate(() => window.update(JSON.stringify({f0:JSON.stringify({src:'/piraiders/media/green.png'})})));
  await page.waitForTimeout(100); near(rgb(await capture(page)), [20,220,20]);
  await page.evaluate(() => window.stop()); black(await capture(page));
});
test('strict transitions, frozen snapshots, black feedback suppression and valid pending work survive malformed input', async t => {
  const page = await pageFor(t);
  assert.equal(await page.evaluate(() => Object.isFrozen(window.piraidersRenderer.snapshot())), true);
  await page.evaluate(() => { window.piraidersRenderer.showMode('auto'); window.piraidersRenderer.setReloadState('loading'); });
  black(await capture(page));
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  await page.evaluate(() => { window.pending = window.piraidersRenderer.show({src:'/piraiders/media/delayed.png'}); });
  for (const frame of [
    {src:'/other.png'},
    {src:'/piraiders/media/green.png',transition:{type:'cut',durationMs:1}},
    {src:'/piraiders/media/green.png',transition:{type:'fade',durationMs:1.5}}
  ]) {
    const code = await page.evaluate(async frame => {
      try { await window.piraidersRenderer.show(frame); return 'unexpected success'; } catch(error) { return error.code; }
    }, frame);
    assert.equal(code, frame.src === '/other.png' ? 'INVALID_SOURCE' : 'INVALID_TRANSITION');
    assert.equal(await page.evaluate(() => window.piraidersRenderer.snapshot().pending), true);
  }
  await page.evaluate(() => window.pending);
  near(rgb(await capture(page)), [240,20,20]);
});
test('first frame feedback waits for commit, accepts SPX metadata and cannot reappear after Stop', async t => {
  const page = await pageFor(t);
  await page.evaluate(() => {
    window.update(JSON.stringify({f0:JSON.stringify({src:'/piraiders/media/delayed.png',mode:'auto',reload:'loading'}),comment:'fixture',epochID:123}));
    window.pending = window.play();
  });
  await page.waitForTimeout(100);
  black(await capture(page));
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  const malformed = await page.evaluate(() => window.update('malformed'));
  assert.equal(malformed.ok, false);
  await page.evaluate(() => window.pending);
  near(rgb(await capture(page)), [240,20,20]);
  assert.equal(await page.locator('.piraiders-mode').innerText(), 'AUTO');
  assert.equal(await page.locator('.piraiders-spinner').count(), 1);
  await page.evaluate(() => {
    window.stop();
    window.update(JSON.stringify({f0:JSON.stringify({src:'/piraiders/media/delayed.png',mode:'manual',reload:'failed'})}));
    window.pending = window.play(); window.stop();
  });
  await page.waitForTimeout(750);
  black(await capture(page));
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
});
test('original SPX native HTML runs real Update/Play/Continue/Stop with anime in Chromium', async t => {
  const page = await context.newPage(); t.after(() => page.close());
  await page.goto(fixture.origin + '/templates/softpix/html/Template_Pack_1.4.0/INFO_LEFT.html');
  await page.evaluate(() => { window.update(JSON.stringify({f0:'Browser fixture headline',f1:'none',f99:'./themes/Default.css'})); window.play(); window.next(); });
  await page.waitForTimeout(1400);
  assert.equal(await page.locator('#leftText').textContent(), 'Browser fixture headline');
  assert.equal(await page.locator('#gfx').evaluate(el => Number(getComputedStyle(el).opacity)), 1);
  await page.screenshot({path:path.join(artifacts,'spx-native-info-left.png')});
  await page.evaluate(() => window.stop()); await page.waitForTimeout(850);
  assert.equal(await page.locator('#gfx').evaluate(el => Number(getComputedStyle(el).opacity)), 0);
});
test('OGraf loads, updates actual iframe text and theme, rejects malformed data, plays, stops and disposes', async t => {
  const page = await context.newPage(); t.after(() => page.close());
  await page.goto(fixture.origin + '/harness');
  await page.evaluate(async () => {
    const { default:Graphic } = await import('/templates/softpix/ograf/Template_Pack_1.4.0/INFO_LEFT.mjs');
    customElements.define('upstream-info-left', Graphic);
    window.graphic = new Graphic(); document.body.append(window.graphic);
    window.graphic.style.cssText = 'display:block;width:1920px;height:1080px';
    window.loadResult = await window.graphic.load({renderType:'realtime',data:{f0:'OGraf browser fixture',f1:'none',f99:'resources/Info_left/themes/Default.css'}});
  });
  const frame = page.frameLocator('iframe');
  await frame.locator('#f0').filter({hasText:'OGraf browser fixture'}).waitFor({state:'attached'});
  assert.equal(await page.evaluate(() => window.loadResult.statusCode), 200);
  await page.evaluate(() => window.graphic.playAction({}));
  await page.waitForTimeout(1400);
  assert.equal(await frame.locator('#gfx').evaluate(el => Number(getComputedStyle(el).opacity)), 1);
  await page.screenshot({path:path.join(artifacts,'spx-ograf-info-left.png')});
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.evaluate(async () => {
    const data = {f0:'Updated fixture',f1:'none',f99:'resources/Info_left/themes/Default.css'};
    await window.graphic.updateAction({data});
    if (data.f99 !== 'resources/Info_left/themes/Default.css') throw new Error('caller data mutated');
  });
  assert.equal(await frame.locator('#f0').textContent(), 'Updated fixture');
  assert.equal(await frame.locator('#leftText').textContent(), 'Updated fixture');
  assert.equal(await frame.locator('#DynamicTheme').evaluate(el => el.href), fixture.origin + '/templates/softpix/ograf/Template_Pack_1.4.0/resources/Info_left/themes/Default.css');
  assert.ok(!errors.some(message => message.includes('Placeholder #data missing')));
  for (const data of [null,[], 'invalid']) {
    assert.equal(await page.evaluate(async data => {
      try { await window.graphic.updateAction({data}); return 'unexpected success'; } catch (error) { return error.name; }
    }, data), 'TypeError');
    assert.equal(await frame.locator('#leftText').textContent(), 'Updated fixture');
  }
  await page.waitForTimeout(1400);
  await page.screenshot({path:path.join(artifacts,'spx-ograf-info-left.png')});
  await page.evaluate(() => window.graphic.stopAction({}));
  await page.waitForTimeout(850);
  assert.equal(await frame.locator('#gfx').evaluate(el => Number(getComputedStyle(el).opacity)), 0);
  assert.equal(await page.evaluate(async () => (await window.graphic.getStatus({})).statusCode), 200);
  await page.evaluate(() => window.graphic.dispose({}));
  assert.equal(await page.locator('iframe').count(), 0);
});
