# Game Day diagnostics

BE-006 item 5c. Part 5c-1 (2026-11-26, fence 77): one model and a read-only route. The page panel (5c-2), the
command (5c-3) and the tested recoveries (5c-4, 5c-5) build on it.

## Six states, never "on air"

`scripts/lib/game-day-diagnostics.cjs` › `diagnose({source, manager})` answers
`{scope:'game-day-diagnostics', ready:false, mode:'source'|'local', states, neverClaimed}`. `states` holds exactly
these six, in this order; each is `{state, code}` (the catalog adds `sequence`). `code` is an upper-case code or
`null`; anything else becomes `STATE_UNAVAILABLE`, so a thrown message or a path never reaches the answer.

| State | Values | Read from |
|---|---|---|
| `exchangeFolder` | `reachable`, `unreachable` (`SOURCE_UNAVAILABLE`), `mismatch` (`SOURCE_ROOT_MISMATCH`), `unknown`, `not-used` | the source service's `rootState()`: does the media root resolve now to the retained canonical spelling, and is it a folder (a file there is `unreachable`) |
| `catalogSequence` | `read` with `sequence`, `unavailable` with the catalog's code, `not-used` | the catalog the newest refresh read (`catalogState()`) |
| `approvals` | `readable`, `unreadable` with the store's code (also `APPROVAL_ROLLBACK`), `not-read`, `unknown`, `not-used` | the approval revalidator's last read (`status().approvals`). The app reads the list when it lists, prepares or admits; the diagnostics never read it themselves, so they do not change admission |
| `prepared` | `prepared`, `preparing`, `cleanup`, `none`, `unknown` | the manager's candidate. An active event is not "prepared" |
| `renderer` | `acknowledged`, `waiting`, `not-active`, `unknown` | the active event's runtime: `ready` means the Caspar HTML producer's page reported its renderer ready after `PLAY` |
| `ndiSender` | `running`, `starting`, `not-running`, `not-configured` (output `none`), `unknown` | the active event's runtime: `running` only when its output is NDI, its state is `ready` and the renderer acknowledged, that is this event's Caspar generation is up with its NDI consumer |

`neverClaimed` is fixed: `sourceDiscovered`, `receiverConnected`, `boardInputSelected`, `onAir`. Nothing in this
app observes those; no field in `states` names or implies them. `ndiSender: running` is a sender, not a source
seen on a network, a receiver or the board (AGENTS.md › Before code changes, item 4).

A local-profile machine answers `not-used` for the three exchange states. An injected source service without a
manager (tests) answers `unknown` with `SOURCE_PLAYBACK_NOT_READY` for the three playback states; a manager whose
snapshot throws answers `unknown` with `STATE_UNAVAILABLE`, never `none`.

## Route

`GET /game-day/api/diagnostics` on every machine, behind the same local-only guard and SPX login policy as
`/game-day/api/state`. It is a plain read: no CSRF token, no store writes, no source refresh. Answer
`{ok:true, diagnostics}`, path-free and id-free (no event id, no feed id). `POST` answers 404.

## Page panel (5c-2)

Part 5c-2 (2026-11-26, fence 78). The Game Day page has a **Diagnostics** section under both columns (one column
below 620 px). It reads the route when the page opens, every 5 s after each answer, after every command and on
**Read diagnostics again** (a button, reached by Tab). One read at a time; a request during a read reads again after it.

| State | Row | Words |
|---|---|---|
| `exchangeFolder` | Exchange folder | Reachable · Not reachable · Not the folder set up on this PC · Not known · Not used on this PC |
| `catalogSequence` | Exchange catalog | Catalog sequence N read · No catalog read · Not known · Not used on this PC |
| `approvals` | Approval list | Readable · Could not be read · Not read yet · Not known · Not used on this PC |
| `prepared` | Prepared event | Prepared, not activated · Preparing · Preparation cleanup running (with `CLOSE_FAILED`: Preparation cleanup not confirmed) · None prepared · Not known |
| `renderer` | Renderer | Acknowledged · Waiting for acknowledgment · No active event · Not known |
| `ndiSender` | NDI sender | Sender running · Sender starting · Not running · Output disabled · Not known |

A state's code, when it matches the model's code pattern, shows under its words; text only, never markup. A value
the page does not know, or a missing state, shows "Not known" (never the value itself). Before the first answer
every row says "Reading…"; when the read fails every row says "Unavailable" (not the last answer) and the summary
says the diagnostics could not be read. A read with no answer within 5 s (the page's bound on every GET) is a failed read: the page shows
it as failed, and a later read recovers (Q-008, browser test with the page's clock standing still while the server
holds the read). An access answer (sign-in, page authorization) goes to the page's
connection banner as the other reads do. After that answer the panel stops reading until the page is reloaded. The summary is a polite live region whose words change only between "read" and "could not be read"; the time of the last read sits on its own line outside it, so a screen reader is not told every 5 s. A fixed note under the rows says a running sender is not a source seen on
the network, a connected receiver, a selected board input or on air. No row uses "ready" or "on air".

## Command (5c-3)

Part 5c-3 (2026-11-26, fence 79). `node scripts/piraiders-diagnose.cjs --machine <absolute path to machine.json>`
prints one JSON line `{ok:true, scope:'game-day-diagnostics-command', ready:false, mode, app, states, neverClaimed}`
with the same six state names in the same order. Each state carries `from`: `stores` or `app`. Exit 0 read
(whatever the states say), 1 machine file refused (`MACHINE_CONFIG_INVALID`), 2 wrong arguments (`DIAGNOSE_USAGE`).
No paths, no ids, no event or feed names.

| State | Read by the command from | Values |
|---|---|---|
| `exchangeFolder` | the media root's real path against the retained canonical spelling, and whether it is a folder | as 5c-1 (`reachable`, `unreachable`, `mismatch`, `not-used`) |
| `catalogSequence` | the exchange catalog read with the retained binding (read-only reader), only from a reachable folder | `read` with `sequence`, else `unavailable` with the folder's or reader's code (`REBIND_REQUIRED` for another feed), `not-used` |
| `approvals` | the approval list replayed by its store's `open` (read-only) | `readable`, `unreadable` with the store's code (`APPROVAL_MISSING` before setup), `not-used` |
| `prepared`, `renderer`, `ndiSender` | the running app's `GET /game-day/api/diagnostics` on `127.0.0.1` and the SPX config's `general.port` (5656 when unset or falsy, as `server.js`'s `port || 5656`) | the app's values, re-checked against 5c-1's lists |

The three store states are the command's own reads, with the app open or closed; the command writes no store and
no file. They can differ from the page's: the page shows what the app last read (`not-read` before its first read),
the command what is on disk now.

`app` says how the runtime states were got, and when they are not the app's, all three are
`{state:'unknown', code}`:

| `app` | Code | Meaning |
|---|---|---|
| `answered` | (the app's) | the route answered a valid diagnostics answer for this machine's mode |
| `not-running` | `APP_NOT_RUNNING` | the connection to the port was refused: nothing listens there |
| `no-answer` | `APP_NO_ANSWER` | something accepted the connection but gave no whole answer within 2 s (a hard deadline for the whole read), or the connection broke |
| `auth-required` | `APP_AUTH_REQUIRED` | the app answered 401 or 403 (SPX login set): running, but the command has no session |
| `unavailable` | `APP_UNAVAILABLE` | the app answered 503 (starting, closing or its backend refused) |
| `mode-mismatch` | `APP_MODE_MISMATCH` | a valid answer for the other mode: the app on that port runs another machine file |
| `invalid-answer` | `APP_ANSWER_INVALID` | anything else: not JSON, over 64 KiB, another app's page, a value outside 5c-1's lists, `ready` not false, a code that is not an upper-case code |
| `config-invalid` | `APP_PORT_INVALID` | the SPX config cannot be read or its port is not a port |

A running app is never reported as `not-running`. The command does not log in, so with an SPX login set it cannot
read the runtime states; it says so. Whether the app on the port runs this exact machine file is only checked by
mode.

## Recovery: missing exchange folder, corrupt cache (5c-4)

Part 5c-4 (2026-11-26, fence 80). Tested on Linux with real stores, source service, manager and diagnostics
(`tests/game-day-recovery.test.cjs`); the folder test runs the real prepared-event runtime and RossTalk session with a
synthetic Caspar process and a scripted program page.

| Fault | What happens | Diagnostics |
|---|---|---|
| Exchange folder moved away while an event plays | The event keeps its deck, picture and output; Next works; a reload is refused (it cannot read the source) and never blacks; a catalog refresh is refused `SOURCE_UNAVAILABLE` | `exchangeFolder: unreachable` (`SOURCE_UNAVAILABLE`), then `catalogSequence: unavailable` (`SOURCE_UNAVAILABLE`) after the refused refresh; `renderer` stays `acknowledged` |
| The folder comes back | A refresh reads the catalog again (same sequence); a reload of the same playback keeps the same deck; Stop blacks | `reachable`, `read` with the sequence |
| A pinned cached snapshot's bytes changed, folder gone (cached start) | Preparation refused (`PREPARE_FAILED`); the snapshot never reaches a runtime; nothing prepared, nothing playing: the output stays black. While an event plays the manager refuses any new preparation (`WINDOW_ACTIVE`), so a playing event is never replaced by it | `prepared: none` with `CACHE_CHANGED` |
| The same, online, when the app reuses the snapshot it staged | Refused the same way, named the same way | `prepared: none` with `CACHE_CHANGED` |

`prepared: none` now carries a code when the manager's last preparation was refused: the manager's `PREPARE_FAILED`
(no runtime could be built) is replaced by the source service's cause, `status().preparation.code` (the provider
driver's `failureCode()`: the cache loader's or coordinator's code, e.g. `CACHE_CHANGED`, `INVALID_MANIFEST`,
`SOURCE_UNAVAILABLE`); `ADMISSION_DENIED`, `CATALOG_INVALID` and `RUNTIME_INVALID` show as they are. A preparation that
succeeds clears it. The page shows the code under "None prepared"; the command passes it through. `initial()` still
throws what it threw; no admission, preparation or playback decision changed.

Known gap (queue `Q-007`): online, the app keeps reusing the refused snapshot, so that button stays refused until the
app restarts (a new coordinator stages a fresh snapshot).

## Recovery: unreadable approval list, renderer crash (5c-5)

Part 5c-5 (2026-11-26, fence 84). Same test file, same real stores, source service, manager, prepared-event runtime and
RossTalk session; Caspar is a synthetic process the test kills, the program page a scripted one.

| Fault | What happens | Diagnostics |
|---|---|---|
| The approval list cannot be read while an event plays (a stray file in its folder: `APPROVAL_INVALID`) | The event keeps its deck and picture and never blacks; Next works. Listing is refused (`CATALOG_INVALID`); nothing new is prepared | `approvals: unreadable` (`APPROVAL_INVALID`) after the listing's read; `renderer` stays `acknowledged` |
| The same, with a button prepared and not yet activated | Activation refused (`ADMISSION_DENIED`); no renderer session opens: the output stays black. Preparing again is refused before any runtime is built (`CATALOG_INVALID`) | `approvals: unreadable`, `renderer: not-active` |
| The list is readable again | Listing, preparation and activation work again; Stop blacks | `approvals: readable` |
| Caspar dies while playing | Its program session closes at once (a real program page blacks itself on that disconnect); control is refused | `renderer: waiting`, `ndiSender: not-running` (no code) at once, before any restart |
| Restart (the supervisor's limit: `maxRestarts` within `windowMs`, delay `restartDelayMs`; 3 in 60 s, 1.5 s apart by default) | A new Caspar process and a new program session on the same accepted deck. It shows nothing until Launch: black, not a picture from before the crash | `acknowledged`, `running` again once the new page acknowledges |
| Dies again past the limit | No further process; control refused | `renderer: waiting`, `ndiSender: not-running`, both `SERVICE_FAULT` |

The approvals state is now the newest completed read of the list, by whoever made it: the listing, a review or an
admission (`exchange-source-service.cjs` observes its one store's `open`). Before 5c-5 only an admission's read
counted, so a failed listing still showed "readable". A read that started earlier never replaces a newer one; a
rollback (`APPROVAL_ROLLBACK`) or a closed service holds whatever a later read says. It decides nothing: admission is
still the revalidator's own read at every manager boundary.

## Ending a dead event (Q-009)

Decided (fence 86): the operator ends it; no later restart is scheduled. Past the restart limit the runtime reports
`restartsExhausted: true` (the supervisor's own `Restart limit exceeded` for Caspar, and no renderer generation now);
only a new event clears it. The manager's `endDeadEvent` (`POST /game-day/api/end-dead`, body
`expectedEventId`, `expectedSelection`, same login and CSRF as every mutation) closes that event and nothing else:

| Situation | Answer | What follows |
|---|---|---|
| The active event is dead (restarts exhausted, not ready, not preparing) | `ok`, the selection moves on | Nothing is active: the output stays black, `renderer: not-active`, `ndiSender: not-running`. Preparing and activating the next event work inside the same window; its new Caspar shows nothing until Launch |
| The event is live or acknowledged, or its bounded restart is still pending | `409 EVENT_NOT_DEAD`, nothing changes | |
| No active event | `409 NOT_READY` | |
| Stale `expectedSelection` / `expectedEventId`, or another operation running | `STALE_SELECTION` / `BUSY` | |

Before Q-009 Stop answered `CONTROL_INHIBITED` and a new preparation `WINDOW_ACTIVE` until the window ended or the app
restarted. Tested on Linux with the real runtime, a synthetic Caspar and a scripted program page
(`tests/game-day-recovery.test.cjs`) and on the web adapter (`tests/game-day-web.test.cjs`). The Game Day page has no
button for it yet (queue `Q-010`). Not tested on Windows or with a real Caspar.

## Not done here

No other fault recovery is tested. A real Caspar crash on Windows is not tested. The command has not been run on Windows. `ndiSender` has
not been compared with a receiver here; the Windows NDI proofs do that for their own jobs only. No hardware,
stadium PC, board or deployment claim.
