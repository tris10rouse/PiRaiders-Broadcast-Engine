'use strict';

const test = require('node:test'), assert = require('node:assert/strict');

const {
    SlideshowController
} = require('../scripts/lib/slideshow-controller.cjs');

const deck = id => ({
    id: id,
    slides: [ {
        id: 'one',
        src: id + '/one.png'
    }, {
        id: 'two',
        src: id + '/two.png'
    } ]
});

function latch() {
    let resolve;
    const promise = new Promise(r => resolve = r);
    return {
        promise: promise,
        resolve: resolve
    };
}

function clock() {
    let time = 0, id = 0;
    const timers = new Map();
    return {
        now: () => time,
        setTimeout(fn, ms) {
            const token = ++id;
            timers.set(token, {
                fn: fn,
                at: time + ms
            });
            return token;
        },
        clearTimeout(token) {
            timers.delete(token);
        },
        tick(ms) {
            time += ms;
            const due = [ ...timers ].filter(([ , v ]) => v.at <= time);
            for (const [ key, value ] of due) {
                if (timers.delete(key)) value.fn();
            }
        }
    };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('queued changed Reload rechecks at actual renderer dispatch after held Auto and denial preserves its committed timer/index', async t => {
    const scheduler = clock(), entered = latch(), gate = latch();
    let shows = 0, allowed = true, checks = 0, autoCommit;
    const controller = new SlideshowController({
        deck: deck('accepted'),
        mode: 'auto',
        intervalMs: 100,
        scheduler: scheduler,
        renderer: {
            async show() {
                if (++shows === 2) {
                    entered.resolve();
                    await gate.promise;
                }
            },
            black() {}
        }
    });
    t.after(() => controller.close());
    await controller.dispatch('launch');
    scheduler.tick(100);
    await entered.promise;
    const pending = controller.replaceDeck(deck('changed'), {
        canCommit: () => {
            checks++;
            return allowed;
        }
    });
    assert.equal(checks, 0);
    controller.on('change', snapshot => {
        if (snapshot.deckId === 'accepted' && snapshot.index === 1) autoCommit = snapshot.nextAdvanceAt;
    });
    allowed = false;
    gate.resolve();
    const result = await pending;
    await flush();
    assert.equal(result.code, 'ADMISSION_DENIED');
    assert.equal(checks, 1);
    assert.equal(shows, 2);
    assert.equal(controller.deck.id, 'accepted');
    assert.equal(controller.index, 1);
    assert.equal(controller.snapshot().nextAdvanceAt, autoCommit);
    assert.equal(autoCommit, 200);
});

test('stopped and playing guards accept only literal true, consume rejected Promise and never mutate on denial', async () => {
    for (const playing of [ false, true ]) for (const guard of [ () => false, () => ({}), () => Promise.resolve(true), () => Promise.reject(Error('PRIVATE')), () => {
        throw Error('PRIVATE');
    } ]) {
        let shows = 0, blacks = 0;
        const controller = new SlideshowController({
            deck: deck('accepted'),
            mode: 'auto',
            intervalMs: 6e4,
            renderer: {
                show() {
                    shows++;
                },
                black() {
                    blacks++;
                }
            }
        });
        if (playing) await controller.dispatch('launch');
        const before = controller.snapshot(), count = shows;
        assert.equal((await controller.replaceDeck(deck('changed'), {
            canCommit: guard
        })).code, 'ADMISSION_DENIED');
        const after = controller.snapshot();
        for (const key of [ 'deckId', 'index', 'mode', 'nextAdvanceAt' ]) assert.equal(after[key], before[key]);
        assert.equal(shows, count);
        assert.equal(blacks, 0);
        await controller.close();
    }
    const controller = new SlideshowController({
        deck: deck('accepted'),
        renderer: {
            show() {},
            black() {}
        }
    });
    assert.equal((await controller.replaceDeck(deck('changed'), {
        canCommit: () => true
    })).ok, true);
    assert.equal(controller.deck.id, 'changed');
    await controller.close();
});

test('literal true after reentrant Stop, close or abort cannot install or render changed content', async t => {
    for (const playing of [false, true]) for (const interrupt of ['stop', 'close', 'abort']) await t.test(`${playing ? 'playing' : 'stopped'}/${interrupt}`, async () => {
        let shows = 0, blacks = 0, interruption;
        const signal = new AbortController();
        const controller = new SlideshowController({
            deck: deck('accepted'), mode: 'manual',
            renderer: {show() { shows++; }, black() { blacks++; }}
        });
        try {
            if (playing) await controller.dispatch('launch');
            const beforeShows = shows;
            const pending = controller.replaceDeck(deck('changed'), {
                signal: signal.signal,
                canCommit() {
                    if (interrupt === 'stop') interruption = controller.dispatch('stop');
                    else if (interrupt === 'close') interruption = controller.close();
                    else signal.abort();
                    return true;
                }
            });
            assert.equal((await pending).code, 'CANCELLED', `${playing}/${interrupt}`);
            await interruption;
            await flush();
            assert.equal(shows, beforeShows, `${playing}/${interrupt}: cancelled candidate rendered`);
            assert.equal(controller.deck.id, 'accepted', `${playing}/${interrupt}: cancelled candidate installed`);
            assert.equal(controller.mode, 'manual');
            if (interrupt === 'stop') {
                assert.equal(controller.snapshot().state, 'stopped');
                assert.equal(controller.snapshot().index, null);
                assert.equal(blacks, 1);
            } else if (interrupt === 'close') {
                assert.equal(controller.snapshot().state, 'closed');
                assert.equal(controller.snapshot().closed, true);
                assert.equal(blacks, 0);
            } else {
                assert.equal(controller.snapshot().state, playing ? 'playing' : 'stopped');
                assert.equal(controller.snapshot().index, playing ? 0 : null);
                assert.equal(blacks, 0);
            }
            assert.equal(controller.snapshot().busy, false);
            assert.equal(controller.snapshot().outstandingRenders, 0);
        } finally { await controller.close(); }
    });
});
