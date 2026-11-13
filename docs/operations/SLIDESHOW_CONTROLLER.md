# Slideshow state and timer controller (BE-004)

`scripts/lib/slideshow-controller.cjs` is the Node-side authority for slide selection and timing. It requires an explicit rendering adapter; importing it starts no service, listener or output. The future native SPX slideshow template will be a separate passive graphics template on its own layer, preserving existing HTML/OGraf, projects, rundowns and lifecycle controls. Do not run a second browser-side auto timer.

This increment proves state, command and cancellation behavior with simulated adapters. It supplies no rendered slideshow, audience overlays, file staging, CasparCG wiring or NDI evidence. BE-004 remains incomplete until real rendering and render captures pass.

## API and defaults

```js
const { SlideshowController } = require('../../scripts/lib/slideshow-controller.cjs');
const controller = new SlideshowController({
  deck: { id: 'validated-snapshot-id', slides: [
    { id: 'stable-media-id', src: 'opaque-adapter-source' }
  ] },
  renderer: presentationAdapter,
  mode: 'auto', intervalMs: 10000,
  transition: { type: 'cut' }
});
const result = await controller.dispatch({ action: 'launch', signal: abortSignal });
if (!result.ok) { /* report the fixed result.code */ }
await controller.dispatch('stop');
await controller.close();
```

`presentationAdapter` and `abortSignal` are application-supplied placeholders, not automatically configured services. `renderer.show({deckId, slide, index, transition, signal})` and `renderer.black({signal})` must return a promise that resolves after their operation commits, reject on failure, and check cancellation before any late physical effect. A synchronous return is also accepted. A resolved callback establishes the controller's last committed state, not receiver or board output proof.

Deck and slide IDs/source strings must be nonempty, slide IDs unique, and the ordered array nonempty. Inputs are copied and frozen. Source strings are deliberately opaque: this validator does not inspect files, decode images, restrict filesystem paths or approve URLs. Only a future validated local staging layer should supply production sources. A deck is fixed for a controller instance; reload is not silently implemented as a new file scan.

Actions: `launch`, `next`, `previous`, `auto`, `manual`, `toggle-auto`, `stop`. Launch always selects slide 1 (index 0), including repeated Launch. Next/Previous wrap in both directions, including one-slide decks; they return NOT_PLAYING while stopped. Mode selection while stopped changes the next Launch mode without starting output. Default mode is Auto and interval 10000 ms. Manual navigation retains mode and resets the full interval after successful presentation commit. Stop requests black and cancels timing without starting or stopping any sender. Launch retains the selected mode after Stop.

Cut is default with duration 0. Fade defaults to 1000 ms when selected; explicit durations 0–10000 ms are accepted. These are adapter transition instructions, not rendered fade evidence. The rendering watchdog defaults to 2000 ms and must exceed the selected transition duration; configure it explicitly for a longer fade. `intervalMs` is an integer 1–3600000; `maxQueue` defaults to 32 (1–256); `handlerTimeoutMs` is an integer 1–60000. The injectable scheduler has `now()`, `setTimeout(fn, ms)`, `clearTimeout(handle)`; production defaults use a monotonic clock. Snapshots expose a monotonic `nextAdvanceAt`, not a wall-clock event time.

## Failure and recovery contract

Normal commands serialize through a bounded queue. One auto timer exists; stale timer callbacks cannot advance after reset/Stop/close. A delayed tick advances once, then schedules from the successful commit, without a catch-up burst. Index/state commit only after adapter success. Adapter rejection returns RENDER_FAILED, retains the last committed state and suspends auto to avoid a failure storm. Explicit successful navigation/Launch or mode selection resumes auto. A failed black request does not falsely report stopped: the previous committed state remains and auto is suspended.

Stop preempts queued and active normal work. Repeated Stop requests share the same black promise/outcome while black or the interrupted rendering operation remains outstanding. At most two adapters may be outstanding: one interrupted show and one black. Interrupted adapters retain independent watchdogs; successful black cannot release the old operation's barrier. Normal successors wait until that operation settles or the controller faults. This prevents repeated Stop from accumulating abandoned callbacks. Snapshots expose `busy` and `outstandingRenders` separately from logical state.

A timeout aborts rendering, cancels queued work, reports terminal RENDER_TIMEOUT and prevents further dispatch. External request cancellation also propagates abort and fences state, but retains the serial barrier/watchdog until the adapter settles. Caller cancellation never authorizes a new normal render around stuck work. `close()`/`dispose()` abort and fence promptly without awaiting an uncooperative adapter; they do not request black or control sender lifetime. Use Stop for black before normal teardown when the adapter is healthy. Recover a fault only after stopping/recovering the actual adapter, then create a new controller.

Generation fences stop late callbacks from committing **controller state**; they cannot undo physical effects from an adapter that ignores its signal. Production adapters must uphold atomic last-good-frame and cancellation behavior. A fault is not proof of black output. Event payloads use fixed results, never raw exception messages.

`dispatch` resolves frozen `{action, ok, code?}` results rather than rejecting operational failures. A RossTalk handler must throw/reject when `ok` is false; otherwise it would acknowledge failed presentation as success. The integration test demonstrates that mapping with actual loopback TCP and the real controller, simulated rendering, rapid commands and timeout propagation. It is not launcher wiring. Production integration must also define Stop priority across the transport queue and presentation adapter, respect production-window gating, and distinguish output confirmation from command receipt.

## Verification and next work

`npm run check && npm test` runs deterministic injected-clock tests plus actual loopback integration on Ubuntu and Windows CI. Tests cover ordering, wrapping, timer reset/staleness, repeated Launch/Stop, overload, failure/recovery, preempted watchdogs, stuck rendering, cancellation and late callbacks. The socket integration proves a late Next cannot restart a stopped presentation and transport timeout reaches the controller's adapter signal.

Next: BE-005 immutable JPG/PNG staging and safe candidate activation; native SPX slideshow template with real image loading, transitions and audience-visible Auto/Manual/Reload overlays; render captures; presentation/window wiring. Reload remains UNKNOWN_ACTION until its safe activation contract exists. No stadium hardware or production network changes are involved.
