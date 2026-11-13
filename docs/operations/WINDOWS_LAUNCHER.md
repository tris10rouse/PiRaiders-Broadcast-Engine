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
    { "name": "spx", "executable": "C:/Program Files/nodejs/node.exe", "args": ["server.js"], "cwd": ".", "health": { "protocol": "spx-http", "port": 5656 } },
    { "name": "casparcg", "executable": "C:/CasparCG/Server/casparcg.exe", "args": [], "cwd": ".", "health": { "protocol": "casparcg-amcp", "port": 5250 } }
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

## Endpoint health diagnostics

The optional per-service `health` settings in the example enable loopback endpoint checks. Existing configurations without them still launch, but emit `not-configured` after process spawn; they never claim endpoint readiness. Set ports to the actual SPX HTTP and CasparCG AMCP ports. Protocols are service-specific: `spx-http` and `casparcg-amcp`. Only literal `127.0.0.1` (default) or `::1` hosts are accepted; no URLs, DNS names, credentials, redirects or remote addresses. `timeoutMs` defaults to 1000 and is bounded to 50–5000 milliseconds. An invalid configured probe fails validation before any process starts.

The SPX check performs only GET `/api/v1/version`, validates HTTP 200 and SPX vendor/product/version identity, and discards hostname/id/rootFolder metadata. The CasparCG check sends only `VERSION\r\n` and validates its two-line AMCP reply; it never sends playback or output commands. Both cap response sizes at 16 KiB (HTTP headers and body separately), impose an absolute deadline despite dribbling responses, and close their own connections. No stadium equipment is contacted.

Structured `service-health` log events have `scope: loopback-endpoint` and one of these statuses: `starting`, `ready`, `degraded`, `unhealthy`, `not-configured`, `stopping`, `stopped`. Default checks run every 2 seconds after the previous probe settles, with a 10 second startup grace and three-failure threshold. The first failure after readiness reports degraded immediately; threshold failure reports unhealthy. A successful later check restores ready. Only state changes are logged, using fixed failure codes rather than response bodies or raw connection errors.

A ready **endpoint** proves that a matching service answered locally. It does not prove that the listening endpoint belongs to the logged PID (which on Windows identifies the containment host), that templates rendered, that NDI is sending/discoverable, or that a receiver/board is connected or on air. Readiness is diagnostic only: it never kills/restarts a service or changes the production window.

Probing begins only after an OS process-spawn event. Every process generation and window stop invalidates/aborts prior probes, including late results and delayed events from replaced supervisors. Health polling never shares the production-window reconciliation queue and shutdown never awaits a stuck probe. Failed process termination reports unhealthy/SHUTDOWN_FAILED until a confirmed retry, rather than stopped on request alone.

Automated verification includes real local HTTP/TCP simulators for protocol, framing, malformed/oversized replies, connection refusal, absolute timeout and cancellation; mocked OS/clock lifecycle races; and actual SPX startup under isolated temporary settings. These tests do not start CasparCG or an NDI sender. Final Windows CI remains required, including actual SPX startup under JobHost.
