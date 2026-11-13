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

- Portable Windows development packaging: tracked SPX runtime/assets/locales, fresh production dependencies, bundled Node/license and native host, one fixed launcher, strict SHA-256 inventory and ZIP checksum. Extracted-ZIP CI exercises actual SPX pages and simulated AMCP window shutdown without global Node. This is a development artifact; CasparCG/NDI binaries and unfinished product workflows are not represented as ready.

No user-testable Windows release or stadium hardware compatibility has been established. Upstream SPX release history remains in RELEASE_NOTES.md.
