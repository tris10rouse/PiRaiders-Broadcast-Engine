# Codex engineering checkpoint

Updated 2026-11-13. GitHub is authoritative: inspect master and open PR heads/CI before continuing. Do not infer merge from this checkpoint being on a branch.

## Ownership and setup

The owner confirmed the previous ChatGPT **Build PiRaiders Engine** task is paused. Repository access and connected GitHub login were verified as tris10rouse with admin/push permission. A real exclusive lease acquisition succeeded through sole-parent commit and non-force expected-head ref update. Each future session must acquire its own unique owner/fence; never reuse a prior run's lease. Coordination HEAD/lease must be read pinned to one exact SHA. Stop all writes if another unexpired owner exists.

Linux development setup is working. `npm run setup` installs locked dependencies without lifecycle scripts, syntax-checks sources and runs all discovered test suites. Node 22 is the Windows/Ubuntu CI runtime. See docs/operations/DEVELOPMENT.md for cloud configuration and credential limitations. CLI auth failed, but GitHub connector acquisition, publication and merge worked; no owner credential action is needed to continue via connector. Master branch metadata now confirms it is unprotected with no required status checks (2026-11-13); the administration endpoint remains unreadable. Check all final-head CI jobs and pin expected head when merging.

An hourly **Develop PiRaiders Windows release** Codex automation was created in this thread with inherited environment selection and lease-respecting instructions. The tool confirmed enabled scheduled execution; this does not mean continuous background work or prove any future run succeeded. Do not resume the old ChatGPT task. Pause the new task when the first honest user-testable Windows release is ready.

## Completed and current work

- PRs #3, #4 and #5 are confirmed merged: SPX/OGraf/AMCP runtime fixtures, supervisor foundation and isolated window policy.
- PR #6 was corrected and merged at 09ac4e57d366e9d6082a9c1f68c29b83785237e5 after final-head Windows and Ubuntu CI passed: https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43445825768. Real Windows test-created parent/descendant processes terminated; no CasparCG or hardware output tested.
- PR #7 implements launcher integration plus reproducible setup: https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/7. Implementation commit 6a17ed14d8c0533d57d541d46fc03520e87a7ae7 passed Windows and Ubuntu CI (https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43447462284), including all 47 Windows tests without skips. PR #7 is confirmed merged at 1ad4c9547e80621b4273a9695b1b2566b8a3f981 after final commit Windows/Ubuntu CI passed: https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43447831274. Acceptance and rollback are in the backlog and launcher docs. Runtime keeps SPX separate from CasparCG, requires a schedule, checks each initial/retry/spawn path, reconciles boundaries and clock changes, and retries failed stops. Diagnostics distinguish spawn request from successful process spawn; neither means NDI ready.
- Local final validation: `npm run setup` installed 316 packages and passed checks/tests; after adding the second OS integration test, `npm run check && npm test` passed syntax checks for 23 files and 45 tests with two explicit Windows-only skips on Linux. Final Windows/Ubuntu CI must be inspected on the PR head.
- Automated tests cover schedule/clock/stop failures at mocked OS boundaries; Windows-only tests additionally exercise real process-tree termination and launcher process orchestration using harmless Node stand-ins. Linux skips those tests explicitly.
- The independent ProductionWindowGate helper remains exported; LauncherRuntime directly applies normalizeWindow/senderAllowed so every supervisor restart can be gated. Neither helper is evidence of packet-level NDI deadlines.

## Next release work

1. Finish/verify any open launcher integration PR against its final commit, including Windows `npm run setup`. Merge only after all jobs pass and review findings are resolved.
2. Current increment adds native Windows Job Object containment (ADR 0002), default contained process adapter, Framework compiler build, and real Windows tests for service-root crash, host-only kill, launcher-only kill, EOF, argument/cwd forwarding and invalid startup. Inspect its open PR and final Windows CI first; do not infer validation from source alone. Assignment-denial failure injection and real CasparCG nested-job validation remain unverified.
3. Before release add health/readiness checks, controlled graceful shutdown and persistent logs/diagnostics. Non-Windows shutdown currently proves signal dispatch only.
4. Establish a reproducible Windows application package/build artifact with one user-facing launcher. Select and document legal CasparCG/NDI distribution and exact versions; prove local moving graphics and source identity in a nonproduction Windows environment. GitHub Windows runners do not establish Windows 10 target-PC behavior or hardware compatibility.
5. Continue safe testable BE-003 RossTalk framing/source allowlist and BE-004 slideshow state/timer lifecycle, then staged immutable media/reload, event adapter and SPX-preserving UI. Keep broader tasks unchecked until their acceptance gates are satisfied; BE-001 still lacks full browser/project/import coverage.
6. Never touch live stadium equipment. NDI packet timing, direct D8VIDEO-P/DMP input and stadium routing require explicit off-air evidence. First release must include honest installation/test checklist and remaining hardware limitations, then pause autonomous work for owner evaluation.

Continuation prompt: Read AGENTS.md, locking protocol and this checkpoint from current master; inspect exact coordination HEAD and lease, acquire a unique exclusive lease atomically or stop writes. Resume unfinished PRs first, verify final CI, then implement the next safe acceptance-tested release increment. Keep roadmap/backlog/changelog/checkpoint current and release the lease on exit.
