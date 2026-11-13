#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { LauncherRuntime } = require('./lib/launcher-runtime.cjs');
const { normalizeWindow } = require('./lib/production-window.cjs');
const { assertJobHostAvailable } = require('./lib/windows-job-process.cjs');
function loadSettings(file) {
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  normalizeWindow(settings.productionWindow);
  if (!Array.isArray(settings.services) || !settings.services.length) throw Error('services array required');
  const root = path.resolve(path.dirname(file), '..');
  const services = settings.services.map(service => {
    if (!service || !['spx', 'casparcg'].includes(service.name)) throw Error('Unknown service');
    if (typeof service.executable !== 'string' || !service.executable || !Array.isArray(service.args) || !service.args.every(x => typeof x === 'string')) throw Error('Invalid service');
    const command = path.isAbsolute(service.executable) ? service.executable : path.resolve(root, service.executable);
    if (!fs.statSync(command).isFile()) throw Error('Executable is not a file: ' + command);
    if (service.cwd !== undefined && typeof service.cwd !== 'string') throw Error('Invalid service cwd');
    const cwd = service.cwd ? path.resolve(root, service.cwd) : root;
    if (!fs.statSync(cwd).isDirectory()) throw Error('Service cwd is not a directory');
    return { name: service.name, command, args: service.args, cwd };
  });
  if (services.length !== 2 || new Set(services.map(s => s.name)).size !== 2) throw Error('Exactly one spx and one casparcg service required');
  assertJobHostAvailable();
  return { services, productionWindow: settings.productionWindow };
}
async function main() {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'config', 'piraiders-launcher.json'));
  const runtime = new LauncherRuntime(loadSettings(file));
  for (const event of ['starting', 'started', 'exited', 'restarting', 'inhibited', 'fault']) runtime.on(event, data => console.log(JSON.stringify({ event, ...data, at: new Date().toISOString() })));
  let shutdownPromise;
  const shutdown = () => {
    if (!shutdownPromise) shutdownPromise = shutdownWithRetries(runtime)
      .catch(error => { console.error('PiRaiders shutdown state unknown:', error.message, 'Inspect logged service PIDs and terminate remaining processes manually before restarting.'); process.exitCode = 1; })
      .finally(() => { shutdownPromise = null; });
    return shutdownPromise;
  };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  try { await runtime.start(); }
  catch (error) { await shutdown(); throw error; }
}
if (require.main === module) main().catch(error => { console.error('PiRaiders launcher:', error.message); process.exitCode = 1; });
async function shutdownWithRetries(runtime, { attempts = 3, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3) throw Error('Invalid shutdown attempts');
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { await runtime.close(); return; }
    catch (error) {
      if (attempt === attempts) throw error;
      await delay(1000);
    }
  }
}
module.exports = { loadSettings, shutdownWithRetries };
