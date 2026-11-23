# Source catalog service (BE-006, second slice of the source service)

`scripts/lib/exchange-source-service.cjs` puts the pieces that already existed (the exchange source provider, its catalog pages and the exact approval revalidator from `EXCHANGE_APPROVAL_POLICY.md`) behind one object built from the machine configuration. It is what the PC source selector and the approval confirmation screen (backlog item 4) will call. It adds no route, screen, approval write, journal setup, source write or wiring into `scripts/piraiders-app.cjs`; a source-enabled machine still cannot run the application.

## What it provides

`createExchangeSourceService(machine, trusted?)` accepts only a loader-made machine with a `source` section (`isGameDayMachineConfig`); copies, JSON clones and local-folder machines are refused (`SOURCE_SERVICE_MACHINE_INVALID`). It builds one provider from the machine (provider ID, media root as source root, cache root, the retained journal directory, journal store ID and feed binding) and one revalidator for the same machine. A second service for the same machine is refused with the provider's `PROVIDER_ALREADY_OPEN` until the first is closed. `trusted` is for tests only: `provider` (the provider's own test seams), `approvalStore`, `realpath`.

- `refreshCatalog({signal}?)`: checks the source root, then refreshes the provider's catalog. Returns `{ok:true, ready:false, catalogSequence, catalog}` or `{ok:false, ready:false, code}`; it never throws.
- `catalogState()`, `catalogEventsPage(query)`, `catalogSelectionsPage(query)`: the provider's pages (queries, sizes and codes as in `EXCHANGE_CATALOG_PAGES.md`), handed out only while this service's newest refresh has succeeded. Otherwise `CATALOG_UNAVAILABLE`, or `SOURCE_SERVICE_CLOSED`.
- `inspectSelection(tuple, {signal}?)`: checks the source root, then the provider's metadata-only inspection (`SOURCE_MACHINE_POLICY.md`). Review data, `ready:false`; it approves nothing.
- `preparedMedia(profile)`: the provider's branded driver for one exact exchange profile, always with this machine's offline authorizer. Online startup checks the source root first. Cached startup never contacts the source and rereads the approval store first, so its offline decision comes from a completed, current read.
- `admission`: `{admitCandidate, refreshAdmission}`, the revalidator's hooks, to pass to `createGameDayManager`.
- `refreshApprovals()`, `status()` (path-free: provider ID, catalog availability and code, provider busy/closed/observation revision, approval read/revision/code/rolled back/closed; always `ready:false`), `close()` (idempotent; closes the revalidator and the provider), `policyFingerprint`.

## Rules

- **Source root.** Before every operation that reads the source, the configured media root is resolved and must equal the machine's retained `expectedCanonicalRoot` (case-insensitive on Windows). Otherwise `SOURCE_ROOT_MISMATCH` (or `SOURCE_UNAVAILABLE` when it cannot be resolved), and the provider is not called. The loader already keeps that spelling apart from every private root, so a match also proves the live source is not a private folder. A configured link alias passes this check, but the existing source reader still refuses links (`UNSAFE_INPUT`); the service does not weaken that rule.
- **Browsing authority.** Entering a refresh withdraws the current pages. Only the newest refresh that completes with a matching root and a provider catalog grants them. A failed, overtaken or post-close refresh grants nothing, even when the provider itself kept a view. An overtaken refresh that has not reached the provider stops before reading the source. A newer refresh that arrives while an older one of this service is still inside the provider waits for that call to end (the provider's operation timeout bounds it) and then reads, instead of being refused `BUSY` by the provider's single slot; while it waits, a still newer refresh or `close()` stops it before it reads. Before 2026-11-23 (Q-005) the newer one was refused `BUSY` and the overtaken older one granted nothing, so neither succeeded. `BUSY` still comes back when the slot is held by a review or a preparation.
- Results carry codes, never paths, values or the raw receipt.
- Active playback and Stop are untouched: the service only feeds new preparation and admission.

## Not done here

- No route, screen or approval write: backlog item 4. No change to the provider, the coordinator, the reader, the revalidator, the manager or the contract.
- The root is checked once per operation, before the provider runs. A folder swapped during that operation is caught by the next operation and by the reader's own checks, not by this service.
- No Windows, stadium PC or synced-folder evidence. GitHub's Windows checks run the same Node tests on hosted Windows only.

## Tests

`tests/exchange-source-service.test.cjs`, 9 tests on real temporary source, journal, cache and approval folders with synthetic data: construction and one owner per machine; pages only after a refresh, full labels, no paths; root mismatch, a redirected root withdrawing a good view, a disconnected source; a link alias; superseded refreshes before and inside the provider, and close; a newer refresh waiting for an older one inside the provider (one succeeds), overtaken or closed while it waits; manager hooks rereading approvals, including revocation; cached startup with the source disconnected that rereads approvals by itself. Each guard (root check, browsing gate, entry withdrawal, both supersession checks, the cached-startup reread) was removed in turn and at least one test failed every time. The wait (Q-005) and its two checks while waiting (overtaken, closed) were each removed and the new test failed.

## Routes (backlog item 4a, 2026-11-20)

`scripts/lib/game-day-web.cjs` now builds this service when the loaded machine has a `source` section, instead of failing with `APP_CONFIG_INVALID`. A source machine has no playback manager yet (item 4d), so `GET /game-day/api/state`, `GET /game-day/api/events` and every playback POST answer `503 SOURCE_PLAYBACK_NOT_READY`. The page renders (it issues the CSRF token the source routes need) with a fixed notice that the selection screen is not built; the screen is item 4b.

| Route | Body | Calls |
|---|---|---|
| `GET /game-day/api/source/status` | none | `{ok:true, ready:false, status: status(), catalog: catalogState()}` |
| `POST /game-day/api/source/refresh` | `{}` exactly | `refreshCatalog()` |
| `POST /game-day/api/source/events` | `{revision, offset, limit}` exactly | `catalogEventsPage` |
| `POST /game-day/api/source/selections` | `{revision, eventKey, offset, limit}` exactly | `catalogSelectionsPage` |

- Same guard as every Game Day route: loopback peer, exact Host and Origin, Fetch Metadata, the SPX login policy, no query strings. The POSTs also need the session's CSRF header and JSON of at most 4 KiB. The page reads are POSTs only because the guard refuses query strings.
- The HTTP layer keeps the body schema exact (revision 64 lowercase hex, offset a safe integer ≥ 0, limit 1–64, event key 1–128 UTF-16 units without control characters) and leaves the real query rules to the service. Status codes: `CATALOG_QUERY_INVALID` 400, `CATALOG_EVENT_MISSING` 404, `CATALOG_REVISION_STALE`, `CATALOG_UNAVAILABLE`, `CATALOG_REFRESH_SUPERSEDED` and `BUSY` 409, everything else 503. A thrown service error becomes `503 SOURCE_SERVICE_FAILED`; its message never reaches the page.
- A local-folder machine has no source routes (404); its playback routes are unchanged. Closing the web adapter closes the service and frees the provider for the next adapter.
- Not here: inspection, approval, revocation (item 4c) and preparation of an approved selection (item 4d).
- Tests: `tests/game-day-source-web.test.cjs`, 4 tests over real HTTP with the real view and the real service on temporary synthetic folders. Removing the source-mode check, the body schema, the playback refusal or the page's source mode each made at least one test fail.

## Catalog screen (backlog item 4b, 2026-11-20)

The view renders `<body data-mode="source">` and an **Exchange events** section (`#source-section`) only for a source machine; CSS hides the local event list there. `static/js/piraiders-game-day.js` then uses only the four source routes:

- **Load:** `GET source/status`; if a catalog is already browsable it adopts that revision, otherwise it posts one refresh. The status poll (every 3 s) is the connection check; the local `state` and `events` routes are never called.
- **Lists:** events, then the chosen event's selections, 25 per page (`limit: 25`, below the service's 64) with "Show more". Each list keeps only its newest request; an answer for an older request, another event or an older refresh is dropped. Rows are checked for shape and length before they are drawn; text goes in with `textContent` only.
- **Review:** choosing a selection shows event, board (the event board's display name when the keys match, else the board key), button label, picture count with manifest state, and generation. No approval, inspection or preparation request exists in this slice.
- **Problems:** a status poll that sees a different revision, or a page answering `CATALOG_REVISION_STALE` / `CATALOG_UNAVAILABLE`, empties the lists and shows a message with a refresh button; `CATALOG_EVENT_MISSING` empties only the event's buttons; `BUSY` keeps the lists. A failed refresh (`SOURCE_UNAVAILABLE`, `SOURCE_ROOT_MISMATCH`, …) shows no catalog. Superseded refreshes defer to the newest one through status.
- Stop and the playback controls are not touched; with no playback state they stay disabled on a source machine.
- Tests: `tests/browser/game-day-source.browser.cjs` (6 tests, desktop and 390 px). Removing the stale check, the busy rule or the newest-request guard each made a test fail.

## Review and approval (backlog item 4c, 2026-11-20)

The service now writes PC confirmations to this machine's approval store (`EXCHANGE_APPROVAL_STORE.md`); the revalidator (`EXCHANGE_APPROVAL_POLICY.md`) stays the only place that decides admission. One store object serves both.

- `reviewSelection(tuple, {signal}?)`: checks the source root, inspects the selection (metadata only) and reads the store. Returns `{ok:true, ready:false, admissionEligible, inspection, approval}`; `approval` is `{read:true, code:null, revision, record}` or `{read:false, code, record:null}` (for example `APPROVAL_MISSING` before setup). `record` is `null` or `{productionWindow, current, offlinePinned}`; `current` is false for a record saved under another machine-policy fingerprint, which admits nothing.
- `confirmSelection({identityTuple, inspectionRevision, productionWindow})`: exact request (`APPROVAL_REQUEST_INVALID`); window normalised with the production-window rules (`APPROVAL_WINDOW_INVALID`); then a fresh inspection: a different inspection revision is `APPROVAL_INSPECTION_STALE`, an ineligible event `APPROVAL_SELECTION_INELIGIBLE`, a source problem its own code. Only then one `confirm` record is appended with this machine's policy fingerprint, provider, binding, tuple, the normalised window and `offline:null`. The same confirmation again adds nothing (`changed:false`).
- `revokeSelection({identityTuple})`: appends a `revoke`; never reads the source. Nothing to revoke is `changed:false`.
- One write at a time per service (`BUSY`); the store's expected revision and head turn a writer elsewhere into `APPROVAL_CONFLICT`. After every write attempt the revalidator rereads the store, so a revocation withdraws admission at once. A write during a manager admission reread overtakes that reread, which then denies (fails closed).
- Results are path-free: codes, the inspection, the record's window and two flags.
- Store setup stays explicit: no screen or route creates the store (decision: part of the setup increment, item 5). Since 5b-1 that is `scripts/piraiders-setup.cjs` (`EXCHANGE_SETUP.md`). Cached-startup pins (`offline`) are not written here.

| Route | Body | Calls |
|---|---|---|
| `POST /game-day/api/source/review` | `{identityTuple}` | `reviewSelection` |
| `POST /game-day/api/source/approve` | `{identityTuple, inspectionRevision, productionWindow:{start, end, prewarmMinutes}}` | `confirmSelection` |
| `POST /game-day/api/source/revoke` | `{identityTuple}` | `revokeSelection` |

The HTTP layer keeps the bodies exact (tuple: 5 strings of at most 200 UTF-16 units without control characters; revision 64 lowercase hex; start and end strings of at most 40; warm-up an integer 0–60) behind the same guard and CSRF as the other source routes. Status codes: request, window and selection-shape codes 400; `APPROVAL_INSPECTION_STALE`, `APPROVAL_SELECTION_INELIGIBLE`, `APPROVAL_CONFLICT` and `BUSY` 409; everything else (including `APPROVAL_MISSING`) 503.

**Screen.** The chosen button's panel has **Check this button** (review), then shows the checked version, the scheduler's times in Central time, timing warnings in plain words and the saved approval. The window form is prefilled from the scheduler's broadcast window on this PC's clock (warm-up 15), validated on the page, and needs a second **Confirm approval** that states the button, board, event and window in Central time. **Revoke approval…** has the same confirmation. A late review or write answer for an older choice, catalog or review is dropped; a stale answer clears the review so the operator checks again. With no approval list, an unreadable list or an ineligible event the form is not offered. Playback controls and Stop are untouched.

Tests: `tests/exchange-source-service.test.cjs` (2 new), `tests/game-day-source-web.test.cjs` (1 new, exact bodies), `tests/browser/game-day-source.browser.cjs` (3 new, desktop and 390 px). Removing the inspection-revision check, the eligibility check, the reread after a write, the one-writer rule or the `current` flag each made a test fail.

Not done here: preparation and playback of an approved selection on a source machine (item 4d); store setup and cached-startup pins (later work); no Windows, stadium PC or synced-folder evidence.

## Playback of approved selections (backlog item 4d, part 1, 2026-11-20)

- `playbackCatalog` is the manager's catalog on a source machine. `list()` reads the approval store only (never the source) and returns this machine's current confirmations: same provider, binding and machine-policy fingerprint; soonest window first, at most 128. Each gets the event id `sel-` + 40 hex of SHA-256 over the canonical provider, binding and tuple (stable across restarts and window changes) and the display name `button label · event key · board key` (at most 200 code points). `read(id)` builds the exchange profile from machine policy (SPX, Caspar with `runtimeRoot/<id>`, presentation, RossTalk, output, cache root) plus the confirmed tuple and window, `startup:{mode:'source'}`; its revision is SHA-256 over id, tuple, normalised window and policy fingerprint, so a changed window is a new revision. An unknown, revoked or foreign id is `CATALOG_INVALID`; a closed service `SOURCE_SERVICE_CLOSED`.
- `preparedRuntimeFactory(base)` wraps a prepared-event runtime factory: it asks `preparedMedia(profile)` for the driver (source root checked first) and passes it as `preparedMedia`. If `base` throws, the driver is closed there; a built runtime closes it itself.
- `game-day-web.cjs` builds, for a loaded source machine, a manager with that catalog, the wrapped `createPreparedEventRuntime`, the service's admission hooks, `sourceRoot` = media root and private roots runtime root, catalog directory and approval directory. `state`, `events`, `prepare`, `activate`, `discard` and `command` work as on a local machine. Close closes the manager first and the service only when that succeeded, so a failed close is retried with the provider still open. A trusted `runtimeFactory` option (tests only) replaces the real runtime; it is refused with an injected manager or service. An injected service alone keeps `SOURCE_PLAYBACK_NOT_READY`.
- Not here: the screen (item 4d part 2), cached startup and offline pins (item 5), any Windows, Caspar or board evidence.
- Tests: `tests/exchange-source-service.test.cjs` (2 new) and `tests/game-day-source-web.test.cjs` (1 new, 2 changed). Removing the machine-policy filter or the driver close each made a test fail. The close order (manager before service) is not covered by a test.

## Playback screen on a source machine (backlog item 4d, part 2, 2026-11-20)

- The Game Day page in source mode shows three parts: **Exchange events** (items 4b, 4c), **Approved board buttons** under it, and **Playback** beside both (one column at 620 px and below). The approved list is the manager's `GET events` (this PC's current confirmations, store read only); prepare, activate, discard, the playback commands and Stop use the ordinary routes and the ordinary page code, unchanged.
- Names: the manager's display name (`button label · event key · board key`). The catalog's friendlier event and board names are not used, because the page cannot map a `sel-` id back to a tuple; decide later whether the manager should carry them.
- After every saved approve or revoke the page rereads the approved list (a read already in flight is followed by one more). A revoked button leaves the list; a prepared candidate stays visible, and activation answers `ADMISSION_DENIED`, shown as "This PC no longer accepts that button…". Source-mode wording also replaces `CATALOG_INVALID` and `PREPARE_FAILED`.
- Not here: cached startup and offline pins, approval-list setup (item 5), any Windows, Caspar, NDI or board evidence.
- Tests: `tests/browser/game-day-source.browser.cjs`, 2 new (real adapter, service and store, synthetic runtime; desktop and 390 px) and 1 changed; the scripted fixture answers `state` and `events`.
