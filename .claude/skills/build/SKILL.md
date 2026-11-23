---
name: build
description: Build one queue row on its branch, test-first, to the repository's rules. Use in a builder run (AGENTS.md › A run, step 10) or for "fix this now", before the land skill.
---

# Build one row

The row's file in `queue/todo/` holds, below its `---` line, what was asked, word for word, with its success
criteria. Build exactly that. A problem you notice outside the row becomes a new `queue/todo/` file (next free
`Q-nnn`, added to `queue/ORDER.md`), nothing more.

1. **Read first:** AGENTS.md (its rules always win), `docs/agent/CLAUDE_HANDOFF.md` (Open risks, Rules that do not
   change), only the top section of `docs/planning/IMPLEMENTATION_BACKLOG.md`, and the design notes the row names.
2. **Too big for one run** (Size M or L, or you judge it so): split it first. Write one `queue/todo/<row>-1.md`,
   `<row>-2.md`, … per part (Size S, header `Parent: <row>`), each with success criteria written before the work,
   below the line the parent's words plus the part's own criteria; replace the row's line in `queue/ORDER.md` with
   the parts in order; move the parent file to `queue/parked/` with `Parked: split into <parts>`. Add the parts to
   the "Road to the evaluation build" table and the backlog's top section. These edits ride in the first part's
   pull request. Then build the first part.
3. **Branch:** `git fetch origin master`, then `feature/<row>-<short-name>` from `origin/master` (resume it if the
   lease said `resume` or it exists on origin). The lease must name the row and branch (A run, step 8).
4. **Write the success criteria** in the backlog's top section before the code, as earlier entries do.
5. **Test first:** every fix or feature gets a test that fails without the change. Prove it fails on the old code
   (stash the fix and run it), then passes. Never skip, loosen or delete a test to get green.
6. **Test as you go:** `npm ci --ignore-scripts` once (CLAUDE_HANDOFF.md › Open risks says how in this sandbox),
   `npm run check`, the focused test files, then the full `npm test`; `npm run test:browser` when a page or route
   changed. Windows, Caspar and NDI proofs run only on GitHub: never claim them from Linux.
7. **Review round before landing a change to code** (not docs-only): 2 to 3 reviewer agents on the cheaper model
   (Sonnet), each with AGENTS.md and the diff only, each in its own scratch copy: "report only, confirmed bugs only,
   file:line, a repro, expected vs actual, under 300 words". Fix what is confirmed, with a test.
8. **Commit** on the branch with the session's attribution lines; renew the lease before every push
   (`node scripts/builder/lease-git.mjs renew`); `git push -u origin <branch>` without force (the push guard denies force
   and any push to the default branch).
9. **Docs in the same branch:** the row's line in CLAUDE_HANDOFF.md › Road to the evaluation build, the backlog's top
   section (one short dated line), and the design note the row asks for. Keep CLAUDE_HANDOFF.md one screen.

Then land it with the `land` skill.

## Rules that cut across every row

- Public repository: no student data, names of minors, district addresses, Drive ids or links, hostnames, IP
  addresses, tokens or real board names, in code, tests, commits, pull requests, queue files or logs.
- `.gitignore` ignores `*.md`, `*.txt`, `*.zip`, `*.log`, `*config*.json`: `git add -f` such files and read
  `git status --ignored` before every commit.
- Sender running, source discovered, receiver connected, board input selected and on-air are distinct states.
- No hardware, stadium PC, board or deployment claim from CI or a simulator. No Python in anything that runs on the
  Windows PC. Never change the exchange schemas or contract alone: propose in `docs/agent/FIXTURE_RESULTS_FOR_SCHEDULER.md`.
- Keep original SPX behaviour, licence and attribution intact.
