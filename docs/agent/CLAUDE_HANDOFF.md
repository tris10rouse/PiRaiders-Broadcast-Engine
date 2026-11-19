# Claude handoff

Last updated 2026-11-19 (second run, lock fence 48). Keep this to one screen. History lives in `CODEX_CHECKPOINT.md` and `docs/planning/IMPLEMENTATION_BACKLOG.md`; do not read those whole.

## State of master

- The takeover is finished (PRs #56, #57, #58, all merged on Nov 19). The checks that ran on master after each of the three merges were all green, 6 of 6 groups each (`9bc27ca`, `6014793`, `975fecd`).
- Still recorded as failed, not rerun: the Caspar software proof on `50bb524` (its own process listing timed out; why it was that slow is unknown), and the four NDI checks on PR #56's first commit (the vendor replaced its installer).
- **Large JPEGs (this run).** On the exchange path every JPEG above about 9 megapixels was refused for memory. Branch `feature/be-006-large-jpeg-decode` gives the JPEG decoder a fixed 512 MB counted budget and the decoder worker a 384 MB heap cap; all layouts at 4096 x 4096 now pass inside the unchanged 10 s limit. If its pull request is still open, finishing it comes first (read its checks; merge only if every check on the final commit is green; a red check is fixed or recorded, never rerun unchanged). Then read the checks on master after the merge and add one line to `CODEX_CHECKPOINT.md`.
- Old lock fence 46 ("exact source revalidation and source service") is lost and is not reconstructed.
- The source PC service, selector and approval screen are still not enabled. First evaluation release: NOT READY. No Windows artifact exists.

## Next, in this order (one increment per run, each on `feature/be-NNN-short-name` with a PR)

1. **Total bytes counted once per picture.** The Engine adds every asset row; the contract counts each distinct picture once. Count by SHA-256 in staging, the coordinator plan and cache reload, with a test of repeated identical bytes just under and just over 536,870,912. Detail: `INTEGRATION_AUDIT.md` section 3.
2. **The same large-JPEG refusal on the older local-folder path** (`media-snapshot.cjs` through the one-shot validator: 128 MB budget, 64 MB heap). Same caps, same tests (`tests/synthetic-jpeg.cjs` builds the pictures). Small.
3. BE-006 exact source revalidation and the source service (from the backlog).
4. The PC source selector and the approval confirmation screen. This is also where the exchange catalog pages get their first route and screen: today nothing in the application can list an exchange catalog.
5. Real Windows exchange activation; then setup, diagnostics and recovery; close and startup proofs; the four-hour soak.

## Open risks

- **Time.** The 10 s per-picture limit is fixed in code. On a 2-CPU Linux machine the slowest legal pictures found take 5.5 s (dense progressive 4:4:4 JPEG, 14 MB, at the pixel limit) and 3.0 s (16-bit PNG). The stadium PC has never been measured.
- **Memory.** One 4096 x 4096 JPEG needs about 0.7 GB (4:2:0) to 1.3 GB (four components) of process memory at its peak, one picture at a time. How much memory the stadium PC has is unknown.
- The NDI checks run on runtime 6.4.0.2. Add the winget manifest commit to `docs/design/WINDOWS_NDI_PROOF.md` when one exists; a different hash there is a failure, not a detail.
- The NDI, console, prepared-event and full-app proofs still make a single process listing at their captures and can fail the way the Caspar proof did.
- This sandbox cannot run `npm ci` exactly: one locked package (the spreadsheet reader) comes from a host the sandbox blocks. Local Linux runs use a local stand-in for it, with the lock file restored afterwards. GitHub's checks are the authority.
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
