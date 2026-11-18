'use strict';
// Trusted backend bridge only. No automatic journal setup, source writes or arming.

const fs = require('node:fs/promises');
const {createHash} = require('node:crypto');
const {createExchangeCatalogView} = require('./exchange-catalog-view.cjs');

const path = require('node:path');

const {
    performance
} = require('node:perf_hooks');

const {
    createExchangeSourceCoordinator
} = require('./exchange-source-coordinator.cjs');

const {
    createExchangeJournal
} = require('./exchange-journal.cjs');

const {
    loadExchangeSnapshot
} = require('./exchange-snapshot.cjs');

const {
    canonicalExchangeJSON,
    selectionId
} = require('./exchange-fingerprints.cjs');

const {
    normalizePreparedEventProfile
} = require('./prepared-event-profile.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const drivers = new WeakMap(), tokens = new WeakMap(), owners = new Map(), issued = new WeakMap();

const EXCHANGE_SOURCE_BUDGETS = Object.freeze({
    operationTimeoutMs: 11e4,
    resolverTimeoutMs: 12e4,
    prepareTimeoutMs: 6e4
});

function fail(code) {
    throw Object.assign(Error(code), {
        code: code
    });
}

function fields(v, allowed, required = allowed) {
    if (!v || ![ Object.prototype, null ].includes(Object.getPrototypeOf(v))) fail('PROVIDER_OPTIONS_INVALID');
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (required.some(k => !Object.hasOwn(descriptors, k)) || Reflect.ownKeys(descriptors).some(k => typeof k !== 'string' || !allowed.includes(k) || !descriptors[k].enumerable || !Object.hasOwn(descriptors[k], 'value'))) fail('PROVIDER_OPTIONS_INVALID');
}

function freeze(v) {
    if (v && typeof v === 'object') {
        Object.values(v).forEach(freeze);
        Object.freeze(v);
    }
    return v;
}

function comparable(v) {
    return process.platform === 'win32' ? v.toLowerCase() : v;
}

function contains(a, b) {
    const rel = path.relative(comparable(a), comparable(b));
    return rel === '' || !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep);
}

function overlap(a, b) {
    return contains(a, b) || contains(b, a);
}

function absolute(v) {
    return typeof v === 'string' && v.length <= 4096 && !/[\x00-\x1f\x7f]/.test(v) && path.isAbsolute(v) && path.resolve(v) === v;
}

function ownTuple(v) {
    const owned = JSON.parse(canonicalExchangeJSON(v));
    if (!Array.isArray(owned) || owned.length !== 5 || owned.some((x, i) => typeof x !== 'string' || Array.from(x).length > [ 9, 64, 64, 6, 200 ][i] || /[\x00-\x1f\x7f]/.test(x)) || !/^\d{4}-\d{4}$/.test(owned[0]) || !owned[1] || ![ 'event', 'season' ].includes(owned[3]) || !owned[4] || owned[3] === 'season' && !owned[2]) fail('PROVIDER_OPTIONS_INVALID');
    return freeze(owned);
}

function keyOf(profile) {
    return canonicalExchangeJSON(normalizePreparedEventProfile(profile));
}

function permitted(fn, arg) {
    try {
        const value = fn(arg);
        if (value && typeof value.then === 'function') Promise.resolve(value).catch(() => {});
        return value === true;
    } catch {
        return false;
    }
}

async function canonical(file) {
    let cursor = file;
    const tail = [];
    for (;;) {
        try {
            return path.join(await fs.realpath(cursor), ...tail.reverse());
        } catch (e) {
            if (e.code !== 'ENOENT') throw e;
            const parent = path.dirname(cursor);
            if (parent === cursor) throw e;
            tail.push(path.basename(cursor));
            cursor = parent;
        }
    }
}

async function noLinksFuture(file) {
    let cursor = path.parse(file).root;
    for (const part of path.relative(cursor, file).split(path.sep).filter(Boolean)) {
        cursor = path.join(cursor, part);
        let stat;
        try {
            stat = await fs.lstat(cursor);
        } catch (e) {
            if (e.code === 'ENOENT') return;
            throw e;
        }
        if (stat.isSymbolicLink() || !stat.isDirectory()) fail('PROVIDER_ROOTS_OVERLAP');
    }
}

function isExchangePreparedMedia(driver, profile) {
    try {
        const value = drivers.get(driver);
        return !!value && !value.closed && value.key === keyOf(profile);
    } catch {
        return false;
    }
}

function admitExchangeCandidate(token, expectedProfile) {
    try {
        const value = tokens.get(token);
        return !!value && (expectedProfile === undefined || value.key === keyOf(expectedProfile)) && value.check() === true;
    } catch {
        return false;
    }
}

function createExchangeSourceProvider(raw, trusted = {}) {
    fields(raw, [ 'providerId', 'sourceRoot', 'cacheDir', 'journalDir', 'storeId', 'binding', 'timeoutMs' ], [ 'providerId', 'sourceRoot', 'cacheDir', 'journalDir', 'storeId', 'binding' ]);
    fields(raw.binding, [ 'feedId', 'epoch' ]);
    fields(trusted, [ 'createCoordinator', 'journal', 'load', 'now' ], []);
    const c = {
        ...raw,
        binding: {
            ...raw.binding
        },
        timeoutMs: raw.timeoutMs ?? 6e4
    };
    if (typeof c.providerId !== 'string' || c.providerId.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.providerId) || ![ 'sourceRoot', 'cacheDir', 'journalDir' ].every(k => absolute(c[k])) || typeof c.storeId !== 'string' || !UUID.test(c.storeId) || typeof c.binding.feedId !== 'string' || !UUID.test(c.binding.feedId) || !Number.isSafeInteger(c.binding.epoch) || c.binding.epoch < 1 || c.binding.epoch > 999999 || !Number.isSafeInteger(c.timeoutMs) || c.timeoutMs < 10 || c.timeoutMs > 6e4) fail('PROVIDER_OPTIONS_INVALID');
    freeze(c);
    if (overlap(c.sourceRoot, c.cacheDir) || overlap(c.sourceRoot, c.journalDir) || overlap(c.cacheDir, c.journalDir)) fail('PROVIDER_ROOTS_OVERLAP');
    // One owner per configured private boundary; do not reopen around an orphan.
    const ownerKeys = [ c.sourceRoot, c.journalDir, c.cacheDir ].map(comparable);
    if (ownerKeys.some(key => [ ...owners.keys() ].some(old => overlap(key, old)))) fail('PROVIDER_ALREADY_OPEN');
    const owner = {};
    ownerKeys.forEach(key => owners.set(key, owner));
    const journal = trusted.journal ?? createExchangeJournal(), load = trusted.load ?? loadExchangeSnapshot, now = trusted.now ?? (() => performance.now());
    const factory = trusted.createCoordinator ?? createExchangeSourceCoordinator;
    let coordinator = null, closed = false, slot = null, bindingValid = true, version = 0, catalogView = null, catalogAttempt = 0;
    const observations = new Map(), registeredSelections = new Set();
    function release() {
        if (closed && !slot) for (const key of ownerKeys) if (owners.get(key) === owner) owners.delete(key);
    }
    async function claimCanonicalPrivateRoots(active) {
        // Local roots can be resolved even for offline construction. This also
        // prevents a second configured alias from running around a live owner.
        const roots=await Promise.all([c.cacheDir,c.journalDir].map(canonical));active();
        for(const root of roots)for(const [key,value]of owners)if(value!==owner&&overlap(root,key))fail('PROVIDER_ALREADY_OPEN');
        for(const root of roots){const key=comparable(root);owners.set(key,owner);if(!ownerKeys.includes(key))ownerKeys.push(key);}
    }
    function coor() {
        if (!coordinator) coordinator = factory({
            sourceRoot: c.sourceRoot,
            cacheDir: c.cacheDir,
            journalDir: c.journalDir,
            storeId: c.storeId,
            binding: c.binding,
            timeoutMs: c.timeoutMs
        });
        return coordinator;
    }
    async function drain() {
        while (coordinator?.snapshot().busy) await new Promise(resolve => setTimeout(resolve, 5));
    }
    function record(tuple, pin, healthy) {
        if (!observations.has(selectionId(tuple)) && observations.size >= 2048) fail('PROVIDER_CAPACITY_EXCEEDED');
        const observation = freeze({
            version: ++version,
            healthy: healthy,
            eligible: healthy && pin.manifest.event.eligibility.eligible === true,
            pin: healthy ? pin : null
        });
        observations.set(selectionId(tuple), observation);
        return observation;
    }
    async function checkJournal(active) {
        const head = await journal.open(c.journalDir, c.storeId);
        active();
        if (!head.ok) {
            bindingValid = false;
            fail(head.code);
        }
        if (!head.state.binding || head.state.binding.feedId !== c.binding.feedId || head.state.binding.epoch !== c.binding.epoch) {
            bindingValid = false;
            fail('JOURNAL_BINDING_MISMATCH');
        }
        bindingValid = true;
    }
    function operation(owner, signal, work) {
        if (signal !== undefined && !(signal instanceof AbortSignal)) fail('PROVIDER_OPTIONS_INVALID');
        if (closed || owner?.closed) return Promise.reject(Object.assign(Error('PROVIDER_CLOSED'), {
            code: 'PROVIDER_CLOSED'
        }));
        if (slot) return Promise.reject(Object.assign(Error('BUSY'), {
            code: 'BUSY'
        }));
        if (signal?.aborted) return Promise.reject(Object.assign(Error('PROVIDER_ABORTED'), {
            code: 'PROVIDER_ABORTED'
        }));
        const run = {
            owner: owner,
            abort: new AbortController(),
            deadline: now() + EXCHANGE_SOURCE_BUDGETS.operationTimeoutMs,
            timedOut: false
        };
        slot = run;
        const onAbort = () => run.abort.abort();
        signal?.addEventListener('abort', onAbort, {
            once: true
        });
        const timer = setTimeout(() => {
            run.timedOut = true;
            run.abort.abort();
        }, EXCHANGE_SOURCE_BUDGETS.operationTimeoutMs);
        function active() {
            if (now() >= run.deadline) {
                run.timedOut = true;
                run.abort.abort();
            }
            if (run.abort.signal.aborted || closed || owner?.closed) fail(run.timedOut ? 'PROVIDER_TIMEOUT' : closed || owner?.closed ? 'PROVIDER_CLOSED' : 'PROVIDER_ABORTED');
        }
        return (async () => {
            try {
                active();
                await claimCanonicalPrivateRoots(active);
                const value = await work(run, active);
                active();
                return value;
            } catch (error) {
                fail(typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : 'PROVIDER_FAILED');
            } finally {
                // Logical coordinator timeout/cancel can precede close/decoder cleanup.
                await drain();
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                if (slot === run) slot = null;
                release();
            }
        })();
    }
    async function observe(tuple, method, run, active) {
        let result;
        try {
            result = await coor()[method](tuple, {
                signal: run.abort.signal
            });
            await drain();
            active();
        } catch (error) {
            record(tuple, null, false);
            throw error;
        }
        if (!result.acceptedMetadata) {
            record(tuple, null, false);
            if (/JOURNAL|REBIND/.test(result.code)) bindingValid = false;
            fail(result.code);
        }
        const pin = coordinator.snapshot().lastAccepted;
        if (!pin?.manifest || selectionId(tuple) !== pin.manifest.selectionId) {
            record(tuple, null, false);
            fail('PROVIDER_CAPTURE_INVALID');
        }
        const observation = record(tuple, pin, true);
        bindingValid = true;
        return {
            result: result,
            pin: pin,
            observation: observation
        };
    }
    async function verified(snapshotDir, profile, signal, active, expectedFingerprint) {
        const cache = await fs.realpath(c.cacheDir);
        active();
        const selected = await fs.realpath(snapshotDir);
        active();
        if (comparable(cache) === comparable(selected) || !contains(cache, selected)) fail('PROVIDER_CACHE_INVALID');
        const prepared = await load(snapshotDir, {
            signal: signal
        });
        active();
        const source = prepared?.manifest?.source;
        if (prepared?.manifest?.schemaVersion !== 2 || !source || source.feedId !== c.binding.feedId || source.epoch !== c.binding.epoch || source.selectionId !== selectionId(profile.media.identityTuple) || canonicalExchangeJSON(source.identityTuple) !== canonicalExchangeJSON(profile.media.identityTuple) || source.playbackFingerprint !== expectedFingerprint) fail('PROVIDER_CACHE_INVALID');
        return prepared;
    }
    function createPreparedMedia(rawProfile, options = {}) {
        fields(options, [ 'authorizeOffline' ], []);
        const authorizeOffline = options.authorizeOffline ?? (() => false);
        if (typeof authorizeOffline !== 'function') fail('PROVIDER_OPTIONS_INVALID');
        const profile = normalizePreparedEventProfile(rawProfile), m = profile.media;
        if (profile.provider !== 'exchange-v1' || m.providerId !== c.providerId || m.cacheDir !== c.cacheDir || m.binding.feedId !== c.binding.feedId || m.binding.epoch !== c.binding.epoch || overlap(profile.caspar.runtimeDir, c.sourceRoot) || overlap(profile.caspar.runtimeDir, c.journalDir)) fail('PROVIDER_PROFILE_MISMATCH');
        const registeredId = selectionId(m.identityTuple);
        if (!registeredSelections.has(registeredId) && registeredSelections.size >= 2048) fail('PROVIDER_CAPACITY_EXCEEDED');
        registeredSelections.add(registeredId);
        const state = {
            key: keyOf(profile),
            profile: profile,
            closed: false,
            prepared: null,
            offline: false,
            offlineVerified: false,
            admissionObservation: null
        };
        const offlineContext = freeze({
            providerId: c.providerId,
            storeId: c.storeId,
            eventId: profile.eventId,
            binding: {
                ...c.binding
            },
            identityTuple: [ ...m.identityTuple ],
            startup: {
                ...m.startup
            },
            productionWindow: {
                ...profile.productionWindow
            }
        });
        async function privatePaths(privateRoots, active) {
            if (!Array.isArray(privateRoots) || privateRoots.some(v => !absolute(v))) fail('PROVIDER_OPTIONS_INVALID');
            const configured = [ c.cacheDir, c.journalDir, profile.caspar.runtimeDir, ...privateRoots ];
            for (const root of configured) {
                await noLinksFuture(root);
                active();
            }
            const local = await Promise.all(configured.map(canonical));
            active();
            if (overlap(local[0], local[1]) || overlap(local[1], local[2]) || overlap(local[0], local[2])) fail('PROVIDER_ROOTS_OVERLAP');
            if (m.startup.mode === 'source') {
                const source = await fs.realpath(c.sourceRoot);
                active();
                for (const root of local) if (overlap(source, root)) fail('PROVIDER_ROOTS_OVERLAP');
            }
        }
        async function initial({
            signal,
            privateRoots = []
        } = {}) {
            state.prepared = null;
            state.offlineVerified = false;
            state.admissionObservation = null;
            return operation(state, signal, async (run, active) => {
                await privatePaths(privateRoots, active);
                await checkJournal(active);
                if (m.startup.mode === 'cached') {
                    if (!permitted(authorizeOffline, offlineContext)) fail('OFFLINE_AUTHORIZATION_REQUIRED');
                    const prepared = await verified(path.join(c.cacheDir, m.startup.snapshotId), profile, run.abort.signal, active, m.startup.playbackFingerprint);
                    if (!permitted(authorizeOffline, offlineContext)) fail('OFFLINE_AUTHORIZATION_REQUIRED');
                    state.offline = true;
                    state.offlineVerified = true;
                    state.prepared = prepared;
                    return prepared;
                }
                const captured = await observe(m.identityTuple, 'prepareSelection', run, active);
                if (!captured.result.contentPrepared || !captured.observation.eligible) fail('SOURCE_ADMISSION_DENIED');
                const prepared = await verified(captured.result.prepared.snapshotDir, profile, run.abort.signal, active, captured.pin.manifest.playbackFingerprint);
                state.offline = false;
                state.prepared = prepared;
                state.admissionObservation = captured.observation;
                return prepared;
            });
        }
        async function resolveReload({
            signal,
            acceptedSnapshot
        } = {}) {
            const previous=acceptedSnapshot?.manifest?.source;
            if(acceptedSnapshot?.manifest?.schemaVersion!==2||!absolute(acceptedSnapshot.snapshotDir)||!previous||previous.feedId!==c.binding.feedId||previous.epoch!==c.binding.epoch||previous.selectionId!==selectionId(m.identityTuple)||canonicalExchangeJSON(previous.identityTuple)!==canonicalExchangeJSON(m.identityTuple)||typeof previous.playbackFingerprint!=='string'||!/^[0-9a-f]{64}$/.test(previous.playbackFingerprint))fail('PROVIDER_CACHE_INVALID');
            return operation(state, signal, async (run, active) => {
                await checkJournal(active);
                const inspected = await observe(m.identityTuple, 'inspectSelection', run, active);
                const fingerprint = inspected.pin.manifest.playbackFingerprint;
                const old = acceptedSnapshot?.manifest?.source;
                // Actual accepted runtime content, not coordinator.lastPrepared, owns Reload.
                if (old?.playbackFingerprint === fingerprint) {
                    return verified(acceptedSnapshot.snapshotDir, profile, run.abort.signal, active, fingerprint);
                }
                if (!inspected.observation.eligible || inspected.pin.manifest.manifestState !== 'complete') fail('SOURCE_ADMISSION_DENIED');
                const captured = await observe(m.identityTuple, 'prepareSelection', run, active);
                const freshFingerprint = captured.pin.manifest.playbackFingerprint;
                if (old?.playbackFingerprint === freshFingerprint) return verified(acceptedSnapshot.snapshotDir, profile, run.abort.signal, active, freshFingerprint);
                if (!captured.result.contentPrepared || !captured.observation.eligible) fail('SOURCE_ADMISSION_DENIED');
                const prepared = await verified(captured.result.prepared.snapshotDir, profile, run.abort.signal, active, freshFingerprint);
                issued.set(prepared, {
                    state: state,
                    observation: captured.observation,
                    acceptedDir: acceptedSnapshot?.snapshotDir,
                    acceptedFingerprint: old?.playbackFingerprint
                });
                return prepared;
            });
        }
        function admissionToken() {
            const captured = state.admissionObservation, prepared = state.prepared;
            const token = Object.freeze({
                kind: 'exchange-admission'
            });
            tokens.set(token, {
                key: state.key,
                check: () => {
                    if (closed || state.closed || slot || !bindingValid || !prepared || state.prepared !== prepared) return false;
                    const current = observations.get(selectionId(m.identityTuple));
                    if (state.offline) {
                        if (!state.offlineVerified || current && (!current.healthy || !current.eligible) || !permitted(authorizeOffline, offlineContext)) return false;
                        // A trusted authorizer can reenter this API. Its literal
                        // true cannot revive a driver/provider it just closed,
                        // or authorize across a new operation/observation.
                        return !closed && !state.closed && !slot && bindingValid && state.prepared === prepared && state.offlineVerified && observations.get(registeredId) === current;
                    }
                    return !!captured && current === captured && current.healthy && current.eligible && current.pin.manifest.manifestState === 'complete' && current.pin.manifest.playbackFingerprint === prepared.manifest.source.playbackFingerprint;
                }
            });
            return token;
        }
        function canCommitPreparedSnapshot(prepared, acceptedSnapshot) {
            const proof = issued.get(prepared), current = observations.get(selectionId(m.identityTuple));
            return !!proof && proof.state === state && !closed && !state.closed && !slot && bindingValid && current === proof.observation && current.healthy && current.eligible && current.pin.manifest.manifestState === 'complete' && prepared.manifest.source.playbackFingerprint === current.pin.manifest.playbackFingerprint && acceptedSnapshot?.snapshotDir === proof.acceptedDir && acceptedSnapshot?.manifest?.source?.playbackFingerprint === proof.acceptedFingerprint;
        }
        const driver = Object.freeze({
            initial: initial,
            resolveReload: resolveReload,
            admissionToken: admissionToken,
            canCommitPreparedSnapshot: canCommitPreparedSnapshot,
            close() {
                state.closed = true;
                if (slot?.owner === state) slot.abort.abort();
            }
        });
        drivers.set(driver, state);
        return driver;
    }
    function inspectSelection(tuple, {
        signal
    } = {}) {
        const owned = ownTuple(tuple);
        return operation(null, signal, async (run, active) => {
            await checkJournal(active);
            const value = await observe(owned, 'inspectSelection', run, active);
            const manifest = value.pin.manifest;
            const inspection = {
                ready: false,
                revision: createHash('sha256').update(canonicalExchangeJSON([
                    c.binding.feedId, c.binding.epoch, manifest.selectionId,
                    value.pin.documentDigests.manifest, manifest.generation,
                    manifest.generationSequence, manifest.playbackFingerprint, manifest.metadataFingerprint
                ])).digest('hex'),
                selection: {
                    selectionId: manifest.selectionId, identityTuple: manifest.identityTuple,
                    displayLabel: manifest.button.displayLabel, origin: manifest.button.origin,
                    targetBoardKey: manifest.board.boardKey, generation: manifest.generation,
                    generationSequence: manifest.generationSequence,
                    playbackFingerprint: manifest.playbackFingerprint, metadataFingerprint: manifest.metadataFingerprint,
                    manifestState: manifest.manifestState, occurrenceCount: manifest.occurrences.length
                },
                event: {eventKey: manifest.event.eventKey, displayName: manifest.event.displayName, eventDate: manifest.event.eventDate},
                timingProposal: value.result.timingProposal,
                sourceTicks: manifest.sourceTicks,
                timeZone: manifest.event.timing.timeZone
            };
            return freeze({
                ok: true,
                acceptedMetadata: true,
                admissionEligible: value.observation.eligible,
                observationRevision: value.observation.version,
                inspection: JSON.parse(canonicalExchangeJSON(inspection))
            });
        });
    }
    function refreshCatalog(options = {}) {
        const attempt = ++catalogAttempt;
        catalogView = null;
        fields(options, ['signal'], []);
        const {signal} = options;
        return operation(null, signal, async (run, active) => {
            const result = await coor().refreshCatalog({
                signal: run.abort.signal
            });
            await drain();
            active();
            if (!result.ok) {
                for (const tuple of new Set([...registeredSelections, ...observations.keys()])) observations.set(tuple, freeze({
                    version: ++version,
                    healthy: false,
                    eligible: false,
                    pin: null
                }));
                if (/JOURNAL|REBIND/.test(result.code)) bindingValid = false;
                fail(result.code);
            }
            if (result.catalogReceipt?.feedId !== c.binding.feedId || result.catalogReceipt?.epoch !== c.binding.epoch) fail('PROVIDER_CAPTURE_INVALID');
            const view = createExchangeCatalogView(result.catalogReceipt);
            const catalog = result.catalogReceipt.catalog;
            const selections = new Map(catalog.events.flatMap(event => event.selections.map(entry => [ entry.selectionId, {
                entry: entry,
                event: event
            } ])));
            for (const id of new Set([...registeredSelections, ...observations.keys()])) {
                const old = observations.get(id);
                const item = selections.get(id);
                if (!item || item.event.eligibility.eligible !== true || old?.pin && (item.entry.generationSequence > old.pin.manifest.generationSequence || item.entry.generationSequence === old.pin.manifest.generationSequence && (item.entry.manifestSha256 !== old.pin.documentDigests.manifest || item.entry.playbackFingerprint !== old.pin.manifest.playbackFingerprint || item.entry.metadataFingerprint !== old.pin.manifest.metadataFingerprint))) observations.set(id, freeze({
                    version: ++version,
                    healthy: false,
                    eligible: false,
                    pin: null
                }));
            }
            active();
            if (catalogAttempt !== attempt) fail('CATALOG_REFRESH_SUPERSEDED');
            catalogView = view;
            return freeze({
                ok: true,
                catalogSequence: result.catalogReceipt.catalogSequence,
                catalog: view.summary()
            });
        }).catch(error => { if (catalogAttempt === attempt) catalogView = null; throw error; });
    }
    function browse(method, query) {
        if (closed) return freeze({ok:false,ready:false,code:'PROVIDER_CLOSED'});
        if (slot) return freeze({ok:false,ready:false,code:'BUSY'});
        if (!catalogView) return freeze({ok:false,ready:false,code:'CATALOG_UNAVAILABLE'});
        return catalogView[method](query);
    }
    return Object.freeze({
        createPreparedMedia: createPreparedMedia,
        inspectSelection: inspectSelection,
        refreshCatalog: refreshCatalog,
        catalogState: () => freeze({available:!closed && !slot && catalogView !== null,
            catalog:!closed && !slot && catalogView ? catalogView.summary() : null}),
        catalogEventsPage: query => browse('eventsPage', query),
        catalogSelectionsPage: query => browse('selectionsPage', query),
        snapshot: () => freeze({
            providerId: c.providerId,
            busy: slot !== null,
            closed: closed,
            observationRevision: version
        }),
        close() {
            closed = true;
            catalogView = null;
            slot?.abort.abort();
            coordinator?.close();
            release();
        }
    });
}

module.exports = {
    createExchangeSourceProvider: createExchangeSourceProvider,
    isExchangePreparedMedia: isExchangePreparedMedia,
    admitExchangeCandidate: admitExchangeCandidate,
    EXCHANGE_SOURCE_BUDGETS: EXCHANGE_SOURCE_BUDGETS
};
