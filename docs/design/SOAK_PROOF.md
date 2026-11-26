# Soak proof

BE-006 item 5e, parts 5e-1 to 5e-3. The soak is **hosted-CI evidence** from a disposable GitHub-hosted Windows runner, never target-PC evidence: the stadium PC, Windows 10, a real board input, NDI over a network and on-air are not tested by it.

## Rules (5e-1, written before any Windows run)

The rules live in `scripts/soak-proof.cjs`; Linux tests in `tests/soak-proof.test.cjs` (this note and the module must state the same numbers; a test checks it).

**Plan.** One synthetic approved button, four hours by default (240 one-minute cycles; at most five hours). Every cycle, at fixed offsets from its start:

| Offset | Action | Transport | The receiver must then see |
|---|---|---|---|
| 0 s | Launch | RossTalk | picture 1 of the published order |
| 8 s | Next | RossTalk | picture 2 |
| 16 s | Next | RossTalk | picture 3 |
| 24 s | Previous | RossTalk | picture 2 |
| 32 s | Reload | RossTalk | picture 2 |
| 40 s | Stop | RossTalk on even cycles, the command route on odd cycles | full-frame black |

Then black until the next cycle. A shorter run is a **check run** of the job itself (`run: "check-run"`, `soak: false`), at least 5 cycles and under four hours; it is never reported as the soak.

**Memory and handles.** Once per cycle the job sums the owned processes' working set and handle count (SPX node, Caspar and their descendants). The baseline is the median of the samples taken in cycles 1 to 3 (cycle 0 is the warm-up and never part of it; at least two of the three must be readable, else `SOAK_BASELINE_UNREADABLE`). Every later sample must stay within:

- working set: baseline plus the larger of 25% of the baseline and 128 MiB (`SOAK_MEMORY_OVER_BOUND`);
- handles: baseline plus the larger of 20% of the baseline and 500 handles (`SOAK_HANDLES_OVER_BOUND`).

Shares are rounded down to whole bytes and handles; exactly the bound passes. A sample that could not be read is counted (`samplesUnreadable`); more than 5% of all samples unreadable fails (`SOAK_SAMPLES_UNREADABLE`). One sample per cycle, in order, or `SOAK_SAMPLES_MISSING`. The bounds catch a steady leak, not a small one: a leak under the floor over four hours passes, and the largest growth is kept so it can be read.

**No lost Stop.** Every planned Stop must be issued on its transport and seen by the receiver as full-frame black within 5 s; Stops issued must equal Stops seen black, else `SOAK_STOP_LOST` with the first lost cycle. Every cycle must complete (`SOAK_INCOMPLETE`).

**Record.** `soakRecord` returns numbers, booleans and fixed words only (no path, command line or machine name) for `result.json`: `evidence: "hosted-ci"`, `targetPcEvidence: false`, `run`, `soak`, cycles planned and completed, Stops planned, issued and seen black (by transport), the slowest Stop to black, baseline, bounds, largest and largest growth, samples taken and unreadable. A broken rule throws with the same record and `rule`.

## Windows job (5e-2)

`.github/workflows/soak-proof.yml` runs `scripts/smoke-soak-windows.cjs` on hosted Windows; its Linux-testable parts are `scripts/soak-windows-job.cjs` (tests in `tests/soak-windows-job.test.cjs`).

- **Triggers.** By hand (`workflow_dispatch`, input `minutes`, default 240; 240 to 300 is the soak, 5 to 239 a check run), job `actual-soak-dispatched`. On a pull request that touches the workflow, the job script, `soak-proof.cjs` or `soak-windows-job.cjs`: job `actual-soak-check-run`, five cycles, `run: "check-run"`. Never on push and never on every pull request.
- **Set-up.** As the activation job: the setup command (run twice) sets up the stores of a synthetic exchange folder; the real application starts in a console of its own; the real routes refresh, review, approve (a window covering the run plus 30 minutes), prepare and activate the button; renderer ready, owned Caspar sender captured, NDI source discovered, black before the first Launch.
- **Manual first.** Exchange buttons start in Auto (10 s). Auto's own advance would race the plan's 8 s offsets (a Reload keeps the Auto deadline), so the job sends Manual once over the command route before cycle 0. The cycles themselves are exactly the plan above.
- **Each step** waits for its offset on the job's clock (never early; the largest lateness is kept, `maxStepLateMs`). RossTalk uses the allowlisted map 1 Launch, 2 Next, 3 Previous, 5 Reload, 8 Stop. Every picture must be seen within 20 s (else the job fails at once, naming cycle and step). A Stop's black is looked for for 8 s, past the 5 s rule, so a slow black is measured and judged by the rules; a black not seen counts as a lost Stop.
- **Sample.** After each cycle's Stop: one listing of every process with its working set and handle count; the application process (same id and start time as started) and its descendants are summed. A gone or replaced application, an unreadable owned process or a failed listing is an unreadable sample.
- **End.** The 5e-1 rules judge the run (`soakRecord`); then Ctrl+C at the console must take every owned process, free the SPX port and leave the receiver quiet. `result.json` keeps the record, every sample (numbers only), the close and the lateness; the received frames of the last cycle are kept (names repeat every cycle). `proof-evidence-privacy.cjs soak` checks the evidence before upload.

## The four-hour run (5e-3)

Not passed yet. Each run is triggered by hand with 240 minutes and recorded here; a failure is never rerun to get green.

| Date (UTC) | Commit | Run · job | Result | Cycles completed | Stops issued · seen black | Samples · unreadable | Largest step lateness | Baseline · largest growth |
|---|---|---|---|---|---|---|---|---|
| 2026-11-26 | `137a5ee` | 45836057451 · 139965117507 | **failed** at cycle 8, step `launch`, `PROBE_CONNECTION`; cleanup could not close the receiver | 8 of 240 | 8 · 8 (none lost) | 8 · 0 | 12 ms | not judged (the job failed before the rules ran) |

First run: set-up 0.4 s, application ready 2.6 s, activated 5.1 s, cycles from 12.7 s; cycles 0 to 7 passed with 49 frames in order. At cycle 8's Launch the job's loopback connection to the test-bench SDK receiver failed with a socket error, and closing the receiver failed too, so the receiver probably exited or stopped listening. Its stderr is discarded and its exit is not recorded, so the cause is unknown; Fix row Q-011. The privacy check passed on the 7 retained frames (artifact `soak-dispatched-evidence`). This is no evidence about the application: the failing part is the test bench's receiver.

## Not shown

The stadium PC, its memory or antivirus, Windows 10, a cold-booted PC, a synced folder, NDI over a network, the board and on-air; a soak longer than five hours; a leak smaller than the floors above.
