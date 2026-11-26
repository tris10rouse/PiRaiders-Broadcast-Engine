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

## Not done here

No page panel yet (5c-2), no command (5c-3), no fault recovery beyond what existed (5c-4, 5c-5). `ndiSender` has
not been compared with a receiver here; the Windows NDI proofs do that for their own jobs only. No hardware,
stadium PC, board or deployment claim.
