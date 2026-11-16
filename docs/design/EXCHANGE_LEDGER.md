# Detached exchange ledger transitions

BE-006 adds a pure state machine for the contract4.1/4.6/4.7 and V10/V16 accepted feed facts. It does not read Drive, validate source documents, persist a ledger, activate a cache, confirm an operating window or change Game Day/output. All results remain `ready:false` and `committed:false`. There are no new dependencies or listeners.

## Caller boundary

`initialExchangeLedgerState()` returns frozen schema1/revision0/unbound state. `proposeExchangeLedgerEvent(state,event)` validates and copies both inputs, checks the expected local revision and returns a deeply frozen change/no-change proposal. Failures return fixed redacted codes without source values or stacks and leave both inputs unchanged.

The API accepts trusted facts from a future composed admission layer. A `catalog` event means that the complete delivered catalog bytes, schema, feed/approved epoch and document context have already been independently validated. Its digest is SHA256 of the exact delivered bytes, including whitespace. It may be recorded even if the selected manifest is missing, invalid or absent from the catalog. A `manifest` event means that its captured bytes, descriptor/digest/context, schemas, selection integrity, problem state and timing metadata have already passed their gates. Its digest is exact delivered manifest SHA256, not a JCS fingerprint or current.json digest. Actual missing images need not prevent retaining an already verified metadata fact.

These caller preconditions are not enforced by this module: syntactically valid synthetic facts pass without any files. In particular, the existing metadata reader currently exposes a completed selected-manifest pin, not an independently validated catalog receipt. Integration must add that explicit catalog boundary; it must not manufacture a catalog fact from headers, a foreign document or a failed schema check. A higher accepted fact never implies playable, eligible or armed content.

## Binding and retained floors

Binding is feed UUID plus approved epoch, independent of selected school year/event/board/button. `confirm-binding` requires literal `confirm:true`, the expected old binding and the expected local revision. This encodes intent in a trusted API; it is not authentication or evidence of a human UI confirmation. Ordinary selection facts cannot bind or rebind the engine.

Each known feed retains its approved epoch, catalog sequence/digest and separate sequence/digest/identity tuple for every seen selection. Switching feeds creates or reuses a separate namespace; returning to a known feed retains all its floors. An approved epoch can only increase. Increasing it preserves counters: lower counters remain stale, and reusing a counter across epochs fails even with identical bytes. A previously unseen selection can start its own counter. Selection absence, year/button changes, tombstones, incomplete media and active-cache changes cannot reset these facts.

Within the same epoch, an equal sequence with equal digest is idempotent; equal sequence with different bytes is a content conflict; lower sequence is stale. A higher sequence proposes an advance. Catalog and manifest facts advance independently and do not require a manifest to exist before retaining a valid catalog floor. The ledger contains no active/last-good cache, asset, scheduling, arming, Stop or deletion fields.

## Bounds and trust

Strict known shapes reject accessors, hidden/symbol properties, sparse arrays, malformed counters, UUIDs/digests and mismatched tuple hashes. Tuple bounds count Unicode code points without normalization. The module is intended for ordinary parsed data, not hostile JavaScript proxies or a compromised process. Feed and selection ordering uses deterministic ASCII comparisons.

Bounds are eight retained feeds, 2048 selections per feed, 4096 total selections, 8MiB serialized state and 64KiB serialized event. Capacity fails closed without eviction or silent reset. This separate state budget does not widen the existing 1MiB source canonicalizer budget. The local revision is a safe integer; exhaustion rejects changes while allowing a valid idempotent observation.

## Persistence remains pending

The proposal includes `expectedRevision`, `nextRevision`, its validated event and candidate state. Two siblings from the same parent can both be proposed; neither has committed. A future store must enforce atomic compare-and-swap and acknowledge durable publication before any admission layer uses the new state. JSON rehydration tests do not establish filesystem durability or concurrent-writer exclusion. An arbitrary supplied state is structurally checked, not authenticated as a genuine history.

The planned next increment is a bounded immutable hash-linked journal outside Drive/media. A complete flushed private temporary record can be atomically linked to a fixed next-revision filename with no overwrite; competing writers must not both publish. Replay must fail closed on corruption, gaps, missing initialized state and unsupported filesystem semantics, without silently recreating an empty ledger. Real Windows contention, crash/reopen and failure-path tests are required. No mutable read-then-rename head or PID-only lock stealing is approved by this design. Filesystem flush/link alone would not prove power-loss, backup rollback or local-administrator resistance.

## Verification and rollback

Synthetic tests cover independent facts, exact-byte conflicts, stale counters/revisions/confirmations, epoch and feed return, ordinary selection changes, Unicode identities, malformed nested data, capacities, no mutation, JSON rehydration and explicit non-readiness. They do not execute publisher code, prove the complete59-step fixture contract, test persistent Windows storage or alter production behavior. Full regression and final-SHA Windows CI are required before merge. Rollback removes this unused module, test and design document; existing services, source data, caches and output remain unchanged.
