# PiRaiders engineering changelog

## 2026-11-13

- PR #3: executable native SPX HTML, EBU OGraf and CasparCG AMCP fixture regressions. Browser/socket boundaries are simulated.
- PR #4: developer-only Windows launcher and bounded process supervision.
- PR #5: isolated production-window policy, explicit timezone offsets and 15-minute default prewarm. The launcher does not yet enforce it.
- PR #6: Windows process-tree shutdown and failure reporting; real Windows parent/descendant termination passed [final CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43445825768) before merge.

- PR #7 launcher integration: required production window, independent SPX supervision, eligibility checks for initial and crash restarts, boundary/poll reconciliation and retryable failed shutdown. [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43447462284) passed on the implementation commit: Windows ran all 47 tests without skips. Process enforcement is not packet-level NDI evidence.
- Reproducible developer setup: `npm run setup`, `npm run check`, `npm test`, Node 22 Ubuntu/Windows CI and preserved upstream documentation.

- PR #8 Windows containment: service trees belong to native kill-on-close Job Objects, assigned before execution. Root/host/launcher failure paths and exact argument forwarding have dedicated Windows tests. The helper built from source and all 57 Windows tests passed in [CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43456474849). The artifact is a containment component only.

- PR #9 service health diagnostics: bounded loopback SPX identity and CasparCG VERSION diagnostics, explicit startup/degraded/recovery states, and generation-safe cancellation independent of window shutdown. Real SPX startup is now exercised with isolated temporary settings; CasparCG health uses a socket simulator. [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43467648825) passed; Windows ran all 87 tests without skips, including real SPX startup through the native host. No endpoint response proves NDI or receiver state.

- PR #10 portable Windows development packaging: tracked SPX runtime/assets/locales, fresh production dependencies, bundled Node/license and native host, one fixed launcher, strict SHA-256 inventory and ZIP checksum. Extracted-ZIP CI exercises actual SPX pages and simulated AMCP window shutdown without global Node. [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43497290240) passed all 91 Windows tests and the complete extracted-archive smoke with bundled Node v22.23.4. This is a development artifact; CasparCG/NDI binaries and unfinished product workflows are not represented as ready.

- [PR #11](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/11) BE-003 transport foundation: explicit numeric sender allowlist and GPI/action mapping, bounded CR/LF decoder and serialized dispatch, disconnect-safe accepted commands, terminal handler-timeout cancellation, fixed diagnostics and an off-air loopback bench. The Windows launcher does not enable a listener; presentation integration and hardware verification remain open. [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43506761902) passed all 114 Windows tests, loopback bench and extracted ZIP smoke on the implementation head.

- [PR #12](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/12) BE-004 slideshow state/timer foundation: immutable ordered deck, Launch-at-1, wrapping, Auto/10-second monotonic timing and reset, explicit cut/fade rendering intent, failure suspension and bounded Stop preemption with retained watchdogs. Real TCP integration exercises command ordering and cancellation using simulated rendering. Native template output, staging and overlays remain open. [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43508893747) passed all 134 Windows tests without skips, loopback bench and extracted ZIP smoke.

- [PR #13](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/13) BE-005 snapshot preparation: actual bounded worker-thread PNG/JPEG decoding, deterministic stable local capture, immutable atomic versions, strict hashed manifests and offline full-decode verification. Pin permissive codecs and preserve notices; explicitly reject APNG/interlaced PNG and DRI/restart JPEG rather than accepting unsupported or truncated content. Windows artifact smoke now covers bundled codec workers and source-independent staged-media load. Watcher/live Reload/rendering integration remains open. [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43536763894) passed 159 Windows tests plus one explicit casefold-fixture skip, and actual extracted ZIP staging/offline decode plus SPX/simulated-AMCP smoke. Corrected the existing SPX fixture teardown race without weakening dedicated force-kill coverage.

No user-testable Windows release or stadium hardware compatibility has been established. Upstream SPX release history remains in RELEASE_NOTES.md.


## November 13, 2026 · Owner media-library design input (America/Chicago)

- Incorporated the supplied Apps Script 2.122.0 media-library architecture into ADR0005, an integration contract, roadmap/backlog, Library/Game Day brief and staging guidance. Sheet rows own event/button meaning and sequence; Drive ID identifies bytes and File Key preserves occurrences. Source access defaults read-only; private documents and source loaded ticks stay separate from audience media/Engine readiness. Generic local snapshot compatibility is retained. Export/auth/order/board/time details and planned R-158/R-168 changes are explicitly distinguished from current storage. No runtime, Google data or external permissions changed.


## Native SPX slideshow rendering increment

- Added passive HTML/CSS/JS image output with real decoding, cut/fade, last-good retention, bounded cancellation/transition recovery, full black Stop and audience mode/reload feedback. Real Chromium tests cover pixels/races and existing SPX fixtures; no application/NDI/hardware readiness is claimed.
- Actual iframe tests exposed the existing OGraf INFO_LEFT Update envelope bug; its adapter now forwards flat normalized fields without mutating caller data. Added a regression for visible updates and invalid-data retention.
- Pinned development-only Playwright and added Windows/Ubuntu browser CI with capture provenance; Windows development ZIP smoke checks native template asset delivery.

- [PR #15](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/15) implementation head cb9d260 passed [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43547091647): 13 real Chromium tests on each OS, Windows baseline159 passes/one explicit casefold skip, and actual ZIP template/media/SPX/simulated-AMCP smoke. Final-head CI remains required. Browser tooling stays development-only; headless-only browser installation avoids an unused GUI download.

## Trusted snapshot serving increment

- Added an opt-in, authenticated loopback HTTP boundary for fully verified snapshot images, exact image-only routes, bounded hash-checked reads, private responses and explicit revocation. No default server route or source data migration.
- Added real HTTP failure/recovery tests, actual Chromium rendering from offline staged PNG/JPEG through the Node controller, and extracted Windows ZIP serving probes. The browser automation adapter is test-only; production presentation/control/Reload integration and sender/hardware evidence remain open.
- Fixed a browser regression-test timing assumption: overlay samples use the real animation timeline so screenshot overhead cannot incorrectly fail the required one-second hold. No rendering behavior changed.

- [PR #16](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/16) merged after all four final-head Windows/Ubuntu checks passed: [CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43550650858). Windows171 baseline passes/one explicit NTFS casefold skip,14 Chromium passes, actual extracted ZIP image-serving smoke; Linux163 passes/nine Windows-only skips and14 browser passes.

## Atomic prepared-deck activation increment

- Added explicit controller replaceDeck with immutable admission, occurrence preservation at execution, slide1 fallback, confirmed-render atomic commit and full Auto interval reset. Failed/canceled candidates keep the old deck; stopped preparation stays black; priority Stop and orphan watchdogs remain bounded. The committed deck is exposed read-only.
- Added failure/timer/queue/cancel/Stop regression tests and real Chromium two-snapshot reorder, corrupt-candidate rollback, retry and stopped activation. Candidate preparation, session transport, watcher/Reload overlays and sender/event wiring remain application integration work.

- [PR #17](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/17) implementation ef5c397 passed [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43564163343): Windows185 baseline passes/one explicit NTFS skip, Linux177/nine Windows skips,14 actual Chromium tests each including two-snapshot replacement/rollback, and extracted ZIP smoke. Final documentation-head checks remain required before merge. Condensed the durable checkpoint to distinguish completed components from remaining release integration.

## Managed native presentation increment

- Added opt-in authenticated loopback presentation host joining the existing Node controller, verified offline image serving and native SPX renderer through real Socket.IO. Single program owner; show/black commit acknowledgments; bounded pending work, Stop cancellation, stale-ACK fences, deadlines and stopped-controller recovery. Fixed session error codes remain available without credentials.
- Added inert-by-default native client, fragment-only bootstrap with private per-host cookies, explicit reconnect navigation, disconnect black, and startup black fallback/style validation. Original SPX lifecycle/OGraf remains unchanged outside explicit managed mode.
- Added real HTTP/WebSocket and real Chromium failure/recovery tests; extracted Windows ZIP probe uses real authenticated transport with explicitly simulated frame acknowledgments. Browser tests provide actual painted-output evidence. Launcher, sender, Reload/feedback and event/command orchestration remain separate; no NDI/hardware readiness claim.

- [PR #18](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/18) implementation bbd9297 passed [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43568513062): Windows199 baseline passes/one explicit NTFS skip, Linux191/nine Windows skips;19 actual Chromium tests each. Extracted ZIP proved authenticated host transport with explicitly simulated frame ACKs, separately from real browser pixel tests. Final documentation-head checks remain mandatory.

## Managed Reload and audience feedback increment

- Added one-at-a-time verified snapshot replacement, actual decoder cancellation/preparation deadline, bounded active/candidate registrations and retirement only after frame-RPC settlement. Stop and session changes fence late work; preparation failures retain old playback/timing, render failures retain old deck and suspend Auto.
- Routed Auto/Manual and Reload overlays through acknowledged controller feedback, with bounded coalescing and priority black. Fixed full-queue Auto starvation using one fenced full-interval retry, and replaced timed-out loading feedback with a safe terminal label.
- Added controller, real HTTP/WebSocket and real Chromium failure/recovery coverage; package smoke exercises runtime Reload/feedback with explicitly simulated ACKs. No new dependencies, source schema migration, watcher, sender or default launcher change.
