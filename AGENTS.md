# Agent working contract: PiRaiders Broadcast Engine

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

## Before code changes
1. Inspect touched code, neighbor files, format and tests. Write short success criteria tied to `ROADMAP.md` and relevant issue.
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