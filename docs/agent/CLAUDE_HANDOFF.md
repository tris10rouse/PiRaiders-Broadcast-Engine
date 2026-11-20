# Claude handoff

Last updated 2026-11-20 (thirteenth run, lock fence 60). Keep this to one screen. History lives in `CODEX_CHECKPOINT.md` and `docs/planning/IMPLEMENTATION_BACKLOG.md`; do not read those whole.

## State of master

- The takeover is finished (PRs #56, #57, #58, all merged on Nov 19). The checks that ran on master after each of the three merges were all green, 6 of 6 groups each (`9bc27ca`, `6014793`, `975fecd`).
- Still recorded as failed, not rerun: the Caspar software proof on `50bb524` (its own process listing timed out; why it was that slow is unknown), and the four NDI checks on PR #56's first commit (the vendor replaced its installer).
- Merged since the takeover, each with all checks green on its final commit and on master after it (details in `CODEX_CHECKPOINT.md`): large JPEGs on the exchange path (#59) and from a local folder (#61), total bytes once per picture (#60), exact approval revalidation (#63), the source catalog service (#65), its routes (#66), its screen (#67), review and approval (#69), playback of approved selections behind the screen (#71, `4f408dd`), and the bounded retry of the launcher-parent process listing (#72). Recorded, not rerun: the prepared-event proof failure on `398e336` (cause unknown), a Windows baseline `ETIMEDOUT` on `7acbb00`, and the launcher-parent `ETIMEDOUT` on `c29407a` (job 136222818361).
- Old lock fence 46 ("exact source revalidation and source service") is lost and is not reconstructed.
- The checks on master after PR #71 and PR #73 were all green, 6 of 6 groups each (`4f408dd`, `e2d49ab`).
- **Playback screen on a source machine** (item 4d-2, PR #74, merged as `bca398f` by the thirteenth run; all 10 checks on its final commit `21e3c74` green, both earlier commits had one red Windows check, recorded below): **Approved board buttons** under Exchange events, playback beside both; prepare, activate, commands and Stop through the ordinary routes; the list rereads after approve/revoke; a revoked prepared button cannot be activated (`ADMISSION_DENIED`, plain words). Design: `EXCHANGE_SOURCE_SERVICE.md` › Playback screen. **Item 4 is complete.**
- **Stalled program page during Stop** (PR #75, branch `feature/be-002-manager-browser-warmup`, test only): the red Windows check on #74 (`HANDLER_FAILED`, `CANCELLED`) is a program page that stalls longer than the 2.5 s presentation heartbeat while painting Stop's black (reproduced on Linux; the failing runs were the first browser test on a cold VM, 5.2 s and 8.6 s against 1.9 s). The manager browser file now warms Chromium first (`BROWSER_WARMUP_MS` in the log) and pins the answer with a new stall test. Merge state: the thirteenth-run entry of `CODEX_CHECKPOINT.md`.
- First evaluation release: NOT READY. No Windows artifact exists.

## Next, in this order (one increment per run, each on `feature/be-NNN-short-name` with a PR)

Item 5 is split into 5a–5f with success criteria in the backlog's top section.

1. If PR #75 is still open: read its checks; merge only with every check on its final commit green; if the manager file fails again, read `BROWSER_WARMUP_MS` and the Stop answer in the log before changing anything. Then confirm the checks on master after #74 and #75.
2. 5a: the Windows exchange activation proof in CI (synthetic exchange folder, real routes, real Caspar/CEF/NDI frames, then black). Read `docs/design/FULL_APP_WINDOWS_PROOF.md` and `.github/workflows/full-app-proof.yml` first; a new job beside them, not a change to their assertions.
3. Then 5b setup and cached startup, 5c diagnostics and recovery, 5d close and startup proofs, 5e the four-hour soak, 5f the evaluation-ready artifact.

## Open risks

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
