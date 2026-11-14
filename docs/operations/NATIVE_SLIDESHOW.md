# Native SPX slideshow rendering component

This increment adds a passive native HTML/CSS/JavaScript template at `ASSETS/templates/piraiders/slideshow/SLIDESHOW.html`. It renders explicit frame updates and audience feedback. It does not fetch a source catalog, navigate a deck, run an auto-advance timer, open a control listener, or manage CasparCG/NDI. The existing Node slideshow controller remains the state/timer authority. Application wiring and user-testable release gates remain open.

## Frame and lifecycle API

The page exposes `window.PiRaidersSlideshowRenderer` and a template instance `window.piraidersRenderer`:

```js
const renderer = new PiRaidersSlideshowRenderer({
  root: document.getElementById('slideshow'),
  mediaRoot: '/piraiders/media/',
  loadTimeoutMs: 10000
});
await renderer.show({
  src: '/piraiders/media/<snapshot-id>/media/<generated-image>.png',
  transition: { type: 'fade', durationMs: 1000 },
  signal: abortSignal
});
renderer.showMode('auto');
renderer.setReloadState('loading');
renderer.setReloadState('complete');
renderer.black();
renderer.dispose();
```

The placeholders above require a future trusted presentation/media-serving adapter; the `/piraiders/media/` route is **not implemented by this increment**. The browser fixture server supplies that namespace only for automated tests. Never treat a Drive Link or a filename scan as a ready renderer reference; follow ADR0005 and the Apps Script media contract. An actual server must authorize verified snapshot membership and serve validated bytes. Same-origin URL filtering is not server authorization or content validation.

`show()` resolves a frozen snapshot after a decoded image is committed across browser frame boundaries. That proves only this document's DOM presentation, not receiver or board output. Sources must be same-origin HTTP(S) beneath the configured media root, end in PNG/JPG/JPEG, and contain no traversal, credentials, query, fragment or external/data/file/javascript scheme. Invalid inputs reject before canceling a legitimate pending candidate. Transition duration is an integer0–10000 ms; cut defaults0 and rejects nonzero duration; selected fade defaults1000 ms. A pre-aborted signal leaves the current operation intact.

The native template implements these SPX globals:

```js
await update(JSON.stringify({
  f0: JSON.stringify({
    src: '/piraiders/media/<snapshot-id>/media/<generated-image>.png',
    transition: { type: 'cut' }, mode: 'manual', reload: 'complete'
  })
}));
await play();
await next();
await stop();
```

`update` validates/stores a pending frame; while playing it renders the update. `play` displays the selected pending frame. Selection of slide1 belongs to the Node Launch command, not this single-frame template. `next(data)` accepts an explicitly updated envelope; `next()` has no independent navigation or timer. `stop` marks the wrapper inactive and immediately blacks the page, including feedback; late callbacks cannot relight it. Common SPX comment/epochID metadata is ignored. Unknown payload fields and malformed data return fixed `{ok:false,error}` results; successful lifecycle calls return `{ok:true}`. Normal SPX callers may ignore promises; the future adapter must await/map failure results rather than acknowledge receipt as rendering success.

The payload is an internal **renderer** contract, not a new Apps Script/Sheet schema. `f0` is an SPX template field; no source-app column or export endpoint is implied. Optional mode/reload fields request transient feedback and should not be replayed indiscriminately on every automatic frame. Direct renderer methods also permit feedback without reloading an image. First-frame feedback waits for successful presentation; feedback while black stays invisible.

## Output, cancellation and recovery

Images are aspect-contained against opaque black. Each of two bounded layers has its own black background, so fades include the incoming image's letterbox areas instead of leaving old pixels visible until commit. No application controls, source paths, developer labels or debug status are visible on program output. AUTO/MANUAL uses the owner's small lower-right white border and rise/75%-opacity/hold/fade behavior; dark backplates preserve visibility over bright images. Reload feedback sits above the mode indicator without overlap. A loading/failed candidate retains the last committed frame; failed reload feedback contains no raw exception text.

A newer valid show cancels the previous operation. Abort, Stop and dispose cancel image requests/animations/queued frame callbacks, fence late completions and clean timers. Platform animation throws, external cancellation and stalled animation/paint return TRANSITION_FAILED with last-good pixels retained. The load watchdog defaults to10 seconds; after decode a separate transition-plus-paint watchdog is bounded by duration+1000 ms (cut1000 ms). These bounds rely on running browser timers; a frozen/killed browser is an application-service failure for the future supervisor/presentation adapter to handle.

Other fixed errors include INVALID_SOURCE, INVALID_TRANSITION, INVALID_SIGNAL, LOAD_FAILED, LOAD_TIMEOUT, CANCELED and DISPOSED. No raw callback messages/paths are returned. `snapshot().state` describes only this component (black/loading/transitioning/ready/disposed), never NDI or board readiness. Snapshot mode/reload describes feedback state, not the Node playback clock.

The future PiRaiders Stop adapter must keep the presentation surface/sender alive as needed, request black, and leave sender eligibility under the production-window gate. Native SPX STOP may unload its graphic layer according to existing SPX behavior; do not infer a permanent black NDI scene merely from a standalone template test. Do not change original project/rundown routing or remove other SPX lifecycle operations to solve that integration gate.

## Real browser evidence and existing compatibility fix

`npm run test:browser` launches pinned Playwright/Chromium against a loopback-only fixture server. It uses real PNG/JPEG image decoding, CSS/Web Animations and pixel screenshots, not DOM drawing mocks. Thirteen tests cover containment and black, cut/fade including portrait letterboxes, failed/timed/aborted/stale loads, validation, platform animation/cancel/stalled-paint recovery, initial feedback fencing, bright-image feedback/nonoverlap at1920×1080 and960×540, native lifecycle/no browser auto timer, and existing native HTML/OGraf behavior.

Actual-browser tests found an existing INFO_LEFT OGraf adapter bug: updateAction forwarded its `{data}` envelope to a native helper expecting flat fields. The narrow fix unwraps data, normalizes only its resource-prefix fields and copies rather than mutates caller data. Invalid update data rejects without changing the graphic. Node and actual-iframe regression tests now require the visible text/theme update, play, stop and disposal; no failing baseline is hidden as a passing expected defect. Other upstream templates and the SPX controller/renderer paths remain unchanged.

Screenshots and `provenance.json` are generated in `build/browser-artifacts/`, recording browser/OS, Git HEAD/dirty status and hashes of the four new assets plus OGraf adapter. Local Chromium156.0.8078.79 on Linux passed13/13; source was truthfully an uncommitted tree based on8114cb5 during local review. Two bounded visual review passes found no remaining material visual defects. The design CLI/shipped reviewer definition was unavailable; existing project context and a fresh independent review under the explicit brief were used, with no design detector or brand change. See docs/design/SLIDESHOW_SURFACE.md for extracted tokens and scope.

Windows/Ubuntu CI installs the exact Playwright-pinned Chromium, runs browser tests and retains screenshots/provenance artifacts. The Windows ZIP smoke also checks new native template/script/style delivery through actual extracted SPX. Inspect final-head CI before claiming those jobs passed. Neither headless Chromium nor asset delivery proves CasparCG CEF, NDI, receiver, stadium hardware, Windows10 target-PC performance or an integrated application release.

Next: verified snapshot/media serving plus presentation-controller acknowledgment/cancellation, safe candidate activation, RossTalk Stop priority and launcher/window wiring; source catalog integration follows the read-only ordered-ID contract. Preserve existing generic local/schema-1 snapshots. Rollback removes the unreferenced native template/browser harness and reverts the narrow OGraf adapter fix if necessary; no operator source data is migrated or modified.
