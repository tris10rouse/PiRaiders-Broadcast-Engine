# Detached source/window approval persistence (BE-006)

Success criteria: explicit retained-store initialization, strict immutable data records, exact-head compare-and-create publication, persistent confirmation/revocation, unchanged no-ops, bounded replay, fail-closed ambiguous acknowledgement, and observed filesystem ownership preservation. This is the prerequisite for the PC source selection/confirmation flow, not a completed UI or authorization service.

## API

`createExchangeApprovalStore({io?,phase?,limits?})` exposes:

- `initialize(directory,storeId)`: directory must be absent; parent already exists. The trusted caller supplies and separately retains a v4 UUID. No automatic initialization/reset/rebind.
- `open(directory,expectedStoreId)`: validate and replay the complete bounded immutable history. Missing stores are failures and are never created.
- `append(directory,{expectedStoreId,expectedRevision,expectedHeadSha256,approval})`: copy strict JSON before the first await, replay, check the exact retained head, and publish a changed transition only.

Results are frozen `{ok:true,scope:'exchange-approval-store',ready:false,storeId,revision,headSha256,approvals,committed,changed}` or fixed path/value-free `{ok:false,scope,ready:false,code}`. `approvals` is a stable identity-sorted array of effective normalized confirmation records. No root paths, filesystem identities or capabilities are exposed. Error codes are `APPROVAL_ARGUMENT_INVALID`, `APPROVAL_EXISTS`, `APPROVAL_MISSING`, `APPROVAL_INVALID`, `APPROVAL_CAPACITY_EXCEEDED`, `APPROVAL_CONFLICT`, `APPROVAL_RECORD_REJECTED`, `APPROVAL_IO_FAILED`, and `APPROVAL_COMMIT_UNCERTAIN`.

Confirm shape is exactly:

```js
{
  type:'confirm',providerId:'machine-owned-provider',
  machinePolicyFingerprint:'<lowercase SHA256>',
  binding:{feedId:'<v4 UUID>',epoch:1},
  identityTuple:[schoolYear,eventKey,boardKey,origin,buttonIdentity],
  productionWindow:{start:'<explicit-offset instant>',end:'<explicit-offset instant>',prewarmMinutes:15},
  offline:null, // OR {snapshotId:'<v4 UUID>',playbackFingerprint:'<lowercase SHA256>'}
  confirmation:true
}
```

`prewarmMinutes` is optional in input and defaults to15 once. Windows normalize to UTC ISO using the existing production-window validator, preserving its24-hour and0..60-minute limits. Source tuple scalar/range/Unicode rules match the provider's JSON identity boundary (5 exact strings, schoolYear, event/season origin,200-code-point button identity); no truncation, slug conversion or source tuple guessing. Provider ID is a bounded lowercase ASCII slug, epoch1..999999. Malformed/accessor/hidden/sparse/coercible data and unsupported fields reject without executing getters.

Revoke shape is exactly `{type:'revoke',providerId,binding,identityTuple,confirmation:true}`. Policy, window and cache fields are absent. Identity is provider + feedId + epoch + complete tuple; machine-policy/window/cache changes replace only that exact effective approval. Revoke removes the effective record but preserves immutable history. Reconfirming an identical normalized record or revoking an absent identity is an unchanged no-op before history-capacity checks and consumes no record. CAS mismatch still rejects even for a would-be no-op.

## Authority

These are **data persistence APIs**, never authorization decisions. No callback, startup, control or `authorizeOffline` helper is provided. The caller must authenticate and authorize confirmation, compile/retain the exact current machine-policy fingerprint, separately retain store identity, verify canonical root policy, and bind the approval to the exact runtime/profile/window/cache. A UUID/hash in the store does not prove that the referenced cache exists, matches or remains approved. Active source admission, eligibility, original native cutoff and future offline authorization remain separate runtime boundaries. The module reads/writes only its dedicated local directory and performs no source/Drive/cache/native/network I/O. Configure that local directory outside source/private/public HTTP roots; this module has no authority to invent that machine policy.

## Publication and recovery

Each canonical JSON+newline record contains schemaVersion1, kind (`genesis` or `approval`), storeId, monotonically contiguous revision, exact prior delivered-record SHA256 and normalized approval/null. Genesis is revision0. Replay verifies exact canonical bytes, hash chain, store UUID, record order and every state transition; redundant changed=false records are invalid on disk. Unknown names, gaps, malformed/truncated history, unsupported records and symlinks fail closed. No history deletion, eviction, automatic repair or fallback is performed.

Publication uses a private `.tmp-<v4 UUID>` file with exclusive creation, complete write, file sync and close, then an atomic no-overwrite hard link to the exact next revision filename. There is no overwrite/copy/rename fallback. Concurrent actual child writers starting from one head have one winner; EEXIST is a conflict requiring explicit reopen/reconsideration. Initialize's exclusive mkdir likewise has one winner. A crash or failed initialization leaves an existing incomplete directory; open fails and initialization refuses to reset it.

All observed directory ancestors are pinned by device/inode/birthtime and checked repeatedly. Record reads compare the named and open file's stable signature around bounded reads. The prior head is rechecked by device/inode/birthtime/mtime/size plus exact digest before link and acknowledgement. Final committed bytes **and identity matching the owned temporary file** are verified before acknowledgement. Observed root replacement or byte-identical head/committed-name substitution rejects. These are observed checks, not an OS-atomic transaction against a hostile administrator between awaits.

Cleanup never unlinks committed filenames and only attempts its own temp after root and temp device/inode/birthtime/mtime/size rechecks. This includes an independently reproduced candidate defect where unlink/recreate reused the temp inode: inode-only cleanup deleted foreign bytes. The added identity/signature check preserves the foreign replacement. When ownership is uncertain, a moved original or partial temp can remain orphaned. Temps are bounded and never silently collected.

Any non-EEXIST link failure is conservatively uncertain; the call may have taken effect before reporting an error. Any post-publication failure is uncertain. There is no success acknowledgement or automatic retry/reset in either case; trusted integration must explicitly reopen and reconcile. Actual process termination and fsync/hard-link tests establish a process-failure boundary, not directory-flush/general power-loss, disk-firmware, backup rollback or administrator protection. A complete valid-prefix clone/rollback is not detected without an external high-water anchor.

## Bounds

Defaults:4096 committed records including genesis,2048 effective approvals,64KiB per record,64MiB committed aggregate,32 recognized private temp files of at most64KiB. Factory test/resource limits may only decrease these maxima. Effective-state/history/byte exhaustion fails closed; no approval/history is evicted. No real-time or maximum-capacity replay-latency guarantee is claimed.

## Executed evidence and publication boundaries

Only publication candidates are `scripts/lib/exchange-approval-store.cjs` and `tests/exchange-approval-store.test.cjs`, plus a publishable version of this document. The two copied fingerprint/window dependencies are unchanged execution support. No source/Git/GitHub/lease/install or native output changes were made by this isolated task.

- Original focused run:20passed/1failed,0skips. It reproduced foreign-temp deletion after observed inode reuse; preserved in `first-focused.log`.
- Intermediate ownership fix:21/21passed,0skips/failures (`after-ownership-focused.log`).
- Expanded real partial-write and genuine injected I/O error run:23/23passed,0skips/failures (`final-io-focused.log`). Phase-hook exceptions are explicitly separate from actual write/sync/close I/O errors.
- Final owned-publication/directory-birthtime/incomplete-initialization run:25/25passed,0skips/failures,3.03s (`final-owned-publication.log`). Actual child-process append/init races, six child termination barriers including partial10-byte write and post-link/pre-ack, corrupt/replaced/aliased files, unchanged capacity no-ops, revocation/reopen, retained UUID, copied strict input, aggregate/effective/history/temp bounds, real-link-followed-by-error uncertainty, and foreign-byte preservation are covered.
- Both changed CJS syntax checks passed. This is Linux filesystem/process evidence; actual final-SHA Windows and full regression remain root integration gates. No browser, native sender, targetWindows10, LAN, source hydration or stadium proof is claimed.

An early scratch-content mismatch was reported to root and writes paused. Root verified the authorized task and confirmed no other agent had write permission there, then authorized resumption. No further unexpected modification was observed. This is coordination history only, not proof of an external writer.
