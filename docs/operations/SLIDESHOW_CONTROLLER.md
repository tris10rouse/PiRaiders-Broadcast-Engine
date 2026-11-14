# Slideshow state and timer controller (BE-004)

`scripts/lib/slideshow-controller.cjs` is the Node-side authority for slide selection and timing. It requires an explicit rendering adapter; importing it starts no service, listener or output. The native SPX slideshow template is a separate passive graphics template on its own layer, preserving existing HTML/OGraf, projects, rundowns and lifecycle controls. Do not run a second browser-side auto timer.

The state/cancellation suite uses simulated adapters. The separate native template and trusted snapshot HTTP boundary have real Chromium coverage; a browser-automation completion adapter also proves staged/offline pixels and atomic Reload. Production presentation-session, launcher/control wiring and CasparCG/NDI proof remain open.

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

Deck and slide IDs/source strings must be nonempty, slide IDs unique, and the ordered array nonempty. Inputs are copied and frozen. Source strings are deliberately opaque: this validator does not inspect files, decode images, restrict filesystem paths or approve URLs. Only a validated local staging/serving layer should supply production sources. The read-only `deck` getter exposes the frozen committed deck; assign a candidate through `replaceDeck`, never direct state mutation.

Actions: `launch`, `next`, `previous`, `auto`, `manual`, `toggle-auto`, `stop`. Launch always selects slide 1 (index 0), including repeated Launch. Next/Previous wrap in both directions, including one-slide decks; they return NOT_PLAYING while stopped. Mode selection while stopped changes the next Launch mode without starting output. Default mode is Auto and interval 10000 ms. Manual navigation retains mode and resets the full interval after successful presentation commit. Stop requests black and cancels timing without starting or stopping any sender. Launch retains the selected mode after Stop.

Cut is default with duration 0. Fade defaults to 1000 ms when selected; explicit durations 0–10000 ms are accepted. These are adapter transition instructions, not rendered fade evidence. The rendering watchdog defaults to 2000 ms and must exceed the selected transition duration; configure it explicitly for a longer fade. `intervalMs` is an integer 1–3600000; `maxQueue` defaults to 32 (1–256); `handlerTimeoutMs` is an integer 1–60000. The injectable scheduler has `now()`, `setTimeout(fn, ms)`, `clearTimeout(handle)`; production defaults use a monotonic clock. Snapshots expose a monotonic `nextAdvanceAt`, not a wall-clock event time.

## Failure and recovery contract

Normal commands serialize through a bounded queue. One auto timer exists; stale timer callbacks cannot advance after reset/Stop/close. A delayed tick advances once, then schedules from the successful commit, without a catch-up burst. Index/state commit only after adapter success. Adapter rejection returns RENDER_FAILED, retains the last committed state and suspends auto to avoid a failure storm. Explicit successful navigation/Launch or mode selection resumes auto. A failed black request does not falsely report stopped: the previous committed state remains and auto is suspended.

Stop preempts queued and active normal work. Repeated Stop requests share the same black promise/outcome while black or the interrupted rendering operation remains outstanding. At most two adapters may be outstanding: one interrupted show and one black. Interrupted adapters retain independent watchdogs; successful black cannot release the old operation's barrier. Normal successors wait until that operation settles or the controller faults. This prevents repeated Stop from accumulating abandoned callbacks. Snapshots expose `busy` and `outstandingRenders` separately from logical state.

A timeout aborts rendering, cancels queued work, reports terminal RENDER_TIMEOUT and prevents further dispatch. External request cancellation also propagates abort and fences state, but retains the serial barrier/watchdog until the adapter settles. Caller cancellation never authorizes a new normal render around stuck work. `close()`/`dispose()` abort and fence promptly without awaiting an uncooperative adapter; they do not request black or control sender lifetime. Use Stop for black before normal teardown when the adapter is healthy. Recover a fault only after stopping/recovering the actual adapter, then create a new controller.

Generation fences stop late callbacks from committing **controller state**; they cannot undo physical effects from an adapter that ignores its signal. Production adapters must uphold atomic last-good-frame and cancellation behavior. A fault is not proof of black output. Event payloads use fixed results, never raw exception messages.

`dispatch` resolves frozen `{action, ok, code?}` results rather than rejecting operational failures. A RossTalk handler must throw/reject when `ok` is false; otherwise it would acknowledge failed presentation as success. The integration test demonstrates that mapping with actual loopback TCP and the real controller, simulated rendering, rapid commands and timeout propagation. It is not launcher wiring. Production integration must also define Stop priority across the transport queue and presentation adapter, respect production-window gating, and distinguish output confirmation from command receipt.


## Explicit prepared-deck replacement

`await controller.replaceDeck(verifiedCandidateDeck, {signal})` resolves a frozen `{action:'reload', ok, code?}` result. The controller checks structure, copies and freezes the ordered candidate at admission, and serializes it with normal navigation. It does not verify image bytes or discover a candidate: call staging/verification and register authorized media URLs first. Bare `dispatch('reload')` deliberately stays UNKNOWN_ACTION until the application orchestrator supplies a verified candidate.

While playing, replacement chooses the current committed occurrence ID in the candidate **when the request reaches the head of the queue**, after earlier navigation. If the ID is absent, it selects slide1. It sends that candidate's deck ID/source to the renderer and commits the new deck/index only after successful presentation acknowledgment. This supports metadata-only reorder and changed bytes without conflating an occurrence with a position. Successful replacement resets the full Auto interval from commit. Failure keeps the old deck/index/frame and suspends Auto; restoring valid bytes and explicitly retrying can recover.

While stopped, replacement commits the prepared deck with null index, makes no render/black call and starts no timer. The next Launch starts candidate slide1. Stop preempts pending/active replacements; abort, timeout, close and stale completion cannot commit a canceled deck. The existing orphan-operation barrier/watchdog still applies. Invalid candidate, options or signal returns INVALID_DECK, INVALID_OPTIONS or INVALID_SIGNAL; closed, faulted, canceled and overloaded requests use the normal fixed codes. No source/sender/active-pointer side effect occurs.

The presentation orchestrator owns media-handler lifetimes. Retain old media access until replacement commits and keep it on failure. A canceled caller can settle before its physical render operation settles; do not dispose resources as though that were completion. Native browser cancellation is tested separately; a controller generation fence cannot fix a production adapter that ignores abort. Safe file watching, candidate preparation ordering, Reload overlays, atomic persistent active pointers and transport command mapping remain integration work.

## Verification and next work

`npm run check && npm test` runs deterministic injected-clock tests plus actual loopback integration on Ubuntu and Windows CI. Tests cover ordering, wrapping, timer reset/staleness, repeated Launch/Stop, overload, failure/recovery, preempted watchdogs, stuck rendering, cancellation and late callbacks. The socket integration proves a late Next cannot restart a stopped presentation and transport timeout reaches the controller's adapter signal.

Next: production presentation/session transport with real render acknowledgments, cancellation/reconnect and explicit recovery; safe candidate preparation/activation orchestration and watcher; RossTalk Stop priority and production-window/event wiring. Existing native HTML/OGraf, HTTP and controller regressions remain mandatory. No stadium hardware or production network changes are involved.

## Acknowledged feedback adapters

An optional `renderer.feedback({mode?,reload?,signal})` uses the same cancellation/watchdog/serial barrier as show. Playing mode actions compute their target at dequeue and commit only after feedback success, then reset the full Auto interval. Adapters without feedback retain their existing immediate mode behavior; stopped intent never renders.

`controller.setReloadState('loading'|'complete'|'failed',{signal})` returns a fixed action:feedback result. Its normal queued feedback does not change deck/index/mode, reset an unexpired Auto deadline or resume suspended Auto. Ordinary feedback failure/caller cancellation preserves that timing; adapter uncertainty can separately fault/reset the managed session. A queued automatic Next runs after the feedback barrier. If a full queue rejects the tick, one timer-generation-fenced full-interval retry preserves Auto progress, without overriding later navigation/Stop/mode timing or adding catch-up work. Stop still preempts and coalesces black with at most one interrupted normal operation.
