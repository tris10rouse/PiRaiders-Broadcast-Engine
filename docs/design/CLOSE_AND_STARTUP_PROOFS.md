# Close and startup proofs

BE-006 item 5d, parts 5d-1 to 5d-4. All of it is **hosted-CI evidence** from a disposable GitHub-hosted Windows runner (job `actual-exchange-activation-private-ndi`, script `scripts/smoke-exchange-activation-windows.cjs`) or Linux tests. None of it is target-PC evidence: the stadium PC, Windows 10, a board input and on-air are not tested.

## Close (5d-1, 5d-2)

- 5d-1: the application entry and the launcher close every owned process on SIGINT, SIGTERM, SIGHUP (Windows console close) and SIGBREAK (Ctrl+Break), through one bounded shutdown (`scripts/lib/shutdown-signals.cjs`, `tests/console-close.test.cjs`).
- 5d-2: on hosted Windows the application runs in a console of its own; the online run is closed by Ctrl+C, the cached run by closing the console window. Each close exits within 10 s, every captured process is gone within 10 s more, the SPX port is free. `result.json` keeps `closes`. Details and rules: `EXCHANGE_ACTIVATION_WINDOWS_PROOF.md` step 5, `scripts/console-close-proof.cjs`.

## Default browser (5d-3)

A third start without `--no-browser`: the application reports `browserOpened: true`, the job finds the new browser process by its exact loopback `/game-day` URL, closes it, then Ctrl+C leaves nothing owned. `result.json` keeps `defaultBrowser` (image name only). Details: `EXCHANGE_ACTIVATION_WINDOWS_PROOF.md` step 7, `scripts/default-browser-proof.cjs`.

## Cold start against the warm-up (5d-4)

**What is timed.** The job's first application start, the first on that freshly provisioned runner (no earlier start of the application, Caspar or the NDI runtime by the job; the tools were downloaded and checked by earlier steps). Two figures, both from the moment the job spawns the real application entry (`performance.now()` in the job's own process):

1. `processStartToControllerAvailableMs`: to the application's `controller-available` line on its output (SPX and the Game Day page answer on loopback). Taken when the job's start helper returns, so it also holds the one process listing the helper makes after that line: a little longer than the line itself.
2. `processStartToSenderRunningMs`: to the owned Caspar sender **running**: the Game Day state reports the renderer ready for the activated event and the job has captured the owned Caspar process in the application's tree. That is "NDI sender running", nothing more: the time to the source being discovered by the receiver, a receiver connected, a board input selected or on-air is not counted (`senderDiscoveredCounted: false`, `onAirCounted: false`).

**The bound.** The production window's default warm-up, `DEFAULT_PREWARM_MINUTES` in `scripts/lib/production-window.cjs` (15 minutes; a window that names no `prewarmMinutes` gets it). Either figure over it fails the job with `COLD_START_OVER_WARM_UP`; the failure line keeps the record with `over` (which figure) and the negative margin. Exactly the warm-up passes.

**Upper bound, not the operator's figure.** The second figure includes what the job does between the controller being available and activation: opening a page, the page's own catalog refresh, review, approval, prepare and activate through the routes, and the process capture (up to 15 s). An operator's start does those by hand or not at all (an already approved button), and the renderer then waits for the window's warm-up to begin. So the figure is longer than the machine's own cold start; it is still the right side of the bound to err on.

**What is kept.** `result.json` › `coldStart` (written under the evidence privacy check, `scripts/proof-evidence-privacy.cjs`): `evidence: "hosted-ci"`, `targetPcEvidence: false`, `run: "first-application-start-fresh-runner"`, `senderState: "sender-running"`, `warmUpMs`, the two figures, `controllerMarginMs`, `senderMarginMs`, `withinWarmUp`. Numbers and fixed words only: no path, command line or machine name. The job's `timingsMs` (from the proof's own start) stay as before.

**Recorded (hosted-CI evidence, not target-PC evidence).** PR #109's head `03348f0`, job `actual-exchange-activation-private-ndi` (job 139864357367, 2026-11-26, GitHub-hosted `windows-latest`): process start to controller available **1,749 ms**, to sender running **8,991 ms**; warm-up 900,000 ms; margins 898,251 ms and 891,009 ms. One run; runner speed varies.

**Not shown.** A cold boot of the PC (the runner's OS was already up), antivirus first-scan costs of a district image, a slower disk or CPU, Windows 10, the Drive-synced folder, or the second and later starts (the cached start's `timingsMs` show those only as job timings). Whether the stadium PC fits inside its warm-up is unmeasured: the first target-PC start should record the same two figures by hand.

Rules and Linux tests: `scripts/cold-start-proof.cjs`, `tests/cold-start-proof.test.cjs` (the bound equals the production window default; margins; exactly the warm-up passes, one millisecond over fails; missing, negative or out-of-order times refused; the job takes the spawn time before its first start only and keeps `coldStart` in `result.json` and on the failure line).
