# Detached Apps Script exchange metadata capture

## Deliberate first-step scope

This is an unmounted, read-only transport metadata reader for the supplied draft0.3.1 exchange layout. It is not the Apps Script importer, schema validator, media candidate builder or an event/output controller. It exposes no network, Drive API/auth, Sheet/report write, source repair, byte staging, cache publication, preparation, Reload or arming operation. Existing local/manual behavior is untouched.

The internal Node caller supplies an absolute To Engine root and an explicit feedId, epoch and five-string identityTuple binding. The reader derives selectionId using the contract's JSON-array SHA256 identity, reads feed.json and catalog.json, locates that exact selection from the catalog, and reads its literal current.json once if present. Selected catalog descriptors inherit feedId/epoch from the root. It chooses one complete newer descriptor without mixing fields, rejects same-sequence descriptor conflicts, validates the exact generation/path grammar before opening a manifest, verifies delivered manifest SHA256 and descriptor context, and pins that capture. A later current-pointer change is considered only on the next capture. Folder inventory never supplies membership, and no asset or unreferenced path is read.

Successful result code METADATA_CAPTURED means only that these bounded transport/envelope checks completed. Both the result and pin carry ready:false and semanticValidation:pending; the pin scope is transport-metadata. Even an empty/removed/incomplete envelope can be captured as metadata, without Stop, deletion or readiness. The reader has no active/last-good playable candidate at all. The last metadata pin remains available on missing, invalid, stale or conflicting input; it is never a substitute for a later semantically accepted media pin. Raw capture payloads remain internal and untrusted; do not expose entire documents or source identifiers in public diagnostics. snapshot() exposes only fixed state categories.

## Bounds and filesystem contract

Manifest bytes are limited to1MiB, catalog to5MiB, and feed/current to64KiB each. Catalog events and selections per event are bounded to800/100. Fatal UTF8 parsing rejects BOM, duplicate decoded keys, unsafe/noninteger/negative numbers, invalid JSON and unpaired surrogates, with depth32/node300000 defensive parser bounds. There is no new runtime dependency or Ajv workaround; no schema clause is disabled.

Known files are read using O_RDONLY plus O_NOFOLLOW where available. The reader checks ancestry for symbolic links/junctions, lexical and canonical root confinement, original pathname/open-handle identities and size/mtime/ctime before and after each read. Root identity is retained for the flight. These checks reject observed links/replacements/mutations; they are not an OS-atomic multi-file snapshot or protection against a malicious local administrator racing ancestor replacements. Real Drive Desktop placeholder/hydration/arrival and Windows filesystem behavior still need actual off-air validation.

Each capture owns one immutable monotonic deadline from node:perf_hooks. Active-work checks and the final lastPin commit check elapsed time independently of the timeout callback; completion microtasks cannot accept a pin after the budget merely because a due timer has not run. A blocked JavaScript event loop may delay delivery of the timeout result, but cannot authorize a late pin.

One physical capture flight is retained per reader. A second request receives READER_BUSY rather than starting overlapping IO or adding followers. A bounded timeout returns CAPTURE_TIMEOUT, invalidates that flight and prevents late results from replacing the prior pin, but does not pretend an uninterruptible filesystem operation has finished. Physical ownership remains busy until its actual cleanup settles. close() returns immediately, fences the flight and settles its waiting caller as READER_CLOSED; eventual file handles still close through finally. No raw filesystem error, source path or document contents are logged or included in error results.

## Remaining validation gates

There is intentionally no complete JSON Schema gate or V1–V20 compatibility claim. Strict full-document shapes/required members, both JCS fingerprints, full selection semantics, occurrence order/reference uniqueness, closed problems/eligibility, Chicago calendar/DST/time windows, unique asset bytes/hash/full decode and immutable schema2 cache remain pending. In-memory sequence/digest checks are not a durable per-feed conflict ledger or restart-safe binding/rebind protocol. Any future Game Day integration must require those stages and retain its independently accepted playable candidate; transport capture can never arm output.

Private fixture originals and publisher scripts are not copied or executed. A read-only representative supplied0.3.1 metadata capture was tested separately; it proves only matching metadata paths/envelopes/digest capture, not the59-step scenarios or source publisher behavior.

## Validation and rollback

Portable synthetic tests cover fatal decoding/duplicate keys/safe values, exact manifest bytes, descriptor pinning through pointer changes, pointer-before-manifest recovery, newer catalog/older current and missing current, stale/conflicting/omitted/new-feed retention, portable unsafe paths, links/replacement, each byte bound, one physical flight, timeout late-result fencing, immediate close and invalid bindings. Synthetic test envelopes are deliberately not complete contract-schema fixtures.

Rollback removes the detached modules/tests/docs; no production integration, cache format, source file or persistent state is changed by this increment.
