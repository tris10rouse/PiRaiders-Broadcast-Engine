# Fixture results for the scheduler: contract draft 0.3.1 run through the Engine

Written 2026-11-19 by the Engine side for the scheduler side, which is waiting for these results before it builds the part of its publisher that writes the exchange folder.

- **What was run.** The scheduler's synthetic fixture pack (30 cases, 59 steps, and its golden vectors) through the Engine's real import modules on `master` `50bb524`, Node 22, Linux. The pack was read from a clone at run time. Nothing from it is stored in this repository; cases are named here by their number only (01 … 10a), and no fixture content is reproduced beyond field names and code values.
- **Method.** A harness outside both repositories feeds each step tree to the Engine's source coordinator (and, where a step names an earlier tree to be compared with, that tree first on the same journal). It checks nothing itself. Two runs gave byte-identical results. The harness is not in this repository because it embeds knowledge of the private pack; the method is described below so that it can be rebuilt.
- **Synthetic data only.** No real event, file identifier, board or person is involved.
- **Limits of this run.** Linux only. No Windows, no synced-folder client, no hardware. The three largest-byte steps were not run in the pack run itself (their pictures are not in git); they were rebuilt from their recipes separately, see "Large pictures" below.

## What the scheduler side should take from this

1. **The Engine accepts the pack.** 43 of 59 steps pass outright; 15 are scope gaps where the remaining expectation is the publisher's private state or bytes not in git; 1 step differs (05j step 2), and there the Engine's reading is that the expectation is a publisher self-check, not an importer verdict.
2. **All 234 golden vectors match**, including the eight Central-time vectors.
3. **Two real conformance gaps were found on the Engine side** (both are Engine defects against section 5.6, to be fixed in the Engine, no contract change asked):
   - **Large JPEGs.** The Engine rejects every JPEG above roughly 9.2 megapixels (4:2:0), 6.1 (4:4:4) or 13.4 (greyscale) with `IMAGE_DECODE_FAILED`, although section 5.6 allows 16,777,216 pixels. The cause is the decoder's memory budget, not time. A 12-megapixel phone photo fails. PNGs are not affected: the pack's own 4096 x 4096 picture decodes in about 0.3 s against a 10 s limit. **Until the Engine is fixed, a selection published as `complete` that contains such a JPEG cannot be prepared.** The pack does not catch this because its limit cases 09a to 09c are PNG only (proposal 11).
   - **Total bytes with repeated identical bytes.** Section 5.6 counts each distinct picture once. The Engine adds every asset row. If the publisher emits one asset row per source file even when several source files hold identical bytes, a selection the publisher calls `complete` can be refused by the Engine with `TOTAL_LIMIT` (shown with 26 source files of identical 20 MiB bytes). Either the Engine must count each SHA-256 once, or the contract must say that asset rows are unique by SHA-256 (proposal 12).
4. **Twelve proposals** for the pack and the contract are listed at the end. None was applied: the schemas and the contract are unchanged on the Engine side, and the four schema files are still byte-identical on both sides.

## Result

| | PASS | SCOPE GAP | FAIL |
|---|---|---|---|
| Cases (30) | 17 | 12 | 1 |
| Steps (59) | 43 | 15 | 1 |
| Single comparisons with `expected.json` (374) | 342 equal | 29 not observable by the Engine | 3 different (all in one step) |

- **The one FAIL is case 05j, step 2.** The Engine accepts a tree that `expected.json` calls invalid. Judgment: the expectation is a publisher-side whole-tree audit, not something a consumer that follows descriptors can or should see (details below).
- **Every SCOPE GAP is one of four kinds:** publisher-private state (`orphans`, `publisher.*`: 24 comparisons), image bytes that are not in git (3 steps), a tree inventory count (1), and one step where the Engine refuses at a different check than the one the step names (05j step 3).
- **Golden vectors: 234 of 234 recomputed values match** (table below).
- No pack step made the Engine accept something the contract clearly says to refuse. Two supplementary probes, which are not pack steps, did (catalog event timing; a catalog entry's `occurrenceCount`): see "Supplementary probes".

## How the pack was fed to the Engine

### Entry points on master

| Concern | Highest-level real composition used | What it composes |
|---|---|---|
| Metadata of a To Engine tree (schemas and cross-file rules) | `createExchangeSourceCoordinator(...)` in `scripts/lib/exchange-source-coordinator.cjs`: `refreshCatalog()`, then `prepareSelection(identityTuple)` for every selection the accepted catalog lists | `exchange-metadata-reader.cjs` (strict JSON through `exchange-json.cjs`, feed and catalog headers, descriptor grammar, `manifestSha256`, descriptor against manifest), `exchange-catalog-receipt.cjs` (feed and catalog schemas, catalog-entry identity and path grammar), `exchange-schema-gate.cjs` (all four documents, coordinator line 254) |
| Fingerprints and `selectionId` | the same call: coordinator line 259 runs the gate chain `exchange-timing.cjs` → `exchange-problem-state.cjs` → `exchange-selection-integrity.cjs` → `exchange-fingerprints.cjs` | V1–V4, V6, V7, V18 (integrity), V5 and V20 (problem state). For the vectors the three exported functions `canonicalExchangeJSON`, `selectionId`, `selectionFingerprints` are called directly |
| Timing | the same call (`createExchangeTimingGate().validate(manifest)`) | V13, V19; review flags. Manifests only; there is no local-time conversion function |
| Ledger and journal across steps | the same call: `exchange-journal.cjs` (`open`, `append`) over `exchange-ledger.cjs` (`proposeExchangeLedgerEvent`) | binding (feedId, epoch), catalog fact, manifest fact: sequence order, same-sequence conflict (V10, V16), epoch |
| Image and asset readiness | the same call: `stageExchangeSnapshot` (`exchange-snapshot.cjs`), limits first (coordinator lines 66–77), then per file length → SHA-256 → full decode (`image-validator-session.cjs` → `image-decode-core.cjs`) | V12 and the 5.6 bounds |
| One layer above | `exchange-source-provider.cjs` (`refreshCatalog()`, `inspectSelection()`), the layer the Game Day manager talks to | Run as a cross-check on every step tree after the coordinator, same journal: 59 trees, 141 selections, **0 differences** in catalog code, metadata verdict, fingerprints, sequence, state and eligibility. Preparing content through the provider needs a prepared-event profile and an eligible event (admission policy); that path was not run |

The Engine holds no copy of the pack. Its own tests carry one `selectionId` vector, the eight Chicago vectors as data, and independently written variants of the schema-probe categories (`tests/exchange-fingerprints.test.cjs`, `tests/exchange-timing.test.cjs`, `tests/exchange-contract-probes.test.cjs`; 27 of 27 pass on master).

### What the harness does and does not do

- For every step: a fresh journal and cache in a scratch folder outside both repositories, the operator binding taken from `feed.json` of the first tree in the chain, then the `checkedAgainst` tree (when `expected.json` names one) through the Engine, then the step tree through the Engine on the **same journal**, so the ledger carries over. 19 steps have such an earlier tree.
- The harness validates nothing itself and never changes an input. It asks the Engine, then projects the Engine's per-selection results onto the pack's whole-tree words:
  - **valid** = the Engine refused nothing.
  - **ready** = valid, the catalog was accepted, and every catalogued selection ended `CONTENT_PREPARED` (bytes read, hashed, fully decoded, staged) or was accepted in a state with nothing to play (`incomplete`, `empty`, `removed`). The Engine's own `ready` flag is always `false`: arming is a later operator step.
  - **waiting, not refused** (the pack's `notReady`): `INPUT_UNAVAILABLE` (a named document is not there yet), `SNAPSHOT_IO` with a named asset file absent, `LENGTH_MISMATCH`, `HASH_MISMATCH`, `DESCRIPTOR_CONTEXT_INVALID`. This split is the harness's reading; the Engine returns codes, not "wait" or "refuse".
- The Engine reports codes, not rule numbers. To name the deciding line, the harness records the stack of each Engine error (the global `Error` constructor is wrapped before the Engine loads; no Engine file is touched). A run without the wrapper gives the same Engine verdicts on all 59 steps. Code and line are then mapped to contract rules (table at the end). The line numbers are for 50bb524.
- The Engine stops at its first refusal. Where a step lists several rules, the step passes if the refusal maps to one of them; a rule the coordinator did not reach is shown, where possible, by calling the lower-level module on the same input, and this is said in the step's note.
- Classification of a step: FAIL if any comparison differs; otherwise SCOPE GAP if any comparison is not observable by the Engine; otherwise PASS. A case takes its worst step.

## Cases

| Case | Steps | Result | Reason |
|---|---|---|---|
| 01 | 1 | PASS | Two selections prepared; `selectionId`s differ, playback fingerprints equal; the shared asset staged once |
| 02 | 1 | PASS | Three selections prepared; `labelShared`, distinct identities, three assets |
| 02c | 1 | PASS | Event selection accepted as `incomplete` with `BOARD_UNRESOLVED` on every row; season selection prepared |
| 03a | 1 | PASS | Repeats kept: three occurrences over two assets give three slides from two files (V7) |
| 03b | 1 | PASS | Occurrence order as published |
| 03c | 2 | PASS | Identity kept across the reorder, new identity for the renamed button, `removed` generation accepted with no content. Named comparisons resolved from the generator (proposal 2) |
| 04 | 4 | PASS | All four steps in order on one ledger; new bytes change playback, tick-only keeps it; `incomplete`, `empty`, `removed` accepted with nothing to play |
| 05a | 2 | SCOPE GAP | Engine part equal (step 1 waits: no catalog, V14; step 2 accepted after it with the skipped sequence). `orphans` and `publisher.*` are publisher-side |
| 05b | 2 | SCOPE GAP | Both exports accepted in order (catalog 1 then 2). `orphans` is publisher-side |
| 05c | 4 | PASS | Steps 1–3 valid and waiting (manifest absent; asset absent; manifest absent), step 4 prepared |
| 05d | 3 | PASS | Step 2 refused: same catalog sequence, other bytes (V16, `exchange-ledger.cjs:135`). Step 3 refused at the same check; V10 shown with the ledger module |
| 05e | 2 | SCOPE GAP | Epoch 2 tree accepted, sequences go on. `orphans` is publisher-side |
| 05f | 1 | SCOPE GAP | Accepted after its earlier tree. `orphans`, `publisher.lease`, `.fence`, `.refused` are publisher-side |
| 05g | 1 | SCOPE GAP | Accepted; the dropped selection is absent from the catalog as expected. `orphans`, `publisher.dirty` are publisher-side |
| 05h | 1 | SCOPE GAP | Accepted after its earlier tree with the expected skipped sequence. `orphans` is publisher-side |
| 05i | 1 | SCOPE GAP | Accepted at epoch 2 with the expected sequences. `orphans` is publisher-side |
| 05j | 4 | **FAIL** | Step 2: the Engine accepts; no descriptor names the misplaced manifest. Step 3: refused, but at a different check than V17 (scope gap). Steps 1 and 4 pass |
| 05k | 2 | PASS | Step 1: V18 at `exchange-selection-integrity.cjs:64`. Step 2: refused earlier at the catalog entry; V18 shown with the integrity gate on the same manifest |
| 05l | 1 | PASS | Same playback fingerprint, different metadata fingerprint, sequence 2 (name resolved from the generator) |
| 05m | 1 | SCOPE GAP | Accepted after its earlier tree. `publisher.lease`, `.refused`, `.trashed` are publisher-side |
| 06 | 2 | SCOPE GAP | Step 1 waits (`LENGTH_MISMATCH` on the replaced file; the duplicate-named copy is never read). Step 2 prepared; `assetFiles` is a tree inventory, `publisher.*` is publisher-side |
| 07 | 1 | PASS | 29 comparisons: eligibility, instants, sources, windows and `unavailableReasons` as the Engine accepted them; the omitted event is absent; all six manifests pass the timing gate |
| 09a | 2 | SCOPE GAP | Step 1 valid and waiting, as expected for the tree in git; the exact-20 MiB decode was not run (bytes not in git). Step 2 passes |
| 09b | 2 | PASS | The 8,192 px image is decoded and prepared; 8,193 px is `incomplete` with `LIMIT_EXCEEDED/dimensions` |
| 09c | 2 | SCOPE GAP | Step 1 valid and waiting; the 16,777,216-pixel decode was not run (bytes not in git). Step 2 passes |
| 09d | 2 | PASS | 500 occurrences prepared (500 slides); 501 is the bounded diagnostic, accepted with nothing to play |
| 09e | 2 | PASS | 500 different images read, hashed, decoded and staged in one call (under 2 s here); 501 is the bounded diagnostic |
| 09f | 2 | SCOPE GAP | Step 1 valid and waiting; the 512 MiB set was not run (26 files not in git). Step 2 (`LIMIT_EXCEEDED/total_bytes`) passes |
| 09g | 1 | PASS | Three bounded diagnostics accepted: `occurrenceCount` 0, `observed` and `limit` as expected |
| 10a | 7 | PASS | All seven refused: schema (steps 1, 2, 3, 6 on the manifest; step 5 on the catalog), V15 (step 4), V20 at JSON parsing (step 7) |

## Steps that are not a plain PASS

### FAIL: 05j, step 2

| | |
|---|---|
| Expected | `valid: false`, `ready: false`, `errors: ["V10", "V15"]` |
| Engine | catalog `CATALOG_ACCEPTED`; all three catalogued selections `CONTENT_PREPARED`; nothing refused → valid, ready. There is no Engine code or message because nothing is refused |
| What decides it | `scripts/lib/exchange-metadata-reader.cjs:36` builds the only manifest path it will open from the descriptor (`selectionId` + `generation`), and line 97 opens exactly that path. No exchange module lists a `generations/` folder: the only directory listings are the journal's own folder (`exchange-journal.cjs:75`), the approval store (`exchange-approval-store.cjs:87`) and a cache snapshot (`exchange-snapshot.cjs:513`) |

What the step contains: compared with its own `before-1` tree, **one file is added and nothing else differs**. `feed.json`, `catalog.json`, every `current.json`, every pinned manifest and every asset are byte-identical. The added file is a byte-identical copy of another selection's pinned manifest, placed under this selection's folder with a generation folder name that matches none of its own fields (selection, generation, sequence, fingerprint prefix). No `current.json` and no catalog entry names it. As a document it passes every Engine manifest gate (schema, selection integrity, problem state, timing).

Judgment: **the expectation is wrong as a consumer expectation; the Engine is right.** The contract wording contributes, because V10 and V15 do not say in so many words that they apply to pinned documents only.

- V15 is a rule about the pointer: each `manifestPath` must be exactly the path its own selection and generation imply. Every `manifestPath` in step 2 is.
- Section 4.7 defines what the Engine reads: it picks one descriptor, checks the path, then reads that manifest. A file no descriptor names is never opened.
- Section 4.2 calls a manifest that never becomes current an unreferenced, harmless orphan. Cases 05a, 05b, 05e, 05f, 05g, 05h and 05i expect `valid: true` with one to four such unpinned manifests in the tree.
- V10 is about the same feed, epoch, selection and sequence carrying different bytes. By its own fields the added manifest belongs to the other selection; it shares a sequence with this selection only through the folder it sits in.
- The two expected errors come from the publisher's reference validator, which parses every manifest in the tree and compares it with its folder. That is a sound publisher self-check, not a verdict an importer reaches.

The Engine does refuse the same file once a descriptor points at it: a scratch copy of step 2 in which that folder's `current.json` and catalog entry name the misplaced manifest is refused with `METADATA_INVALID` at `exchange-metadata-reader.cjs:99` (descriptor against manifest, V17). That copy is not a pack step.

### SCOPE GAP: 05j, step 3

- Passed: `valid: false`, `ready: false`.
- Not checkable as stated: `errors: ["V17"]`. The step changes `manifestState` in `current.json` only. The catalog entry still carries the true value, so the Engine first sees two descriptors with the same `generationSequence` that disagree and refuses with `METADATA_CONFLICT` at `exchange-metadata-reader.cjs:96`, before it compares either with the manifest. The nearest written rule is V16; the refusal also follows from V17 applied to both descriptors.
- The Engine does enforce V17 itself: a scratch copy in which the catalog entry states the same changed value is refused with `METADATA_INVALID` at `exchange-metadata-reader.cjs:99`.

### SCOPE GAP: publisher-side expectations (05a, 05b, 05e, 05f, 05g, 05h, 05i, 05m, 06 step 2)

Missing on the Engine side: nothing; these are not observable by design. `orphans` counts manifests no descriptor names (9 comparisons). `publisher.lease`, `.fence`, `.dirty`, `.refused`, `.trashed` are the publisher's private state (15 comparisons). Everything else in these steps equals `expected.json`; see point (b).

### SCOPE GAP: 06, step 2, `assetFiles`

Expected 5 asset files in the tree. The Engine read, hashed, decoded and staged the 4 distinct files the pinned generations name. The fifth is named only by a superseded generation; the Engine never lists the assets folder.

### SCOPE GAP: bytes not in git (09a step 1, 09c step 1, 09f step 1)

Passed: the tree as it is in git is valid and waits for bytes (`SNAPSHOT_IO` with the named asset file absent, mapped to V12), exactly as `expected.json` says, and the manifest-level expectations (state, occurrences, asset count) are equal. **Not run in the pack run (bytes not in git; rebuilt and run separately, see "Large pictures"):** the complete variants, where the Engine must read and fully decode an image of exactly 20 MiB, an image of exactly 16,777,216 pixels, and 26 images totalling exactly 512 MiB.

### PASS with a note

| Step | Note |
|---|---|
| 05c step 3 | Expected `notReady: ["V12", "V9"]`. The Engine reports one reason to wait (the catalog entry's manifest is absent, V12). The coordinator's V9 wait (`DESCRIPTOR_CONTEXT_INVALID`, coordinator line 258) is not reached by any pack step |
| 05d step 3 | Expected V10 and V16. The coordinator stops at the catalog fact (V16). The ledger module, given the manifest fact of the same tree, answers `LEDGER_CONTENT_CONFLICT` (V10). A scratch copy with the next `catalogSequence` reaches it on the import path: catalog accepted, that selection refused with `JOURNAL_EVENT_REJECTED` ← `LEDGER_CONTENT_CONFLICT` (`exchange-ledger.cjs:135`, called from line 167) |
| 05k step 2 | Expected V18. The coordinator refuses earlier: the catalog entry's `generation` name does not carry the first 12 hex of its forged `metadataFingerprint` (`CATALOG_RECEIPT_CONTEXT_INVALID`, `exchange-catalog-receipt.cjs:80`). The integrity gate run on the same manifest answers `SELECTION_FINGERPRINT_INVALID` (V18) |
| 10a step 2, step 5 | Expected schema plus V19 (step 2) or V15 (step 5). The schema gate refuses first; the second rule cannot be shown separately for the same defect |
| 03c step 2, 04 steps 2–3, 05l step 1 | Ten `same:`/`differs:` comparisons use names `expected.json` never defines; resolved from the generator source (proposal 2). With that resolution all ten are equal |

## Golden vectors (`vectors.json`)

| Group | Vectors | Match | Mismatch | Recomputed with |
|---|---|---|---|---|
| SHA-256 | 8 | 8 | 0 | `node:crypto` `createHash('sha256')`: the primitive every Engine module calls inline. The Engine exports no SHA-256 function of its own |
| JCS canonical form | 14 | 14 | 0 | `canonicalExchangeJSON` |
| `selectionId` | 4 | 4 | 0 | `selectionId` |
| Chicago instants | 8 | 8 | 0 | the timing gate, each local time offered with both offsets on a carrier manifest: 5 instants direct, 1 reason direct, 2 reasons by inference (point c) |
| `playbackFingerprint` | 100 | 100 | 0 | `selectionFingerprints` |
| `metadataFingerprint` | 100 | 100 | 0 | `selectionFingerprints` |

In addition, all 100 golden manifests pass the Engine's whole manifest gate chain (`TIMING_VALID`).

## The three points raised earlier

The earlier Engine agent wrote (`docs/agent/CODEX_CHECKPOINT.md`, spacing as in the source): "05j step2 is malformed unpinned orphan static audit, not selected import; publisher lifecycle and8 local-time reason vectors are unproven/inconclusive." And: "05j step2 is a full-tree audit of an unpinned malformed orphan; selected importer must not scan orphan generations to satisfy it. Publisher lease/dirty/GC behaviors remain publisher-side evidence, not claimed Engine tests."

### (a) 05j step 2: the objection holds

- Step 2 is its `before-1` tree plus one unpinned file (evidence in the FAIL section). The step does not show a consumer what the case title says ("a manifest in another selection's folder" being refused), because nothing points at that manifest.
- "Unpinned" and "static audit" are accurate. "Malformed" is accurate only for the file's place: its content is a valid manifest that passes every Engine gate.
- The Engine accepts the tree and, on current master, could reject it only by listing generation folders, which the contract does not ask for and 4.2 argues against.

### (b) Publisher lifecycle (05a, 05f, 05g, 05h, 05i, 05m): "unproven by the Engine" is correct, and cannot be otherwise

Of the 51 comparisons in these six cases, 32 are observable and all 32 are equal; 19 are not observable; none differs.

| Case, step | The Engine observes (all equal) | The Engine cannot observe |
|---|---|---|
| 05a step 1 | `valid`, `ready`, waits for the catalog (V14) | `orphans`, `publisher.lease`, `.refused` |
| 05a step 2, after step 1 | `valid`, `ready`, `catalogSequence`, both selections' `state` and `seq` (the skipped number is visible, the reason is not) | `orphans`, `publisher.lease`, `.fence`, `.dirty`, `.refused` |
| 05f step 1, after `before-1` | `valid`, `ready`, `catalogSequence`, `seq` | `orphans`, `publisher.lease`, `.fence`, `.refused` |
| 05g step 1 | `valid`, `ready`, `catalogSequence`, `seq`, the dropped selection's absence | `orphans`, `publisher.dirty` |
| 05h step 1, after `before-1` | `valid`, `ready`, `catalogSequence`, `seq` (skips the orphan's number) | `orphans` |
| 05i step 1 | `valid`, `ready`, `catalogSequence`, epoch 2, `seq` | `orphans` |
| 05m step 1, after `before-1` | `valid`, `ready`, `catalogSequence` | `publisher.lease`, `.refused`, `.trashed` |

What the Engine adds as evidence: in the four steps with an earlier tree, the ledger that had accepted the earlier tree accepted the step, so no sequence went backwards and no same-sequence content changed. Why a number was skipped, who held the lease, what was refused, what was trashed and which dirty mark survived are proven only by the publisher's own tests and its `publisher/step-<n>.json` records.

### (c) "8 local-time reason vectors": all eight are reproduced; none is missing, two only by inference

`vectors.json` has exactly eight `instants` entries: five give an instant, three give a reason. The Engine has **no function that turns a local time into an instant or a reason**; its timing gate validates a wire instant (with offset) inside a manifest. Each local time was therefore offered to `createExchangeTimingGate().validate` with both offsets:

| Vector | Kind | Engine | How |
|---|---|---|---|
| 1 | reason `AMBIGUOUS_LOCAL_TIME` | both offsets `TIMING_VALID`, each with review flag `AMBIGUOUS_LOCAL_TIME` | direct, same name |
| 2, 3, 5, 7, 8 | instant | exactly the expected offset `TIMING_VALID`, the other `TIMING_INSTANT_INVALID` | direct |
| 4, 6 | reason `NONEXISTENT_LOCAL_TIME` | both offsets `TIMING_INSTANT_INVALID` | inferred: the Engine has no code of that name |

- The Engine's own test already asserts the same eight as data and passes on master (`tests/exchange-timing.test.cjs`, "the eight supplied local-instant vectors …"). So "unproven" no longer holds for the vectors.
- What the Engine has no equivalent for is **checking a published reason**. In case 07, three selections publish six `unavailableReasons` entries (two `START_NOT_DEFINED`, two `END_NOT_DEFINED`, one `AMBIGUOUS_LOCAL_TIME`, one `NONEXISTENT_LOCAL_TIME`). The Engine carries them through unchanged (the pack's `unavailable` expectations are equal) and answers each of those selections with `INSTANTS_UNAVAILABLE` and `SOURCE_TIMING_UNAVAILABLE`, `timingAvailable: false`. It cannot recompute the two daylight-saving reasons, because the instant they concern is `null` on the wire and the local time is not published.

## Supplementary probes (not pack steps)

Each uses real pack trees; five use a scratch copy with one deliberate change, described in the row.

| Probe | Result |
|---|---|
| 05e with the ledger carried from step 1 (epoch 1) into step 2 (epoch 2) | Refused with `REBIND_REQUIRED` (`exchange-metadata-reader.cjs:75`) until the operator's `confirm-binding`; then accepted, catalog sequence 2 and generation sequences 2 at epoch 2, as 4.1 and 4.6 say |
| 05b fed newer first, then older | The older catalog is refused: `JOURNAL_EVENT_REJECTED` ← `LEDGER_STALE` (`exchange-ledger.cjs:132`); the ledger keeps sequence 2 |
| 05d step 3 with the next `catalogSequence` | V10 on the import path (see the note above) |
| 05j step 2 with the descriptor pointing at the misplaced manifest | Refused, V17 (see the FAIL section) |
| 05j step 3 with agreeing descriptors | Refused, V17 at `exchange-metadata-reader.cjs:99` |
| 07 step 1 with the wrong seasonal offset on one **catalog** event's four instants (manifest untouched) | **Accepted.** The Engine applies V13 and V19 to the selected manifest only; catalog event timing is schema-checked. The Engine's own design note says so (`docs/design/EXCHANGE_TIMING.md`, last paragraph). The publisher's validator applies V19 to catalog events too |
| 01 step 1 with one catalog entry's `occurrenceCount` one too high | **Accepted.** The Engine compares the descriptor fields of 4.7; `occurrenceCount` is not one of them. The publisher's validator reports that difference as V17 |

## Proposals (nothing was edited)

1. **05j step 2: make it a consumer case or mark it publisher-side.** Shown by: the FAIL above. Either move its `errors` to a publisher-only field (as `publisher` and `orphans` already are) and expect `valid: true, ready: true`, or replace the tree with one where `current.json` and the catalog entry name the misplaced manifest. In the contract, add to V10 and V15 that they apply to documents a descriptor names, and that the Engine never reads a manifest no descriptor names (4.2 already calls it a harmless orphan).
2. **Write the comparison names into `expected.json`.** Shown by: 03c step 2, 04 steps 2–3, 05l step 1 (ten comparisons). `same:<name>` and `differs:<name>` refer to names kept only in the generator's `prior` object; the pack's guide says they are named in that step or an earlier one. Put `name` on the earlier step's selection, or write `prior` out with the tree it comes from.
3. **05j step 3: isolate V17, and word V16 as the Engine applies it.** Shown by: the scope gap above. Change `manifestState` in the catalog entry too, or expect `errorsInclude` with V16. V16 names only "a different `manifestSha256`"; the Engine refuses any differing descriptor field at the same sequence, which section 4.7 (values from two descriptors are never mixed) implies. Say so in V16.
4. **05d step 3: add a step where only V10 remains.** Shown by: the note on 05d and its probe. Give the changed manifest a catalog with the next `catalogSequence`.
5. **Say whether V13 and V19 cover `catalog.json` event timing, and add a probe.** Shown by: the 07 probe. If they do, the Engine has a gap to close (it is documented on its side); if the manifest is the only authority, the contract should say that catalog timing is display-only until a manifest is verified. Also say whether a catalog event header must equal the `event` block of the manifests at the same generation.
6. **Say whether `occurrenceCount` is part of the checked descriptor.** Shown by: the 01 probe. V17 lists nine fields without it; 4.7 lists eleven without it; the publisher's validator checks it. Add it to V17 (and a probe), or state that it is informational.
7. **State the consumer's "wait" conditions next to V9, V12 and V14.** Shown by: 05c, 06 step 1, 09a/09c/09f step 1. `expected.json` separates "valid, not ready" from "not valid", but the contract has no list of which conditions are waits. In particular: an asset file present under the right name with the wrong length or hash is a wait in 06 step 1; say so, and for how long (5.6 gives 15 minutes for a missing asset only).
8. **Timing reasons a consumer cannot check.** Shown by: point (c) and case 07. Either state that `AMBIGUOUS_LOCAL_TIME` and `NONEXISTENT_LOCAL_TIME` are source-owned and unverifiable, or publish the unresolved local time. Also decide the case 07 detail that the two events with such a start still carry a non-null `broadcastWindow.startsAt` with `startSource: event_type_lead_tail`: the contract does not say from which candidate instant a lead is taken when the start itself has no single instant.
9. **Vectors for a validating consumer.** Shown by: point (c). For each reason vector add what each offset must yield on the wire (accepted with an ambiguity flag; refused), since the Engine validates instants and never converts local times.
10. **An epoch-reset expectation with history.** Shown by: the 05e probe. 05e step 2 is checked on its own (`checkedAgainst: null`). Add the expectation 4.1 states: after step 1, step 2 is "rebind required" until the operator confirms.

Engine-side observations, no contract change: `JOURNAL_EVENT_REJECTED` hides which ledger rule fired (stale, same-sequence conflict, sequence reused, rebind) from the caller; `SNAPSHOT_IO` for an absent asset file is indistinguishable from other I/O faults at the result level; the coordinator prepares content for an event whose eligibility is false (2 selections in case 07) and reports `admissionEligible: false`, leaving the refusal to the provider.

## Not determined

- The three complete large-byte variants (exactly 20 MiB, exactly 16,777,216 pixels, exactly 512 MiB) were not part of the pack run (bytes not in git). They were rebuilt and run separately: see "Large pictures" below. Why the earlier agent's run of them was slow is not determined.
- Windows and Drive for desktop behaviour (placeholders, UNC and drive-letter paths, case aliases): this run is Linux only.
- Content admission through the source provider (`createPreparedMedia` with a prepared-event profile, an operator window and eligibility): not run; only its metadata calls were cross-checked.
- The earlier agent's `COORDINATOR_TIMEOUT` at 60 s on the 500-asset step (`docs/planning/IMPLEMENTATION_BACKLOG.md`): not reproduced; here that step prepares in under 2 s. Whether the cause was the machine or code since changed was not investigated.
- Rules hidden behind an earlier refusal on the same input: V19 in 10a step 2, V15 in 10a step 5, V9 in 05c step 3.
- V14 beyond a missing catalog (a selection missing from the catalog, a school-year change): no pack step exercises it.
- Whether `ready: true` in `expected.json` is meant to include a full decode. The publisher's validator checks arrival, length and SHA-256; the Engine also decodes every image. All in-git images decoded.

## Engine code to contract rule (as used by the harness, master 50bb524)

| Engine code and site | Rule |
|---|---|
| `METADATA_INVALID` from `exchange-json.cjs` (duplicate key, BOM, non-integer, unsafe integer) | V20 |
| `CATALOG_RECEIPT_SCHEMA_INVALID`; `METADATA_SCHEMA_INVALID` (coordinator line 254); `SELECTION_SCHEMA_INVALID` | schema |
| `REBIND_REQUIRED` (reader line 75); `METADATA_INVALID` at reader line 96 (current.json header); `CATALOG_RECEIPT_BINDING_MISMATCH` | V11 |
| `UNSAFE_INPUT` (reader line 36: `manifestPath` is not the path its descriptor implies) | V15 |
| `CATALOG_RECEIPT_CONTEXT_INVALID` at receipt lines 59–62, 73–74 | V6 |
| `CATALOG_RECEIPT_CONTEXT_INVALID` at receipt line 80 (generation name parts, path) | V15, V17 |
| `METADATA_CONFLICT` at reader line 96 (two descriptors, same sequence, differ) | V16 |
| `METADATA_INVALID` at reader line 97 (`manifestSha256`) | V8, V9 |
| `METADATA_INVALID` at reader line 99 (descriptor against manifest) | V17 |
| `SELECTION_IDENTITY_INVALID` / `_ORDER_` / `_REFERENCES_` / `_ASSET_PATH_` / `_FINGERPRINT_INVALID` | V6 / V1, V2 / V3 / V4 / V18 |
| `PROBLEM_STATE_INVALID`, `PROBLEM_BOARD_INVALID`, `PROBLEM_LIMIT_INVALID` / `PROBLEM_SCOPE_INVALID` | V5 / V20 |
| `TIMING_CALENDAR_INVALID`, `TIMING_INTERVAL_INVALID` / `TIMING_INSTANT_INVALID` | V19 / V13, V19 |
| `JOURNAL_EVENT_REJECTED` ← `LEDGER_CONTENT_CONFLICT` on the catalog fact / on a manifest fact | V16 / V10 |
| `JOURNAL_EVENT_REJECTED` ← `LEDGER_STALE` / `LEDGER_SEQUENCE_REUSED` | 4.1 / 4.6 |
| `INPUT_UNAVAILABLE` on feed or catalog / on a document a descriptor names | wait: V14 / V12 |
| `DESCRIPTOR_CONTEXT_INVALID` (coordinator line 258) | wait: V9 |
| `SNAPSHOT_IO` with a named asset absent, `LENGTH_MISMATCH`, `HASH_MISMATCH` | wait: V12 |
| `ASSET_PLAN_LIMIT`, `LIMIT_EXCEEDED` | 5.6 bounds |

## Large pictures (run separately from the pack run)

The three steps whose pictures are not in git were rebuilt from their recipes in a scratch folder (each rebuilt file matched the SHA-256 the pack expects) and run through the Engine's real staging and cache-reload calls. Linux, 2 virtual CPUs, local disk.

| Step | What | Result |
|---|---|---|
| 09a step 1 | one picture of exactly 20 MiB | validates in about 0.3 s; passes |
| 09c step 1 | one PNG of exactly 16,777,216 pixels (4096 x 4096) | staged in 0.3 to 0.6 s, reloaded from cache in 0.3 s, against the 10 s per-picture limit; passes |
| 09f step 1 | 26 pictures totalling exactly 512 MiB | staged in 4.0 to 4.4 s, reloaded in 3.8 to 3.9 s, against a 30 s default operation limit; passes |

The earlier Engine agent recorded a timeout (14.7 s) on a 4096 x 4096 picture and 40.9 s for the 512 MiB set. Neither was reproduced; the cause of the earlier numbers is not determined. The slowest contract-legal PNG that could be constructed (16-bit RGBA noise, 19.6 MB) takes about 3.0 s on an idle machine and exceeds the 10 s limit only with eight competing processes on two CPUs. The limit is fixed in code on this path.

JPEG at the pixel limit is the conformance gap described at the top:

| JPEG | Megapixels | Result on `master` |
|---|---|---|
| 3840 x 2160, 4:2:0 | 8.3 | passes (about 0.5 s) |
| 4000 x 2304, 4:2:0 | 9.2 | passes |
| 4096 x 2304, 4:2:0 | 9.4 | `IMAGE_DECODE_FAILED` |
| 4032 x 3024, 4:2:0 | 12.2 | `IMAGE_DECODE_FAILED` |
| 3840 x 2160, 4:4:4 | 8.3 | `IMAGE_DECODE_FAILED` |
| 4096 x 4096, any sampling, baseline or progressive | 16.8 | `IMAGE_DECODE_FAILED` |

## Two further proposals from the audit

11. **Add JPEG limit cases to the pack.** Shown by: the table above. Cases 09a to 09c use PNG only, so a consumer can pass the pack and still fail a contract-legal JPEG. Add a JPEG at exactly 16,777,216 pixels (and one photo-sized JPEG of about 12 megapixels) as "plays".
12. **Say how total bytes are counted when two asset rows carry the same SHA-256.** Shown by: the total-bytes probe. Either state that a manifest's asset rows are unique by SHA-256 (and make the publisher merge them), or state that a consumer counts each SHA-256 once. Add a case with repeated identical bytes just under and just over the limit.

Two smaller observations for the contract text, no case attached: the bounds table says that over the catalog limits the previous catalog stays, which the publisher does for more than 800 events, while for more than 100 selections on one event it leaves that event out and publishes the rest; and 800 events with 100 selections each cannot fit the catalog's byte limit, which binds first at several thousand selections.

## Engine limits that have no row in the contract

The scheduler should know these exist; none is proposed as a contract row yet.

| Engine limit | Value |
|---|---|
| Decode time per picture | 10 s, fixed on the exchange path |
| Preparing one whole selection | 30 s default, 60 s maximum |
| Reading the metadata of one refresh | 5 s default, 30 s maximum |
| `feed.json` and `current.json` size | 65,536 bytes each |
| JSON values and nesting per document | 300,000 values, depth 32 |
| Selections the Engine tracks | 2,048 per feed, 4,096 in all, over at most 8 feeds |
| Journal | 10,000 records, 64 MiB; never trimmed silently |
| Approvals | 2,048 |
| Picture strictness beyond the publisher's header check | JPEG sample precision must be 8; every PNG chunk checksum and the compressed stream are verified; nothing may follow the end of a PNG |
| Polling | the contract's suggested polling intervals are not implemented; refresh is driven by the caller |
