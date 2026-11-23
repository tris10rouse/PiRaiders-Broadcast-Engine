# Claude handoff

Last updated 2026-11-23 (builder run, lock fence 76; 5b-4 setup command and cached start in the Windows activation job). Keep this to one screen. History lives in `CODEX_CHECKPOINT.md` and `docs/planning/IMPLEMENTATION_BACKLOG.md`; do not read those whole.

## Road to the evaluation build

Size: S = fits one run, M = about 2 runs, L = about 3+ runs. Parts in `docs/planning/IMPLEMENTATION_BACKLOG.md` (top section).

| Part | Size | Why that size | Status |
|---|---|---|---|
| 5a-1 Synthetic exchange folder and setup step for the proof | S | One builder and Linux tests on code that already exists | merged on 2026-11-20 (#77, `bc679a3`) |
| 5a-2 Windows job: real app, approve, prepare, activate, frames in order, Stop black, close | M | New Windows script on the real app and receiver; Windows-only failures show up only in CI | merged on 2026-11-20 (#81, `ca9000f`, all 13 checks green on `f8459cd`) |
| 5a-3 Evidence and privacy checks of that job, design note | S | Reuses the full-app proof's evidence rules | landed by #86 on 2026-11-23 |
| 5b Setup command and cached (offline) startup | L | Split on 2026-11-23 (fence 73) into 5b-1..5b-4 | done with 5b-4 (fence 76) |
| 5b-1 Setup command: source root, feed, journal and approval list once | S | One command and Linux tests on stores that exist | landed by #91 on 2026-11-23 (fence 73) |
| 5b-2 Linked source root: decide, record, test | S | One decision, the reader and setup made consistent | landed by #92 on 2026-11-23 (fence 74): an alias that resolves to the retained spelling is allowed; everything is read through that spelling |
| 5b-3 Offline pins and cached startup on Linux | S | One pin write path, one startup path, Linux tests | landed by #93 on 2026-11-23 (fence 75): `piraiders-setup.cjs --pin-offline`; a pinned button starts cached when the exchange folder is gone (Linux, stand-in runtime) |
| 5b-4 Windows job: setup command and cached start without the exchange folder | S | Changes the 5a Windows job only; Windows-only failures show up only in CI | landed by #94 on 2026-11-23 (fence 76): the job's stores set up by `piraiders-setup.cjs` (twice, second unchanged); after the online run `--pin-offline`, folder moved away, the app restarted plays the same button from the cache in order, Stop black, clean close (hosted Windows, real Caspar/NDI software) |
| 5c Diagnostics and recovery | L | Six distinct states on screen and by command, four tested fault recoveries | not started |
| 5d Close and startup proofs | M | Launcher and close exist; needs default-browser, console-close and cold-start evidence on Windows | not started |
| 5e Four-hour soak | M | A separate long Windows job and recorded memory/handle bounds; one run waits on it | not started |
| 5f Evaluation-ready Windows ZIP | M | Packaging exists; adds source mode, setup command, operator checklist, all checks green | not started |
| Open failing check: browser tests "a late review…" and "a late answer for an earlier event…" failed `HELD_ANSWER_NOT_FINISHED` (Linux push run of `cf91a8c`, job 136447114406; probably also the unnamed Windows `static-contracts` failure on `1819e74`, job 136440648349, not shown) | fix | **Cause found (fence 67):** reproduced locally under load (8 copies on 2 busy CPUs: 7 failures). Chromium's DevTools reported the fully read late answer as failed (`net::ERR_ABORTED`) while the page read every body without an error and Resource Timing recorded the whole download; Playwright's `response.finished()` then never settled. Test-only fix: wait on the browser's Resource Timing record. After: 16 of 16 copies green under the same load. Page code unchanged | fixed: merged on 2026-11-20 (#83; NDI and Caspar proofs are not triggered by a test-only change) |
| Open failing check: full-app proof (`actual-full-app-private-ndi`) failed in SETUP with `RECEIVER_START_TIMEOUT` on master `ca9000f` (job 136463119504, 22 s in, no evidence kept); second time after `bca398f`. Passed on `ee9b12a` | fix | Cause unknown; the SDK receiver did not report started within the proof's bound. Recurring, so it needs its own look (read `scripts/smoke-full-app-windows.cjs`'s receiver start and its bound). Not rerun | recorded |
| Open failing check: NDI software proof (`actual-ndi-sdk-receiver`) failed with `NDI_PROOF_FAILED_CRASH_ENUMERATE` on PR #86's first commit `16f82e8` (job 137453014746) | fix | Cause unknown; #86 does not touch that proof; passed on its final commit `9431ebf`. Not rerun (queue `Q-004`, parked) | recorded |
| Open failing check: Linux `static-contracts`, test "a refresh while the page's own refresh runs is refused" (`exchange-activation-routes.test.cjs:104`, no refresh of two answered 200), on #87's docs-only `f24c359` (job 137467496669) | fix | **Cause found (fence 70):** answers `[409 SUPERSEDED, 409 BUSY]` (reproduced, 2 of 8 parallel copies): the newer refresh overtook the older, then the provider's one slot, still held by the older, refused it. Service fix: the newer waits for the older provider call, then reads; 24 of 24 copies green | landed by #88 on 2026-11-23 |
| Q-006 Game Day page after an overtaken refresh: showed the catalog unavailable while a newer refresh succeeded | S | One browser test, maybe a page fix | landed by #90 on 2026-11-23 (fence 72): reproduced in the browser (stayed unavailable); the page now adopts the newer catalog by the status poll |
| Q-003 wait-checks read GREEN before every workflow had started (PR #86: `GREEN 4 checks`, 10 in all) | S | Builder script and one stubbed test | landed by #89 on 2026-11-23 (fence 71): RUNNING while any workflow run of the commit is unfinished |
| Open failing check: Caspar software proof (`actual-caspar-cef-mixer`) failed at `MANAGED_CEF`, `PROTOCOL_REJECTED`, renderer `DISCONNECTED`, on `cf91a8c` (job 136445042248) | fix | Cause unknown; PR #81 does not touch that proof; passed on `f8459cd`. Not rerun | recorded |

Closed (fence 64): the console proof's START failure, the Linux browser-suite hang and the NDI negative-control failure each passed on two master runs in a row (`fb4a140`, `8f6f06d`, every check green). Causes of the earlier failures remain unknown; the diagnostics from #79 stay in place. **Console START, fence 67:** it failed again on #83's docs-only `6da55bb` (job 136499812400) and #79's line named it: step `PROCESS_CAPTURE`, one PowerShell process query killed at the proof's 15 s bound. #84 (merged, all 13 checks green on `3925d4c`) runs the same query once before the proof with its own 90 s bound (5.8 s on its first run); the proof's bound is unchanged. A CI mitigation: the NDI and full-app proofs' first listings are unchanged.

**Estimate:** remaining sizes 3 M + 1 L = 9 sized runs. Pace from every merged part so far: 16 runs for 14 sized runs = 1.14. 9 x 1.14 + 3 open failing checks (full-app receiver start, Caspar CEF, NDI crash enumerate) = **about 13 runs**.

Parts left · runs left: 4 parts (5c to 5f) + 3 parked fix rows · about 13 runs.

## Run log

| Date (UTC) | Fence | Outcome | Part |
|---|---|---|---|
| 2026-11-23 | 76 | merged (#94) | 5b-4: Windows activation job sets up its stores with the setup command (twice), pins offline, moves the exchange folder away and plays the same button from the cache; Linux test runs the same steps on the real web adapter (7 tests); review: none confirmed |
| 2026-11-23 | 75 | merged (#93) | 5b-3: `--pin-offline` writes offline pins of prepared confirmations (reread before each write); cached startup when the folder is gone and the button is pinned; 6 Linux tests, each of 8 guards removed fails one; review found the scan bound's code hidden, fixed with a test |
| 2026-11-23 | 74 | merged (#92) | 5b-2: linked source root decided (alias allowed when it resolves to the retained spelling; reads go through that spelling); setup answers `source: direct` or `linked`; 3 Linux tests, each guard removed fails one |
| 2026-11-23 | 73 | merged (#91) | 5b split into 5b-1..5b-4; 5b-1: setup command `scripts/piraiders-setup.cjs` (source root, feed, journal and approval list once), 6 Linux tests |
| 2026-11-20 14:44 | 61 | merged | 5a split into 5a-1..5a-3; 5a-1 merged as #77 (all 12 checks green on `abe8904`) |
| 2026-11-20 15:22 | 62 | fix merged (#79) | Merged the handoff note #78; console proof failed again on master `bc679a3`: diagnostics PR #79; its push run hit the browser-suite hang: bounds added to #79; NDI proof failed on master `f89a8b1` (recorded) |
| 2026-11-20 16:51 | 64–66 | merged (#81, #82) | Master green twice: three failing-check rows closed. 5a-2: new Windows job; fixed on the PR a CRLF test failure and the proof's refresh racing the page's own refresh (409 `BUSY`); merged with all 13 checks green; afterwards found two intermittent failures on its middle commits (late-review browser test, Caspar CEF proof), recorded at fence 65 |
| 2026-11-23 | 69 | merged (#86); rows Q-003, Q-004 | 5a-3 merged as `323524b` (all 10 checks green on `9431ebf`). wait-checks printed GREEN with 4 of 10 checks (Q-003). NDI proof `CRASH_ENUMERATE` on #86's first commit (Q-004, parked). Linux refresh test failed on #87 (Q-005, first). Earlier part of this line: | 5a-3: `scripts/proof-evidence-privacy.cjs` checks every retained file of the activation job (allowed names; no proof, exchange or private-store path in any form), in the proof and as a step before the upload; failure screenshot replaced by path-checked page text; design note `EXCHANGE_ACTIVATION_WINDOWS_PROOF.md` |
| 2026-11-23 | 72 | fix (#90, Q-006) | Game Day page after an overtaken refresh: reproduced (stayed on "unavailable"), fixed in the page; browser test fails without it |
| 2026-11-23 | 71 | fix (#89, Q-003) | wait-checks also reads the commit's workflow runs: RUNNING while one is unfinished, RED for a workflow that failed without a job |
| 2026-11-23 | 70 | fix (#88, Q-005) | Linux refresh test: cause found and fixed in the source service (newer refresh waits for the older provider call); Q-006 added from review |
| 2026-11-20 18:22 | 67 | 2 fixes merged (#83, #84) | Master `ee9b12a` green on every check; `ca9000f` had the full-app `RECEIVER_START_TIMEOUT` (recorded). Late-review browser test: cause found and fixed in the test (#83). The console proof failed on #83's docs commit: cause named (first process query over 15 s), warm-up step merged (#84)

## State of master

- Master: #83 (test and docs) and #84 (console proof warm-up, CI only) on `ee9b12a` (#82, every check green). `ca9000f` (#81: the Windows exchange activation proof). Items 1 to 4 and parts 5a-1, 5a-2 are done. On hosted Windows a synthetic exchange button now goes from approval through the real routes to Launch, Next, Previous and Stop with the SDK receiver seeing the pictures in order and then black (job `actual-exchange-activation-private-ndi`, about 35 s of proof). Details: `CODEX_CHECKPOINT.md`.
- Recorded failures, not rerun, cause unknown unless named: the console proof at START on `79ff344` and `bc679a3`; the NDI negative-control receiver on `f89a8b1`; the browser-suite hang on `4845f49`'s push run; the Caspar software proof on `50bb524` (process listing timed out); the four NDI checks on PR #56's first commit (vendor replaced its installer); the prepared-event proof on `398e336`; a Windows baseline `ETIMEDOUT` on `7acbb00`; the launcher-parent `ETIMEDOUT` on `c29407a`; the full-app `RECEIVER_START_TIMEOUT` on `bca398f`; the Windows job-host test on PR #76's first commit.
- First evaluation release: NOT READY. No Windows artifact exists.

## Next, in this order (one increment per run, each on `feature/be-NNN-short-name` with a PR)

From 2026-11-23 the work is done by builders (AGENTS.md › A run) from `queue/`: each part below is a queue file with these words; `queue/ORDER.md` is the order. This list stays as the words those files were made from.


1. Read master's checks on #84's and #83's merge commits; a red one is recorded (cause or "cause unknown"), not rerun.
2. Done (fence 69): 5a-3: evidence and privacy of the activation job. Today it keeps six received frames and `result.json`, and a failure screenshot of the page on failure. Add a check that fails the job if any retained file names the proof folder, the exchange folder or a private store (reuse the route-answer check in `scripts/exchange-activation-routes.cjs`), decide whether the failure screenshot stays, and write `docs/design/EXCHANGE_ACTIVATION_WINDOWS_PROOF.md` (what it proves, what it does not).
3. If the full-app `RECEIVER_START_TIMEOUT` recurs (third time), look at the receiver start before 5b.
4. Then 5b (setup command and cached startup), 5c, 5d, 5e, 5f.

## Open risks

- In source mode the Game Day page refreshes the catalog by itself when it opens. Since Q-005 a second refresh while it runs waits and then reads; the overtaken one answers `CATALOG_REFRESH_SUPERSEDED` and the page defers to status: it shows the catalog unavailable while the newer refresh reads, then adopts its catalog at the next poll (Q-006, browser test). `BUSY` still comes when a review or preparation holds the provider; the page may not word it well. Not tested on the page.
- `tests/windows-job-process.integration.test.cjs` ("CreateProcess failure never runs an existing invalid executable") failed once on hosted Windows on the docs-only PR #76's first commit (job 136322153458): the job host did not exit within the test's 10 s. Cause unknown (a slow scan of the just-written file is possible, not shown). Not rerun.
- **Time.** The 10 s per-picture limit is fixed in code. On a 2-CPU Linux machine the slowest legal pictures found take 5.5 s (dense progressive 4:4:4 JPEG, 14 MB, at the pixel limit) and 3.0 s (16-bit PNG). The stadium PC has never been measured.
- **Memory.** One 4096 x 4096 JPEG needs about 0.7 GB (4:2:0) to 1.3 GB (four components) of process memory at its peak, one picture at a time. How much memory the stadium PC has is unknown.
- The NDI checks run on runtime 6.4.0.2. Add the winget manifest commit to `docs/design/WINDOWS_NDI_PROOF.md` when one exists; a different hash there is a failure, not a detail.
- The prepared-event proof failed once at the offline crash restart on PR #66's first commit, cause unknown; if it fails again, read its evidence artifact (`prepared-event-private-ndi-evidence`) from a place that can download it.
- The console proof now warms the process query first (#84). The NDI, prepared-event and full-app proofs and `windows-production-window.test.cjs` still make a single cold process listing at their captures and can fail the way the Caspar proof and the launcher-parent test did; the production-window test runs against a deadline, so a retry there needs care.
- The web adapter closes the source machine's manager before its service; no test covers that order.
- The approved list shows the manager's names (`button label · event key · board key`), not the catalog's event and board names; the page cannot map a `sel-` id back to a tuple. Changing that means the manager carrying friendlier names.
- **A stalled program page fails Stop.** On hosted Windows (PR #74's first two commits, push runs, jobs 136283857459 and 136291022984) Stop answered `HANDLER_FAILED` because the program page stalled past the 2.5 s heartbeat; the page blacks itself on the disconnect, and the operator sees Stop refused. That is the intended fail-closed answer, but if the stadium PC's renderer ever stalls that long, Stop will be reported as failed while the output is black. The warm-up in PR #75 is a mitigation of the CI symptom, not a fix of slow renderers; no timing constant was changed.
- Under load Chromium's DevTools can report a fully read answer as `net::ERR_ABORTED` (seen fence 67 on status, state, selections and review answers; the page saw no error). Any browser test that waits on Playwright's `response.finished()` or `requestfinished` can hang this way; use Resource Timing or a page-side signal.
- This sandbox cannot run `npm ci` exactly: one locked package (the spreadsheet reader) comes from a host the sandbox blocks. Local Linux runs use the registry's 0.18.5 as a stand-in, with `package.json` and the lock file restored afterwards; the stand-in lacks `set_fs`, so add a no-op `set_fs` export to the local copy or the 7 real-SPX startup tests fail. GitHub's checks are the authority.
- An offline pin to an older playback stays when the button's newer playback was never prepared, so a cached start plays that older, verified snapshot (5b-3, `EXCHANGE_SETUP.md` › Offline pins). Whether the setup command should drop such a pin instead is not decided.
- A linked media root is allowed (5b-2, `SOURCE_MACHINE_POLICY.md` › Linked source root) and tested on Linux only; a Windows junction and a synced Drive folder are untested.
- The browser suite's file `tests/browser/game-day-source.browser.cjs` is in `npm run test:browser`; locally it needs `PIRAIDERS_BROWSER_EXECUTABLE=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`, and no `--test-timeout` (that flag times out the whole file).
- The approval screen's window inputs use the PC's own clock; the confirmation shows Central time. If the stadium PC is not set to Central time the operator sees both; not tested on Windows.
- Two old Codex branches are not in master and have no pull request: `feature/be-008-extracted-app-output` (Nov 15) and `feature/windows-development-bundle` (Nov 13). Not reviewed; do not merge them blind.
- Twelve proposals for the fixture pack and contract wait on the scheduler side (`FIXTURE_RESULTS_FOR_SCHEDULER.md`). Proposal 11 (JPEG limit cases in the pack) still stands after the fix. The Engine changes no schema and no contract text on its own.
- Nothing has been tested on Windows 10, the stadium PC, a synced folder, NDI over a network or the board.

## Rules that do not change

- This repository is **public**: no student data, names of minors, district addresses, Drive IDs or links, hostnames, IP addresses, tokens or real board names, anywhere. Synthetic fixtures only. Do not copy the scheduler's private files here.
- `.gitignore` ignores `*.md`, `*.txt`, `*.zip`, `*.log`, `*config*.json`: use `git add -f` for such files and check `git status --ignored` before every commit.
- Take the lock first (`LOCKING_PROTOCOL.md`): owner id `claude-…`, fence + 1, 90 minutes, plain fast-forward push; renew every 15 minutes and before pushes; release at the end, also on failure.
- Never commit to master directly. Never force-push. Never rerun an unchanged failing check to get green: a failure stays recorded with its cause or "cause unknown".
- Merge only when every check on the final commit is green and the whole diff has been read.
- No Python in anything that runs on the Windows PC. No hardware claims from simulators or CI. No deployment, signing, release, Drive or Sheet access, source-app change or stadium network change.
- Keep original SPX behaviour, licence and attribution intact (`AGENTS.md`).
