# SPX-hosted Game Day integration

This increment adds the workstation page and guarded HTTP adapter. It does not switch the Windows package's launcher or establish a user-testable release. The existing SPX graphics workspace remains available; the separate Daktronics iPad operator uses only its preprogrammed buttons/RossTalk.

## Developer activation

Use an existing valid SPX config and schema1 machine/catalog described in GAME_DAY_BACKEND.md. The SPX process must run from its application root and use the same config referenced by machine.spxConfigFile. Set PIRAIDERS_APP_CONFIG to the absolute machine file, then run the ordinary server with that SPX config. Open the exact numeric-loopback address http://127.0.0.1:<configured-port>/game-day. Missing components/media fail event preparation rather than stopping SPX; invalid machine initialization gives fixed503 while original SPX remains available. Real event-runtime activation is Windows-only.

No startup secret is needed for this manual developer path. The forthcoming persistent parent launcher supplies an ephemeral secret and verifies startup identity before opening the browser. It must require the existing config before SPX's upstream config-generation path; this manual mode does not claim installer safety. To roll back, stop the developer process and start ordinary SPX without PIRAIDERS_APP_CONFIG. Persisted SPX config and operator content are unchanged by enabling this adapter.

## Operator behavior

Select a local event, prepare its validated snapshot, review the candidate and activate it. Selecting or preparing a catalog entry does not change active output. Active/prewarm windows protect event replacement. Launch starts slide1, navigation wraps, and Auto/Manual/Reload use the same bounded priority-Stop admission as actual RossTalk. Stop requests black and leaves sender lifetime under the configured window. Closing the tab sends no service shutdown.

The page distinguishes prepared media, renderer acknowledgment, output configuration and unverified receiver/board state. It never embeds the private producer URL or fabricates program imagery. Optional slide totals come from accepted content; a configured NDI source name is configuration, not discovery/output evidence. “Event settings version” is catalog JSON revision, not a media fingerprint or Apps Script loaded tick. This provider is local/manual, not a verified Apps Script exporter/importer.

State polling is serialized/coalesced; stale pre-command responses cannot overwrite later state. Stop has its own coalesced request slot and blocks normal UI mutations while pending. Connection errors retain the last known state. AUTH_REQUIRED offers existing SPX login; CSRF_DENIED requires reloading Game Day; AUTH_POLICY_REQUIRED points to existing SPX configuration; security refusals direct the operator to the local launcher address. No page requests a network/firewall permission change.

## HTTP and ownership boundary

The guard runs before static files, broad parsers and global CORS. It protects accepted case/trailing variants and refuses encoded/normalized/query/absolute-form aliases. Every protected page/API/asset checks the actual socket peer and exact numeric-loopback Host; forwarded headers grant no authority. Wrong/null Origin is refused on GET, and mutations require exact Origin plus checked Fetch Metadata when supplied. Session authentication follows existing SPX policy; the empty-password setup case redirects to its original route so Game Day CSP stays strict.

Mutations require exact4KiB uncompressed JSON schemas and a constant-time checked random per-session CSRF header. Tokens are absent from URLs/logs/status. Replies use fixed errors, no-store/no-referrer, self-only script/style/connect CSP, nosniff and frame denial. Original SPX routes/CORS/static/login behavior remains outside this namespace. A conditional original SPX menu entry links back to Game Day only when enabled.

Optional GET /game-day/internal/startup-identity is for parent startup, not playback. With a parent-provided64hex secret, it accepts one fresh32hex header challenge and returns HMAC-SHA256 using the decoded32-byte key and ASCII challenge. Secret is never sent. Successful initialization, loopback peer, exact Host and an IPv4-loopback local interface are required; no operator session is required for this non-control proof. Parent must bound headers/body/absolute time, reject redirects/replay and recheck its current owned process generation. This proves key possession under owned process lifetime, not NDI/hardware readiness or OS TCP-PID enumeration.

## Verification and release limits

Local integrated validation before the final config-alias correction: syntax107, baseline384 with368 Linux passes/16 Windows-only skips, actual Chromium43/43 without skips. Security tests use real HTTP; actual SPX subprocess/browser tests verify page/assets/catalog, existing login and shows/gc/native HTML/OGraf delivery, startup proof, fixed failures and default-mode compatibility. The success browser test fully prepares PNG media and activates a future event with a trusted Node preload that throws if the native spawn boundary is reached; its marker remains absent. Corrupt replacement media retains the accepted snapshot and SPX PID. This is actual application behavior with a scoped OS boundary, not native Caspar/NDI execution.

UI8 browser cases use explicitly simulated API responses for keyboard, long-content, loading/error/session and request-order races. Desktop1440 and390px evidence was inspected. A fresh substituted finish reviewer scored all three requested fixes resolved; shipped Impeccable tooling was unavailable and no detector ran. This verdict covers the scored UI fixes, not the whole application. Browser evidence is retained by CI alongside existing native-template captures.

Canonical config-reference correction subsequently passed17 affected Node tests and both actual-SPX browser tests, with unchanged config bytes and no source reads. Final-SHA Windows/Ubuntu checks remain mandatory before merge. The persistent launcher, nested SPX/event JobHost/Caspar containment, actual full-application NDI output, licensed component setup, reproducible evaluation ZIP, diagnostics/preflight/soak and precise nonproduction checklist remain release gates. No Windows10 target, LAN or stadium compatibility is claimed.


CI recovery: footer navigation now remains one fragment across 320–390px wrap-prone font tests; failing layout probes save geometry and screenshots before asserting. Real Windows proof tools now record PID/decimal creation ticks/image, reject stale parent ancestry and distinguish reused PIDs from surviving generations. They remain excluded from the application bundle. Linux unit evidence does not establish the cause or resolution of the earlier Windows cleanup failure; all final-head native Actions must pass.
