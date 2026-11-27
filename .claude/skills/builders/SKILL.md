---
name: builders
description: Start, stop or size the builders, or report their status. Use when the owner says "start the builders", "stop the builders", "set builders to N" or "status" (or asks how the builders or the queue are doing).
---

# The builders

The builders are runs, each started as AGENTS.md › Links › Builder run says: preferred as a background subagent of the
orchestrator chat (AGENTS.md › The orchestrator), else as a session with `create_session`. Each run takes one request from `queue/`, builds it, lands it by pull request
and starts the next run (AGENTS.md › A run). `Builders: N` near the top of AGENTS.md is how many may run.
The exclusive agent lease lets only one run write at a time: a run that finds the lease held ends at once.

## "start the builders"
1. Read `N` from the `Builders:` line in AGENTS.md. N of 0: say "Builders are set to 0; say 'set builders to N' first." and stop.
2. Read the lease (`node scripts/builder/lease-git.mjs status`). Busy: answer "A builder is already working on <task>." and stop.
3. Otherwise this chat becomes the orchestrator (AGENTS.md › The orchestrator): start one run as a subagent, and if the
   scheduled task "Engine builders watchdog" is missing or off, create (or enable) it: hourly, firing into this chat,
   prompt "Watchdog turn: follow AGENTS.md › The orchestrator, step 3." Where subagents are not available, call
   `create_session` once with the fallback values instead.
4. Answer in one line: started, and how many requests are in `queue/todo/`.

## "stop the builders"
1. Set the line to `Builders: 0` in AGENTS.md on a branch, open a pull request, and merge it when every check is green
   (the land skill's steps 4 to 7; the lease first, as AGENTS.md says for any write).
2. Answer: "Stopped. A run in progress finishes its current request, then stops."

## "set builders to N"
Same as stop, with `Builders: N`. Then answer in one line. Starting them is a separate "start the builders".

## "status"
Run `node scripts/builder/tracker.cjs` and answer in five lines, in plain words:
1. Building now (the row's title, since when), or nothing
2. Waiting on you (title and its one sentence; the link if any)
3. Up next (the next 3 titles)
4. Merged in the last 7 days (count, and the newest)
5. Counts per folder, and `Builders: N`
