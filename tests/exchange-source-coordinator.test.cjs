"use strict";

const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");

const {
    PNG
} = require("pngjs"), jpeg = require("jpeg-js");

const {
    fixtures
} = require("./exchange-fixtures.cjs");

const {
    selectionId,
    selectionFingerprints
} = require("../scripts/lib/exchange-fingerprints.cjs");

const {
    createExchangeJournal
} = require("../scripts/lib/exchange-journal.cjs");

const {
    createExchangeSourceCoordinator
} = require("../scripts/lib/exchange-source-coordinator.cjs");

const {
    stageExchangeSnapshot,
    loadExchangeSnapshot
} = require("../scripts/lib/exchange-snapshot.cjs");

const hash = b => crypto.createHash("sha256").update(b).digest("hex");

const copy = v => JSON.parse(JSON.stringify(v));

const wait = ms => new Promise(r => setTimeout(r, ms));

async function until(fn) {
    for (let n = 0; n < 1e3; n++) {
        if (fn()) return;
        await wait(5);
    }
    throw Error("DRAIN_WATCHDOG");
}

function latch() {
    let release;
    const promise = new Promise(r => release = r);
    return {
        promise: promise,
        release: release
    };
}

async function guarded(p) {
    let timer;
    try {
        return await Promise.race([ p, new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error("OUTER_WATCHDOG")), 5e3);
        }) ]);
    } finally {
        clearTimeout(timer);
    }
}

function image(format = "png", red = 255) {
    const data = Buffer.from([ red, 0, 0, 255, red, 0, 0, 255 ]);
    return format === "png" ? PNG.sync.write({
        width: 2,
        height: 1,
        data: data
    }) : jpeg.encode({
        width: 2,
        height: 1,
        data: data
    }, 90).data;
}

function seal(m) {
    m.selectionId = selectionId(m.identityTuple);
    Object.assign(m, selectionFingerprints(m));
    delete m.scope;
    delete m.ready;
    delete m.semanticValidation;
    m.generation = "e" + m.epoch + "-g" + String(m.generationSequence).padStart(10, "0") + "-" + m.metadataFingerprint.slice(0, 12);
    return m;
}

function source(blobs = [ image(), image("jpeg") ], order = [ 1, 0, 1 ]) {
    const m = fixtures().selection;
    m.manifestState = "complete";
    m.assets = blobs.map((b, i) => ({
        assetKey: "a" + (i + 1),
        originalDriveId: "synthetic-drive-" + i,
        viaShortcutId: null,
        sourceRevision: {
            md5: null,
            size: null,
            modifiedTime: null,
            headRevisionId: null
        },
        mimeType: b[0] === 255 ? "image/jpeg" : "image/png",
        deliveryPath: "assets/" + hash(b) + (b[0] === 255 ? ".jpg" : ".png"),
        byteLength: b.length,
        sha256: hash(b),
        width: 2,
        height: 1
    }));
    m.occurrences = order.map((n, i) => ({
        position: i + 1,
        occurrenceKey: "row-" + i,
        fileKey: "FILE-" + i,
        assetKey: "a" + (n + 1),
        problem: null,
        sourceName: "Synthetic",
        lineage: null
    }));
    return seal(m);
}

async function fixture(t, seams = {}, options = {}) {
    const rawParent = await fs.mkdtemp(path.join(os.tmpdir(), "PiRaiders coordinator "));
    const parent = await fs.realpath(rawParent);
    t.after(() => fs.rm(parent, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
    }));
    const sourceRoot = path.join(parent, "source"), cacheDir = path.join(parent, "cache"), journalDir = path.join(parent, "journal");
    await fs.mkdir(sourceRoot);
    assert.equal(sourceRoot, await fs.realpath(sourceRoot), "fault hooks use canonical source root");
    const journal = createExchangeJournal(), storeId = crypto.randomUUID(), binding = {
        feedId: fixtures().feed.feedId,
        epoch: 1
    };
    let head = await journal.initialize(journalDir, storeId);
    head = await journal.append(journalDir, {
        expectedStoreId: storeId,
        expectedRevision: head.revision,
        expectedHeadSha256: head.headSha256,
        event: {
            type: "confirm-binding",
            expectedRevision: head.revision,
            expectedBinding: null,
            binding: binding,
            confirm: true
        }
    });
    assert.equal(head.ok, true);
    const config = {
        sourceRoot: sourceRoot,
        cacheDir: cacheDir,
        journalDir: journalDir,
        storeId: storeId,
        binding: binding,
        ...options
    };
    const coordinator = createExchangeSourceCoordinator(config, seams);
    t.after(() => coordinator.close());
    async function write(relative, v) {
        const file = path.join(sourceRoot, ...relative.split("/"));
        await fs.mkdir(path.dirname(file), {
            recursive: true
        });
        await fs.writeFile(file, Buffer.isBuffer(v) ? v : JSON.stringify(v));
    }
    async function publish(m = source(), {
        manifest = true,
        current = true,
        assets = true,
        sequence = m.generationSequence
    } = {}) {
        const base = fixtures(), manifestPath = "selections/" + m.selectionId + "/generations/" + m.generation + "/manifest.json", manifestSha256 = hash(Buffer.from(JSON.stringify(m)));
        const entry = {
            selectionId: m.selectionId,
            identityTuple: m.identityTuple,
            origin: m.button.origin,
            targetBoardKey: m.board.boardKey,
            displayLabel: m.button.displayLabel,
            templateButtonKey: m.button.templateButtonKey,
            labelShared: false,
            generation: m.generation,
            generationSequence: m.generationSequence,
            manifestPath: manifestPath,
            manifestSha256: manifestSha256,
            playbackFingerprint: m.playbackFingerprint,
            metadataFingerprint: m.metadataFingerprint,
            occurrenceCount: m.occurrences.length,
            manifestState: m.manifestState
        };
        const catalog = {
            ...base.catalog,
            catalogSequence: sequence,
            events: [ {
                ...m.event,
                eventType: "Synthetic",
                homeSchool: "Synthetic",
                venue: "Synthetic",
                playbackArea: "Stadium Playback",
                boardOnly: true,
                eventBoard: m.board,
                selections: [ entry ]
            } ]
        };
        await write("feed.json", base.feed);
        await write("catalog.json", catalog);
        if (manifest) await write(manifestPath, m);
        if (current) {
            const curr = {
                ...base.current
            };
            for (const k of Object.keys(curr)) if (Object.hasOwn(entry, k)) curr[k] = entry[k];
            await write("selections/" + m.selectionId + "/current.json", curr);
        }
        if (assets) {
            for (const a of m.assets) {
                const b = a.mimeType === "image/png" ? image() : image("jpeg");
                if (hash(b) === a.sha256) await write(a.deliveryPath, b);
            }
        }
        return {
            catalog: catalog,
            entry: entry,
            m: m
        };
    }
    return {
        parent: parent,
        config: config,
        coordinator: coordinator,
        journal: journal,
        write: write,
        publish: publish,
        head: () => journal.open(journalDir, storeId),
        reopen: () => createExchangeSourceCoordinator(config)
    };
}

test("real PNG/JPEG ordered repeats stage; metadata-only reuses verified cache without source assets", async t => {
    let stages = 0, loads = 0;
    const f = await fixture(t, {
        stage: async r => {
            stages++;
            return stageExchangeSnapshot(r);
        },
        load: async (...a) => {
            loads++;
            return loadExchangeSnapshot(...a);
        }
    }), m = source();
    await f.publish(m);
    const first = await f.coordinator.prepareSelection(m.identityTuple);
    assert.equal(first.code, "CONTENT_PREPARED");
    assert.equal(first.ready, false);
    assert.equal(first.contentPrepared, true);
    assert.equal(first.operatorConfirmationRequired, true);
    assert.equal(first.timingProposal.operatorConfirmationRequired, true);
    assert.equal(first.prepared.deck.slides.length, 3);
    assert.equal(first.prepared.deck.slides[0].src, first.prepared.deck.slides[2].src);
    const next = copy(m);
    next.generationSequence++;
    next.sourceTicks.onBoardAll = true;
    seal(next);
    await f.publish(next, {
        assets: false
    });
    await fs.rm(path.join(f.config.sourceRoot, "assets"), {
        recursive: true
    });
    const second = await f.coordinator.prepareSelection(next.identityTuple);
    assert.equal(second.code, "CONTENT_PREPARED");
    assert.equal(second.mediaChanged, false);
    assert.equal(second.prepared.snapshotDir, first.prepared.snapshotDir);
    assert.equal(stages, 1);
    assert.equal(loads, 1);
    await fs.access(first.prepared.snapshotDir);
});

test("catalog absent manifest retains floor across reopen and rejects same sequence fork", async t => {
    const f = await fixture(t), m = source();
    await f.publish(m, {
        manifest: false,
        assets: false
    });
    assert.equal((await f.coordinator.prepareSelection(m.identityTuple)).code, "INPUT_UNAVAILABLE");
    let head = await f.head();
    assert.equal(head.state.feeds[0].catalog.sequence, 1);
    assert.equal(head.state.feeds[0].selections.length, 0);
    const altered = await f.publish(m, {
        manifest: false,
        assets: false
    });
    altered.catalog.sourceVersion = "0.0.1";
    await f.write("catalog.json", altered.catalog);
    const reopened = f.reopen();
    t.after(() => reopened.close());
    assert.equal((await reopened.prepareSelection(m.identityTuple)).code, "JOURNAL_EVENT_REJECTED");
    head = await f.head();
    assert.equal(head.state.feeds[0].selections.length, 0);
});

test("missing actual assets records manifest; V20 declared overflow records no manifest", async t => {
    const f = await fixture(t), m = source();
    await f.publish(m, {
        assets: false
    });
    const r = await f.coordinator.prepareSelection(m.identityTuple);
    assert.equal(r.code, "SNAPSHOT_IO");
    assert.equal((await f.head()).state.feeds[0].selections[0].sequence, 1);
    const other = await fixture(t), bad = source();
    bad.assets[0].width = 8192;
    bad.assets[0].height = 8192;
    seal(bad);
    await other.publish(bad, {
        assets: false
    });
    assert.equal((await other.coordinator.prepareSelection(bad.identityTuple)).code, "ASSET_PLAN_LIMIT");
    assert.equal((await other.head()).state.feeds[0].selections.length, 0);
});

test("current-ahead chosen manifest receives its own fact", async t => {
    const f = await fixture(t), one = source(), two = copy(one);
    two.generationSequence = 2;
    two.sourceTicks.eventBoardLoaded = true;
    seal(two);
    const old = await f.publish(one);
    await f.publish(two, {
        sequence: 1
    });
    await f.write("catalog.json", old.catalog);
    const r = await f.coordinator.prepareSelection(one.identityTuple);
    assert.equal(r.code, "CONTENT_PREPARED");
    assert.equal((await f.head()).state.feeds[0].catalog.sequence, 1);
    assert.equal((await f.head()).state.feeds[0].selections[0].sequence, 2);
});

test("changed order stages new UUID retaining previous cache", async t => {
    const f = await fixture(t), one = source();
    await f.publish(one);
    const a = await f.coordinator.prepareSelection(one.identityTuple);
    const two = source(undefined, [ 0, 1, 0 ]);
    two.generationSequence = 2;
    seal(two);
    await f.publish(two);
    const b = await f.coordinator.prepareSelection(two.identityTuple);
    assert.equal(b.code, "CONTENT_PREPARED");
    assert.equal(b.mediaChanged, true);
    assert.notEqual(b.prepared.snapshotDir, a.prepared.snapshotDir);
    await fs.access(a.prepared.snapshotDir);
});

test("empty, removed, absent and invalid preserve last prepared", async t => {
    const f = await fixture(t), m = source();
    await f.publish(m);
    const first = await f.coordinator.prepareSelection(m.identityTuple);
    assert.equal(first.code, "CONTENT_PREPARED");
    for (const state of [ "empty", "removed" ]) {
        const next = fixtures().selection;
        next.manifestState = state;
        next.generationSequence = state === "empty" ? 2 : 3;
        seal(next);
        await f.publish(next);
        const r = await f.coordinator.prepareSelection(next.identityTuple);
        assert.equal(r.code, "METADATA_ACCEPTED", r.code);
        assert.equal(r.contentPrepared, false);
        assert.equal(f.coordinator.snapshot().lastPrepared.snapshotDir, first.prepared.snapshotDir);
    }
    const gone = fixtures().catalog;
    gone.catalogSequence = 4;
    await f.write("catalog.json", gone);
    assert.equal((await f.coordinator.prepareSelection(m.identityTuple)).code, "SELECTION_ABSENT");
    assert.equal(f.coordinator.snapshot().lastPrepared.snapshotDir, first.prepared.snapshotDir);
});

test("journal rebound and foreign feed fail closed", async t => {
    const f = await fixture(t), m = source();
    await f.publish(m);
    let head = await f.head();
    const binding = {
        feedId: crypto.randomUUID(),
        epoch: 1
    };
    await f.journal.append(f.config.journalDir, {
        expectedStoreId: head.storeId,
        expectedRevision: head.revision,
        expectedHeadSha256: head.headSha256,
        event: {
            type: "confirm-binding",
            expectedRevision: head.revision,
            confirm: true,
            expectedBinding: f.config.binding,
            binding: binding
        }
    });
    assert.equal((await f.coordinator.prepareSelection(m.identityTuple)).code, "JOURNAL_BINDING_MISMATCH");
    const g = await fixture(t);
    await g.publish(m);
    await g.write("feed.json", {
        ...fixtures().feed,
        feedId: crypto.randomUUID()
    });
    assert.equal((await g.coordinator.prepareSelection(m.identityTuple)).code, "REBIND_REQUIRED");
});

test("separate manifest journal failure and uncertain ack never stage", async t => {
    for (const code of [ "JOURNAL_IO_FAILED", "JOURNAL_COMMIT_UNCERTAIN", "JOURNAL_CONFLICT" ]) {
        const actual = createExchangeJournal();
        let stages = 0;
        const f = await fixture(t, {
            journal: {
                open: actual.open,
                append: (dir, r) => r.event.type === "manifest" ? Promise.resolve({
                    ok: false,
                    code: code
                }) : actual.append(dir, r)
            },
            stage: () => {
                stages++;
                throw Error("FORBIDDEN");
            }
        }), m = source();
        await f.publish(m);
        assert.equal((await f.coordinator.prepareSelection(m.identityTuple)).code, code);
        assert.equal(stages, 0);
        assert.equal((await f.head()).state.feeds[0].catalog.sequence, 1);
        assert.equal(f.coordinator.snapshot().lastPrepared, null);
    }
});

test("logical timeout retains BUSY through actual blocked reader close; late result never commits", {
    timeout: 1e4
}, async t => {
    let clock = 0;
    const f = await fixture(t, {
        now: () => clock
    }, {
        timeoutMs: 1e3
    }), m = source();
    await f.publish(m);
    const original = fs.open, entered = latch(), block = latch();
    let closed = false;
    fs.open = async (file, ...args) => {
        const h = await original.call(fs, file, ...args);
        if (file !== path.join(f.config.sourceRoot, "catalog.json")) return h;
        return {
            stat: h.stat.bind(h),
            read: h.read.bind(h),
            close: async () => {
                entered.release();
                await block.promise;
                await h.close();
                closed = true;
            }
        };
    };
    try {
        const pending = f.coordinator.prepareSelection(m.identityTuple);
        await guarded(entered.promise);
        clock = 1e3;
        assert.equal((await guarded(pending)).code, "COORDINATOR_TIMEOUT");
        assert.equal(f.coordinator.snapshot().busy, true);
        assert.equal(closed, false);
        assert.equal((await f.coordinator.prepareSelection(m.identityTuple)).code, "COORDINATOR_BUSY");
        block.release();
        await until(() => !f.coordinator.snapshot().busy);
        assert.equal(closed, true);
        assert.equal(f.coordinator.snapshot().lastPrepared, null);
        assert.equal((await f.head()).state.feeds[0].catalog, null);
    } finally {
        block.release();
        fs.open = original;
    }
});

test("close and abort retain BUSY through ignored staging then fence candidate commit", {
    timeout: 15e3
}, async t => {
    for (const kind of [ "close", "abort" ]) {
        const entered = latch(), block = latch();
        const f = await fixture(t, {
            stage: async r => {
                entered.release();
                await block.promise;
                return stageExchangeSnapshot({
                    ...r,
                    signal: undefined
                });
            }
        }), m = source();
        await f.publish(m);
        const abort = new AbortController();
        const pending = f.coordinator.prepareSelection(m.identityTuple, {
            signal: abort.signal
        });
        await guarded(entered.promise);
        if (kind === "close") f.coordinator.close(); else abort.abort();
        assert.equal((await guarded(pending)).code, kind === "close" ? "COORDINATOR_CLOSED" : "COORDINATOR_ABORTED");
        assert.equal(f.coordinator.snapshot().busy, true);
        block.release();
        await until(() => !f.coordinator.snapshot().busy);
        assert.equal(f.coordinator.snapshot().lastPrepared, null);
        assert.equal((await f.head()).state.feeds[0].selections[0].sequence, 1);
    }
});

test("journal started before abort may commit valid fact, but cannot acknowledge candidate", {
    timeout: 1e4
}, async t => {
    const actual = createExchangeJournal(), entered = latch(), block = latch();
    const f = await fixture(t, {
        journal: {
            open: actual.open,
            append: async (dir, r) => {
                if (r.event.type === "manifest") {
                    entered.release();
                    await block.promise;
                }
                return actual.append(dir, r);
            }
        }
    }), m = source();
    await f.publish(m);
    const abort = new AbortController(), pending = f.coordinator.prepareSelection(m.identityTuple, {
        signal: abort.signal
    });
    await guarded(entered.promise);
    abort.abort();
    assert.equal((await pending).code, "COORDINATOR_ABORTED");
    assert.equal(f.coordinator.snapshot().busy, true);
    block.release();
    await until(() => !f.coordinator.snapshot().busy);
    assert.equal((await f.head()).state.feeds[0].selections.length, 1);
    assert.equal(f.coordinator.snapshot().lastPrepared, null);
    assert.equal(f.coordinator.snapshot().lastAccepted, null);
});

test("late synchronous gate crosses immutable deadline before manifest append", {
    timeout: 1e4
}, async t => {
    const {createExchangeTimingGate}=require('../scripts/lib/exchange-timing.cjs'),gate=createExchangeTimingGate();
    const {performance}=require('node:perf_hooks');
    let clock=0,gateCalls=0,deadlineTimers=0;
    const schedule=global.setTimeout,cancel=global.clearTimeout,held=new Set();
    // This case proves the synchronous monotonic fence, not filesystem speed.
    // Hold only the unchanged 1000ms deadline timers, retaining the real outer
    // watchdog and drain timers. Existing elapsed-time timeout cases remain.
    t.mock.method(performance,'now',()=>clock);
    t.mock.method(global,'setTimeout',(fn,ms,...args)=>{
        if(ms!==1000)return schedule(fn,ms,...args);
        deadlineTimers++;const timer=schedule(()=>{},3600000);timer.unref();held.add(timer);return timer;
    });
    t.mock.method(global,'clearTimeout',timer=>{held.delete(timer);return cancel(timer);});
    t.after(()=>{for(const timer of held)cancel(timer);});
    const f=await fixture(t,{now:()=>clock,timingGate:{validate:m=>{
        gateCalls++;assert.equal(clock,0);const result=gate.validate(m);clock=1000;return result;
    }}},{timeoutMs:1000}),m=source();
    await f.publish(m);
    assert.equal((await guarded(f.coordinator.prepareSelection(m.identityTuple))).code,'COORDINATOR_TIMEOUT');
    await until(()=>!f.coordinator.snapshot().busy);
    assert.equal(gateCalls,1,'must reach the intended synchronous validation boundary');
    assert.ok(deadlineTimers>=2,'original coordinator and reader deadlines were armed');
    assert.equal((await f.head()).state.feeds[0].selections.length,0);
    assert.equal(f.coordinator.snapshot().lastPrepared,null);
});

test("owns tuple and options before first await; getters rejected without running", async t => {
    let calls = 0;
    const f = await fixture(t), m = source();
    await f.publish(m);
    const owned = [ ...m.identityTuple ], pending = f.coordinator.prepareSelection(owned);
    owned[1] = "CHANGED";
    assert.equal((await pending).code, "CONTENT_PREPARED");
    const raw = {
        ...f.config
    };
    Object.defineProperty(raw, "sourceRoot", {
        enumerable: true,
        get() {
            calls++;
            return f.config.sourceRoot;
        }
    });
    assert.throws(() => createExchangeSourceCoordinator(raw));
    assert.equal(calls, 0);
    const opts = {};
    Object.defineProperty(opts, "signal", {
        enumerable: true,
        get() {
            calls++;
            return undefined;
        }
    });
    assert.throws(() => f.coordinator.prepareSelection(m.identityTuple, opts));
    assert.equal(calls, 0);
});

test("incomplete and invalid metadata preserve prepared content and only valid metadata receives fact", async t => {
    const f = await fixture(t), m = source();
    await f.publish(m);
    const first = await f.coordinator.prepareSelection(m.identityTuple);
    const next = copy(m);
    next.generationSequence = 2;
    next.manifestState = "incomplete";
    next.occurrences[0].assetKey = null;
    next.occurrences[0].problem = {
        code: "MISSING_FILE",
        detail: "not_found",
        occurrenceKey: next.occurrences[0].occurrenceKey
    };
    next.problems = [ copy(next.occurrences[0].problem) ];
    seal(next);
    await f.publish(next);
    const incomplete = await f.coordinator.prepareSelection(next.identityTuple);
    assert.equal(incomplete.code, "METADATA_ACCEPTED");
    assert.equal(incomplete.contentPrepared, false);
    assert.equal((await f.head()).state.feeds[0].selections[0].sequence, 2);
    const bad = copy(m);
    bad.generationSequence = 3;
    seal(bad);
    bad.assets[0].unexpected = true;
    await f.publish(bad);
    assert.equal((await f.coordinator.prepareSelection(bad.identityTuple)).code, "METADATA_SCHEMA_INVALID");
    assert.equal((await f.head()).state.feeds[0].selections[0].sequence, 2);
    assert.equal(f.coordinator.snapshot().lastPrepared.snapshotDir, first.prepared.snapshotDir);
});

test("current structural failure blocks manifest fact despite transport success", async t => {
    const f = await fixture(t), m = source(), published = await f.publish(m);
    const current = {
        ...fixtures().current
    };
    for (const key of Object.keys(current)) if (Object.hasOwn(published.entry, key)) current[key] = published.entry[key];
    current.extra = "invalid";
    await f.write("selections/" + m.selectionId + "/current.json", current);
    assert.equal((await f.coordinator.prepareSelection(m.identityTuple)).code, "METADATA_SCHEMA_INVALID");
    assert.equal((await f.head()).state.feeds[0].selections.length, 0);
});

test("changed image bytes stage a distinct UUID and retain old cache", async t => {
    const f = await fixture(t), one = source();
    await f.publish(one);
    const a = await f.coordinator.prepareSelection(one.identityTuple);
    const blobs = [ image("png", 125), image("jpeg", 125) ], two = source(blobs);
    two.generationSequence = 2;
    seal(two);
    await f.publish(two, {
        assets: false
    });
    for (let i = 0; i < two.assets.length; i++) await f.write(two.assets[i].deliveryPath, blobs[i]);
    const b = await f.coordinator.prepareSelection(two.identityTuple);
    assert.equal(b.code, "CONTENT_PREPARED");
    assert.equal(b.mediaChanged, true);
    assert.notEqual(b.prepared.snapshotDir, a.prepared.snapshotDir);
    await fs.access(a.prepared.snapshotDir);
});

test("reader logical failure before physical drain retains coordinator slot", {
    timeout: 1e4
}, async t => {
    let busy = true, closed = false;
    const entered = latch();
    const f = await fixture(t, {
        catalogReader: () => ({
            captureCatalog: async () => {
                entered.release();
                return {
                    ok: false,
                    code: "CAPTURE_TIMEOUT"
                };
            },
            snapshot: () => ({
                busy: busy
            }),
            close: () => {
                closed = true;
            }
        })
    }), m = source();
    const pending = f.coordinator.prepareSelection(m.identityTuple);
    await guarded(entered.promise);
    assert.equal((await f.coordinator.prepareSelection(m.identityTuple)).code, "COORDINATOR_BUSY");
    busy = false;
    assert.equal((await guarded(pending)).code, "CAPTURE_TIMEOUT");
    assert.equal(closed, true);
    assert.equal(f.coordinator.snapshot().busy, false);
    assert.equal(f.coordinator.snapshot().lastPrepared, null);
});

test("changed catalog between independent and combined capture journals second same-byte receipt", async t => {
    const {
        createExchangeMetadataReader
    } = require("../scripts/lib/exchange-metadata-reader.cjs");
    let update;
    const f = await fixture(t, {
        selectedReader: options => {
            const reader = createExchangeMetadataReader(options);
            return {
                captureWithCatalogReceipt: async () => {
                    await update();
                    return reader.captureWithCatalogReceipt();
                },
                snapshot: reader.snapshot,
                close: reader.close
            };
        }
    }), m = source();
    await f.publish(m);
    update = () => f.publish(m, {
        sequence: 2
    });
    const r = await f.coordinator.prepareSelection(m.identityTuple);
    assert.equal(r.code, "CONTENT_PREPARED");
    assert.equal((await f.head()).state.feeds[0].catalog.sequence, 2);
    assert.equal(f.coordinator.snapshot().lastAccepted.catalogReceipt.catalogSequence, 2);
});

test("final active check rejects a stager returning after original deadline", {
    timeout: 1e4
}, async t => {
    let clock = 0;
    const f = await fixture(t, {
        now: () => clock,
        stage: async r => {
            const prepared = await stageExchangeSnapshot(r);
            clock = 1e3;
            return prepared;
        }
    }, {
        timeoutMs: 1e3
    }), m = source();
    await f.publish(m);
    assert.equal((await guarded(f.coordinator.prepareSelection(m.identityTuple))).code, "COORDINATOR_TIMEOUT");
    await until(() => !f.coordinator.snapshot().busy);
    assert.equal(f.coordinator.snapshot().lastPrepared, null);
    assert.equal((await f.head()).state.feeds[0].selections.length, 1);
});

test("inconsistent physical aliases reject metadata before manifest fact even with missing assets", async t => {
    const f = await fixture(t), m = source();
    // Two distinct asset rows can point at the same delivery. Its declared physical
    // metadata must agree, regardless of whether any actual bytes have arrived.
    const alias = copy(m.assets[0]);
    alias.assetKey = m.assets[1].assetKey;
    alias.width = 3;
    m.assets[1] = alias;
    seal(m);
    await f.publish(m, {
        assets: false
    });
    const r = await f.coordinator.prepareSelection(m.identityTuple);
    assert.equal(r.code, "ASSET_PLAN_ALIAS_MISMATCH");
    assert.equal(r.acceptedMetadata, false);
    assert.equal(r.contentPrepared, false);
    const head = await f.head();
    assert.equal(head.state.feeds[0].catalog.sequence, 1);
    assert.equal(head.state.feeds[0].selections.length, 0);
    assert.equal(f.coordinator.snapshot().lastPrepared, null);
});

test("metadata-only cache tamper fails verified reuse without staging and drops the refused pointer", async t => {
    let stages = 0, loads = 0;
    const f = await fixture(t, {
        stage: async r => {
            stages++;
            return stageExchangeSnapshot(r);
        },
        load: async (...args) => {
            loads++;
            return loadExchangeSnapshot(...args);
        }
    }), m = source();
    await f.publish(m);
    const first = await f.coordinator.prepareSelection(m.identityTuple);
    assert.equal(first.code, "CONTENT_PREPARED");
    const cached = path.join(first.prepared.snapshotDir, first.prepared.manifest.files[0].src);
    await fs.writeFile(cached, Buffer.from("corrupt"));
    const next = copy(m);
    next.generationSequence = 2;
    next.sourceTicks.onBoardAll = true;
    seal(next);
    await f.publish(next, {
        assets: false
    });
    await fs.rm(path.join(f.config.sourceRoot, "assets"), {
        recursive: true
    });
    const r = await f.coordinator.prepareSelection(next.identityTuple);
    assert.equal(r.ok, false);
    assert.equal(r.contentPrepared, false);
    assert.equal(r.ready, false);
    assert.equal(r.acceptedMetadata, true);
    assert.equal(stages, 1);
    assert.equal(loads, 1);
    // Q-007: the refused snapshot is dropped, never loaded again; the next
    // preparation stages from the source (absent here, so it fails too).
    assert.equal(f.coordinator.snapshot().lastPrepared, null);
    assert.equal((await f.head()).state.feeds[0].selections[0].sequence, 2);
    const again = await f.coordinator.prepareSelection(next.identityTuple);
    assert.equal(again.ok, false);
    assert.equal(again.contentPrepared, false);
    assert.equal(stages, 2);
    assert.equal(loads, 1);
    assert.equal(f.coordinator.snapshot().lastPrepared, null);
});

test("ineligible complete content can cache with explicit false admission eligibility and readiness", async t => {
    const f = await fixture(t), m = source();
    m.event.eligibility = {
        eligible: false,
        reasonCodes: [ "CANCELLED" ]
    };
    seal(m);
    await f.publish(m);
    const r = await f.coordinator.prepareSelection(m.identityTuple);
    assert.equal(r.code, "CONTENT_PREPARED");
    assert.equal(r.contentPrepared, true);
    assert.equal(r.acceptedMetadata, true);
    assert.equal(r.admissionEligible, false);
    assert.equal(r.ready, false);
    assert.equal(r.scope, "source-preparation");
    assert.equal(r.operatorConfirmationRequired, true);
    assert.equal(r.timingProposal.operatorConfirmationRequired, true);
});

test("constructor rejects out-of-range timeout without changing reader minimum", async t => {
    const f = await fixture(t);
    for (const timeoutMs of [ 9, 60001 ]) assert.throws(() => createExchangeSourceCoordinator({
        ...f.config,
        timeoutMs: timeoutMs
    }), {
        code: "COORDINATOR_OPTIONS_INVALID"
    });
    for (const timeoutMs of [ 10, 6e4 ]) {
        const coordinator = createExchangeSourceCoordinator({
            ...f.config,
            timeoutMs: timeoutMs
        });
        assert.equal(coordinator.snapshot().busy, false);
        coordinator.close();
    }
});

test("missing journal and wrong retained store ID cannot initialize, rebind, read source or stage", async t => {
    for (const kind of [ "missing", "wrong-store" ]) {
        let reads = 0, stages = 0;
        const f = await fixture(t), m = source();
        await f.publish(m);
        const config = kind === "missing" ? {
            ...f.config,
            journalDir: path.join(f.parent, "missing-journal")
        } : {
            ...f.config,
            storeId: crypto.randomUUID()
        };
        const coordinator = createExchangeSourceCoordinator(config, {
            catalogReader: () => {
                reads++;
                throw Error("SOURCE_MUST_NOT_OPEN");
            },
            selectedReader: () => {
                reads++;
                throw Error("SOURCE_MUST_NOT_OPEN");
            },
            stage: () => {
                stages++;
                throw Error("MUST_NOT_STAGE");
            }
        });
        t.after(() => coordinator.close());
        const before = await f.head(), r = await coordinator.prepareSelection(m.identityTuple);
        assert.equal(r.code, kind === "missing" ? "JOURNAL_MISSING" : "JOURNAL_INVALID");
        assert.equal(r.ready, false);
        assert.equal(reads, 0);
        assert.equal(stages, 0);
        assert.equal(coordinator.snapshot().lastPrepared, null);
        assert.equal((await f.head()).headSha256, before.headSha256);
        if (kind === "missing") await assert.rejects(fs.stat(config.journalDir), {
            code: "ENOENT"
        });
    }
});

test("refreshCatalog accepts independent metadata without selected manifest or assets", async t => {
    let stages = 0, loads = 0;
    const f = await fixture(t, {
        stage: () => {
            stages++;
            throw Error("MUST_NOT_STAGE");
        },
        load: () => {
            loads++;
            throw Error("MUST_NOT_LOAD");
        }
    });
    const m = source();
    await f.publish(m, {
        manifest: false,
        current: false,
        assets: false
    });
    const result = await f.coordinator.refreshCatalog();
    assert.equal(result.code, "CATALOG_ACCEPTED");
    assert.equal(result.acceptedMetadata, true);
    assert.equal(result.contentPrepared, false);
    assert.equal(result.ready, false);
    assert.equal(result.catalogReceipt.catalogSequence, 1);
    const head = await f.head();
    assert.equal(head.state.feeds[0].catalog.sequence, 1);
    assert.equal(head.state.feeds[0].selections.length, 0);
    assert.equal(stages, 0);
    assert.equal(loads, 0);
    assert.equal(f.coordinator.snapshot().lastPrepared, null);
});

test("inspectSelection accepts complete metadata with missing assets without stage or load", async t => {
    let stages = 0, loads = 0;
    const f = await fixture(t, {
        stage: () => {
            stages++;
            throw Error("MUST_NOT_STAGE");
        },
        load: () => {
            loads++;
            throw Error("MUST_NOT_LOAD");
        }
    });
    const m = source();
    await f.publish(m, {
        assets: false
    });
    const result = await f.coordinator.inspectSelection(m.identityTuple);
    assert.equal(result.code, "METADATA_ACCEPTED");
    assert.equal(result.acceptedMetadata, true);
    assert.equal(result.manifestState, "complete");
    assert.equal(result.contentPrepared, false);
    assert.equal(result.ready, false);
    assert.equal(result.timingProposal.operatorConfirmationRequired, true);
    const head = await f.head();
    assert.equal(head.state.feeds[0].catalog.sequence, 1);
    assert.equal(head.state.feeds[0].selections[0].sequence, 1);
    assert.equal(stages, 0);
    assert.equal(loads, 0);
    assert.equal(f.coordinator.snapshot().lastPrepared, null);
});

// Contract 0.3.1, section 5.6: total bytes count each distinct picture (SHA-256) once.
// The publisher emits one asset row per source file, so identical bytes in several
// files arrive as several rows with one SHA-256. Actual source bytes deliberately do
// not exist: the plan check runs before any asset I/O.
function budgetManifest(sizes, copies) {
    const m = source();
    const template = copy(m.assets[0]);
    m.assets = [];
    sizes.forEach((size, n) => {
        const sha = crypto.createHash("sha256").update("synthetic-budget-" + n).digest("hex");
        for (let k = 0; k < copies; k++) m.assets.push({
            ...copy(template),
            assetKey: "a" + (m.assets.length + 1),
            mimeType: "image/png",
            deliveryPath: "assets/" + sha + ".png",
            byteLength: size,
            sha256: sha
        });
    });
    m.occurrences = m.assets.map((a, i) => ({
        position: i + 1,
        occurrenceKey: "budget-row-" + i,
        fileKey: "BUDGET-" + i,
        assetKey: a.assetKey,
        problem: null,
        sourceName: "Synthetic",
        lineage: null
    }));
    return seal(m);
}

async function budgetResult(t, m) {
    const {
        createExchangeSchemaGate
    } = require("../scripts/lib/exchange-schema-gate.cjs");
    const {
        createExchangeTimingGate
    } = require("../scripts/lib/exchange-timing.cjs");
    let stages = 0;
    const f = await fixture(t, {
        stage: () => {
            stages++;
            throw Error("BUDGET_TEST_STOPS_AT_STAGE");
        }
    });
    assert.equal(createExchangeSchemaGate().validate("selection", m).ok, true);
    assert.equal(createExchangeTimingGate().validate(m).ok, true);
    await f.publish(m, {
        assets: false
    });
    const result = await f.coordinator.prepareSelection(m.identityTuple);
    return {result, stages, f};
}

test("repeated identical bytes count once toward the total-bytes plan limit", async t => {
    const max = 536870912, big = 20971520;
    // 26 rows of one 20 MiB picture: 520 MiB of rows, 20 MiB of distinct pictures.
    const same = await budgetResult(t, budgetManifest([ big ], 26));
    assert.notEqual(same.result.code, "ASSET_PLAN_LIMIT");
    assert.equal(same.stages, 1);
    // 26 distinct pictures, each in two rows, totalling exactly the limit: allowed.
    const exact = Array(25).fill(big).concat(max - 25 * big);
    const under = await budgetResult(t, budgetManifest(exact, 2));
    assert.notEqual(under.result.code, "ASSET_PLAN_LIMIT");
    assert.equal(under.stages, 1);
    // One byte more on one distinct picture: refused before any fact or stage.
    const over = await budgetResult(t, budgetManifest(exact.slice(0, 25).concat(max - 25 * big + 1), 2));
    assert.equal(over.result.code, "ASSET_PLAN_LIMIT");
    assert.equal(over.result.acceptedMetadata, false);
    assert.equal(over.result.contentPrepared, false);
    assert.equal(over.stages, 0);
    const head = await over.f.head();
    assert.equal(head.state.feeds[0].catalog.sequence, 1);
    assert.equal(head.state.feeds[0].selections.length, 0);
    assert.equal(over.f.coordinator.snapshot().lastPrepared, null);
});

test("source journal overlap rejects before facts and preserves source and initialized journal", async t => {
    const f = await fixture(t), m = source();
    await f.publish(m);
    const journal = createExchangeJournal();
    const nestedDir = path.join(f.config.sourceRoot, "nested-journal"), storeId = crypto.randomUUID();
    let head = await journal.initialize(nestedDir, storeId);
    head = await journal.append(nestedDir, {
        expectedStoreId: storeId,
        expectedRevision: head.revision,
        expectedHeadSha256: head.headSha256,
        event: {
            type: "confirm-binding",
            expectedRevision: head.revision,
            confirm: true,
            expectedBinding: null,
            binding: f.config.binding
        }
    });
    assert.equal(head.ok, true);
    const feedBefore = await fs.readFile(path.join(f.config.sourceRoot, "feed.json"));
    const catalogBefore = await fs.readFile(path.join(f.config.sourceRoot, "catalog.json"));
    let candidate;
    try {
        candidate = createExchangeSourceCoordinator({
            ...f.config,
            journalDir: nestedDir,
            storeId: storeId
        });
        // Before the fix, this real request appends a catalog fact to the
        // source-owned tree. Retain the failed regression rather than only
        // testing a lexical helper that could hide the actual write.
        await candidate.refreshCatalog();
    } catch (error) {
        assert.equal(error.code, "COORDINATOR_ROOTS_OVERLAP");
    } finally {
        candidate?.close();
    }
    const after = await journal.open(nestedDir, storeId);
    assert.equal(after.revision, head.revision, "no fact may be written under source");
    assert.equal(after.headSha256, head.headSha256);
    assert.deepEqual(await fs.readFile(path.join(f.config.sourceRoot, "feed.json")), feedBefore);
    assert.deepEqual(await fs.readFile(path.join(f.config.sourceRoot, "catalog.json")), catalogBefore);
    assert.throws(() => createExchangeSourceCoordinator({
        ...f.config,
        journalDir: f.config.sourceRoot
    }), {
        code: "COORDINATOR_ROOTS_OVERLAP"
    });
    assert.throws(() => createExchangeSourceCoordinator({
        ...f.config,
        journalDir: f.parent
    }), {
        code: "COORDINATOR_ROOTS_OVERLAP"
    });
    assert.throws(() => createExchangeSourceCoordinator({
        ...f.config,
        cacheDir: f.config.sourceRoot
    }), {
        code: "COORDINATOR_ROOTS_OVERLAP"
    });
    assert.throws(() => createExchangeSourceCoordinator({
        ...f.config,
        cacheDir: path.join(f.config.sourceRoot, "cache")
    }), {
        code: "COORDINATOR_ROOTS_OVERLAP"
    });
    assert.throws(() => createExchangeSourceCoordinator({
        ...f.config,
        cacheDir: f.parent
    }), {
        code: "COORDINATOR_ROOTS_OVERLAP"
    });
});

test("missing source returns fixed safe failure before source read or journal append", async t => {
    let reads = 0, stages = 0;
    const f = await fixture(t);
    const before = await f.head();
    const coordinator = createExchangeSourceCoordinator({
        ...f.config,
        sourceRoot: path.join(f.parent, "missing-source")
    }, {
        catalogReader: () => {
            reads++;
            throw Error("MUST_NOT_READ");
        },
        stage: () => {
            stages++;
            throw Error("MUST_NOT_STAGE");
        }
    });
    t.after(() => coordinator.close());
    const result = await coordinator.refreshCatalog();
    assert.equal(result.code, "SOURCE_UNAVAILABLE");
    assert.equal(result.ready, false);
    assert.equal(reads, 0);
    assert.equal(stages, 0);
    assert.equal((await f.head()).headSha256, before.headSha256);
});

test("actual canonical root alias rejects before catalog append", async t => {
    const f = await fixture(t), m = source();
    await f.publish(m);
    const nestedDir = path.join(f.config.sourceRoot, "canonical-journal");
    const journal = createExchangeJournal(), storeId = crypto.randomUUID();
    let before = await journal.initialize(nestedDir, storeId);
    before = await journal.append(nestedDir, {
        expectedStoreId: storeId,
        expectedRevision: before.revision,
        expectedHeadSha256: before.headSha256,
        event: {
            type: "confirm-binding",
            expectedRevision: before.revision,
            expectedBinding: null,
            binding: f.config.binding,
            confirm: true
        }
    });
    const alias = path.join(f.parent, "source-alias");
    // A real directory alias keeps lexical paths disjoint while realpath
    // identifies the source ancestor. Windows junctions need no symlink grant.
    await fs.symlink(f.config.sourceRoot, alias, "junction");
    t.after(() => fs.rm(alias, {
        force: true
    }));
    const coordinator = createExchangeSourceCoordinator({
        ...f.config,
        sourceRoot: alias,
        journalDir: nestedDir,
        storeId: storeId
    });
    t.after(() => coordinator.close());
    assert.equal((await coordinator.refreshCatalog()).code, "COORDINATOR_ROOTS_OVERLAP");
    assert.equal((await journal.open(nestedDir, storeId)).headSha256, before.headSha256);
});

test("lexical source/cache and source/journal overlap reject in both directions", async t => {
    const f = await fixture(t);
    for (const root of [ "cacheDir", "journalDir" ]) {
        for (const destination of [ f.config.sourceRoot, path.join(f.config.sourceRoot, "child"), f.parent ]) {
            assert.throws(() => createExchangeSourceCoordinator({
                ...f.config,
                [root]: destination
            }), {
                code: "COORDINATOR_ROOTS_OVERLAP"
            });
        }
    }
});

test("selected admission requires current and rejects catalog ahead while retaining prepared cache", async t => {
    for (const kind of [ "missing-current", "catalog-ahead" ]) {
        const f = await fixture(t), one = source();
        const published = await f.publish(one);
        const prepared = await f.coordinator.prepareSelection(one.identityTuple);
        assert.equal(prepared.code, "CONTENT_PREPARED");
        const two = copy(one);
        two.generationSequence = 2;
        two.sourceTicks.onBoardAll = true;
        seal(two);
        await f.publish(two);
        const currentPath = "selections/" + one.selectionId + "/current.json";
        if (kind === "missing-current") {
            await fs.unlink(path.join(f.config.sourceRoot, currentPath));
        } else {
            const current = {
                ...fixtures().current
            };
            for (const key of Object.keys(current)) if (Object.hasOwn(published.entry, key)) current[key] = published.entry[key];
            await f.write(currentPath, current);
        }
        const result = await f.coordinator.prepareSelection(two.identityTuple);
        assert.equal(result.code, "DESCRIPTOR_CONTEXT_INVALID", kind);
        assert.equal(result.acceptedMetadata, false);
        assert.equal(result.contentPrepared, false);
        assert.equal(result.ready, false);
        const head = await f.head();
        assert.equal(head.state.feeds[0].catalog.sequence, 2, "independent catalog fact remains accepted");
        assert.equal(head.state.feeds[0].selections[0].sequence, 1, "invalid descriptor context creates no manifest fact");
        assert.equal(f.coordinator.snapshot().lastPrepared, prepared.prepared);
        assert.equal(f.coordinator.snapshot().lastAccepted.manifest.generationSequence, 1);
        await fs.access(prepared.prepared.snapshotDir);
    }
});
