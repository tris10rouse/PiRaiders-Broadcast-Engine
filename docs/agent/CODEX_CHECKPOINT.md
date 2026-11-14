# Codex engineering checkpoint

Updated 2026-11-14 UTC. GitHub is authoritative: inspect master, open PR heads and final checks before work. **The first user-testable Windows application is not ready.**

## Resume here

PR #20 is confirmed merged at `4fe470d27e8d50842e06725e2943b9b5a716593d`, after final source `dc7067bc1e36ad506a28b0a599641fbcef7fe51a` passed all four Windows/Ubuntu checks: https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43617817598 . It joins allowlisted RossTalk TCP to the managed native presentation, with bounded priority Stop, retained orphan watchdog/barriers, gate/resolver/epoch fences and owned fault cleanup. Default launcher wiring remains open.

Resume PR #21 first: https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/pull/21 , branch `feature/be-002-caspar-software-proof`, based on master `4fe470d`. Implementation `2988969558b5ab336e919e98a6cfe0240be62581` passed both actual Windows software-proof runs:

- https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43622879981
- https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43623042420

Actual pinned Caspar2.5.1, Mesa26.2.6 and bundled CEF142 produced eight verified1080p mixed PNG captures, using real managed presentation/RossTalk and staged PNG/JPEG. Verified Launch/Next/Previous/Reload, opaque Stop black while Caspar remains alive, forced owned-Caspar-root termination, contained descendant cleanup, bounded supervisor restart, fresh stopped renderer epoch/black, explicit Launch of last-good content, and complete recorded process tree removal at window end. Both bootstraps/log scans preserve capability privacy. The window policy clock is injected; processes, CEF, image consumer and captured pixels are real. Persistent SPX is an explicit Node stand-in only in this probe; separate package CI runs actual SPX.

**Final documentation-head CI and merge remain to be verified directly.** Require six passing latest-head checks: four Foundation Windows/Ubuntu push/PR jobs plus two actual-Caspar push/PR jobs. Verify exact PR head, unchanged base/master and expected-head merge; never merge red checks. If PR21 is already merged, continue the next integration increment below instead of repeating this discovery.

## Important implementation facts

See `docs/design/WINDOWS_OUTPUT_PROOF.md`, `PRESENTATION_PROTOCOL.md` and `MANAGED_CONTROL_PROTOCOL.md` for exact pins/contracts. No NDI runtime/consumer, Windows10 target PC, external receiver or stadium equipment has been tested. No user release, production deployment, signing or binary redistribution was performed.

- Caspar/Mesa download hashes verified before extraction; Mesa app-local only, child `GALLIUM_DRIVER=llvmpipe`, `LIBGL_ALWAYS_SOFTWARE=1`, `MESA_GL_VERSION_OVERRIDE=4.5COMPAT`. Default core context reported4.6 but failed Caspar capability checks; documented compatibility profile passes actual output without bypassing those checks. GL_RENDERER string is not recorded.
- Caspar's real file-log attribute is `disabled="true"`, not misleading example `disable`. Disable OSC clients and CEF logs/cache. Suppress native output after pre-auth startup. Only bounded pre-auth diagnostics, fixed categories, synthetic PNGs and sanitized provenance are published; never raw private producer URLs/logs. Scan known text files before and after restart, and latch any capability-in-referrer observation across bootstraps.
- Actual CEF142 needed explicit `mode:cors` and `referrerPolicy:same-origin` for the authenticated bootstrap. Its matching Origin is verified in the real proof; referrer contains only the credential-free template path after fragment removal. Other requests retain no-referrer.
- Newer local Chromium156 with Caspar's disable-web-security flag omits fetch Origin. A reviewed bootstrap-only alternate requires absent Origin, exact loopback/Host, marker1, literal Fetch Metadata same-origin/cors/empty and private bearer. Present-but-wrong/null Origin still fails. WebSocket Origin/cookie/token requirements remain strict. Real foreign-port browser requests fail403 with no cookie. No CORS/OPTIONS permission is added.
- Crash injection must prove exact executable path plus the expected JobHost parent and one unique root. First-direct-child alone can select a console helper; the initial recovery test failed and was corrected rather than skipped.
- Stock AMCP binds all IPv4 interfaces; an invented address XML element does not isolate it. Disposable CI uses an ephemeral port/local clients. Production needs a reviewed loopback-binding build or explicit owner-approved network isolation.

## Existing foundations; do not rebuild

PRs3–10 preserve native HTML/OGraf/AMCP regressions, bounded supervision, explicit production windows/default15-minute prewarm/end exclusive, native suspended-start kill-on-close Job Objects, health diagnostics and portable development ZIP packaging. Real Windows containment and extracted-package tests exist. Process health/version is not endpoint ownership or NDI/on-air proof.

PRs11–19 add bounded allowlisted RossTalk, Node-authoritative immutable slideshow/timers, worker-full-decode immutable offline snapshots, the owner's Apps Script contract, native passive slideshow/overlays, authenticated exact image serving, atomic replaceDeck, managed HTTP/Socket.IO presentation and cancellation-safe Reload/feedback. Stop preempts bounded normal work and retains actual callback/watchdog barriers. Auto defaults10seconds; manual navigation resets from successful render. Last-good deck/media remain on preparation failure; fresh renderer epochs require explicit Launch. Source watchers/default launcher integration remain separate.

SPX projects/rundowns/layers and Play/Continue/Update/Stop, native HTML/CSS/JS, OGraf and CasparCG remain required. No OBS/vMix. iPad operator uses Daktronics buttons only, never PiRaiders UI. Audience feedback is distinct from application control.

Owner media contract is in ADR0005 and APPS_SCRIPT_MEDIA_CONTRACT.md (PR14); don't re-upload private PDF/source. Sheet owns school-year/event/Board-button membership and order; DriveID identifies bytes, FileKey occurrence identity preserves repeats. Generic schema1 local lexical/path-hash mode stays separate. Nextgame copies/source ticks are not canonical Board decks or Engine readiness. Google export/auth/typed revisions/order/board mapping/DriveID resolution/actual event start-end require the documented sanitized source contract before connection; no invented APIs/columns. Local/manual work can continue.

## Next coherent integration

Implement opt-in local/manual `PreparedEventRuntime` with a versioned event profile, explicit window, source/cache paths, playback settings, prepared snapshot and allowlisted RossTalk. Keep local identity separate from the Apps Script provider. Prewarm starts owned Caspar and acknowledged black; explicit Launch starts slide1. Preserve default SPX workflows and last-good offline content.

Critical acceptance:

1. Invalid profile/initial staging failure starts no service/listener; port collision or foreign endpoint fails closed before private URL handoff. VERSION alone is not ownership proof.
2. Sender crash/window end/profile replacement fences and closes the entire presentation epoch concurrently with immediate sender shutdown. **canControl alone does not stop an already running Auto timer.** Never wait for a resolver/render/black ACK before stopping the sender. A restarted sender gets a fresh stopped epoch and needs Launch.
3. Production spawning currently inherits native stdout; integrate file/CEF/native log protection before private producer URLs enter that path. The proof's safe pipes are test-specific.
4. Test real TCP/native browser Launch/wrap/Auto/Reload/Stop, failed Reload last-good retention, offline cached start, stuck work across window end and recovery. Preserve native SPX/OGraf/package regressions.

Real NDI frames/stable source identity/window-end disappearance, component licenses/distribution, Game Day event preparation/controller UI, diagnostics/preflight/soak and complete artifact installation checklist remain release gates. Do not claim first-release readiness from browser/mocked tests. Once the honest evaluation build exists, pause the current automation and provide the artifact/checklist; no live stadium interaction without separate explicit authorization.

## Environment and publishing

Workspace `/workspace/PiRaiders-Broadcast-Engine`; `work/` is untracked scratch, never publish wholesale. The older `/workspace/piraiders-reload` worktree is not an independent publisher. GitHub connector works; inherited CLI auth is invalid. No owner token or chat secrets needed. Markdown/new ASSETS files may be ignored by upstream rules: publish only explicit reviewed paths.

`npm run setup` installs locked dependencies without lifecycle scripts and runs checks/tests. CI Node22/bundle22.23.4; cloud Node24.22.1. Local Chromium `/usr/bin/chromium`; `PIRAIDERS_BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:browser`. Before final CI: syntax74, baseline253 (244 Linux passes/nine Windows-only skips), actual Chromium27/27 zero skips; focused host15/15, helper3/3 and independent security/process reviews pass. Check final-head Windows counts/results directly. Development ZIP excludes proof tools, Playwright, real configs/media/secrets and Caspar/NDI binaries.

Before EVERY GitHub mutation freshly read master AGENTS.md and LOCKING_PROTOCOL.md, exact coordination HEAD and lease pinned to it. Other unexpired owner means read-only/end. Acquire fresh unique owner/fence through base-tree/sole-parent commit/atomic non-force expected-head update. Verify owner/fence/expiry before Git writes, renew within15minutes and before batches, fail closed, release on completion/error. Root alone publishes; subagents reviewed read-only. Never reuse a stale run's owner/fence or force-push.

Owner paused old Build PiRaiders Engine; never resume it. Private automation lookup on2026-11-14 confirmed current Develop PiRaiders Windows release enabled hourly with inherited managed workspace. This is scheduled execution, not continuous worker-liveness or future-success evidence. Pause only at the genuine evaluation-release gate. AGENTS still requires human approval for production deployment, network changes, signing and release publication.
