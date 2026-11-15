# PiRaiders Broadcast Engine: Roadmap

Updated: 2026-11-13 · Status: SPX regression and launcher foundations merged; Windows shutdown verified in CI; launcher window integration implemented; Windows job containment verified in CI; endpoint health diagnostics verified on Windows/Ubuntu; portable development ZIP verified on Windows; output/release proof pending · Upstream: SPX Solo 1.4.1, `TuomoKu/SPX-GC` at `8bb7ec4e7b969fe7c777d2c2a9b03ed6de3f6981`.

## Product contract

PiRaiders is a Windows broadcast-graphics application built as a maintained fork of SPX Graphics Controller. Retain core SPX HTML/CSS/JS graphics, EBU OGraf packages, projects, rundowns, graphics layers, preview/program, and template Play / Continue / Update / Stop. Use CasparCG for an NDI sender independent of OBS/vMix. An installer or single launcher owns startup and process supervision. The PC operator uses PiRaiders; **the iPad operator sees only the Daktronics All Sport Pro buttons**. The iPad operator receives confirmation solely through brief **audience-visible graphics on the board**, not through an app dashboard or a second interface.

## Pipeline

| Stage | Goal | Definition of done | Status |
|---|---|---|---|
| 0. Foundation | Record architecture, design, agent policies, CI, upstream baseline | Docs and check checks committed; CI verified on PR | Merged; executable fixture CI passing |
| 1. Engine proof | Windows launcher, SPX + CasparCG output, 1080p30 NDI, RossTalk bridge | Bench-tested on target PC; direct NDI reception demonstrated off-air; no vMix/OBS | In progress: supervisor and scheduling policy merged; Windows tree shutdown verified in PR #6; PR #7 integrates window enforcement; job containment verified in Windows CI (PR #8); endpoint health diagnostics verified on Windows/Ubuntu; portable development ZIP verified on Windows; output/release proof pending |
| 2. Slideshow | Ordered PNG/JPG decks, cut/fade, commands and passive native SPX output | Auto 10s configurable; timer resets on manual navigation; bidirectional wrap; audience overlays | State/timers merged; real Chromium renderer/lifecycle/captures verified on Windows/Ubuntu in PR #15; merged with final-head Windows/Ubuntu CI; managed presentation transport implementation verified on Windows/Ubuntu in PR #18; launcher/control wiring pending |
| 3. Event preparation | Sheet-selected ordered Board media, ID-resolved local bytes, staged updates and manual reload | Correct year/event/button membership and sequence; cache validation; last-frame hold/rollback; offline operation | Generic local snapshots and restricted HTTP delivery verified; atomic controller replacement implementation verified on Windows/Ubuntu in PR #17; ordered provider and application activation planned |
| 4. Scheduled lifecycle | Read event metadata, prepare in advance, transmit in production window | No NDI off-window, pre-roll configurable, manual overrides, recovery after reboot | Planned |
| 5. Integrated UI | SPX-preserving controller plus Game Day, Library, diagnostics | User-approved mockup; original SPX template/rundown workflows regression-tested | Structure approved; SPX integration planned |
| 6. Production hardening | Install/update, Windows auto-start, logs, security, long-run stability | 4h soak, disconnect/reconnect, rapid RossTalk, offline + cache corruption tests | Planned |
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
