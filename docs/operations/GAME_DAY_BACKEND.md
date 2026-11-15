# Game Day backend: local/manual preparation

This increment supplies trusted Node APIs, not a finished screen or Windows application entry. It preserves standalone prepared-runtime defaults and original SPX projects/rundowns/HTML/OGraf controls. Actual persistent SPX hosting, protected HTTP routes, desktop UI and nested Windows application proof remain open. No Apps Script importer, Google API or stadium compatibility is claimed.

## Machine policy and event data

`loadGameDayMachineConfig(file,{appRoot,nodeExecutable})` reads at most64KiB and returns validated immutable machine policy. Only that returned object can construct `createLocalEventCatalog(machine)`. Machine policy owns executables, output identity/runtime, RossTalk allowlist/commands, private presentation port and source/cache/runtime/catalog roots. SPX executable/entry/cwd derive from trusted launcher options. The loader does not start SPX or validate its config port/component availability.

Example machine JSON, with paths adjusted for a nonproduction installation:

```json
{
  "schemaVersion": 1,
  "spxConfigFile": "config.json",
  "catalogDirectory": "config/events",
  "mediaRoot": "C:/PiRaiders-test/media",
  "cacheRoot": "data/cache",
  "runtimeRoot": "data/runtime",
  "caspar": {"executable": "components/caspar/casparcg.exe", "cwd": "components/caspar"},
  "output": {"type": "none"},
  "rossTalk": {
    "host": "127.0.0.1", "port": 7788, "allowedSenders": ["127.0.0.1"],
    "commandMap": {"1": "launch", "2": "next", "3": "previous", "4": "toggle-auto", "5": "reload", "8": "stop"}
  }
}
```

Output-none is explicit; missing NDI must never silently downgrade to it. An NDI machine policy uses the existing validated output shape with one permanent source name and explicit runtime directory. No NDI binary is redistributed by these modules.

Each catalog file is exactly `<eventId>.json`. IDs are bounded lowercase letters/digits with hyphens, not DriveID/FileKey/Board identities. Example `bench-game.json`:

```json
{
  "schemaVersion": 1, "provider": "local-manual", "eventId": "bench-game",
  "displayName": "Off-air bench game",
  "productionWindow": {"start": "2026-11-16T18:00:00-06:00", "end": "2026-11-16T21:00:00-06:00"},
  "relativeSourcePath": "bench-game", "startup": {"mode": "source"}
}
```

Dates are examples; choose explicit event times/offsets. Existing defaults apply once:15-minute prewarm, Auto/10seconds, cut transition. Startup may instead be `{mode:"cached",snapshotId:"<verified UUID-v4>"}`; it resolves only under that event's private cache. Cached compilation/startup never probes an unavailable source root. Reload explicitly accesses source again. Generic local lexical ordering remains separate from the owner's Apps Script contract.

Catalog inventory is bounded to128 entries; each JSON read is bounded to64KiB, fatal UTF8 decoding and observed identity/size/timestamp checks. Unsafe paths, Win32 trailing-dot/space/device aliases, symlink ancestry, nonregular catalog files, case collisions and unknown policy overrides are refused with fixed categories. Individual malformed rows remain isolated where possible. `read(id)` returns frozen `{profile,descriptor:{eventId,displayName},revision}` with SHA256 of exact catalog bytes. A prepared candidate retains those bytes' semantics after later disk edits.

## Trusted orchestration

```js
const machine = await loadGameDayMachineConfig(machineFile, {appRoot, nodeExecutable});
const manager = createGameDayManager({
  catalog: createLocalEventCatalog(machine),
  sourceRoot: machine.mediaRoot,
  privateRoots: [machine.cacheRoot, machine.runtimeRoot, machine.catalogDirectory]
});
```

The production application must supply those trusted root boundaries. They are not profile/browser fields. Source preparation and Reload verify canonical source membership and separation from the whole private roots, including prospective paths through existing ancestors. Cached startup verifies its selected cache but deliberately does not inspect the unavailable media mount or certify its current aliases. Filesystem checks detect observed alias/replacement changes; they are not an atomic transaction against a hostile local administrator.

The frozen manager facade provides `listEvents()`, `snapshot()`, `prepare(targetId,tuple)`, `activate(candidateTuple)`, `discardCandidate(candidateTuple)`, `dispatch(action,tuple)` and `close()`. The tuple is exactly `{expectedEventId,expectedSelection}`; candidate operations add `candidateId`. Read the current tuple from snapshot. Activation reserves a new safe integer selection epoch before awaits, including selecting the same event again; stale controls fail closed. Candidate IDs are server-generated opaque values, separate from event IDs and content revisions. Methods resolve sanitized `{ok,code?}` results; manager close is retryable on a false result. PreparedEventRuntime.close separately rejects on failure. Callers must respect each convention.

One physical inventory flight coalesces concurrent listings into the same promise. One catalog/factory preparation flight and one lifecycle operation admit immediate BUSY rather than an unbounded queue. Factory preparation opens no listeners/spawns; confirmed old close precedes new start. Unknown/failed cleanup retains ownership and blocks replacement. Preparation/replacement is refused during an active production window including prewarm, even when output is black or sender unready, and policy is rechecked after awaits. Initial activation of the first event is allowed in its own window.

Stop goes directly through the existing shared local/RossTalk priority queue; it never waits behind preparation and never closes a permitted-window sender. Last-good content survives failed Reload. Runtime source-stage flights and manager factory flights reserve ownership synchronously before their first await. A trusted synchronous canPrepare guard prevents direct old TCP Reload from starting a second source stage if an earlier factory crosses into prewarm. Async/throwing guards fail closed. BUSY remains a fixed resolver diagnostic. Cached verification and native image decoding are separate bounded paths; no global single-decoder claim is made.

Closed runtimes remain referenced until actual source staging settles. Neither cancellation nor a successful close clears that physical barrier. Manager close starts active native cleanup synchronously and logically cancels callers without waiting for ignored inventory/factory work; late runtimes are disposed and late cleanup failures remain retryable. The parent native JobHost must terminate its SPX/event tree independently of graceful manager promises. No operation owns or stops application SPX.

## Verification and remaining work

Tests use actual temporary files, full PNG decode, immutable snapshots, real HTTP/RossTalk listeners and Chromium pixels. Native process/Console boundaries are explicitly injected in browser tests. Coverage includes stale tuples, cleanup/start retries, same-port handoff, corrupt/offline content,100 concurrent inventory calls, held staging across rewind/close, direct TCP Reload as prewarm opens, priority black Stop, source-junction escapes and strict trusted options. Full integration and final-SHA Windows CI are required before merge.

Next: persistent actual SPX application entry and Game Day router with loopback/Host/session/Origin/CSRF isolation, desktop screen and diagnostics, extracted Windows real nested containment/output proof, licensed component installation, preflight/soak and evaluation checklist. See the implementation plan in docs/design/GAME_DAY_BACKEND.md.
