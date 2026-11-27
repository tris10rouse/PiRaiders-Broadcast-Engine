'use strict';
// Signals that ask an entry to close what it owns. On Windows, Node maps a
// console window close (CTRL_CLOSE_EVENT) to SIGHUP and Ctrl+Break to
// SIGBREAK; Windows ends the process a few seconds after a console close, so
// the shutdown must start at once. Without a listener SIGHUP ends Node with
// nothing closed.
const SHUTDOWN_SIGNALS = Object.freeze(['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']);
function bindShutdownSignals(target, shutdown) {
  if (!target || typeof target.on !== 'function' || typeof shutdown !== 'function') throw Error('Invalid shutdown signal binding');
  for (const name of SHUTDOWN_SIGNALS) target.on(name, shutdown);
}
// Q-032: an entry started by a parent with an IPC channel (the bench test
// starts the app this way) closes what it owns when that channel ends: the
// parent disconnects it to close the app, or the parent itself ended (also a
// hard kill). The channel never keeps the entry alive. Launch-PiRaiders.cmd
// starts the app without a channel, so nothing changes there.
function bindParentDisconnect(target, shutdown) {
  if (!target || typeof target.on !== 'function' || typeof shutdown !== 'function') throw Error('Invalid shutdown signal binding');
  if (!target.channel || typeof target.disconnect !== 'function') return false;
  target.on('disconnect', shutdown);
  if (typeof target.channel.unref === 'function') target.channel.unref();
  return true;
}
module.exports = { SHUTDOWN_SIGNALS, bindShutdownSignals, bindParentDisconnect };
