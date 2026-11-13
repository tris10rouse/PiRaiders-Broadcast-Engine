# PiRaiders Broadcast Engine: Roadmap

Updated: 2026-11-13 · Status: SPX regression and launcher foundations merged; Windows shutdown verified in CI; launcher window integration implemented; Windows job containment verified in CI; endpoint health diagnostics verified on Windows/Ubuntu; portable development packaging implemented; output/release proof pending · Upstream: SPX Solo 1.4.1, `TuomoKu/SPX-GC` at `8bb7ec4e7b969fe7c777d2c2a9b03ed6de3f6981`.

## Product contract

PiRaiders is a Windows broadcast-graphics application built as a maintained fork of SPX Graphics Controller. Retain core SPX HTML/CSS/JS graphics, EBU OGraf packages, projects, rundowns, graphics layers, preview/program, and template Play / Continue / Update / Stop. Use CasparCG for an NDI sender independent of OBS/vMix. An installer or single launcher owns startup and process supervision. The PC operator uses PiRaiders; **the iPad operator sees only the Daktronics All Sport Pro buttons**. The iPad operator receives confirmation solely through brief **audience-visible graphics on the board**, not through an app dashboard or a second interface.

## Pipeline

| Stage | Goal | Definition of done | Status |
|---|---|---|---|
| 0. Foundation | Record architecture, design, agent policies, CI, upstream baseline | Docs and check checks committed; CI verified on PR | Merged; executable fixture CI passing |
| 1. Engine proof | Windows launcher, SPX + CasparCG output, 1080p30 NDI, RossTalk bridge | Bench-tested on target PC; direct NDI reception demonstrated off-air; no vMix/OBS | In progress: supervisor and scheduling policy merged; Windows tree shutdown verified in PR #6; PR #7 integrates window enforcement; job containment verified in Windows CI (PR #8); endpoint health diagnostics verified on Windows/Ubuntu; portable development packaging implemented; output/release proof pending |
| 2. Slideshow | Local nested PNG/JPG decks, deterministic order, cut/fade, commands | Auto 10s configurable; timer resets on manual navigation; bidirectional wrap; overlay indicators | Planned |
| 3. Event preparation | Watched local Google Drive sync folder, staged updates, manual reload | Cache/version validation; hold last frame on reload; rollback; offline operation | Planned |
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
- Changes on synced Google Drive folders stage as new version; warning and manual Reload activation; more detailed Apps Script/Sheet integration deferred until its schema is available. Reminders belong in Apps Script, not PiRaiders.
- UI is a workstation application for the district operator/developer. No PiRaiders UI on the All Sport Pro iPad, and no assumption of live access by the iPad operator.

## Architecture / interfaces

- SPX server: `server.js`, `routes/routes-application.js`, `routes/routes-api-v1.js`, `utils/spx_server_functions.js`.
- Controller: `views/view-controller.handlebars`, `static/js/spx_gc.js`, `static/css/spx_*.css`, `ASSETS/plugins/`.
- Rendering: `views/view-renderer.handlebars`, `static/js/ograf_functions.js`, `utils/playout_casparCG.js`, CasparCG integration, official NDI output.
- Maintain a production-independent `PiRaidersEventManager` interface (future Apps Script adapter) and `LocalDeckProvider` initial implementation.
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