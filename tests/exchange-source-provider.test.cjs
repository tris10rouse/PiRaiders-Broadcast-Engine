'use strict';

const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');

const {
    fixture,
    source,
    image,
    seal,
    copy,
    wait,
    until,
    latch,
    guarded
} = require('./exchange-provider-fixtures.cjs');

const {
    createExchangeSourceProvider,
    isExchangePreparedMedia,
    admitExchangeCandidate,
    EXCHANGE_SOURCE_BUDGETS
} = require('../scripts/lib/exchange-source-provider.cjs');

const {
    normalizePreparedEventProfile
} = require('../scripts/lib/prepared-event-profile.cjs');

function profileFor(f, m) {
    return {
        schemaVersion: 1,
        provider: 'exchange-v1',
        eventId: 'approved-engine-selection',
        productionWindow: {
            start: '2026-11-17T00:00:00Z',
            end: '2026-11-17T23:00:00Z',
            prewarmMinutes: 15
        },
        spx: {
            executable: process.execPath,
            args: [],
            cwd: f.parent
        },
        caspar: {
            executable: process.execPath,
            cwd: f.parent,
            runtimeDir: path.join(f.parent, 'runtime')
        },
        media: {
            provider: 'exchange-ordered-v1',
            providerId: 'approved-feed',
            binding: {
                ...f.config.binding
            },
            identityTuple: [ ...m.identityTuple ],
            cacheDir: f.config.cacheDir,
            startup: {
                mode: 'source'
            }
        },
        rossTalk: {
            allowedSenders: [ '127.0.0.1' ],
            commandMap: {
                1: 'launch',
                5: 'reload',
                8: 'stop'
            }
        }
    };
}

function providerFor(t, f, trusted = {}) {
    const provider = createExchangeSourceProvider({
        providerId: 'approved-feed',
        ...f.config
    }, {
        createCoordinator: () => f.coordinator,
        ...trusted
    });
    t.after(() => provider.close());
    return provider;
}

function expected(code) {
    return error => error.code === code;
}

test('explicit profile owns exact exchange identity, rejects lexical/functions and requires branded matching driver', async t => {
    const f = await fixture(t), m = source(), raw = profileFor(f, m), normalized = normalizePreparedEventProfile(raw), p = providerFor(t, f), driver = p.createPreparedMedia(normalized);
    assert.equal(isExchangePreparedMedia(driver, normalized), true);
    assert.equal(isExchangePreparedMedia({
        ...driver
    }, normalized), false);
    const changed = copy(raw);
    changed.productionWindow.end = '2026-11-17T22:00:00Z';
    assert.equal(isExchangePreparedMedia(driver, changed), false);
    raw.media.identityTuple[1] = 'mutated';
    assert.equal(normalized.media.identityTuple[1], m.identityTuple[1]);
    for (const mutate of [ v => {
        v.media.sourceDir = f.config.sourceRoot;
    }, v => {
        v.media.provider = 'local-lexical-v1';
    }, v => {
        v.provider = 'local-manual';
    }, v => {
        v.media.resolve = () => {};
    }, v => {
        v.media.identityTuple = [ 'bad' ];
    }, v => {
        v.media.startup = {
            mode: 'cached',
            snapshotId: 'relative'
        };
    } ]) {
        const value = profileFor(f, m);
        mutate(value);
        assert.throws(() => normalizePreparedEventProfile(value), expected('PROFILE_INVALID'));
    }
    assert.equal(admitExchangeCandidate({
        kind: 'exchange-admission'
    }), false);
    assert.equal(admitExchangeCandidate(driver.admissionToken()), false);
});

test('actual ordered schema2 preparation and opaque exact-profile admission; failure observations never reuse stale accepted pin', async t => {
    const f = await fixture(t), m = source();
    await f.publish(m);
    const p = providerFor(t, f), profile = profileFor(f, m), driver = p.createPreparedMedia(profile), prepared = await driver.initial();
    assert.equal(prepared.manifest.schemaVersion, 2);
    assert.equal(prepared.deck.slides.length, 3);
    assert.equal(prepared.deck.slides[0].src, prepared.deck.slides[2].src);
    const token = driver.admissionToken();
    assert.equal(admitExchangeCandidate(token, profile), true);
    assert.deepEqual(Object.keys(token), [ 'kind' ]);
    assert.equal(JSON.stringify(token).includes(f.parent), false);
    const changed = copy(profile);
    changed.playback = {
        mode: 'manual'
    };
    assert.equal(admitExchangeCandidate(token, changed), false);
    await fs.rm(path.join(f.config.sourceRoot, 'catalog.json'));
    await assert.rejects(p.inspectSelection(m.identityTuple));
    assert.equal(admitExchangeCandidate(token, profile), false);
    assert.ok(f.coordinator.snapshot().lastAccepted.manifest);
    assert.equal(EXCHANGE_SOURCE_BUDGETS.resolverTimeoutMs, 12e4);
    assert.equal(EXCHANGE_SOURCE_BUDGETS.prepareTimeoutMs, 6e4);
});

test('Reload uses actual accepted A through content-only ineligible C and metadata A with no source assets', async t => {
    const f = await fixture(t), a = source();
    await f.publish(a);
    const p = providerFor(t, f), driver = p.createPreparedMedia(profileFor(f, a)), accepted = await driver.initial();
    const c = source([ image('png', 125), image('jpeg', 125) ]);
    c.generationSequence = 2;
    c.event.eligibility = {
        eligible: false,
        reasonCodes: [ 'CANCELLED' ]
    };
    seal(c);
    await f.publish(c, {
        assets: false
    });
    for (let i = 0; i < c.assets.length; i++) await f.write(c.assets[i].deliveryPath, [ image('png', 125), image('jpeg', 125) ][i]);
    const contentOnly = await f.coordinator.prepareSelection(c.identityTuple);
    assert.equal(contentOnly.code, 'CONTENT_PREPARED');
    assert.notEqual(contentOnly.prepared.snapshotDir, accepted.snapshotDir);
    const next = copy(a);
    next.generationSequence = 3;
    next.sourceTicks.onBoardAll = true;
    next.assets.forEach((asset, i) => {
        const old = asset.assetKey;
        asset.assetKey = 'a' + (i + 10);
        next.occurrences.filter(o => o.assetKey === old).forEach(o => o.assetKey = asset.assetKey);
    });
    seal(next);
    assert.equal(next.playbackFingerprint, a.playbackFingerprint);
    await f.publish(next, {
        assets: false
    });
    await fs.rm(path.join(f.config.sourceRoot, 'assets'), {
        recursive: true
    });
    const resolved = await driver.resolveReload({
        acceptedSnapshot: accepted
    });
    assert.equal(resolved.snapshotDir, accepted.snapshotDir);
    assert.equal(f.coordinator.snapshot().lastPrepared.snapshotDir, contentOnly.prepared.snapshotDir);
});

test('changed content requires fresh eligibility and handles inspect/prepare races without changing actual accepted cache', async t => {
    const f = await fixture(t), a = source();
    await f.publish(a);
    const p = providerFor(t, f), driver = p.createPreparedMedia(profileFor(f, a)), accepted = await driver.initial();
    const changed = source(undefined, [ 0, 1, 0 ]);
    changed.generationSequence = 2;
    changed.event.eligibility = {
        eligible: false,
        reasonCodes: [ 'CANCELLED' ]
    };
    seal(changed);
    await f.publish(changed);
    await assert.rejects(driver.resolveReload({
        acceptedSnapshot: accepted
    }), expected('SOURCE_ADMISSION_DENIED'));
    await fs.access(accepted.snapshotDir);
    changed.generationSequence = 3;
    changed.event.eligibility = {
        eligible: true,
        reasonCodes: []
    };
    seal(changed);
    await f.publish(changed);
    const prepared = await driver.resolveReload({
        acceptedSnapshot: accepted
    });
    assert.notEqual(prepared.snapshotDir, accepted.snapshotDir);
    assert.equal(prepared.manifest.source.playbackFingerprint, changed.playbackFingerprint);
});

test('offline cached startup defaults deny, requires synchronous literal true and touches no source filesystem', async t => {
    const f = await fixture(t), m = source();
    await f.publish(m);
    const staged = await f.coordinator.prepareSelection(m.identityTuple), profile = profileFor(f, m);
    profile.media.startup = {
        mode: 'cached',
        snapshotId: path.basename(staged.prepared.snapshotDir),
        playbackFingerprint: m.playbackFingerprint
    };
    let coorCalls = 0;
    const p = providerFor(t, f, {
        createCoordinator: () => {
            coorCalls++;
            throw Error('MUST_NOT_CONSULT_SOURCE');
        }
    });
    for (const callback of [ undefined, () => false, () => 1, () => ({}), () => Promise.resolve(true), () => Promise.reject(Error('PRIVATE')) ]) {
        const driver = p.createPreparedMedia(profile, callback === undefined ? {} : {
            authorizeOffline: callback
        });
        await assert.rejects(driver.initial(), expected('OFFLINE_AUTHORIZATION_REQUIRED'));
    }
    const originals = {
        realpath: fs.realpath,
        stat: fs.stat,
        lstat: fs.lstat,
        open: fs.open
    };
    let sourceReads = 0;
    for (const key of Object.keys(originals)) fs[key] = async (file, ...args) => {
        if (typeof file === 'string' && (file === f.config.sourceRoot || file.startsWith(f.config.sourceRoot + path.sep))) {
            sourceReads++;
            throw Error('DISCONNECTED_SOURCE');
        }
        return originals[key].call(fs, file, ...args);
    };
    try {
        const driver = p.createPreparedMedia(profile, {
            authorizeOffline: () => true
        });
        const prepared = await driver.initial();
        assert.equal(prepared.snapshotDir, staged.prepared.snapshotDir);
        assert.equal(admitExchangeCandidate(driver.admissionToken(), profile), true);
    } finally {
        Object.assign(fs, originals);
    }
    assert.equal(sourceReads, 0);
    assert.equal(coorCalls, 0);
});

test('local store/binding/cache verification is mandatory offline and authorization can be revoked', async t => {
    const f = await fixture(t), m = source();
    await f.publish(m);
    const staged = await f.coordinator.prepareSelection(m.identityTuple), profile = profileFor(f, m);
    profile.media.startup = {
        mode: 'cached',
        snapshotId: path.basename(staged.prepared.snapshotDir),
        playbackFingerprint: m.playbackFingerprint
    };
    const p = providerFor(t, f);
    let allow = true;
    const driver = p.createPreparedMedia(profile, {
        authorizeOffline: () => allow
    });
    await driver.initial();
    const token = driver.admissionToken();
    allow = false;
    assert.equal(admitExchangeCandidate(token, profile), false);
    await fs.writeFile(path.join(staged.prepared.snapshotDir, staged.prepared.manifest.files[0].src), 'tampered');
    allow = true;
    await assert.rejects(driver.initial());
    assert.equal(admitExchangeCandidate(driver.admissionToken(), profile), false);
    const head = await f.head();
    await f.journal.append(f.config.journalDir, {
        expectedStoreId: head.storeId,
        expectedRevision: head.revision,
        expectedHeadSha256: head.headSha256,
        event: {
            type: 'confirm-binding',
            expectedRevision: head.revision,
            expectedBinding: f.config.binding,
            binding: {
                ...f.config.binding,
                epoch: 2
            },
            confirm: true
        }
    });
    await assert.rejects(driver.initial(), expected('JOURNAL_BINDING_MISMATCH'));
});

test('physical wrapper holds its promise and global ownership until actual reader close after abort', {
    timeout: 1e4
}, async t => {
    const f = await fixture(t), m = source();
    await f.publish(m);
    const p = providerFor(t, f), driver = p.createPreparedMedia(profileFor(f, m));
    const entered = latch(), block = latch(), original = fs.open;
    let settled = false;
    fs.open = async (file, ...args) => {
        const h = await original.call(fs, file, ...args);
        if (file !== path.join(f.config.sourceRoot, 'catalog.json')) return h;
        return {
            stat: h.stat.bind(h),
            read: h.read.bind(h),
            close: async () => {
                entered.release();
                await block.promise;
                await h.close();
            }
        };
    };
    try {
        const abort = new AbortController(), pending = driver.initial({
            signal: abort.signal
        }).finally(() => {
            settled = true;
        });
        const rejection = assert.rejects(pending, error => [ 'PROVIDER_ABORTED', 'PROVIDER_CLOSED' ].includes(error.code));
        await guarded(entered.promise);
        abort.abort();
        await wait(25);
        assert.equal(settled, false);
        assert.equal(p.snapshot().busy, true);
        await assert.rejects(p.inspectSelection(m.identityTuple), expected('BUSY'));
        p.close();
        assert.throws(() => createExchangeSourceProvider({
            providerId: 'approved-feed',
            ...f.config
        }), expected('PROVIDER_ALREADY_OPEN'));
        block.release();
        await rejection;
        assert.equal(p.snapshot().busy, false);
        const replacement = createExchangeSourceProvider({
            providerId: 'approved-feed',
            ...f.config
        });
        replacement.close();
    } finally {
        block.release();
        fs.open = original;
    }
});

test('canonical/lexical private boundaries reject before runtime directory writes; offline context is explicitly external', async t => {
    const f = await fixture(t), m = source(), p = providerFor(t, f), profile = profileFor(f, m);
    profile.caspar.runtimeDir = path.join(f.config.sourceRoot, 'runtime');
    assert.throws(() => p.createPreparedMedia(profile), expected('PROVIDER_PROFILE_MISMATCH'));
    const alias = path.join(f.parent, 'runtime-alias');
    await fs.symlink(f.config.sourceRoot, alias, 'junction');
    t.after(() => fs.rm(alias, {
        force: true
    }));
    profile.caspar.runtimeDir = path.join(alias, 'runtime');
    const driver = p.createPreparedMedia(profile);
    await assert.rejects(driver.initial(), expected('PROVIDER_ROOTS_OVERLAP'));
    await assert.rejects(fs.stat(path.join(f.config.sourceRoot, 'runtime')), {
        code: 'ENOENT'
    });
});

module.exports = {
    profileFor: profileFor,
    providerFor: providerFor
};

test('changed eligible inspect cannot authorize a later freshly captured ineligible generation', async t => {
    const f = await fixture(t), a = source();
    await f.publish(a);
    let update = null;
    const proxy = {
        snapshot: f.coordinator.snapshot,
        close: f.coordinator.close,
        refreshCatalog: f.coordinator.refreshCatalog,
        prepareSelection: f.coordinator.prepareSelection,
        inspectSelection: async (...args) => {
            const result = await f.coordinator.inspectSelection(...args);
            if (update) {
                const work = update;
                update = null;
                await work();
            }
            return result;
        }
    };
    const p = providerFor(t, f, {
        createCoordinator: () => proxy
    }), driver = p.createPreparedMedia(profileFor(f, a)), accepted = await driver.initial();
    const changed = source(undefined, [ 0, 1, 0 ]);
    changed.generationSequence = 2;
    seal(changed);
    await f.publish(changed);
    const invalid = copy(changed);
    invalid.generationSequence = 3;
    invalid.event.eligibility = {
        eligible: false,
        reasonCodes: [ 'CANCELLED' ]
    };
    seal(invalid);
    update = () => f.publish(invalid);
    await assert.rejects(driver.resolveReload({
        acceptedSnapshot: accepted
    }), expected('SOURCE_ADMISSION_DENIED'));
    await fs.access(accepted.snapshotDir);
    assert.equal(f.coordinator.snapshot().lastAccepted.manifest.generationSequence, 3);
});

test('one immutable provider deadline fences late offline verification; duplicate owners cannot run around an orphan', async t => {
    const f = await fixture(t), m = source();
    await f.publish(m);
    const first = await f.coordinator.prepareSelection(m.identityTuple), profile = profileFor(f, m);
    profile.media.startup = {
        mode: 'cached',
        snapshotId: path.basename(first.prepared.snapshotDir),
        playbackFingerprint: m.playbackFingerprint
    };
    let clock = 0;
    const {
        loadExchangeSnapshot
    } = require('../scripts/lib/exchange-snapshot.cjs');
    const p = providerFor(t, f, {
        now: () => clock,
        load: async (...args) => {
            const result = await loadExchangeSnapshot(...args);
            clock = 11e4;
            return result;
        }
    }), driver = p.createPreparedMedia(profile, {
        authorizeOffline: () => true
    });
    assert.throws(() => createExchangeSourceProvider({
        providerId: 'another',
        ...f.config
    }), expected('PROVIDER_ALREADY_OPEN'));
    await assert.rejects(driver.initial(), expected('PROVIDER_TIMEOUT'));
    assert.equal(p.snapshot().busy, false);
    assert.equal(admitExchangeCandidate(driver.admissionToken(), profile), false);
});

test('offline wrong retained store fails closed with fixed diagnostics and no coordinator or automatic setup', async t => {
    const f = await fixture(t), m = source();
    await f.publish(m);
    const first = await f.coordinator.prepareSelection(m.identityTuple), profile = profileFor(f, m);
    profile.media.startup = {
        mode: 'cached',
        snapshotId: path.basename(first.prepared.snapshotDir),
        playbackFingerprint: m.playbackFingerprint
    };
    const crypto = require('node:crypto');
    let calls = 0;
    const p = createExchangeSourceProvider({
        providerId: 'approved-feed',
        ...f.config,
        storeId: crypto.randomUUID()
    }, {
        createCoordinator: () => {
            calls++;
            throw Error('FORBIDDEN');
        }
    });
    t.after(() => p.close());
    const driver = p.createPreparedMedia(profile, {
        authorizeOffline: () => true
    });
    await assert.rejects(driver.initial(), error => {
        assert.equal(error.code, 'JOURNAL_INVALID');
        assert.equal(error.message, 'JOURNAL_INVALID');
        assert.equal(error.message.includes(f.parent), false);
        return true;
    });
    assert.equal(calls, 0);
    assert.equal(admitExchangeCandidate(driver.admissionToken()), false);
});

test('scalar option validation never invokes nested getters or coercion hooks',async t=>{
 const f=await fixture(t),m=source();let calls=0;const exotic={toString(){calls++;return f.config.storeId;}};Object.defineProperty(exotic,'hidden',{enumerable:true,get(){calls++;return 'private';}});
 assert.throws(()=>createExchangeSourceProvider({providerId:'approved-feed',...f.config,storeId:exotic}),expected('PROVIDER_OPTIONS_INVALID'));
 const profile=profileFor(f,m);profile.media.binding.feedId=exotic;assert.throws(()=>normalizePreparedEventProfile(profile),expected('PROFILE_INVALID'));
 const cached=profileFor(f,m);cached.media.startup={mode:'cached',snapshotId:exotic,playbackFingerprint:'a'.repeat(64)};assert.throws(()=>normalizePreparedEventProfile(cached),expected('PROFILE_INVALID'));assert.equal(calls,0);
});

test('production default coordinator path prepares schema2 and retains real journal facts without test factory',async t=>{
 const f=await fixture(t),m=source();await f.publish(m);const p=createExchangeSourceProvider({providerId:'approved-feed',...f.config});t.after(()=>p.close());const profile=profileFor(f,m),driver=p.createPreparedMedia(profile),prepared=await driver.initial();assert.equal(prepared.manifest.schemaVersion,2);assert.equal(admitExchangeCandidate(driver.admissionToken(),profile),true);assert.equal((await f.head()).state.feeds[0].selections[0].sequence,1);assert.equal(f.coordinator.snapshot().lastPrepared,null);
});

test('Reload cannot issue a changed-commit proof without an actual matching accepted snapshot context',async t=>{
 const f=await fixture(t),m=source(),p=providerFor(t,f),driver=p.createPreparedMedia(profileFor(f,m));await assert.rejects(driver.resolveReload({}),expected('PROVIDER_CACHE_INVALID'));assert.equal(p.snapshot().busy,false);assert.equal(f.coordinator.snapshot().lastAccepted,null);
});

test('offline-only candidate is revoked by cancelled, omitted or unavailable catalog without mutating its accepted cache/window', async t => {
    for (const invalidation of ['cancelled', 'omitted', 'unavailable']) await t.test(invalidation, async t => {
        const f = await fixture(t), m = source();
        await f.publish(m);
        const staged = await f.coordinator.prepareSelection(m.identityTuple), profile = profileFor(f, m);
        profile.media.startup = {mode: 'cached', snapshotId: path.basename(staged.prepared.snapshotDir), playbackFingerprint: m.playbackFingerprint};
        const p = providerFor(t, f), driver = p.createPreparedMedia(profile, {authorizeOffline: () => true});
        const prepared = await driver.initial(), token = driver.admissionToken();
        const beforeManifest = await fs.readFile(path.join(prepared.snapshotDir, 'manifest.json'));
        const beforeWindow = copy(profile.productionWindow);
        assert.equal(admitExchangeCandidate(token, profile), true);
        // A healthy catalog is not a selected-pin observation or approval.
        await p.refreshCatalog();
        assert.equal(admitExchangeCandidate(token, profile), true);
        if (invalidation === 'unavailable') {
            await fs.rm(path.join(f.config.sourceRoot, 'catalog.json'));
            await assert.rejects(p.refreshCatalog());
        } else if (invalidation === 'cancelled') {
            m.generationSequence++;
            m.event.eligibility = {eligible: false, reasonCodes: ['CANCELLED']};
            seal(m);
            await f.publish(m);
            await p.refreshCatalog();
        } else {
            const catalog = JSON.parse(await fs.readFile(path.join(f.config.sourceRoot, 'catalog.json')));
            catalog.catalogSequence++;
            catalog.events = [];
            await f.write('catalog.json', catalog);
            await p.refreshCatalog();
        }
        assert.equal(admitExchangeCandidate(token, profile), false, invalidation);
        assert.equal(admitExchangeCandidate(driver.admissionToken(), profile), false, invalidation);
        assert.deepEqual(await fs.readFile(path.join(prepared.snapshotDir, 'manifest.json')), beforeManifest);
        assert.deepEqual(profile.productionWindow, beforeWindow);
        p.close();
    });
});

test('offline authorizer cannot admit a driver or provider it reentrantly closes', async t => {
    for (const target of ['driver', 'provider']) await t.test(target, async t => {
        const f = await fixture(t), m = source();
        await f.publish(m);
        const staged = await f.coordinator.prepareSelection(m.identityTuple), profile = profileFor(f, m);
        profile.media.startup = {mode: 'cached', snapshotId: path.basename(staged.prepared.snapshotDir), playbackFingerprint: m.playbackFingerprint};
        const p = providerFor(t, f);
        let revoke = false, driver;
        driver = p.createPreparedMedia(profile, {authorizeOffline: () => {
            if (revoke) (target === 'driver' ? driver : p).close();
            return true;
        }});
        await driver.initial();
        const token = driver.admissionToken();
        assert.equal(admitExchangeCandidate(token, profile), true);
        revoke = true;
        assert.equal(admitExchangeCandidate(token, profile), false, target);
        p.close();
    });
});

test('driver selection registration is bounded independently of healthy observations', async t => {
    const f = await fixture(t), m = source(), p = providerFor(t, f), profile = profileFor(f, m);
    for (let index = 0; index < 2048; index++) {
        profile.media.identityTuple[4] = 'registered-' + index;
        p.createPreparedMedia(profile);
    }
    profile.media.identityTuple[4] = 'registered-overflow';
    assert.throws(() => p.createPreparedMedia(profile), expected('PROVIDER_CAPACITY_EXCEEDED'));
    profile.media.identityTuple[4] = 'registered-0';
    assert.doesNotThrow(() => p.createPreparedMedia(profile));
});
