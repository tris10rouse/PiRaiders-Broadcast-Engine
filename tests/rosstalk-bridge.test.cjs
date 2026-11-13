'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { RossTalkBridge } = require('../scripts/lib/rosstalk-bridge.cjs');

const config = { host: '127.0.0.1', port: 0, allowedSenders: ['127.0.0.1'],
  commandMap: { 1: 'launch', 2: 'next', 3: 'previous', 4: 'stop' }, idleTimeoutMs: 1000 };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message = 'condition did not become true') {
  const deadline = Date.now() + 2000;
  while (!predicate()) { if (Date.now() >= deadline) assert.fail(message); await delay(5); }
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function start(t, overrides = {}, handleCommand = async () => {}) {
  const bridge = new RossTalkBridge({ ...config, ...overrides }, { handleCommand, allowEphemeral: true });
  const results = []; bridge.on('result', result => results.push(result));
  t.after(() => bridge.close());
  await bridge.start(); return { bridge, results };
}
async function connect(t, bridge) {
  const socket = new net.Socket();
  const peer = { socket, text: '', closed: false, errors: [] };
  socket.on('data', data => { peer.text += data.toString('ascii'); });
  socket.on('error', error => peer.errors.push(error.code));
  socket.on('close', () => { peer.closed = true; });
  t.after(() => socket.destroy());
  await new Promise((resolve, reject) => {
    socket.once('error', reject); socket.connect(bridge.address().port, '127.0.0.1', () => { socket.off('error', reject); resolve(); });
  });
  return peer;
}

test('real TCP fragmentation, coalescing and repeated commands share global FIFO', async t => {
  const gate = deferred(), calls = [];
  const { bridge } = await start(t, {}, async command => { calls.push(command); if (command.sequence === 1) await gate.promise; });
  const first = await connect(t, bridge), second = await connect(t, bridge);
  first.socket.write('GPI '); await delay(15); assert.equal(calls.length, 0);
  first.socket.write('1\r'); await delay(15); assert.equal(calls.length, 0);
  first.socket.write('\nGPI 2\r\nGPI 2\r\n');
  await until(() => bridge.snapshot().accepted === 3);
  second.socket.write('GPI 3\r\n'); await until(() => bridge.snapshot().accepted === 4);
  assert.deepEqual(calls.map(call => call.action), ['launch']);
  gate.resolve(); await until(() => bridge.snapshot().completed === 4);
  assert.deepEqual(calls.map(call => [call.sequence, call.action]), [[1, 'launch'], [2, 'next'], [3, 'next'], [4, 'previous']]);
  assert.ok(calls.every(Object.isFrozen)); assert.equal(first.text + second.text, '');
});

test('diagnostic replies are opt-in and report completion rather than receipt', async t => {
  const gate = deferred();
  const { bridge } = await start(t, { acknowledgements: true }, () => gate.promise);
  const peer = await connect(t, bridge); peer.socket.write('GPI 2\r\n');
  await until(() => bridge.snapshot().accepted === 1); await delay(20); assert.equal(peer.text, '');
  gate.resolve(); await until(() => peer.text.includes('OK 1 next\r\n'));
  peer.socket.write('GPI 99\r\n'); await until(() => peer.closed);
  assert.equal(peer.text, 'OK 1 next\r\nERR 2 UNMAPPED_GPI\r\n');
});

test('source allowlist denies the actual loopback peer and the connection cap preserves existing peers', async t => {
  const denied = await start(t, { allowedSenders: ['192.0.2.1'] });
  const unwanted = await connect(t, denied.bridge); await until(() => unwanted.closed);
  assert.equal(denied.results[0].code, 'SOURCE_DENIED'); assert.equal(denied.bridge.snapshot().accepted, 0);
  const capped = await start(t, { maxConnections: 1, allowedSenders: ['::ffff:7f00:1'] });
  const first = await connect(t, capped.bridge); await until(() => capped.bridge.snapshot().connections === 1);
  const extra = await connect(t, capped.bridge); await until(() => extra.closed);
  assert.ok(capped.results.some(result => result.code === 'CONNECTION_LIMIT'));
  first.socket.write('GPI 1\r\n'); await until(() => capped.bridge.snapshot().completed === 1);
  assert.equal(first.closed, false);
});

test('bounded queue rejects BUSY and retains already accepted commands after disconnect', async t => {
  const gate = deferred(), calls = [];
  const { bridge, results } = await start(t, { maxQueue: 1, acknowledgements: true }, async command => {
    calls.push(command.action); if (command.sequence === 1) await gate.promise;
  });
  const peer = await connect(t, bridge); peer.socket.write('GPI 1\r\nGPI 2\r\nGPI 3\r\n');
  await until(() => results.some(result => result.code === 'BUSY'));
  assert.equal(bridge.snapshot().accepted, 2); assert.equal(bridge.snapshot().queued, 1);
  await until(() => peer.text.includes('ERR 3 BUSY\r\n')); peer.socket.destroy();
  await until(() => peer.closed); gate.resolve(); await until(() => bridge.snapshot().completed === 2);
  assert.deepEqual(calls, ['launch', 'next']);
});

test('EOF with an incomplete frame is rejected without dispatch', async t => {
  const { bridge, results } = await start(t, { acknowledgements: true });
  const peer = await connect(t, bridge); peer.socket.end('GPI 1\r');
  await until(() => peer.closed);
  assert.equal(peer.text, 'ERR 0 TRUNCATED_FRAME\r\n');
  assert.equal(results[0].code, 'TRUNCATED_FRAME'); assert.equal(bridge.snapshot().accepted, 0);
});

test('malformed and overlong real TCP frames close their peers and leave listener usable', async t => {
  const { bridge, results } = await start(t, { maxFrameBytes: 16, acknowledgements: true });
  for (const [frame, code] of [['GPI 1\n', 'MALFORMED_FRAME'], ['x'.repeat(17), 'FRAME_TOO_LARGE'], ['gpi 1\r\n', 'MALFORMED_COMMAND']]) {
    const peer = await connect(t, bridge); peer.socket.write(frame); await until(() => peer.closed);
    assert.ok(peer.text.includes(code)); assert.ok(results.some(result => result.code === code));
  }
  const good = await connect(t, bridge); good.socket.write('GPI 1\r\n');
  await until(() => bridge.snapshot().completed === 1); assert.equal(bridge.snapshot().accepted, 1);
});

test('idle peers are evicted without affecting the listener', async t => {
  const { bridge, results } = await start(t, { idleTimeoutMs: 100 });
  const peer = await connect(t, bridge); await until(() => peer.closed);
  assert.ok(results.some(result => result.code === 'IDLE_TIMEOUT'));
  assert.equal(bridge.snapshot().state, 'listening'); assert.equal(bridge.snapshot().accepted, 0);
});

test('handler timeout aborts, closes terminally, cancels queue and never dispatches a late successor', async t => {
  const late = deferred(), calls = [], faults = [];
  const { bridge } = await start(t, { handlerTimeoutMs: 60 }, command => { calls.push(command); return late.promise; });
  bridge.on('fault', fault => faults.push(fault));
  const peer = await connect(t, bridge); peer.socket.write('GPI 1\r\nGPI 2\r\n');
  await until(() => bridge.snapshot().state === 'faulted');
  assert.equal(calls.length, 1); assert.equal(calls[0].signal.aborted, true);
  assert.equal(bridge.snapshot().timedOut, 1); assert.equal(bridge.snapshot().cancelled, 1);
  assert.deepEqual(faults, [{ code: 'HANDLER_TIMEOUT' }]);
  late.resolve(); await delay(25);
  assert.equal(calls.length, 1); assert.equal(bridge.snapshot().completed, 0);
  await assert.rejects(bridge.start(), { code: 'CLOSED' });
});

test('handler failure reports a fixed diagnostic and dispatches the next accepted command', async t => {
  const calls = [];
  const { bridge, results } = await start(t, { acknowledgements: true }, command => {
    calls.push(command.action);
    if (command.sequence === 1) throw Error('private filesystem and content details');
  });
  const peer = await connect(t, bridge); peer.socket.write('GPI 1\r\nGPI 2\r\n');
  await until(() => bridge.snapshot().failed === 1 && bridge.snapshot().completed === 1);
  await until(() => peer.text.includes('OK 2 next\r\n'));
  assert.equal(peer.text, 'ERR 1 HANDLER_FAILED\r\nOK 2 next\r\n');
  assert.deepEqual(calls, ['launch', 'next']); assert.equal(bridge.snapshot().faulted, false);
  assert.ok(!JSON.stringify(results).includes('private filesystem'));
});

test('explicit close finishes while an uncooperative callback is stuck and aborts it', async t => {
  const calls = [];
  const { bridge } = await start(t, {}, command => { calls.push(command); return new Promise(() => {}); });
  const peer = await connect(t, bridge); peer.socket.write('GPI 1\r\nGPI 2\r\n');
  await until(() => calls.length === 1 && bridge.snapshot().accepted === 2);
  await bridge.close(); await until(() => peer.closed);
  assert.equal(calls[0].signal.aborted, true); assert.equal(bridge.snapshot().cancelled, 2);
  assert.equal(bridge.snapshot().state, 'closed'); assert.equal(bridge.address(), null);
});

test('port collision rejects startup safely and can be closed', async t => {
  const first = await start(t);
  const bridge = new RossTalkBridge({ ...config, port: first.bridge.address().port }, { handleCommand: async () => {} });
  t.after(() => bridge.close());
  await assert.rejects(bridge.start(), { code: 'LISTEN_FAILED' });
  assert.equal(bridge.snapshot().state, 'failed'); await bridge.close();
  assert.equal(first.bridge.snapshot().state, 'listening');
});

test('immediate close during startup rejects start and leaves no listener', async t => {
  const bridge = new RossTalkBridge(config, { handleCommand: async () => {}, allowEphemeral: true });
  t.after(async () => { if (bridge.server?.listening) await new Promise(resolve => bridge.server.close(resolve)); });
  const starting = bridge.start(); const rejected = assert.rejects(starting, { code: 'CLOSED' });
  await bridge.close(); await rejected; await delay(30);
  assert.equal(bridge.address(), null); assert.equal(bridge.server.listening, false);
  assert.equal(bridge.snapshot().state, 'closed');
});


test('construction never supplies an implicit playback handler', () => {
  assert.throws(() => new RossTalkBridge(config, { allowEphemeral: true }), /explicit playback/);
});

test('a coalesced command flood stays bounded and accepted work survives write EOF', async t => {
  const gate = deferred(), calls = [];
  const { bridge, results } = await start(t, { maxQueue: 2 }, async command => {
    calls.push(command.action); if (command.sequence === 1) await gate.promise;
  });
  const peer = await connect(t, bridge);
  peer.socket.end('GPI 2\r\n'.repeat(3000));
  await until(() => results.some(result => result.code === 'BUSY'));
  assert.equal(bridge.snapshot().accepted, 3); assert.equal(bridge.snapshot().queued, 2);
  gate.resolve(); await until(() => bridge.snapshot().completed === 3);
  assert.deepEqual(calls, ['next', 'next', 'next']);
  await until(() => peer.closed);
});
