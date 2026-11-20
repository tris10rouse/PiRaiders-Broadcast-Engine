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
- **Browsing authority.** Entering a refresh withdraws the current pages. Only the newest refresh that completes with a matching root and a provider catalog grants them. A failed, overtaken or post-close refresh grants nothing, even when the provider itself kept a view. An overtaken refresh that has not reached the provider stops before reading the source.
- Results carry codes, never paths, values or the raw receipt.
- Active playback and Stop are untouched: the service only feeds new preparation and admission.

## Not done here

- No route, screen or approval write: backlog item 4. No change to the provider, the coordinator, the reader, the revalidator, the manager or the contract.
- The root is checked once per operation, before the provider runs. A folder swapped during that operation is caught by the next operation and by the reader's own checks, not by this service.
- No Windows, stadium PC or synced-folder evidence. GitHub's Windows checks run the same Node tests on hosted Windows only.

## Tests

`tests/exchange-source-service.test.cjs`, 8 tests on real temporary source, journal, cache and approval folders with synthetic data: construction and one owner per machine; pages only after a refresh, full labels, no paths; root mismatch, a redirected root withdrawing a good view, a disconnected source; a link alias; superseded refreshes before and inside the provider, and close; manager hooks rereading approvals, including revocation; cached startup with the source disconnected that rereads approvals by itself. Each guard (root check, browsing gate, entry withdrawal, both supersession checks, the cached-startup reread) was removed in turn and at least one test failed every time.
