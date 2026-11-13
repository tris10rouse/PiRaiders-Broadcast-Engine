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

Paths must be adjusted to the actual local installation. The executable path can be absolute. The `cwd` property is relative to the repository root. Run `npm run setup` on Windows first. It builds `build/windows/PiRaiders.JobHost.exe` from the checked-in C# source using the installed .NET Framework v4 compiler; no compiler or runtime download is attempted. A missing helper fails startup before any service, with no uncontained fallback.

The launcher validates the complete configuration before starting any service. Exactly one SPX and one CasparCG service are required. SPX runs for the launcher lifetime; CasparCG starts only from the prewarm boundary through the exclusive production end. Each initial/crash restart checks the current clock. The launcher hides child console windows, records lifecycle events and performs up to three restarts in a 60-second window. Ctrl+C requests supervised shutdown. Windows service processes run inside separate kill-on-close Job Objects. The native host creates each service suspended and assigns it before execution; descendants cannot break away. Host/service failure and loss of the launcher lifetime pipe close the entire job. Normal Windows shutdown also uses shell-free `taskkill.exe /PID <host-pid> /T /F`, waits for the command, and reports failures with a nonzero launcher exit status. Concurrent Stop requests share one completion promise. CLI shutdown retries up to three times with one-second delays; repeated signals share cleanup. Exhausted failures log an unknown process state and manual PID recovery instructions. On other systems shutdown currently confirms SIGTERM dispatch only. A failed termination remains visible and retryable; no replacement sender starts while its predecessor has an unconfirmed stop. It does not set CasparCG channels, configure NDI, or establish readiness.

Run from the project root with Node 22: `node scripts/piraiders-launcher.cjs config/piraiders-launcher.json`. Use actual event dates and explicit timezone offsets. A missing/invalid window fails before SPX or CasparCG starts. Example dates are illustrative and will not open a sender outside their window. Test with non-production processes first. Windows tree cleanup is verified in [PR #6 CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43445825768); CasparCG itself is unverified.

## Automated shutdown validation

Verified in PR #6 on Windows and Ubuntu. Acceptance: fake PIDs never reach real OS termination; Windows taskkill failures are surfaced; Stop is awaited/idempotent; a Windows GitHub runner spawns harmless Node parent/descendant processes and proves both exit. The real process test runs only on Windows; Linux explicitly skips it. A second Windows integration test exercises the real launcher supervisors across an injected-clock prewarm/end boundary: SPX persists, CasparCG stand-in starts only in-window and terminates at end. [PR #8 Windows CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43456474849) built the host and passed all 57 tests, including job cleanup after root crash, host-only kill, launcher-only kill and lifetime-pipe EOF, plus exact argument/cwd forwarding and invalid executable failure. Linux explicitly skips native OS tests. Assignment denial is handled fail-closed in code but has no deliberately restrictive-job failure test yet. This is Windows CI OS process evidence, not Windows 10 deployment, CasparCG, NDI or stadium validation.

## Required follow-up gates

- Pin verified Windows Node/CasparCG versions, legal redistribution and CasparCG NDI channel configuration.
- Add dependency-aware startup, health checks and graceful shutdown before forced termination. Validate containment with the selected CasparCG build and any child processes that manage their own jobs before release.
- Prove actual CasparCG/NDI termination timing and zero off-window packets; polling/OS scheduling cannot provide a real-time guarantee. Never launch an external always-on CasparCG/NDI instance alongside the supervised sender.
- Verify 1920x1080p30 moving-pattern NDI locally and later direct D8VIDEO-P reception off-air with operator approval.
- Complete Windows installation, 4-hour soak, failure recovery and log rotation.

Rollback: remove the launcher files; original `node server.js` remains unchanged.

## Containment diagnostics and component build

On Windows, logged `starting`/`started` PIDs identify the **native containment host**. `started` confirms host process creation, not service readiness, CasparCG startup, or NDI transmission. The service has no interactive stdin; use its normal SPX/AMCP interfaces. Its stdout/stderr inherit the launcher output. Root exit is propagated only after job cleanup is confirmed. Parent/lifetime-pipe loss reports exit 252, including deliberate EOF after cleanup; forced host termination has OS termination status.

Build just the helper with `npm run build:windows-host`. Windows CI uploads `windows-job-host` after all tests pass. This is a development component artifact, not an application installer or user-testable PiRaiders release. The unsigned helper requires installed .NET Framework v4. The build script removes old output before compiling and publishes the binary only after compilation succeeds; build output is ignored by Git.

The host permits nested Windows jobs (needed by CI and potentially CasparCG), but never requests breakaway. Assignment failure leaves the root suspended, terminates it and fails rather than running it outside containment. Successful cleanup waits for the job's active-process count to reach zero; the supervisor cannot restart a service before that normal host exit. Forced host death uses the kernel kill-on-close fallback; termination completion remains subject to Windows scheduling. See ADR 0002.
