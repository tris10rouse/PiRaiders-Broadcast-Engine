# Integration audit: Engine `master` against the scheduler's exchange contract, draft 0.3.1

Done 2026-11-19 on Engine `master` `50bb524`, with the scheduler at version 2.159.0. Read-only on the scheduler. Linux, Node 22, 2 virtual CPUs, local disk: nothing here is a Windows, synced-folder or hardware result. Per-case fixture results are in `docs/agent/FIXTURE_RESULTS_FOR_SCHEDULER.md`.

**Since the audit (2026-11-19, later the same day).** The large-JPEG defect in section 1 is fixed on the exchange path: the decoder's counted budget is 512 MB and the worker heap cap 384 MB, and every JPEG layout at 4096 x 4096 now passes inside the unchanged 10 s limit (numbers in `CHANGELOG.md`). The findings below are kept as written on `50bb524`. Still open from this audit: total bytes counted per asset row (section 3), suggested polling, and everything under "Unknown or not verified". New since the audit: the older local-folder path refuses the same JPEGs and is not yet changed; and a dense progressive 4:4:4 JPEG at the pixel limit takes up to 5.5 s of the 10 s limit on this 2-CPU machine.

## Summary

| Question | Answer |
|---|---|
| Are the four schema files the same on both sides? | Yes, byte-identical (SHA-256 equal for feed, catalog, current and selection). |
| How long does a 4096 x 4096 picture take against the per-picture limit? | PNG: 0.3 to 0.4 s for the pack's own picture, at most 3.0 s for the heaviest legal PNG, against 10 s. The old agent's timeout was not reproduced; its cause is unknown. **JPEG: always rejected**, for memory, not time (new finding). |
| Do the 128-entry caps conflict with 800 events / 100 selections? | No. They belong to the old local-folder catalog only. The exchange path accepts 800 and 100, refuses 801 and 101, and pages by 64. But nothing in the application lists an exchange catalog yet. |
| Do the Engine's constants match the contract's bounds table? | 7 rows match, 2 are stricter in the Engine (pixels for JPEG; total bytes when identical bytes repeat), 1 is not implemented (suggested polling). |
| Which statements in the two source-contract documents were stale? | 22. Corrected in `docs/decisions/0005-apps-script-media-authority.md`, `docs/design/APPS_SCRIPT_MEDIA_CONTRACT.md` and `ROADMAP.md`. |

## 1. A 4096 x 4096 picture

Limits on the exchange path: 10,000 ms per picture (`LIMITS.timeoutMs`, `scripts/lib/exchange-snapshot.cjs`; a caller can lower it, not raise it; the validator session refuses more than 10,000), 20 MiB, 8,192 px a side, 16,777,216 pixels. The JPEG decoder gets a 128 MB memory budget and the worker a 64 MB / 16 MB JavaScript heap (`scripts/lib/image-validator-session.cjs`); the exchange path never passes a larger budget.

| Picture (all 16,777,216 pixels) | Three runs | Result |
|---|---|---|
| The fixture pack's own 4096 x 4096 PNG, rebuilt from its recipe (SHA-256 matched) | 378 / 293 / 303 ms | passes |
| Same picture through real staging, then cache reload | 307 to 589 ms, then about 300 ms | passes |
| Photo-like noisy PNG, 8-bit RGB, 17.8 MB | about 760 ms | passes |
| Heaviest legal PNG found (16-bit RGBA noise, 19.6 MB) | 2.9 to 3.0 s | passes |
| Same heaviest PNG with 8 competing processes on 2 CPUs | 10.07 s | `IMAGE_TIMEOUT` |
| The pack's own picture with 8 competing processes | 1.3 to 1.7 s | passes |
| JPEG 4096 x 4096 (4:2:0, 4:4:4, greyscale, progressive) | under 1 s | **`IMAGE_DECODE_FAILED`** (on `50bb524`; passes since the fix noted at the top) |

- **PNG.** The old agent recorded `IMAGE_TIMEOUT` at 14,666 ms and no fix. Not reproduced. Load alone does not explain it for the pack's picture. **Cause unknown.** The margin for 16-bit PNGs is about 3.3 times on this machine and the limit is fixed in code; the stadium PC has not been measured.
- **JPEG (new, an Engine defect against section 5.6).** The decoder counts memory before allocating: about 14.5 bytes per pixel for 4:2:0, 22 for 4:4:4, 10 for greyscale. At 128 MB that allows about 9.2, 6.1 and 13.4 megapixels; measured boundaries agree (4000 x 2304 passes, 4096 x 2304 fails; a 4032 x 3024 phone-sized photo fails). Raising the budget alone is not enough: the worker heap is then exhausted. With both raised (512 MB budget, 512 MB heap) a colour 4096 x 4096 JPEG decodes in 0.8 to 1.6 s. Meaning: a selection the scheduler publishes as complete can be impossible for the Engine to prepare. The fixture pack does not catch it because its limit cases are PNG only.
- A whole selection at the byte limit (26 pictures, exactly 512 MiB, rebuilt from recipes): staged in 4.0 to 4.4 s and reloaded in 3.8 to 3.9 s, against a 30 s default operation limit. The old agent recorded 40.9 s; not reproduced.

## 2. The 128-entry caps

- `scripts/lib/game-day-catalog.cjs`: `MAX_ENTRIES = 128` directory entries in the local catalog folder. Over it, the whole folder is refused (`CATALOG_INVALID`); nothing is truncated or paged.
- `scripts/lib/game-day-manager.cjs`: a list longer than 128 from the catalog is refused whole (`CATALOG_INVALID`). Event ids must be lower-case slugs of at most 64 characters; display names 128 units for local entries and 200 code points for exchange profiles.
- Neither module knows what a selection is.
- The exchange path does not go through either module for listing: metadata reader (800 events, 5,242,880 bytes) → catalog receipt (schema limits 800 / 100) → catalog view → pages of at most 64 (default 50). Measured: 800 events accepted and read in 13 pages; 801 refused; 100 selections on one event accepted; 101 refused.
- The local catalog refuses a machine configuration that has a source block, and no route, screen or default wiring calls the exchange catalog pages. So today the application cannot list an exchange catalog at all. That is the next piece of work, not a cap conflict.
- If exchange events were ever fed into the old listing, the whole list would be refused, and exchange event keys do not fit the old id grammar. Keep the two paths separate.

## 3. Bounds table (contract section 5.6)

| Contract row | Contract limit | Engine constant | Verdict |
|---|---|---|---|
| One picture's bytes | 20,971,520 | `LIMITS.maxFileBytes`, `exchange-snapshot.cjs`; `MAX_INPUT_BYTES`, `image-validator.cjs` | match |
| One picture's width or height | 8,192 px | `LIMITS.maxDimension`, `exchange-snapshot.cjs` | match |
| One picture's pixels | 16,777,216 | `LIMITS.maxPixels`, `exchange-snapshot.cjs` | number matches; **Engine stricter for JPEG** (memory, section 1) |
| Ordered occurrences per selection | 500 | `LIMITS.maxOccurrences`; `CAPS.occurrences`, `exchange-problem-state.cjs` | match |
| Different pictures per selection | 500 | `LIMITS.maxFiles`; `CAPS.assets`; 500 pictures per decoder session | match |
| Total bytes of different pictures, each counted once | 536,870,912 | `LIMITS.maxTotalBytes`; `CAPS.total_bytes` | match since 2026-11-19 (fence 49): each SHA-256 counted once at the plan check, staging and cache reload. Before that the Engine added every asset row (26 source files with identical 20 MiB bytes were complete to the publisher and `TOTAL_LIMIT` to the Engine) |
| Labels / names | 200 / 255 characters | schema limits through the schema gate; identity tuple limits; display name 200 code points | match (the publisher counts UTF-16 units, the Engine code points; the publisher is equal or stricter) |
| Manifest size | 1,048,576 bytes | `LIMITS.manifest`, `exchange-metadata-reader.cjs` | match |
| Catalog: bytes / events / selections per event | 5,242,880 / 800 / 100 | `LIMITS.catalog`; `events.length>800`; schema and view limits | match (measured at 800/801 and 100/101) |
| Suggested polling: no more often than every 5 s, back off to 60 s after 10 unchanged reads, retry a missing picture for up to 15 min | suggested | none found | **not implemented**; refresh is driven by the caller |

Other limits the contract states elsewhere all match: windows of at most 24 hours, sequences up to 9,999,999,999, epoch up to 999,999, strict JSON (no duplicate keys, no byte-order mark, safe integers), keys of at most 64 characters, 15 minutes of prewarm.

Engine limits with no row in the contract are listed in `FIXTURE_RESULTS_FOR_SCHEDULER.md` for the scheduler side. Two deserve a decision later: the Engine tracks at most 2,048 selections per feed while a legal catalog can list more, and the journal holds 10,000 records and is never trimmed silently (how fast it fills at a one-minute event-day cadence is not determined).

## 4. Stale statements, now corrected

What was wrong in `docs/decisions/0005-apps-script-media-authority.md` and `docs/design/APPS_SCRIPT_MEDIA_CONTRACT.md` (22 statements; both now carry dated corrections):

- They described scheduler version 2.122.0 as current. It is 2.159.0.
- They called R-158 and R-168 planned. Both are built and released in the scheduler's source: R-168 in 2.130.0; R-158 in parts across 2.139.0, 2.147.0 and 2.149.0. Whether the owner's installed copy has them is not established, and the Engine depends on neither.
- They said no ordered export, no board/button identity, no event times and no access method were defined. Contract draft 0.3.1 defines all four: an explicit position on every occurrence, a five-part selection identity with the target board key, instants with offsets, sources and closed reason codes, and a synced folder of content-addressed pictures.
- They said the integration was planned and unimplemented. It is partly built on both sides and enabled on neither: the scheduler's publisher is code and fixtures and writes no folder yet; the Engine's exchange modules are not wired into the default application.
- They described byte resolution by source file identifier. The contract resolves by content hash; the Engine never resolves a source identifier and calls no Google API.
- Table and folder descriptions were out of date (new columns for typed times, target board and picture size; board-size picture copies; a seventh file kind; slide pictures as JPEG at the board's size when one is set).
- `ROADMAP.md` repeated that R-158 and R-168 remain planned.

One thing the scheduler has that the contract does not carry: per button, whether it plays as a timed slideshow or one picture per button, with its seconds. Noted for the scheduler side; no contract change is made here.

## Unknown or not verified

- Why the old agent's 4096 x 4096 picture timed out, and why its 512 MiB run took 40.9 s.
- Anything on Windows or on the stadium PC: decode times, worker heap behaviour, the synced-folder client.
- Whether the owner's library holds JPEGs above about 9 megapixels (no real data was read, by design).
- How fast the 10,000-record journal fills in real use.
- A tree written by the real publisher: its folder-writing part does not exist yet, so only fixture trees were tested.
