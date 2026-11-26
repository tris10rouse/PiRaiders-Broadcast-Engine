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
module.exports = { SHUTDOWN_SIGNALS, bindShutdownSignals };
