---
name: land
description: Land a built row by pull request - queue file removed, handoff updated, every check green on the final commit, whole diff read, squash merge. Use after the build skill, in a builder run or for "fix this now".
---

# Land

Nothing reaches the default branch except through a pull request whose every check on its final commit is green.
Never push to the default branch, never force-push (a hook denies both).

1. **Queue, in the same branch:** delete the row's file from `queue/todo/` and its line from `queue/ORDER.md`;
   `node scripts/builder/queue.cjs lint` must print `queue: ok`.
2. **Handoff, in the same branch:** the row's status in CLAUDE_HANDOFF.md › Road to the evaluation build becomes
   "landed by #<PR> on <date>" (write it once the pull request has its number), one line in its Run log
   (date, time, fence, outcome, part) and the estimate recomputed as that page says.
3. **Rebase** on `origin/master` if it moved (`git fetch origin master`, `git rebase origin/master`; never
   rewrite a branch that is already in an open pull request of someone else). Rerun the Linux suites if anything came in.
4. **Lease:** `node scripts/builder/lease-git.mjs renew`. Exit 3: stop all writes; the run is over (A run, step 13).
5. **Push and open the pull request** with the GitHub tools: base the default branch, the repository's
   `.github/pull_request_template.md` headings filled in (tests actually run with PASS/FAIL, what was not tested and
   why, rollback), ending with the session's attribution lines.
6. **Wait for the checks** of the head commit: `node scripts/builder/wait-checks.cjs <sha>` in the background (it
   renews the lease every 10 minutes; exit 0 green, 1 red, 2 timeout, 3 lease lost).
   - **Red, caused by this change:** fix it with a test, push, wait again.
   - **Red, not caused by this change:** never rerun an unchanged failing check to get green. Record it in
     CLAUDE_HANDOFF.md (check, commit, job id, cause or "cause unknown"); if it is new, write a `Q-nnn` Fix row first
     in `queue/ORDER.md`. A known intermittent failure that is already a queue row: put this row back to `queue/todo/`
     with `PR: #<n>` and `Branch:` lines, and end the run (A run, step 13); the next run fixes that row first.
   - **Timeout or lease lost:** A run, step 13.
7. **Merge:** read the whole diff of the pull request once more, then squash-merge it with the GitHub tools
   (title `<what it is> (<row>)`). Never merge with a check red, pending or missing.
8. Leave the branch; branch deletion is not needed.

**Not part of landing:** no release, signing, deployment, Drive or Sheet access, and no message to the owner
unless AGENTS.md › A run says so.
