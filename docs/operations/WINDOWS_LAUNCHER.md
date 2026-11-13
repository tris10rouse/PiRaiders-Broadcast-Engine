# BE-002 Windows process launcher foundation

This is a **developer-only process supervisor**, not an installer or an NDI proof. Do not run it on the stadium PC until the production plan and off-air test are approved.

## Configuration

Create an untracked file at `config/piraiders-launcher.json`:

```json
{
  "services": [
    { "name": "spx", "executable": "C:/Program Files/nodejs/node.exe", "args": ["server.js"], "cwd": "." },
    { "name": "casparcg", "executable": "C:/CasparCG/Server/casparcg.exe", "args": [], "cwd": "." }
  ]
}
```

Paths must be adjusted to the actual local installation. The executable path can be absolute. The `cwd` property is relative to the repository root. The launcher starts both processes, hides child console windows, records lifecycle events and performs up to three restarts in a 60-second window. Ctrl+C requests supervised shutdown. Windows shutdown uses shell-free `taskkill.exe /PID <pid> /T /F`, waits for the command, and reports failures with a nonzero launcher exit status. Concurrent Stop requests share one completion promise. On other systems shutdown currently confirms SIGTERM dispatch only. It does not set CasparCG channels, configure NDI, check readiness, or enforce event windows.

Run from the project root with Node 22: `node scripts/piraiders-launcher.cjs config/piraiders-launcher.json`. Test with non-production processes first. Validate Windows process-tree cleanup and configuration before shipping.

## Automated shutdown validation

Acceptance: fake PIDs never reach real OS termination; Windows taskkill failures are surfaced; Stop is awaited/idempotent; a Windows GitHub runner spawns harmless Node parent/descendant processes and proves both exit. The real process test runs only on Windows; Linux explicitly skips it. This is OS process evidence, not CasparCG, NDI or stadium validation.

## Required follow-up gates

- Pin verified Windows Node/CasparCG versions, legal redistribution and CasparCG NDI channel configuration.
- Add dependency-aware startup, health checks and graceful shutdown before forced termination. A rejected shutdown must remain recoverable; unexpected parent crashes can still leave descendants outside supervisor tracking.
- Implement production-window gating **before** enabling any NDI sender. Do not launch CasparCG as an always-on NDI broadcaster.
- Verify 1920x1080p30 moving-pattern NDI locally and later direct D8VIDEO-P reception off-air with operator approval.
- Complete Windows installation, 4-hour soak, failure recovery and log rotation.

Rollback: remove the launcher files; original `node server.js` remains unchanged.
