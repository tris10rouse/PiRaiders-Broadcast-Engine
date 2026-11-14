# ADR 0004: Decode immutable local media candidates before activation

Status: adopted for the BE-005 snapshot-preparation increment; live activation remains unimplemented.

Prepare local Drive-synced JPG/PNG into separate version directories rather than rendering directly from changing source files. Capture a stable bounded inventory, verify real pixels off the main service thread, publish generated media/manifest atomically, and independently verify cached snapshots for offline recovery. Keep preparation separate from active-deck selection and the production-window/sender lifecycle.

Use pinned pngjs 7.0.0 (MIT) and jpeg-js 0.4.4 (BSD-3-Clause) with their complete redistribution notices. They provide reproducible pure-JavaScript decoding on Windows/Ubuntu without a new native image runtime. Restrict unsupported APNG/interlaced PNG and DRI/restart JPEG: review demonstrated unbounded inflate exposure in the former PNG path and accepted truncated restart entropy in strict jpeg-js. Treat those candidates as unsupported, not validated. New codecs/subtype support need evidence and license review.

No cloud Drive integration, source modification, live folder rendering or automatic active-deck replacement is introduced. Source names determine stable hashed media IDs; generated cache paths prevent source names from becoming renderer paths. Hashes are integrity checks, not signed authenticity. Ordinary sync races are tested; continuous hostile filesystem replacement is outside this local-cache boundary's guarantees.

See docs/operations/MEDIA_SNAPSHOTS.md for limits, recovery, explicit subtype restrictions and the remaining live Reload/rendering gates. The SPX foundation and existing graphics lifecycle remain intact.
