# Exchange activation proof on hosted Windows

BE-006 item 5a (parts 5a-1 to 5a-3). Job `actual-exchange-activation-private-ndi` in `.github/workflows/full-app-proof.yml`; script `scripts/smoke-exchange-activation-windows.cjs`; route steps `scripts/exchange-activation-routes.cjs`; fixture `scripts/exchange-activation-fixture.cjs`; evidence check `scripts/proof-evidence-privacy.cjs`.

## What it proves

On a disposable GitHub-hosted Windows runner, with the real application entry (`scripts/piraiders-app.cjs --no-browser`), pinned CasparCG with app-local CI Mesa, and the pinned private NDI runtime:

1. A synthetic exchange folder (three full-frame 1920 x 1080 pictures, PNG and JPEG, three colours in a fixed published order), a journal with its confirmed binding and an empty approval list made as a setup step, before the application starts.
2. Through the real Game Day routes, in operator order: catalog refresh, events, selections, review, approve (a window that contains now, prewarm 0), the approved list, prepare, activate. Every route answer is checked to name no private path.
3. The renderer reports ready; the owned Caspar process is identified; the pinned NDI SDK receiver discovers the source.
4. Full-frame black before Launch; Launch on the page, Next over allowlisted RossTalk, Next and Previous over the command route: the receiver sees the pictures in the published order (fresh frames, stable source identity, 1920 x 1080, BGRA/BGRX); Stop on the page: full-frame opaque black for at least 1.5 s.
5. Closing the application takes every owned process with it; the receiver then sees no connection for 1.5 s; SPX's config file is unchanged.

## What it does not prove

Same-machine CI evidence only. Not Windows 10, not the stadium PC, not a synced or linked Drive folder, not NDI over a network, not a board input, not on-air. Sender running, source discovered and receiver connected are what is shown; board input selected and on-air are not. Hardware compatibility is not established by this job. It also does not cover setup by an operator command (5b), recovery from faults (5c), cold-start or console close (5d) or a long run (5e).

## Evidence kept (5a-3)

The job uploads `build/exchange-activation-proof-evidence` for 14 days. Allowed there: lower-case `<name>.png` and `<name>.json` files directly in the folder, nothing else.

- The received synthetic frames (`exchange-*.png`), written by the SDK receiver.
- `result.json` on success: the routes walked, frame names and counts, provenance hashes of the pinned tools, timings, the source commit SHA and the explicit "not tested" flags. No paths.
- `failure-page.json` on failure only: the Game Day page's visible text (at most 4000 characters), written only when it names no private path. It replaces the earlier failure screenshot: the screenshot's pixels could show a path that no check can read, and the page is synthetic, so its text says as much.
- The failure line on the job log carries fixed codes, counts and timings only.

**The check.** `scripts/proof-evidence-privacy.cjs` lists every entry. An entry outside the allowed names (a folder, a receiver `.partial` leftover, any other type) or a file whose bytes name a private path fails. Private paths: the proof folder (`build/exchange-activation-proof`), the exchange folder and every private store inside it (journal, approvals, cache, runtime, catalog), the proof tools folder and Caspar's folder, also by real path. A name is matched in any letter case, with either separator, JSON-escaped, and as UTF-8 or UTF-16 bytes, non-ASCII letters included. The check reports entry names and fixed reasons, never the matched text, and removes the offending entries.

It runs three times: in the proof after `result.json` is written (a violation fails the proof with `EVIDENCE_NAMES_PRIVATE_PATH`), in the proof's failure path (offenders removed; the failure line carries `evidenceViolations`), and as its own workflow step with `if: always()` just before the upload (fails the job and removes offenders, so the upload stays clean even when the proof died before its own check).

**Limits.** The check finds paths written as text. It cannot read text drawn into a frame's pixels; the frames are the receiver's copy of synthetic solid colours. Paths outside the listed folders (the checkout root, the NDI runtime folder, the runner's temp folder) are not treated as private: they reveal nothing about a district machine.

## Tests

`tests/proof-evidence-privacy.test.cjs` (Linux): clean evidence passes; each match form fails; disallowed names fail; reports carry no private text; removal; the command line's exit codes; and that the Windows script and the job run the check before the upload. `tests/exchange-activation-routes.test.cjs` runs the same route steps against the real web adapter on Linux. The Windows job itself runs only on GitHub.
