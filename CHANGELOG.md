# PiRaiders engineering changelog

## 2026-11-16 · Exchange selection integrity

- Added a detached validator that rejects forged selection identities or fingerprints, broken slide order, missing/unused/duplicate asset references and mismatched delivery paths. Repeated slides remain ordered.
- Composed the existing bounded JSON and structural schema gates. Results explicitly leave timing, problem-state, media verification, feed persistence, eligibility and external descriptor context pending; no playback or cache behavior changes.
- Added synthetic failure and real metadata-capture composition tests. Linux baseline passed 508 tests with 27 Windows-only skips; final Windows CI remains required before merge. PR42's fingerprint and Unicode transport prerequisite is verified and merged.


## 2026-11-16 · Detached exchange fingerprint computation

- Added bounded draft0.3.1 canonical JSON, selection IDs and separate playback/metadata fingerprints. Ordered occurrences retain repeated media; label/tick/time metadata changes do not alter the playback hash. No source, cache or output wiring is added; results remain `ready:false`.
- Added Unicode, malformed input, missing/duplicate asset reference, exclusion and size/depth/node regressions. Independent review caught and corrected a UTF16 label-length restriction before publication. Supplied JSON data vectors matched226 hash/canonicalization comparisons without executing attachment scripts.
- PR41's preceding structural schema gate merged with12 passing checks, Windows512 baseline passes/two documented skips, Chromium44/44 and actual source/extracted Windows NDI proof. Software evidence does not establish stadium hardware compatibility or evaluation readiness.


- Corrected the reader transport's UTF16 admission bound for schema-sized supplementary Unicode labels. Actual filesystem capture/identity/digest regression and oversized-binding rejection passed; complete structural/semantic acceptance remains separate.


## Full-app bounded identity observation (BE-002)

PR39 merged01553c0bd88cd60b3092dfc7009976bce8471375 with the identical tested tree85cca2599254d5f4d37b78951b58e565fb208651 after all ten checks. Windows477/479(two documented skips), Chromium44/44, actual async CIM and seven Console captures passed; source/extracted fullapp received eleven frames each. An initial merge request timed out after applying identical content at bd039644; fresh ref/tree/PR-state checks preceded safe reconciliation. PR39 is confirmed closed/merged; no force update occurred.

PR37 final combined9e13c969bfb3cbfe50e592bf7a0d81ddfd244757 passed nine checks but extracted job133236167264 failed CASPAR_CRASH/IMAGE_MISSING after eight frames. Its old sender tree had already been observed gone9/unknown0 and runtime recovered ready; the broad phase does not pinpoint the exact failing read. Preserve this and earlier failures. Metadata is detached from this proof; do not merge or rerun until green.

Acceptance for this focused follow-up: use complete pinned CLI and sender-JobHost captures for full-app sender identity/recovery and parent-loss capture; one original15s total monotonic budget shared across both ownership levels, capped by remaining production-window and outer60s recovery budget. Require the same sender generation after the second capture, retain complete transient sender children for cleanup, reject late synchronous validation, split crash phases and recheck parent termination within the window. Keep strict original identity/opaque-black/frame/unknown/surviving/outer-bench/inventory/real-window bounds. No sender/application runtime change or stadium/hardware claim.

Portable tests cover missing-field recovery, pinned roots, wrong/ambiguous hosts, changed generations, retained cleanup, shrinking shared budgets, persistent unknown, late query/validation, UTC/window clipping and exact parent-loss pin. Final full baseline, source/extracted eleven actual-frame Windows proofs and all required checks remain mandatory. Rollback reverts disposable proof tools. Then merge verified prerequisite, synchronize PR37 via true non-force merge commit and verify final SHA again. Schema successor remains unmounted/unpublished; do not call metadata/schema success a playable import.


Executed root validation before publication: initial parallel baseline486 tests459pass27Windows-only skips/0fail; focused final30 tests29pass/1native-Windows skip, syntax128 plus changed-file checks pass. After adding the final late-validation regression, the parallel487-test run reported457pass/3 existing startup-fixture timing failures/27Windows-only skips: exhausted restart budget APP_STARTUP_TIMEOUT, held-browser stale proof got timeout, and ignored-browser opener was never reached before its deadline. No assertion or product timeout was changed. Controlled SAME full test list at --test-concurrency=1 passed487 tests:460pass27Windows-only skips/0fail. These are different execution conditions, not a claim the earlier failures were fixed. Default-concurrency final CI remains mandatory. The schema candidate's separate43/44 browser failure and terminated Reload-fixture hang remain recorded; an unchanged focused timer diagnostic passed1/1.


## 2026-11-16 · Bounded NDI receiver observation windows

- Discard disconnected or buffered capture evidence and require a full fresh connected run inside the original deadline. Preserve final connection/pixel/duration checks, bound replay history and retain native video release on every path. This changes disposable proof tooling only; actual Windows SDK validation remains required.

## 2026-11-16 · Explicit renderer and extracted application output proof

- Add an optional strict machine-owned Mesa profile with Caspar-only environment overrides and safe missing-library preflight/retry. Preserve inherited defaults, SPX, catalog authority and native event deadlines.
- Add a separate Windows job that builds the genuine development ZIP, launches its unchanged CMD/bundled runtime, preserves every original inventory entry and verifies the eleven received-frame scenarios plus inner-parent cleanup while an outer benchmark remains alive. Both source/extracted app environments remove inherited renderer variables, Node preloads, npm and system Node PATH entries. Native execution is required before merge; no evaluation-readiness or hardware claim.

## 2026-11-15 · Independent prepared-event sender deadline

- Add trusted native clock sampling and one immutable event-wide cutoff shared by every Caspar sender generation. Enforce UTC and boot-clock bounds before execution and during native supervision, including when Node is blocked. Preserve persistent SPX and legacy defaults; terminal expiry and close fences prevent rearming. Portable tests pass; final native Windows verification is required before merge.

## 2026-11-15 · Native NDI failure diagnostics

- Separate the deliberate missing-DLL receiver from active-receiver diagnostics, and identify crash enumeration, selection, termination and recovery failures with fixed safe categories. Native frame/connection, ownership and timeout requirements remain unchanged. Actual Windows verification is required; the two prior master failures remain unresolved.

## 2026-11-15 · Persistent application development ZIP

- Set process-query PowerShell output explicitly to BOM-free UTF8 and add a real Windows Unicode executable-path round-trip regression; this addresses a missing encoding contract exposed by extracted-path validation. Actual final Windows evidence passed in both Foundation runs.
- Resolve expected and observed executable paths before selecting the extracted CLI generation, retaining strict ambiguity/unknown refusals after Windows exposed a raw-spelling mismatch. Portable alias/namespace regression and actual corrected Windows validation pass.
- Explicitly package the persistent parent and machine/SPX examples behind one root CMD. Retain the legacy component CLI and smoke, while adding actual extracted bundled-Node/HMAC/SPX/Game Day and generation-aware parent-death validation with the outer bench root held alive. No component binaries or operator config are bundled. [PR31](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/31) mergedd302ee5 after9 final checks; both actual Windows archives passed startup/Unicode/independent parent-death tests. This remains a development artifact.

## 2026-11-15 · Full application Windows output proof

- Refine the full-app proof to select only directly contained sender roots while retaining same-image subprocesses in cleanup evidence. Add safe fixed assertion labels and precise initial phases after the first Windows run stopped before frames; both corrected final native runs passed.
- Add an actual CLI/SPX/Game Day/default nested JobHost/Caspar/NDI software proof with real browser/TCP controls, eleven SDK frame captures, offline recovery, real window boundaries and active parent-death cleanup. Preserve uncertainty as unknown until confirmed within fixed deadlines. [PR30](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/30) mergedfa62457 after10 final checks, including two actual full-app Windows runs with11 received frames each. Portable proof7/7 passes; extracted artifact and release hardening remain open. No evaluation-release claim.

## 2026-11-15 · Persistent SPX application parent

- Keep generation-admission fixture termination explicitly injected while retaining separate real Windows containment tests. Disposable cleanup observations treat incomplete live CIM fields as unknown, preserve strict identity validation and require confirmed disappearance within the original deadline; fixed reasons/counts aid diagnosis. Final corrected Windows results remain required.
- Add a dedicated Windows parent API/developer CLI that preserves SPX across events, requires existing config and proves current-child startup with fresh HMAC before browser opening. Fence ready observers/restarts and late browser completion, bound startup and close, rotate secrets and retain native stop retry. Add actual SPX integration and Windows-only JobHost/parent-death tests. [PR29](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/29) merged9b93a3e after8 final-head checks; Windows416 baseline passes/two documented skips and44 browser tests pass. Package selection and full nested output proof remain separate.

## 2026-11-15 · SPX-hosted Game Day

- Separate missing/corrupt browser-test response budgets from the deliberately short timeout case, preserving every failure/last-good assertion and production defaults.
- Fix wrap-prone mobile SPX navigation and retain geometry/screenshots before layout assertions. Strengthen disposable Windows cleanup evidence with PID plus exact creation ticks and image, excluding stale parent IDs and distinguishing PID reuse from true survivors; actual final Windows results remain required.
- Add actual event preparation/playback UI and guarded SPX router with local Host/Origin/session/CSRF/CSP boundaries, precise recovery and startup-identity proof. Preserve original graphics navigation/default behavior. Fresh review resolved Stop priority, narrow-layout reachability and403 recovery; real SPX/browser tests cover validated media activation outside prewarm and corrupt replacement retention. [PR28](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/28) merged7b3f437 after8 final-head checks passed, including actual Caspar/Console/NDI and Windows/Ubuntu. Windows application packaging remains open.

## 2026-11-15 · Local Game Day backend

- Add strict bounded machine/catalog policy and a sender-only event manager with stale-selection fences, immutable preparation, retryable cleanup and retained physical-flight barriers. Add trusted source/private-root alias checks and reciprocal source preparation admission across prewarm. Test real files/decode/listener handoff and Chromium/TCP controls with injected native boundaries. [PR27](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/27) merged62e94e9 after all8 final checks, including Windows366 baseline passes/two documented skips and33 Chromium tests. UI/launcher release integration remains open.

## 2026-11-15 · Shared local and RossTalk admission

- Add trusted local bridge/session/runtime commands through the existing TCP queue and priority Stop machinery. Preserve bounded followers, physical callback watchdogs and legacy FIFO; return fixed results without private data. Add mixed TCP/local, reentrant shutdown and actual browser regression coverage. [PR26](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/26) mergeddfc5ce6 after8 final checks, including Windows315 baseline passes/one documented skip and31 Chromium tests. Game Day UI remains subsequent integration.

## 2026-11-15 · Persistent application ownership

- Add trusted sender-only event ownership while preserving standalone defaults. Event startup, health and shutdown omit unowned SPX, including filesystem checks at source/cached preparation and Reload. Retain sender stop failures for retry. New tests keep a real independent Node HTTP service alive through simulated event recovery, window end, close and replacement. [PR25](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/25) mergedf29f69b after all8 final checks passed, including Windows300 baseline passes/one documented skip and29 actual Chromium tests. Game Day UI remains planned.

## 2026-11-15 · Local prepared event runtime

- Add strict local/manual event profiles, generated private Caspar settings and prepared-runtime orchestration. Stage before startup; preserve accepted offline content; create a fresh stopped presentation per sender generation; fence Auto and media before independent window/close/fault shutdown. Add reentrancy-safe lifecycle hooks and unit/real browser integration. Browser tests simulate OS boundaries; both integrated Windows private Console/Caspar/NDI runs received ten actual frames and verified crash recovery, offline cached content, real-clock shutdown and receiver silence. Final diagnostics expose fixed Reload failure categories while preserving accepted content. [PR24](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/24) merged08d75c9 after all nine final-head checks passed; the application evaluation release remains open.


## 2026-11-15 · Private CasparCG control increment

- Add opt-in bounded Windows stdin forwarding with independent EOF detection and a correlated Console AMCP adapter that captures native output privately. Add blocked-input/descendant-cleanup tests and a dedicated actual Caspar/CEF Windows proof. Defaults remain NUL. Both implementation Windows runs passed all seven native cases and seven actual Console/CEF captures, positive-controlled root listener absence, full-frame Stop black and crash recovery. [PR23](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/23) requires passing final-head checks before merge.


## 2026-11-14 · Native NDI validation increment

- Add disposable Windows actual-SDK receiver proof, pinned official runtime preparation, synthetic frame captures, crash/reconnect checks and real-clock window-end drain verification. Both actual Windows implementation runs passed10 received BGRA images, same-receiver crash recovery, Stop black and real-clock sender shutdown followed by drained-buffer silence/zero connections. [PR22](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/22) requires passing final-head checks before merge. Local baseline247 passes/nine Windows skips and actual Chromium27/27 pass. Default launcher and application package are unchanged. No NDI binaries are redistributed.


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

- [PR #19](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/19) implementation4634eed passed [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43592128097): Windows230 baseline passes/one explicit NTFS fixture skip, Linux222/nine Windows skips,23 real Chromium tests each, and extracted ZIP runtime Reload/feedback with explicitly simulated ACKs. Independent final review89/89 passed. Final documentation-head checks remain required.

## Managed RossTalk control increment

- Added opt-in priority Stop through a full queue, bounded repeated-Stop followers, independent orphan callback watchdog/barrier and silent EOF slot cleanup; legacy FIFO/default timeouts stay unchanged.
- Added an owned managed-session facade with explicit synchronous eligibility gate, prepared-snapshot resolver, validated deadline budget and stale-generation/epoch fencing. Actual TCP/browser tests cover frames, overlays, Reload, full-queue Stop and late work; package probe explicitly simulates frame ACKs.
- Recorded exact candidate Caspar/NDI/Mesa pins and unexecuted Windows software-proof plan, including upstream URL logging and all-interface AMCP risks. No binaries installed or compatibility claims; production deployment/network changes remain owner-approved gates.
- Corrected the successful-control fixture deadline under parallel decode load and made diagnostic assertions sequence-aware; dedicated short timeout/fault coverage remains unchanged. Local final baseline249, browser26/26 and package-probe reproduction pass.


Managed control verification: [PR #20](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/20), source a2a47712bd011a984e3bee4ce345ac520dd6d2b8, passed all four Windows/Ubuntu push and pull-request checks: [CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43596957244). Windows248 baseline passes/one explicit NTFS casefold fixture skip; Linux240/nine native Windows skips; actual Chromium26/26 with zero skips on each OS. Real extracted Windows ZIP passed managedRossTalkControl:true alongside media/Reload/SPX/window/process smoke; its frame ACKs remain explicitly simulated. Final documentation-head CI remains required before merge. Default launcher integration and actual CasparCG/NDI frames remain release gates.


PR #20 confirmed merged at4fe470d27e8d50842e06725e2943b9b5a716593d after final sourcedc7067bc1e36ad506a28b0a599641fbcef7fe51a passed all four checks: https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43617817598 . Managed RossTalk priority Stop/session integration is complete at component level; default launcher wiring is still open.


Real Caspar software-proof increment: scripts/prepare-caspar-proof.cjs downloads and hashes the exact Caspar/Mesa pins into a disposable CI directory; no NDI installer, system driver or binary redistribution. scripts/smoke-caspar-windows.cjs uses actual JobHost/LauncherRuntime window containment, actual Caspar/CEF/native managed presentation and real RossTalk. Acceptance: six actual1080p mixed PNG captures (mixer red, Launch red, Next blue, Previous red, Reload green, Stop black), real sender process alive after Stop, complete recorded Caspar/CEF tree gone at window end, persistent SPX stand-in still alive, no known text-log capability persistence. SPX is explicitly a harmless stand-in only in this probe; separate package tests exercise actual SPX. Mesa startup detection is recorded, GL_RENDERER is not. No NDI/Windows10/stadium proof follows. Windows workflow execution is pending; do not mark BE-002 complete or claim a user release. Failure must remain red and be debugged before merge.


PR #21 remains draft while real Windows proof is debugged. Actual Caspar/Mesa startup and one1080p red mixed PNG pass with child-only4.5COMPAT; CEF loads five template assets then bootstrap403 (source87c33, CI43620130276). Caspar's browser flag omits fetch Origin. Added an independently security-reviewed bootstrap-only alternate requiring absent Origin +exactHost/loopback +privateBearer +marker1 +complete literal same-origin/cors/empty Fetch Metadata. Present/wrong Origin, foreign-port and WS checks remain strict. Local backend15/15 and full baseline253 (244 Linux passes/nine Windows-only skips) passed; actual disabled-security Chromium paint passed, full latest browser/Windows verification remains required. Do not merge red checks or claim NDI/user-release readiness.


Initial complete real Windows software proof passed on source1eef2321214807de93ebfd3c1e877e247c5a3ee1 in both [PR CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43621765909) and [push CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43621760382). Actual pinned Caspar/CEF/Mesa produced six verified1080p PNG captures: mixer red, Launch red, Next blue, Previous red, Reload green, Stop black. Stop retained the Caspar process; injected production-window end removed the full recorded real Caspar/CEF tree while persistent SPX stand-in survived. No NDI runtime/consumer, Windows10 target or stadium equipment was tested. Private URLs/raw post-auth native logs were not published.

Final acceptance adds actual JPEG alongside PNG, forced termination of the proven owned Caspar root, native descendant cleanup and bounded supervisor restart, a fresh stopped renderer epoch/black frame, then explicit Launch of the last good deck. Eight capture files and structured origin-proof/referrer-privacy fields are required. This added recovery coverage and all final-head checks must pass before merge; the earlier six-frame proof is not evidence for these new paths.


Real Windows recovery implementation2988969558b5ab336e919e98a6cfe0240be62581 passed both [push CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43622879981) and [PR CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43623042420). Eight actual1080p mixed captures cover PNG/JPEG, controls/Reload, opaque Stop black, forced identity-verified Caspar root termination, descendant cleanup/restart, fresh stopped epoch/black and explicit last-good Launch. Real window-end process cleanup passes with injected policy clock. Matching bootstrap Origin and absence of capability in referrers/logs are verified across both starts. Initial recovery PID assumption was corrected after a retained failing test; no test was skipped to obtain this result. Final documentation-head six-check CI/merge remain mandatory. NDI, Windows10 target and stadium proof remain untested; broader BE-002 and first application release remain open.


## Verified native deadline evidence

PR34 merged9eb7a54 after all nine final checks passed: all five new native Windows cases,440/442 Windows baseline passes(two documented skips),44 browser tests and11 received full-app NDI frame cases. The prepared-event sender now has an independent immutable deadline across sender restarts. This remains development software; extracted actual output and remaining evaluation gates are open.


## 2026-11-16 · Managed Caspar launch-path correction

- A controlled Windows test confirmed that the pinned Caspar binary fails its Unicode config filename argument while the identical ASCII control succeeds. Keep the managed config in its owned event directory, launch with an ASCII basename/private cwd and generate relative paths. Preserve default absolute config generation, SPX/legacy launchers, renderer environment and native event deadline. Final actual Unicode-extracted output must pass before merge.


## Bounded complete-identity capture prerequisite (BE-002)

Metadata PR37 combined source1b2eb561db18bc18dd6283bf8d313253282846ce passed nine final checks, including source/extracted full-app eleven actual NDI frame cases, but Console job133114778383 failed RECOVERY with PROCESS_IDENTITY_UNVERIFIED/IMAGE_MISSING after five captures, before processChecks. Preserve that failure; the exact OS cause is unproven. Do not rerun it until green or merge PR37 while red.

Acceptance for this focused proof-only correction: require one complete current owned process-tree snapshot before destructive actions; pin live JobHost parent/image/generation; retry only missing identity fields under one original15s total capture budget using a monotonic deadline. Malformed, contradictory, wrong-owner, changed-root or persistent incomplete evidence fails closed. Retain previously complete owned generations for strict cleanup; a later complete table may establish an incomplete candidate's absence without inventing a captured identity. Cleanup still requires surviving===0 and unknown===0. Application services and output behavior are unchanged; sampled CIM evidence is not atomic Windows enumeration.

New portable tests cover recovery, persistent unknown, fixed budget/late completion, root ownership, PID reuse, contradictions and strict cleanup. A new native Windows test must execute the real async query and child cleanup. Final-SHA Foundation and actual Console/source/extracted/NDI checks must pass before merge. Then synchronize this prerequisite into PR37 through a non-force merge commit and verify its final SHA again. The detached schema-gate successor remains isolated in /workspace/piraiders-exchange-schema, based on PR37: reviewed four pinned schemas, exact dependencies, seven schema tests/9173 independent comparisons and corrected full490-test baseline(464 Linux passes/26 Windows-only skips), pending publication/native CI. No evaluation-ready release is claimed.


Root verification before publishing: all three candidate hashes inspected; focused process suite25 passes/3 native-Windows skips; complete baseline479 tests,452 passes/27 explicit Windows-only skips,0 failures; syntax127 files passed. Root changed the portable rollback regression's incidental1s elapsed assertion to a5s test watchdog plus shrinking-budget assertion, avoiding a scheduler-speed claim; the actual15s capture budget is unchanged. Independent candidate review/failure paths retained; real async Windows capture and final actual Console CI remain required.




## Verified full-app prerequisite and active metadata capture

PR40 merged62bdbb01b87ab9232c4067d01cbdab18ccb799ab, tested c07814962a5acfecd04dc6350d7ab35772e2ca2e, identical tree85e0670b99432e9f70ba11d8c7d727c31715808f. All ten final checks passed: Foundation43853231415/43853123199; fullapp43853231425; Console43853231652; prepared43853231605; Caspar43853231482; NDI43853231396. Default-concurrency Windows485/487(two documented skips), Chromium44/44; source and extracted each received11 actual NDI cases. Extracted inventory unchanged; receiver quiet1506ms at window end and1508ms after independent parent loss, zero connections. Earlier failures remain recorded; no sender/product changes or underlying OS-cause/hardware claim.

PR37 is synchronized through a true non-force merge commit with this verified prerequisite. Its five explicit implementation/design files remain a detached transport-only reader: bounded fatalUTF8/duplicate-safe four-document capture, explicit feed/epoch/tuple binding, exact delivered manifest digest and one descriptor pinned once, observed filesystem confinement/races, one physical flight/BUSY bound, last metadata-pin retention and immutable monotonic deadline fencing. Every pin/result remains ready:false/semanticValidation:pending. Full schema/V1–V20/JCS/time/assets/cache/durable ledger/UI/output integration remains pending. Preserve local/manual SPX behavior; earlier f01f2dd/1b2eb56/9e13c96 failures are not rerun until green. FINAL combined CI is required before merge.

The cloud exec connection dropped during local synchronization (exec-server recovery timed out after45s); no new combined local result is claimed. Publication uses GitHub-authoritative master40 plus the five unchanged PR37 files, with focused docs updates. CI must run the complete combined tests on the final SHA. GitHub access/lease remain valid; do not request owner tokens or install tools.

Schema candidate remains isolated/unpublished in /workspace/piraiders-exchange-schema: eight focused schema tests including bounded read→four gates,9173 independent comparisons and13-field numeric audit passed. It is not an importer. Retain earlier43/44 browser failure, terminated Reload-fixture hang and local parallel startup timing failures. Test-only corrections there are under validation: fire preparation timeout only after actual blocked I/O admission; assert actual controller scheduling before screenshots and use a fresh connection after the separate startup/prewarm phase. Corrected Reload13/13 passed; corrected browser/full combined/native validation is still pending. No production timeout changed. Workspace outage may prevent local continuation; inspect actual files before assuming a correction exists. Fingerprint delegation delivered nothing due quota.

Next: inspect final PR37 CI, merge only if safe/all passing with identical tested tree; then integrate/publish the reviewed schema increment after its real validation. Complete independent V1–V20/JCS/calendar semantics, persisted feed binding/sequence ledger, ordered verified-asset/schema2 staging and GameDay integration; licensed clean-machine setup, default browser/graceful-close proof, diagnostics/recovery and4h soak remain evaluation gates. First evaluation release NOT READY; no owner upload/secrets/manual routine test required.


## PR37 Windows teardown correction

Combined source b2647e899eba3126ff2c06bdf732c29c4760228f passed its metadata tests, but both final Windows Foundation jobs133259502058/133259472912 failed only in native-fixture after hooks: fs.rmSync returned EBUSY for an owned temporary directory after body process assertions. Each reported503 passes/1failure/2documented skips out of506; retain both failures, no rerun-until-green. Other final checks must still be inspected.

Change only that test fixture removal to awaited fs.promises.rm with recursive:true/force:true and bounded maxRetries10/retryDelay100. This yields for temporary handle release, keeps every PID/process-exit/argv/cwd/ownership assertion and existing process timeout unchanged, and still throws on persistent cleanup failure. No product code/cleanup policy changes. Linux syntax and test-file execution are feasible; its real Windows cases are explicitly skipped locally, so no local native cleanup pass is claimed. New final-SHA default-concurrency Windows and full source/extracted/NDI CI are mandatory before merge. Cloud exec responded again after its transient recovery failure; no environment settings, credentials or network grants changed.


## Detached structural schema gate increment (BE-006)

PR37 merged5977919b0be0ffc33ea97cbc45cf472aca79d098, tested0fe248ac27a29dfefbc3fb5ad7e810fa75e6182e, identical treef196a108954fdddb29c62010c36b6597823d1bfd. All ten final checks passed: Windows504/506(two documented skips), Chromium44/44, source/extracted fullapp11 actual NDI cases each. Foundation43856949358/43856941198 and fullapp43856949371. Its metadata reader remains detached/ready:false; do not rebuild transport or claim a playable importer. PR39/40 verified proof prerequisites are merged; earlier native/teardown failures remain evidence.

Current increment adds the four original pinned draft0.3.1 schemas, a fixed local registry, exact ajv8.20.0/ajv-formats3.0.1, full date-time checks without coercion/defaults/removal, fixed redacted diagnostics and structural-only ready:false results. Equivalent in-memory guarded negation corrects exactly3 default-contains compiler sites without disabling a source clause. Original schema bytes/hashes are preserved across checkout platforms with scoped.gitattributes -text. Independent pinned test-only Python Draft2020-12 oracle is deliberately wired into CI:9173 comparisons in both Ajv allErrors modes;13 numeric declarations audited. Python is not a Windows application dependency; new runtime licenses are MIT except fast-uri(BSD-3-Clause). See EXCHANGE_SCHEMA_GATE.md.

Root and independent review found no structural-gate blocker. Eight focused tests pass, including actual bounded read feeding all four gates;23 reconstructed probe categories remain covered. Final local baseline514 tests:487pass27explicitWindows-only skips/0fail; syntax137 before final comments/attributes. Source hash resources unchanged. Local full browser44 had42passes/2time-out cancellations in existing20s scenarios, not a44/44 claim; retain this and earlier43/44/manual-timer and fixture-hang failures. Default final Windows/Ubuntu/native browser/package/source/extracted CI plus both oracle jobs must pass before merge. No rerun-until-green.

Fixture-only corrections retain assertions and product budgets: serial baseline suite files(inside-suite concurrency tests remain), recursive fixed-library resource copying, controlled deadline callbacks after actual blocked filesystem admission, actual controller nextAdvanceAt assertion before screenshots/configured4s browser interval, fresh TCP after separate prewarm phase, and5s admission for non-stall TCP assertions while explicit stall remains100ms. A raw SPX endpoint bench uses bounded30s cold-module admission/45s overall after controlled source-identical trace became healthy14.762s; persistent launcher's15s limit is unchanged. Earlier10s/15s and514-test failures are recorded. The metadata timeout unit now controls its one logical timer/clock while actual I/O/flight cleanup stays real; separate real-clock late-completion regression remains. These are test determinism changes, not product startup/performance fixes.

Do not connect this gate to GameDay/output yet. Next: independent V1–V20/JCS IDs/fingerprints/context/ordering/reference/eligibility/closed-problem/calendar/DST rules, durable per-feed binding/sequence ledger, unique verified assets/ordered schema2 staging with schema1 compatibility, then product integration. Licensed clean-machine setup, default browser/graceful close, diagnostics/recovery and4h soak remain evaluation gates. Target Windows10/LAN/Daktronics/DMP/stadium compatibility unverified; no live hardware. First evaluation release NOT READY. No owner upload, token or routine manual test needed.
