# PiRaiders engineering changelog

## 2026-11-13

- PR #3: executable native SPX HTML, EBU OGraf and CasparCG AMCP fixture regressions. Browser/socket boundaries are simulated.
- PR #4: developer-only Windows launcher and bounded process supervision.
- PR #5: isolated production-window policy, explicit timezone offsets and 15-minute default prewarm. The launcher does not yet enforce it.
- PR #6: Windows process-tree shutdown and failure reporting; real Windows parent/descendant termination passed [final CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43445825768) before merge.

- PR #7 launcher integration: required production window, independent SPX supervision, eligibility checks for initial and crash restarts, boundary/poll reconciliation and retryable failed shutdown. [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43447462284) passed on the implementation commit: Windows ran all 47 tests without skips. Process enforcement is not packet-level NDI evidence.
- Reproducible developer setup: `npm run setup`, `npm run check`, `npm test`, Node 22 Ubuntu/Windows CI and preserved upstream documentation.

- Windows containment increment: service trees belong to native kill-on-close Job Objects, assigned before execution. Root/host/launcher failure paths and exact argument forwarding have dedicated Windows tests. The helper builds from source during Windows setup and is a component artifact only.

No user-testable Windows release or stadium hardware compatibility has been established. Upstream SPX release history remains in RELEASE_NOTES.md.
