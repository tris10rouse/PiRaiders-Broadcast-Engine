'use strict';
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { performance } = require('node:perf_hooks');
const { normalizeRossTalkConfig, canonicalAddress, parseRossTalkLine, RossTalkFramer } = require('./rosstalk-protocol.cjs');
const MAX_REPLY_BYTES = 4096;
function failure(code) { return Object.assign(Error('RossTalk ' + code), { code }); }

/** Explicitly constructed transport boundary; never starts a listener on import. */
class RossTalkBridge extends EventEmitter {
  constructor(config, { handleCommand, allowEphemeral = false, prioritizeStop = false, clock = () => performance.now() } = {}) {
    super();
    if (typeof prioritizeStop !== 'boolean') throw Error('Invalid priority Stop option');
    this.config = normalizeRossTalkConfig(config, { allowEphemeral, allowExtendedTimeout: prioritizeStop });
    if (typeof handleCommand !== 'function') throw Error('An explicit playback command handler is required');
    Object.assign(this, { handleCommand, clock, prioritizeStop });
    this.allowed = new Set(this.config.allowedSenders);
    this.state = 'idle'; this.closed = false; this.faulted = false;
    this.peers = new Set(); this.queue = []; this.inFlight = null; this.sequence = 0;
    this.operations = new Set(); this.priorityStop = null; this.callbackTimeouts = 0;
    this.counts = { accepted: 0, completed: 0, rejected: 0, failed: 0, timedOut: 0, cancelled: 0 };
  }
  start() {
    if (this.closed || this.faulted) return Promise.reject(failure('CLOSED'));
    if (this.startPromise) return this.startPromise;
    this.state = 'starting';
    this.server = net.createServer({ allowHalfOpen: true }, socket => this.accept(socket));
    this.startPromise = new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return; settled = true;
        this.cancelStart = null;
        if (error) reject(error); else resolve(this.address());
      };
      this.cancelStart = () => finish(failure('CLOSED'));
      this.server.on('error', () => {
        if (this.state === 'starting') { this.state = 'failed'; finish(failure('LISTEN_FAILED')); }
        else if (!this.closed) this.terminalFault('LISTENER_FAILED');
      });
      this.server.once('listening', () => {
        if (this.closed) { finish(failure('CLOSED')); return; }
        this.state = 'listening'; finish(); this.emit('listening', { port: this.address().port });
      });
      try { this.server.listen({ host: this.config.host, port: this.config.port }); }
      catch { this.state = 'failed'; finish(failure('LISTEN_FAILED')); }
    });
    return this.startPromise;
  }
  address() { return this.server?.address() || null; }
  snapshot() { return { state: this.state, faulted: this.faulted, connections: this.peers.size,
    queued: this.queue.length, inFlight: this.inFlight !== null,
    outstandingCallbacks: this.operations.size, stopPending: this.priorityStop !== null,
    stopFollowers: this.priorityStop?.followers.length || 0, callbackTimeouts: this.callbackTimeouts, ...this.counts }; }
  accept(socket) {
    socket.on('error', () => {}); // Network errors never expose raw messages.
    let source;
    try { source = canonicalAddress(socket.remoteAddress); } catch {}
    if (this.closed || this.faulted || !this.allowed.has(source)) {
      this.reject(null, 0, 'SOURCE_DENIED'); socket.destroy(); return;
    }
    if (this.peers.size >= this.config.maxConnections) {
      this.reject(null, 0, 'CONNECTION_LIMIT'); socket.destroy(); return;
    }
    const peer = { socket, ended: false, closing: false, pending: 0,
      framer: new RossTalkFramer({ maxFrameBytes: this.config.maxFrameBytes }) };
    this.peers.add(peer); socket.setNoDelay(true);
    socket.setTimeout(this.config.idleTimeoutMs, () => {
      this.reject(peer, 0, 'IDLE_TIMEOUT'); socket.destroy();
    });
    socket.on('data', data => this.receive(peer, data));
    socket.on('end', () => {
      peer.ended = true;
      if (peer.framer.bufferedBytes) this.reject(peer, 0, 'TRUNCATED_FRAME');
      if (!peer.pending || (this.prioritizeStop && !this.config.acknowledgements)) socket.end();
    });
    socket.once('close', () => { this.peers.delete(peer); });
  }
  reply(peer, sequence, ok, value) {
    if (!this.config.acknowledgements || !peer || peer.socket.destroyed || peer.socket.writableEnded) return;
    const text = (ok ? 'OK ' : 'ERR ') + sequence + ' ' + value + '\r\n';
    if (peer.socket.writableLength + Buffer.byteLength(text) > MAX_REPLY_BYTES) { peer.socket.destroy(); return; }
    peer.socket.write(text);
  }
  reject(peer, sequence, code) {
    this.counts.rejected++;
    this.reply(peer, sequence, false, code);
    this.emit('result', { sequence, status: 'rejected', code });
  }
  endPeer(peer) {
    peer.closing = true; peer.ended = true; peer.socket.pause();
    if (!peer.pending) peer.socket.end();
  }
  receive(peer, data) {
    if (this.closed || this.faulted || peer.closing) return;
    // Bound the decoder's completed-frame array independently of TCP chunk size.
    for (let offset = 0; offset < data.length; offset += 1024) {
      let lines;
      try { lines = peer.framer.push(data.subarray(offset, offset + 1024)); }
      catch (error) {
        this.reject(peer, 0, error.code === 'FRAME_TOO_LARGE' ? 'FRAME_TOO_LARGE' : 'MALFORMED_FRAME');
        this.endPeer(peer); return;
      }
      for (const line of lines) {
        if (this.closed || this.faulted || peer.socket.destroyed || peer.closing) return;
        if (this.sequence >= Number.MAX_SAFE_INTEGER) { this.terminalFault('SEQUENCE_LIMIT'); return; }
        const sequence = ++this.sequence;
        const parsed = parseRossTalkLine(line, this.config.commandMap);
        if (!parsed.ok) { this.reject(peer, sequence, parsed.code); this.endPeer(peer); return; }
        if (this.prioritizeStop && parsed.command.action === 'stop') {
          this.admitStop({ ...parsed.command, sequence, peer, received: this.clock(), settled: false });
          continue;
        }
        if (this.queue.length >= this.config.maxQueue) {
          this.reject(peer, sequence, 'BUSY');
          if (this.prioritizeStop) continue;
          this.endPeer(peer); return;
        }
        const request = { ...parsed.command, sequence, peer, received: this.clock(), settled: false };
        peer.pending++; this.counts.accepted++; this.queue.push(request);
        this.emit('command', { sequence, action: request.action, gpi: request.gpi });
        this.pump();
      }
    }
  }
  pump() {
    if (this.prioritizeStop) { this.pumpPriority(); return; }
    if (this.closed || this.faulted || this.inFlight || !this.queue.length) return;
    const request = this.queue.shift(); this.inFlight = request;
    request.controller = new AbortController();
    request.timer = setTimeout(() => {
      if (request.settled) return;
      this.faulted = true; request.controller.abort();
      this.settle(request, 'timeout', 'HANDLER_TIMEOUT');
      this.emit('fault', { code: 'HANDLER_TIMEOUT' });
      // Never dispatch around a callback that might ignore cancellation.
      void this.close().catch(() => {});
    }, this.config.handlerTimeoutMs);
    Promise.resolve().then(() => {
      if (request.settled) return;
      return this.handleCommand(Object.freeze({ sequence: request.sequence, action: request.action,
        gpi: request.gpi, signal: request.controller.signal }));
    }).then(() => this.settle(request, 'completed'), () => this.settle(request, 'failed', 'HANDLER_FAILED'));
  }
  settle(request, status, code) {
    if (request.settled) return;
    request.settled = true; clearTimeout(request.timer);
    if (status === 'completed') this.counts.completed++;
    else if (status === 'failed') this.counts.failed++;
    else if (status === 'timeout') this.counts.timedOut++;
    else this.counts.cancelled++;
    this.reply(request.peer, request.sequence, status === 'completed', code || request.action);
    const elapsed = this.clock() - request.received;
    this.emit('result', { sequence: request.sequence, action: request.action, gpi: request.gpi, status,
      ...(code ? { code } : {}), durationMs: Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0 });
    request.peer.pending--;
    if (request.peer.ended && !request.peer.pending && !request.peer.socket.destroyed) request.peer.socket.end();
    if (this.inFlight === request) this.inFlight = null;
    this.pump();
  }
  accepted(request) {
    request.peer.pending++; this.counts.accepted++;
    this.emit('command', { sequence: request.sequence, action: request.action, gpi: request.gpi });
  }
  cancelNormalQueue() {
    for (const request of this.queue.splice(0)) this.settlePriority(request, 'cancelled', 'CANCELLED');
  }
  admitStop(request) {
    this.cancelNormalQueue();
    if (this.closed || this.faulted) return;
    if (this.inFlight && !this.inFlight.settled) {
      this.inFlight.controller.abort();
      this.settlePriority(this.inFlight, 'cancelled', 'CANCELLED');
    }
    if (this.closed || this.faulted) return;
    const previous = this.priorityStop;
    if (previous) {
      if (!previous.outcome && previous.followers.length >= this.config.maxQueue) {
        this.reject(request.peer, request.sequence, 'BUSY'); return;
      }
      this.accepted(request);
      if (this.closed || this.faulted) { this.settlePriority(request,'cancelled','CLOSED'); return; }
      if (previous.outcome) this.settlePriority(request, previous.outcome.status, previous.outcome.code);
      else previous.followers.push(request);
      return;
    }
    this.accepted(request);
    if (this.closed || this.faulted) { this.settlePriority(request,'cancelled','CLOSED'); return; }
    request.followers = []; request.isStop = true;
    this.priorityStop = request;
    this.startPriority(request);
  }
  pumpPriority() {
    if (this.closed || this.faulted || this.operations.size || !this.queue.length) return;
    const request = this.queue.shift(); this.inFlight = request;
    this.startPriority(request);
  }
  startPriority(request) {
    request.controller = new AbortController(); request.actualDone = false;
    this.operations.add(request);
    request.timer = setTimeout(() => {
      if (request.actualDone || this.closed || this.faulted) return;
      this.callbackTimeouts++;
      this.faulted = true; request.controller.abort();
      this.settlePriority(request, 'timeout', 'HANDLER_TIMEOUT');
      this.emit('fault', { code: 'HANDLER_TIMEOUT' });
      void this.close().catch(() => {});
    }, this.config.handlerTimeoutMs);
    Promise.resolve().then(() => {
      // A Stop can preempt a just-admitted callback before its microtask starts.
      if (request.settled || this.closed || this.faulted) return;
      return this.handleCommand(Object.freeze({ sequence: request.sequence, action: request.action,
        gpi: request.gpi, signal: request.controller.signal }));
    }).then(() => this.finishPriorityCallback(request, 'completed'),
      () => this.finishPriorityCallback(request, 'failed', 'HANDLER_FAILED'));
  }
  settlePriority(request, status, code) {
    if (request.settled) return;
    request.settled = true;
    if (status === 'completed') this.counts.completed++;
    else if (status === 'failed') this.counts.failed++;
    else if (status === 'timeout') this.counts.timedOut++;
    else this.counts.cancelled++;
    this.reply(request.peer, request.sequence, status === 'completed', code || request.action);
    const elapsed = this.clock() - request.received;
    this.emit('result', { sequence: request.sequence, action: request.action, gpi: request.gpi, status,
      ...(code ? { code } : {}), durationMs: Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0 });
    request.peer.pending--;
    if (request.peer.ended && !request.peer.pending && !request.peer.socket.destroyed) request.peer.socket.end();
    // Logical cancellation must never clear the physical callback's deadline.
  }
  finishPriorityCallback(request, status, code) {
    if (request.actualDone) return;
    request.actualDone = true; clearTimeout(request.timer); this.operations.delete(request);
    this.settlePriority(request, status, code);
    if (request.isStop) {
      request.outcome = {status,code};
      for (const follower of request.followers.splice(0)) this.settlePriority(follower,status,code);
    }
    if (this.inFlight === request) this.inFlight = null;
    if (!this.operations.size) this.priorityStop = null;
    this.pumpPriority();
  }
  terminalFault(code) {
    if (this.faulted || this.closed) return;
    this.faulted = true; this.emit('fault', { code }); void this.close().catch(() => {});
  }
  close() {
    if (this.closePromise) return this.closePromise;
    let finish, reject;
    this.closePromise = new Promise((resolve, rejected) => { finish = resolve; reject = rejected; });
    this.closed = true; this.state = 'closing'; this.cancelStart?.();
    const pending = this.queue.splice(0);
    if (this.prioritizeStop) {
      for (const request of pending) this.settlePriority(request, 'cancelled', 'CLOSED');
      for (const request of this.operations) {
        request.controller.abort(); clearTimeout(request.timer);
        this.settlePriority(request, 'cancelled', 'CLOSED');
      }
      if (this.priorityStop) for (const follower of this.priorityStop.followers.splice(0)) this.settlePriority(follower,'cancelled','CLOSED');
      this.operations.clear(); this.inFlight = null; this.priorityStop = null;
    } else {
      for (const request of pending) this.settle(request, 'cancelled', 'CLOSED');
      if (this.inFlight) {
        const request = this.inFlight; request.controller.abort(); this.settle(request, 'cancelled', 'CLOSED');
      }
    }
    for (const peer of this.peers) peer.socket.destroy();
    const done = error => {
      this.state = this.faulted ? 'faulted' : 'closed';
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(failure('CLOSE_FAILED')); else finish();
    };
    if (!this.server) done();
    else try { this.server.close(done); } catch (error) { done(error); }
    return this.closePromise;
  }
}
module.exports = { RossTalkBridge };
