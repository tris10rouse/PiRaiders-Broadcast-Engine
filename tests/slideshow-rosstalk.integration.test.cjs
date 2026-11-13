'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { SlideshowController } = require('../scripts/lib/slideshow-controller.cjs');
const { RossTalkBridge } = require('../scripts/lib/rosstalk-bridge.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'integration condition timed out'); await delay(5); }
}
async function fixture(t, renderer, { bridgeTimeout = 2000, renderTimeout = 2000 } = {}) {
  const controller = new SlideshowController({ deck: { id: 'off-air-fixture', slides: [
    { id: 'a', src: 'a.png' }, { id: 'b', src: 'b.jpg' }, { id: 'c', src: 'c.png' }
  ] }, mode: 'manual', renderer, handlerTimeoutMs: renderTimeout });
  const bridge = new RossTalkBridge({ host: '127.0.0.1', port: 0, allowedSenders: ['127.0.0.1'],
    commandMap: { 1: 'launch', 2: 'next', 3: 'previous', 8: 'stop' }, acknowledgements: true,
    handlerTimeoutMs: bridgeTimeout }, { allowEphemeral: true, handleCommand: async command => {
    const result = await controller.dispatch(command);
    // Controller failures are result objects: a boundary adapter must reject
    // them so the transport cannot acknowledge a failed presentation operation.
    if (!result.ok) throw Error('Presentation command failed');
  } });
  t.after(async () => { await bridge.close(); await controller.close(); });
  await bridge.start();
  const socket = net.createConnection({ host: '127.0.0.1', port: bridge.address().port });
  const peer = { text: '', closed: false };
  socket.on('data', data => { peer.text += data.toString('ascii'); });
  socket.on('error', () => {}); socket.on('close', () => { peer.closed = true; });
  t.after(() => socket.destroy());
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  return { controller, bridge, socket, peer };
}

test('real TCP command burst drives controller FIFO; late Next cannot undo Stop', async t => {
  const frames = [], black = [];
  const { controller, bridge, socket, peer } = await fixture(t, {
    show: async frame => frames.push(frame.index), black: async frame => black.push(frame)
  });
  socket.end('GPI 1\r\nGPI 2\r\nGPI 2\r\nGPI 3\r\nGPI 8\r\nGPI 2\r\n');
  await until(() => peer.closed);
  assert.deepEqual(frames, [0, 1, 2, 1]); assert.equal(black.length, 1);
  assert.equal(controller.snapshot().state, 'stopped'); assert.equal(controller.snapshot().index, null);
  assert.equal(bridge.snapshot().completed, 5); assert.equal(bridge.snapshot().failed, 1);
  assert.equal(peer.text, 'OK 1 launch\r\nOK 2 next\r\nOK 3 next\r\nOK 4 previous\r\nOK 5 stop\r\nERR 6 HANDLER_FAILED\r\n');
});

test('transport timeout propagates cancellation to a stuck controller and both fence late completion', async t => {
  let release; const hung = new Promise(resolve => { release = resolve; }); const calls = [];
  const { controller, bridge, socket } = await fixture(t, {
    show: frame => { calls.push(frame); return hung; }, black: async () => assert.fail('must not dispatch black around timeout')
  }, { bridgeTimeout: 60, renderTimeout: 120 });
  socket.write('GPI 1\r\nGPI 2\r\n');
  await until(() => bridge.snapshot().faulted && controller.snapshot().faulted);
  assert.equal(calls.length, 1); assert.equal(calls[0].signal.aborted, true);
  assert.equal(controller.snapshot().index, null); assert.equal(bridge.snapshot().completed, 0);
  release(); await delay(20);
  assert.equal(controller.snapshot().state, 'faulted'); assert.equal(controller.snapshot().index, null);
  assert.equal(calls.length, 1); assert.equal(bridge.snapshot().completed, 0);
});
