#!/usr/bin/env node
'use strict';
// Off-air, loopback-only transport bench. No graphics or hardware adapter.
const net = require('node:net');
const assert = require('node:assert/strict');
const { RossTalkBridge } = require('./lib/rosstalk-bridge.cjs');
async function main() {
  const commands = [];
  const bridge = new RossTalkBridge({ host: '127.0.0.1', port: 0, allowedSenders: ['127.0.0.1'],
    commandMap: { 1: 'launch', 2: 'next', 8: 'stop' }, acknowledgements: true }, {
    allowEphemeral: true,
    handleCommand: async command => { commands.push({ sequence: command.sequence, action: command.action }); }
  });
  let socket;
  try {
    const address = await bridge.start();
    await new Promise((resolve, reject) => {
      let response = '';
      socket = net.createConnection({ host: '127.0.0.1', port: address.port });
      socket.setTimeout(5000, () => socket.destroy(Error('Loopback bench timed out')));
      socket.on('error', reject);
      socket.on('data', data => { response += data.toString('ascii'); });
      socket.on('connect', () => {
        socket.write('GPI 1\r');
        setImmediate(() => socket.end('\nGPI 2\r\nGPI 2\r\nGPI 8\r\n'));
      });
      socket.on('end', () => {
        try {
          assert.equal(response, 'OK 1 launch\r\nOK 2 next\r\nOK 3 next\r\nOK 4 stop\r\n'); resolve();
        } catch (error) { reject(error); }
      });
    });
    assert.deepEqual(commands.map(command => command.action), ['launch', 'next', 'next', 'stop']);
    assert.equal(bridge.snapshot().completed, 4);
    console.log(JSON.stringify({ result: 'PASS', simulationOnly: true,
      scope: 'loopback TCP framing, ordered dispatch and PiRaiders diagnostic replies', commands,
      graphicsOutput: 'not exercised', daktronics: 'not exercised', ndi: 'not exercised' }, null, 2));
  } finally { socket?.destroy(); await bridge.close(); }
}
main().catch(() => { console.error('RossTalk loopback transport bench FAILED'); process.exitCode = 1; });
