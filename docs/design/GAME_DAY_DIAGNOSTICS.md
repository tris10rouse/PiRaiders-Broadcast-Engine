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
says the diagnostics could not be read. An access answer (sign-in, page authorization) goes to the page's
connection banner as the other reads do. A fixed note under the rows says a running sender is not a source seen on
the network, a connected receiver, a selected board input or on air. No row uses "ready" or "on air".

## Not done here

No command yet (5c-3), no fault recovery beyond what existed (5c-4, 5c-5). `ndiSender` has
not been compared with a receiver here; the Windows NDI proofs do that for their own jobs only. No hardware,
stadium PC, board or deployment claim.
