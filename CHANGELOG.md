# PiRaiders engineering changelog

## 2026-11-20 · The exchange catalog screen on the Game Day page (second part of the PC selector)

- On a PC set to read the scheduler's exchange folder, the Game Day page now shows **Exchange events** in place of the local event list: it reads the catalog when the page opens (or reuses the one already read), shows the school year, the number of events and the catalog number, lists the events 25 at a time with **Show more events**, and for the chosen event lists its boards and buttons 25 at a time. Choosing a button shows its event, board, button label, picture count and generation.
- Read-only: nothing is approved, prepared or played from this screen, and it says so. Stop and the playback controls are unchanged (they stay unavailable on such a PC).
- When the catalog changes after it was read (another tab refreshed it, or a page answers "stale"), or it cannot be read (folder missing, folder not the one set up, catalog withdrawn), the lists are emptied and a plain message with a **Refresh from exchange** button appears; nothing old stays choosable. A busy folder keeps the lists. A late answer for an earlier event never replaces the newer event's buttons.
- A local-folder PC is unchanged.
- Tests: 6 new browser tests (desktop and 390 px, keyboard, paging, stale, unavailable, late answers, and one end to end with the real web part and source service on synthetic folders); the HTTP test checks the screen is present only in source mode.

## 2026-11-20 · The exchange catalog can be browsed through the application (first part of the PC selector)

- A PC configured to read the scheduler's exchange folder no longer fails at startup with "configuration invalid". The Game Day web part now builds the source catalog service for it and offers four routes: source status, refresh the catalog, one page of events, one page of an event's board/button selections (`docs/design/EXCHANGE_SOURCE_SERVICE.md` › Routes).
- Same protections as every Game Day request: this PC only, exact origin, the SPX login, the page's anti-forgery token, strict small JSON. Answers carry codes and catalog data only, never folder paths.
- Still no selection screen, approval or playback on such a PC: the page shows a notice saying so, and every playback request answers "source playback not ready". A local-folder PC behaves exactly as before.
- Tests: 4 new over real HTTP, synthetic only. Each new check removed in turn makes at least one test fail.

## 2026-11-20 · The source catalog service (second part of the source service)

- New: one object, built only from the machine configuration, that owns the exchange source provider and the approval check for that machine (`docs/design/EXCHANGE_SOURCE_SERVICE.md`). It is what the PC selector and confirmation screen will call: refresh the catalog, browse its pages, inspect one selection, prepare one approved event, and the manager's two approval hooks.
- Before any read of the source folder it checks that the folder still resolves to the spelling saved in the machine configuration; otherwise it refuses and reads nothing. Catalog pages are handed out only after this service's newest refresh succeeded; a failed, overtaken or closed refresh withdraws them. Cached startup rereads the saved approvals itself and never touches the source.
- Not yet used by the application: there is still no route, selector or confirmation screen, so a source-enabled machine still cannot run.
- Tests: 8 new, synthetic only, on real temporary folders. Each guard removed in turn makes at least one test fail.

## 2026-11-19 · Saved approvals are rechecked exactly (first part of the source service)

- New: one module decides whether a saved PC confirmation still allows a source selection (`docs/design/EXCHANGE_APPROVAL_POLICY.md`). It fingerprints this machine's source policy, rereads the approval store before each new event is published, started and acknowledged, and requires an exact match of policy, feed, selection, production window and, for cached startup, the exact cached snapshot.
- Fails closed: no read yet, a failed or overtaken read, a revocation, a foreign feed or a store restored to an older copy all deny. A restored older store stays denied until restart. Active playback and Stop are not affected.
- Not yet used by the application: there is still no source catalog service, selector or confirmation screen, so a source-enabled machine still cannot run.
- Tests: 9 new, synthetic only, including the real manager refusing activation when a revocation is written while the event starts. Each guard removed in turn makes at least one test fail.

## 2026-11-19 · The largest JPEGs also load from a local folder

- The same defect as on the exchange path, on the older local-folder path: every JPEG above about 9 megapixels was refused with `IMAGE_DECODE_FAILED` (counted budget 128 MB, decoder worker heap 64 MB), although that path's own pixel limit is 16,777,216.
- The one-shot decoder worker now has the same 384 MB heap cap as the exchange path's worker, and the local-folder path passes the same fixed 512 MB counted budget at staging and at offline reload. Caps, not reservations. No caller option was added; the pixel, side, byte and 10 s limits and all PNG handling are unchanged; the one-shot default budget stays 128 MB.
- Tests: all five layouts, baseline and progressive, at 4096 x 4096 stage from a local folder and reload with the source folder gone; one block row over the pixel limit is still refused; a four-component picture through the one-shot validator passes with 512 MB and is still refused with the 128 MB default; the heap cap is pinned and equal to the session's. The new tests fail on the previous code (3 of 4; the over-limit refusal passes on both, as it should).
- Local Linux: syntax 177 files; 911 tests, 884 pass, 27 Windows-only skips, 0 fail (with the local stand-in for the one blocked package). Nothing measured on Windows 10 or the stadium PC.

## 2026-11-19 · Total bytes count each distinct picture once

- Engine defect against the exchange contract's bounds table (536,870,912 bytes of a selection's distinct pictures, each counted once): the Engine added the bytes of every asset row, so several source files holding identical bytes counted several times. The scheduler's publisher counts each SHA-256 once and emits one asset row per source file, so a selection it published as `complete` could be refused with `TOTAL_LIMIT` (26 files of one identical 20 MiB picture).
- The Engine now counts each SHA-256 once in the three places that check the total: the coordinator's plan check (before any file is read), staging (declared and read bytes) and cache reload. The per-row limits (500 asset rows, 20 MiB per picture, pixels, sides) are unchanged.
- Tests: at the real limit through the coordinator, 26 distinct pictures each in two rows totalling exactly 536,870,912 bytes pass the plan check and one byte more is refused before anything is recorded; 26 rows of one 20 MiB picture pass; staging and cache reload of repeated and distinct pictures at the total and one byte under. The new and changed tests fail on the previous code (4 of 4). Two older tests that pinned the per-row count were changed to the contract's count.

## 2026-11-19 · The largest JPEGs the exchange contract allows now decode

- Engine defect against the exchange contract's bounds table (16,777,216 pixels per picture): on the exchange path every JPEG above about 9 megapixels was refused with `IMAGE_DECODE_FAILED`, for memory, not time. A 12-megapixel phone photo failed.
- The exchange path now gives the JPEG decoder a fixed 512 MB counted budget (it was the validator's 128 MB default) and the operation's decoder worker a 384 MB JavaScript heap cap (it was 64 MB). Both are caps, not reservations. No caller option was added; the pixel, side, byte and 10 s limits are unchanged; PNG handling is unchanged.
- Measured at 4096 x 4096 on Linux, 2 CPUs: counted memory 161 MB greyscale, 233 MB 4:2:0, 273 MB 4:2:2, 353 MB 4:4:4, 449 MB four components; worker heap needed 56, 80, 106, 155 and 209 MB. Flat pictures decode in 0.4 to 2.2 s; dense pictures of 14 to 20 MB in 1.4 s (greyscale) to 5.5 s (progressive 4:4:4), against the unchanged 10 s limit. Whole-process memory peaks near 0.7 GB (4:2:0), 1.2 GB (4:4:4) and 1.3 GB (four components) for one such picture.
- Tests: every layout, baseline and progressive, at 4096 x 4096 through the real worker; a dense 20,390,928-byte colour JPEG at the pixel limit; real staging and offline reload of three such pictures; the limits just above still refuse. The new tests fail on the previous code (13 of 14).
- Not changed and still open: the older local-folder path uses the one-shot validator with the 128 MB / 64 MB values and refuses the same JPEGs. Nothing here was measured on Windows 10 or on the stadium PC.

Corrected headfdcfc913c18c3d1e7bdabe34e54013db35748190 full Linux passed859/886 with27 explicit Windows-only skips; syntax176. Its Windows private-console job134417870452 failed before the application proof, during pinned tool preparation, reporting only TOOL_PREPARATION_FAILED. No underlying cause is claimed. Added fixed phase/tool and allowlisted system/cause diagnostics with no raw paths/URLs/stderr, retry, pin/hash/size/cap changes. Focused preparation/NDI/capture tests29pass/1Windows-only skip; independent review and fresh final-SHA CI required. Both failed runs remain retained.

Initial PR55 head92f9114f195757a38c2b3b0c3557eb5e9730647e failed actual SDK receiver job134411382177 at WINDOW_END with IMAGE_MISSING after all ten expected frame states, including pre-end black. The last crash-tree observation was gone9/unknown0; no window-tree cleanup result existed. Strict pre-teardown identity collection started too close to scheduled shutdown. The corrected proof captures complete identities at end-minus30s using the existing bounded live-capture helper (at most15s, capped before end-minus5s), rejects a late capture or replaced/exited host, and retains the original near-end black frame, zero-survivor/zero-unknown cleanup and1.5s SDK quiet checks. No event extension or relaxed teardown deadline. Focused proof/capture tests25pass/1 explicit Windows-only skip. Final corrected-SHA Windows validation remains required; initial failure is retained.

Before this proof correction, full Linux regression passed858/885 with27 explicit Windows-only skips and syntax176. Later service wiring must also account for verified unchanged source inspections invalidating initial observation-bound tokens; read-only real-file reproduction confirmed this conservative behavior. Any future observation reuse requires fresh healthy exact-context validation and must never resurrect authority after failure/change. Source service remains disabled; no readiness claim.



## 2026-11-17 · Source policy and candidate approval refresh

- Recovered interrupted source-confirmation work under fresh lease44. Added strict opt-in source identities/private roots and retained canonical-root policy without mount/store initialization; source config cannot silently construct the lexical local catalog.
- Added copied/frozen same-selected-capture identity, timing proposal, review flags and source ticks, preserving full labels and distinguishing source metadata from confirmed/prepared/active output.
- Added awaited candidate approval refresh with physical ownership across logical close, caller-side source/policy checks after every lifecycle await and trusted callback, preserved Stop/active-window authority, and source200-codepoint labels. Reproduced scheduling, policy-clock and late-cleanup defects were fixed before publication.
- PR54 merged after all12 checks, including corrected native deadline proof, Windows835/837(two documented skips), Chromium44/44 and source/extracted output proofs. Final Windows validation and PC source/service screen wiring remain unfinished.

## 2026-11-17 · Source catalog pages and durable approvals

- Added metadata-only, revision-pinned event/selection pages preserving800-event/100-selection hierarchy and200-code-point labels. Reject conflicting repeated event headers and merged selection overflow; stale/invalid/aborted/superseded refreshes cannot restore browse authority.
- Added detached UUID-bound immutable approval journal with exact-head CAS, normalized machine-policy/binding/tuple/window/cache confirmations, revocation, unchanged no-ops and observed file ownership checks. Actual child races/crashes, partial writes, I/O errors, corruption and offline composition are tested. It supplies persistence data, not implicit playback authorization.
- PR53 provider/runtime admission merged after all12 checks. PC screen/machine-policy wiring and evaluation-release gates remain open; final Windows checks for this increment are still required.

## 2026-11-17 · Explicit source provider and candidate admission

- Added backend exchange profile/driver integration with independent verified ordered caches, trusted offline authorization, mandatory manager admission and changed-Reload guards at actual dispatch.
- Reproduced and corrected stale offline admission and callback reentrancy defects; source invalidation denies new candidates without blacking already active playback or changing confirmed windows.
- PR52 decoder prerequisite merged after all12 checks, real Windows500-image stage/cache and source/extracted output proofs. Source provider final Windows validation remains required. PC selection/approval persistence and evaluation gates remain open.

## 2026-11-17 · Source coordination verified; decoder performance gate

- Decoder candidate full Linux regression:716passed/27 explicit Windows-only skips/0fail (743total), syntax161, focused99/99. Final Windows/source/extracted evidence remains required before merge.
- Reuse one operation-scoped worker for schema2 stage/load while preserving the full codec core, original limits and one-shot validation. Added request isolation, permanent fault state and actual-exit cancellation/cleanup barriers; idle worker faults cannot publish content.
- Added real-worker lifecycle and public500-file source/cache regressions. Root99 focused cases passed; fresh full regression and Windows CI remain required. A separate4096² image timeout is retained as unresolved evidence.
- PR51 merged with all12 final checks passing: Windows722/724(two documented skips), Chromium44/44 and source/extracted11 actual output states each. Initial failed Windows evidence remains recorded.
- Independent hardened fixture execution exposed a500-image preparation timeout under the unchanged60-second cap; failed content was not acknowledged. Preserve that result and valid retained metadata facts. An operation-scoped decoder-session correction is in progress; fresh regression and Windows validation remain required.
- Explicit source-provider/runtime and PC selection integration remain separate unfinished work. No release or hardware compatibility claim.

## 2026-11-17 · Detached source preparation coordinator

Corrected local verification before publication: full Linux724tests/697pass/27 explicit Windows-only skips/0fail; root focused75/72pass/3native skips/0fail; independent proof43/40pass/3native skips/0fail; syntax156. Proof-helper SHA2565851fcfb36860e49bf836a2d86d3efa1cee0fb1215204b00830acfc82e0d7f46; full-app proofc3656c2f07a3df8f2ec1de4a5c8718d3739286a3886756f2751849bda8b7f125. Source coordinator/test unchanged from initial1496. Fresh final-SHA Windows/all12 checks required; original failed job remains evidence, not a proven diagnosis.

- Initial PR51 Windows baseline passed715 tests(two documented skips) and44 browser cases; source actual output passed. Extracted crash-recovery proof failed process identity capture after8 frame cases. PR remains draft pending investigation/correction and fresh final-SHA CI; no release claim.
- Independently reproduced and corrected proof ancestry handling for new older rows with missing images; prior partial/known identities remain obligations even off-tree. Added fixed-scope diagnostic counts/time and seven regressions without changing capture deadlines or application runtime. The original Windows failure cause remains unproven.
Root, author and independent reviewer each passed32/32 focused tests (zero skips/failures). Final Linux regression717:690 passed/27 explicit Windows-only skips/0fail; syntax156 passed. New module SHA2562c2fe30ab8e8e82bdfed19db895131c64f2d39dbb2c354ebec1a379b9ee9555a; test64868c274d7bea9c0b38c2d717060a343350a16d1f3b6fe13f23af2f6a752c01. Native Windows/final-SHA all12 checks remain required before merge.

- Compose approved feed binding, independent catalog capture, full selected metadata validation and separate exact-byte journal facts before staging actual ordered image content.
- Verify and reuse an existing cache for unchanged playback fingerprints; retain prior prepared content through missing, invalid, empty, incomplete or removed source data. Source eligibility and timing proposals cannot arm output.
- Hold the physical preparation slot through reader close, journal settlement and actual image-worker cleanup, even after logical cancellation. No automatic journal initialization, rebind or retry after uncertain publication.
- Reject source/journal overlap before facts, including actual canonical aliases. A real nested-journal regression failed before the fix. Require present current metadata with a generation at least as new as catalog before selected admission; catalog facts remain independent.
- PR50 is verified and merged after all 12 final checks passed: Windows 683 passes/two documented skips, Chromium 44/44, and source/extracted actual output proofs. Earlier failed fixture runs remain recorded. Final Windows evidence for this new coordinator remains required.

## 2026-11-17 · Snapshot ownership and Windows fixture correction

- Corrected fault-injection fixtures to use canonical temporary paths and assert actual fault admission. Retained both original Windows failures; no product deadline or limit was relaxed.
- Pin and verify pending/media directory identities before writes, publication and cleanup. A replaced directory is preserved, and an original moved tree may remain orphaned for explicit recovery.
- Two new real-filesystem regressions failed before the ownership fix and passed afterward. Root and independent review passed 98 focused cases; full Linux685:658 passed/27 Windows-only skips/zero failures. Fresh final-SHA Windows CI remains required.

## 2026-11-17 · Ordered exchange snapshot candidate

- Added verified PNG/JPEG staging from explicit source membership, preserving source order, repeated slides and occurrence identity. Matching physical aliases share a read/decode without reducing the source asset-row quota.
- Added an offline schema-2 cache with strict references, hashes, full image decoding and compatible media-handler/controller output. Legacy schema-1 staging is unchanged.
- Added 38 tests covering real images, offline HTTP serving, ordering/wrap, corruption, path changes, cancellation and cleanup. Root and independent review passed 96 focused tests. Full Linux suite: 656 passed, 27 Windows-only skips, zero failures; Windows CI remains required.
- PR49's validated catalog reader is verified and merged. Source-provider activation and evaluation-release gates remain open.

## 2026-11-17 · Validated catalog reader candidate

- Added catalog-only capture and fresh selected captures carrying a validated receipt from the same feed/catalog bytes. Missing or omitted selected manifests cannot prevent independent catalog acceptance.
- All methods share the existing physical-flight, timeout and close protections. Validated catalog floors stay separate from unaccepted legacy transport observations; selected manifests still need their remaining validation and journal gates.
- Added16 reader regression cases; the original18 transport cases remain unchanged. Full Linux645tests:618passes/27 explicit Windows-only skips/zero failures; syntax152 passed. Final Windows CI remains required. PR48 is verified and merged.

## 2026-11-16 · Independent catalog receipt candidate

- Added full feed/catalog validation from bounded owned raw bytes with exact delivered SHA256, approved feed/epoch context and descriptor identity/path checks. Missing selected manifests cannot prevent independently valid catalog facts.
- Added17 tests, including a real large catalog and actual missing-manifest → journal → reopen conflict retention. Full Linux baseline602passes/27 explicit Windows-only skips/zero failures; Windows validation remains required.
- PR47's journal is verified and merged with26 real Windows journal cases passing. Source reader integration and playable media staging remain open; this gate cannot activate output.

## 2026-11-16 · Local exchange journal candidate

- Added explicit initialization/opening of a private local version journal. Immutable records retain accepted facts across process restarts; competing writers use atomic no-overwrite publication and exact parent revision/hash checks.
- Added fail-closed replay, fixed capacity limits and uncertain-commit recovery without deleting committed history. This remains detached from source imports and output; it cannot authorize playback.
- Added26 process, corruption and I/O failure tests. Full Linux baseline585passes/27 Windows-only skips/zero failures; actual Windows validation remains required. PR46's transition model is verified and merged.

## 2026-11-16 · Exchange ledger transition model

- Added detached feed/epoch confirmation and separate catalog/selection version tracking. Switching events, feeds or approved epochs retains prior sequence floors; stale data and equal-version byte conflicts fail closed.
- Added immutable revision-fenced proposals and bounded retained state with no eviction. This module does not persist data, validate source documents, activate media or claim readiness.
- Added20 synthetic regression cases; full Linux baseline559 passes with27 explicit Windows-only skips and zero failures. PR45 timing validation is verified and merged; durable Windows storage and complete source preparation remain open.

## 2026-11-16 · Exchange timing metadata

- Added detached Chicago calendar, offset, DST and interval validation for selected-manifest event/broadcast timestamps. Midnight and DST crossings use elapsed UTC duration; broadcast windows are capped at24 hours.
- Preserve correct ambiguous instants and unavailable source dates/times for operator review. No source reason is rewritten, and no operating window is confirmed or armed.
- Added16 synthetic boundary and real metadata-capture tests. Final Linux baseline passed539 tests with27 Windows-only skips; final Windows CI remains required before merge.
- PR44's problem-state prerequisite is verified and merged. Its prior local SPX startup timeout remains recorded; no production timeout was relaxed.


## 2026-11-16 · Exchange problem-state semantics

- Added detached checks for incomplete selections, BOARD_UNRESOLVED diagnostics, selection-level problem scope and over-limit declarations. Contract-permitted listed/inline problems and repeated summaries remain valid.
- Added 15 synthetic failure and real-capture tests. Diagnostics, empty selections and tombstones never imply playback readiness or Stop.
- Separated a RossTalk network fixture's callback watchdog from its overall test duration after a recorded full-suite failure. Production deadlines and the real timeout regression are unchanged; all 30 TCP connection/order checks remain.
- Aligned non-deadline Node launcher fixtures with the unchanged production 15-second startup allowance; dedicated short deadline tests remain unchanged. Earlier failures remain recorded.
- PR43's preceding integrity gate is verified and merged with all 12 checks passing. Complete source integration and evaluation-release gates remain open.


## 2026-11-16 · Exchange selection integrity

- Added a detached validator that rejects forged selection identities or fingerprints, broken slide order, missing/unused/duplicate asset references and mismatched delivery paths. Repeated slides remain ordered.
- Composed the existing bounded JSON and structural schema gates. Results explicitly leave timing, problem-state, media verification, feed persistence, eligibility and external descriptor context pending; no playback or cache behavior changes.
- Added synthetic failure and real metadata-capture composition tests. Linux baseline passed 508 tests with 27 Windows-only skips; final Windows CI remains required before merge. PR42's fingerprint and Unicode transport prerequisite is verified and merged.


## 2026-11-16 · Detached exchange fingerprint computation

- Added bounded draft0.3.1 canonical JSON, selection IDs and separate playback/metadata fingerprints. Ordered occurrences retain repeated media; label/tick/time metadata changes do not alter the playback hash. No source, cache or output wiring is added; results remain `ready:false`.
- Added Unicode, malformed input, missing/duplicate asset reference, exclusion and size/depth/node regressions. Independent review caught and corrected a UTF16 label-length restriction before publication. Supplied JSON data vectors matched226 hash/canonicalization comparisons without executing attachment scripts.
- PR41's preceding structural schema gate merged with12 passing checks, Windows512 baseline passes/two documented skips, Chromium44/44 and actual source/extracted Windows NDI proof. Software evidence does not establish stadium hardware compatibility or evaluation readiness.


- Corrected the reader transport's UTF16 admission bound for schema-sized supplementary Unicode labels. Actual filesystem capture/identity/digest regression and oversized-binding rejection passed; complete structural/semantic acceptance remains separate.


## Full-app bounded identity observation (BE-002)

PR39 merged01553c0bd88cd60b3092dfc7009976bce8471375 with the identical tested tree85cca2599254d5f4d37b78951b58e565fb208651 after all ten checks. Windows477/479(two documented skips), Chromium44/44, actual async CIM and seven Console captures passed; source/extracted fullapp received eleven frames each. An initial merge request timed out after applying identical content at bd039644; fresh ref/tree/PR-state checks preceded safe reconciliation. PR39 is confirmed closed/merged; no force update occurred.

PR37 final combined9e13c969bfb3cbfe50e592bf7a0d81ddfd244757 passed nine checks but extracted job133236167264 failed CASPAR_CRASH/IMAGE_MISSING after eight frames. Its old sender tree had already been observed gone9/unknown0 and runtime recovered ready; the broad phase does not pinpoint the exact failing read. Preserve this and earlier failures. Metadata is detached from this proof; do not merge or rerun until green.

Acceptance for this focused follow-up: use complete pinned CLI and sender-JobHost captures for full-app sender identity/recovery and parent-loss capture; one original15s total monotonic budget shared across both ownership levels, capped by remaining production-window and outer60s recovery budget. Require the same sender generation after the second capture, retain complete transient sender children for cleanup, reject late synchronous validation, split crash phases and recheck parent termination within the window. Keep strict original identity/opaque-black/frame/unknown/surviving/outer-bench/inventory/real-window bounds. No sender/application runtime change or stadium/hardware claim.

Portable tests cover missing-field recovery, pinned roots, wrong/ambiguous hosts, changed generations, retained cleanup, shrinking shared budgets, persistent unknown, late query/validation, UTC/window clipping and exact parent-loss pin. Final full baseline, source/extracted eleven actual-frame Windows proofs and all required checks remain mandatory. Rollback reverts disposable proof tools. Then merge verified prerequisite, synchronize PR37 via true non-force merge commit and verify final SHA again. Schema successor remains unmounted/unpublished; do not call metadata/schema success a playable import.


Executed root validation before publication: initial parallel baseline486 tests459pass27Windows-only skips/0fail; focused final30 tests29pass/1native-Windows skip, syntax128 plus changed-file checks pass. After adding the final late-validation regression, the parallel487-test run reported457pass/3 existing startup-fixture timing failures/27Windows-only skips: exhausted restart budget APP_STARTUP_TIMEOUT, held-browser stale proof got timeout, and ignored-browser opener was never reached before its deadline. No assertion or product timeout was changed. Controlled SAME full test list at --test-concurrency=1 passed487 tests:460pass27Windows-only skips/0fail. These are different execution conditions, not a claim the earlier failures were fixed. Default-concurrency final CI remains mandatory. The schema candidate's separate43/44 browser failure and terminated Reload-fixture hang remain recorded; an unchanged focused timer diagnostic passed1/1.


## 2026-11-16 · Bounded NDI receiver observation windows

- Discard disconnected or buffered capture evidence and require a full fresh connected run inside the original deadline. Preserve final connection/pixel/duration checks, bound replay history and retain native video release on every path. This changes disposable proof tooling only; actual Windows SDK validation remains required.

## 2026-11-16 · Explicit renderer and extracted application output proof

- Add an optional strict machine-owned Mesa profile with Caspar-only environment overrides and safe missing-library preflight/retry. Preserve inherited defaults, SPX, catalog authority and native event deadlines.
- Add a separate Windows job that builds the genuine development ZIP, launches its unchanged CMD/bundled runtime, preserves every original inventory entry and verifies the eleven received-frame scenarios plus inner-parent cleanup while an outer benchmark remains alive. Both source/extracted app environments remove inherited renderer variables, Node preloads, npm and system Node PATH entries. Native execution is required before merge; no evaluation-readiness or hardware claim.

## 2026-11-15 · Independent prepared-event sender deadline

- Add trusted native clock sampling and one immutable event-wide cutoff shared by every Caspar sender generation. Enforce UTC and boot-clock bounds before execution and during native supervision, including when Node is blocked. Preserve persistent SPX and legacy defaults; terminal expiry and close fences prevent rearming. Portable tests pass; final native Windows verification is required before merge.

## 2026-11-15 · Native NDI failure diagnostics

- Separate the deliberate missing-DLL receiver from active-receiver diagnostics, and identify crash enumeration, selection, termination and recovery failures with fixed safe categories. Native frame/connection, ownership and timeout requirements remain unchanged. Actual Windows verification is required; the two prior master failures remain unresolved.

## 2026-11-15 · Persistent application development ZIP

- Set process-query PowerShell output explicitly to BOM-free UTF8 and add a real Windows Unicode executable-path round-trip regression; this addresses a missing encoding contract exposed by extracted-path validation. Actual final Windows evidence passed in both Foundation runs.
- Resolve expected and observed executable paths before selecting the extracted CLI generation, retaining strict ambiguity/unknown refusals after Windows exposed a raw-spelling mismatch. Portable alias/namespace regression and actual corrected Windows validation pass.
- Explicitly package the persistent parent and machine/SPX examples behind one root CMD. Retain the legacy component CLI and smoke, while adding actual extracted bundled-Node/HMAC/SPX/Game Day and generation-aware parent-death validation with the outer bench root held alive. No component binaries or operator config are bundled. [PR31](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/31) mergedd302ee5 after9 final checks; both actual Windows archives passed startup/Unicode/independent parent-death tests. This remains a development artifact.

## 2026-11-15 · Full application Windows output proof

- Refine the full-app proof to select only directly contained sender roots while retaining same-image subprocesses in cleanup evidence. Add safe fixed assertion labels and precise initial phases after the first Windows run stopped before frames; both corrected final native runs passed.
- Add an actual CLI/SPX/Game Day/default nested JobHost/Caspar/NDI software proof with real browser/TCP controls, eleven SDK frame captures, offline recovery, real window boundaries and active parent-death cleanup. Preserve uncertainty as unknown until confirmed within fixed deadlines. [PR30](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/30) mergedfa62457 after10 final checks, including two actual full-app Windows runs with11 received frames each. Portable proof7/7 passes; extracted artifact and release hardening remain open. No evaluation-release claim.

## 2026-11-15 · Persistent SPX application parent

- Keep generation-admission fixture termination explicitly injected while retaining separate real Windows containment tests. Disposable cleanup observations treat incomplete live CIM fields as unknown, preserve strict identity validation and require confirmed disappearance within the original deadline; fixed reasons/counts aid diagnosis. Final corrected Windows results remain required.
- Add a dedicated Windows parent API/developer CLI that preserves SPX across events, requires existing config and proves current-child startup with fresh HMAC before browser opening. Fence ready observers/restarts and late browser completion, bound startup and close, rotate secrets and retain native stop retry. Add actual SPX integration and Windows-only JobHost/parent-death tests. [PR29](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/29) merged9b93a3e after8 final-head checks; Windows416 baseline passes/two documented skips and44 browser tests pass. Package selection and full nested output proof remain separate.

## 2026-11-15 · SPX-hosted Game Day

- Separate missing/corrupt browser-test response budgets from the deliberately short timeout case, preserving every failure/last-good assertion and production defaults.
- Fix wrap-prone mobile SPX navigation and retain geometry/screenshots before layout assertions. Strengthen disposable Windows cleanup evidence with PID plus exact creation ticks and image, excluding stale parent IDs and distinguishing PID reuse from true survivors; actual final Windows results remain required.
- Add actual event preparation/playback UI and guarded SPX router with local Host/Origin/session/CSRF/CSP boundaries, precise recovery and startup-identity proof. Preserve original graphics navigation/default behavior. Fresh review resolved Stop priority, narrow-layout reachability and403 recovery; real SPX/browser tests cover validated media activation outside prewarm and corrupt replacement retention. [PR28](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/28) merged7b3f437 after8 final-head checks passed, including actual Caspar/Console/NDI and Windows/Ubuntu. Windows application packaging remains open.

## 2026-11-15 · Local Game Day backend

- Add strict bounded machine/catalog policy and a sender-only event manager with stale-selection fences, immutable preparation, retryable cleanup and retained physical-flight barriers. Add trusted source/private-root alias checks and reciprocal source preparation admission across prewarm. Test real files/decode/listener handoff and Chromium/TCP controls with injected native boundaries. [PR27](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/27) merged62e94e9 after all8 final checks, including Windows366 baseline passes/two documented skips and33 Chromium tests. UI/launcher release integration remains open.

## 2026-11-15 · Shared local and RossTalk admission

- Add trusted local bridge/session/runtime commands through the existing TCP queue and priority Stop machinery. Preserve bounded followers, physical callback watchdogs and legacy FIFO; return fixed results without private data. Add mixed TCP/local, reentrant shutdown and actual browser regression coverage. [PR26](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/26) mergeddfc5ce6 after8 final checks, including Windows315 baseline passes/one documented skip and31 Chromium tests. Game Day UI remains subsequent integration.

## 2026-11-15 · Persistent application ownership

- Add trusted sender-only event ownership while preserving standalone defaults. Event startup, health and shutdown omit unowned SPX, including filesystem checks at source/cached preparation and Reload. Retain sender stop failures for retry. New tests keep a real independent Node HTTP service alive through simulated event recovery, window end, close and replacement. [PR25](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/25) mergedf29f69b after all8 final checks passed, including Windows300 baseline passes/one documented skip and29 actual Chromium tests. Game Day UI remains planned.

## 2026-11-15 · Local prepared event runtime

- Add strict local/manual event profiles, generated private Caspar settings and prepared-runtime orchestration. Stage before startup; preserve accepted offline content; create a fresh stopped presentation per sender generation; fence Auto and media before independent window/close/fault shutdown. Add reentrancy-safe lifecycle hooks and unit/real browser integration. Browser tests simulate OS boundaries; both integrated Windows private Console/Caspar/NDI runs received ten actual frames and verified crash recovery, offline cached content, real-clock shutdown and receiver silence. Final diagnostics expose fixed Reload failure categories while preserving accepted content. [PR24](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/24) merged08d75c9 after all nine final-head checks passed; the application evaluation release remains open.


## 2026-11-15 · Private CasparCG control increment

- Add opt-in bounded Windows stdin forwarding with independent EOF detection and a correlated Console AMCP adapter that captures native output privately. Add blocked-input/descendant-cleanup tests and a dedicated actual Caspar/CEF Windows proof. Defaults remain NUL. Both implementation Windows runs passed all seven native cases and seven actual Console/CEF captures, positive-controlled root listener absence, full-frame Stop black and crash recovery. [PR23](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/23) requires passing final-head checks before merge.


## 2026-11-14 · Native NDI validation increment

- Add disposable Windows actual-SDK receiver proof, pinned official runtime preparation, synthetic frame captures, crash/reconnect checks and real-clock window-end drain verification. Both actual Windows implementation runs passed10 received BGRA images, same-receiver crash recovery, Stop black and real-clock sender shutdown followed by drained-buffer silence/zero connections. [PR22](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/22) requires passing final-head checks before merge. Local baseline247 passes/nine Windows skips and actual Chromium27/27 pass. Default launcher and application package are unchanged. No NDI binaries are redistributed.


## 2026-11-13

- PR #3: executable native SPX HTML, EBU OGraf and CasparCG AMCP fixture regressions. Browser/socket boundaries are simulated.
- PR #4: developer-only Windows launcher and bounded process supervision.
- PR #5: isolated production-window policy, explicit timezone offsets and 15-minute default prewarm. The launcher does not yet enforce it.
- PR #6: Windows process-tree shutdown and failure reporting; real Windows parent/descendant termination passed [final CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43445825768) before merge.

- PR #7 launcher integration: required production window, independent SPX supervision, eligibility checks for initial and crash restarts, boundary/poll reconciliation and retryable failed shutdown. [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43447462284) passed on the implementation commit: Windows ran all 47 tests without skips. Process enforcement is not packet-level NDI evidence.
- Reproducible developer setup: `npm run setup`, `npm run check`, `npm test`, Node 22 Ubuntu/Windows CI and preserved upstream documentation.

- PR #8 Windows containment: service trees belong to native kill-on-close Job Objects, assigned before execution. Root/host/launcher failure paths and exact argument forwarding have dedicated Windows tests. The helper built from source and all 57 Windows tests passed in [CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43456474849). The artifact is a containment component only.

- PR #9 service health diagnostics: bounded loopback SPX identity and CasparCG VERSION diagnostics, explicit startup/degraded/recovery states, and generation-safe cancellation independent of window shutdown. Real SPX startup is now exercised with isolated temporary settings; CasparCG health uses a socket simulator. [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43467648825) passed; Windows ran all 87 tests without skips, including real SPX startup through the native host. No endpoint response proves NDI or receiver state.

- PR #10 portable Windows development packaging: tracked SPX runtime/assets/locales, fresh production dependencies, bundled Node/license and native host, one fixed launcher, strict SHA-256 inventory and ZIP checksum. Extracted-ZIP CI exercises actual SPX pages and simulated AMCP window shutdown without global Node. [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43497290240) passed all 91 Windows tests and the complete extracted-archive smoke with bundled Node v22.23.4. This is a development artifact; CasparCG/NDI binaries and unfinished product workflows are not represented as ready.

- [PR #11](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/11) BE-003 transport foundation: explicit numeric sender allowlist and GPI/action mapping, bounded CR/LF decoder and serialized dispatch, disconnect-safe accepted commands, terminal handler-timeout cancellation, fixed diagnostics and an off-air loopback bench. The Windows launcher does not enable a listener; presentation integration and hardware verification remain open. [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43506761902) passed all 114 Windows tests, loopback bench and extracted ZIP smoke on the implementation head.

- [PR #12](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/12) BE-004 slideshow state/timer foundation: immutable ordered deck, Launch-at-1, wrapping, Auto/10-second monotonic timing and reset, explicit cut/fade rendering intent, failure suspension and bounded Stop preemption with retained watchdogs. Real TCP integration exercises command ordering and cancellation using simulated rendering. Native template output, staging and overlays remain open. [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43508893747) passed all 134 Windows tests without skips, loopback bench and extracted ZIP smoke.

- [PR #13](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/13) BE-005 snapshot preparation: actual bounded worker-thread PNG/JPEG decoding, deterministic stable local capture, immutable atomic versions, strict hashed manifests and offline full-decode verification. Pin permissive codecs and preserve notices; explicitly reject APNG/interlaced PNG and DRI/restart JPEG rather than accepting unsupported or truncated content. Windows artifact smoke now covers bundled codec workers and source-independent staged-media load. Watcher/live Reload/rendering integration remains open. [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43536763894) passed 159 Windows tests plus one explicit casefold-fixture skip, and actual extracted ZIP staging/offline decode plus SPX/simulated-AMCP smoke. Corrected the existing SPX fixture teardown race without weakening dedicated force-kill coverage.

No user-testable Windows release or stadium hardware compatibility has been established. Upstream SPX release history remains in RELEASE_NOTES.md.


## November 13, 2026 · Owner media-library design input (America/Chicago)

- Incorporated the supplied Apps Script 2.122.0 media-library architecture into ADR0005, an integration contract, roadmap/backlog, Library/Game Day brief and staging guidance. Sheet rows own event/button meaning and sequence; Drive ID identifies bytes and File Key preserves occurrences. Source access defaults read-only; private documents and source loaded ticks stay separate from audience media/Engine readiness. Generic local snapshot compatibility is retained. Export/auth/order/board/time details and planned R-158/R-168 changes are explicitly distinguished from current storage. No runtime, Google data or external permissions changed.


## Native SPX slideshow rendering increment

- Added passive HTML/CSS/JS image output with real decoding, cut/fade, last-good retention, bounded cancellation/transition recovery, full black Stop and audience mode/reload feedback. Real Chromium tests cover pixels/races and existing SPX fixtures; no application/NDI/hardware readiness is claimed.
- Actual iframe tests exposed the existing OGraf INFO_LEFT Update envelope bug; its adapter now forwards flat normalized fields without mutating caller data. Added a regression for visible updates and invalid-data retention.
- Pinned development-only Playwright and added Windows/Ubuntu browser CI with capture provenance; Windows development ZIP smoke checks native template asset delivery.

- [PR #15](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/15) implementation head cb9d260 passed [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43547091647): 13 real Chromium tests on each OS, Windows baseline159 passes/one explicit casefold skip, and actual ZIP template/media/SPX/simulated-AMCP smoke. Final-head CI remains required. Browser tooling stays development-only; headless-only browser installation avoids an unused GUI download.

## Trusted snapshot serving increment

- Added an opt-in, authenticated loopback HTTP boundary for fully verified snapshot images, exact image-only routes, bounded hash-checked reads, private responses and explicit revocation. No default server route or source data migration.
- Added real HTTP failure/recovery tests, actual Chromium rendering from offline staged PNG/JPEG through the Node controller, and extracted Windows ZIP serving probes. The browser automation adapter is test-only; production presentation/control/Reload integration and sender/hardware evidence remain open.
- Fixed a browser regression-test timing assumption: overlay samples use the real animation timeline so screenshot overhead cannot incorrectly fail the required one-second hold. No rendering behavior changed.

- [PR #16](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/16) merged after all four final-head Windows/Ubuntu checks passed: [CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43550650858). Windows171 baseline passes/one explicit NTFS casefold skip,14 Chromium passes, actual extracted ZIP image-serving smoke; Linux163 passes/nine Windows-only skips and14 browser passes.

## Atomic prepared-deck activation increment

- Added explicit controller replaceDeck with immutable admission, occurrence preservation at execution, slide1 fallback, confirmed-render atomic commit and full Auto interval reset. Failed/canceled candidates keep the old deck; stopped preparation stays black; priority Stop and orphan watchdogs remain bounded. The committed deck is exposed read-only.
- Added failure/timer/queue/cancel/Stop regression tests and real Chromium two-snapshot reorder, corrupt-candidate rollback, retry and stopped activation. Candidate preparation, session transport, watcher/Reload overlays and sender/event wiring remain application integration work.

- [PR #17](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/17) implementation ef5c397 passed [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43564163343): Windows185 baseline passes/one explicit NTFS skip, Linux177/nine Windows skips,14 actual Chromium tests each including two-snapshot replacement/rollback, and extracted ZIP smoke. Final documentation-head checks remain required before merge. Condensed the durable checkpoint to distinguish completed components from remaining release integration.

## Managed native presentation increment

- Added opt-in authenticated loopback presentation host joining the existing Node controller, verified offline image serving and native SPX renderer through real Socket.IO. Single program owner; show/black commit acknowledgments; bounded pending work, Stop cancellation, stale-ACK fences, deadlines and stopped-controller recovery. Fixed session error codes remain available without credentials.
- Added inert-by-default native client, fragment-only bootstrap with private per-host cookies, explicit reconnect navigation, disconnect black, and startup black fallback/style validation. Original SPX lifecycle/OGraf remains unchanged outside explicit managed mode.
- Added real HTTP/WebSocket and real Chromium failure/recovery tests; extracted Windows ZIP probe uses real authenticated transport with explicitly simulated frame acknowledgments. Browser tests provide actual painted-output evidence. Launcher, sender, Reload/feedback and event/command orchestration remain separate; no NDI/hardware readiness claim.

- [PR #18](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/18) implementation bbd9297 passed [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43568513062): Windows199 baseline passes/one explicit NTFS skip, Linux191/nine Windows skips;19 actual Chromium tests each. Extracted ZIP proved authenticated host transport with explicitly simulated frame ACKs, separately from real browser pixel tests. Final documentation-head checks remain mandatory.

## Managed Reload and audience feedback increment

- Added one-at-a-time verified snapshot replacement, actual decoder cancellation/preparation deadline, bounded active/candidate registrations and retirement only after frame-RPC settlement. Stop and session changes fence late work; preparation failures retain old playback/timing, render failures retain old deck and suspend Auto.
- Routed Auto/Manual and Reload overlays through acknowledged controller feedback, with bounded coalescing and priority black. Fixed full-queue Auto starvation using one fenced full-interval retry, and replaced timed-out loading feedback with a safe terminal label.
- Added controller, real HTTP/WebSocket and real Chromium failure/recovery coverage; package smoke exercises runtime Reload/feedback with explicitly simulated ACKs. No new dependencies, source schema migration, watcher, sender or default launcher change.

- [PR #19](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/19) implementation4634eed passed [Windows/Ubuntu CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43592128097): Windows230 baseline passes/one explicit NTFS fixture skip, Linux222/nine Windows skips,23 real Chromium tests each, and extracted ZIP runtime Reload/feedback with explicitly simulated ACKs. Independent final review89/89 passed. Final documentation-head checks remain required.

## Managed RossTalk control increment

- Added opt-in priority Stop through a full queue, bounded repeated-Stop followers, independent orphan callback watchdog/barrier and silent EOF slot cleanup; legacy FIFO/default timeouts stay unchanged.
- Added an owned managed-session facade with explicit synchronous eligibility gate, prepared-snapshot resolver, validated deadline budget and stale-generation/epoch fencing. Actual TCP/browser tests cover frames, overlays, Reload, full-queue Stop and late work; package probe explicitly simulates frame ACKs.
- Recorded exact candidate Caspar/NDI/Mesa pins and unexecuted Windows software-proof plan, including upstream URL logging and all-interface AMCP risks. No binaries installed or compatibility claims; production deployment/network changes remain owner-approved gates.
- Corrected the successful-control fixture deadline under parallel decode load and made diagnostic assertions sequence-aware; dedicated short timeout/fault coverage remains unchanged. Local final baseline249, browser26/26 and package-probe reproduction pass.


Managed control verification: [PR #20](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/20), source a2a47712bd011a984e3bee4ce345ac520dd6d2b8, passed all four Windows/Ubuntu push and pull-request checks: [CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43596957244). Windows248 baseline passes/one explicit NTFS casefold fixture skip; Linux240/nine native Windows skips; actual Chromium26/26 with zero skips on each OS. Real extracted Windows ZIP passed managedRossTalkControl:true alongside media/Reload/SPX/window/process smoke; its frame ACKs remain explicitly simulated. Final documentation-head CI remains required before merge. Default launcher integration and actual CasparCG/NDI frames remain release gates.


PR #20 confirmed merged at4fe470d27e8d50842e06725e2943b9b5a716593d after final sourcedc7067bc1e36ad506a28b0a599641fbcef7fe51a passed all four checks: https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43617817598 . Managed RossTalk priority Stop/session integration is complete at component level; default launcher wiring is still open.


Real Caspar software-proof increment: scripts/prepare-caspar-proof.cjs downloads and hashes the exact Caspar/Mesa pins into a disposable CI directory; no NDI installer, system driver or binary redistribution. scripts/smoke-caspar-windows.cjs uses actual JobHost/LauncherRuntime window containment, actual Caspar/CEF/native managed presentation and real RossTalk. Acceptance: six actual1080p mixed PNG captures (mixer red, Launch red, Next blue, Previous red, Reload green, Stop black), real sender process alive after Stop, complete recorded Caspar/CEF tree gone at window end, persistent SPX stand-in still alive, no known text-log capability persistence. SPX is explicitly a harmless stand-in only in this probe; separate package tests exercise actual SPX. Mesa startup detection is recorded, GL_RENDERER is not. No NDI/Windows10/stadium proof follows. Windows workflow execution is pending; do not mark BE-002 complete or claim a user release. Failure must remain red and be debugged before merge.


PR #21 remains draft while real Windows proof is debugged. Actual Caspar/Mesa startup and one1080p red mixed PNG pass with child-only4.5COMPAT; CEF loads five template assets then bootstrap403 (source87c33, CI43620130276). Caspar's browser flag omits fetch Origin. Added an independently security-reviewed bootstrap-only alternate requiring absent Origin +exactHost/loopback +privateBearer +marker1 +complete literal same-origin/cors/empty Fetch Metadata. Present/wrong Origin, foreign-port and WS checks remain strict. Local backend15/15 and full baseline253 (244 Linux passes/nine Windows-only skips) passed; actual disabled-security Chromium paint passed, full latest browser/Windows verification remains required. Do not merge red checks or claim NDI/user-release readiness.


Initial complete real Windows software proof passed on source1eef2321214807de93ebfd3c1e877e247c5a3ee1 in both [PR CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43621765909) and [push CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43621760382). Actual pinned Caspar/CEF/Mesa produced six verified1080p PNG captures: mixer red, Launch red, Next blue, Previous red, Reload green, Stop black. Stop retained the Caspar process; injected production-window end removed the full recorded real Caspar/CEF tree while persistent SPX stand-in survived. No NDI runtime/consumer, Windows10 target or stadium equipment was tested. Private URLs/raw post-auth native logs were not published.

Final acceptance adds actual JPEG alongside PNG, forced termination of the proven owned Caspar root, native descendant cleanup and bounded supervisor restart, a fresh stopped renderer epoch/black frame, then explicit Launch of the last good deck. Eight capture files and structured origin-proof/referrer-privacy fields are required. This added recovery coverage and all final-head checks must pass before merge; the earlier six-frame proof is not evidence for these new paths.


Real Windows recovery implementation2988969558b5ab336e919e98a6cfe0240be62581 passed both [push CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43622879981) and [PR CI](https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43623042420). Eight actual1080p mixed captures cover PNG/JPEG, controls/Reload, opaque Stop black, forced identity-verified Caspar root termination, descendant cleanup/restart, fresh stopped epoch/black and explicit last-good Launch. Real window-end process cleanup passes with injected policy clock. Matching bootstrap Origin and absence of capability in referrers/logs are verified across both starts. Initial recovery PID assumption was corrected after a retained failing test; no test was skipped to obtain this result. Final documentation-head six-check CI/merge remain mandatory. NDI, Windows10 target and stadium proof remain untested; broader BE-002 and first application release remain open.


## Verified native deadline evidence

PR34 merged9eb7a54 after all nine final checks passed: all five new native Windows cases,440/442 Windows baseline passes(two documented skips),44 browser tests and11 received full-app NDI frame cases. The prepared-event sender now has an independent immutable deadline across sender restarts. This remains development software; extracted actual output and remaining evaluation gates are open.


## 2026-11-16 · Managed Caspar launch-path correction

- A controlled Windows test confirmed that the pinned Caspar binary fails its Unicode config filename argument while the identical ASCII control succeeds. Keep the managed config in its owned event directory, launch with an ASCII basename/private cwd and generate relative paths. Preserve default absolute config generation, SPX/legacy launchers, renderer environment and native event deadline. Final actual Unicode-extracted output must pass before merge.


## Bounded complete-identity capture prerequisite (BE-002)

Metadata PR37 combined source1b2eb561db18bc18dd6283bf8d313253282846ce passed nine final checks, including source/extracted full-app eleven actual NDI frame cases, but Console job133114778383 failed RECOVERY with PROCESS_IDENTITY_UNVERIFIED/IMAGE_MISSING after five captures, before processChecks. Preserve that failure; the exact OS cause is unproven. Do not rerun it until green or merge PR37 while red.

Acceptance for this focused proof-only correction: require one complete current owned process-tree snapshot before destructive actions; pin live JobHost parent/image/generation; retry only missing identity fields under one original15s total capture budget using a monotonic deadline. Malformed, contradictory, wrong-owner, changed-root or persistent incomplete evidence fails closed. Retain previously complete owned generations for strict cleanup; a later complete table may establish an incomplete candidate's absence without inventing a captured identity. Cleanup still requires surviving===0 and unknown===0. Application services and output behavior are unchanged; sampled CIM evidence is not atomic Windows enumeration.

New portable tests cover recovery, persistent unknown, fixed budget/late completion, root ownership, PID reuse, contradictions and strict cleanup. A new native Windows test must execute the real async query and child cleanup. Final-SHA Foundation and actual Console/source/extracted/NDI checks must pass before merge. Then synchronize this prerequisite into PR37 through a non-force merge commit and verify its final SHA again. The detached schema-gate successor remains isolated in /workspace/piraiders-exchange-schema, based on PR37: reviewed four pinned schemas, exact dependencies, seven schema tests/9173 independent comparisons and corrected full490-test baseline(464 Linux passes/26 Windows-only skips), pending publication/native CI. No evaluation-ready release is claimed.


Root verification before publishing: all three candidate hashes inspected; focused process suite25 passes/3 native-Windows skips; complete baseline479 tests,452 passes/27 explicit Windows-only skips,0 failures; syntax127 files passed. Root changed the portable rollback regression's incidental1s elapsed assertion to a5s test watchdog plus shrinking-budget assertion, avoiding a scheduler-speed claim; the actual15s capture budget is unchanged. Independent candidate review/failure paths retained; real async Windows capture and final actual Console CI remain required.




## Verified full-app prerequisite and active metadata capture

PR40 merged62bdbb01b87ab9232c4067d01cbdab18ccb799ab, tested c07814962a5acfecd04dc6350d7ab35772e2ca2e, identical tree85e0670b99432e9f70ba11d8c7d727c31715808f. All ten final checks passed: Foundation43853231415/43853123199; fullapp43853231425; Console43853231652; prepared43853231605; Caspar43853231482; NDI43853231396. Default-concurrency Windows485/487(two documented skips), Chromium44/44; source and extracted each received11 actual NDI cases. Extracted inventory unchanged; receiver quiet1506ms at window end and1508ms after independent parent loss, zero connections. Earlier failures remain recorded; no sender/product changes or underlying OS-cause/hardware claim.

PR37 is synchronized through a true non-force merge commit with this verified prerequisite. Its five explicit implementation/design files remain a detached transport-only reader: bounded fatalUTF8/duplicate-safe four-document capture, explicit feed/epoch/tuple binding, exact delivered manifest digest and one descriptor pinned once, observed filesystem confinement/races, one physical flight/BUSY bound, last metadata-pin retention and immutable monotonic deadline fencing. Every pin/result remains ready:false/semanticValidation:pending. Full schema/V1–V20/JCS/time/assets/cache/durable ledger/UI/output integration remains pending. Preserve local/manual SPX behavior; earlier f01f2dd/1b2eb56/9e13c96 failures are not rerun until green. FINAL combined CI is required before merge.

The cloud exec connection dropped during local synchronization (exec-server recovery timed out after45s); no new combined local result is claimed. Publication uses GitHub-authoritative master40 plus the five unchanged PR37 files, with focused docs updates. CI must run the complete combined tests on the final SHA. GitHub access/lease remain valid; do not request owner tokens or install tools.

Schema candidate remains isolated/unpublished in /workspace/piraiders-exchange-schema: eight focused schema tests including bounded read→four gates,9173 independent comparisons and13-field numeric audit passed. It is not an importer. Retain earlier43/44 browser failure, terminated Reload-fixture hang and local parallel startup timing failures. Test-only corrections there are under validation: fire preparation timeout only after actual blocked I/O admission; assert actual controller scheduling before screenshots and use a fresh connection after the separate startup/prewarm phase. Corrected Reload13/13 passed; corrected browser/full combined/native validation is still pending. No production timeout changed. Workspace outage may prevent local continuation; inspect actual files before assuming a correction exists. Fingerprint delegation delivered nothing due quota.

Next: inspect final PR37 CI, merge only if safe/all passing with identical tested tree; then integrate/publish the reviewed schema increment after its real validation. Complete independent V1–V20/JCS/calendar semantics, persisted feed binding/sequence ledger, ordered verified-asset/schema2 staging and GameDay integration; licensed clean-machine setup, default browser/graceful-close proof, diagnostics/recovery and4h soak remain evaluation gates. First evaluation release NOT READY; no owner upload/secrets/manual routine test required.


## PR37 Windows teardown correction

Combined source b2647e899eba3126ff2c06bdf732c29c4760228f passed its metadata tests, but both final Windows Foundation jobs133259502058/133259472912 failed only in native-fixture after hooks: fs.rmSync returned EBUSY for an owned temporary directory after body process assertions. Each reported503 passes/1failure/2documented skips out of506; retain both failures, no rerun-until-green. Other final checks must still be inspected.

Change only that test fixture removal to awaited fs.promises.rm with recursive:true/force:true and bounded maxRetries10/retryDelay100. This yields for temporary handle release, keeps every PID/process-exit/argv/cwd/ownership assertion and existing process timeout unchanged, and still throws on persistent cleanup failure. No product code/cleanup policy changes. Linux syntax and test-file execution are feasible; its real Windows cases are explicitly skipped locally, so no local native cleanup pass is claimed. New final-SHA default-concurrency Windows and full source/extracted/NDI CI are mandatory before merge. Cloud exec responded again after its transient recovery failure; no environment settings, credentials or network grants changed.


## Detached structural schema gate increment (BE-006)

PR37 merged5977919b0be0ffc33ea97cbc45cf472aca79d098, tested0fe248ac27a29dfefbc3fb5ad7e810fa75e6182e, identical treef196a108954fdddb29c62010c36b6597823d1bfd. All ten final checks passed: Windows504/506(two documented skips), Chromium44/44, source/extracted fullapp11 actual NDI cases each. Foundation43856949358/43856941198 and fullapp43856949371. Its metadata reader remains detached/ready:false; do not rebuild transport or claim a playable importer. PR39/40 verified proof prerequisites are merged; earlier native/teardown failures remain evidence.

Current increment adds the four original pinned draft0.3.1 schemas, a fixed local registry, exact ajv8.20.0/ajv-formats3.0.1, full date-time checks without coercion/defaults/removal, fixed redacted diagnostics and structural-only ready:false results. Equivalent in-memory guarded negation corrects exactly3 default-contains compiler sites without disabling a source clause. Original schema bytes/hashes are preserved across checkout platforms with scoped.gitattributes -text. Independent pinned test-only Python Draft2020-12 oracle is deliberately wired into CI:9173 comparisons in both Ajv allErrors modes;13 numeric declarations audited. Python is not a Windows application dependency; new runtime licenses are MIT except fast-uri(BSD-3-Clause). See EXCHANGE_SCHEMA_GATE.md.

Root and independent review found no structural-gate blocker. Eight focused tests pass, including actual bounded read feeding all four gates;23 reconstructed probe categories remain covered. Final local baseline514 tests:487pass27explicitWindows-only skips/0fail; syntax137 before final comments/attributes. Source hash resources unchanged. Local full browser44 had42passes/2time-out cancellations in existing20s scenarios, not a44/44 claim; retain this and earlier43/44/manual-timer and fixture-hang failures. Default final Windows/Ubuntu/native browser/package/source/extracted CI plus both oracle jobs must pass before merge. No rerun-until-green.

Fixture-only corrections retain assertions and product budgets: serial baseline suite files(inside-suite concurrency tests remain), recursive fixed-library resource copying, controlled deadline callbacks after actual blocked filesystem admission, actual controller nextAdvanceAt assertion before screenshots/configured4s browser interval, fresh TCP after separate prewarm phase, and5s admission for non-stall TCP assertions while explicit stall remains100ms. A raw SPX endpoint bench uses bounded30s cold-module admission/45s overall after controlled source-identical trace became healthy14.762s; persistent launcher's15s limit is unchanged. Earlier10s/15s and514-test failures are recorded. The metadata timeout unit now controls its one logical timer/clock while actual I/O/flight cleanup stays real; separate real-clock late-completion regression remains. These are test determinism changes, not product startup/performance fixes.

Do not connect this gate to GameDay/output yet. Next: independent V1–V20/JCS IDs/fingerprints/context/ordering/reference/eligibility/closed-problem/calendar/DST rules, durable per-feed binding/sequence ledger, unique verified assets/ordered schema2 staging with schema1 compatibility, then product integration. Licensed clean-machine setup, default browser/graceful close, diagnostics/recovery and4h soak remain evaluation gates. Target Windows10/LAN/Daktronics/DMP/stadium compatibility unverified; no live hardware. First evaluation release NOT READY. No owner upload, token or routine manual test needed.
