# Claude handoff

Last updated 2026-11-19 (takeover run, lock fence 47). Keep this to one screen. History lives in `CODEX_CHECKPOINT.md` and `docs/planning/IMPLEMENTATION_BACKLOG.md`; do not read those whole.

## State of master

- PR #55 merged as `50bb524` on Nov 17 (all 12 checks green on its head `9d15d10`). On master afterwards 5 of 6 check groups passed and one failed: the Caspar software proof, `CASPAR_PROOF_FAILED_ENUMERATE_START`.
- That failure is found, not rerun: the proof's own process listing (one PowerShell query, 15 s limit) timed out right after Caspar had started and answered. It is proof tooling, not the Engine. **Why the listing was that slow is unknown.** Fix: PR #56 (a timed-out listing is repeated at most 3 times at the proof's capture points, and every attempt is counted in the evidence).
- On Nov 18 the NDI vendor replaced its runtime installer (6.3.2.0 → 6.4.0.2) behind the same link, so the pinned download failed and **all four NDI checks failed on every change**. PR #57 first printed what was served (same signer, valid signature, identical on four runners), then re-pinned. No independent listing of the new file's hash existed yet; see `docs/design/WINDOWS_NDI_PROOF.md`.
- If #56 or #57 is still open, finishing it comes first (read its checks; merge only if every check on the final commit is green). Then read the checks that ran on master after each merge and record them in `CODEX_CHECKPOINT.md`.
- Old lock fence 46 ("exact source revalidation and source service", branch never pushed) is lost. Nothing of it exists. It restarts from the backlog.
- The source PC service, selector and approval screen are still not enabled. First evaluation release: NOT READY. No Windows artifact exists.

## Takeover: still to do

Nothing from the takeover list is left. Items (a) to (e) are done: this page, the checkpoint entry, `INTEGRATION_AUDIT.md`, `FIXTURE_RESULTS_FOR_SCHEDULER.md`, corrected source-contract documents.

## Next, in this order (one increment per run, each on `feature/be-NNN-short-name` with a PR)

1. **Large JPEGs (Engine defect against the contract).** Every JPEG above about 9 megapixels is refused (`IMAGE_DECODE_FAILED`): the decoder's 128 MB budget and the worker's 64 MB heap, not time. The contract allows 16.8 megapixels. Raise both on the exchange path, with tests at 4096 x 4096 for each sampling. Detail: `INTEGRATION_AUDIT.md` section 1.
2. **Total bytes counted once per picture.** The Engine adds every asset row; the contract counts each distinct picture once. Count by SHA-256. Detail: `INTEGRATION_AUDIT.md` section 3.
3. BE-006 exact source revalidation and the source service (from the backlog).
4. The PC source selector and the approval confirmation screen. This is also where the exchange catalog pages get their first route and screen: today nothing in the application can list an exchange catalog.
5. Real Windows exchange activation; then setup, diagnostics and recovery; close and startup proofs; the four-hour soak.

## Open risks

- The NDI checks now run on runtime 6.4.0.2. Add the winget manifest commit to `WINDOWS_NDI_PROOF.md` when one exists; a different hash there is a failure, not a detail.
- The NDI, console, prepared-event and full-app proofs still make a single process listing at their captures and can fail the way the Caspar proof did.
- The 10 s per-picture decode limit is fixed in code. Margin for a heavy 16-bit PNG is about 3 times on a 2-CPU Linux machine. The stadium PC has never been measured.
- This sandbox cannot run `npm ci` exactly: one locked package (the spreadsheet reader) comes from a host the sandbox blocks. Local Linux runs use its public-registry build with a small local shim. GitHub's checks are the authority.
- Twelve proposals for the fixture pack and contract wait on the scheduler side (`FIXTURE_RESULTS_FOR_SCHEDULER.md`). The Engine changes no schema and no contract text on its own.
- Nothing has been tested on Windows 10, the stadium PC, a synced folder, NDI over a network or the board.

## Rules that do not change

- This repository is **public**: no student data, names of minors, district addresses, Drive IDs or links, hostnames, IP addresses, tokens or real board names, anywhere. Synthetic fixtures only. Do not copy the scheduler's private files here.
- `.gitignore` ignores `*.md`, `*.txt`, `*.zip`, `*.log`, `*config*.json`: use `git add -f` for such files and check `git status --ignored` before every commit.
- Take the lock first (`LOCKING_PROTOCOL.md`): owner id `claude-…`, fence + 1, 90 minutes, plain fast-forward push; renew every 15 minutes and before pushes; release at the end, also on failure.
- Never commit to master directly. Never force-push. Never rerun an unchanged failing check to get green: a failure stays recorded with its cause or "cause unknown".
- Merge only when every check on the final commit is green and the whole diff has been read.
- No Python in anything that runs on the Windows PC. No hardware claims from simulators or CI. No deployment, signing, release, Drive or Sheet access, source-app change or stadium network change.
- Keep original SPX behaviour, licence and attribution intact (`AGENTS.md`).
