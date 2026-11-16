# Detached exchange fingerprint computation

This BE-006 module implements section4.5 of the approved draft0.3.1 exchange contract as pure bounded computation. It is not the importer, a full RFC8785 library for arbitrary numbers, or an acceptance/arming decision. Callers must first use the bounded duplicate-safe JSON reader and structural schema gate. Never pass arbitrary application objects or hostile Proxies; descriptor checks avoid accidental getters/toJSON execution but are not a JavaScript sandbox.

## Byte contract

`canonicalExchangeJSON(value)` emits the RFC8785 serialization within the contract's safe-integer domain: UTF8, no insignificant whitespace, recursively sorted UTF16 code-unit object keys, ECMAScript JSON string escapes and no Unicode normalization. Arrays retain order and duplicates. Safe signed integers are supported for canonicalization vectors, including negative zero serialized as0; actual source wire numeric fields remain nonnegative under the independent reader/schema rules. Fractions, nonfinite/unsafe numbers, unpaired surrogates, cycles, accessors, exotic objects, symbols, sparse arrays and extra/hidden array properties are rejected. Null-prototype JSON records and repeated noncyclic references are allowed. The serialized UTF8 budget is1MiB, at most300000 visited values and depth32. Invalid input throws only `FINGERPRINT_INPUT_INVALID`, without paths or source values.

`selectionId(tuple)` requires five strings and applies the same overall bounds. It hashes exact `JSON.stringify(tuple)` bytes (canonicalization of a string array is byte-identical), returning `sel_` plus the first32 lowercase hexadecimal digest characters. It does not normalize labels or enforce tuple semantic patterns; those are separate validators. Unicode length must not accidentally use UTF16 units to reject schema-valid labels with supplementary characters.

`selectionFingerprints(manifest)` validates the JSON domain/budget, resolves each occurrence's assetKey through the unique asset table and computes:

- Playback: SHA256 of canonical `{state: manifestState, occurrences: [[occurrenceKey, assetSHA256-or-null, problemCode-or-null], ...]}` in original occurrence order. Repeated media remains repeated. Missing/duplicate asset keys and malformed digest/reference/problem fields fail closed.
- Metadata: SHA256 of the canonical entire manifest with exactly five root fields omitted: generation, generationSequence, generatedAt, playbackFingerprint, metadataFingerprint. Matching names inside nested objects remain included.

The input is not mutated. Result objects are frozen, with `scope: fingerprint-computation`, `ready:false` and `semanticValidation:pending`. Results do not verify advertised digests, ID/descriptor equality, generation suffixes, calendar/eligibility semantics or media bytes. Empty/removed state hashing never sends Stop or deletes a last-good deck. A later layer must compare trustworthy computed hashes with advertised values and preserve the active deck/timer on metadata-only changes; this utility itself has no playback or timer side effects.

## Evidence and limits

Nine independently authored tests cover exact Unicode/key ordering, stable IDs, root-only exclusion, metadata-only changes, ordered repeated media, content/state/problem changes, missing/duplicate references, input mutation, fixed diagnostics and resource bounds. Root and a read-only reviewer each matched the supplied data-only vectors:8 SHA256 primitives,14 canonical strings,4 IDs and100 paired fingerprints (226 comparisons). Publisher scripts and attachment instructions were not executed; private fixtures are not copied into the repository. These finite comparisons support byte compatibility, not full V1–V20 acceptance or readiness. Unit tests explicitly use some structurally/semantically invalid records to isolate computation.

No dependencies, source integration or SPX behavior changes. Rollback removes the unused helper and its tests; existing local/manual preparation and caches are unaffected. Before merge, run syntax and complete baseline plus default final-SHA Windows/Ubuntu/browser/native CI. Remaining semantic validators, durable feed ledger, ordered verified assets and schema2 cache must precede source activation.

## Unicode transport compatibility

Independent review also found the reader's prior255-UTF16-unit binding cap falsely rejected schema-valid labels of200 supplementary Unicode code points. Raise that bounded transport cap to400UTF16 units. This deliberately remains an admission superset; per-field lengths/patterns still belong to the schema gate. An actual filesystem reader regression captures exact200-code-point identity and manifest digest, compares the helper's selection ID, and stays `ready:false`; a401-unit binding fails before I/O. Root and reviewer each passed27 focused fingerprint/transport tests with no skips. This is not a claim of complete schema/semantic validation of the envelope-only transport fixture.

Final local combined baseline:525 tests,498 passes,27 explicit Windows-only skips,0 failures; syntax139 files passed. This is Linux evidence, not a simulated Windows pass. Final-SHA CI and real Windows output evidence are still required before merge.
