'use strict';
const path = require('node:path');
const { spawnSupervisedProcess } = require('../../scripts/lib/windows-job-process.cjs');
const host = spawnSupervisedProcess(process.execPath,
  [path.join(__dirname, 'job-service.cjs'), 'root', process.argv[2], 'hold'], {});
host.once('error', () => process.exit(3));
host.once('spawn', () => process.send({ hostPid: host.pid }));
setTimeout(() => process.exit(2), 30000);
