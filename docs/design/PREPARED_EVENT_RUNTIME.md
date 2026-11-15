# Local prepared event runtime

BE-006 opt-in Node API: `createPreparedEventRuntime(profile)` prepares a verified snapshot and generated private configuration, then returns `start()`, redacted `snapshot()` and idempotent `close()`. The default launcher/CLI and original SPX external CasparCG configuration remain unchanged. No Apps Script, Drive API, folder watcher or UI is invented here.

## Profile boundary

Strict schemaVersion1/provider local-manual, opaque local eventId, explicit bounded productionWindow (default15-minute prewarm), SPX executable/args/cwd, owned Caspar executable/cwd/runtimeDir, local-lexical-v1 source/cache and explicit source or cached startup, existing playback defaults (Auto/10seconds/cut), private presentation port and allowlisted non-ephemeral RossTalk. Output defaults none; NDI requires explicit source name/runtimeDirectory. Profile fields are copied/frozen, unknown/accessor/hidden values rejected; errors are fixed categories. Local paths/order/IDs do not define Apps Script Board membership or FileKey/DriveID.

Initial full capture/decode or explicit offline verification precedes any HTTP/TCP bind or spawn. Realpath source/cache/runtime alias overlaps are rejected. Missing source never silently falls back; cached startup does not read/create source. Listener collision closes owned resources before services start and never kills a foreign process. Generated XML contains no private producer URL, disables AMCP TCP/file/CEF logs/cache/OSC subscription and escapes literal paths/NDI identity. NDI transport can legitimately listen; do not reuse the no-root-TCP assertion from the consumer-free Console proof.

## Lifecycle

The private Console child is identified from validated exact service roles, never a TCP VERSION responder. Handoff requires the current owned generation/window after each await, and initial renderer black acknowledgment before control. Explicit Launch starts slide1. Process/sender loss and window/close invoke synchronous identity-fenced retirement before independent native shutdown, even if an Auto timer, resolver, black ACK or target pipe is stuck. Current Console faults also retire immediately. Lifecycle-hook failures/unresolved returns cannot gate shutdown. Stop/close admissions are reserved before callbacks so recursive shutdown shares the same barrier.

Every owned sender generation gets a new RossTalkSession/private URL, stopped renderer epoch and explicit Launch requirement. One actual stage flight remains owned across generations even after cancellation; no successor decoder bypasses it. A returned candidate is not last-good until the accepted controller deckId matches. Retirement captures accepted content/mode before revoking media. Failed Reload retains accepted content; source removal does not invalidate immutable cached bytes. Raw output, paths, URLs and capabilities never enter public status.

Normal native stop owns termination; presentation retirement does not race a premature Console EOF against taskkill. Bootstrap/Console faults may end their own lifetime pipe independently. Close starts native shutdown in the same synchronous turn, then waits owned cleanup/initial session construction but not an uncooperative staging settlement. Partial/failed stops remain retryable and prevent replacement. Late work cannot activate a newer epoch.

## Evidence and remaining gates

Local profile12/12, runtime/filesystem/config6/6 and new retirement/reentrancy7/7 tests pass. Full baseline293:277 Linux passes/16 Windows-only skips. Real TCP/Chromium tests exercise playback, timers, Reload/last-good, offline restart, fresh URL/black, window fences and ignored staging across generations; their native child/Console boundary is explicitly simulated. Existing SPX/OGraf and actual Windows private Console/NDI foundations remain protected. Integrated real Windows runtime+private Console+NDI proof and final-head CI are still pending. No first user-testable release or stadium compatibility claim.

Rollback removes this opt-in runtime/profile/config and restores hook-free launcher/supervisor behavior; default service semantics and operator data stay separate. Next gates: integrated Windows output evidence, operator Game Day/controller wiring, agreed source fixtures/importer, diagnostics/preflight/soak, licensed reproducible distribution and evaluation installation checklist.
