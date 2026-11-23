---
name: fix-now
description: Fix something right away, ahead of the queue. Use when the owner says "fix this now" (or "fix it now", "this can't wait") in any session.
---

# Fix now

1. **The lease first** (AGENTS.md › A run, step 3). Held by a builder: tell him "A builder is working on <task>;
   your fix is queued first and starts when it finishes", write the row as in step 2 at the top of `queue/ORDER.md`
   through a pull request later, and stop.
2. **Write the row** as `queue/todo/Q-nnn.md` (the next free `Q-` number across every `queue/` folder) with the usual
   header (Title in his words, Kind Fix, Area, Size, Added) and below the `---` line his words, word for word, plus
   what he showed. Never anything private: this repository is public. Put it first in `queue/ORDER.md`.
3. Claim it (`node scripts/builder/lease-git.mjs renew --task Q-nnn --branch feature/q-nnn-<short>`), build it with the
   `build` skill and land it with the `land` skill, as usual (tests first, every check green).
4. Release the lease. Tell him in one or two lines: what was wrong and the pull request it landed in.
