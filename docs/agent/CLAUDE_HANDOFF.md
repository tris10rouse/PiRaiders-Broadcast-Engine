# Claude handoff

Last updated 2026-11-20 (tenth run, lock fence 56). Keep this to one screen. History lives in `CODEX_CHECKPOINT.md` and `docs/planning/IMPLEMENTATION_BACKLOG.md`; do not read those whole.

## State of master

- The takeover is finished (PRs #56, #57, #58, all merged on Nov 19). The checks that ran on master after each of the three merges were all green, 6 of 6 groups each (`9bc27ca`, `6014793`, `975fecd`).
- Still recorded as failed, not rerun: the Caspar software proof on `50bb524` (its own process listing timed out; why it was that slow is unknown), and the four NDI checks on PR #56's first commit (the vendor replaced its installer).
- **Large JPEGs** (PR #59, merged as `98777ea`): the exchange path decodes every legal JPEG at 4096 x 4096 inside the unchanged 10 s limit. All 6 check groups on master after the merge were green.
- **Total bytes counted once per picture** (PR #60, merged as `98717c2`): all 9 checks on master after the merge were green.
- **Large JPEGs from a local folder** (PR #61, merged as `125b76e`): the older local-folder path has the same 384 MB heap cap and 512 MB budget. All 12 checks on the PR and all 9 on master after the merge were green.
- **Exact approval revalidation** (BE-006 slice 3a, PR #63, merged as `fe0812c`): one module fingerprints the machine's source policy and decides saved approvals exactly, rereading the store before each new event is published, started and acknowledged. Not used by the application yet. All 12 checks on the PR and all 9 on master after the merge were green.
- **Source catalog service** (BE-006 slice 3b, PR #65, merged as `f9d8e46`): one object built from the machine configuration owns the provider and the approval check. All 6 check groups on master after the merge were green.
- **Source catalog routes** (item 4a, PR #66, merged as `ff92534` by the eighth run, fence 54): the web part builds the source service on a source machine and serves status, refresh, events-page and selections-page routes; playback routes there answer `SOURCE_PLAYBACK_NOT_READY`. All 12 checks on its final commit and all 6 check groups on master after the merge green. Still recorded, not rerun: the prepared-event proof failure on `398e336` (cause unknown) and one Windows baseline `ETIMEDOUT` on `7acbb00`.
- **Source catalog screen** (item 4b, PR #67, merged as `ac88976`): on a source machine the Game Day page shows **Exchange events** instead of the local list: auto-read on open, school year and counts, events and an event's board buttons 25 per page, a read-only review of one button, stale/unavailable/busy states with a refresh button. Local machines unchanged. All 12 checks on `15c7d66` and all 6 check groups on master after the merge green.
- **Review and approval** (item 4c, branch `feature/be-006-source-approval`, PR_LINE): the service reviews (fresh inspection plus the saved approval), confirms (re-inspects; refuses a changed revision or an ineligible event) and revokes (never reads the source) in this machine's approval store; routes `source/review`, `source/approve`, `source/revoke`; the chosen button gets **Check this button** and a two-step confirmation. Store setup is a setup step (item 5), never a screen action. Online confirmations only. Design: `EXCHANGE_SOURCE_SERVICE.md` › Review and approval.
- Old lock fence 46 ("exact source revalidation and source service") is lost and is not reconstructed.
- Preparation and playback on a source machine are still not built. First evaluation release: NOT READY. No Windows artifact exists.

## Next, in this order (one increment per run, each on `feature/be-NNN-short-name` with a PR)

Item 4 is split into 4a–4d in the backlog's top section (success criteria there).

1. NEXT_ONE
2. 4d: preparation and playback of an approved selection on a source machine (a manager whose catalog lists approved selections, `preparedMedia` and the service's admission hooks). If a Windows process listing times out again, make the test-side `processTable` callers repeat a timed-out listing a bounded number of times and record each attempt (its own increment and PR).
3. Real Windows exchange activation; then setup (approval store setup step, offline pins), diagnostics and recovery; close and startup proofs; the four-hour soak.

## Open risks

- **Time.** The 10 s per-picture limit is fixed in code. On a 2-CPU Linux machine the slowest legal pictures found take 5.5 s (dense progressive 4:4:4 JPEG, 14 MB, at the pixel limit) and 3.0 s (16-bit PNG). The stadium PC has never been measured.
- **Memory.** One 4096 x 4096 JPEG needs about 0.7 GB (4:2:0) to 1.3 GB (four components) of process memory at its peak, one picture at a time. How much memory the stadium PC has is unknown.
- The NDI checks run on runtime 6.4.0.2. Add the winget manifest commit to `docs/design/WINDOWS_NDI_PROOF.md` when one exists; a different hash there is a failure, not a detail.
- The prepared-event proof failed once at the offline crash restart on PR #66's first commit, cause unknown; if it fails again, read its evidence artifact (`prepared-event-private-ndi-evidence`) from a place that can download it.
- The NDI, console, prepared-event and full-app proofs still make a single process listing at their captures and can fail the way the Caspar proof did.
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
