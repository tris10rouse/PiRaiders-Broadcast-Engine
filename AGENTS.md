# Agent working contract: PiRaiders Broadcast Engine

Builders: 1

Read this document and `ROADMAP.md` before editing. This is a maintained SPX Solo fork used in live stadium production. Maintain original SPX behavior and attribution. An agent acts as an engineer: it does the implementation, runs all feasible tests itself, reports concrete evidence and exceptions, and does not delegate routine debugging to the district operator.

## Mission and user roles
- Local Windows operator uses PiRaiders to prepare events, watch synchronization, inspect graphics and diagnose readiness.
- A separate Daktronics All Sport Pro **iPad operator never sees or controls PiRaiders UI**. Their pre-programmed Daktronics buttons send RossTalk and switch board inputs. Audience-visible transient feedback on board confirms automatic mode and reload state.
- Preserve OGraf and native HTML/CSS/JS support, including SPX project/rundown workflows and Play/Continue/Update/Stop.
- Avoid an OBS/vMix dependency for PiRaiders NDI playout. CasparCG is current candidate. No continuous NDI off the configured event window.

## Repo map (verified SPX upstream)
- `server.js`: Node/Express entry; rendering helpers, Socket.IO and routes.
- `routes/routes-application.js`: pages (incl. renderer); `routes/routes-api-v1.js`: SPX Solo API (some endpoints are 501).
- `utils/playout_casparCG.js`: CasparCG command construction; `utils/spx_getconf.js`: settings; `utils/spx_server_functions.js`: runtime utilities.
- `views/view-controller.handlebars` and `static/js/spx_gc.js`: primary controller and event bus; `static/css/`: original SPX styles.
- `static/js/ograf_functions.js` and `ASSETS/templates/softpix/ograf/`: OGraf support and fixtures.
- `ASSETS/plugins/`: frontend plug-ins; plugins do not automatically supply persistent OS/TCP services.
- `DATAROOT/`: projects/rundowns; avoid committing operator content/secrets; use sanitized fixtures.

## Mandatory exclusive agent lock (BE-000)
Before **any** GitHub mutation (branch creation, commits, PRs, merges, issue writes, workflows), the agent MUST follow docs/agent/LOCKING_PROTOCOL.md and acquire the exclusive coordination/agent-lease Git ref lease with non-force fast-forward compare-and-swap. An active unexpired lease owned by someone else means STOP writes. Renew every 15 minutes (or before each mutating batch), verify owner and fencing token, and release at end. If the coordination branch is missing, inaccessible or corrupt, fail closed and stop mutations. Multiple agents may perform read-only research in parallel; only the elected writer publishes changes.

## Before code changes
1. Acquire and verify the exclusive agent lease, then inspect touched code, neighbor files, format and tests. Write short success criteria tied to `ROADMAP.md` and relevant task in `docs/planning/IMPLEMENTATION_BACKLOG.md` or GitHub Issue.
2. Create a focused branch. Never modify `master` directly. Keep upstream changes easily mergeable.
3. Prefer small, testable modules for PiRaiders-only functionality, and minimal adapters from SPX to those modules.
4. Treat sender running, discovered source, receiver connected, board input selected and on-air as **distinct states**. Do not mislabel evidence.
5. Separate network/listener endpoints from render state; restrict RossTalk listener to allowed LAN senders. Never publish credential-bearing logs.
6. Never make changes to production DMP/VIP routing or the stadium installation without explicit operator approval and an off-air test.

## Commands and verification
- `npm ci`: install locked dependencies. Supported Node version should be pinned after an actual install test; do not invent an LTS compatibility guarantee.
- `npm run check`: repository-independent syntax/static contract smoke checks after the proposed CI setup.
- `npm test`: reserved for meaningful automated tests after it has been implemented; upstream's original script simply fails with `no test specified`.
- `node --check server.js`: quick syntax check, not an integration test.
- Check every changed `.js` with `node --check` where applicable; lint/format tooling may be added in separate PR.
- For UI changes, run a browser demo and capture representative desktop screenshots, keyboard navigation, focus, empty/loading/error states and relevant regressions.
- For rendering changes, prove original SPX HTML Play/Continue/Update/Stop and OGraf work. Prove CasparCG output, NDI source behavior and scoreboard reception **only on verified hardware**. Simulators don't establish hardware compatibility.
- CI should run on pull requests and pushes to the working branch, not require any stadium machine. Tests involving Daktronics/NDI become manual hardware gates documented with date and equipment.

## Design system
- Keep the SPX-native controller hierarchy: project → rundown → items, items with Play/Continue/Update/Stop, graphics previews and output layers.
- Add a distinct Game Day preparation view without repurposing original graphic controls or concealing them. No PiRaiders controls are intended for the iPad.
- Avoid misleading statuses: `Ready`, `NDI sending`, `RossTalk last received`, and `Board route unverified` are different.
- OGraf and SPX HTML compatibility are hard requirements; do not replace the underlying renderer with slide-only logic.

## Completion criteria
For every change, provide in chat/PR: (1) plain-language summary, (2) files affected, (3) commands run and actual PASS/FAIL results, (4) screenshots or tests where appropriate, (5) behavior not tested and why, (6) operational risk/rollback, (7) recommended next step. Do not claim test success without executing it. Track known issues; no silent requirement cuts or invented capabilities.

## Safety and authorship
- Respect the upstream MIT license and copyright headers. Track any new third-party dependencies and licenses. Review AGPL dependencies before any code incorporation.
- Never commit OAuth tokens, IPs/hostnames that reveal protected network topology, student data, private Google Drive links, or operator credentials.
- Keep operator-safe error graphics, last valid cache, graceful fallback, and retry bounds.
- Human must approve production deployment, network changes, and code signing/release publication.

## Links
| What | Where |
|---|---|
| Repository | `tris10rouse/PiRaiders-Broadcast-Engine`, public, default branch `master`. Work lands only by pull request with every check on its final commit green |
| Queue | `queue/ORDER.md` (the top line in `todo/` is next) and `queue/todo`, `needs-you`, `blocked`, `parked`. No private data in any queue file: `node scripts/builder/queue.cjs lint` refuses it |
| Builder run | A new session made with `create_session`: `source_url` https://github.com/tris10rouse/PiRaiders-Broadcast-Engine, `model` claude-opus-5-5, `title` "Engine builder", `prompt` exactly: `You are a builder for this repository. Read AGENTS.md and follow its section "A run" exactly: one request, then stop. If AGENTS.md has no section "A run", do nothing and end.` |
| Lease | `node scripts/builder/lease-git.mjs status / acquire / renew / assert / release` (git transport of `LOCKING_PROTOCOL.md`; owner and fence kept in `.git/builder-lease.json`) |
| GitHub checks | `node scripts/builder/wait-checks.cjs <sha>` (reads check runs, renews the lease while it waits); `--once` for one read |
| Status | `node scripts/builder/tracker.cjs` (the builders skill's "status") |
| Scheduled task "Broadcast Engine takeover" | Off since 2026-11-20. The builders replace its runs. Do not change, enable or delete it without the owner's OK (his words, 2026-11-23). If it is switched on, the lease keeps it and a builder from writing at the same time |

## A run
1. If the session did not start with the line `HOOKS ON`, say "hooks off" in your closing line and carry on.
2. Read `Builders: N` above. N of 0 means stop: end with no message.
3. **The lease:** `node scripts/builder/lease-git.mjs acquire`. Exit 3 (another agent holds it, or won the race): end at once with one line, "Lock held; nothing done". Any other failure: fail closed, end. Renew it (`… renew`) at least every 15 minutes and before every push; exit 3 from any renew means stop all writes. Release it (`… release`) at the end of every run, also when the run fails.
4. If `acquire` printed `resume` (a run died holding a row), that row and its branch are yours first: inspect the branch and any open pull request from it before doing anything else, then go to step 8 with that row.
5. **Open pull requests:** for each open pull request from a `feature/` branch whose row is in `queue/` with a `PR:` line: read its checks (`wait-checks.cjs <sha> --once`); green and the whole diff read: merge it (land skill, step 7); red: that row is this run's row (step 8).
6. **The default branch's checks:** `node scripts/builder/wait-checks.cjs master --once`. A red check is recorded in CLAUDE_HANDOFF.md with its cause or "cause unknown", never rerun to get green; if it is not already a queue row, a `Q-nnn` Fix row goes first in `queue/ORDER.md` (in this run's pull request). A parked row whose condition is now met moves to `todo/`, first in ORDER.md. For each file in `queue/needs-you/` with a `Link:`, read the owner's marks: all filled means go, move it to `todo/` (blank marks never build).
7. Take the first row in `queue/ORDER.md` that is in `queue/todo/` (`node scripts/builder/queue.cjs next`). None: release the lease and end with no message.
8. **Claim it:** `node scripts/builder/lease-git.mjs renew --task <row> --branch feature/<row>-<short-name>`. The lease is the claim; there is no claim commit.
9. If the row needs the owner (what the operator or the audience sees with more than one sensible design, hardware, the stadium PC, a licence or an account): use the `proposal` skill, then step 12.
10. Otherwise build it with the `build` skill (it splits an M or L row into S parts first) and land it with the `land` skill: a pull request, every check on its final commit green, the whole diff read, squash merge; the row's file and ORDER.md line deleted in it, the Road table and Run log in CLAUDE_HANDOFF.md updated in it.
11. Keep the "Road to the evaluation build" count honest, as CLAUDE_HANDOFF.md says: a split or a new failing check adds a line the moment it is found.
12. Release the lease. Then, if `queue/todo/` still holds a row and `Builders:` is above 0, start one builder run as Links › Builder run says (`create_session`). If `create_session` is refused (sessions started from sessions stop at 8 deep), send one push notification, "Engine builders paused after 8 runs in a row: say start the builders in a chat", and nothing else.
13. **If anything fails:** never leave a row half-done without a trace. Push the branch as it is (without force); move the row's file to `queue/blocked/` with one plain line `Blocked: <why>` (or to `queue/needs-you/` with `Needs you:` if only the owner can clear it, then one push notification), add `Branch:` and `PR:` lines, land that queue change by its own pull request if the lease still holds, and release the lease. Lost the lease: stop all writes at once.
14. End with at most 10 plain lines: what is now true, what failed, what is next, and the Road table's "Parts left · runs left" line. No other message to the owner unless step 9, 12 or 13 says so.

