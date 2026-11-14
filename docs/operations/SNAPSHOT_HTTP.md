# Trusted local snapshot HTTP boundary

`createSnapshotMediaHandler` in `scripts/lib/snapshot-media-handler.cjs` turns one fully verified schema-1 local snapshot into a restricted Node HTTP handler. It is deliberately **not mounted by default** in SPX or enabled by the Windows launcher. The future presentation-session integration must own authorization, revocation, renderer acknowledgments and lifecycle. This module does not select an event, activate Reload, start a sender or connect to Google.

```js
const { createSnapshotMediaHandler } = require('./scripts/lib/snapshot-media-handler.cjs');
const media = await createSnapshotMediaHandler({
  snapshotDir: absolutePreparedSnapshotDirectory,
  authorize: request => presentationSession.isAuthorized(request),
  maxConcurrentReads: 4
});
// Only dispatch the dedicated /piraiders/media/ namespace to media.handle.
// media.deck contains immutable same-origin image references for the controller.
// On session teardown:
media.close();
```

The caller must supply a synchronous authorization function that returns the literal boolean `true` only for the intended presentation session. Missing authorization, exceptions, promises and other truthy values do not authorize access. Loopback alone is insufficient: other local browser pages and processes can connect to loopback. Never accept forwarded IP headers as identity, use a public constant credential, grant access from an arbitrary query string, or mount a cache directory with Express static serving. Test cookies and bearer strings in the automated fixtures are fixture credentials, not a production session implementation. Real session issuance must establish same-origin access for image requests without placing secrets in audience payloads, image URLs or access logs.

Registration reuses `loadSnapshot`: manifest validation, complete bounded PNG/JPEG decode, hashes, inventory and path checks. The deck uses `/piraiders/media/<snapshot-UUID>/<generated-media-name>`. The source folder can then be absent. Only exact registered image paths are served; no manifest, source-relative filename, directory listing, private document, arbitrary cache path or unregistered snapshot is exposed. Local lexical ordering/path-derived IDs remain unchanged. Apps Script occurrence identity and authoritative order still require the separate provider contract in [ADR0005](../decisions/0005-apps-script-media-authority.md).

For each GET or HEAD, the handler requires a loopback peer, explicit authorization and a request that is not marked cross-site. Unsupported methods and URL aliases, encoded paths, queries and fragments are rejected. It opens the exact registered file, checks directory/file type, identity, size and real paths, reads at most the registered byte count plus one EOF probe, then compares SHA-256 before sending image bytes. A changed or missing image fails closed; restoring the exact validated bytes permits a subsequent retry. It does not re-decode identical bytes on each request. Responses are private/no-store with `nosniff` and same-origin resource policy, without CORS permission. Errors are empty fixed-status responses, with no filesystem paths or decoder diagnostics.

Concurrent responses are bounded (default four, configurable one through sixteen), with slots held until both the descriptor read settles and the response finishes or disconnects. The embedding HTTP server owns header/request/response timeout policy; a permanently slow authorized client can hold a bounded slot until disconnect or close. Closing the handler revokes access and prevents unfinished reads from publishing bytes. Close cannot retract bytes already delivered to a browser; the presentation layer must explicitly request black and handle disconnection. This is application integrity protection against ordinary sync/cache replacements, not a sandbox against an administrator or hostile filesystem/kernel. Store the cache outside SPX's public ASSETS/static roots.

## Verification and limits

`npm test` runs real loopback HTTP requests against staged temporary media, including authorization, exact-path enforcement, tamper/recovery, HEAD and shutdown behavior. `npm run test:browser` loads the actual native SPX template and actual staged/offline PNG/JPEG bytes, then drives the Node controller through a clearly labeled browser-automation completion adapter. Pixel checks cover Launch-at-1, wrapping navigation, corruption retaining the last good frame, restored content recovery and full black Stop. This proves component integration; it does not implement a production Node/browser transport or its cancellation/reconnect semantics.

Windows CI also exercises these operations with bundled Node and production dependencies from the extracted development ZIP. Windows-latest and Chromium evidence do not prove Windows 10 target operation, CasparCG CEF, NDI transmission/discovery/reception, DMP/D8VIDEO-P or live stadium compatibility. For rollback, remove the unreferenced module/tests and packaging probe; no operator data or active pointer is migrated.
