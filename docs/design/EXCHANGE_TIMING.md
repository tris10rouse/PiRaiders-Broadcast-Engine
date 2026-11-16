# Detached exchange timing metadata gate

`createExchangeTimingGate().validate(manifest)` adds the draft0.3.1 event/broadcast calendar, Chicago-offset and interval checks after the existing bounded JSON, structural schema, selection-integrity and problem-state gates. It remains detached from Game Day, source preparation, caches, production scheduling, output, timers and arming. No dependency, listener, source write or hardware operation is added.

## Contract and data boundary

The original contract section6 says: “The Engine proposes broadcastWindow, the operator confirms a valid start and end per event, and the Engine caches it. operatingWindow stays null in the export.” It also says: “Missing, ambiguous or nonexistent instants block automatic arming.” Those clauses do not make ambiguous metadata malformed or prohibit showing a proposal for PC operator review.

This API checks only:

- Pattern-only `event.eventDate` under the original schema. A non-null pattern-valid but impossible Gregorian date remains accepted metadata with computed `EVENT_DATE_INVALID` review flag and `timingAvailable:false`; it is not a new wire rejection. Null yields `EVENT_DATE_UNAVAILABLE`. Malformed shapes still fail the prerequisite schema. Source values and reasons are preserved. There is no inferred equality between eventDate and window dates or containment between event and broadcast intervals; lead/tail and midnight crossings remain possible.
- `eventStartsAt`, `eventEndsAt`, `broadcastWindow.startsAt` and `broadcastWindow.endsAt`. The original schema requires uppercaseT, mandatory whole seconds, no fractional seconds, hours00–23/minutes and seconds00–59, and exactly-05:00 or-06:00. Generic `generatedAt`, feed creation and revision date-times keep their existing RFC3339 schema checks and may use fractions/other offsets.
- Positive event order when both event endpoints exist. A positive broadcast interval of at most24 elapsed hours when both broadcast endpoints exist. Section6 and the existing Engine limit concern the operating/broadcast window, so the module does not invent a24h cap for the source event interval or generic audit timestamps.

`operatingWindow` remains strictlynull under the existing schema. This module cannot create or approve one. Source-provided lead is already in the broadcast start; this validator neither reapplies lead nor applies the Engine's15-minute prewarm. The existing local/manual production-window module and its hard deadline are unchanged. Changed source metadata cannot alter, extend, stop or replace an approved window through this detached gate.

## Chicago conversion

One `Intl.DateTimeFormat` per gate is fixed to America/Chicago, ISO8601 calendar, Latin digits and hourCycleh23. The backend options are checked; there is no host-timezone fallback, locale-string parsing, external service or hard-coded DST date table. For each valid local calendar/clock tuple, two possible UTC instants are constructed using-05:00 and-06:00 and formatted back to numeric local fields. The supplied offset must be one of the round-tripping choices. An incorrect seasonal offset or an explicit nonexistent spring-gap time fails with a fixed timing code. UTC construction uses `setUTCFullYear`, avoiding Date.UTC's year0–99 remapping; Gregorian leap checks use arithmetic rather than normalized Date parsing.

Two matches identify a fall-fold wall time. Either correct explicit offset identifies a real, schema/V13/V19-valid instant. Such metadata is accepted, and a computed `AMBIGUOUS_LOCAL_TIME` review flag is returned while automatic timing availability staysfalse. It is not silently rewritten to null or rejected as malformed. It can still be presented for PC review; only later explicit confirmation and admission policy may authorize operation.

Backend initialization failures throw only `TIMING_BACKEND_UNAVAILABLE`; runtime formatting failures return that same fixed code with non-readiness. No fallback guesses a zone or offset.

## Informational results

Every result is immutable and includes `ready:false`, `semanticValidation:pending`, `scope:selection-timing` and `operatorConfirmationRequired:true`. Success labels onlyV13, V19-instant-calendar-order and V19-broadcast-window-duration. Actual asset bytes/decode/aggregate staging, durable feed/sequence/rebind state, eligibility/admission, external descriptor context and operator confirmation remain explicit pending gates.

`timingAvailable:true` means only that the event date is present and Gregorian-valid, and all four source instants are present, valid and unique, with no source-declared timing-unavailable reason. It does not establish current event eligibility, whether a date is past/future, complete/playable content, a confirmed operating window or authorization to arm. Even an empty selection may have well-formed available timing metadata while remaining non-ready.

An impossible pattern-valid eventDate is also accepted for PC review while timing availability remainsfalse; its computed review flag does not rewrite the source's DATE_INVALID reason list. Honest null or partial timings are accepted with `timingAvailable:false`. Source-owned `unavailableReasons` is never derived, cleared or overwritten. A full broadcast window with a missing event start/end remains valid metadata, as in fixture07. A nonempty supplied reason list blocks automatic timing availability even if the visible timestamps alone look valid. The returned fixed review flags describe missing date/instants, source-declared unavailability and computed ambiguity; they do not replace source reason codes.

Malformed input or prerequisite/actual-instant-calendar/offset/interval/backend failures return fixed codes without source values, paths, raw Ajv errors or exception details. Rejected candidates do not modify the input or metadata pin. Success describes only the call-time owned JSON snapshot; later integration must compose it with the immutable captured pin and remaining gates rather than use an old boolean result for a mutable object.

## Verification and limitations

Synthetic tests reconstruct the eight supplied instant vectors as data only and cover both explicit fall-fold choices, wrong seasonal offsets, spring gaps, pattern-valid impossible event dates versus strict actual-instant calendar/leap dates, years0–99, source timestamp grammar, positive order, exact24h boundaries, midnight and23h/25h DST crossings, positive UTC fold order despite reversed wall order and independently negative event/broadcast fold order despite forward wall order, partial source metadata and source-owned reasons. Generic fractional/foreign-offset publication/revision/feed timestamps remain accepted. Backend-failure tests replace only the Intl boundary; actual timezone data is used for normal conversions, and formatter reuse is asserted. Actual temporary feed/catalog/current/manifest capture composes all four schemas and the timing gate without image files or window confirmation.

These tests do not run publisher code, copy private fixture trees, approve source scheduling, establish the complete59-step stateful fixture contract, verify actual image bytes or claim Windows/Drive/NDI/stadium compatibility. Root must run the complete combined regression suite and final-SHA Windows CI before publication/merge. Rollback removes this unused module/tests/document and preserves existing application services, source data, media caches and output.

This gate validates the selected manifest's event, not every catalog event. When current names a newer generation than catalog, the catalog's event times may be stale. Future proposals must use the same verified immutable manifest pin and must not mix its descriptor with catalog timing.
