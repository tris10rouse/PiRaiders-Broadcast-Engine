# Detached exchange selection-integrity gate

The draft0.3.1 transport reader can pin delivered bytes and the structural gate can validate their shape. Neither independently recomputes the advertised fingerprints or checks all manifest-internal identities and ordered references. `scripts/lib/exchange-selection-integrity.cjs` adds this narrow, read-only semantic subset. It remains unmounted from Game Day, source preparation, cache publication, output and arming.

## Boundary

`createExchangeSelectionIntegrityGate().validate(manifest)` accepts a decoded selection JSON value. It first serializes through the existing bounded safe-integer canonicalizer and parses an owned snapshot. This enforces the existing1MiB serialized-byte,32-depth and300000-node bounds before Ajv touches the value, rejects malformed Unicode/accessors/toJSON/non-JSON values and prevents later validation from mutating the supplied manifest. Decoded JSON is the boundary; this does not sandbox arbitrary hostile JavaScript proxies or monkey-patched host globals.

The existing fixed local schema gate then validates the complete selection schema, with its pinned Ajv/date-time backend and four static schema resources. No source-selected schema, external reference loading or network capability is added. No dependency is added. Schema initialization can read only its existing bundled static resources; validation performs no filesystem I/O or asset reads.

Only after that gate succeeds does the module check:

| Contract rule | Check |
|---|---|
| V1 | Ordered occurrence positions equal1…n exactly. |
| V2 | Occurrence keys are unique, independently of their media. |
| V3 | Asset keys are unique, every non-null occurrence reference resolves, and every asset is referenced. |
| V4 | Delivery path exactly equals `assets/<sha>.png` for PNG or `assets/<sha>.jpg` for JPEG. |
| V6 | Recomputed tuple-hash selection ID and tuple equality to school year, event key, target board, origin and normalized event label/season template key. Event board null maps only to empty tuple board. Origin-specific field shape remains enforced by the existing schema. |
| V7 | Repeated references are legal and retained; no deck deduplication occurs. |
| V18 | Both advertised fingerprints equal the independent computation over the manifest and ordered occurrence triples. |

The helper hashes only the safe-integer JSON domain of this contract. Canonical serialization accepts signed safe integers for its general test vectors; the selection schema separately requires the wire fields' specified nonnegative or positive domains.

The gate does not select a descriptor or parse generation paths. Existing metadata capture supplies descriptor selection, feed/epoch binding, generation-component checks, observed filesystem confinement, exact delivered manifest digest and pinned descriptor equality. A caller must compose those boundaries; passing this selection-only API does not certify a source envelope.

## Results and failures

Every result is immutable and carries `scope: selection-integrity`, `ready: false` and `semanticValidation: pending`. Success returns only the enumerated verified rules and explicit pending problem-state, calendar-window, asset-bytes, durable-ledger, eligibility-admission and descriptor-context areas; no manifest, asset URL, source identity or action instruction is emitted. Rejected candidates return an empty verified-rule list. Fixed codes distinguish invalid JSON input, schema, identity, order, references, path and fingerprints. Raw Ajv errors, source values, paths and exception details are not returned. Failure does not mutate either supplied input or the metadata reader's last pin.

A structurally valid complete manifest with purported one-byte PNG media may pass this subset because no image bytes are opened. The result never labels that media playable. Empty and removed metadata may pass their identity/integrity checks while remaining non-ready; neither is an instruction to Stop or discard a good deck. A valid recomputed metadata-only change can preserve playback identity, but this gate performs no Reload, timer reset or activation.

## Verification and remaining work

Synthetic tests exercise event and season identity, unresolved event boards, a200-code-point supplementary Unicode label, schema-valid forged IDs and field mismatches, re-signed position/key/reference/path failures, repeated assets, both forged advertised fingerprints, metadata-only and ordered playback changes, fixed diagnostics and input bounds. A real temporary four-document tree is captured through the existing metadata reader; all four schemas and the new selection integrity gate pass, without image files being created or read. Downstream fingerprint rejection retains the captured metadata pin. No attachment publisher code or private fixture tree is executed or committed.

This is not complete V1–V20 acceptance. Full problem/incomplete-state semantics, Chicago calendar/DST/window checks, byte/hash/full decode and aggregate staging limits, durable feed/sequence/rebind state, eligibility/admission for preparation or arming, and source-level external descriptor/cross-file acceptance remain separate gates. Internal tuple consistency does not match an externally expected feed/epoch/descriptor; compose metadata capture for that binding. Schema-valid event eligibility is not an arming authorization. File digest capture is distinct from semantic hashing. Native Windows CI and the complete regression suite remain root integration responsibilities; Linux focused tests do not establish Windows, Google Drive, NDI or stadium compatibility. No evaluation release is declared.

Rollback removes this unused module and its tests/document. Existing application services, schemas, media caches and output do not change.

Success describes only the owned JSON snapshot checked during that call. It is not a durable acceptance certificate for an object that a caller later mutates. Source integration must compose this result with the metadata reader's immutable pinned manifest/descriptor and the remaining gates; it must not prepare or activate a mutable original based on an earlier boolean result.
