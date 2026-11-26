"use strict";
// Detached preparation only. Source metadata is never output authority.

const path = require("node:path");

const fs = require("node:fs/promises");

const {
    performance
} = require("node:perf_hooks");

const {
    createExchangeCatalogReader,
    createExchangeMetadataReader
} = require("./exchange-metadata-reader.cjs");

const {
    createExchangeJournal
} = require("./exchange-journal.cjs");

const {
    createExchangeTimingGate
} = require("./exchange-timing.cjs");

const {
    createExchangeSchemaGate
} = require("./exchange-schema-gate.cjs");

const {
    canonicalExchangeJSON
} = require("./exchange-fingerprints.cjs");

const {
    stageExchangeSnapshot,
    loadExchangeSnapshot,
    EXCHANGE_SNAPSHOT_LIMITS: L
} = require("./exchange-snapshot.cjs");

function fail(code) {
    throw Object.assign(Error(code), {
        code: code
    });
}

function freeze(v) {
    if (v && typeof v === "object") {
        Object.values(v).forEach(freeze);
        Object.freeze(v);
    }
    return v;
}

function fields(v, allowed, required = allowed) {
    if (!v || typeof v !== "object" || Array.isArray(v) || ![ Object.prototype, null ].includes(Object.getPrototypeOf(v))) fail("COORDINATOR_OPTIONS_INVALID");
    const d = Object.getOwnPropertyDescriptors(v);
    if (required.some(k => !Object.hasOwn(d, k)) || Reflect.ownKeys(d).some(k => typeof k !== "string" || !allowed.includes(k) || !d[k].enumerable || !Object.hasOwn(d[k], "value"))) fail("COORDINATOR_OPTIONS_INVALID");
}

function tuple(raw) {
    // Canonicalizer rejects accessors and exotic arrays before copying.
    const v = JSON.parse(canonicalExchangeJSON(raw));
    if (!Array.isArray(v) || v.length !== 5 || v.some((x, i) => typeof x !== "string" || Array.from(x).length > [ 9, 64, 64, 6, 200 ][i]) || !/^\d{4}-\d{4}$/.test(v[0]) || !v[1] || ![ "event", "season" ].includes(v[3]) || !v[4] || v[3] === "season" && !v[2]) fail("COORDINATOR_OPTIONS_INVALID");
    return freeze(v);
}

function planBounds(m) {
    if (m.assets.length > L.maxFiles || m.occurrences.length > L.maxOccurrences) fail("ASSET_PLAN_LIMIT");
    // Contract 0.3.1, section 5.6: each distinct picture (SHA-256) counts once toward total bytes.
    let total = 0;
    const deliveries = new Map(), counted = new Set();
    for (const a of m.assets) {
        if (!counted.has(a.sha256)) {
            counted.add(a.sha256);
            total += a.byteLength;
        }
        if (a.byteLength > L.maxFileBytes || a.width > L.maxDimension || a.height > L.maxDimension || a.width * a.height > L.maxPixels || total > L.maxTotalBytes) fail("ASSET_PLAN_LIMIT");
        const same = deliveries.get(a.deliveryPath);
        if (same && [ "sha256", "byteLength", "mimeType", "width", "height" ].some(key => same[key] !== a[key])) fail("ASSET_PLAN_ALIAS_MISMATCH");
        deliveries.set(a.deliveryPath, a);
    }
}

function overlaps(left, right) {
    const comparable = value => process.platform === "win32" ? value.toLowerCase() : value;
    function contains(root, candidate) {
        const relative = path.relative(comparable(root), comparable(candidate));
        return relative === "" || !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep);
    }
    return contains(left, right) || contains(right, left);
}

function createExchangeSourceCoordinator(raw, trusted = {}) {
    fields(raw, [ "sourceRoot", "cacheDir", "journalDir", "storeId", "binding", "timeoutMs" ], [ "sourceRoot", "cacheDir", "journalDir", "storeId", "binding" ]);
    fields(raw.binding, [ "feedId", "epoch" ]);
    const c = {
        ...raw,
        binding: freeze({
            ...raw.binding
        }),
        timeoutMs: raw.timeoutMs ?? 3e4
    };
    if ([ "sourceRoot", "cacheDir", "journalDir" ].some(k => typeof c[k] !== "string" || !path.isAbsolute(c[k]) || path.resolve(c[k]) !== c[k]) || !Number.isSafeInteger(c.timeoutMs) || c.timeoutMs < 10 || c.timeoutMs > 6e4 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(c.storeId)) fail("COORDINATOR_OPTIONS_INVALID");
    if (overlaps(c.sourceRoot, c.journalDir) || overlaps(c.sourceRoot, c.cacheDir)) fail("COORDINATOR_ROOTS_OVERLAP");
    // Real reader validates binding synchronously; no I/O occurs here.
    createExchangeCatalogReader({
        root: c.sourceRoot,
        binding: c.binding
    }).close();
    fields(trusted, [ "journal", "catalogReader", "selectedReader", "stage", "load", "now", "timingGate", "schemaGate" ], []);
    const journal = trusted.journal ?? createExchangeJournal();
    const catalogFactory = trusted.catalogReader ?? createExchangeCatalogReader;
    const selectedFactory = trusted.selectedReader ?? createExchangeMetadataReader;
    const stage = trusted.stage ?? stageExchangeSnapshot, load = trusted.load ?? loadExchangeSnapshot;
    const now = trusted.now ?? (() => performance.now());
    const timing = trusted.timingGate ?? createExchangeTimingGate(), schemas = trusted.schemaGate ?? createExchangeSchemaGate();
    let flight = null, closed = false, lastPrepared = null, lastAccepted = null;
    const status = (code, extra = {}) => freeze({
        ok: code === "CONTENT_PREPARED" || code === "METADATA_ACCEPTED" || code === "CATALOG_ACCEPTED",
        code: code,
        scope: "source-preparation",
        ready: false,
        acceptedMetadata: false,
        contentPrepared: false,
        timingProposal: null,
        operatorConfirmationRequired: true,
        ...extra
    });
    function begin(kind, identity, options = {}) {
        fields(options, [ "signal" ], []);
        const signal = options.signal;
        if (signal !== undefined && !(signal instanceof AbortSignal)) fail("COORDINATOR_OPTIONS_INVALID");
        const ownedTuple = kind === "catalog" ? null : tuple(identity);
        if (closed) return Promise.resolve(status("COORDINATOR_CLOSED"));
        if (flight) return Promise.resolve(status("COORDINATOR_BUSY"));
        if (signal?.aborted) return Promise.resolve(status("COORDINATOR_ABORTED"));
        const run = {
            valid: true,
            deadline: now() + c.timeoutMs,
            abort: new AbortController(),
            readers: []
        };
        flight = run;
        let timer, resolveLogical;
        const logical = new Promise(resolve => {
            resolveLogical = resolve;
        });
        function cancel(code) {
            if (!run.valid) return;
            run.valid = false;
            run.abort.abort();
            for (const reader of run.readers) reader.close();
            resolveLogical(status(code));
        }
        run.cancel = cancel;
        const onAbort = () => cancel("COORDINATOR_ABORTED");
        signal?.addEventListener("abort", onAbort, {
            once: true
        });
        function active() {
            if (!run.valid || closed) fail(closed ? "COORDINATOR_CLOSED" : "COORDINATOR_ABORTED");
            if (now() >= run.deadline) {
                cancel("COORDINATOR_TIMEOUT");
                fail("COORDINATOR_TIMEOUT");
            }
        }
        async function drain(reader) {
            while (reader.snapshot().busy) await new Promise(resolve => setTimeout(resolve, 5));
        }
        async function capture(reader, method) {
            run.readers.push(reader);
            try {
                const result = await reader[method]();
                await drain(reader);
                active();
                if (!result.ok) fail(result.code);
                return result;
            } finally {
                reader.close();
                await drain(reader);
            }
        }
        async function work() {
            let head = await journal.open(c.journalDir, c.storeId);
            active();
            if (!head.ok) fail(head.code);
            if (!head.state.binding || head.state.binding.feedId !== c.binding.feedId || head.state.binding.epoch !== c.binding.epoch) fail("JOURNAL_BINDING_MISMATCH");
            async function verifySourceJournalBoundary() {
                let sourceReal, journalReal;
                try {
                    sourceReal = await fs.realpath(c.sourceRoot);
                } catch {
                    fail("SOURCE_UNAVAILABLE");
                }
                active();
                try {
                    journalReal = await fs.realpath(c.journalDir);
                } catch {
                    fail("JOURNAL_IO_FAILED");
                }
                active();
                if (overlaps(sourceReal, journalReal)) fail("COORDINATOR_ROOTS_OVERLAP");
            }
            // Resolve actual spellings before reading source and again before
            // each fact; Windows case/short-name aliases must never turn the
            // read-only exchange into the metadata journal's destination.
            await verifySourceJournalBoundary();
            async function append(event) {
                active();
                await verifySourceJournalBoundary();
                active();
                const next = await journal.append(c.journalDir, {
                    expectedStoreId: c.storeId,
                    expectedRevision: head.revision,
                    expectedHeadSha256: head.headSha256,
                    event: {
                        ...event,
                        expectedRevision: head.revision
                    }
                });
                active();
                if (!next.ok) fail(next.code);
                head = next;
            }
            async function catalogFact(receipt) {
                await append({
                    type: "catalog",
                    feedId: receipt.feedId,
                    epoch: receipt.epoch,
                    catalogSequence: receipt.catalogSequence,
                    digest: receipt.documentDigests.catalog
                });
            }
            const first = await capture(catalogFactory({
                root: c.sourceRoot,
                binding: c.binding,
                timeoutMs: Math.min(3e4, c.timeoutMs)
            }), "captureCatalog");
            await catalogFact(first.receipt);
            if (kind === "catalog") {
                active();
                lastAccepted = first.receipt;
                return status("CATALOG_ACCEPTED", {
                    acceptedMetadata: true,
                    catalogReceipt: first.receipt,
                    contentPrepared: false
                });
            }
            const captured = await capture(selectedFactory({
                root: c.sourceRoot,
                binding: {
                    ...c.binding,
                    identityTuple: ownedTuple
                },
                timeoutMs: Math.min(3e4, c.timeoutMs)
            }), "captureWithCatalogReceipt");
            const pin = captured.pin;
            await catalogFact(pin.catalogReceipt);
            for (const key of [ "feed", "catalog", "current", "manifest" ]) if (pin[key] !== null && !schemas.validate(key === "manifest" ? "selection" : key, pin[key]).ok) fail("METADATA_SCHEMA_INVALID");
            // V9 permits catalog equal to or older than a present current.
            // The legacy transport reader may fall back to catalog; this
            // stricter coordinator must not journal that as selected admission.
            if (pin.current === null || pin.descriptor.generationSequence > pin.current.generationSequence) fail("DESCRIPTOR_CONTEXT_INVALID");
            const gate = timing.validate(pin.manifest);
            active();
            if (!gate.ok) fail(gate.code);
            planBounds(pin.manifest);
            active();
            const m = pin.manifest;
            await append({
                type: "manifest",
                feedId: m.feedId,
                epoch: m.epoch,
                selectionId: m.selectionId,
                identityTuple: m.identityTuple,
                generationSequence: m.generationSequence,
                digest: pin.documentDigests.manifest
            });
            const proposal = freeze({
                available: gate.timingAvailable,
                broadcastWindow: m.event.timing.broadcastWindow,
                reviewFlags: gate.reviewFlags,
                operatorConfirmationRequired: true,
                ready: false
            });
            active();
            lastAccepted = pin;
            run.acceptedMetadata = true;
            run.timingProposal = proposal;
            const extra = {
                acceptedMetadata: true,
                contentPrepared: false,
                timingProposal: proposal,
                admissionEligible: m.event.eligibility.eligible,
                manifestState: m.manifestState
            };
            if (kind === "inspect" || m.manifestState !== "complete" || !m.occurrences.length || m.occurrences.some(o => o.assetKey === null || o.problem !== null)) return status("METADATA_ACCEPTED", extra);
            const previous = lastPrepared?.manifest.source;
            const reuse = previous && previous.feedId === m.feedId && previous.epoch === m.epoch && previous.selectionId === m.selectionId && previous.playbackFingerprint === m.playbackFingerprint;
            // A refused reuse (changed bytes, a bad provenance) drops the
            // staged snapshot, so the next preparation stages fresh from the
            // source instead of being refused until the app restarts (Q-007).
            // An abort, timeout or close is not a refusal: the snapshot stays.
            const refused = reused => {
                if (run.valid && !run.abort.signal.aborted && !closed && lastPrepared === reused) lastPrepared = null;
            };
            const reused = reuse ? lastPrepared : null;
            const prepared = reuse ? await load(reused.snapshotDir, {
                signal: run.abort.signal
            }).catch(error => {
                refused(reused);
                throw error;
            }) : await stage({
                sourceRoot: c.sourceRoot,
                cacheDir: c.cacheDir,
                manifest: m,
                signal: run.abort.signal
            });
            active();
            // Cache loader independently verifies the stored provenance and playback.
            const p = prepared.manifest.source;
            if (p.feedId !== m.feedId || p.epoch !== m.epoch || p.selectionId !== m.selectionId || p.playbackFingerprint !== m.playbackFingerprint) {
                if (reused) refused(reused);
                fail("CACHE_PROVENANCE_MISMATCH");
            }
            active();
            lastPrepared = prepared;
            return status("CONTENT_PREPARED", {
                ...extra,
                contentPrepared: true,
                mediaChanged: !reuse,
                prepared: prepared
            });
        }
        timer = setTimeout(() => cancel("COORDINATOR_TIMEOUT"), c.timeoutMs);
        const physical = work().catch(error => status(typeof error.code === "string" ? error.code : "PREPARATION_FAILED", run.valid ? {
            acceptedMetadata: run.acceptedMetadata === true,
            timingProposal: run.timingProposal ?? null
        } : {})).then(result => {
            // Includes synchronous gates after a timer's deadline but before callbacks.
            if (run.valid && !closed && now() < run.deadline) return result;
            return status(closed ? "COORDINATOR_CLOSED" : now() >= run.deadline ? "COORDINATOR_TIMEOUT" : "COORDINATOR_ABORTED");
        }).finally(async () => {
            for (const reader of run.readers) {
                reader.close();
                await drain(reader);
            }
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            if (flight === run) flight = null;
        });
        return Promise.race([ physical, logical ]);
    }
    return Object.freeze({
        refreshCatalog: options => begin("catalog", null, options),
        inspectSelection: (identity, options) => begin("inspect", identity, options),
        prepareSelection: (identity, options) => begin("prepare", identity, options),
        snapshot: () => freeze({
            scope: "source-preparation",
            ready: false,
            busy: flight !== null,
            closed: closed,
            lastPrepared: lastPrepared,
            lastAccepted: lastAccepted,
            operatorConfirmationRequired: true
        }),
        close() {
            closed = true;
            flight?.cancel("COORDINATOR_CLOSED");
        }
    });
}

module.exports = {
    createExchangeSourceCoordinator: createExchangeSourceCoordinator
};
