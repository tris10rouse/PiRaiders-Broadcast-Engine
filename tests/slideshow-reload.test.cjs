'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SlideshowController } = require('../scripts/lib/slideshow-controller.cjs');
const original = { id: 'old', slides: [{ id: 'a', src: 'old-a.png' }, { id: 'b', src: 'old-b.jpg' }, { id: 'c', src: 'old-c.png' }] };
function deck(id, ids) { return { id, slides: ids.map(key => ({ id: key, src: id + '-' + key + '.png' })) }; }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function scheduler() {
  let time = 0, serial = 0; const jobs = new Map(), history = new Map();
  return { now: () => time, jobs, history,
    setTimeout(fn, ms) { const id = ++serial; jobs.set(id, { fn, due: time + ms }); history.set(id, fn); return id; },
    clearTimeout(id) { jobs.delete(id); },
    advance(ms) { time += ms; for (const [id, job] of [...jobs]) if (job.due <= time) { jobs.delete(id); job.fn(); } } };
}
function fixture(t, options = {}) {
  const clock = scheduler(), shows = [], blacks = []; let show = () => {}, black = () => {};
  const controller = new SlideshowController({ deck: original, scheduler: clock,
    renderer: { show(value) { shows.push(value); return show(value); }, black(value) { blacks.push(value); return black(value); } }, ...options });
  t.after(() => controller.close());
  return { controller, clock, shows, blacks, onShow(fn) { show = fn; }, onBlack(fn) { black = fn; } };
}

test('stopped replacement stays black, copies the ordered candidate, and cannot be bypassed through deck assignment', async t => {
  const f = fixture(t), c = f.controller, candidate = deck('prepared', ['b', 'a']);
  const result = c.replaceDeck(candidate); candidate.id = 'caller mutation'; candidate.slides[0].src = 'private path'; candidate.slides.reverse();
  assert.deepEqual(await result, { action: 'reload', ok: true });
  assert.equal(c.snapshot().deckId, 'prepared'); assert.equal(c.snapshot().state, 'stopped'); assert.equal(c.snapshot().index, null);
  assert.equal(f.shows.length, 0); assert.equal(f.blacks.length, 0); assert.equal(f.clock.jobs.size, 0);
  assert.equal(c.deck.slides[0].id, 'b'); assert.equal(c.deck.slides[0].src, 'prepared-b.png');
  assert.ok(Object.isFrozen(c.deck)); assert.ok(Object.isFrozen(c.deck.slides[0]));
  assert.throws(() => { c.deck = original; }, TypeError);
  await c.dispatch('launch'); assert.equal(f.shows[0].deckId, 'prepared'); assert.equal(c.snapshot().slide.id, 'b');
  await c.dispatch('stop'); await c.replaceDeck(deck('again', ['x']));
  assert.equal(c.snapshot().state, 'stopped'); assert.equal(c.snapshot().index, null); assert.equal(f.clock.jobs.size, 0);
});

test('playing metadata reorder retains occurrence ID and atomically commits after render with a fresh Auto interval', async t => {
  const f = fixture(t), c = f.controller;
  await c.dispatch('launch'); await c.dispatch('next'); f.clock.advance(4000);
  const stale = [...f.clock.jobs.keys()][0], gate = deferred(); f.onShow(() => gate.promise);
  const pending = c.replaceDeck(deck('new', ['c', 'a', 'b'])); await flush();
  assert.equal(c.snapshot().deckId, 'old'); assert.equal(c.snapshot().index, 1); assert.equal(c.snapshot().slide.src, 'old-b.jpg');
  assert.equal(f.shows.at(-1).deckId, 'new'); assert.equal(f.shows.at(-1).index, 2); assert.equal(f.shows.at(-1).slide.id, 'b');
  assert.equal(c.snapshot().nextAdvanceAt, null);
  f.clock.history.get(stale)(); await flush(); assert.equal(f.shows.length, 3);
  f.clock.advance(500); gate.resolve(); assert.equal((await pending).ok, true);
  assert.equal(c.snapshot().deckId, 'new'); assert.equal(c.snapshot().index, 2); assert.equal(c.snapshot().slide.src, 'new-b.png');
  assert.equal(c.snapshot().nextAdvanceAt, 14500); assert.equal(f.clock.jobs.size, 1);
  f.onShow(() => {}); f.clock.advance(9999); await flush(); assert.equal(f.shows.length, 3);
  f.clock.advance(1); await flush(); assert.equal(c.snapshot().index, 0); assert.equal(f.shows.length, 4);
});

test('queued replacement copies at enqueue but chooses occurrence only after earlier navigation commits', async t => {
  const f = fixture(t), c = f.controller; await c.dispatch('launch');
  const navigation = deferred(); f.onShow(value => value.deckId === 'old' ? navigation.promise : undefined);
  const next = c.dispatch('next'); await flush();
  const candidate = deck('new', ['b', 'c', 'a']), reload = c.replaceDeck(candidate);
  candidate.id = 'mutated'; candidate.slides[0].id = 'changed'; candidate.slides[0].src = 'private'; candidate.slides.pop();
  assert.equal(c.snapshot().queued, 1); navigation.resolve(); await next; assert.equal((await reload).ok, true);
  assert.equal(c.snapshot().deckId, 'new'); assert.equal(c.snapshot().index, 0); assert.equal(c.snapshot().slide.id, 'b');
  assert.equal(f.shows.at(-1).slide.src, 'new-b.png'); assert.equal(c.deck.slides.length, 3);
});

test('queued replacements evaluate against the preceding replacement and missing IDs fall back to slide one', async t => {
  const f = fixture(t), c = f.controller; await c.dispatch('launch'); await c.dispatch('next');
  const gate = deferred(); f.onShow(value => value.deckId === 'first' ? gate.promise : undefined);
  const first = c.replaceDeck(deck('first', ['x', 'y'])); await flush();
  const second = c.replaceDeck(deck('second', ['z', 'x']));
  assert.equal(f.shows.at(-1).index, 0); assert.equal(c.snapshot().slide.id, 'b');
  gate.resolve(); await first; await second;
  assert.deepEqual(f.shows.slice(-2).map(value => [value.deckId, value.index, value.slide.id]), [['first', 0, 'x'], ['second', 1, 'x']]);
  assert.equal(c.snapshot().slide.id, 'x'); assert.equal(c.snapshot().deckId, 'second');
});

test('failed replacement keeps the full previous deck and suspends Auto until explicit successful recovery', async t => {
  const f = fixture(t), c = f.controller; await c.dispatch('launch'); await c.dispatch('next');
  f.onShow(value => { if (value.deckId !== 'old') throw Error('/private/drive/student.png'); });
  const result = await c.replaceDeck(deck('bad', ['x']));
  assert.deepEqual(result, { action: 'reload', ok: false, code: 'RENDER_FAILED' });
  assert.ok(Object.isFrozen(result)); assert.ok(!JSON.stringify(result).includes('private'));
  assert.equal(c.snapshot().deckId, 'old'); assert.equal(c.snapshot().slide.id, 'b'); assert.equal(c.snapshot().autoSuspended, true);
  assert.equal(f.clock.jobs.size, 0); f.clock.advance(50000); await flush(); assert.equal(f.shows.length, 3);
  await c.dispatch('next'); assert.equal(c.snapshot().slide.id, 'c'); assert.equal(c.snapshot().autoSuspended, false);
  f.onShow(() => {}); await c.replaceDeck(deck('recovered', ['c', 'a'])); assert.equal(c.snapshot().deckId, 'recovered');
});

test('invalid candidates, signals and options return fixed failures; bare Reload never resolves media', async t => {
  const f = fixture(t), c = f.controller, candidate = deck('new', ['a']);
  for (const value of [null, {}, deck('empty', []), { ...candidate, private: true }, { id: 'x', slides: [candidate.slides[0], candidate.slides[0]] },
    { get id() { throw Error('/private/student'); }, slides: candidate.slides }]) {
    assert.deepEqual(await c.replaceDeck(value), { action: 'reload', ok: false, code: 'INVALID_DECK' });
  }
  for (const options of [null, [], 'x', { arbitrary: true }, { get signal() { throw Error('private'); } }])
    assert.deepEqual(await c.replaceDeck(candidate, options), { action: 'reload', ok: false, code: 'INVALID_OPTIONS' });
  assert.deepEqual(await c.replaceDeck(candidate, { signal: {} }), { action: 'reload', ok: false, code: 'INVALID_SIGNAL' });
  const abort = new AbortController(); abort.abort();
  assert.deepEqual(await c.replaceDeck(candidate, { signal: abort.signal }), { action: 'reload', ok: false, code: 'CANCELLED' });
  assert.equal((await c.dispatch('reload')).code, 'UNKNOWN_ACTION'); assert.equal(c.snapshot().deckId, 'old'); assert.equal(f.shows.length, 0);
});

test('repeated replacements obey the existing bounded FIFO instead of unbounded or hidden coalescing', async t => {
  const f = fixture(t, { maxQueue: 2 }), c = f.controller; await c.dispatch('launch');
  const gate = deferred(); f.onShow(value => value.deckId === 'first' ? gate.promise : undefined);
  const active = c.replaceDeck(deck('first', ['a'])); await flush();
  const second = c.replaceDeck(deck('second', ['a'])), third = c.replaceDeck(deck('third', ['a']));
  for (let index = 0; index < 100; index++) assert.equal((await c.replaceDeck(deck('overflow', ['a']))).code, 'BUSY');
  assert.equal(c.snapshot().queued, 2); assert.equal(c.snapshot().outstandingRenders, 1);
  gate.resolve(); await active; await second; await third;
  assert.deepEqual(f.shows.map(value => value.deckId), ['old', 'first', 'second', 'third']);
});

test('queued cancellation drops only that candidate and cannot change the active deck', async t => {
  const f = fixture(t), c = f.controller; await c.dispatch('launch');
  const gate = deferred(); f.onShow(value => value.deckId === 'old' ? gate.promise : undefined);
  const next = c.dispatch('next'); await flush(); const abort = new AbortController();
  const pending = c.replaceDeck(deck('cancelled', ['a']), { signal: abort.signal });
  abort.abort(); assert.equal((await pending).code, 'CANCELLED'); assert.equal(c.snapshot().queued, 0);
  gate.resolve(); await next; assert.equal(c.snapshot().deckId, 'old'); assert.equal(c.snapshot().slide.id, 'b');
  assert.equal(f.shows.some(value => value.deckId === 'cancelled'), false);
});

test('active cancellation preserves the old deck and serial barrier even when the canceled adapter rejects late', async t => {
  const f = fixture(t), c = f.controller; await c.dispatch('launch');
  const gate = deferred(); f.onShow(value => value.deckId === 'candidate' ? gate.promise : undefined);
  const abort = new AbortController(), pending = c.replaceDeck(deck('candidate', ['a']), { signal: abort.signal }); await flush();
  abort.abort(); assert.equal((await pending).code, 'CANCELLED'); assert.equal(f.shows.at(-1).signal.aborted, true);
  assert.equal(c.snapshot().autoSuspended, true); assert.equal(f.clock.jobs.size, 1); // canceled adapter watchdog only
  const next = c.dispatch('next'); await flush(); assert.equal(f.shows.length, 2); assert.equal(c.snapshot().deckId, 'old');
  gate.reject(Error('late cancellation failure')); await next;
  assert.equal(c.snapshot().slide.id, 'b'); assert.equal(c.snapshot().deckId, 'old'); assert.equal(c.snapshot().autoSuspended, false);
});

test('Stop preempts active and queued replacements; late render success cannot activate their decks', async t => {
  const f = fixture(t), c = f.controller; await c.dispatch('launch');
  const gate = deferred(); f.onShow(value => value.deckId === 'candidate' ? gate.promise : undefined);
  const active = c.replaceDeck(deck('candidate', ['x'])); await flush();
  const queued = c.replaceDeck(deck('queued', ['x'])), stop = c.dispatch('stop');
  assert.equal((await active).code, 'CANCELLED'); assert.equal((await queued).code, 'CANCELLED'); await stop;
  for (let index = 0; index < 20; index++) assert.equal(c.dispatch('stop'), stop);
  assert.equal(f.blacks.length, 1); assert.equal(c.snapshot().state, 'stopped'); assert.equal(c.snapshot().deckId, 'old');
  gate.resolve(); await flush(); assert.equal(c.snapshot().state, 'stopped'); assert.equal(c.snapshot().index, null);
  assert.equal(c.snapshot().deckId, 'old'); assert.equal(f.clock.jobs.size, 0);
});

test('a preempted stuck Reload retains its independent watchdog through repeated Stop and faults terminally', async t => {
  const f = fixture(t, { handlerTimeoutMs: 100 }), c = f.controller; await c.dispatch('launch');
  const gate = deferred(); f.onShow(value => value.deckId === 'stuck' ? gate.promise : undefined);
  const pending = c.replaceDeck(deck('stuck', ['x'])); await flush(); f.clock.advance(20);
  const stop = c.dispatch('stop'); await pending; await stop;
  for (let index = 0; index < 100; index++) assert.equal(c.dispatch('stop'), stop);
  const recovery = c.replaceDeck(deck('later', ['x'])); await flush(); assert.equal(f.shows.length, 2);
  f.clock.advance(80); assert.equal((await recovery).code, 'CANCELLED'); assert.equal(c.snapshot().faulted, true);
  assert.equal(c.snapshot().deckId, 'old'); assert.equal(c.snapshot().state, 'faulted'); assert.equal(f.blacks.length, 1);
  gate.reject(Error('late')); await flush(); assert.equal(c.snapshot().deckId, 'old');
});

test('Reload render timeout is terminal, retains prior deck, and cancels every queued activation', async t => {
  const f = fixture(t, { handlerTimeoutMs: 50 }), c = f.controller; await c.dispatch('launch');
  const gate = deferred(); f.onShow(() => gate.promise);
  const pending = c.replaceDeck(deck('timed-out', ['x'])); await flush();
  const queued = c.replaceDeck(deck('queued', ['x'])); f.clock.advance(50);
  assert.equal((await pending).code, 'RENDER_TIMEOUT'); assert.equal((await queued).code, 'CANCELLED');
  assert.equal(c.snapshot().deckId, 'old'); assert.equal(c.snapshot().slide.id, 'a'); assert.equal(c.snapshot().faulted, true);
  assert.equal((await c.replaceDeck(deck('future', ['x']))).code, 'FAULTED');
  gate.resolve(); await flush(); assert.equal(c.snapshot().deckId, 'old'); assert.equal(c.snapshot().state, 'faulted');
});

test('externally canceled stuck Reload still faults rather than permitting concurrent candidate renders', async t => {
  const f = fixture(t, { handlerTimeoutMs: 50 }), c = f.controller; await c.dispatch('launch');
  const gate = deferred(); f.onShow(() => gate.promise); const abort = new AbortController();
  const pending = c.replaceDeck(deck('cancelled', ['x']), { signal: abort.signal }); await flush(); abort.abort(); await pending;
  const queued = c.replaceDeck(deck('later', ['x'])); f.clock.advance(50);
  assert.equal((await queued).code, 'CANCELLED'); assert.equal(c.snapshot().faulted, true); assert.equal(f.shows.length, 2);
  gate.resolve(); await flush(); assert.equal(c.snapshot().deckId, 'old');
});

test('close cancels active/queued replacements promptly and late acknowledgments cannot commit', async t => {
  const f = fixture(t), c = f.controller; await c.dispatch('launch'); const gate = deferred(); f.onShow(() => gate.promise);
  const active = c.replaceDeck(deck('candidate', ['x'])); await flush(); const queued = c.replaceDeck(deck('queued', ['x']));
  await c.close(); assert.equal((await active).code, 'CANCELLED'); assert.equal((await queued).code, 'CANCELLED');
  assert.equal(f.shows.at(-1).signal.aborted, true); assert.equal(c.snapshot().deckId, 'old'); assert.equal(f.clock.jobs.size, 0);
  assert.equal((await c.replaceDeck(deck('late', ['x']))).code, 'CLOSED'); gate.resolve(); await flush();
  assert.equal(c.snapshot().state, 'closed'); assert.equal(c.snapshot().deckId, 'old'); assert.equal(c.snapshot().slide.id, 'a');
});
