---
name: bug-hunt
description: Hunt for bugs in what changed since the last hunt and queue the confirmed ones. Never fixes code. Use when the owner asks for a bug hunt, or when a queue row asks for one.
---

# Bug hunt

It finds and queues; it never fixes code.

1. **Since when:** the last hunt is the newest commit on the default branch titled `queue: bug hunt …`. None: the
   last 7 days. List what changed since then (`git log --stat`). **Only those files and the features they serve.**
2. `npm run check` and `npm test` first: red on the default branch is itself a finding.
3. **Hunters:** 2 to 3 agents on the cheaper model (Sonnet), one method each, each in its own scratch copy, each with
   AGENTS.md: a route and page walk in the browser suite; a privacy sweep (paths, hostnames, private stores in answers,
   logs or retained evidence); break a guard in changed code (does a test fail?); state mislabelling (sender running,
   source discovered, receiver connected, board input, on-air). Each reports **confirmed bugs only**: file:line, steps
   to reproduce, expected vs actual, under 300 words.
4. **Verify:** 1 agent re-runs every repro. Only what it confirms is queued.
5. **Queue:** drop anything already in `queue/`. At most 8 new `queue/todo/Q-nnn.md` files, Kind `Fix`, with what an
   operator would notice and the repro below the line. A privacy leak or a lost Stop goes to the **top** of
   `queue/ORDER.md`; the rest at the end.
6. Land it with the `land` skill as one pull request titled `queue: bug hunt <date>: <n> found` (the lease first).
