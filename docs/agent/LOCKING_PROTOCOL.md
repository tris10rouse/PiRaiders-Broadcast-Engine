# Exclusive GitHub agent lease protocol

**Status:** Adopted for autonomous hourly work on PiRaiders Broadcast Engine.
**Coordination branch:** coordination/agent-lease
**Lease file on that branch only:** agent/lease.json

## Why this is necessary

ChatGPT scheduled sessions may overlap with an existing agent session or a second manual coding agent. GitHub Actions concurrency controls only workflows started by GitHub Actions. The coordination branch is the shared lease record across otherwise separate coding environments. These rules are a **cooperative writer mutex**; they prevent participating agents from colliding, not arbitrary GitHub users or tools that intentionally bypass them.

## Required before ANY repository write, including branch creation and PR merge

1. Read this protocol and the coordination branch HEAD, then read agent/lease.json pinned to that exact commit SHA.
2. If the lease is active and expires in the future, **STOP all writes**, including branches, issues, commits, PRs, merges and workflow dispatches. Read-only analysis is permitted; end the run without spinning up another writer.
3. If idle or expired, claim a lease with a **unique owner ID** and increasing **fencing token**. Create a new Git tree using the observed coordination commit's tree as base; create a new commit with the observed coordination HEAD as its sole parent; update refs/heads/coordination/agent-lease with force:false. If the ref update fails (409 or 422), another agent won: discard the attempt and STOP writes. Never force-push this ref.
4. Store owner and fence in the current agent's own run context. Do not reuse them in another hourly scheduled run.
5. Before every mutating batch, fetch a fresh lease and verify owner, fence and expiry. Renew at least every 15 minutes, or sooner if a long operation is about to start. A 90-minute lease is the normal default. Do not make mutations if lock verification/heartbeat fails, even if the underlying GitHub operation would otherwise succeed.
6. After work, release by the same compare-and-fast-forward protocol. If a session crashes, the lease expires. New agents may reclaim only after the expiry and must increment fence. If the original session wakes up, it must stop all writes, detect lost ownership and abandon its old task.
7. Use distinct feature branches for independent tasks, review CI before PR merge, and avoid updating master without a validated lease. Do not use force on source-code branches.

## GitHub REST/Node client

Node 22+ with a scoped token exposing repository contents write access:
    
    node scripts/agent-lease.mjs status
    node scripts/agent-lease.mjs acquire --task BE-001 --branch feature/be-001
    node scripts/agent-lease.mjs assert --owner "returned-owner" --fence 1
    node scripts/agent-lease.mjs heartbeat --owner "returned-owner" --fence 1
    node scripts/agent-lease.mjs release --owner "returned-owner" --fence 1

GITHUB_TOKEN or GH_TOKEN must be in the environment. No credentials belong in commits or logs. Acquire generates an owner identifier; preserve the returned fence until release. Exit code 3 means another agent is active or a Git ref race occurred. The local script only accesses the dedicated coordination branch, not application code.

## ChatGPT / GitHub connector agents

When no Node environment or token exists, use the connected GitHub actions to perform the same steps: read exact coordination HEAD and tree; read lease pinned to that commit; run the pure state logic above; create_tree; create_commit(parent=observed head); update_ref(force=false, expected_sha=observed head). Verify via a fresh read. To release or renew, repeat under current ownership. Never simply edit agent/lease.json via a normal file update with no observed head/fast-forward check.

## Recovery and audit

- The lease branch is separate from master and is never merged into product code. It preserves a Git commit audit of acquisitions, renewals, recoveries and releases.
- Lease status is not a progress tracker; canonical tasks live in docs/planning/IMPLEMENTATION_BACKLOG.md and code in feature branches/PRs.
- If the lock branch is missing, malformed or unreachable: **fail closed**. Do not silently create a replacement or ignore it.
- A crashed agent's unmerged feature branch may remain. New owner must inspect it and open PRs before duplicating work. A stale original owner must never finish a push or merge after losing its lease.
- Clock skew: GitHub ref compare-and-fast-forward prevents two simultaneous claims. Long-running sessions must check against a fresh lock record; if their local clock is unreliable, stop and investigate.
- No production Daktronics machine changes without human approval. No automatic PR merge unless software tests pass and the implementation is fully evaluated.

## Limitations

This lock coordinates cooperating agents, not browser sessions, forks, manual Git pushes or malicious clients. It cannot stop an already-running process that ignores lease expiry. It does not replace secure credentials, branch protection, code review or hardware testing. A branch ref fast-forward is atomic per GitHub's documented semantics.
