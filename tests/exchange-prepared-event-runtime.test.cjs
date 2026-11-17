'use strict';

const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), http = require('node:http');

const {
    EventEmitter
} = require('node:events'), {
    WebSocket
} = require('ws');

const {
    fixture,
    source,
    image,
    seal,
    copy,
    wait,
    until,
    latch,
    guarded,
    profileFor,
    providerFor
} = require('./exchange-provider-fixtures.cjs');

const {
    createPreparedEventRuntime
} = require('../scripts/lib/prepared-event-runtime.cjs');

const {
    createRossTalkSession
} = require('../scripts/lib/rosstalk-session.cjs');

const {
    admitExchangeCandidate
} = require('../scripts/lib/exchange-source-provider.cjs');

const {
    SlideshowController
} = require('../scripts/lib/slideshow-controller.cjs');

async function actualRuntime(t, {
    seams = {},
    profileChange = () => {}
} = {}) {
    const f = await fixture(t, seams), m = source();
    await f.publish(m);
    const provider = providerFor(t, f), profile = profileFor(f, m);
    profile.productionWindow = {
        start: new Date(Date.now() - 1e3).toISOString(),
        end: new Date(Date.now() + 36e5).toISOString(),
        prewarmMinutes: 0
    };
    profile.playback = {
        mode: 'auto',
        intervalMs: 6e4
    };
    profileChange(profile);
    const driver = provider.createPreparedMedia(profile), events = [], sessions = [];
    let runtime;
    const options = {
        manageSpx: false,
        preparedMedia: driver,
        supervisorOptions: {
            platform: 'linux',
            maxRestarts: 0
        },
        stage: () => {
            throw Error('LEXICAL_STAGE_FORBIDDEN');
        },
        spawnProcess: (command, args, opts, privateInput) => {
            const child = new EventEmitter();
            child.pid = 100 + events.length;
            child.stdin = {
                end() {
                    setImmediate(() => child.emit('exit', 1));
                }
            };
            child.kill = () => setImmediate(() => child.emit('exit', 0));
            events.push({
                child: child,
                command: command,
                args: args,
                opts: opts,
                privateInput: privateInput
            });
            setImmediate(() => child.emit('spawn'));
            return child;
        },
        consoleFactory: child => {
            const client = new EventEmitter();
            client.close = () => child.stdin.end();
            client.request = async value => ({
                status: value === 'VERSION' ? 201 : 202
            });
            return client;
        },
        sessionFactory: async raw => {
            const session = await createRossTalkSession({
                ...raw,
                rossTalk: {
                    ...raw.rossTalk,
                    port: 0
                }
            }, {
                allowEphemeral: true
            });
            sessions.push({
                raw: raw,
                session: session
            });
            return session;
        }
    };
    t.after(async () => {
        await runtime?.close();
        await until(() => !provider.snapshot().busy);
    });
    return {
        ...f,
        m: m,
        provider: provider,
        profile: profile,
        driver: driver,
        events: events,
        sessions: sessions,
        options: options,
        async create(extra = {}) {
            runtime = await createPreparedEventRuntime(profile, {
                ...options,
                ...extra
            });
            return runtime;
        }
    };
}

async function renderer(t, session) {
    const token = new URL(session.getProgramURL()).hash.slice('#piraiders='.length), origin = session.origin;
    const cookie = await new Promise((resolve, reject) => {
        const url = new URL(origin);
        const req = http.request({
            hostname: url.hostname,
            port: url.port,
            path: '/piraiders/session',
            method: 'POST',
            agent: false,
            headers: {
                Origin: origin,
                Authorization: 'Bearer ' + token
            }
        }, res => {
            res.resume();
            res.on('end', () => res.statusCode === 204 ? resolve(res.headers['set-cookie'][0].split(';')[0]) : reject(Error('BOOTSTRAP_FAILED')));
        });
        req.on('error', reject);
        req.end();
    });
    const ws = new WebSocket('ws://' + new URL(origin).host + '/piraiders/socket.io/?EIO=4&transport=websocket', {
        headers: {
            Origin: origin,
            Cookie: cookie
        }
    }), commands = [];
    let hold = null, held = null;
    ws.on('error', () => {});
    ws.on('message', bytes => {
        const value = bytes.toString();
        if (value[0] === '0') ws.send('40' + JSON.stringify({
            token: token
        })); else if (value === '2') ws.send('3'); else if (value.startsWith('42')) {
            const [ name, data ] = JSON.parse(value.slice(2));
            if (name === 'init') ws.send('42' + JSON.stringify([ 'ready', {
                epoch: data.epoch
            } ]));
            if (name === 'command') {
                commands.push(data);
                if (hold?.(data)) {
                    held = data;
                } else ws.send('42' + JSON.stringify([ 'ack', {
                    epoch: data.epoch,
                    id: data.id,
                    ok: true
                } ]));
            }
        }
    });
    t.after(() => ws.terminate());
    await until(() => session.snapshot().presentation.renderer.ready);
    return {
        commands: commands,
        hold(fn) {
            hold = fn;
        },
        get held() {
            return held;
        },
        release() {
            const data = held;
            held = null;
            hold = null;
            if (data) ws.send('42' + JSON.stringify([ 'ack', {
                epoch: data.epoch,
                id: data.id,
                ok: true
            } ]));
        }
    };
}

test('source runtime requires exact branded media, remains inactive until start, and uses explicit existing-cap session budgets', async t => {
    const f = await actualRuntime(t);
    await assert.rejects(f.create({
        preparedMedia: undefined
    }), e => e.code === 'EVENT_OPTIONS_INVALID');
    await assert.rejects(f.create({
        preparedMedia: {
            ...f.driver
        }
    }), e => e.code === 'EVENT_OPTIONS_INVALID');
    const runtime = await f.create();
    assert.equal(runtime.snapshot().state, 'prepared');
    assert.equal(f.events.length, 0);
    assert.equal(f.sessions.length, 0);
    assert.equal(admitExchangeCandidate(runtime.candidateAdmissionToken(), f.profile), true);
    await runtime.start();
    const {
        session,
        raw
    } = f.sessions[0];
    assert.equal(raw.resolverTimeoutMs, 12e4);
    assert.equal(raw.presentation.prepareTimeoutMs, 6e4);
    assert.ok(session.snapshot().transport.state === 'listening');
    const p = await renderer(t, session);
    await until(() => runtime.snapshot().ready);
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0].privateInput, true);
    assert.equal((await runtime.dispatch('launch')).ok, true);
    assert.equal(runtime.snapshot().slideCount, 3);
    assert.equal(p.commands.find(x => x.type === 'show').src.includes(runtime.snapshot().deckId), true);
});

test('actual session same-playback Reload preserves controller/deck/index/auto deadline across metadata and ineligibility; changed denial never blacks', async t => {
    const f = await actualRuntime(t), runtime = await f.create();
    await runtime.start();
    const session = f.sessions[0].session, p = await renderer(t, session);
    await until(() => runtime.snapshot().ready);
    await runtime.dispatch('launch');
    await runtime.dispatch('next');
    let replacements = 0;
    const original = SlideshowController.prototype.replaceDeck;
    SlideshowController.prototype.replaceDeck = function(...args) {
        replacements++;
        return original.apply(this, args);
    };
    t.after(() => {
        SlideshowController.prototype.replaceDeck = original;
    });
    const before = session.snapshot().presentation.controller, window = copy(f.profile.productionWindow), blackBefore = p.commands.filter(x => x.type === 'black').length;
    const next = copy(f.m);
    next.generationSequence = 2;
    next.sourceTicks.onBoardAll = true;
    next.event.eligibility = {
        eligible: false,
        reasonCodes: [ 'CANCELLED' ]
    };
    seal(next);
    await f.publish(next, {
        assets: false
    });
    await fs.rm(path.join(f.config.sourceRoot, 'assets'), {
        recursive: true
    });
    assert.equal((await runtime.dispatch('reload')).ok, true);
    const after = session.snapshot().presentation.controller;
    assert.equal(replacements, 0);
    for (const key of [ 'deckId', 'index', 'mode', 'nextAdvanceAt' ]) assert.equal(after[key], before[key], key);
    assert.deepEqual(f.profile.productionWindow, window);
    assert.equal(runtime.snapshot().ready, true);
    const changed = source(undefined, [ 0, 1, 0 ]);
    changed.generationSequence = 3;
    changed.event.eligibility = {
        eligible: false,
        reasonCodes: [ 'CANCELLED' ]
    };
    seal(changed);
    await f.publish(changed, {
        assets: false
    });
    assert.equal((await runtime.dispatch('reload')).ok, false);
    assert.equal(runtime.snapshot().ready, true);
    assert.equal(session.snapshot().presentation.controller.deckId, before.deckId);
    assert.equal(p.commands.filter(x => x.type === 'black').length, blackBefore);
    assert.equal(replacements, 0);
});

test('source outage leaves sticky active control/window and accepted deck; source token becomes inadmissible', async t => {
    const f = await actualRuntime(t), runtime = await f.create(), token = runtime.candidateAdmissionToken();
    await runtime.start();
    const session = f.sessions[0].session, p = await renderer(t, session);
    await until(() => runtime.snapshot().ready);
    await runtime.dispatch('launch');
    const before = runtime.snapshot(), blacks = p.commands.filter(x => x.type === 'black').length;
    await fs.unlink(path.join(f.config.sourceRoot, 'catalog.json'));
    assert.equal((await runtime.dispatch('reload')).ok, false);
    assert.equal(admitExchangeCandidate(token, f.profile), false);
    assert.equal(runtime.snapshot().deckId, before.deckId);
    assert.equal(runtime.snapshot().windowAllowed, true);
    assert.equal(runtime.snapshot().ready, true);
    assert.equal((await runtime.dispatch('next')).ok, true);
    assert.equal(p.commands.filter(x => x.type === 'black').length, blacks);
});

test('physical ignored stage remains runtime.preparing through priority Stop and close; late candidate never commits', async t => {
    const entered = latch(), block = latch();
    let blockStage = false;
    const {
        stageExchangeSnapshot
    } = require('../scripts/lib/exchange-snapshot.cjs');
    const f = await actualRuntime(t, {
        seams: {
            stage: async request => {
                if (blockStage) {
                    entered.release();
                    await block.promise;
                    return stageExchangeSnapshot({
                        ...request,
                        signal: undefined
                    });
                }
                return stageExchangeSnapshot(request);
            }
        }
    }), runtime = await f.create();
    await runtime.start();
    const session = f.sessions[0].session;
    await renderer(t, session);
    await until(() => runtime.snapshot().ready);
    await runtime.dispatch('launch');
    const before = runtime.snapshot().deckId;
    const changed = source(undefined, [ 0, 1, 0 ]);
    changed.generationSequence = 2;
    seal(changed);
    await f.publish(changed);
    blockStage = true;
    const pending = runtime.dispatch('reload');
    await guarded(entered.promise);
    assert.equal(runtime.snapshot().preparing, true);
    assert.equal((await guarded(runtime.dispatch('stop'))).ok, true);
    assert.equal(runtime.snapshot().preparing, true);
    await guarded(runtime.close());
    assert.equal(runtime.snapshot().preparing, true);
    assert.equal(f.provider.snapshot().busy, true);
    block.release();
    await pending;
    await until(() => !runtime.snapshot().preparing);
    assert.equal(runtime.snapshot().deckId, before);
    assert.equal(f.provider.snapshot().busy, false);
});

test('source invalidation while host verifies a changed candidate denies commit without replacing or blacking', async t => {
    const f = await actualRuntime(t), runtime = await f.create();
    await runtime.start();
    const session = f.sessions[0].session, p = await renderer(t, session);
    await until(() => runtime.snapshot().ready);
    await runtime.dispatch('launch');
    const before = session.snapshot().presentation.controller, blacks = p.commands.filter(x => x.type === 'black').length;
    const changed = source(undefined, [ 0, 1, 0 ]);
    changed.generationSequence = 2;
    seal(changed);
    await f.publish(changed);
    const original = fs.open, entered = latch(), gate = latch(), counts = new Map();
    let blocked = false;
    t.after(() => {
        gate.release();
        fs.open = original;
    });
    fs.open = async (file, ...args) => {
        const handle = await original.call(fs, file, ...args);
        if (typeof file === 'string' && file.startsWith(f.config.cacheDir + path.sep) && file.endsWith('manifest.json') && !file.includes(before.deckId)) {
            const count = (counts.get(file) || 0) + 1;
            counts.set(file, count);
            if (count === 2 && !blocked) {
                blocked = true;
                const read = handle.read.bind(handle);
                handle.read = async (...values) => {
                    entered.release();
                    await gate.promise;
                    return read(...values);
                };
            }
        }
        return handle;
    };
    const pending = runtime.dispatch('reload');
    await guarded(entered.promise);
    const invalid = copy(changed);
    invalid.generationSequence = 3;
    invalid.event.eligibility = {
        eligible: false,
        reasonCodes: [ 'CANCELLED' ]
    };
    seal(invalid);
    await f.publish(invalid);
    await f.provider.inspectSelection(invalid.identityTuple);
    gate.release();
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(session.snapshot().presentation.reload.lastError, 'ADMISSION_DENIED');
    const after = session.snapshot().presentation.controller;
    for (const key of [ 'deckId', 'index', 'mode', 'nextAdvanceAt' ]) assert.equal(after[key], before[key], key);
    assert.equal(p.commands.filter(x => x.type === 'black').length, blacks);
    assert.equal(runtime.snapshot().ready, true);
});

test('eligible changed Reload can take more than five seconds, commits once, then metadata-only reuse follows actual accepted snapshot', async t => {
    const {
        stageExchangeSnapshot
    } = require('../scripts/lib/exchange-snapshot.cjs');
    let delay = false;
    const f = await actualRuntime(t, {
        seams: {
            stage: async request => {
                if (delay) await wait(5250);
                return stageExchangeSnapshot(request);
            }
        }
    }), runtime = await f.create();
    await runtime.start();
    const session = f.sessions[0].session, p = await renderer(t, session);
    await until(() => runtime.snapshot().ready);
    await runtime.dispatch('launch');
    const before = runtime.snapshot().deckId, blacks = p.commands.filter(x => x.type === 'black').length;
    const changed = source(undefined, [ 0, 1, 0 ]);
    changed.generationSequence = 2;
    seal(changed);
    await f.publish(changed);
    delay = true;
    const outcome = await runtime.dispatch('reload');
    delay = false;
    assert.equal(outcome.ok, true);
    const accepted = runtime.snapshot().deckId;
    assert.notEqual(accepted, before);
    assert.equal(session.snapshot().presentation.controller.deckId, accepted);
    assert.equal(p.commands.filter(x => x.type === 'black').length, blacks);
    const metadata = copy(changed);
    metadata.generationSequence = 3;
    metadata.sourceTicks.onBoardAll = true;
    seal(metadata);
    await f.publish(metadata, {
        assets: false
    });
    await fs.rm(path.join(f.config.sourceRoot, 'assets'), {
        recursive: true
    });
    const deadline = session.snapshot().presentation.controller.nextAdvanceAt;
    assert.equal((await runtime.dispatch('reload')).ok, true);
    assert.equal(runtime.snapshot().deckId, accepted);
    assert.equal(session.snapshot().presentation.controller.nextAdvanceAt, deadline);
});

test('actual provider proof is rechecked behind a held Auto render before changed deck dispatch',async t=>{
 const f=await actualRuntime(t,{profileChange:profile=>{profile.playback.intervalMs=1000;}}),runtime=await f.create();await runtime.start();const session=f.sessions[0].session,p=await renderer(t,session);await until(()=>runtime.snapshot().ready);
 let controller;const original=SlideshowController.prototype.dispatch;SlideshowController.prototype.dispatch=function(...args){controller=this;return original.apply(this,args);};t.after(()=>{SlideshowController.prototype.dispatch=original;});await runtime.dispatch('launch');
 const {loadExchangeSnapshot}=require('../scripts/lib/exchange-snapshot.cjs'),accepted=await loadExchangeSnapshot(f.coordinator.snapshot().lastPrepared.snapshotDir);
 const changed=source(undefined,[0,1,0]);changed.generationSequence=2;seal(changed);await f.publish(changed);const prepared=await f.driver.resolveReload({acceptedSnapshot:accepted});assert.equal(f.driver.canCommitPreparedSnapshot(prepared,accepted),true);
 p.hold(command=>command.type==='show');await until(()=>!!p.held);let autoCommit;
 controller.on('change',snapshot=>{if(snapshot.deckId===accepted.deck.id)autoCommit=snapshot.nextAdvanceAt;});
 const pending=controller.replaceDeck(prepared.deck,{canCommit:()=>f.driver.canCommitPreparedSnapshot(prepared,accepted)});
 const invalid=copy(changed);invalid.generationSequence=3;invalid.event.eligibility={eligible:false,reasonCodes:['CANCELLED']};seal(invalid);await f.publish(invalid);await f.provider.inspectSelection(invalid.identityTuple);p.release();
 assert.equal((await pending).code,'ADMISSION_DENIED');assert.equal(controller.deck.id,accepted.deck.id);assert.equal(controller.snapshot().nextAdvanceAt,autoCommit);assert.equal(p.commands.some(command=>command.type==='show'&&command.deckId===prepared.deck.id),false);
});

test('manager composes real exchange runtime and session while cancellation revokes only new admission',async t=>{
    const {createGameDayManager}=require('../scripts/lib/game-day-manager.cjs');
    const f=await actualRuntime(t);
    const manager=createGameDayManager({catalog:{list:async()=>[],read:async()=>Object.freeze({profile:f.profile,
        descriptor:Object.freeze({eventId:f.profile.eventId,displayName:'Synthetic source'}),revision:'c'.repeat(64)})},
        runtimeFactory:async()=>f.create()});
    t.after(()=>manager.close());
    const request=extra=>{const s=manager.snapshot();return{expectedEventId:s.expectedEventId,expectedSelection:s.expectedSelection,...extra};};
    const prepared=await manager.prepare(f.profile.eventId,request());assert.equal(prepared.ok,true,JSON.stringify(prepared));
    assert.equal(f.events.length,0);assert.equal(f.sessions.length,0);
    const activated=await manager.activate(request({candidateId:prepared.candidateId}));assert.equal(activated.ok,true,JSON.stringify(activated));
    const session=f.sessions[0].session,p=await renderer(t,session);
    await until(()=>manager.snapshot().active.runtime.ready);
    assert.equal((await manager.dispatch('launch',request())).ok,true);
    const before=manager.snapshot().active,black=p.commands.filter(x=>x.type==='black').length;
    const cancelled=copy(f.m);cancelled.generationSequence++;cancelled.event.eligibility={eligible:false,reasonCodes:['CANCELLED']};seal(cancelled);
    await f.publish(cancelled,{assets:false});await f.provider.refreshCatalog();
    assert.equal(admitExchangeCandidate(f.driver.admissionToken()),false);
    assert.equal((await manager.dispatch('next',request())).ok,true);
    assert.equal(p.commands.filter(x=>x.type==='black').length,black);
    assert.deepEqual(manager.snapshot().active.productionWindow,before.productionWindow);
    assert.equal((await manager.dispatch('stop',request())).ok,true);
    assert.equal(f.events.length,1);assert.equal(manager.snapshot().active.eventId,f.profile.eventId);
});
