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

module.exports={fixture,source,image,seal,copy,wait,until,latch,guarded};

const {createExchangeSourceProvider}=require('../scripts/lib/exchange-source-provider.cjs');
function profileFor(f,m){return {schemaVersion:1,provider:'exchange-v1',eventId:'approved-engine-selection',productionWindow:{start:'2026-11-17T00:00:00Z',end:'2026-11-17T23:00:00Z',prewarmMinutes:15},spx:{executable:process.execPath,args:[],cwd:f.parent},caspar:{executable:process.execPath,cwd:f.parent,runtimeDir:path.join(f.parent,'runtime')},media:{provider:'exchange-ordered-v1',providerId:'approved-feed',binding:{...f.config.binding},identityTuple:[...m.identityTuple],cacheDir:f.config.cacheDir,startup:{mode:'source'}},rossTalk:{allowedSenders:['127.0.0.1'],commandMap:{1:'launch',5:'reload',8:'stop'}}};}
function providerFor(t,f,trusted={}){const provider=createExchangeSourceProvider({providerId:'approved-feed',...f.config},{createCoordinator:()=>f.coordinator,...trusted});t.after(()=>provider.close());return provider;}

Object.assign(module.exports,{profileFor,providerFor});
