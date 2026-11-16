'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const {createExchangeJournal, EXCHANGE_JOURNAL_LIMITS: LIMITS} = require('../scripts/lib/exchange-journal.cjs');
const {canonicalExchangeJSON} = require('../scripts/lib/exchange-fingerprints.cjs');
const STORE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const FEED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const confirmation = {type: 'confirm-binding', expectedRevision: 0, confirm: true, expectedBinding: null, binding: {feedId: FEED, epoch: 1}};
const catalog = {type: 'catalog', expectedRevision: 1, feedId: FEED, epoch: 1, catalogSequence: 1, digest: 'a'.repeat(64)};
const name = n => String(n).padStart(12, '0') + '.json';
const bytes = value => canonicalExchangeJSON(value) + '\n';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const request = (head, event = confirmation) => ({expectedStoreId: STORE, expectedRevision: head.revision, expectedHeadSha256: head.headSha256, event});

if (process.argv[2] === '--journal-child') {
  const [directory, serialized, barrier] = process.argv.slice(3);
  async function phase(current) {
    if (current !== barrier) return;
    process.send({type: 'barrier', phase: current});
    await new Promise(resolve => process.once('message', resolve));
  }
  const io = {...fsp, async open(...args) {
    const handle = await fsp.open(...args);
    if (args[1] !== 'wx' || barrier !== 'partial-write') return handle;
    return {close: handle.close.bind(handle), sync: handle.sync.bind(handle), async writeFile(value) {
      await handle.writeFile(value.subarray(0, 10)); await phase('partial-write'); await handle.writeFile(value.subarray(10));
    }};
  }};
  const journal = createExchangeJournal({io, phase});
  const input = JSON.parse(serialized);
  const operation = input.initialize ? (async () => {await phase('initialize-start'); return journal.initialize(directory, input.storeId);})() : journal.append(directory, input);
  operation.then(result => process.send({type: 'result', result}, () => {
    process.disconnect();
  }));
} else {
  const test = require('node:test');
  const assert = require('node:assert/strict');
  async function fixture(t) {
    const parent = await fsp.mkdtemp(path.join(os.tmpdir(), 'piraiders-journal-'));
    t.after(() => fsp.rm(parent, {recursive: true, force: true, maxRetries: 10, retryDelay: 100}));
    return {parent, directory: path.join(parent, 'ledger')};
  }
  async function initialized(t) {
    const value = await fixture(t), journal = createExchangeJournal();
    const head = await journal.initialize(value.directory, STORE); assert.equal(head.ok, true, head.code);
    return {...value, journal, head};
  }
  function rejected(result, code) {
    assert.deepEqual(result, {ok: false, scope: 'exchange-journal', ready: false, code});
  }
  function child(t, directory, input, barrier) {
    const process = cp.fork(__filename, ['--journal-child', directory, JSON.stringify(input), barrier], {stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: []});
    const messages = [], waits = [];
    process.on('message', value => {
      const index = waits.findIndex(wait => wait.type === value.type);
      if (index < 0) messages.push(value); else waits.splice(index, 1)[0].resolve(value);
    });
    const exit = new Promise(resolve => process.once('exit', (code, signal) => resolve({code, signal})));
    t.after(async () => { if (process.exitCode === null && process.signalCode === null) process.kill('SIGKILL'); await exit; });
    return {process, exit, next(type) {
      const index = messages.findIndex(value => value.type === type);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Child barrier timed out')), 15000);
        waits.push({type, resolve(value) {clearTimeout(timer); resolve(value);}});
      });
    }};
  }
  test('explicit initialization, replay and expected store identity never silently create or reset a store', async t => {
    const {directory} = await fixture(t), journal = createExchangeJournal();
    rejected(await journal.open(directory, STORE), 'JOURNAL_MISSING');
    await assert.rejects(fsp.stat(directory), {code: 'ENOENT'});
    const initial = await journal.initialize(directory, STORE);
    assert.equal(initial.ok, true); assert.equal(initial.revision, 0); assert.equal(initial.ready, false);
    assert.equal(Object.isFrozen(initial.state), true); assert.equal(initial.committed, true);
    const reopened = await journal.open(directory, STORE); assert.equal(reopened.headSha256, initial.headSha256);
    rejected(await journal.initialize(directory, STORE), 'JOURNAL_EXISTS');
    rejected(await journal.open(directory, OTHER), 'JOURNAL_INVALID');
    await fsp.unlink(path.join(directory, name(0)));
    rejected(await journal.open(directory, STORE), 'JOURNAL_INVALID');
    rejected(await journal.initialize(directory, STORE), 'JOURNAL_EXISTS');
  });
  test('independent initializers race exclusive mkdir and only one store identity is created', {timeout: 25000}, async t => {
    const {directory} = await fixture(t), journal = createExchangeJournal();
    const left = child(t, directory, {initialize: true, storeId: STORE}, 'initialize-start');
    const right = child(t, directory, {initialize: true, storeId: OTHER}, 'initialize-start');
    await Promise.all([left.next('barrier'), right.next('barrier')]); left.process.send('continue'); right.process.send('continue');
    const results = (await Promise.all([left.next('result'), right.next('result')])).map(value => value.result);
    assert.equal(results.filter(value => value.ok).length, 1);
    assert.equal(results.filter(value => value.code === 'JOURNAL_EXISTS').length, 1);
    const winner = results.find(value => value.ok); const reopened = await journal.open(directory, winner.storeId);
    assert.equal(reopened.ok, true); assert.equal(reopened.headSha256, winner.headSha256); assert.equal(reopened.revision, 0);
    assert.deepEqual(await fsp.readdir(directory), [name(0)]);
    await Promise.all([left.exit, right.exit]);
  });
  test('append replays trusted facts with exact parent revision/hash CAS and immutable non-ready acknowledgement', async t => {
    const {directory, journal, head} = await initialized(t), input = request(head);
    rejected(await journal.append(directory, {...input, expectedHeadSha256: 'f'.repeat(64)}), 'JOURNAL_CONFLICT');
    rejected(await journal.append(directory, {...input, expectedRevision: 1}), 'JOURNAL_CONFLICT');
    const bound = await journal.append(directory, input);
    assert.equal(bound.ok, true); assert.equal(bound.revision, 1); assert.equal(bound.committed, true); assert.equal(bound.ready, false);
    assert.equal(Object.isFrozen(bound.state.feeds), true); assert.equal(input.event, confirmation);
    rejected(await journal.append(directory, input), 'JOURNAL_CONFLICT');
    rejected(await journal.append(directory, request(bound, {...catalog, expectedRevision: 0})), 'JOURNAL_EVENT_REJECTED');
    const recorded = await journal.append(directory, request(bound, catalog)); assert.equal(recorded.revision, 2);
    const repeated = await journal.append(directory, request(recorded, {...catalog, expectedRevision: 2}));
    assert.equal(repeated.changed, false); assert.equal(repeated.committed, false); assert.equal(repeated.revision, 2);
    const restored = await journal.open(directory, STORE); assert.deepEqual(restored.state, recorded.state);
    const raw = await fsp.readFile(path.join(directory, name(2)));
    assert.equal(restored.headSha256, sha(raw)); assert.equal(JSON.parse(raw).parentSha256, bound.headSha256);
  });
  test('two independent processes race the same next filename and exactly one wins without overwrite', {timeout: 25000}, async t => {
    const {directory, journal, head} = await initialized(t);
    const different = {...confirmation, binding: {feedId: OTHER, epoch: 1}};
    const left = child(t, directory, request(head), 'before-link'), right = child(t, directory, request(head, different), 'before-link');
    await Promise.all([left.next('barrier'), right.next('barrier')]);
    left.process.send('continue'); right.process.send('continue');
    const results = (await Promise.all([left.next('result'), right.next('result')])).map(value => value.result);
    assert.equal(results.filter(result => result.ok && result.committed).length, 1);
    assert.equal(results.filter(result => !result.ok && result.code === 'JOURNAL_CONFLICT').length, 1);
    await Promise.all([left.exit, right.exit]);
    const reopened = await journal.open(directory, STORE); assert.equal(reopened.revision, 1);
    const winner = results.find(result => result.ok); assert.deepEqual(reopened.state, winner.state); assert.equal(reopened.headSha256, winner.headSha256);
    assert.deepEqual((await fsp.readdir(directory)).sort(), [name(0), name(1)]);
  });
  for (const barrier of ['created', 'partial-write', 'written', 'synced', 'before-link', 'published']) {
    test('actual process kill at ' + barrier + ' reopens only a complete committed prefix', {timeout: 25000}, async t => {
      const {directory, journal, head} = await initialized(t), worker = child(t, directory, request(head), barrier);
      await worker.next('barrier'); assert.equal(worker.process.kill('SIGKILL'), true); await worker.exit;
      const reopened = await journal.open(directory, STORE); assert.equal(reopened.ok, true, reopened.code);
      assert.equal(reopened.revision, barrier === 'published' ? 1 : 0);
      assert.equal(reopened.ready, false);
    });
  }
  for (const action of ['write', 'sync', 'close', 'link-before', 'link-after']) {
    test('injected ' + action + ' failure never acknowledges an unverified advance', async t => {
      const {directory, journal, head} = await initialized(t);
      const io = {...fsp, async open(...args) {
        const handle = await fsp.open(...args);
        if (args[1] !== 'wx') return handle;
        return {stat: handle.stat.bind(handle), read: handle.read.bind(handle), async close() {await handle.close(); if (action === 'close') throw Error('private');},
          async writeFile(value) {if (action === 'write') {await handle.writeFile(value.subarray(0, 10)); throw Error('private');} return handle.writeFile(value);},
          async sync() {if (action === 'sync') throw Error('private'); return handle.sync();}};
      }, async link(...args) {
        if (action === 'link-before') throw Error('private');
        await fsp.link(...args); if (action === 'link-after') throw Error('private');
      }};
      const result = await createExchangeJournal({io}).append(directory, request(head));
      rejected(result, action.startsWith('link') ? 'JOURNAL_COMMIT_UNCERTAIN' : 'JOURNAL_IO_FAILED');
      const reopened = await journal.open(directory, STORE); assert.equal(reopened.revision, action === 'link-after' ? 1 : 0);
      assert.doesNotMatch(JSON.stringify(result), /private|ledger|stack/);
    });
  }
  test('post-publication hook failure is uncertain and reopening retains the committed record', async t => {
    const {directory, journal, head} = await initialized(t);
    const result = await createExchangeJournal({phase: async name => {if (name === 'published') throw Error('private');}}).append(directory, request(head));
    rejected(result, 'JOURNAL_COMMIT_UNCERTAIN'); assert.equal((await journal.open(directory, STORE)).revision, 1);
  });
  test('failed initialization leaves an existing incomplete directory and cannot silently retry or open empty', async t => {
    const {directory} = await fixture(t), journal = createExchangeJournal({phase: async name => {if (name === 'written') throw Error('private');}});
    rejected(await journal.initialize(directory, STORE), 'JOURNAL_IO_FAILED');
    rejected(await createExchangeJournal().open(directory, STORE), 'JOURNAL_INVALID');
    rejected(await journal.initialize(directory, STORE), 'JOURNAL_EXISTS');
  });
  test('unknown entries, revision gaps, wrong parent/store and invalid ledger history fail closed', async t => {
    for (const mutation of ['unknown', 'gap', 'parent', 'store', 'event']) {
      const {directory, journal, head} = await initialized(t); await journal.append(directory, request(head));
      if (mutation === 'unknown') await fsp.writeFile(path.join(directory, 'unexpected'), 'private');
      else if (mutation === 'gap') await fsp.rename(path.join(directory, name(1)), path.join(directory, name(2)));
      else {
        const target = path.join(directory, name(1)), record = JSON.parse(await fsp.readFile(target, 'utf8'));
        if (mutation === 'parent') record.parentSha256 = 'f'.repeat(64);
        if (mutation === 'store') record.storeId = OTHER;
        if (mutation === 'event') record.event.expectedRevision = 9;
        await fsp.writeFile(target, bytes(record));
      }
      rejected(await journal.open(directory, STORE), 'JOURNAL_INVALID');
    }
  });
  test('duplicate keys, BOM, malformed UTF8, noncanonical whitespace and oversize records are rejected', async t => {
    const {directory, journal} = await initialized(t), target = path.join(directory, name(0)), original = await fsp.readFile(target);
    for (const invalid of [Buffer.from('{"schemaVersion":1,' + original.toString().slice(1)), Buffer.concat([Buffer.from([0xef,0xbb,0xbf]), original]),
      Buffer.from([0xff]), Buffer.concat([original, Buffer.from('\n')]), Buffer.alloc(LIMITS.recordBytes + 1)]) {
      await fsp.writeFile(target, invalid); rejected(await journal.open(directory, STORE), 'JOURNAL_INVALID');
    }
  });
  test('record/total/temp bounds fail without eviction and recognized private temporary files are ignored', async t => {
    const {directory, journal, head} = await initialized(t);
    const temp = path.join(directory, '.tmp-' + crypto.randomUUID()); await fsp.writeFile(temp, 'partial');
    assert.equal((await journal.open(directory, STORE)).revision, 0);
    const limited = createExchangeJournal({limits: {...LIMITS, records: 1}});
    rejected(await limited.append(directory, request(head)), 'JOURNAL_CAPACITY_EXCEEDED');
    const genesisLength = (await fsp.stat(path.join(directory, name(0)))).size;
    rejected(await createExchangeJournal({limits: {...LIMITS, totalBytes: genesisLength}}).append(directory, request(head)), 'JOURNAL_CAPACITY_EXCEEDED');
    await fsp.writeFile(path.join(directory, '.tmp-' + crypto.randomUUID()), 'partial');
    rejected(await createExchangeJournal({limits: {...LIMITS, temporaryFiles: 1}}).open(directory, STORE), 'JOURNAL_CAPACITY_EXCEEDED');
    assert.equal((await fsp.readdir(directory)).includes(name(0)), true);
  });
  test('symlink or junction store ancestors and committed record substitutions are rejected', async t => {
    const {parent, directory, journal} = await initialized(t), alias = path.join(parent, 'alias');
    await fsp.symlink(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    rejected(await journal.open(alias, STORE), 'JOURNAL_INVALID');
    await fsp.mkdir(path.join(directory, 'nested'));
    rejected(await journal.initialize(path.join(alias, 'new'), STORE), 'JOURNAL_INVALID');
    await fsp.rmdir(path.join(directory, 'nested'));
    const original = path.join(parent, 'original'); await fsp.rename(path.join(directory, name(0)), original);
    await fsp.mkdir(path.join(directory, name(0))); rejected(await journal.open(directory, STORE), 'JOURNAL_INVALID');
    await fsp.rmdir(path.join(directory, name(0)));
    if (process.platform !== 'win32') {
      await fsp.symlink(original, path.join(directory, name(0))); rejected(await journal.open(directory, STORE), 'JOURNAL_INVALID');
    }
    // Windows junction substitution is exercised above without developer-mode file symlink permission.
  });
  test('append snapshots caller request and event before asynchronous replay', async t => {
    const {directory, journal, head} = await initialized(t);
    let release, entered; const admitted = new Promise(resolve => entered = resolve), blocked = new Promise(resolve => release = resolve);
    const io = {...fsp, async opendir(...args) {entered(); await blocked; return fsp.opendir(...args);}};
    const input = request(head, JSON.parse(JSON.stringify(confirmation)));
    const pending = createExchangeJournal({io}).append(directory, input); await admitted;
    input.event.binding.feedId = OTHER;
    let calls = 0;
    for (const key of Object.keys(input)) Object.defineProperty(input, key, {enumerable: true, get() {calls++; throw Error('private');}});
    release(); const result = await pending;
    assert.equal(result.ok, true, result.code); assert.equal(calls, 0); assert.equal(result.state.binding.feedId, FEED);
    assert.equal((await journal.open(directory, STORE)).state.binding.feedId, FEED);
  });
  test('readback failure after actual publication is uncertain and does not delete the committed file', async t => {
    const {directory, journal, head} = await initialized(t);
    const io = {...fsp, async open(target, ...rest) {if (target === path.join(directory, name(1))) throw Error('private'); return fsp.open(target, ...rest);}};
    rejected(await createExchangeJournal({io}).append(directory, request(head)), 'JOURNAL_COMMIT_UNCERTAIN');
    assert.equal((await journal.open(directory, STORE)).revision, 1);
  });
  test('failed private temporary cleanup preserves acknowledged final record and bounded replay', async t => {
    const {directory, journal, head} = await initialized(t);
    const io = {...fsp, async unlink() {throw Error('private');}};
    const result = await createExchangeJournal({io}).append(directory, request(head));
    assert.equal(result.ok, true); assert.equal(result.committed, true);
    assert.equal((await journal.open(directory, STORE)).revision, 1);
    assert.equal((await fsp.readdir(directory)).filter(value => value.startsWith('.tmp-')).length, 1);
  });
  test('pseudo-temp names and oversized ignored temporary files are rejected', async t => {
    const {directory, journal} = await initialized(t);
    const malformed = path.join(directory, '.tmp-' + '-'.repeat(36)); await fsp.writeFile(malformed, 'partial');
    rejected(await journal.open(directory, STORE), 'JOURNAL_INVALID'); await fsp.unlink(malformed);
    await fsp.writeFile(path.join(directory, '.tmp-' + crypto.randomUUID()), Buffer.alloc(LIMITS.recordBytes + 1));
    rejected(await journal.open(directory, STORE), 'JOURNAL_INVALID');
  });

  test('failed exclusive temporary open never deletes a preexisting other-writer file', async t => {
    const {directory, journal, head} = await initialized(t); let collided;
    const io = {...fsp, async open(target, flags, ...rest) {
      if (flags === 'wx') {
        collided = target; await fsp.writeFile(target, 'other-writer-partial', {flag: 'wx'});
        return fsp.open(target, flags, ...rest);
      }
      return fsp.open(target, flags, ...rest);
    }};
    rejected(await createExchangeJournal({io}).append(directory, request(head)), 'JOURNAL_IO_FAILED');
    assert.equal(await fsp.readFile(collided, 'utf8'), 'other-writer-partial');
    assert.equal((await journal.open(directory, STORE)).revision, 0);
  });

}
