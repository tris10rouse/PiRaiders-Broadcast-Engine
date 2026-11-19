# Operation-scoped image decoder sessions

Schema2 staging and offline verification now reuse one decoder worker per operation instead of starting one worker per image. This addresses an actual500-file preparation timeout without changing source membership, cache format, codecs or resource caps. It does not enable the exchange provider in Game Day.

`createImageValidationSession()` exposes trusted Node methods `validate(buffer, options)`, `close()` and fixed-state `snapshot()`. The worker starts lazily, admits one image at a time with no queue and accepts at most500 requests. Every request owns an increasing ID, dedicated transferable byte copy and fresh format/dimension/pixel/memory limits. Caller buffers remain attached and unchanged. Copy time consumes the same immutable per-image deadline; the timer receives only the remaining budget.

The session uses the existing full PNG/JPEG routines factored into a shared worker core. PNG chunk grammar, CRC, complete zlib stream/checksum/length, pngjs decode and APNG/interlace exclusions remain. JPEG marker/scan/EOI, restart restrictions and strict jpeg-js decode remain. The jpeg-js allocation budget resets per image. The original one-shot validator API, workerData protocol and implementation remain compatible.

Limits remain20MiB per input,8192 per dimension,16777216 pixels and the existing JPEG memory bound. Schema2 sessions retain the10000ms per-image maximum,500-file bound,512MiB source-row quota and coordinator's60000ms overall maximum. Worker heaps remain64MiB old/16MiB young; these are not a total process-RSS guarantee. No decoder, sender or production-window deadline is increased.

## Physical ownership and publication

Any decode, protocol, worker, timeout or abort fault closes admission permanently. Wrong/late IDs cannot acknowledge another image. Concurrent admission rejects instead of queuing. `close()` reserves one idempotent promise before invoking termination and awaits both the termination result and observed worker exit. If termination throws/rejects without an exit, the request/close stay pending and physically busy until exit is observed; an unknown worker is never treated as gone. The outer coordinator may settle logically while retaining that physical flight.

The fixed snapshot distinguishes admission closed, physically closed, busy and retained fault code. An idle fault after the last successful image still blocks publication. Stage awaits close/fault checks before writing its published manifest and renaming; finally waits for known exit, verifies pending-directory ownership and cleans only its own tree. A confirmed-exit close error still permits owned cleanup before the fixed error propagates. Load closes and checks faults before its final cache-identity checks and acknowledgement. Source/root/link/byte/hash/alias/order/quota checks and late-abort immutable-cache behavior are unchanged.

## Verification

Run the portable tests from the repository root:

```
node --test --test-concurrency=1 tests/image-validator.test.cjs tests/image-validator-session.test.cjs tests/exchange-snapshot.test.cjs tests/exchange-decoder-session.test.cjs tests/exchange-source-coordinator.test.cjs
npm run check
npm test
```

Root independently passed99 focused tests with no failures/skips. Author passed67 tests (44 snapshot,14 session,8 unchanged legacy decoder and1 public500-file test); independent review passed66 and then the additive public test separately. Dedicated barrier tests prove no stage/load acknowledgement or publication before close settles, including termination failure with a real live worker held until explicit test release. Controlled timeout callbacks are distinguished from real elapsed deadlines.

The public synthetic regression creates500 distinct8×8 PNG files, real feed/catalog/current/manifest and an explicitly bound local journal. Each coordinator attempt keeps the existing60-second cap; its150-second test watchdog covers both phases and cleanup. It proves ordered500-file staging, unchanged source bytes, one real worker per phase, then full cache verification after source assets are deleted. Source metadata remains available for this metadata-only refresh; this is not a disconnected-Drive startup test. Worker exit is asserted by physical drain; the separate close-barrier tests prove acknowledgement ordering.

Preserve actual initial failures: root's original59-step fixture run timed out on500 images at60043ms; a separate4096² image exceeded its10-second decoder budget and settled after actual termination at14666ms. An isolated same-input500-file baseline reproduced60007ms logical/60301ms physical with valid metadata facts retained but no content acknowledgement. With the session implementation that private input staged in5859ms and fully verified its offline cache in3478ms. The public independent reviewer observed5533ms source/2990ms cache. These are local measured runs with unchanged caps, not hardware or cold-start guarantees. The single4096² timeout is not claimed fixed by removing500 worker startups.

Initial scratch test failures were a missing copied helper and two fault hooks still targeting the obsolete one-shot call. Helpers were copied unchanged and hooks moved to the real session with their failure/cleanup assertions retained. Later termination-rejection and idle-fault findings received real-worker regressions before publication. Full regression and final-SHA Windows/source/extracted tests remain required. Do not publish private fixture data or execute supplied publisher scripts.

No dependency, schema, cache migration, provider/UI, runtime control or hardware change is included. The shared core/session worker must ship with the application libraries; extracted-package tests verify that dependency. Rollback restores the paired worker/core/session/snapshot/test changes together. TargetWindows10, Drive hydration, LAN/stadium compatibility, soak and evaluation readiness remain separate gates.

## 2026-11-19 · JPEG memory caps on the exchange path

The statement above that worker heaps remain 64 MiB old / 16 MiB young, and that the existing JPEG memory bound is kept, is no longer true for sessions. Those values refused every JPEG above about 9 megapixels although the exchange contract allows 16,777,216 pixels.

- The session worker's heap cap is 384 MiB old / 16 MiB young (`IMAGE_SESSION_WORKER_HEAP`). The exchange path passes a fixed counted budget of 512 MB to the JPEG decoder (`EXCHANGE_SNAPSHOT_LIMITS.jpegDecodeMemoryMb`) at source staging and at cache reload. Neither is a caller option. The session's own default budget stays 128 MB for any other caller.
- Later the same day (fence 50): the one-shot validator used by the local-folder path has the same 384 MiB / 16 MiB heap cap (`IMAGE_WORKER_HEAP`), and that path passes the same fixed 512 MB budget at staging and offline reload (`MEDIA_SNAPSHOT_JPEG_DECODE_MEMORY_MB`). The one-shot default budget stays 128 MB for any other caller. Tests: `tests/image-validator.test.cjs`, `tests/media-snapshot.test.cjs`.
- Measured at 4096 x 4096 (Linux, 2 CPUs): counted memory up to 449 MB and worker heap up to 209 MiB (four components, no subsampling); whole-process memory near 1.3 GB at the peak for one such picture. These are caps, not reservations, and still not a total process-RSS guarantee. The 10,000 ms per-picture limit, the pixel, side and byte limits and all PNG handling are unchanged.
- Tests: `tests/image-validator-session.test.cjs` (every layout at 4096 x 4096, a dense picture just under 20 MiB, the limits just above), `tests/exchange-snapshot.test.cjs` (real staging and offline reload), built with `tests/synthetic-jpeg.cjs`. Rollback: revert the two constants and the two call-site lines together with these tests.
