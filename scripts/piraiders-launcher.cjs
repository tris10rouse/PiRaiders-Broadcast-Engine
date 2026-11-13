#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ProcessSupervisor } = require('./lib/process-supervisor.cjs');
function loadSettings(file) {
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(settings.services) || !settings.services.length) throw Error('services array required');
  const root = path.resolve(path.dirname(file), '..');
  return settings.services.map(service => {
    if (!service || !['spx', 'casparcg'].includes(service.name)) throw Error('Unknown service');
    if (typeof service.executable !== 'string' || !service.executable || !Array.isArray(service.args) || !service.args.every(x => typeof x === 'string')) throw Error('Invalid service');
    const command = path.isAbsolute(service.executable) ? service.executable : path.resolve(root, service.executable);
    if (!fs.existsSync(command)) throw Error('Executable not found: ' + command);
    return { name: service.name, command, args: service.args, cwd: service.cwd ? path.resolve(root, service.cwd) : root };
  });
}
function main() {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'config', 'piraiders-launcher.json'));
  const supervisor = new ProcessSupervisor(loadSettings(file));
  for (const event of ['started', 'exited', 'restarting', 'fault']) supervisor.on(event, data => console.log(JSON.stringify({ event, ...data, at: new Date().toISOString() })));
  const shutdown = () => supervisor.stop();
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  supervisor.start();
}
if (require.main === module) try { main(); } catch (error) { console.error('PiRaiders launcher:', error.message); process.exitCode = 1; }
module.exports = { loadSettings };
