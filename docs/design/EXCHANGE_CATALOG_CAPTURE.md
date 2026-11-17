# Validated catalog capture alongside legacy transport

BE-006 adds explicit catalog capture to the existing bounded metadata reader. It does not add Game Day/source-provider integration, journal writes, media staging, cache activation, operating-window confirmation, scheduling or output admission. Every result remains `ready:false` and `semanticValidation:pending`.

## APIs and compatibility

`createExchangeMetadataReader({root,binding,timeoutMs})` still requires the approved feed UUID, epoch and exact selected identity tuple. Its existing `capture()` returns the same transport-only selected-manifest pin and preserves the original header/digest/path and legacy in-memory antirollback behavior. It does not gain full catalog or selected-manifest semantic acceptance merely because a new gate exists.

The same instance now offers:

- `captureCatalog()`: read only literal feed.json and catalog.json, validate their complete raw bytes and available catalog context, then return `CATALOG_CAPTURED` with a frozen `receipt`. It branches before school-year/selection/current/manifest lookup. A missing manifest, omitted selected entry or changed active school year cannot prevent an otherwise valid catalog receipt.
- `captureWithCatalogReceipt()`: perform a fresh full selected transport capture while independently validating that flight's own feed/catalog bytes. Success returns `METADATA_CAPTURED` with the transport `pin` and its `pin.catalogReceipt`. This receipt comes from the SAME captured raw documents as the pin's feed/catalog digests; it is not an earlier receipt attached by sequence or feed identity.
- `lastCatalogReceipt()`: the last successfully completed validated receipt, distinct from the last full transport pin. Catalog-only success never changes `lastPin()`. Failed combined capture never publishes its intermediate catalog receipt or changes either prior value.

`createExchangeCatalogReader({root,binding:{feedId,epoch},timeoutMs})` uses the same implementation and filesystem protections without requiring or inventing a selected tuple. Its `capture()` and `captureCatalog()` both capture catalogs. It exposes no selected combined method; `lastPin()` stays null. Explicit binding remains a trusted caller configuration, not authentication or proof of human approval.

Both factories report the existing busy/closed/lastCode/hasPin snapshot fields plus `hasCatalogReceipt`. No mutable raw Buffer is returned publicly. Successful receipts contain source-sensitive metadata and are internal data, not public diagnostics.

## One physical flight and one deadline

All modes on an instance share one physical flight, including actual handle cleanup. A concurrent call to any mode returns `READER_BUSY`; there is no independent catalog flight that bypasses an active selected capture. Logical timeout or close returns promptly but retains physical ownership until the underlying read/close actually settles. Late completion cannot commit a pin or receipt.

The original monotonic budget is sampled once per capture. The source filesystem reads retain their original size limits, descriptor/path checks, observed no-link/root identity and stable-file evidence. Exact feed/catalog bytes are kept privately only in modes needing validation; unused current/manifest raw bytes are not retained. The raw receipt gate makes its own bounded copies, parses and hashes those SAME copies. The reader never substitutes JCS/serialized parsed objects for delivered-byte hashing.

The catalog backend initializes lazily on the first mode that needs it. Pinned local schema-resource reads, compilation, copying and synchronous validation all happen inside that flight's original budget. An active check follows synchronous validation, and the final monotonic fence precedes every public state commit. A delayed timer callback cannot admit a result that completed after its deadline. Backend failure has a fixed redacted code and can be retried after the underlying problem is corrected; neither a backend failure nor timeout fabricates a receipt.

These filesystem checks are observed confinement/race checks, not atomic security against a privileged process replacing ancestors during I/O. There are no source writes or scans. Existing pointer-once behavior remains unchanged: a newer pointer arriving during selected capture is considered only on a later flight.

## Accepted catalog floors versus transport observations

Only successfully completed validated catalog receipts establish the instance's catalog floor. Lower catalog sequence is stale; the same sequence with different exact delivered catalog bytes conflicts. This floor applies across all modes once present. A legacy transport-only `lastPin()` can contain headers that later fail full schemas; it never establishes or poisons the independently validated receipt floor.

Legacy `capture()` retains its prior transport catalog/generation comparison against `lastPin()`. The new combined method does not treat that unaccepted transport observation as a validated catalog or manifest floor. It checks the independently validated catalog floor, while its selected manifest remains transport-only. Full selected schema/integrity/problem/timing validation and durable per-selection version/digest acceptance must still happen before a coordinator records or uses a manifest fact. No successful combined result waives those gates.

A current pointer can legitimately name a newer generation than the captured catalog. Combined capture may pin generation2 while its catalog receipt still describes generation1. That receipt certifies only the catalog bytes/context; it does not certify selected manifest content or timing. Later timing proposals must use the verified selected manifest rather than stale catalog summaries.

A receipt and a later combined capture are two separate source observations. The later flight validates and reconciles its own actual catalog bytes again. Equal sequence alone cannot bless changed bytes, and a larger catalog version does not imply the named manifest or assets are available. On a failed combined capture, a caller wanting to retain a valid catalog fact must explicitly complete `captureCatalog()` and separately journal that receipt. The reader never persists from an I/O/validation callback, where timeout or close could race durable effects.

These in-memory floors are not a durable journal, multi-process exclusion or publisher authentication. The coordinator must apply the separately verified journal and its approved binding/epoch policy. Higher metadata, missing content and errors never reset accepted facts, Stop playback, delete a last-good deck or change its operating window.

## Tests and limits

The unchanged legacy metadata tests remain part of validation, including one real elapsed-clock late-completion regression. New synthetic filesystem tests cover catalog-only/no-tuple operation, missing/omitted/new-year selection, exact raw receipt/full-pin coherence, failed combined retention, stale/forked catalogs across modes and schema-invalid high legacy headers that cannot poison later validated captures. Shared BUSY, logical timeout with a real file-handle close still blocked, close, lazy backend recovery and a controlled monotonic-clock expiry during actual synchronous raw validation cover admission boundaries.

The controlled validation test holds its configured capture timer pending and advances its monotonic test clock when the independent gate hashes the captured catalog, after the reader already hashed the same bytes. It asserts the original timer remains armed at that point and no deadline callback ran. An outer real ten-second guard bounds the fixture. This proves the final deadline check before timer dispatch, not a real one-second validation duration. Actual filesystem reads/cleanup and raw gate execution remain real. Linux results do not establish Windows/Drive Desktop hydration, real placeholder arrival or target hardware behavior. Root must run full regression and final-SHA Windows CI before merge.

The new combined mode accepts repeated identical full catalog entries after the raw gate has verified their full-entry equality, and reads the selected current/manifest only once. Conflicting full entries fail the raw gate before either selected file is opened. Legacy transport capture deliberately retains its prior stricter repeated-selected-ID rejection; callers needing the aligned behavior must use the new combined method. No full59-step fixture acceptance is established here. Rollback removes the new methods/factory/test/document and restores the original reader without touching source files, journal history, media caches or output services.
