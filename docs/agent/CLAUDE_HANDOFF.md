# Claude handoff

Last updated 2026-11-20 (sixteenth run, lock fence 64). Keep this to one screen. History lives in `CODEX_CHECKPOINT.md` and `docs/planning/IMPLEMENTATION_BACKLOG.md`; do not read those whole.

## Road to the evaluation build

Size: S = fits one run, M = about 2 runs, L = about 3+ runs. Parts in `docs/planning/IMPLEMENTATION_BACKLOG.md` (top section).

| Part | Size | Why that size | Status |
|---|---|---|---|
| 5a-1 Synthetic exchange folder and setup step for the proof | S | One builder and Linux tests on code that already exists | merged on 2026-11-20 (#77, `bc679a3`) |
| 5a-2 Windows job: real app, approve, prepare, activate, frames in order, Stop black, close | M | New Windows script on the real app and receiver; Windows-only failures show up only in CI | PR open (`feature/be-081-exchange-activation-windows`, fence 64) |
| 5a-3 Evidence and privacy checks of that job, design note | S | Reuses the full-app proof's evidence rules | not started |
| 5b Setup command and cached (offline) startup | L | New operator command, the linked-folder decision, offline pins, proven on Linux and Windows | not started |
| 5c Diagnostics and recovery | L | Six distinct states on screen and by command, four tested fault recoveries | not started |
| 5d Close and startup proofs | M | Launcher and close exist; needs default-browser, console-close and cold-start evidence on Windows | not started |
| 5e Four-hour soak | M | A separate long Windows job and recorded memory/handle bounds; one run waits on it | not started |
| 5f Evaluation-ready Windows ZIP | M | Packaging exists; adds source mode, setup command, operator checklist, all checks green | not started |

Closed (fence 64): the console proof's START failure, the Linux browser-suite hang and the NDI negative-control failure each passed on two master runs in a row (`fb4a140`, `8f6f06d`, every check green). Causes of the earlier failures remain unknown; the diagnostics from #79 stay in place.

**Estimate:** remaining sizes 1 S + 4 M + 2 L = 15 sized runs (5a-2 counted in full while its PR is open); pace 1.5 runs per sized run (reconstructed from fences 52–60; this log has 1 merged part at pace 1.0, so the 1.5 stays until 3 merged parts); 15 x 1.5 + 0 open failing checks = **about 23 runs** (down from 26: the three failing-check rows closed on green master runs).

## Run log

| Date (UTC) | Fence | Outcome | Part |
|---|---|---|---|
| 2026-11-20 14:44 | 61 | merged | 5a split into 5a-1..5a-3; 5a-1 merged as #77 (all 12 checks green on `abe8904`) |
| 2026-11-20 15:22 | 62 | fix merged (#79) | Merged the handoff note #78; console proof failed again on master `bc679a3`: diagnostics PR #79; its push run hit the browser-suite hang: bounds added to #79; NDI proof failed on master `f89a8b1` (recorded) |
| 2026-11-20 16:51 | 64 | PR open | Master green twice: three failing-check rows closed; 5a-2 Windows job written, Linux route tests green, PR waiting on its Windows checks |

## State of master

- Master `8f6f06d` (#80, handoff note; #79 `fb4a140` before it). Items 1 to 4 and part 5a-1 are done. Every check green on `fb4a140` and `8f6f06d`. Details: `CODEX_CHECKPOINT.md`.
- Recorded failures, not rerun, cause unknown unless named: the console proof at START on `79ff344` and `bc679a3`; the NDI negative-control receiver on `f89a8b1`; the browser-suite hang on `4845f49`'s push run; the Caspar software proof on `50bb524` (process listing timed out); the four NDI checks on PR #56's first commit (vendor replaced its installer); the prepared-event proof on `398e336`; a Windows baseline `ETIMEDOUT` on `7acbb00`; the launcher-parent `ETIMEDOUT` on `c29407a`; the full-app `RECEIVER_START_TIMEOUT` on `bca398f`; the Windows job-host test on PR #76's first commit.
- First evaluation release: NOT READY. No Windows artifact exists.

## Next, in this order (one increment per run, each on `feature/be-NNN-short-name` with a PR)

1. Finish the 5a-2 PR (`feature/be-081-exchange-activation-windows`): read every check on its final commit. The new job is `actual-exchange-activation-private-ndi` in `full-app-proof.yml`; on failure its stderr line names `phase` and `code` (e.g. `APPROVE`/`SOURCE_REFRESH_FAILED`, `RENDERER_READY`/`APP_RENDERER_READY`, `LAUNCH`/a frame code). Fix a named cause on the same branch; merge only when all checks are green and the whole diff is read. Then a handoff-note PR.
2. 5a-3: evidence and privacy of that job (only synthetic frames and sanitized JSON retained; a check that fails the job when a retained file names the proof folder, the exchange folder or a private store; `docs/design/EXCHANGE_ACTIVATION_WINDOWS_PROOF.md`).
3. Then 5b, 5c, 5d, 5e, 5f.

## Open risks

- `tests/windows-job-process.integration.test.cjs` ("CreateProcess failure never runs an existing invalid executable") failed once on hosted Windows on the docs-only PR #76's first commit (job 136322153458): the job host did not exit within the test's 10 s. Cause unknown (a slow scan of the just-written file is possible, not shown). Not rerun.
- **Time.** The 10 s per-picture limit is fixed in code. On a 2-CPU Linux machine the slowest legal pictures found take 5.5 s (dense progressive 4:4:4 JPEG, 14 MB, at the pixel limit) and 3.0 s (16-bit PNG). The stadium PC has never been measured.
- **Memory.** One 4096 x 4096 JPEG needs about 0.7 GB (4:2:0) to 1.3 GB (four components) of process memory at its peak, one picture at a time. How much memory the stadium PC has is unknown.
- The NDI checks run on runtime 6.4.0.2. Add the winget manifest commit to `docs/design/WINDOWS_NDI_PROOF.md` when one exists; a different hash there is a failure, not a detail.
- The prepared-event proof failed once at the offline crash restart on PR #66's first commit, cause unknown; if it fails again, read its evidence artifact (`prepared-event-private-ndi-evidence`) from a place that can download it.
- The NDI, console, prepared-event and full-app proofs and `windows-production-window.test.cjs` still make a single process listing at their captures and can fail the way the Caspar proof and the launcher-parent test did; the production-window test runs against a deadline, so a retry there needs care.
- The web adapter closes the source machine's manager before its service; no test covers that order.
- The approved list shows the manager's names (`button label · event key · board key`), not the catalog's event and board names; the page cannot map a `sel-` id back to a tuple. Changing that means the manager carrying friendlier names.
- **A stalled program page fails Stop.** On hosted Windows (PR #74's first two commits, push runs, jobs 136283857459 and 136291022984) Stop answered `HANDLER_FAILED` because the program page stalled past the 2.5 s heartbeat; the page blacks itself on the disconnect, and the operator sees Stop refused. That is the intended fail-closed answer, but if the stadium PC's renderer ever stalls that long, Stop will be reported as failed while the output is black. The warm-up in PR #75 is a mitigation of the CI symptom, not a fix of slow renderers; no timing constant was changed.
- The source browser file hung once locally (late-review test) before held answers were released on failure; the failing assertion was not seen.
- This sandbox cannot run `npm ci` exactly: one locked package (the spreadsheet reader) comes from a host the sandbox blocks. Local Linux runs use the registry's 0.18.5 as a stand-in, with `package.json` and the lock file restored afterwards; the stand-in lacks `set_fs`, so add a no-op `set_fs` export to the local copy or the 7 real-SPX startup tests fail. GitHub's checks are the authority.
- The source reader refuses a linked source root (`UNSAFE_INPUT`), although `SOURCE_MACHINE_POLICY.md` allows "a configured alias". The service's root check accepts one; the reader then refuses it. Whether the stadium PC's Drive folder is reached through a link is unknown; decide when setup is written.
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
