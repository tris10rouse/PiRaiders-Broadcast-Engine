'use strict';
const net = require('node:net');

const ACTIONS = new Set(['launch', 'next', 'previous', 'toggle-auto', 'auto', 'manual', 'reload', 'stop']);
const KEYS = new Set(['host', 'port', 'allowedSenders', 'commandMap', 'acknowledgements',
  'maxConnections', 'maxQueue', 'maxFrameBytes', 'idleTimeoutMs', 'handlerTimeoutMs']);

/** Numeric literals only: never resolve a sender or bind address through DNS. */
function canonicalAddress(value) {
  if (typeof value !== 'string' || value.includes('%') || !net.isIP(value)) throw Error('A numeric IP literal is required');
  if (net.isIP(value) === 4) return value;
  // WHATWG IPv6 serialization compresses equivalent numeric addresses and turns
  // dotted mapped addresses into the same hexadecimal representation.
  const canonical = new URL('http://[' + value + ']/').hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (mapped) {
    const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
    return [high >>> 8, high & 255, low >>> 8, low & 255].join('.');
  }
  return canonical;
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function bounded(value, fallback, min, max, name) {
  const result = value === undefined ? fallback : value;
  if (!Number.isInteger(result) || result < min || result > max) throw Error('Invalid RossTalk ' + name);
  return result;
}

function normalizeRossTalkConfig(raw, { allowEphemeral = false } = {}) {
  if (!plainObject(raw) || Reflect.ownKeys(raw).some(key => !KEYS.has(key))) throw Error('Invalid RossTalk configuration');
  const host = canonicalAddress(raw.host === undefined ? '127.0.0.1' : raw.host);
  const ephemeral = allowEphemeral === true && ['127.0.0.1', '::1'].includes(host);
  const port = bounded(raw.port, 7788, ephemeral ? 0 : 1, 65535, 'port');
  if (!Array.isArray(raw.allowedSenders) || !raw.allowedSenders.length) throw Error('RossTalk sender allowlist is required');
  // Array.from visits sparse entries too, so a hole cannot escape validation.
  const allowedSenders = Object.freeze([...new Set(Array.from(raw.allowedSenders, canonicalAddress))]);
  if (!plainObject(raw.commandMap)) throw Error('RossTalk command mapping is required');
  const keys = Reflect.ownKeys(raw.commandMap);
  if (!keys.length || keys.length > 64) throw Error('RossTalk command mapping must contain 1 through 64 entries');
  const commandMap = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]{0,4})$/.test(key) || Number(key) > 65535 ||
        !ACTIONS.has(raw.commandMap[key])) throw Error('Invalid RossTalk command mapping');
    commandMap[key] = raw.commandMap[key];
  }
  if (raw.acknowledgements !== undefined && typeof raw.acknowledgements !== 'boolean') throw Error('Invalid RossTalk acknowledgements');
  return Object.freeze({
    host, port, allowedSenders, commandMap: Object.freeze(commandMap),
    acknowledgements: raw.acknowledgements === true,
    maxConnections: bounded(raw.maxConnections, 16, 1, 64, 'connection limit'),
    maxQueue: bounded(raw.maxQueue, 32, 1, 256, 'queue limit'),
    maxFrameBytes: bounded(raw.maxFrameBytes, 128, 16, 1024, 'frame limit'),
    idleTimeoutMs: bounded(raw.idleTimeoutMs, 10000, 100, 60000, 'idle timeout'),
    handlerTimeoutMs: bounded(raw.handlerTimeoutMs, 2000, 50, 10000, 'handler timeout')
  });
}

/** Supported subset only: uppercase GPI, one space, decimal ID, no delimiter. */
function parseRossTalkLine(line, commandMap) {
  if (typeof line !== 'string' || line.length < 5 || line.length > 9) return { ok: false, code: 'MALFORMED_COMMAND' };
  const match = /^GPI ([0-9]{1,5})$/.exec(line);
  // JavaScript's $ can match before a final newline; require the whole string.
  if (!match || match[0] !== line || Number(match[1]) > 65535) return { ok: false, code: 'MALFORMED_COMMAND' };
  const gpi = Number(match[1]);
  if (!commandMap || !Object.hasOwn(commandMap, String(gpi))) return { ok: false, code: 'UNMAPPED_GPI' };
  const action = commandMap[String(gpi)];
  if (!ACTIONS.has(action)) return { ok: false, code: 'UNMAPPED_GPI' };
  return { ok: true, command: { gpi, action } };
}

/** CRLF framing with bounded retained bytes, not a general RossTalk engine. */
class RossTalkFramer {
  #line = '';
  #pendingCR = false;
  #failureCode = null;
  #limit;
  constructor({ maxFrameBytes = 128 } = {}) {
    this.#limit = bounded(maxFrameBytes, 128, 16, 1024, 'frame limit');
  }
  get bufferedBytes() { return this.#line.length + (this.#pendingCR ? 1 : 0); }
  get failed() { return this.#failureCode !== null; }
  #fail(code) {
    this.#failureCode = code; this.#line = ''; this.#pendingCR = false;
    const error = Error('RossTalk frame rejected'); error.code = code; throw error;
  }
  push(chunk) {
    if (this.#failureCode) this.#fail(this.#failureCode);
    if (!Buffer.isBuffer(chunk)) this.#fail('MALFORMED_FRAME');
    const lines = [];
    for (const byte of chunk) {
      if (this.#pendingCR) {
        if (byte !== 10) this.#fail('MALFORMED_FRAME');
        lines.push(this.#line); this.#line = ''; this.#pendingCR = false; continue;
      }
      if (byte === 13) { this.#pendingCR = true; continue; }
      if (byte < 32 || byte > 126) this.#fail('MALFORMED_FRAME');
      if (this.#line.length >= this.#limit) this.#fail('FRAME_TOO_LARGE');
      this.#line += String.fromCharCode(byte);
    }
    return lines;
  }
}

module.exports = { normalizeRossTalkConfig, canonicalAddress, parseRossTalkLine, RossTalkFramer };
