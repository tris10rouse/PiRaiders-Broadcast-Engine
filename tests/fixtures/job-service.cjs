'use strict';
const fs = require('node:fs');
const { fork } = require('node:child_process');
// Harmless test-owned processes expire even when the test runner crashes.
setTimeout(() => process.exit(2), 30000);
if (process.argv[2] === 'descendant') {
  process.send({ pid: process.pid });
} else {
  const descendant = fork(__filename, ['descendant'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  descendant.once('error', () => process.exit(3));
  descendant.once('message', message => {
    fs.writeFileSync(process.argv[3], JSON.stringify({ rootPid: process.pid, descendantPid: message.pid,
      cwd: process.cwd(), args: process.argv.slice(5) }));
    if (process.argv[4] === 'exit17') setTimeout(() => process.exit(17), 150);
  });
}
