# Persistent Windows application parent

This increment adds a trusted Node API and developer CLI. It is not the default packaged launcher or an evaluation release. SPX stays alive across events; event runtimes own their Caspar/private presentation/RossTalk services separately. The workstation operator uses Game Day. The Daktronics iPad operator never sees this UI.

## Acceptance

- Require an existing bounded, stable SPX configuration with an explicit valid port; do not generate or rewrite operator configuration.
- Refuse a foreign occupied port before starting anything. Open only the fixed numeric-loopback Game Day URL after a fresh startup HMAC proves possession of the current owned child's secret.
- Fence the exact child/generation immediately before browser dispatch and after its asynchronous completion; synchronous ready observers, crashes, delayed replies and late browser completion cannot authorize a replacement generation.
- Bound startup, HTTP headers/body and total probe time, including continuously arriving bytes and an ignored browser opener. Close submits native stop immediately and retains failed ownership for retry.
- On Windows, use the real kill-on-close JobHost. Verify application close and parent death, including descendants, in Windows CI. Preserve default standalone SPX and legacy launcher behavior.

## Developer entry

Run from a prepared checkout with the existing machine/catalog policy described in GAME_DAY_BACKEND.md and the same SPX config referenced by `spxConfigFile`:

```text
node scripts/piraiders-app.cjs C:\PiRaiders\machine\piraiders-app.json
```

The default machine path is `<appRoot>/config/piraiders-app.json`. Optional `--no-browser` retains all startup ownership checks and leaves browser opening to the caller. Node22+ and the built Windows JobHost are required for default native activation. This entry is intentionally not yet selected by the development ZIP's existing command file; the packaging increment must explicitly include it and test the extracted artifact. Do not copy a development checkout into production.

The parent owns exactly one supervised SPX service, not a fake event sender. It supplies a fresh 32-byte secret through the owned process environment on each start. The secret never crosses HTTP or enters argv, URLs, public status or logs. Startup uses a fresh random nonce and exact bounded JSON HMAC response. This proves key possession under the owned child lifetime; it does not prove OS socket/PID enumeration, output readiness or hardware reception.

The requested URL is `http://127.0.0.1:<configured-port>/game-day`. Default Windows browser dispatch uses shell-free `rundll32.exe` with that fixed URL after proof. Browser failure keeps the service available and reports `BROWSER_OPEN_FAILED`; the CLI prints the credential-free local URL. Process output is discarded while JobHost's lifetime input stays open. Existing SPX login remains authoritative for operator controls. Closing the browser tab leaves the application running; the parent process/CLI owns shutdown.

The API exposes `loadAppSettings`, `PersistentAppLauncher.start({browser})`, `snapshot()` and retryable `close()`. Explicit Node-only dependency boundaries support tests; no environment/profile switch enables an uncontained production spawner. Port/probe errors use fixed categories. Restart rotates proof, rechecks ownership and does not reopen the browser. Exhausted restart budget faults and the CLI shuts down. SIGINT/SIGTERM request up to three bounded close attempts; kernel containment covers parent loss independently of graceful JavaScript cleanup.

## Evidence and remaining gates

Focused Linux tests exercise actual HTTP/nonces, actual subprocesses, stale-generation observer/restart races, ignored browser completion, foreign endpoints and unchanged config bytes. A separate integration starts the actual SPX server, verifies HMAC/Game Day/session/catalog and shuts it down with the OS boundary explicitly injected. These do not simulate a Windows pass. Two additional native tests run only on Windows: real JobHost close, and actual parent-death removal of the recorded process generations and descendants. Final-head CI is mandatory.

Default browser dispatch, extracted package, actual full nested SPX/event JobHost/Caspar/CEF/NDI output, reproducible component/Mesa setup, diagnostics/preflight/soak and a nonproduction installation checklist remain release gates. Current output proofs use an explicit inherited Mesa environment; this CLI alone establishes no target graphics compatibility. Windows10, external LAN receivers and stadium equipment remain unverified. No binary redistribution, signing, formal release or production deployment is authorized by this increment. Rollback removes this unused entry and its tests; existing launcher and operator data are unchanged.
