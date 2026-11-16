# Detached exchange structural schema gate

The Engine can validate the four supplied draft0.3.1 feed, catalog, current and selection schemas without trusting a source-supplied schema or fetching resources. This is structural validation only: every result remains `ready:false, semanticValidation:pending`. Nothing is connected to Game Day, source writes, a cache, a ledger or output arming.

## Inputs, provenance and diagnostics

`createExchangeSchemaGate()` builds a fixed local registry from four inspected schema resources. Original bytes, IDs and clauses remain unchanged; `exchange-schemas/provenance.json` records SHA256 and byte counts checked before compilation. Only schema resources are incorporated, not publisher scripts, private fixture trees, Drive links or operator data. URLs are the JSON Schema meta-schema and intentionally invalid `schemas.piraiders.invalid` IDs. Registry compilation has no network loader.

`validate(kind, document)` accepts the bounded, duplicate-safe/fatal-UTF8 JSON objects captured by the detached metadata reader. The caller must enforce transport bounds before validation; this synchronous structural API is not an unbounded public HTTP validator. Required/extra fields, types, ranges, patterns, enums, conditions and full date-time formats are enforced. Coercion, default insertion and property removal are disabled. `strictSchema:true` is enabled; type/tuple schema lint restrictions are disabled to compile the original schema shapes, without disabling data rules. The supplied `x-contract` keyword is an annotation.

Results expose only fixed codes, a known kind and bounded keyword categories. They do not echo raw Ajv errors, values, instance paths or exceptions. Constructor/backend errors use fixed categories. Backend versions are checked against exact `ajv@8.20.0` and `ajv-formats@3.0.1`. Both direct dependencies are MIT; transitives are MIT except fast-uri(BSD-3-Clause). Existing application package/lock files receive only these reviewed additions; isolated harness files/node_modules are never copied wholesale. Packaged dependency notices remain installed.

## Equivalent contains correction

Pinned Ajv8.20.0 rejects a valid finished-event item followed by an eligible item when `contains` inside `if` reuses an earlier match; individual items validate. Both allErrors modes reproduce the defect. Exactly three default-contains sites are restated in memory: eligibility and the two selection-level limit-problem matchers.

For arrays, `contains:S` means at least one item satisfies S. Equivalently, not every item fails S: `not:{type:array,items:{not:S}}`. The type guard preserves success for nonarrays where contains is ignored; empty arrays still fail. Existing allOf clauses remain. No eligibility/problem/limit clause is removed and original schema files are not edited.

The scoped rewrite rejects minContains/maxContains and unevaluatedItems/unevaluatedProperties because their count/annotation semantics are not claimed. Traversal distinguishes schema positions from const/enum/default/example data and property names. Exact provenance and a total of three rewritten sites reject drift requiring review.

## Independent verification

Eight Node tests cover23 reconstructed supplied probe categories, the actual catalog finished→eligible regression, strict four-schema acceptance/rejection, redacted errors, unchanged inputs, date-time/calendar vectors and actual bounded filesystem capture feeding all four validators. That integration intentionally retains uncomputed fingerprints and missing event times: structural success still cannot be playable or armed.

`npm run verify:exchange-schema` compares9173 finite cases against Python jsonschema4.26.0 Draft202012Validator on original and rewritten schemas, then requires rewritten Ajv to agree with the original oracle in both allErrors modes. Cases include eligibility reason arrays up to length3, pairs of valid/invalid atoms, four-item transitions and JSON-type representatives at each actual contains site. The Boolean argument supplies the general equivalence; finite tests exercise the compiler, not an exhaustive claim over all JSON.

Python is a CI/test oracle only, never a Windows application dependency. `tools/requirements-schema-oracle.txt` pins it and its dependencies; CI installs binary distributions and runs the oracle plus the static numeric audit. Missing support fails instead of skipping. The oracle deliberately does not check formats; separate explicit Gregorian leap/calendar/hour/minute/offset vectors exercise the full date-time backend. Chicago/DST/event-time acceptance remains pending. The numeric audit finds13 declarations, all bounded nonnegative/positive integers (including nullable sourceRevision.size), so this draft admits no numeric field excluded by the transport parser's safe-integer domain.

## Reproducible fixtures and retained failures

The source reader remains detached and existing local/manual behavior is unchanged. Test infrastructure changes admit the intended test phase without depending on unrelated suite scheduling:

- Baseline suite files execute serially; each suite retains its explicit concurrency/race tests, assertions and product budgets. Earlier parallel startup failures remain recorded. The metadata timeout/physical-flight unit uses a controlled clock and timer after real blocked I/O admission; its separate real-clock late-completion regression is unchanged. TCP rejection/limit/close cases use the existing5s protocol admission budget, while the intentional stalled-server timeout remains100ms. Neither edit changes product limits.
- The isolated SPX fixture recursively copies fixed runtime library resources, including schemas. Initial EISDIR failures were corrected; production source selection is unchanged.
- The Reload timeout unit test admits real blocked filesystem I/O before explicitly firing its one timer callback. Other I/O/transport/ACKs stay real. Earlier premature timeout could leave an unbounded fixture wait; the new admission race fails decisively if Reload settles first. Congestion uses an explicit10s fixture ACK budget to reach its tested state, with strict Stop/orphan/queue assertions intact.
- The browser test reads the actual controller nextAdvanceAt before screenshots can consume a short interval. It uses a configured4s interval and a fresh TCP connection after the separate startup/prewarm phase. Unit fake-clock tests still prove precise default10s/reset behavior; product defaults/timeouts do not change.
- The raw SPX endpoint bench has a bounded30s cold-module admission, retaining45s overall test and strict cleanup. This is not a10s performance SLA or a change to the persistent launcher's independent15s deadline. A controlled source-identical trace became healthy at14.762s, with cold Express/routes imports taking seconds. Earlier10s/15s failures remain recorded; no product startup fix is claimed.

Full final baseline, browser, independent oracle, Windows package and source/extracted native output CI remain mandatory before merge. A focused pass does not erase an earlier failure or establish hardware readiness.

## Remaining gates and rollback

This module does not implement independent V1–V20 semantics, JCS fingerprints/selection IDs, cross-file equality, chronological pin rules, calendar/DST eligibility, verified assets, schema2 staging, a durable binding ledger or product integration. A pattern-valid pointer can name the wrong generation; a YYYY-MM-DD eventDate can be calendar-invalid. Source loaded ticks and schema validity are not Engine readiness.

Rollback removes the detached resources/module/tests and the new direct dependencies if unused, and reverts fixture-only adjustments. No accepted media, source publisher, live service or stadium equipment is modified.
