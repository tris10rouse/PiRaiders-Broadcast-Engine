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

## Windows job (5e-2) and the four-hour run (5e-3)

Not built yet. The job is triggered by hand, not on every pull request.

## Not shown

The stadium PC, its memory or antivirus, Windows 10, a cold-booted PC, a synced folder, NDI over a network, the board and on-air; a soak longer than five hours; a leak smaller than the floors above.
