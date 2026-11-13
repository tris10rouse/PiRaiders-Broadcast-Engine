'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRossTalkConfig, canonicalAddress, parseRossTalkLine, RossTalkFramer } = require('../scripts/lib/rosstalk-protocol.cjs');

const valid = { allowedSenders: ['127.0.0.1'], commandMap: { 0: 'stop', 1: 'launch', 2: 'next', 3: 'previous', 4: 'toggle-auto', 5: 'reload', 65535: 'manual' } };

test('canonical sender addresses unify IPv6 spellings and both IPv4-mapped forms', () => {
  for (const address of ['127.0.0.1', '::ffff:127.0.0.1', '::FFFF:7f00:0001', '0:0:0:0:0:ffff:7f00:1']) assert.equal(canonicalAddress(address), '127.0.0.1');
  assert.equal(canonicalAddress('2001:0DB8:0000:0000:0000:0000:0000:0001'), '2001:db8::1');
  assert.equal(canonicalAddress('0:0:0:0:0:0:0:1'), '::1');
  assert.equal(canonicalAddress('::ffff:0:0'), '0.0.0.0');
  assert.equal(canonicalAddress('::ffff:ffff:ffff'), '255.255.255.255');
  assert.notEqual(canonicalAddress('::127.0.0.1'), '127.0.0.1');
  for (const address of ['localhost', '*', '127.0.0.1/8', '127.00.0.1', 'fe80::1%eth0', '[::1]', '::ffff:999.0.0.1', '', null, 123]) assert.throws(() => canonicalAddress(address));
});
test('normalization freezes copied mappings/allowlist and uses bounded safe defaults', () => {
  const raw = { ...valid, commandMap: { ...valid.commandMap }, allowedSenders: ['127.0.0.1', '::ffff:7f00:1'] };
  const config = normalizeRossTalkConfig(raw);
  assert.equal(config.host, '127.0.0.1'); assert.equal(config.port, 7788);
  assert.equal(config.acknowledgements, false); assert.equal(config.maxQueue, 32);
  assert.equal(config.maxConnections, 16); assert.equal(config.handlerTimeoutMs, 2000);
  assert.equal(config.maxFrameBytes, 128); assert.equal(config.idleTimeoutMs, 10000);
  assert.deepEqual(config.allowedSenders, ['127.0.0.1']);
  raw.commandMap[1] = 'stop'; raw.allowedSenders.push('192.0.2.1');
  assert.equal(config.commandMap[1], 'launch'); assert.equal(config.allowedSenders.length, 1);
  assert.ok(Object.isFrozen(config)); assert.ok(Object.isFrozen(config.commandMap)); assert.ok(Object.isFrozen(config.allowedSenders));
  assert.throws(() => { config.commandMap[1] = 'next'; }, TypeError);
});
test('normalization fails closed on missing/unknown config, unsafe addresses and invalid maps', () => {
  for (const raw of [undefined, null, [], {}, { ...valid, typo: true }, { ...valid, host: 'localhost' },
    { ...valid, allowedSenders: [] }, { ...valid, allowedSenders: Array(1) }, { ...valid, allowedSenders: [undefined] },
    { ...valid, allowedSenders: ['*'] }, { ...valid, allowedSenders: ['192.0.2.0/24'] },
    { ...valid, commandMap: {} }, { ...valid, commandMap: { '01': 'next' } }, { ...valid, commandMap: { 65536: 'next' } },
    { ...valid, commandMap: { 1: 'shell' } }, { ...valid, acknowledgements: 'true' }]) assert.throws(() => normalizeRossTalkConfig(raw));
  assert.throws(() => normalizeRossTalkConfig({ ...valid, commandMap: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [i, 'next'])) }));
  assert.throws(() => normalizeRossTalkConfig(Object.assign(Object.create({ host: '0.0.0.0' }), valid)));
  assert.throws(() => normalizeRossTalkConfig({ ...valid, commandMap: Object.create({ 1: 'next' }) }));
});
test('all configured numeric limits reject out-of-bound or noninteger values', () => {
  const limits = { port: [1, 65535], maxConnections: [1, 64], maxQueue: [1, 256], maxFrameBytes: [16, 1024], idleTimeoutMs: [100, 60000], handlerTimeoutMs: [50, 10000] };
  for (const [name, [low, high]] of Object.entries(limits)) {
    for (const value of [low, high]) assert.equal(normalizeRossTalkConfig({ ...valid, [name]: value })[name], value);
    for (const value of [low - 1, high + 1, NaN, Infinity, 1.5, '10', null]) assert.throws(() => normalizeRossTalkConfig({ ...valid, [name]: value }));
  }
});
test('ephemeral binds require explicit bench permission and a loopback host', () => {
  assert.throws(() => normalizeRossTalkConfig({ ...valid, port: 0 }));
  assert.equal(normalizeRossTalkConfig({ ...valid, port: 0 }, { allowEphemeral: true }).port, 0);
  assert.equal(normalizeRossTalkConfig({ ...valid, host: '::1', port: 0 }, { allowEphemeral: true }).port, 0);
  assert.throws(() => normalizeRossTalkConfig({ ...valid, host: '0.0.0.0', port: 0 }, { allowEphemeral: true }));
});
test('supported GPI lines resolve explicit actions without executing anything', () => {
  const config = normalizeRossTalkConfig(valid);
  assert.deepEqual(parseRossTalkLine('GPI 1', config.commandMap), { ok: true, command: { gpi: 1, action: 'launch' } });
  assert.deepEqual(parseRossTalkLine('GPI 00002', config.commandMap), { ok: true, command: { gpi: 2, action: 'next' } });
  assert.deepEqual(parseRossTalkLine('GPI 0', config.commandMap), { ok: true, command: { gpi: 0, action: 'stop' } });
  assert.deepEqual(parseRossTalkLine('GPI 65535', config.commandMap), { ok: true, command: { gpi: 65535, action: 'manual' } });
  assert.deepEqual(parseRossTalkLine('GPI 99', config.commandMap), { ok: false, code: 'UNMAPPED_GPI' });
  assert.deepEqual(parseRossTalkLine('GPI 1', Object.create({ 1: 'next' })), { ok: false, code: 'UNMAPPED_GPI' });
  for (const line of ['gpi 1', 'GPI  1', 'GPI\t1', ' GPI 1', 'GPI 1 ', 'GPI -1', 'GPI 65536', 'GPI 000001', 'GPI 1\n', 'GPI 1\r', 'GPI 1\0', 'GPI １', '', null]) {
    assert.deepEqual(parseRossTalkLine(line, config.commandMap), { ok: false, code: 'MALFORMED_COMMAND' });
  }
});
test('CRLF framing is independent of fragmentation/coalescing and keeps no completed bytes', () => {
  const data = Buffer.from('GPI 1\r\nGPI 2\r\n\r\nGPI 65535\r\n');
  for (let split = 0; split <= data.length; split++) {
    const framer = new RossTalkFramer();
    assert.deepEqual([...framer.push(data.subarray(0, split)), ...framer.push(data.subarray(split))], ['GPI 1', 'GPI 2', '', 'GPI 65535']);
    assert.equal(framer.bufferedBytes, 0); assert.equal(framer.failed, false);
  }
  const singleBytes = new RossTalkFramer();
  assert.deepEqual([...data].flatMap(byte => singleBytes.push(Buffer.from([byte]))), ['GPI 1', 'GPI 2', '', 'GPI 65535']);
});
test('unterminated payload stays bounded and the exact payload limit excludes CRLF', () => {
  const framer = new RossTalkFramer({ maxFrameBytes: 16 });
  assert.deepEqual(framer.push(Buffer.from('x'.repeat(16) + '\r')), []);
  assert.equal(framer.bufferedBytes, 17);
  assert.deepEqual(framer.push(Buffer.from('\n')), ['x'.repeat(16)]);
  assert.equal(framer.bufferedBytes, 0);
  assert.throws(() => framer.push(Buffer.from('x'.repeat(17))), { code: 'FRAME_TOO_LARGE' });
  assert.equal(framer.bufferedBytes, 0); assert.equal(framer.failed, true);
  assert.throws(() => framer.push(Buffer.from('GPI 1\r\n')), { code: 'FRAME_TOO_LARGE' });
});
test('bare LF, bad CR continuations and binary/control input permanently reject framing', () => {
  for (const input of ['GPI 1\n', 'GPI 1\rX', 'GPI\t1', 'GPI 1\0', 'GPI 1\x7f', 'GPI \x80']) {
    const framer = new RossTalkFramer();
    assert.throws(() => framer.push(Buffer.from(input, 'latin1')), { code: 'MALFORMED_FRAME' });
    assert.equal(framer.bufferedBytes, 0); assert.equal(framer.failed, true);
    assert.throws(() => framer.push(Buffer.alloc(0)), { code: 'MALFORMED_FRAME' });
  }
  const splitCR = new RossTalkFramer(); splitCR.push(Buffer.from('GPI 1\r'));
  assert.throws(() => splitCR.push(Buffer.from('\r\n')), { code: 'MALFORMED_FRAME' });
  assert.throws(() => new RossTalkFramer().push('GPI 1\r\n'), { code: 'MALFORMED_FRAME' });
  assert.throws(() => new RossTalkFramer({ maxFrameBytes: 15 }));
});
