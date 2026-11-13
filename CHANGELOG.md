# PiRaiders engineering changelog

## 2026-11-13

- PR #3: executable native SPX HTML, EBU OGraf and CasparCG AMCP fixture regressions. Browser/socket boundaries are simulated.
- PR #4: developer-only Windows launcher and bounded process supervision.
- PR #5: isolated production-window policy, explicit timezone offsets and 15-minute default prewarm. The launcher does not yet enforce it.
- PR #6: Windows process-tree shutdown and failure reporting; Windows runner verification added during Codex takeover. See the PR for final CI evidence.

No user-testable Windows release or stadium hardware compatibility has been established. Upstream SPX release history remains in RELEASE_NOTES.md.
