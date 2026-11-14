'use strict';
// Executable, production-independent compatibility tests of unmodified SPX
// HTML template functions, EBU OGraf class, and AMCP command construction.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const asset = p => path.join(root, 'ASSETS/templates/softpix', p);

test('original HTML INFO_LEFT fixture defines fields and executes animation lifecycle', () => {
  const html = fs.readFileSync(asset('html/Template_Pack_1.4.0/INFO_LEFT.html'), 'utf8');
  const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(Boolean);
  const elements = Object.fromEntries(['f0','f1','f99','leftText','leftInfo','icon','DynamicTheme'].map(id => [id, { innerText: '', innerHTML: '', style: {}, href: '' }]));
  const animations = [];
  const ctx = {
    window: {}, console: { clear() {} },
    e: id => elements[id],
    htmlDecode: x => x,
    anime: { timeline: options => {
      const animation = { options, steps: [], add(step) { this.steps.push(step); return this; } };
      animations.push(animation); return animation;
    }},
    lottie: { loadAnimation: () => ({ addEventListener() {}, goToAndPlay() {} }) }
  };
  vm.createContext(ctx);
  for (const script of inline) vm.runInContext(script, ctx, { timeout: 2000 });
  const definition = ctx.window.SPXGCTemplateDefinition;
  assert.equal(definition.playserver, 'OVERLAY');
  assert.equal(definition.playchannel, '1');
  assert.equal(definition.playlayer, '4');
  assert.deepEqual(Array.from(definition.DataFields.filter(x => x.field).map(x => x.field)), ['f0','f1','f99']);
  elements.f0.innerText = 'Fixture headline';
  elements.f1.innerText = 'none';
  elements.f99.innerText = './themes/Default.css';
  vm.runInContext('runTemplateUpdate()', ctx, { timeout: 2000 });
  assert.equal(elements.leftText.innerHTML, 'Fixture headline');
  assert.equal(elements.icon.style.display, 'none');
  assert.equal(elements.DynamicTheme.href, './themes/Default.css');
  assert.ok(animations.length >= 1, 'HTML template actually created an in-animation');
  vm.runInContext('runAnimationOUT()', ctx, { timeout: 2000 });
  assert.ok(animations.length >= 2, 'HTML template actually created an out-animation');
});

test('original OGraf INFO_LEFT fixture loads, updates, plays, stops and disposes', async () => {
  const base = asset('ograf/Template_Pack_1.4.0/');
  const manifest = JSON.parse(fs.readFileSync(path.join(base,'INFO_LEFT.ograf.json'), 'utf8'));
  assert.equal(manifest.id, 'info-left-graphic');
  assert.equal(manifest.supportsRealTime, true);
  assert.equal(manifest.main, 'INFO_LEFT.mjs');
  assert.equal(manifest.schema.properties.f0.default, 'Headquarters');
  const actions = [];
  const fields = Object.fromEntries(['f0','f1','f99'].map(id => [id, { innerText: '' }]));
  const previousDocument = global.document;
  const previousElement = global.HTMLElement;
  class HTMLElementStub {
    appendChild(child) { this.child = child; }
    set innerHTML(value) { this._innerHTML = value; this.child = null; }
  }
  global.HTMLElement = HTMLElementStub;
  global.document = { createElement: tag => {
    assert.equal(tag, 'iframe');
    return { width: '', height: '', src: '', contentWindow: {
      document: { getElementById: id => fields[id] },
      update: params => actions.push(['update',params]),
      play: () => actions.push(['play']),
      stop: () => actions.push(['stop'])
    }};
  }};
  try {
    // Import the actual upstream EBU OGraf class, not a mock implementation.
    const { default: Graphic } = await import(pathToFileURL(path.join(base,manifest.main)).href);
    const graphic = new Graphic();
    await assert.rejects(graphic.load({ renderType: 'offline', data: {} }), /Only realtime/);
    const data = { f0:'Fixture', f1:'resources/Info_left/lottie/live-default.json', f99:'resources/Info_left/themes/Default.css' };
    assert.equal((await graphic.load({renderType:'realtime',data})).statusCode, 200);
    assert.ok(graphic.child, 'OGraf mounted an iframe');
    graphic.child.onload();
    assert.equal(fields.f0.innerText, 'Fixture');
    assert.equal(fields.f1.innerText, 'lottie/live-default.json');
    assert.equal(fields.f99.innerText, 'themes/Default.css');
    await graphic.updateAction({ data });
    assert.deepEqual(actions[0], ['update', { f0: 'Fixture', f1: 'lottie/live-default.json', f99: 'themes/Default.css' }]);
    assert.equal(data.f99, 'resources/Info_left/themes/Default.css', 'adapter must not mutate the caller data');
    await assert.rejects(graphic.updateAction({ data: null }), /data must be an object/);
    assert.equal(actions.length, 1, 'malformed update must not reach the graphic');
    await graphic.playAction({ data });
    await graphic.stopAction({ data });
    assert.deepEqual(actions.map(x=>x[0]), ['update','play','stop']);
    assert.equal((await graphic.getStatus({})).statusCode, 200);
    await graphic.dispose({});
    assert.equal(graphic.child, null);
  } finally {
    global.document = previousDocument;
    global.HTMLElement = previousElement;
  }
});

test('original SPX AMCP controller issues ADD, UPDATE, NEXT, STOP on the configured layer', () => {
  const source = fs.readFileSync(path.join(root,'utils/playout_casparCG.js'),'utf8');
  const commands = [];
  const logger = Object.fromEntries(['verbose','debug','warn','error','info'].map(k=>[k,()=>{}]));
  const ctx = {
    module: {exports:{}}, console,
    require: name => {
      if (name === './logger.js') return logger;
      if (name === './spx_server_functions.js') return { getTemplateSourcePath: () => 'http://localhost' };
      if (name === 'moment') return {};
      return require(name);
    },
    config: { general: {port:5656}, casparcg: {servers:[{name:'OVERLAY',disabled:false}]} },
    CCGSockets: [{spxname:'OVERLAY',write: command=>commands.push(command)}]
  };
  ctx.global = ctx;
  vm.createContext(ctx);
  vm.runInContext(source,ctx,{timeout:2000});
  const controller = ctx.module.exports;
  const fixture = {
    playserver:'OVERLAY',playchannel:'1',playlayer:'4',
    relpathCCG:'softpix/html/Template_Pack_1.4.0/INFO_LEFT',
    dataformat:'json',fields:[{field:'f0',value:'Fixture headline'}]
  };
  for(const command of ['ADD','UPDATE','NEXT','STOP']) {
    controller.playoutController({...fixture,command});
  }
  assert.equal(commands.length,4);
  assert.match(commands[0],/^CG 1-4 ADD 1 /);
  assert.match(commands[0],/INFO_LEFT.html/);
  assert.match(commands[0],/Fixture headline/);
  assert.match(commands[1],/^CG 1-4 UPDATE 1 /);
  assert.equal(commands[2],'CG 1-4 NEXT 0\r\n');
  assert.equal(commands[3],'CG 1-4 STOP 1\r\n');
  ctx.config.casparcg.servers[0].disabled=true;
  controller.playoutController({...fixture,command:'ADD'});
  assert.equal(commands.length,4,'disabled server must not receive playout');
});
