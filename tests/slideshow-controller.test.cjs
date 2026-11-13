'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SlideshowController, normalizeDeck } = require('../scripts/lib/slideshow-controller.cjs');
const deck = { id: 'game', slides: [{ id: 'a', src: 'first.png' }, { id: 'b', src: 'second.jpg' }, { id: 'c', src: 'third.png' }] };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function scheduler() {
  let time = 0, serial = 0; const jobs = new Map(), history = new Map();
  return { now: () => time, setTimeout: (fn, ms) => { const id = ++serial; jobs.set(id, { fn, due: time + ms }); history.set(id, fn); return id; },
    clearTimeout: id => jobs.delete(id), jobs, history,
    advance: ms => { time += ms; for (const [id, job] of [...jobs]) if (job.due <= time) { jobs.delete(id); job.fn(); } } };
}
function fixture(options = {}) {
  const clock = scheduler(), shown = [], blacks = [];
  const renderer = { show: async value => { shown.push(value); }, black: async value => { blacks.push(value); } };
  const controller = new SlideshowController({ deck, renderer, scheduler: clock, ...options });
  return { controller, clock, shown, blacks };
}

test('deck validation copies and freezes ordered data without interpreting source strings', () => {
  const raw = { id: 'x', slides: [{ id: '1', src: 'opaque local source string' }] };
  const normalized = normalizeDeck(raw); raw.slides[0].src = 'changed';
  assert.equal(normalized.slides[0].src, 'opaque local source string');
  assert.ok(Object.isFrozen(normalized)); assert.ok(Object.isFrozen(normalized.slides)); assert.ok(Object.isFrozen(normalized.slides[0]));
  for (const value of [null, {}, { id: 'x', slides: [] }, { id: 'x', slides: Array(1) }, { id: 'x', slides: [{ id: '1', src: '' }] },
    { id: 'x', slides: [deck.slides[0], deck.slides[0]] }, { ...deck, extra: true }]) assert.throws(() => normalizeDeck(value));
});
test('configuration rejects invalid boundaries and pre-aborted commands never reach the adapter', async () => {
  for (const options of [{ intervalMs: 0 }, { intervalMs: 1.5 }, { maxQueue: 0 }, { handlerTimeoutMs: 60001 },
    { mode: 'random' }, { transition: { type: 'cut', durationMs: 1 } }, { transition: { type: 'fade', durationMs: -1 } },
    { renderer: {} }, { scheduler: {} }]) assert.throws(() => fixture(options));
  const { controller: c, shown } = fixture(); const abort = new AbortController(); abort.abort();
  assert.equal((await c.dispatch({ action: 'launch', signal: abort.signal })).code, 'CANCELLED');
  assert.equal((await c.dispatch({ action: 'launch', signal: {} })).code, 'INVALID_SIGNAL');
  assert.equal(shown.length, 0); await c.close();
});
test('launch, wrapping navigation, repeated launch and black stop preserve explicit lifecycle', async () => {
  const { controller: c, shown, blacks } = fixture();
  assert.equal((await c.dispatch('next')).code, 'NOT_PLAYING');
  await c.dispatch('launch'); assert.equal(c.snapshot().index, 0);
  await c.dispatch('previous'); assert.equal(c.snapshot().index, 2);
  await c.dispatch('next'); assert.equal(c.snapshot().index, 0);
  await c.dispatch('next'); await c.dispatch('launch'); assert.equal(c.snapshot().index, 0);
  assert.deepEqual(shown.map(item => item.index), [0, 2, 0, 1, 0]);
  assert.deepEqual(shown[0].transition, { type: 'cut', durationMs: 0 });
  await c.dispatch('stop'); assert.equal(blacks.length, 1); assert.equal(c.snapshot().state, 'stopped'); assert.equal(c.snapshot().index, null);
  assert.equal((await c.dispatch('previous')).code, 'NOT_PLAYING'); assert.equal((await c.dispatch('reload')).code, 'UNKNOWN_ACTION');
  assert.ok(Object.isFrozen(c.snapshot())); await c.close();
});
test('one-slide deck wraps and immutable fade intent reaches renderer', async () => {
  const { controller: c, shown } = fixture({ deck: { id: 'one', slides: [deck.slides[0]] }, transition: { type: 'fade', durationMs: 900 } });
  await c.dispatch('launch'); await c.dispatch('next'); await c.dispatch('previous');
  assert.deepEqual(shown.map(item => item.index), [0, 0, 0]); assert.deepEqual(shown[0].transition, { type: 'fade', durationMs: 900 });
  assert.ok(Object.isFrozen(shown[0])); assert.ok(Object.isFrozen(shown[0].transition)); await c.close();
});
test('Auto while stopped selects mode without starting output or an advance timer', async () => {
  const { controller: c, clock, shown } = fixture({ mode: 'manual' });
  await c.dispatch('auto'); assert.equal(c.snapshot().mode, 'auto'); assert.equal(c.snapshot().state, 'stopped');
  clock.advance(50000); await flush(); assert.equal(shown.length, 0); assert.equal(clock.jobs.size, 0); await c.close();
});
test('default auto uses one fenced 10 second timer, late tick once, manual navigation resets full interval', async () => {
  const { controller: c, clock, shown } = fixture();
  await c.dispatch('launch'); assert.equal(c.snapshot().mode, 'auto'); assert.equal(c.snapshot().nextAdvanceAt, 10000);
  const stale = [...clock.jobs.keys()][0]; clock.advance(5000); await c.dispatch('next');
  assert.equal(c.snapshot().nextAdvanceAt, 15000); clock.history.get(stale)(); await flush(); assert.equal(shown.length, 2);
  clock.advance(9000); await flush(); assert.equal(shown.length, 2);
  clock.advance(31000); await flush(); assert.equal(shown.length, 3); assert.equal(c.snapshot().nextAdvanceAt, 55000);
  assert.equal(clock.jobs.size, 1); await c.dispatch('manual'); assert.equal(clock.jobs.size, 0);
  clock.advance(100000); await flush(); assert.equal(shown.length, 3);
  await c.dispatch('toggle-auto'); assert.equal(c.snapshot().nextAdvanceAt, clock.now() + 10000); await c.close();
});
test('normal async dispatch is FIFO and bounded, index commits only after renderer success', async () => {
  const gate = deferred(), calls = [];
  const { controller: c } = fixture({ maxQueue: 1, renderer: { show: value => { calls.push(value.index); return calls.length === 1 ? gate.promise : undefined; }, black: async () => {} } });
  const launch = c.dispatch('launch'); await flush(); const next = c.dispatch('next');
  assert.equal((await c.dispatch('previous')).code, 'BUSY'); assert.equal(c.snapshot().index, null);
  gate.resolve(); assert.equal((await launch).ok, true); await next;
  assert.deepEqual(calls, [0, 1]); assert.equal(c.snapshot().index, 1); await c.close();
});
test('render rejection retains committed frame, sanitizes failure and suspends auto until explicit recovery', async () => {
  let fail = false; const results = [];
  const { controller: c, clock } = fixture({ renderer: { show: async () => { if (fail) throw Error('private data'); }, black: async () => {} } });
  c.on('result', value => results.push(value)); await c.dispatch('launch'); fail = true;
  clock.advance(10000); await flush(); assert.equal(c.snapshot().index, 0); assert.equal(c.snapshot().autoSuspended, true); assert.equal(clock.jobs.size, 0);
  assert.equal(results.at(-1).code, 'RENDER_FAILED'); assert.ok(!JSON.stringify(results).includes('private'));
  clock.advance(50000); await flush(); assert.equal(results.length, 2);
  fail = false; await c.dispatch('next'); assert.equal(c.snapshot().index, 1); assert.equal(c.snapshot().autoSuspended, false); assert.equal(clock.jobs.size, 1); await c.close();
});
test('failed launch stays stopped and failed black retains the last confirmed slide with auto suspended', async () => {
  let fail = true;
  const { controller: c, clock } = fixture({ renderer: { show: async () => { if (fail) throw Error('unavailable'); }, black: async () => { throw Error('unavailable'); } } });
  assert.equal((await c.dispatch('launch')).code, 'RENDER_FAILED'); assert.equal(c.snapshot().state, 'stopped'); assert.equal(c.snapshot().index, null);
  fail = false; await c.dispatch('launch'); const stale = [...clock.jobs.keys()][0];
  assert.equal((await c.dispatch('stop')).code, 'RENDER_FAILED');
  assert.equal(c.snapshot().state, 'playing'); assert.equal(c.snapshot().index, 0); assert.equal(c.snapshot().autoSuspended, true);
  clock.history.get(stale)(); await flush(); assert.equal(c.snapshot().index, 0); assert.equal(clock.jobs.size, 0); await c.close();
});
test('Stop preempts a transition and queued work, blacks and fences a late callback', async () => {
  const gate = deferred(), calls = [], black = [];
  const { controller: c, clock } = fixture({ renderer: { show: value => { calls.push(value); return calls.length === 2 ? gate.promise : undefined; }, black: async value => black.push(value) } });
  await c.dispatch('launch'); const next = c.dispatch('next'); await flush(); const queued = c.dispatch('previous');
  const stop = c.dispatch('stop'); assert.equal((await next).code, 'CANCELLED'); assert.equal((await queued).code, 'CANCELLED');
  await stop; assert.equal(calls[1].signal.aborted, true); assert.equal(black.length, 1); assert.equal(c.snapshot().state, 'stopped');
  gate.resolve(); await flush(); assert.equal(c.snapshot().index, null); assert.equal(clock.jobs.size, 0); await c.close();
});
test('twenty rapid Stops collapse to one stuck black and its watchdog faults terminally', async () => {
  const black = deferred(), calls = [];
  const { controller: c, clock } = fixture({ handlerTimeoutMs: 50, renderer: { show: async () => {}, black: value => { calls.push(value); return black.promise; } } });
  const stop = c.dispatch('stop'); await flush();
  for (let i = 0; i < 20; i++) assert.equal(c.dispatch('stop'), stop);
  await flush(); assert.equal(calls.length, 1); assert.equal(c.snapshot().outstandingRenders, 1);
  clock.advance(50); assert.equal((await stop).code, 'RENDER_TIMEOUT'); assert.equal(c.snapshot().faulted, true);
  assert.equal(calls[0].signal.aborted, true); black.resolve(); await flush(); assert.equal(c.snapshot().state, 'faulted'); await c.close();
});
test('completed black retains orphan show barrier; repeated Stops reuse outcome and late show cannot commit', async () => {
  const original = deferred(), shows = [], blacks = [];
  const { controller: c } = fixture({ renderer: { show: value => { shows.push(value); return shows.length === 1 ? original.promise : undefined; }, black: async value => { blacks.push(value); } } });
  const launch = c.dispatch('launch'); await flush(); const stop = c.dispatch('stop');
  assert.equal((await launch).code, 'CANCELLED'); await stop;
  assert.equal(c.snapshot().state, 'stopped'); assert.equal(c.snapshot().outstandingRenders, 1);
  const queued = c.dispatch('launch'); await flush(); assert.equal(shows.length, 1);
  for (let i = 0; i < 20; i++) assert.equal(c.dispatch('stop'), stop);
  assert.equal((await queued).code, 'CANCELLED'); assert.equal(blacks.length, 1);
  const recovery = c.dispatch('launch'); await flush(); assert.equal(shows.length, 1);
  original.resolve(); await recovery; assert.equal(shows.length, 2); assert.equal(c.snapshot().index, 0);
  await c.dispatch('stop'); assert.equal(blacks.length, 2); await c.close();
});
test('one preempted show plus pending black is the render bound; orphan watchdog cancels queued recovery', async () => {
  const original = deferred(), black = deferred(), shows = [], blacks = [];
  const { controller: c, clock } = fixture({ handlerTimeoutMs: 100, renderer: { show: value => { shows.push(value); return original.promise; }, black: value => { blacks.push(value); return black.promise; } } });
  const launch = c.dispatch('launch'); await flush(); clock.advance(20); const stop = c.dispatch('stop'); await flush();
  await launch; for (let i = 0; i < 20; i++) c.dispatch('stop');
  assert.equal(c.snapshot().outstandingRenders, 2); assert.equal(shows.length, 1); assert.equal(blacks.length, 1);
  black.resolve(); await stop; const recovery = c.dispatch('launch'); await flush(); assert.equal(shows.length, 1);
  clock.advance(80); assert.equal((await recovery).code, 'CANCELLED'); assert.equal(c.snapshot().state, 'faulted');
  original.reject(Error('late failure')); await flush(); assert.equal(c.snapshot().index, null); assert.equal(c.snapshot().state, 'faulted'); await c.close();
});
test('external queued abort cancels without render; in-flight abort retains serial barrier until adapter settles', async () => {
  const gate = deferred(), calls = [];
  const { controller: c } = fixture({ renderer: { show: value => { calls.push(value); return calls.length === 1 ? gate.promise : undefined; }, black: async () => {} } });
  const activeSignal = new AbortController(), queuedSignal = new AbortController();
  const active = c.dispatch({ action: 'launch', signal: activeSignal.signal }); await flush();
  const queued = c.dispatch({ action: 'launch', signal: queuedSignal.signal }); queuedSignal.abort(); assert.equal((await queued).code, 'CANCELLED');
  activeSignal.abort(); assert.equal((await active).code, 'CANCELLED'); assert.equal(calls[0].signal.aborted, true);
  const later = c.dispatch('launch'); await flush(); assert.equal(calls.length, 1); assert.equal(c.snapshot().index, null);
  gate.resolve(); await later; assert.equal(calls.length, 2); assert.equal(c.snapshot().index, 0); await c.close();
});
test('render timeout is terminal, aborts stuck adapter, cancels queue and ignores late resolution', async () => {
  const gate = deferred(), calls = [], faults = [];
  const { controller: c, clock } = fixture({ handlerTimeoutMs: 50, renderer: { show: value => { calls.push(value); return gate.promise; }, black: async () => assert.fail('must not render around a timed-out adapter') } });
  c.on('fault', value => faults.push(value)); const pending = c.dispatch('launch'); await flush(); const queued = c.dispatch('launch');
  clock.advance(50); assert.equal((await pending).code, 'RENDER_TIMEOUT'); assert.equal((await queued).code, 'CANCELLED');
  assert.equal(calls[0].signal.aborted, true); assert.equal((await c.dispatch('stop')).code, 'FAULTED');
  gate.resolve(); await flush(); assert.equal(c.snapshot().index, null); assert.equal(c.snapshot().state, 'faulted'); assert.equal(calls.length, 1);
  assert.deepEqual(faults, [{ code: 'RENDER_TIMEOUT' }]); await c.close();
});
test('an externally aborted stuck renderer still reaches terminal timeout without dispatching successors', async () => {
  const calls = [];
  const { controller: c, clock } = fixture({ handlerTimeoutMs: 25, renderer: { show: value => { calls.push(value); return new Promise(() => {}); }, black: async () => {} } });
  const abort = new AbortController(); const active = c.dispatch({ action: 'launch', signal: abort.signal }); await flush(); abort.abort();
  assert.equal((await active).code, 'CANCELLED'); const queued = c.dispatch('launch');
  clock.advance(25); assert.equal((await queued).code, 'CANCELLED'); assert.equal(c.snapshot().faulted, true); assert.equal(calls.length, 1); await c.close();
});
test('close/dispose completes without waiting on stuck renderer and prevents all late state commits', async () => {
  const gate = deferred(), calls = [];
  const { controller: c, clock } = fixture({ renderer: { show: value => { calls.push(value); return gate.promise; }, black: async () => assert.fail() } });
  const launch = c.dispatch('launch'); await flush(); await c.dispose(); assert.equal((await launch).code, 'CANCELLED');
  assert.equal(calls[0].signal.aborted, true); assert.equal(clock.jobs.size, 0); assert.equal((await c.dispatch('launch')).code, 'CLOSED');
  gate.resolve(); await flush(); assert.equal(c.snapshot().state, 'closed'); assert.equal(c.snapshot().index, null);
});


test('fade defaults to one second and its watchdog must exceed its duration', async () => {
  const { controller: c, shown } = fixture({ transition: { type: 'fade' } });
  await c.dispatch('launch'); assert.equal(shown[0].transition.durationMs, 1000); await c.close();
  assert.throws(() => fixture({ transition: { type: 'fade', durationMs: 2000 } }));
  const configured = fixture({ transition: { type: 'fade', durationMs: 3000 }, handlerTimeoutMs: 4000 });
  await configured.controller.dispatch('launch'); assert.equal(configured.shown[0].transition.durationMs, 3000);
  await configured.controller.close();
});
