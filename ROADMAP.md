# PiRaiders Broadcast Engine: Roadmap

## Latest progress · 2026-11-17: decoder performance prerequisite

Full Linux regression passed716 tests with27 explicit Windows-only skips and zero failures; syntax161 and99 focused tests passed. The reviewed change is ready for a focused PR and fresh Windows validation, including its public real500-file source/cache regression. The first evaluation release is still not ready.

The operation-scoped decoder implementation passed99 focused root tests and independent review, including a public real500-file source/cache regression. The same private500-file case now staged in5.86s and verified cache in3.48s under the unchanged60-second cap. Full regression and fresh Windows CI are next. A separate large-image timeout remains explicitly unresolved.

PR51 is verified and merged after all12 final checks passed: Windows722 tests(two documented skips), Chromium44/44 and both source/extracted eleven-state actual output proofs. Source preparation is detached and does not yet enable the exchange provider in Game Day.

The hardened private fixture runner independently exposed a real500-image timeout at the existing60-second maximum. Earlier faster prototype runs remain recorded; this failure blocks claiming that boundary is validated. The next focused change removes per-image worker startup overhead while preserving full decoding, limits, cancellation and physical cleanup. It must pass actual500-image source/offline-cache validation and fresh Windows CI without increasing the cap.

Then resume the explicit provider/runtime bridge and paged PC source selection. Licensed setup, browser/graceful-close proof, diagnostics/recovery, startup headroom and four-hour soak remain. The first evaluation release is not ready. Older entries below record historical states.

## Latest software progress · 2026-11-17: source preparation coordinator

Corrected local verification before publication: full Linux724tests/697pass/27 explicit Windows-only skips/0fail; root focused75/72pass/3native skips/0fail; independent proof43/40pass/3native skips/0fail; syntax156. Proof-helper SHA2565851fcfb36860e49bf836a2d86d3efa1cee0fb1215204b00830acfc82e0d7f46; full-app proofc3656c2f07a3df8f2ec1de4a5c8718d3739286a3886756f2751849bda8b7f125. Source coordinator/test unchanged from initial1496. Fresh final-SHA Windows/all12 checks required; original failed job remains evidence, not a proven diagnosis.

PR51 is draft and blocked by an extracted Windows proof failure during crash-recovery process identity capture. Its Windows baseline passed715 tests(two documented skips) and Chromium44/44; source output proof passed. Preserve the failure and investigate the proof boundary before merging; a passing baseline is insufficient.

A proof-only correction excludes new processes demonstrably older than their reused parent PID while retaining prior incomplete/known ownership obligations and the original deadline. Sanitized diagnostic counts are added; the exact failed Windows process remains unavailable. Corrected final-SHA CI is required, and no runtime deadline or output assertion is weakened.

Root, author and independent reviewer each passed32/32 focused tests (zero skips/failures). Final Linux regression717:690 passed/27 explicit Windows-only skips/0fail; syntax156 passed. New module SHA2562c2fe30ab8e8e82bdfed19db895131c64f2d39dbb2c354ebec1a379b9ee9555a; test64868c274d7bea9c0b38c2d717060a343350a16d1f3b6fe13f23af2f6a752c01. Native Windows/final-SHA all12 checks remain required before merge.

PR50 is verified and merged as `6b3c91902a048d1686b4588bd2b734f636afe525`, with the identical tested tree. All 12 checks passed on corrected source `800b262edd2ebbc3827f55746da9e4c44872135a`: Windows 683/685 tests (two documented skips), Chromium 44/44, and both source/extracted actual Windows output proofs. Initial Windows fixture failures and the separately reproduced ownership defects remain recorded below.

The current BE-006 increment composes independent catalog capture, exact-byte catalog/manifest journal facts and ordered verified caches behind a detached source coordinator. Metadata-only refresh verifies and reuses the existing cache; failures retain prior content. It does not change Game Day, source-provider configuration, playback or confirmed production windows. Final Windows validation is still required for this increment.

Next: explicit source/provider admission and hierarchical/paged PC selection, full stateful source fixtures, licensed clean-machine setup, default-browser/graceful-close proof, diagnostics/recovery, cold-start headroom and four-hour soak. The first evaluation release is not ready. All older progress entries below describe their historical state.

## PR50 validation correction · 2026-11-17

The ordered-snapshot PR remains unmerged. Both initial Windows runs failed five fault-injection cases; the fixture now uses canonical temporary paths and asserts that each intended fault is reached. Separate real-filesystem regressions reproduced and fixed pending-directory ownership bugs. Corrected Linux regression passed 658 tests with 27 Windows-only skips; fresh Windows CI is still required. Source/Game Day coordination and the remaining evaluation gates are unchanged.

## Latest software progress · 2026-11-17: ordered exchange snapshots

PR49's catalog-reader integration is verified and merged. The current BE-006 increment prepares source-ordered image occurrences into an offline schema-2 cache, verifies every physical image, and keeps schema-1 staging compatible. It does not activate media or change output. Linux regression and independent review passed; final Windows CI remains required.

Next: connect accepted catalog/manifest facts and verified snapshots to the source/Game Day coordinator, then run the complete stateful source fixtures. Reproducible clean-machine setup, default-browser/graceful-close checks, diagnostics/recovery, cold-start headroom and a four-hour soak remain release gates. The first evaluation release is not ready.

## Latest software progress · 2026-11-17: validated catalog capture

PR48's raw catalog validator is verified and merged after all12 checks passed, including actual Windows composition and source/extracted output. Current BE-006 work connects it to the bounded reader: independent catalog capture, a feed/epoch-only catalog factory and fresh selected captures carrying their same-byte catalog receipt. Legacy transport behavior remains compatible, and no result authorizes playback. Verified ordered-asset/schema2 staging, complete source integration and59-step acceptance remain next. Clean-machine setup, default browser/graceful close, diagnostics, cold-start headroom and four-hour soak still gate an honest evaluation release.

## Latest software progress · 2026-11-16: independent catalog validation

PR47's local journal is verified and merged after all12 checks passed, including26 actual Windows journal process/filesystem cases. Current BE-006 work validates owned raw feed/catalog bytes independently of selected manifest arrival and computes their exact digests. A real missing-manifest/journal/reopen test retains the accepted catalog floor and rejects a same-sequence fork. The raw validator remains detached; shared reader integration is next, followed by verified ordered assets, complete source integration and59-step acceptance. Clean-machine setup, default browser/graceful close, diagnostics, cold-start headroom and four-hour soak remain evaluation gates. First evaluation release is not ready.

## Latest software progress · 2026-11-16: local exchange journal

PR46's retained feed/selection transition model is verified and merged after all12 checks passed, including actual source/extracted Windows output. Current BE-006 work adds explicit store initialization, bounded hash-linked history and atomic no-overwrite publication with revision/hash comparison. It remains detached from Drive, Game Day, media caches and output. Local process-crash/contention tests pass; actual Windows storage validation remains required before merge. Next: independent validated catalog receipts, verified ordered-asset staging, complete source integration and59-step acceptance. Licensed clean-machine setup, default browser/graceful close, diagnostics, cold-start headroom and four-hour soak still gate an honest evaluation release.

## Latest software progress · 2026-11-16: exchange ledger transitions

PR45's selected-manifest timing gate is verified and merged after all 12 checks passed, including real source/extracted Windows output. Current BE-006 work adds detached, revision-fenced feed/binding/catalog/selection transitions with retained sequence floors and fixed capacity limits. These are uncommitted proposals, not durable storage or source readiness. Next: an atomic no-overwrite journal with real Windows crash/contention tests, an independent validated-catalog receipt, verified ordered-asset staging and complete source integration. Clean-machine setup, default browser/graceful close, diagnostics, cold-start headroom and four-hour soak remain evaluation gates. First evaluation release is not ready.

## Latest software progress · 2026-11-16: selected-manifest timing

PR44 merged problem-state validation with all 12 final checks passing. The current BE-006 timing increment checks the selected manifest's Chicago instants and elapsed broadcast window, preserves unavailable metadata for review and always requires operator confirmation. It adds no source scheduling or output integration. Durable feed/version state, a separately validated catalog boundary, verified ordered-asset staging and complete-candidate integration remain. Clean-machine setup, default browser/graceful close, diagnostics, cold-start headroom and four-hour soak still gate evaluation readiness.


## Latest software progress · 2026-11-16: problem-state semantics

PR43 merged the detached selection-integrity gate after all 12 final checks passed, including real Windows source/extracted output. The next BE-006 increment validates incomplete selections, BOARD diagnostics and bounded limit declarations while preserving contract-permitted representations. Every result remains `ready:false`; source playback is not connected. Chicago timing, durable feed state, verified ordered-asset staging and complete-candidate integration still precede evaluation readiness. Licensed clean-machine setup, default browser/graceful close, diagnostics and four-hour soak remain open.


## Latest software progress · 2026-11-16: selection integrity

The exchange fingerprint prerequisite (PR42) is verified and merged. The next BE-006 increment checks selection identity, ordered occurrences, asset references and paths, and advertised fingerprints after the existing bounded JSON and schema gates. This remains a detached validator with `ready:false`; it cannot activate playback. Problem-state rules, Chicago timing, durable feed state and verified ordered-asset staging still precede source integration. Clean-machine setup, graceful close/default browser proof, diagnostics and soak remain evaluation gates.


## Latest software progress · 2026-11-16

PR41 merged the detached draft0.3.1 structural schema gate after all 12 checks passed; the next BE-006 increment adds bounded safe-integer canonical JSON and selection/playback/metadata fingerprint computation. Computation remains detached and `ready:false`. Semantic validation, the durable feed ledger and ordered verified-asset import still gate Game Day integration. The first evaluation release remains gated by source integration, clean-machine setup, graceful close/default browser proof, diagnostics and soak.


The fingerprint increment also corrects the transport binding's UTF16 admission bound so a schema-sized200-code-point supplementary Unicode label can reach validation without false rejection. It remains bounded and transport-only; no source activation is added.


Updated: 2026-11-16 · Status: actual full-application Windows Caspar/CEF/NDI software proof verified; persistent SPX/Game Day merged; application-entry development ZIP verified; first evaluation release remains gated · Upstream: SPX Solo 1.4.1, `TuomoKu/SPX-GC` at `8bb7ec4e7b969fe7c777d2c2a9b03ed6de3f6981`.

## Product contract

PiRaiders is a Windows broadcast-graphics application built as a maintained fork of SPX Graphics Controller. Retain core SPX HTML/CSS/JS graphics, EBU OGraf packages, projects, rundowns, graphics layers, preview/program, and template Play / Continue / Update / Stop. Use CasparCG for an NDI sender independent of OBS/vMix. An installer or single launcher owns startup and process supervision. The PC operator uses PiRaiders; **the iPad operator sees only the Daktronics All Sport Pro buttons**. The iPad operator receives confirmation solely through brief **audience-visible graphics on the board**, not through an app dashboard or a second interface.

## Pipeline

| Stage | Goal | Definition of done | Status |
|---|---|---|---|
| 0. Foundation | Record architecture, design, agent policies, CI, upstream baseline | Docs and check checks committed; CI verified on PR | Merged; executable fixture CI passing |
| 1. Engine proof | Windows launcher, SPX + CasparCG output, 1080p30 NDI, RossTalk bridge | Bench-tested on target PC; direct NDI reception demonstrated off-air; no vMix/OBS | Actual default CLI/SPX/Game Day/private Console/Caspar/CEF/NDI verified twice in Windows CI (PR30); target-PC/off-air compatibility and evaluation package remain open |
| 2. Slideshow | Ordered PNG/JPG decks, cut/fade, commands and passive native SPX output | Auto 10s configurable; timer resets on manual navigation; bidirectional wrap; audience overlays | Software playback, transitions, feedback, Reload retention and Stop verified in real Chromium and actual received Windows NDI frames; packaging/hardening remain |
| 3. Event preparation | Sheet-selected ordered Board media, ID-resolved local bytes, staged updates and manual reload | Correct year/event/button membership and sequence; cache validation; last-frame hold/rollback; offline operation | Validated local/manual preparation/activation, full decode, offline cache and rollback implemented; ordered Apps Script exchange reader/importer remains open |
| 4. Scheduled lifecycle | Read event metadata, prepare in advance, transmit in production window | No NDI off-window, pre-roll configurable, manual overrides, recovery after reboot | Explicit local/manual production windows and default15-minute prewarm implemented; real short-window shutdown/recovery verified; independent native hung-SPX deadline verified(PR34); source scheduling remains open |
| 5. Integrated UI | SPX-preserving controller plus Game Day, Library, diagnostics | User-approved mockup; original SPX template/rundown workflows regression-tested | Actual Game Day and persistent SPX parent merged (PR28–29); original graphics workflows retained; Library/source adapter and diagnostics/settings remain open |
| 6. Production hardening | Install/update, Windows auto-start, logs, security, long-run stability | 4h soak, disconnect/reconnect, rapid RossTalk, offline + cache corruption tests | Development ZIP/native containment tests exist; persistent entry packaging verified (PR31); reproducible component setup, diagnostics/preflight,4h soak and evaluation checklist remain open |
| 7. Graphics ecosystem | More SPX/OGraf templates, external authoring, data graphics | Compatibility suite and vetted template imports; license review for code reuse | Backlog |

## Decisions locked

- HTML/CSS/JS and OGraf remain first-class rendering formats. Existing SPX functions preserved.
- Top computer runs vMix and DMP is believed to receive its NDI. PiRaiders does **not** route through vMix/OBS. DMP ingestion still needs an actual direct PiRaiders→DMP test.
- Target lower Daktronics Windows PC; top PC a fallback after benchmarks. Startup is one user-facing application experience and may internally manage multiple binaries.
- Idle: do not transmit NDI outside a production window. Default proposed preparation T-4h; proposed NDI T-15m; distinguish initial source warm-up from Launch.
- Launch starts slide 1; Daktronics controls board input + sends RossTalk. Auto advances every 10 seconds by default. Manual Next/Previous resets countdown; Next and Previous wrap; stop clears to black, NDI remains for production window.
- On-board ephemeral audience-visible white bordered AUTO/MANUAL indicator on toggle, bottom right, easing vertically to opacity 0.75, holds 1s, fades to zero. Reload holds last rendered frame and displays small loading spinner, then swaps to new validated package; failure leaves old package and reports a brief safe error.
- Apps Script Sheet rows define school-year/event/Board-button membership and order; Drive IDs identify source bytes and File Keys retain distinct occurrences. Folder changes alone never define a game. Metadata or byte changes prepare a new candidate with warning/manual Reload. The [owner-supplied media contract](docs/design/APPS_SCRIPT_MEDIA_CONTRACT.md) is documented; read-only export/auth/order/timestamp details remain integration gates. Apps Script is the sole Sheet writer; reminders remain there.
- UI is a workstation application for the district operator/developer. No PiRaiders UI on the All Sport Pro iPad, and no assumption of live access by the iPad operator.

## Architecture / interfaces

- SPX server: `server.js`, `routes/routes-application.js`, `routes/routes-api-v1.js`, `utils/spx_server_functions.js`.
- Controller: `views/view-controller.handlebars`, `static/js/spx_gc.js`, `static/css/spx_*.css`, `ASSETS/plugins/`.
- Rendering: `views/view-renderer.handlebars`, `static/js/ograf_functions.js`, `utils/playout_casparCG.js`, CasparCG integration, official NDI output.
- Maintain a production-independent `PiRaidersEventManager` interface with a planned read-only Apps Script event/Board catalog and ID-aware byte resolver. `LocalDeckProvider` remains an explicit local/fixture mode; its filename ordering and path-derived IDs do not define the Apps Script catalog. See [ADR 0005](docs/decisions/0005-apps-script-media-authority.md).
- Keep runtime command/state logic in testable modules; avoid tight DOM-to-network dependencies; fail closed for unsafe remote control; preserve last known-good package.

## Milestone issues to create

1. CI + SPX original behavior baseline and tests; desktop render smoke coverage.
2. RossTalk parser with network allowlist, command log, acknowledgement/latency metrics and simulator.
3. CasparCG native NDI lifecycle: sender warm-up, idle shutdown, source stability after restart.
4. Local slideshow template and transitions; audience-facing state-confirmation overlays.
5. Folder watcher and immutable package staging; manual Reload with last-frame hold.
6. Event selection and bounded schedule-driven activation; manual override.
7. Game Day view in the existing controller, with consolidated readiness indicators.
8. Windows packaging, auto-start, graceful shutdown, restart supervisor, 4-hour soak.
9. OGraf interoperability harness + NoaCG exported-template fixtures and native SPX template regression.
10. Documentation for production setup, backups, incident handling, and external connectivity.

## Risks / verification gates

- SPX Solo's commercial-only API endpoints return 501; integrate through approved core modifications or internal event bus. Do not assume every documented commercial API is available.
- CasparCG/NDI native component licensing and redistribution; Windows 10 resource constraints; DMP receiver actual compatibility and discovery latency.
- SPX fixture regressions, supervisor and production-window policy are merged (PRs #3–#5). They do not establish NDI output, receiver compatibility or release readiness.
- NoaCG Studio / SuperConductor can supply design inspiration. Do not copy AGPL code into the MIT fork without explicit license review.
- `npm run setup` installs locked dependencies without lifecycle scripts, checks syntax and runs all executable test suites. CI uses Node 22 on Ubuntu and Windows.

See [`docs/planning/IMPLEMENTATION_BACKLOG.md`](docs/planning/IMPLEMENTATION_BACKLOG.md) for scoped tasks, acceptance criteria, and hardware gates. GitHub Issues is currently disabled in the fork; enable it later to migrate these tasks to issues.

## Change process

Backlog task / issue → small branch → tests and docs → draft PR → automated CI → evidence (screenshots/test logs) → human review → merge. Keep third-party upstream mergeability. Record ADRs for changes to rendering, packaging, security and data contracts. Save any simulated UI states as clearly labeled prototypes.

## Current engineering increment

BE-003 now has an explicit RossTalk GPI transport boundary, source allowlist, bounded FIFO and loopback bench. It is not enabled in the launcher or connected to playback yet. See [transport scope and recovery](docs/operations/ROSSTALK.md). BE-004 adds a Node-authoritative slideshow state/timer controller with explicit simulated adapter tests and bounded Stop preemption; [controller scope](docs/operations/SLIDESHOW_CONTROLLER.md). BE-005 adds full-decode immutable candidate preparation and offline verification ([scope and restrictions](docs/operations/MEDIA_SNAPSHOTS.md)); it does not activate a deck. Next: actual native SPX slideshow template/render captures, safe Reload/watcher/event integration, presentation/window wiring and authorized off-air sender verification.


Owner media-library architecture (Apps Script 2.122.0) is now incorporated into BE-005/BE-006/BE-007. Source-owned folders/Notes markers are preserved, private documents excluded from audience media, and source loaded ticks remain distinct from Engine/NDI/on-air state. R-158/R-168 source UI changes remain planned. This is a design integration, not a deployed Google connection.

Native slideshow increment adds a separate passive SPX template and real Chromium pixel/lifecycle regressions, including a narrow fix for existing OGraf INFO_LEFT Update forwarding. [Renderer scope and verification](docs/operations/NATIVE_SLIDESHOW.md). The browser owns no deck/auto timer, no source catalog and no sender. Node-to-renderer/media serving, safe Reload activation and real CasparCG/NDI proof remain release gates.

Trusted snapshot HTTP increment: exact registered image URLs, explicit session authorization plus loopback restriction, bounded hash-checked reads, private responses and revocation. Real HTTP/browser/extracted-ZIP verification is required before merge; the default launcher/SPX server remains unmounted until production presentation-session wiring. See [scope](docs/operations/SNAPSHOT_HTTP.md).

PR #16 trusted snapshot HTTP boundary merged at de701cc after final source fc364ec passed [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43550650858): Windows171 baseline passes/one explicit NTFS fixture skip,14 Chromium passes and real extracted-ZIP trusted image serving. Default application route remains unmounted. The next increment adds explicit atomic controller replaceDeck: preserve current occurrence at dequeue (else slide1), last-good failure retention, stopped preparation without output and existing Stop/cancellation/watchdog safety. Production presentation transport and Reload orchestration remain separate.

Atomic replacement implementation head ef5c397 passed [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43564163343): Windows185 baseline passes/one NTFS casefold skip, Linux177/nine Windows skips;14 actual Chromium tests on each OS, including two-snapshot Reload/rollback; extracted Windows ZIP smoke passed. Final documentation-head checks and merge status remain verifiable on [PR #17](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/17). Presentation/session transport and application orchestration remain next.

Managed presentation increment: isolated loopback host reuses native SPX slideshow/controller/verified media, explicit capability bootstrap and per-host private cookie, one renderer, actual frame/black acknowledgments, bounded cancellation/deadlines, disconnect-to-black and stopped recovery requiring explicit Launch. Default SPX/launcher stays unchanged; no sender starts. [ADR0006](docs/decisions/0006-loopback-presentation-session.md), [operations](docs/operations/PRESENTATION_SESSION.md). Next: production candidate/Reload and feedback orchestration, RossTalk/window/event wiring, then real CasparCG/NDI proof.

Managed-host implementation bbd9297 passed [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43568513062): Windows199 baseline passes/one NTFS fixture skip, Linux191/nine Windows skips;19 real Chromium tests each; actual extracted ZIP authenticated host transport with explicitly simulated ACKs passed. Final-head checks/merge remain mandatory. Next coherent increment: one-candidate snapshot activation with generation/reference fencing and ACKed bounded mode/Reload feedback, before control/window wiring.

Managed Reload/feedback increment: one cancellable verified candidate, active/retiring handler references tied to actual frame acknowledgments, stopped preparation, last-good failure retention, ACKed audience feedback in the bounded controller queue, and Auto overload recovery. Default launcher/SPX controller remains unchanged; source watchers, RossTalk/window/event wiring and actual CasparCG/NDI output are next. [Scope](docs/operations/PRESENTATION_SESSION.md). Final Windows/Ubuntu CI and package evidence are required before merge.

Managed Reload/feedback implementation4634eed passed [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43592128097): Windows230 baseline passes/one NTFS fixture skip, Linux222/nine Windows skips;23 actual Chromium tests per OS, and actual extracted ZIP runtimeReloadAndFeedback smoke with simulated ACKs. [PR #19](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/19) final-head checks remain mandatory. Next is selected event/source + RossTalk/production-window integration into one launcher/controller, with diagnostics and actual sender proof.

Managed control increment connects real RossTalk TCP to the native presentation session with explicit eligibility/prepared-snapshot callbacks, priority Stop through queue overload, bounded repeated Stops, retained orphan deadlines and validated end-to-end budgets. Legacy transport remains FIFO by default; default launcher stays unchanged until lifecycle integration. Real TCP/Chromium and extracted-package checks are required. [Control contract](docs/design/MANAGED_CONTROL_PROTOCOL.md). [Pinned real Windows output proof plan](docs/design/WINDOWS_OUTPUT_PROOF.md) records component/security/licensing gates; no Caspar/NDI binary has yet been executed.


Managed control verification: [PR #20](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/20), source a2a47712bd011a984e3bee4ce345ac520dd6d2b8, passed all four Windows/Ubuntu push and pull-request checks: [CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43596957244). Windows248 baseline passes/one explicit NTFS casefold fixture skip; Linux240/nine native Windows skips; actual Chromium26/26 with zero skips on each OS. Real extracted Windows ZIP passed managedRossTalkControl:true alongside media/Reload/SPX/window/process smoke; its frame ACKs remain explicitly simulated. Final documentation-head CI remains required before merge. Default launcher integration and actual CasparCG/NDI frames remain release gates.


PR #20 confirmed merged at4fe470d27e8d50842e06725e2943b9b5a716593d after final sourcedc7067bc1e36ad506a28b0a599641fbcef7fe51a passed all four checks: https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43617817598 . Managed RossTalk priority Stop/session integration is complete at component level; default launcher wiring is still open.


Real Caspar software-proof increment: scripts/prepare-caspar-proof.cjs downloads and hashes the exact Caspar/Mesa pins into a disposable CI directory; no NDI installer, system driver or binary redistribution. scripts/smoke-caspar-windows.cjs uses actual JobHost/LauncherRuntime window containment, actual Caspar/CEF/native managed presentation and real RossTalk. Acceptance: six actual1080p mixed PNG captures (mixer red, Launch red, Next blue, Previous red, Reload green, Stop black), real sender process alive after Stop, complete recorded Caspar/CEF tree gone at window end, persistent SPX stand-in still alive, no known text-log capability persistence. SPX is explicitly a harmless stand-in only in this probe; separate package tests exercise actual SPX. Mesa startup detection is recorded, GL_RENDERER is not. No NDI/Windows10/stadium proof follows. Windows workflow execution is pending; do not mark BE-002 complete or claim a user release. Failure must remain red and be debugged before merge.


PR #21 remains draft while real Windows proof is debugged. Actual Caspar/Mesa startup and one1080p red mixed PNG pass with child-only4.5COMPAT; CEF loads five template assets then bootstrap403 (source87c33, CI43620130276). Caspar's browser flag omits fetch Origin. Added an independently security-reviewed bootstrap-only alternate requiring absent Origin +exactHost/loopback +privateBearer +marker1 +complete literal same-origin/cors/empty Fetch Metadata. Present/wrong Origin, foreign-port and WS checks remain strict. Local backend15/15 and full baseline253 (244 Linux passes/nine Windows-only skips) passed; actual disabled-security Chromium paint passed, full latest browser/Windows verification remains required. Do not merge red checks or claim NDI/user-release readiness.


Initial complete real Windows software proof passed on source1eef2321214807de93ebfd3c1e877e247c5a3ee1 in both [PR CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43621765909) and [push CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43621760382). Actual pinned Caspar/CEF/Mesa produced six verified1080p PNG captures: mixer red, Launch red, Next blue, Previous red, Reload green, Stop black. Stop retained the Caspar process; injected production-window end removed the full recorded real Caspar/CEF tree while persistent SPX stand-in survived. No NDI runtime/consumer, Windows10 target or stadium equipment was tested. Private URLs/raw post-auth native logs were not published.

Final acceptance adds actual JPEG alongside PNG, forced termination of the proven owned Caspar root, native descendant cleanup and bounded supervisor restart, a fresh stopped renderer epoch/black frame, then explicit Launch of the last good deck. Eight capture files and structured origin-proof/referrer-privacy fields are required. This added recovery coverage and all final-head checks must pass before merge; the earlier six-frame proof is not evidence for these new paths.


Real Windows recovery implementation2988969558b5ab336e919e98a6cfe0240be62581 passed both [push CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43622879981) and [PR CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43623042420). Eight actual1080p mixed captures cover PNG/JPEG, controls/Reload, opaque Stop black, forced identity-verified Caspar root termination, descendant cleanup/restart, fresh stopped epoch/black and explicit last-good Launch. Real window-end process cleanup passes with injected policy clock. Matching bootstrap Origin and absence of capability in referrers/logs are verified across both starts. Initial recovery PID assumption was corrected after a retained failing test; no test was skipped to obtain this result. Final documentation-head six-check CI/merge remain mandatory. NDI, Windows10 target and stadium proof remain untested; broader BE-002 and first application release remain open.

## Current BE-002 verification increment · 2026-11-14

PR21 is merged: actual Caspar/CEF mixed pixels and crash recovery passed Windows CI. Native NDI SDK receiver proof is now implemented for isolated Windows CI, including fresh received frames, stable identity/reconnect and a real wall-clock sender window. Both implementation Windows runs passed actual received pixels, same-identity crash recovery and wall-clock shutdown (PR22); final documentation-head checks are required before merge. See [acceptance and limits](docs/design/WINDOWS_NDI_PROOF.md). Default launcher/event integration and the user-testable release remain open.

## Private process control · 2026-11-15

Current BE-002 increment adds opt-in bounded native stdin forwarding and correlated private Console AMCP, with explicit empty TCP controllers. It preserves default NUL behavior and SPX. Real Windows containment/Console/CEF acceptance is in [PRIVATE_CASPAR_CONTROL.md](docs/design/PRIVATE_CASPAR_CONTROL.md); both implementation Windows runs passed native input/failure cleanup and actual private Console/CEF output; final documentation-head CI remains required before merge. This is a prerequisite to PreparedEventRuntime and does not activate the default launcher.

## Local event runtime integration · 2026-11-15

BE-006 now has an opt-in strict local/manual profile and prepared-runtime implementation: actual validated immutable snapshots before binds/spawns, private Console bootstrapping, fresh stopped sessions on sender restart, accepted-deck retention and synchronous epoch/Auto fencing before independent native stop. Default SPX launcher and external Caspar settings are preserved. Unit and real TCP/Chromium integration run locally; integrated Windows Console+NDI proof and final CI remain pending. Game Day UI/source-provider/release integration remains open.


Prepared-event implementation evidence (2026-11-15): PR24 implementation7e27ae6 passed nine CI checks, including combined private Console/Caspar/CEF/NDI Windows runs43665580846/43665578345. Ten actual received images per run cover PNG/JPEG controls, Reload retention, Stop black and offline crash recovery. Real-clock end removed the sender and drained receiver output despite ignored staging settlement; close did not wait for that work. Final diagnostics/documentation head must pass CI before merge. This completes the runtime integration increment, not all BE-006 or the application release. Next: persistent SPX Game Day host with separate event sender ownership, shared command admission, preflight/diagnostics and evaluation packaging. See docs/design/PREPARED_EVENT_RUNTIME.md for scope and limitations.


BE-007 active ownership acceptance (2026-11-15): PR24 merged08d75c9 after all nine final-head checks passed (tested9479108; identical tree). Add trusted Node-only manageSpx:false, default true, so event failures/window end/close cannot take ownership of persistent SPX. Health and shutdown must include actual owned services only; failed sender stop remains retryable without replacement. Validate invalid options before filesystem work; retain canonical cached membership and source/NDI/Caspar preflight while ignoring unowned SPX paths. Test a real independent HTTP process across sender recovery and subsequent events; explicitly simulate native event boundaries. See docs/design/GAME_DAY_INTEGRATION.md for the subsequent shared admission, protected router/UI and packaging plan.


BE-007 shared admission acceptance (2026-11-15): PR25 mergedf29f69b after8 final checks. Add trusted local bridge/session/runtime dispatch through the SAME actual TCP queue, priority Stop, bounded followers and physical callback watchdog; preserve legacy FIFO mode. Invalid/closed/BUSY calls settle fixed private-safe results. Reserve normal/Stop/follower ownership before synchronous observers, and exercise reentrant close/admission, mixed100-command bursts, both Stop directions, ignored callbacks and real native-browser frame regressions. No HTTP/UI is added. Next manager/catalog/app plan is docs/design/GAME_DAY_BACKEND.md; retired physical staging remains a replacement barrier.


BE-007 active local backend acceptance (2026-11-15): PR26 mergeddfc5ce6 after8 final checks. Add bounded machine-owned local catalog and GameDayManager with exact selection/candidate fences, immutable revision, one shared inventory/factory flight, active/prewarm replacement exclusion, confirmed old close before candidate start and retained physical staging/cleanup failures. Native close and shared priority Stop must remain independent of ignored work. SourceRoot/whole private-root canonical checks protect source preparation/Reload; cached startup never probes source. Trusted canPrepare prevents direct TCP Reload overlapping a held factory as prewarm opens. Verify actual files/full decode/TCP/Chromium plus full final-SHA Windows regressions; no HTTP/UI or first-release claim. See docs/operations/GAME_DAY_BACKEND.md.


BE-007 actual web integration (2026-11-15): PR27 merged62e94e9 after all8 checks. Current increment mounts a guarded Game Day page/router inside actual SPX, preserving default routes/login/CORS and original graphics navigation. Acceptance includes exact local Host/Origin/session/CSRF/CSP,4KiB schemas, independently reachable priority Stop, nonoverlapping keyboard/mobile controls, correct session recovery and no producer URL/fake output claims. Test actual SPX prepare/full decode/activation outside prewarm and corrupt-source retention, plus native HTML/OGraf delivery. Initial local syntax107/baseline384/Chromium43 pass; final config-alias/final-SHA Windows checks remain required. Persistent launcher/default package entry, nested real native output, component setup, preflight/soak and first evaluation checklist remain open. See docs/operations/GAME_DAY_WEB.md.


PR28 final-CI recovery (2026-11-15): Windows Foundation/private Console/NDI checks passed on a8aa4d8; Ubuntu exposed a wrapped footer target, and Caspar cleanup failed with numeric-PID-only evidence. Keep PR draft until the single-fragment mobile navigation fix and exact process-generation cleanup evidence pass all final-head checks. Generation proof preserves genuine survivor failures and fixed diagnostic counts; it changes no production containment or timeout. Full application launcher/package and exchange importer remain subsequent release gates.


BE-007 persistent parent increment: dedicated scripts/piraiders-app.cjs owns actual SPX for application lifetime, requires unchanged existing machine/SPX config, proves a fresh owned generation before fixed-loopback browser dispatch, bounds startup/close and preserves failed native-stop retry. Acceptance and rollback are in docs/operations/PERSISTENT_APP.md. Add actual HTTP/SPX tests and native Windows close/parent-death generation evidence; final-head CI required before merge. This is not yet the ZIP command entry or a user-testable release. Full nested application output/component setup, package/install checklist, source exchange importer and BE-008 hardening remain open.


PR28 confirmed merged7b3f437 after tested4e1be730 passed all8 checks with identical tree4fd9b0f6. Foundation43744116238/43744112460 and native43744116246/43744116250/43744116220/43744116237 all passed. Game Day HTTP/UI and generation-aware software proof are integrated; local Chromium44/44 passes. No first Windows evaluation release or target hardware compatibility follows.


PR29 merged9b93a3e after final sourcee0060b8 passed8 checks with identical tree531c203. Windows416 baseline passes/two documented skips, Chromium44/44; actual persistent SPX/JobHost ownership integration passes. Next coherent increment is actual full-application Windows output proof, documented in docs/design/FULL_APP_WINDOWS_PROOF.md; portable5/5 tests are not Windows output evidence. Packaging, independent native deadline, exchange importer and BE-008 release hardening remain open.


PR30 mergedfa62457 after sourcee18e477 passed10 final checks with identical tree3fb1c54. Actual full-application Windows runs43751326206/43751321505 received11 NDI frames each and verified offline recovery, real window/SPX persistence and active parent-death nested cleanup. Next BE-008 increment explicitly packages the persistent entry/examples and validates the actual extracted CMD/SPX path while retaining legacy component smoke. This remains a development ZIP; extracted output, native hung-SPX deadline, source import/setup/preflight/soak and evaluation checklist remain release gates.


PR31 mergedd302ee5 after source1bafbc0 passed9 checks with identical treea623a51. Both actual extracted Windows ZIPs verified the single CMD/bundled Node/HMAC/SPX/Game Day path, Unicode image identity and independent parent-death cleanup. Full output from the extracted artifact, native deadline under frozen SPX, source exchange importer and evaluation setup/preflight/soak/checklist remain open.


## Native NDI proof diagnostic increment · 2026-11-15

Native NDI verification is under investigation: two post-merge master attempts failed at different stages. The current increment adds fixed, private-data-safe failure diagnostics; it does not relax receiver, process ownership or deadline assertions. See WINDOWS_NDI_PROOF.md and the checkpoint.


## Independent native event deadline increment

BE-002/BE-006 acceptance and clock contract: [native event deadline](docs/design/NATIVE_EVENT_DEADLINE.md). The trusted Windows prepared-event sender retains one immutable native elapsed-time cap across sender restarts and enforces it independently of blocked SPX. Portable checks are available; actual final-SHA Windows/native/output/package checks are required before merge.


## Verified native deadline milestone

[PR34](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/34) merged9eb7a54 after final source7460863 passed all nine checks with identical tree9722e81. Windows440/442 passes(two documented skips), Chromium44/44 and all five new native tests passed; full application received11 actual NDI frame cases. Independent prepared-event deadline across sender restarts is integrated. Next: explicit renderer configuration and actual full output from the extracted ZIP, followed by source exchange/setup/preflight/soak and evaluation checklist. See CODEX_CHECKPOINT.md for exact acceptance and evidence limits.


## Active extracted-output increment · 2026-11-16

PR35 checkpoint merged after four passing final checks; PR34 independent native event deadline is integrated. BE-002/BE-008 now adds an optional fixed machine renderer profile and a separate actual extracted-ZIP output job, preserving the source proof. Acceptance: all eleven received-frame/lifecycle scenarios through the unchanged CMD/bundled Node, inherited renderer/preload/PATH removal, exact original manifest preserved, and inner-parent cleanup while the outer benchmark stays alive. Portable results are not native execution evidence; final Windows CI is required. See docs/design/EXTRACTED_APP_OUTPUT_PROOF.md and CASPAR_RENDERER_PROFILE.md.


## NDI proof connection-window follow-up · 2026-11-16

PR37 metadata capture remains detached and unmerged. Its standalone NDI job133103586742 repeated the earlier PRESENTATION/PROBE_RECEIVER_DISCONNECTED failure after mixer-red. This proof-only increment discards disconnected/buffered observations, resets matching evidence and waits within the unchanged frame-command budget. Positive connections, pixels, fresh distinct timestamps, duration and512-frame run limit remain required; a bounded2048-observation history rejects replay without timestamp-order assumptions. Require actual compiled Windows policy and source/extracted/standalone NDI checks at final SHA; no product/hardware fix is claimed from policy tests.


## Bounded complete-identity capture prerequisite (BE-002)

Metadata PR37 combined source1b2eb561db18bc18dd6283bf8d313253282846ce passed nine final checks, including source/extracted full-app eleven actual NDI frame cases, but Console job133114778383 failed RECOVERY with PROCESS_IDENTITY_UNVERIFIED/IMAGE_MISSING after five captures, before processChecks. Preserve that failure; the exact OS cause is unproven. Do not rerun it until green or merge PR37 while red.

Acceptance for this focused proof-only correction: require one complete current owned process-tree snapshot before destructive actions; pin live JobHost parent/image/generation; retry only missing identity fields under one original15s total capture budget using a monotonic deadline. Malformed, contradictory, wrong-owner, changed-root or persistent incomplete evidence fails closed. Retain previously complete owned generations for strict cleanup; a later complete table may establish an incomplete candidate's absence without inventing a captured identity. Cleanup still requires surviving===0 and unknown===0. Application services and output behavior are unchanged; sampled CIM evidence is not atomic Windows enumeration.

New portable tests cover recovery, persistent unknown, fixed budget/late completion, root ownership, PID reuse, contradictions and strict cleanup. A new native Windows test must execute the real async query and child cleanup. Final-SHA Foundation and actual Console/source/extracted/NDI checks must pass before merge. Then synchronize this prerequisite into PR37 through a non-force merge commit and verify its final SHA again. The detached schema-gate successor remains isolated in /workspace/piraiders-exchange-schema, based on PR37: reviewed four pinned schemas, exact dependencies, seven schema tests/9173 independent comparisons and corrected full490-test baseline(464 Linux passes/26 Windows-only skips), pending publication/native CI. No evaluation-ready release is claimed.


Root verification before publishing: all three candidate hashes inspected; focused process suite25 passes/3 native-Windows skips; complete baseline479 tests,452 passes/27 explicit Windows-only skips,0 failures; syntax127 files passed. Root changed the portable rollback regression's incidental1s elapsed assertion to a5s test watchdog plus shrinking-budget assertion, avoiding a scheduler-speed claim; the actual15s capture budget is unchanged. Independent candidate review/failure paths retained; real async Windows capture and final actual Console CI remain required.


## Full-app bounded identity observation (BE-002)

PR39 merged01553c0bd88cd60b3092dfc7009976bce8471375 with the identical tested tree85cca2599254d5f4d37b78951b58e565fb208651 after all ten checks. Windows477/479(two documented skips), Chromium44/44, actual async CIM and seven Console captures passed; source/extracted fullapp received eleven frames each. An initial merge request timed out after applying identical content at bd039644; fresh ref/tree/PR-state checks preceded safe reconciliation. PR39 is confirmed closed/merged; no force update occurred.

PR37 final combined9e13c969bfb3cbfe50e592bf7a0d81ddfd244757 passed nine checks but extracted job133236167264 failed CASPAR_CRASH/IMAGE_MISSING after eight frames. Its old sender tree had already been observed gone9/unknown0 and runtime recovered ready; the broad phase does not pinpoint the exact failing read. Preserve this and earlier failures. Metadata is detached from this proof; do not merge or rerun until green.

Acceptance for this focused follow-up: use complete pinned CLI and sender-JobHost captures for full-app sender identity/recovery and parent-loss capture; one original15s total monotonic budget shared across both ownership levels, capped by remaining production-window and outer60s recovery budget. Require the same sender generation after the second capture, retain complete transient sender children for cleanup, reject late synchronous validation, split crash phases and recheck parent termination within the window. Keep strict original identity/opaque-black/frame/unknown/surviving/outer-bench/inventory/real-window bounds. No sender/application runtime change or stadium/hardware claim.

Portable tests cover missing-field recovery, pinned roots, wrong/ambiguous hosts, changed generations, retained cleanup, shrinking shared budgets, persistent unknown, late query/validation, UTC/window clipping and exact parent-loss pin. Final full baseline, source/extracted eleven actual-frame Windows proofs and all required checks remain mandatory. Rollback reverts disposable proof tools. Then merge verified prerequisite, synchronize PR37 via true non-force merge commit and verify final SHA again. Schema successor remains unmounted/unpublished; do not call metadata/schema success a playable import.


Executed root validation before publication: initial parallel baseline486 tests459pass27Windows-only skips/0fail; focused final30 tests29pass/1native-Windows skip, syntax128 plus changed-file checks pass. After adding the final late-validation regression, the parallel487-test run reported457pass/3 existing startup-fixture timing failures/27Windows-only skips: exhausted restart budget APP_STARTUP_TIMEOUT, held-browser stale proof got timeout, and ignored-browser opener was never reached before its deadline. No assertion or product timeout was changed. Controlled SAME full test list at --test-concurrency=1 passed487 tests:460pass27Windows-only skips/0fail. These are different execution conditions, not a claim the earlier failures were fixed. Default-concurrency final CI remains mandatory. The schema candidate's separate43/44 browser failure and terminated Reload-fixture hang remain recorded; an unchanged focused timer diagnostic passed1/1.


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
