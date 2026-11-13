# Implementation backlog

This file is the interim source of truth for actionable work items. GitHub Issues was disabled on this fork when this foundation PR was created (GitHub returned HTTP 410). If Issues is enabled, migrate each numbered task to a linked issue and keep this document as the high-level index. **Never interpret a checked box as an unverified hardware test passing.**

Follow `ROADMAP.md`, `AGENTS.md`, the approved UI brief, and the SPX-first ADR. Use one focused feature branch/PR per independently testable unit. Mark work complete only with test evidence and a rollback path.

## Agent coordination prerequisite

- [x] **BE-000 · Prevent overlapping hourly AI development sessions**: an isolated GitHub coordination branch with versioned, expiring leases, owner fencing tokens, fast-forward-only atomic ref changes, heartbeat, fail-closed behavior, agent instructions and CI unit tests. Verify actual GitHub claim/release during this PR; GitHub Actions concurrency also serializes CI for the same ref.

## Ordered tasks

- [ ] **BE-001 · Original SPX HTML / OGraf executable regression suite** (Stage 0)
  - Protect native HTML Play/Continue/Update/Stop, projects/rundowns, layer routing, preview, original OGraf import/definition.
  - Use actual fixtures and runtime calls, not only source-level regex checks.
  - Done: automated CI exercises at least one native HTML and one OGraf fixture; genuine failures are reported.
  - Progress: PR #3 merged and fixture CI passed for HTML lifecycle, OGraf lifecycle and AMCP layer routing. Full browser, project/rundown and import coverage remains before this broader task is complete.

- [ ] **BE-002 · Windows launcher and CasparCG NDI proof** (Stage 1)
  - Start/supervise SPX and CasparCG through one Windows launch entry point; maintain native NDI at 1920×1080p30. Avoid OBS/vMix dependencies.
  - No off-event NDI transmission; pre-roll timing configurable. Record benchmark and logs.
  - Done: safe local NDI monitor sees moving pattern, lifecycle tests pass, licenses and packaging documented.
  - Hardware gate: direct D8VIDEO-P ingest needs explicit off-air validation on the actual installation.
  - Progress: PR #4 supervisor and PR #5 isolated production-window policy merged. PR #6 merged after Windows/Ubuntu CI passed, including real test-created Windows parent/descendant shutdown.
  - PR #7 implements software acceptance: required valid schedule before startup; separate persistent SPX and gated CasparCG; 15-minute default prewarm and exclusive end; eligibility rechecked on every launch/restart/late spawn; bounded polling recovers from clock changes; failed shutdown remains retryable and blocks replacement sender; automated failure tests and both OS CI.
  - Evidence: [Windows/Ubuntu CI on implementation commit 6a17ed1](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43447462284); Windows passed all 47 tests, including real launcher window-boundary and tree-shutdown tests using harmless Node stand-ins. Final PR checks must still pass after documentation updates.
  - Next: reproducible Windows packaging, startup preflight and persistent diagnostics; configure and prove CasparCG/NDI output.
  - PR #8 containment acceptance implemented: create Windows services suspended, assign to kill-on-close Job Objects before execution, stop descendants on service-root exit, host death or launcher pipe EOF; never fall back to uncontained startup. Real Windows tests verify these failures separately without relying on taskkill /T, exact argv/cwd forwarding and nonzero invalid-start failures. No CasparCG/NDI claim follows from Node stand-ins.
  - Containment evidence: [https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43456474849](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43456474849) built the native host with the installed Framework compiler and passed all 57 tests on Windows without skips. Root/host/launcher failures, EOF, exact argv/cwd and native startup failure are covered; the workflow retains a component artifact. This is not CasparCG/NDI or Windows 10 target validation.
  - PR #9 health acceptance implemented: optional validated loopback-only SPX identity HTTP and read-only CasparCG VERSION probes; bounded time/bytes and cancellation; process spawn is not endpoint readiness; stale results cannot survive process generation/stop; nonblocking diagnostics cannot delay window shutdown; grace/degraded/failure/recovery and missing-configuration states are explicit. Tests exercise real local HTTP/TCP simulators on both OSes and actual SPX server startup with sanitized temporary configuration; no hardware or NDI readiness claims.
  - Health evidence: [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43467648825) passed on implementation commit 52925cd. Windows passed all 87 tests without skips, including actual SPX server startup via the native host. Linux passed 78 tests with nine native Windows skips. CasparCG is still a local AMCP simulator; no output/NDI/hardware proof follows from these results.
  - PR #10 bundle acceptance implemented: package tracked runtime source/assets/locales, fresh locked production dependencies, installed Windows x64 Node plus its license, and freshly compiled JobHost into a ZIP with one launcher. Exclude real configs, projects/media added by operators, logs, credentials and untracked files. Include a SHA-256 manifest; verify archive after extraction into a path with spaces/Unicode. Smoke tests prove actual bundled SPX and a clearly labeled AMCP Node stand-in through the .cmd launcher and production-window shutdown. Missing configuration and invalid package contents fail closed. This is a development artifact, not a user-testable release or CasparCG/NDI proof.
  - Bundle evidence: [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43497290240) passed on implementation commit 0bdd7cacf7f03f3009e97bc75ccbda9f9f283c95, including all 91 Windows tests and the actual extracted ZIP launcher smoke. Bundled Node v22.23.4 runs with system Node removed from PATH; localized SPX controller/renderer and HTML/OGraf assets respond; the AMCP stand-in stops at real window end while SPX persists, then owned processes terminate. The development ZIP/checksum artifact is retained by the run. This does not prove real CasparCG/NDI or user-release readiness.
  - Known limitation: non-Windows shutdown currently confirms signal dispatch only.

- [ ] **BE-003 · RossTalk control bridge** (Stage 1)
  - Configurable TCP listener, command validation and source allowlist. Map Launch/Next/Previous/Auto/Reload/Stop with deterministic acknowledgements.
  - Done: socket simulator covers framing, malformed packets, rapid presses and reconnects; real Display Studio commands tested off-air.

- [ ] **BE-004 · Generic nested JPG/PNG slideshow template** (Stage 2)
  - Deterministic slide order, Start-at-1, Next/Previous wrap, Auto 10s configurable, manual-navigation timer reset, cut default / fade ~1s default.
  - Audience-visible AUTO/MANUAL indicator lower right: white thin border, rise/fade to max 75% opacity, ~1s hold, fade out. Reload spinner overlays the actual output.
  - Done: state/timer/transition tests and render captures; Stop displays black, NDI stays present until end of production window.

- [ ] **BE-005 · Local synced-folder staging and reload** (Stage 3)
  - Watch configurable Drive Desktop folder, debounce incomplete writes, stage validated snapshots, never replace live files silently.
  - Done: partial-write/corrupt package/offline tests; Reload holds the last valid frame until atomic activation, with rollback.

- [ ] **BE-006 · Event schedule adapter and production window** (Stage 4)
  - Local/fixture event source first; future Apps Script/Sheets adapter; automatic preparation approximately T−4h and NDI warm-up approximately T−15m, both configurable.
  - Support multiple events/day, cancellation, DST, manual event override, and offline cached playback. No reminders/to-do system (owned by Apps Script).
  - Done: schedule simulator + reboot tests; prove zero traffic off-window.

- [ ] **BE-007 · SPX-first UI integration** (Stage 5)
  - Approved structure: Game Day / SPX Graphics / Library / Settings and Diagnostics.
  - Keep original SPX projects/rundowns and HTML/OGraf templates fully operable; separate desktop preview, renderer state, NDI sender state, receiver state and board route.
  - The Daktronics All Sport Pro iPad operator **never uses or sees PiRaiders**; their preprogrammed Daktronics buttons send RossTalk.
  - Done: browser captures at desktop/tablet viewport sizes, keyboard and failure-state checks, HTML/OGraf regression tests.

## Release and broader ecosystem gates
- [ ] **BE-008 · Windows production release hardening**: single installation, signed/distributable package plan, recovery/auto-start, watchdog, 4-hour soak and documented incident rollback.
- [ ] **BE-009 · NoaCG and graphics ecosystem integration**: verify exported SPX/OGraf template compatibility; assess SuperConductor ideas, licensing prior to code reuse.

## Workflow
Backlog item → branch → tests → draft PR → CI → screenshot/log evidence → human review → merge. If GitHub Issues is enabled later, replace each task ID above with its issue link. Production hardware changes always require human approval.
