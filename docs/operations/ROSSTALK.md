# RossTalk transport development boundary (BE-003)

The transport library and loopback bench remain available with legacy FIFO defaults. The opt-in managed facade below now drives the real native presentation session. It does **not** enable a listener in the default Windows launcher or establish Daktronics interoperability; launcher lifecycle wiring and a separately authorized Display Studio off-air test remain gates. The separate iPad operator never uses a PiRaiders interface.

## Wire contract

Ross documents TCP port 7788, case-sensitive ASCII commands terminated by CR/LF, and `GPI 5` as a simulated GPI input in its [Carbonite RossTalk command reference](https://help.rossvideo.com/carbonite-device/Topics/Protocol/RossTalk/XPN/RT-XPN-Comm.html). PiRaiders implements only `GPI <decimal>\r\n`: one space, uppercase GPI, one to five decimal digits, numeric range 0–65535. Leading zeros are accepted; configured keys are canonical decimal. This is a deliberately small supported subset, not a general Ross device emulator.

There are no unsolicited replies by default. Ross documents a Cmd Response OFF default for the specific [Acuity/Vision integration](https://help.rossvideo.com/acuity-device/Topics/Protocol/External/VIS/RT-VIS-Comm.html); that does not establish a universal RossTalk reply rule. Optional PiRaiders diagnostic replies are a **custom bench protocol**, not a Ross compatibility claim: `OK <sequence> <action>\r\n` after handler completion, or `ERR <sequence> <fixed-code>\r\n`. Sequence 0 denotes a framing/connection error without a parsed command. Replies are best effort and may be lost when a socket is closed. Handler completion means only that the supplied callback resolved, never that an image appeared or a board route changed.

## Explicit integration API

```js
const { RossTalkBridge } = require('../../scripts/lib/rosstalk-bridge.cjs');
const bridge = new RossTalkBridge({
  host: '127.0.0.1', port: 7788,
  allowedSenders: ['127.0.0.1'],
  commandMap: { 1: 'launch', 2: 'next', 3: 'previous', 4: 'toggle-auto', 5: 'reload', 8: 'stop' }
}, { handleCommand: async ({ action, gpi, sequence, signal }) => {
  // Supply the real presentation adapter here; none is registered automatically.
  // Check cancellation immediately before committing any asynchronous side effect.
  signal.throwIfAborted();
  await presentation.dispatch({ action, gpi, sequence, signal });
} });
await bridge.start();
// On application shutdown:
await bridge.close();
```

The example names a future application-owned `presentation` adapter; it is not a ready-to-run graphics service. Importing the module opens no socket. Missing handler, sender allowlist or command map fails configuration. Unknown keys and invalid values fail before binding. Supported action values are `launch`, `next`, `previous`, `toggle-auto`, `auto`, `manual`, `reload`, `stop`; these are dispatch names, not implemented playback promises. Port 0 is allowed only with an explicit test option and loopback bind.

Bind and allowed senders must be numeric IPv4/IPv6 literals. Equivalent IPv6 spellings and IPv4-mapped IPv6 addresses are canonicalized. DNS names, CIDR ranges, wildcard sender entries and IPv6 zone suffixes are rejected. Binding all interfaces requires explicitly choosing `0.0.0.0` or `::`; it does not relax the source allowlist. IP filtering is a network restriction, not sender authentication or encryption. Network/firewall changes and actual stadium sender addresses require the owner's deployment approval; this work changes none.

## Ordering, resource limits and recovery

Commands parsed and enqueued from allowed sockets receive monotonically increasing process-local sequence numbers and dispatch through one global FIFO. Repeated Next is two separate actions. There is no deduplication, delivery guarantee, replay or automatic retry. A complete **accepted** command survives client disconnect or write-half-close, matching fire-and-forget senders. Incomplete frames are dropped on EOF; reconnect starts fresh framing. Do not retry blindly after a lost reply because the prior command may already have executed. Invalid input closes that connection after any previously accepted work. The bounded decoder validates a subchunk before returning its lines; a malformed suffix can reject complete prefixes from the same subchunk before they are accepted.

Default bounds (configurable ranges are enforced in the module):

| Setting | Default | Range |
| --- | ---: | ---: |
| maxConnections | 16 | 1–64 |
| maxQueue (in addition to one in flight) | 32 | 1–256 |
| maxFrameBytes (payload excluding CR/LF) | 128 | 16–1024 |
| idleTimeoutMs | 10000 | 100–60000 |
| handlerTimeoutMs | 2000 | 50–10000 |

Decoder batches are at most 1024 bytes and each connection retains at most one bounded partial frame. The reply buffer is capped at 4096 bytes; a slow reader is disconnected when it exceeds that cap. Queue overflow rejects the new command with BUSY and closes that input; accepted work remains ordered. Connection limits and source filtering apply before command parsing. The idle timeout measures network inactivity, not total frame age; slow-drip clients can occupy a bounded connection slot until they become idle. This boundary is intended for a controlled LAN, not Internet exposure.

A rejected callback reports HANDLER_FAILED and the next command may run. A timed-out callback instead aborts its signal, faults the entire bridge, cancels queued work and closes all connections: it never dispatches around a callback that might still be running. `close()` is idempotent, aborts active work and does not wait forever for an uncooperative callback. Late resolutions cannot change settled counters or restart dispatch. This cannot undo side effects from a callback that ignores cancellation: the presentation adapter must propagate the signal, check it before committing, and fence its own asynchronous work. Create a new bridge only after that adapter's recovery is complete. Raw callback/network exception messages are never returned to clients or emitted as result diagnostics.

`command` events describe accepted work, `result` events provide fixed status/code, action/GPI/sequence and elapsed milliseconds, and `fault` reports terminal failure. `snapshot()` provides counters, queue depth, connection count and state. These events contain no raw frame text. Consumers should use bounded/rotated logs; persistent application logging remains separate release work.

## Automated off-air verification

Run on a development computer with Node 22 and locked dependencies:

```text
npm run setup
npm run bench:rosstalk
```

The bench binds an ephemeral port on 127.0.0.1 only, supplies a simulated handler, fragments/coalesces commands and verifies ordered Launch/Next/Next/Stop plus diagnostic replies. It cannot target stadium hardware. The TCP test suite also exercises denial, overload, disconnect, malformed input, timeout, cancellation, failure recovery and listener lifecycle. CI runs the suite and bench on Windows and Ubuntu. OS TCP execution is real; the presentation callback is simulated. No rendering, Display Studio, CasparCG, NDI or Daktronics hardware is exercised here.

Before marking BE-003 complete, wire a tested presentation controller without bypassing production-window enforcement, implement bounded persistent command diagnostics, and record a separately authorized off-air Display Studio sender test. Maintain original SPX HTML/OGraf/project/rundown workflows throughout.

## Owned managed presentation facade

```js
const { createRossTalkSession } = require('../../scripts/lib/rosstalk-session.cjs');
const control = await createRossTalkSession({
  presentation: {snapshotDir: absolutePreparedSnapshotDir},
  rossTalk: {
    host:'127.0.0.1',port:7788,allowedSenders:['127.0.0.1'],
    commandMap:{1:'launch',2:'next',3:'previous',4:'toggle-auto',5:'reload',8:'stop'}
  },
  canControl: () => runtime.started && runtime.allowed(),
  resolvePreparedSnapshot: async ({signal}) => {
    signal.throwIfAborted(); return selectedPreparedSnapshotDirectory;
  }
});
// Pass control.getProgramURL() privately to the intended producer; never log it.
await control.start();
// Application shutdown:
await control.close();
```

`runtime` and selected paths are application-owned inputs; the example is not an automatic event/source provider. Both callbacks are mandatory. The gate must return literal true synchronously; false, throw, rejected or resolved promises deny normal commands. Stop bypasses the gate. Reload resolves only an absolute already-prepared snapshot and rechecks cancellation, generation, renderer epoch and gate before activation. Raw resolver errors and program credentials never enter snapshot/diagnostic replies. The facade owns and closes both host and listener; no caller can bypass its command ordering through a public host object. A failed host result is a rejected handler, not OK.

Defaults derive the facade's handler budget from resolverTimeoutMs5000 + prepareTimeoutMs30000 + three*(commandTimeoutMs12000+500) +1000 =73500ms. Explicit smaller budgets fail before binding; maximum300000. The underlying transport's legacy default2000/range50–10000 is unchanged. Only explicit priority mode accepts the extended bound. A resolver timeout aborts/requests black promptly, but an ignored callback retains its actual barrier until settlement or terminal transport timeout. Any transport abort independently requests Stop; a terminal fault closes the owned host/listener, never resumes around a stuck callback. Inspect fixed facade lastError and transport counters; recreate only after recovery.

`control.snapshot()` freezes state/lastError, transport and presentation snapshots; `address()` returns listener address. TCP is off until start; the presentation HTTP host is created by the factory and still needs its authenticated renderer to acknowledge black. Diagnostic OK confirms the managed host operation, not a receiver or board route. Source staging/watchers, event selection, sender startup and deployment are outside this facade.

## Opt-in priority Stop semantics

`new RossTalkBridge(config,{handleCommand,prioritizeStop:true})` enables priority Stop. It admits valid Stop before normal queue capacity, cancels queued normal work, aborts/logically cancels the active normal callback and starts one Stop alongside it. Repeated Stops share the black operation/outcome; unresolved reply followers are capped at maxQueue. No normal successor runs until both actual callbacks settle. The interrupted callback retains its original independent watchdog even after black succeeds. Snapshot outstandingCallbacks/stopPending/stopFollowers/callbackTimeouts distinguishes actual work from logical results; an orphan timeout does not double-count its earlier cancellation.

Priority-mode BUSY rejects keep the input readable so a later Stop in the same burst can be parsed. Silent fire-and-forget EOF releases its socket slot immediately while preserving accepted metadata/work. Framing/source/reply-buffer failures remain fail-closed, and an unaccepted command on a closed socket has no delivery guarantee. Legacy callers keep their original FIFO/overflow behavior. Full queue,100 repeated Stops, late callbacks, orphan timeout and listener close are covered with actual TCP.

Actual TCP-to-Chromium tests now prove frames, mode feedback, verified Reload, gate denial/Stop bypass, full-queue black with a stuck resolver, and late resolution fenced across gate/renderer changes. Extracted Windows package smoke uses real TCP/WebSocket transport with explicitly simulated frame ACKs. These are software tests, not Display Studio, NDI or stadium compatibility. Sender window enforcement remains independently owned by LauncherRuntime; it must never wait for control callbacks at window end.
