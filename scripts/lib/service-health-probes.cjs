'use strict';
const http = require('node:http');
const net = require('node:net');

const MAX_RESPONSE_BYTES = 16 * 1024;
const PROTOCOLS = { spx: 'spx-http', casparcg: 'casparcg-amcp' };
const KEYS = new Set(['protocol', 'host', 'port', 'timeoutMs']);
const failed = code => ({ healthy: false, code });

function normalizeHealthConfig(name, config) {
  if (!Object.hasOwn(PROTOCOLS, name)) throw Error('Unknown health service');
  if (config === undefined) return null;
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      Object.keys(config).some(key => !KEYS.has(key))) throw Error('Invalid health configuration');
  if (config.protocol !== PROTOCOLS[name]) throw Error('Health protocol does not match service');
  const host = config.host === undefined ? '127.0.0.1' : config.host;
  if (!['127.0.0.1', '::1'].includes(host)) throw Error('Health host must be numeric loopback');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw Error('Invalid health port');
  const timeoutMs = config.timeoutMs === undefined ? 1000 : config.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 5000) throw Error('Invalid health timeout');
  return Object.freeze({ protocol: config.protocol, host, port: config.port, timeoutMs });
}

function safeVersion(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 &&
    value.trim() === value && /^[\x20-\x7e]+$/.test(value);
}

function probeHttp(config, signal) {
  return new Promise(resolve => {
    let request, response, socket, result, timer, requestClosed = false, resolved = false;
    const complete = () => {
      if (!result || !requestClosed || resolved) return;
      if (socket && !socket.closed) { socket.once('close', complete); return; }
      resolved = true; resolve(result);
    };
    const finish = value => {
      if (result) return;
      result = value;
      clearTimeout(timer); signal?.removeEventListener('abort', aborted);
      response?.destroy(); request?.destroy(); socket?.destroy();
      complete();
    };
    const aborted = () => finish(failed('ABORTED'));
    request = http.request({ host: config.host, port: config.port, path: '/api/v1/version', method: 'GET',
      agent: false, maxHeaderSize: MAX_RESPONSE_BYTES, headers: { Connection: 'close', Accept: 'application/json' }
    }, incoming => {
      response = incoming;
      incoming.once('error', () => finish(failed('INVALID_RESPONSE')));
      if (incoming.statusCode !== 200) { finish(failed('HTTP_STATUS')); return; }
      const chunks = []; let size = 0;
      incoming.on('data', data => {
        size += data.length;
        if (size > MAX_RESPONSE_BYTES) { finish(failed('RESPONSE_TOO_LARGE')); return; }
        chunks.push(data);
      });
      incoming.once('aborted', () => finish(failed('INVALID_RESPONSE')));
      incoming.once('end', () => {
        if (result) return;
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { finish(failed('INVALID_RESPONSE')); return; }
        if (!body || body.vendor !== 'SPX Graphics' || body.product !== 'SPX Solo') {
          finish(failed('IDENTITY_MISMATCH')); return;
        }
        if (!safeVersion(body.version)) { finish(failed('INVALID_RESPONSE')); return; }
        finish({ healthy: true, version: body.version });
      });
    });
    request.on('socket', connected => { socket = connected; if (result) connected.destroy(); });
    request.once('error', error => finish(failed(error.code === 'HPE_HEADER_OVERFLOW' ? 'RESPONSE_TOO_LARGE' :
      response || String(error.code).startsWith('HPE_') ? 'INVALID_RESPONSE' : 'CONNECTION_FAILED')));
    request.once('close', () => {
      requestClosed = true;
      if (!result) finish(failed('INVALID_RESPONSE'));
      complete();
    });
    timer = setTimeout(() => finish(failed('TIMEOUT')), config.timeoutMs);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted(); else request.end();
  });
}

function probeAmcp(config, signal) {
  return new Promise(resolve => {
    let result, timer, buffer = Buffer.alloc(0);
    const socket = net.createConnection({ host: config.host, port: config.port });
    const finish = value => {
      if (result) return;
      result = value;
      clearTimeout(timer); signal?.removeEventListener('abort', aborted);
      socket.destroy();
    };
    const aborted = () => finish(failed('ABORTED'));
    socket.once('connect', () => { if (!result) socket.write('VERSION\r\n'); });
    socket.on('data', data => {
      if (result) return;
      if (buffer.length + data.length > MAX_RESPONSE_BYTES) { finish(failed('RESPONSE_TOO_LARGE')); return; }
      buffer = Buffer.concat([buffer, data]);
      const text = buffer.toString('latin1');
      const firstEnd = text.indexOf('\r\n');
      if (firstEnd < 0) return;
      if (text.slice(0, firstEnd) !== '201 VERSION OK') { finish(failed('INVALID_RESPONSE')); return; }
      const secondEnd = text.indexOf('\r\n', firstEnd + 2);
      if (secondEnd < 0) return;
      const version = text.slice(firstEnd + 2, secondEnd);
      if (!safeVersion(version) || !/^\d+\.\d+(?:\.\d+)?(?:[ ._+()-][\x20-\x7e]*)?$/.test(version) || secondEnd + 2 !== text.length) {
        finish(failed('INVALID_RESPONSE')); return;
      }
      finish({ healthy: true, version });
    });
    socket.once('error', () => finish(failed('CONNECTION_FAILED')));
    socket.once('end', () => finish(failed('INVALID_RESPONSE')));
    socket.once('close', () => {
      if (!result) finish(failed('INVALID_RESPONSE'));
      resolve(result);
    });
    timer = setTimeout(() => finish(failed('TIMEOUT')), config.timeoutMs);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}

async function probeServiceHealth(config, { signal } = {}) {
  let normalized;
  try {
    const name = Object.keys(PROTOCOLS).find(key => PROTOCOLS[key] === config?.protocol);
    normalized = normalizeHealthConfig(name, config);
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw Error('Invalid abort signal');
  } catch { return failed('INVALID_CONFIG'); }
  if (signal?.aborted) return failed('ABORTED');
  return normalized.protocol === 'spx-http' ? probeHttp(normalized, signal) : probeAmcp(normalized, signal);
}

module.exports = { normalizeHealthConfig, probeServiceHealth };
