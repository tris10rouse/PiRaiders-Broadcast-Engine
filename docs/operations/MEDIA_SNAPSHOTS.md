# Immutable local media snapshots (BE-005)

This module prepares a separate, fully decoded candidate from a local synced folder. It never changes an active deck, watches a folder, starts output, or changes Google Drive settings. A local Drive Desktop folder is an ordinary filesystem input; the Drive client itself is not exercised by CI. Watch/debounce integration and live Reload with last-frame hold remain release work.

## Relationship to the Apps Script library

This is the generic local-folder provider, with filename-derived order and path-derived slide IDs. It does not read Sheet event membership or resolve Drive IDs. The [Apps Script media contract](../design/APPS_SCRIPT_MEDIA_CONTRACT.md) requires a separate ordered catalog provider using File Key occurrences and Drive-ID byte resolution; preserve this API and schema-1 offline compatibility. Do not point it at the whole Media/year/Next game tree and treat every image as an event deck. No runtime change is made by this design clarification.

## API

```js
const { stageSnapshot, loadSnapshot } = require('../../scripts/lib/media-snapshot.cjs');
const candidate = await stageSnapshot({
  sourceDir: absoluteSyncedFolder,
  cacheDir: absoluteLocalCache,
  signal: abortSignal
});
// candidate.snapshotDir: a new immutable version directory
// candidate.deck: { id, slides: [{ id, src }] }, ready for an adapter to resolve
// candidate.manifest: ordered hashes, byte sizes, dimensions and formats
const verifiedOfflineCandidate = await loadSnapshot(candidate.snapshotDir, { signal: abortSignal });
```

Paths and signal above are caller-supplied placeholders. Both directory paths must be absolute; source/cache overlap is rejected after realpath resolution, including prospective not-yet-created cache paths. Published media names are generated hashes, not source names or paths. Slide identity hashes normalized source-relative names; renaming a source changes its slide identity. Sources are sorted by locale-independent normalized path order, including nested directories: `10.png` sorts before `2.png`. Use zero-padded prefixes for a desired numeric order.

The returned objects and nested records are frozen. A version has a fresh UUID, while `contentHash` is deterministic for the same ordered media identities, content and dimensions. `src` is relative to the snapshot directory, not a network URL; a future application adapter must serve only validated snapshot paths. No source absolute path is written into the manifest. The runtime returns an absolute `snapshotDir`; do not publish private operator paths in diagnostics.

## Preparation and offline verification

Preparation takes two identical inventories separated by the quiet period, then captures files through bounded reads with handle/path identity and size/timestamp checks. It fully decodes each captured image sequentially in a worker with a deadline. It inventories the source again before publication: a partial write, replacement, deletion or ordinary sync drift rejects the whole candidate. Regular non-image files are ignored as slides but participate in stability checks. Symlinks/junctions, nonregular entries, ambiguous case/Unicode-normalized names and traversal/depth/entry excess fail closed.

Files and schema-versioned manifest are written into one unique `.pending-<UUID>` directory. Same-volume rename publishes a new version; existing published snapshots and source files are never overwritten. Failure/abort cleans only that attempt's temporary directory. A process crash can leave a pending directory, which is not a loadable snapshot. Do not delete pending directories owned by another preparation. Atomic namespace publication does not promise persistence through power loss: offline verification rejects incomplete or damaged cache content.

`loadSnapshot` needs no source folder. It validates a strict manifest, generated paths, exact directory membership, byte sizes, hashes and a fresh full image decode, then rechecks identities/membership to detect ordinary concurrent cache changes. Rehashing a corrupt image is insufficient to make it valid. Cache hashes are unsigned integrity checks, not authenticity or an adversarial filesystem sandbox. Keep a previously accepted snapshot until the rendering adapter has successfully activated its successor. This module writes no active pointer and cannot itself prove last-frame hold or visual rollback.

These checks handle ordinary local sync/service races. They do not establish protection against an adversary continuously replacing filesystem ancestors, and they do not make files OS-read-only. The caller must restrict preparation concurrency and cache access, propagate cancellation, handle fixed errors and keep the active version independent from candidate failures.

## Default bounds

| Option | Default |
| --- | ---: |
| quietMs | 250 ms |
| maxFiles | 500 images |
| maxFileBytes | 20 MiB |
| maxTotalBytes | 512 MiB |
| maxPixels | 16,777,216 |
| maxDimension | 8192 per side |
| maxDepth | 16 directories |
| maxEntries | 10,000 source entries |
| timeoutMs | 10,000 ms per decode |

Options are integers with enforced bounds; unknown keys fail validation. Input size, dimensions and pixel caps cannot exceed decoder hard ceilings (20 MiB, 16,777,216 pixels, 8192 per side). A lower bound may be configured. Validation copies bytes into a worker without detaching caller buffers. Deadline/abort terminates that worker before resolving/rejecting. Heap and codec allocation bounds complement these limits; they are not a total process RSS guarantee. Large batches have per-image deadlines, not a single overall completion guarantee.

Failures expose fixed codes such as SOURCE_CHANGED, FILE_LIMIT, UNSAFE_SOURCE, CACHE_CHANGED, INVALID_MANIFEST, IMAGE_DECODE_FAILED and UNSUPPORTED_IMAGE. Raw filesystem/decoder exception strings are not propagated. Missing/offline source preparation fails while a previously published verified version remains available.

## Supported image subset and licensing

Pinned pure-JavaScript production codecs are **pngjs 7.0.0 (MIT)** and **jpeg-js 0.4.4 (BSD-3-Clause)**. Actual complete pixel decoding is required; signatures/dimensions alone do not validate a file. PNG checks every chunk CRC and a bounded complete zlib stream before pixel decode. JPEG uses strict decoding with resolution/memory bounds and structural scan checks. Tests include baseline/progressive JPEG and truecolor-alpha/palette-transparency PNG.

Initial explicit restrictions: **APNG, interlaced PNG and JPEG with any DRI/restart coding are rejected**. pngjs's interlaced path lacks the ordinary inflate size bound; jpeg-js strict mode can still fill missing blocks after an early restart-boundary EOI. Review reproduced that corruption and added fail-closed restrictions/regressions. Re-export affected images as noninterlaced static PNG or non-restart JPEG; do not silently skip them or treat them as ready. Broader subtype support requires a strict, bounded decoder and new evidence.

No native image runtime or cloud API is added. Windows packages retain complete dependency notices in node_modules and explicit `licenses/PNGJS-LICENSE.txt` and `licenses/JPEG-JS-LICENSE.txt`; the builder verifies pinned versions. Keep those notices with redistributed development artifacts. No AGPL code was incorporated.

## Evidence and remaining work

The automated suite uses real temporary files, complete PNG/JPEG decoding, symlink/junction boundaries, failure injection around real reads/rename, interrupted/aborted cleanup, concurrent preparations, cache corruption and source-independent offline load. Windows CI additionally extracts the actual ZIP under spaces/Unicode, runs the bundled Node without system Node/NODE_PATH, prepares PNG/JPEG media through worker threads and loads it after source deletion, and verifies codec versions/licenses. Inspect final PR CI before claiming that artifact check passed.

Still required: watcher/debounce and event preparation integration; safe Reload candidate activation preserving the current stable slide when possible; renderer preload/failure/last-frame behavior; native SPX slideshow template, transitions and audience overlays; actual CasparCG/NDI and separately authorized off-air sender/hardware evidence. This increment alone is not the first user-testable release.

## Serving prepared images

The separate [trusted HTTP boundary](SNAPSHOT_HTTP.md) verifies a snapshot before registration and exposes only registered image URLs with explicit authorization. It remains unmounted by the default application; do not replace it with a static cache-directory mount. Session issuance, renderer transport, active-deck replacement and Reload remain separate work.

Controller activation is explicit through `replaceDeck` ([contract](SLIDESHOW_CONTROLLER.md)). It commits only after successful render, keeps a surviving occurrence ID and retains the old deck on failure. The application must prepare/register the candidate and manage media lifetimes; this does not implement a watcher, persistent active pointer, event catalog or Google integration.
