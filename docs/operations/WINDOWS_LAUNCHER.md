# BE-002 Windows process launcher foundation

This is a **developer-only process supervisor**, not an installer or an NDI proof. Do not run it on the stadium PC until the production plan and off-air test are approved.

## Configuration

Create an untracked file at `config/piraiders-launcher.json`:

```json
{
  "productionWindow": {
    "start": "2026-11-13T19:00:00-06:00",
    "end": "2026-11-13T22:00:00-06:00",
    "prewarmMinutes": 15
  },
  "services": [
    { "name": "spx", "executable": "C:/Program Files/nodejs/node.exe", "args": ["server.js"], "cwd": "." },
    { "name": "casparcg", "executable": "C:/CasparCG/Server/casparcg.exe", "args": [], "cwd": "." }
  ]
}
```

Paths must be adjusted to the actual local installation. The executable path can be absolute. The `cwd` property is relative to the repository root. The launcher validates the complete configuration before starting any service. Exactly one SPX and one CasparCG service are required. SPX runs for the launcher lifetime; CasparCG starts only from the prewarm boundary through the exclusive production end. Each initial/crash restart checks the current clock. The launcher hides child console windows, records lifecycle events and performs up to three restarts in a 60-second window. Ctrl+C requests supervised shutdown. Windows shutdown uses shell-free `taskkill.exe /PID <pid> /T /F`, waits for the command, and reports failures with a nonzero launcher exit status. Concurrent Stop requests share one completion promise. CLI shutdown retries up to three times with one-second delays; repeated signals share cleanup. Exhausted failures log an unknown process state and manual PID recovery instructions. On other systems shutdown currently confirms SIGTERM dispatch only. A failed termination remains visible and retryable; no replacement sender starts while its predecessor has an unconfirmed stop. It does not set CasparCG channels, configure NDI, or establish readiness.

Run from the project root with Node 22: `node scripts/piraiders-launcher.cjs config/piraiders-launcher.json`. Use actual event dates and explicit timezone offsets. A missing/invalid window fails before SPX or CasparCG starts. Example dates are illustrative and will not open a sender outside their window. Test with non-production processes first. Windows tree cleanup is verified in [PR #6 CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43445825768); CasparCG itself is unverified.

## Automated shutdown validation

Verified in PR #6 on Windows and Ubuntu. Acceptance: fake PIDs never reach real OS termination; Windows taskkill failures are surfaced; Stop is awaited/idempotent; a Windows GitHub runner spawns harmless Node parent/descendant processes and proves both exit. The real process test runs only on Windows; Linux explicitly skips it. A second Windows integration test exercises the real launcher supervisors across an injected-clock prewarm/end boundary: SPX persists, CasparCG stand-in starts only in-window and terminates at end. This is Windows CI OS process evidence, not Windows 10 deployment, CasparCG, NDI or stadium validation.

## Required follow-up gates

- Pin verified Windows Node/CasparCG versions, legal redistribution and CasparCG NDI channel configuration.
- Add dependency-aware startup, health checks and graceful shutdown before forced termination. Unexpected parent crashes can still leave descendants outside supervisor tracking; Windows Job Object containment remains a release gate.
- Prove actual CasparCG/NDI termination timing and zero off-window packets; polling/OS scheduling cannot provide a real-time guarantee. Never launch an external always-on CasparCG/NDI instance alongside the supervised sender.
- Verify 1920x1080p30 moving-pattern NDI locally and later direct D8VIDEO-P reception off-air with operator approval.
- Complete Windows installation, 4-hour soak, failure recovery and log rotation.

Rollback: remove the launcher files; original `node server.js` remains unchanged.
