# Exact approval revalidation (BE-006, first slice of the source service)

`scripts/lib/exchange-approval-policy.cjs` is the one place that decides whether a saved PC confirmation still allows a source selection. Until now only tests compared approval records by hand; nothing in the application compiled a machine-policy fingerprint or reread the approval store at the manager's boundaries. This slice adds that decision. It does not enable source mode, add a route or screen, or write approvals: the PC confirmation screen (backlog item 4) is what will write them.

## What it provides

- `compileMachinePolicyFingerprint(machine)`: SHA-256 of a fixed projection of a loader-made source machine (`isGameDayMachineConfig`): provider ID, feed binding, journal and approval store IDs and directories, the retained canonical source spelling, media root and cache root, under the tag `piraiders-machine-policy-v1`. Copies, JSON clones and machines without `source` are refused (`APPROVAL_POLICY_MACHINE_INVALID`). Moving any of those, including the install folder, needs a fresh confirmation.
- `approvalMatches(approvals, expected)`: pure, exact. Exactly one record for the provider/binding/selection tuple; it must be a `confirm` with `confirmation:true`, the same policy fingerprint and the same production window after normalization (same instants and prewarm; the default prewarm is 15). Cached startup additionally needs the record's own offline pin (`snapshotId` and `playbackFingerprint`) to be equal. An offline pin does not remove the online confirmation. Anything malformed is `false`.
- `createApprovalRevalidator({machine, store?})` returns:
  - `refreshAdmission(context)`: the manager's awaited hook. It rereads the approval store from disk (`open` with the machine's retained directory and store ID) and then decides.
  - `admitCandidate(context)`: the manager's synchronous hook. No I/O; uses only the last completed read.
  - `authorizeOffline(context)`: the provider's cached-startup hook. Also requires the context's journal store ID to be this machine's retained one. It reads nothing itself: the caller completes `refresh()` before a cached startup, or the startup is refused.
  - `refresh()`, `status()` (path-free: `read`, `revision`, `code`, `rolledBack`, `closed`, always `ready:false`), `close()`, `policyFingerprint`.

## Rules

- Every hook returns literal `true` or `false` and never throws.
- Authority exists only between a completed, newest read and the start of the next read. A refresh in flight withdraws the old decision; a failed, overtaken or post-close read grants nothing; a later good read is a fresh decision, never a revival of the old one.
- The candidate's provider and binding must equal the machine's retained source policy, not only the stored record.
- An approval history only grows. A lower revision, or the same revision with a different head, is treated as a restored or replaced store: `APPROVAL_ROLLBACK`, denied for the life of this revalidator (until the application restarts). A higher revision is not proven to descend from the one seen before; the store's own chain check covers the files it reads.
- Active playback and priority Stop never call these hooks (unchanged manager behaviour); revocation stops new admission only.

## Not done here

- No timeout on the store read. The store reads a small local directory; the manager's physical barrier waits for it. A hung disk would hold preparation and activation of a new event, not active playback or Stop.
- No wiring into `scripts/piraiders-app.cjs`: a source-enabled machine still cannot run, because there is no source catalog service, selector or confirmation screen yet.
- No Windows, stadium PC or synced-folder evidence. GitHub's Windows checks run the same Node tests on hosted Windows only.

## Tests

`tests/exchange-approval-policy.test.cjs`, 9 tests, synthetic data only: fingerprint inputs; exact matching; reread at every refresh, revocation, foreign policy and foreign binding; missing and broken stores; rollback by restoring an older copy and by same-revision divergence; overtaken and closed refreshes; cached startup through the real provider with a disconnected source; and the real manager denying activation when a revocation is written while the event is starting. Each guard was removed in turn and at least one test failed every time.
