# Managed native presentation host

`createPresentationHost` in `scripts/lib/presentation-host.cjs` joins the Node slideshow controller, verified offline snapshot HTTP boundary and existing SPX-native browser renderer over real Socket.IO. It binds only127.0.0.1. Importing the module starts nothing; the default Windows launcher and SPX controller are unchanged.

```js
const { createPresentationHost } = require('./scripts/lib/presentation-host.cjs');
const host = await createPresentationHost({
  snapshotDir: absoluteVerifiedSnapshotDirectory,
  controllerOptions: {mode:'auto',intervalMs:10000,transition:{type:'cut'}}
});
// Pass host.getProgramURL() privately to the intended browser/producer.
// It contains a bootstrap credential: never print it or put it in logs.
// Wait for host.snapshot().renderer.ready (initial black acknowledged).
const result = await host.dispatch('launch');
// Handle !result.ok using fixed result.code; it is not receiver/on-air evidence.
await host.dispatch('stop');
await host.close();
```

The optional port defaults to ephemeral; no LAN listener or browser-to-controller command endpoint is exposed. Initial snapshot validation completes before binding. Only exact packaged template assets and authorized manifest images are served; never move cache content into public SPX ASSETS/static roots. No synced source is needed after registration. No renderer URL, cookie or token appears in diagnostics. `getProgramURL` is intentionally a credential-bearing trusted Node API; handing it to an untrusted browser grants program-renderer access. Use a trusted local producer, not the iPad.

Readiness requires the actual slideshow stylesheet/layout, authenticated connection and two-frame black acknowledgment. An inline black fallback protects startup even if CSS/JS cannot load. Dispatch accepts action strings only: Launch, Next, Previous, Auto, Manual, Toggle-Auto and Stop use the existing lower-case action names. Objects, external AbortSignals and arbitrary frame/deck sources are rejected. Queue limits, priority Stop, coalesced repeated Stop and orphan-operation watchdogs belong to the existing controller. A show ACK confirms the native show promise; black ACK follows clearing images/overlays and a bounded two-frame paint wait. It does not prove CasparCG output, NDI transmission, receiver selection or on-air state.

The host owns one prepared deck in this increment. It does not implement Reload/candidate staging/watchers/active pointers, nor forward mode/reload audience feedback yet. Those presentation-orchestration tasks must use the tested replaceDeck and renderer feedback contracts with bounded media-handler lifetimes. It starts/stops no sender; production-window enforcement remains the launcher's separate responsibility. Do not enable RossTalk against a simulated callback or mistake this internal API for a full operator application.

## Failure and recovery

A second authenticated renderer is rejected without evicting the first. Invalid protocol, lost connection, initialization or command deadline fails closed: pending work is canceled/fenced, output status becomes unverified, renderer.lastError retains a fixed diagnostic cause, and the controller is reset to stopped with its committed deck and current mode. The browser blacks itself on disconnect and never automatically reconnects. An unreachable renderer is not proof of black reception; diagnostics keep that distinction.

Recover by explicitly reopening a fresh `getProgramURL()` in the intended producer. The fragment was removed after bootstrap; ordinary refresh is inert. An explicit new managed fragment causes a document reload even when navigation would otherwise change only the fragment. After new initial black acknowledgment, Next cannot restart output; Launch starts slide1. Old ACKs, old socket epochs and delayed image/paint work cannot commit a new controller state. Close is bounded/idempotent, revokes media, tears down sockets/timers and asks the browser to black; it cannot retract bytes or pixels already delivered.

The capability and distinct per-host random cookie require exact loopback Host/Origin checks. Same-site requests from another local port are rejected; forwarded headers are not trusted. Cookie is HttpOnly and SameSite=Strict under /piraiders/. No CORS permission is granted. This is not a hostile administrator/kernel sandbox, and browser acknowledgment is not independent hardware proof.

## Validation and rollback

`npm test` covers real HTTP and raw WebSocket/Socket.IO protocol failure injection, authentication, ownership and bounded failure paths. `npm run test:browser` exercises the real managed client/host, full image decoding, actual show/black paint, delayed image Stop, disconnect/recovery and lost acknowledgment. Existing native SPX/OGraf lifecycle and offline staging regressions remain required. The Windows extracted ZIP smoke verifies packaged module/assets/dependency startup and authenticated host operations with bundled Node; its protocol client is a simulator, not CasparCG CEF.

Rollback reverts the opt-in host/client and tests; no operator data, source schema or default launcher configuration is migrated. The inert script hook is the only existing-template change. Windows10 target operation, real CasparCG/NDI moving output/source identity, DMP/D8VIDEO-P and stadium compatibility remain separate gates.
