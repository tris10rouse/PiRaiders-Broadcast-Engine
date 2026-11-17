# Ordered exchange snapshots and offline cache schema 2

`stageExchangeSnapshot()` prepares verified image content without activating it. It is separate from legacy `stageSnapshot()`, whose schema1 folder inventory and lexical ordering remain unchanged. No source provider, Game Day controls, journal writes, eligibility admission, operating-window approval, renderer or sender behavior is added here.

## Input and source boundary

The new stager takes `{sourceRoot, cacheDir, manifest, signal, ...lowerLimits}`. Before its first asynchronous operation it owns the source manifest through the existing accessor-rejecting, bounded 1MiB canonical JSON helper. It composes the existing schema, selection-integrity, problem-state and timing metadata gates, then requires a complete, nonempty selection whose occurrences all resolve to assets without problems. Timing metadata validation is not an approved window or current eligibility check. The caller must still supply the correctly bound, descriptor-verified captured manifest and separately apply durable accepted facts and activation policy.

Only literal registered `deliveryPath` files are read beneath the configured **To Engine root**, such as `assets/<sha>.png`; paths are not relative to a generation directory. The shared source root is never inventoried. Other generations, unrelated files and sync copies do not become members or cause an extra-file rejection. The source is never written.

Normalized source/cache paths must be disjoint before cache creation. Observed ancestor no-link checks, realpath containment, stable opened-descriptor/file signatures and root identity checks surround each bounded read. Source-root identity is checked again after the handle closes. Cache identity/no-link checks precede private writes and publication. These checks detect ordinary sync replacement and alias changes; they are not an atomic sandbox against privileged actors replacing paths between checks.

Every delivered image must match its declared length and exact SHA256. The unchanged `validateImage()` worker performs full PNG/JPEG decoding, and decoded format, width and height must match source metadata. Existing unsupported image variants remain unsupported; no file is silently dropped. A missing, short, changed, corrupt or unsupported asset rejects the entire candidate. The decoder retains its own memory, format and pixel safeguards and awaited worker termination.

## Limits and physical aliases

Hard ceilings are 500 source asset rows, 500 ordered occurrences, 20MiB per image, 512MiB aggregate, dimensions8192 and16,777,216 pixels. New count/byte/dimension limits and the per-image validation timeout may only be lowered; the timeout range is1–10000ms for this API. `maxEntries` also limits private cached media entries. Legacy compatibility options `quietMs` and `maxDepth` are range-checked but unused by this non-inventory stager/loader.

The 512MiB quota counts each unique `assetKey`/assets-array row once, not once per repeated occurrence. This follows contract5.6/V3/V7 conservatively. Matching aliases that share one delivery path and SHA may share one physical read/decode/cache file, but **do not reduce the asset-row quota**. Aliases must agree on declared length, MIME and dimensions. The actual unique physical total is checked as well. Supplied fixtures do not distinguish publisher alias policies; this interpretation is documented rather than claimed as independently proven publisher behavior.

A correct privately captured image remains useful after the source becomes unavailable. Playback never needs the source folder once a snapshot has been completely verified and registered.

## Private schema 2

A schema2 UUID directory has the same exact private root inventory as schema1: `manifest.json` and `media/`. Its manifest stores:

- `source`: feed/epoch, selection ID/identity tuple and verified source playback fingerprint. It deliberately omits generation and metadata fingerprint; a partial provenance record is not a certificate for source metadata acceptance.
- `files`: unique physical image metadata using the existing consumer fields and media URL pattern.
- `assets`: distinct source asset-key to physical-file references, retaining aliases.
- `occurrences`: source array order with opaque `occurrenceKey`, nullable `fileKey` and asset reference.

Controller slide IDs are SHA256 of a domain-prefixed occurrence key. They remain distinct when two slides share one image and remain stable when the bytes for a source occurrence change. Deck order comes from occurrences, not filenames or physical-file sorting. Unicode source keys are kept without normalization.

The cache content hash covers physical metadata, references, ordered occurrences and the stored provenance. Reordering occurrences changes content identity. The loader recomputes playback fingerprint from the complete ordered `[occurrenceKey, physicalSHA, null]` triples in state `complete`. It does not claim to recompute a metadata fingerprint from this subset. Human event-title/generation changes leave the current subset and content hash unchanged; other metadata-only changes such as source asset-key renumbering/reordering can change cache content hash while playback fingerprint stays the same. A future coordinator must compare verified **playback fingerprint**, not cache UUID/content hash, when deciding whether a Reload is needed.

The private cache hash is integrity/self-consistency evidence, not publisher authentication, durable feed acceptance or resistance to an administrator recomputing hashes. These snapshots do not replace the separate accepted-version journal.

## Publication, cancellation and loading

The stager creates a unique owned `.pending-<uuid>` directory and pins its identity and the media-directory identity. Cache and owned-directory identities are checked before writes and publication. Existing final paths are rejected; existing pending paths are not owned and are never cleaned. Cleanup re-verifies the same identities before removing a pending tree. If the root or either owned directory moves or is replaced, the replacement is preserved; the original moved tree may remain orphaned for explicit recovery. A pathname alone is not ownership. These are observed checks, not an atomic defense against privileged replacement between checks. Prior snapshots are retained. No code updates an active pointer, deletes old published content or emits Stop.

Cancellation is checked throughout reads, after decoding and before publication. A late abort after the rename is not acknowledged as prepared; the complete committed cache is left intact, with no activation. Cleanup is awaited. Disk/cleanup failure is a fixed error, not success or proof that an arbitrary filesystem operation was undone. This is ordinary UUID-directory publication, not an administrator-resistant filesystem transaction or general power-loss guarantee.

`loadSnapshot()` dispatches schema1/schema2. Its initial manifest read is bounded by the larger of the original legacy envelope and2MiB; schema1 still enforces its original configured byte ceiling after version detection. Schema2 independently enforces2MiB. This allows large ordered Unicode metadata without silently changing schema1's accepted manifest limit. Dispatch forwards the owned checked options, including the original abort signal, rather than rereading mutable caller options after I/O. Schema2 errors are converted to the legacy error type only inside that dispatch, preserving unchanged legacy error translation.

Offline schema2 loading validates strict shapes, counts, references, no orphan assets/files, IDs, both byte totals, playback/content hashes and exact private inventory. It then re-reads/full-decodes each unique physical file and rechecks every file plus root/media/manifest signatures after later files. Source folders are not consulted. The return shape stays compatible: `manifest.files` supplies unique route registrations and `deck.slides` supplies ordered occurrences. Existing media-handler authorization and exact URL allowlists remain unchanged.

## Evidence and rollback

Synthetic tests use actual generated PNG/JPEG bytes and worker decoding. Cases cover order/repeats, alias quota and single reads, stable occurrence IDs across changed bytes, human metadata-only identity, no source scans, ownership before I/O, exact hashes/lengths/dimensions/MIME, missing/growing/replaced files, source/cache root and directory junctions, abort, publish failure and pending collision, cache tamper/order/references/extra files, large Unicode metadata, offline loading, and schema1 compatibility.

One integration case registers a schema2 snapshot through the unchanged public media handler after removing its source, checks actual loopback HTTP bytes and403/404 defenses, then drives the existing controller through Launch/Next/Previous wrap with repeated image URLs. Its renderer is an explicit test adapter; this is not new Caspar/NDI or stadium evidence.

The decoder-boundary abort/timeout cases call the unchanged real validator, which starts an actual worker, then trigger cancellation or its captured deadline callback. They prove awaited worker cleanup/error propagation and no candidate acknowledgement. The timeout case is a controlled logical callback, **not a real4321ms elapsed-time measurement**. Existing real worker deadline regressions remain unchanged and are run separately.

Linux results do not establish Windows path/worker behavior, Drive Desktop hydration, full59-step source conformance or stadium compatibility. Original fixture trees with deliberately missing large assets remain separate from materialized positive variants. No private publisher/generator scripts or fixture trees are executed or published. Root must run full regression and final-SHA Windows CI. Rollback removes the unused new module/tests/document and restores the small loader dispatch; source files, old schema1 caches and output behavior remain intact.

## Retained Windows failure and ownership correction

Initial Windows CI at `0d062240ab4e1e5b4b4373aa158fbed0235651eb` failed five fault-injection cases in both runs (676 passes, five failures, two documented skips). Their hooks compared raw temporary paths with the stager's canonical paths. The fixture now resolves its temporary parent before constructing source/cache paths, checks canonical source equality, and asserts each intended mutation or cancellation was actually reached. One Boolean-only diagnostic records whether normalization changed the temporary path spelling; no path is logged. The exact Windows alias subtype remains unproven until fresh Windows execution. Product path checks, limits and deadlines are unchanged by the fixture correction.

Two additional real-filesystem regressions separately reproduced directory-ownership defects before the product fix: root replacement caused cleanup to delete a foreign same-named pending tree, and pending-directory replacement could be written and published. Both failed on the original implementation and passed after identity pinning. These are independent of the Windows fixture issue. Linux results do not establish corrected Windows behavior.
