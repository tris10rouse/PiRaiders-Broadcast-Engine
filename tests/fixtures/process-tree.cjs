'use strict';
const { fork } = require('node:child_process');

// Safety net for interrupted tests: neither fixture survives indefinitely.
setTimeout(() => process.exit(2), 30000);
if (process.argv[2] === '--descendant') {
  process.send({ descendantPid: process.pid });
} else {
  const descendant = fork(__filename, ['--descendant'], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });
  descendant.once('error', () => process.exit(3));
  descendant.once('message', message => {
    process.send({ parentPid: process.pid, descendantPid: message.descendantPid });
  });
}
