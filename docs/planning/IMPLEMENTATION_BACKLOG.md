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
  - Progress: PR #4 supervisor and PR #5 isolated production-window policy merged. PR #6 adds shell-free Windows tree shutdown; acceptance requires safe mocked fixtures on both OSes and a real Windows runner proving test-created parent/descendant exit.
  - Next: integrate window eligibility into every CasparCG start/restart, retry failed shutdown, add startup health checks and reproduce the Windows build.
  - Known limitation: unexpected parent exit may leave descendants untracked; evaluate Windows Job Objects before release. Non-Windows shutdown currently confirms signal dispatch only.

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
