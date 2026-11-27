'use strict';
// The builder workflow (AGENTS.md › A run): the queue's files, the tracker, the check waiter's verdict,
// the Claude Code hooks and the git transport of the exclusive agent lease.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const queue = require('../scripts/builder/queue.cjs');
const tracker = require('../scripts/builder/tracker.cjs');
const { summarize, readVerdict } = require('../scripts/builder/wait-checks.cjs');
const guard = require('../.claude/hooks/push-guard.js');
const canary = require('../.claude/hooks/canary.js');

function tmp(name) { return fs.mkdtempSync(path.join(os.tmpdir(), 'builder-' + name + '-')); }
function write(dir, rel, text) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
const BODY = 'The words this row is built from, copied word for word from the backlog.\n';
const row = (extra = '') => 'Title: A part\nKind: Engine\nArea: Setup\nSize: S\nAdded: 2026-11-23\n' + extra + '---\n\n' + BODY;

test('the repository queue passes its own lint', () => {
  assert.deepEqual(queue.lint(root), []);
});

test('every queue row in ORDER.md is a todo file and the next row is the first of them', () => {
  const { rows, order } = queue.readQueue(root);
  const todo = rows.todo.map(r => r.id);
  // An empty queue is a legitimate state (AGENTS.md › A run, step 7): next is null.
  assert.equal(queue.next(root), order.find(id => todo.includes(id)) || null);
  for (const id of rows.todo.map(r => r.id)) assert.ok(order.includes(id), id + ' is not in ORDER.md');
});

test('an empty queue has no next row and passes lint', () => {
  const d = tmp('empty');
  write(d, 'queue/ORDER.md', '');
  write(d, 'queue/parked/5f.md', row('Parked: split into 5f-1, 5f-2\n'));
  assert.equal(queue.next(d), null);
  assert.deepEqual(queue.lint(d), []);
});

test('lint names a bad header, a missing rule line, a short body and an unordered todo file', () => {
  const d = tmp('lint');
  write(d, 'queue/ORDER.md', '5b\n');
  write(d, 'queue/todo/5b.md', row());
  write(d, 'queue/todo/5c.md', 'Title: x\nKind: Wish\nArea: Moon\nSize: XL\nAdded: soon\n');
  write(d, 'queue/needs-you/5d.md', row());
  write(d, 'queue/blocked/5e.md', row());
  const p = queue.lint(d).join('\n');
  assert.match(p, /5c\.md: no "---" line/);
  assert.match(p, /5c\.md: Kind must be/);
  assert.match(p, /5c\.md: Area must be/);
  assert.match(p, /5c\.md: Size must be/);
  assert.match(p, /5c\.md: Added must be/);
  assert.match(p, /5c\.md: below the "---" line/);
  assert.match(p, /5c\.md is not in ORDER\.md/);
  assert.match(p, /5d\.md: a needs-you file has a "Needs you:" sentence/);
  assert.match(p, /5e\.md: a blocked file has a "Blocked:" line/);
  assert.doesNotMatch(p, /todo\/5b\.md/);
});

test('a queue file checked out with CRLF line endings (Windows) reads the same', () => {
  const d = tmp('crlf');
  write(d, 'queue/ORDER.md', '5b\r\n');
  write(d, 'queue/todo/5b.md', row().replace(/\n/g, '\r\n'));
  assert.deepEqual(queue.lint(d), []);
  assert.equal(queue.readQueue(d).rows.todo[0].fields.Title, 'A part');
});

test('lint refuses anything private in a public queue', () => {
  const cases = {
    'an email address': 'Ask someone@example.org about it.',
    'an IP address': 'The board is at 10.1.2.3 on the LAN.',
    'a Google Drive or Docs link': 'See drive.google.com/drive/folders/x',
    'a link to example.com': 'See https://example.com/page',
    'an id like a Drive id': 'Folder 1AbCdEfGhIjKlMnOpQrStUvWxYz012345'
  };
  for (const [kind, text] of Object.entries(cases)) {
    assert.deepEqual(queue.privateHits(text).slice(0, 1), [kind], kind);
  }
  // What the queue legitimately holds stays allowed.
  for (const ok of ['merged as `8053f7db6898930af7786c712bb0dd70e1e0c075`', 'https://github.com/tris10rouse/x/pull/81',
    'https://claude.ai/artifact/abc', 'job 136463119504', 'RECEIVER_START_TIMEOUT', 'actual-exchange-activation-private-ndi',
    'scripts/smoke-exchange-activation-windows.cjs', 'Node 22.23.4', 'feature/be-081-exchange-activation-windows']) {
    assert.deepEqual(queue.privateHits(ok), [], ok);
  }
  const d = tmp('private');
  write(d, 'queue/ORDER.md', '5b\n');
  write(d, 'queue/todo/5b.md', row() + 'Mail a.student@example.org\n');
  assert.match(queue.lint(d).join('\n'), /holds an email address \(this repository is public\)/);
});

test('the tracker reports the lease, the queue, merged pull requests and Builders', () => {
  const d = tmp('tracker');
  write(d, 'AGENTS.md', '# x\n\nBuilders: 1\n');
  write(d, 'queue/ORDER.md', '5c\n5b\n');
  write(d, 'queue/todo/5b.md', row());
  write(d, 'queue/todo/5c.md', row().replace('A part', 'Another part'));
  write(d, 'queue/needs-you/Q-001.md', row('Needs you: Pick one of two designs.\nLink: https://claude.ai/artifact/abc\n'));
  const now = '2026-11-23T12:00:00Z';
  const log = 'Wait for late answers (#83)\t2026-11-20T19:44:00Z\nOld thing (#10)\t2026-11-01T00:00:00Z\nNo PR number\t2026-11-22T00:00:00Z';
  const lease = { status: 'active', task: '5b', workBranch: 'feature/5b-setup', acquiredAt: '2026-11-23T11:00:00Z', expiresAt: '2026-11-23T12:30:00Z' };
  const t = tracker.track({ root: d, now, lease, log });
  assert.deepEqual(t.building, { task: '5b', branch: 'feature/5b-setup', since: '2026-11-23T11:00:00Z', until: '2026-11-23T12:30:00Z' });
  assert.deepEqual(t.next.map(r => r.id), ['5c', '5b']);
  assert.equal(t.needsYou[0].sentence, 'Pick one of two designs.');
  assert.deepEqual(t.merged, [{ title: 'Wait for late answers', pr: 83, date: '2026-11-20' }]);
  assert.equal(t.builders, 1);
  assert.equal(t.counts.todo, 2);
  assert.equal(tracker.track({ root: d, now, lease: { ...lease, expiresAt: '2026-11-23T11:59:00Z' }, log }).building, null);
});

test('AGENTS.md names Builders and the section A run', () => {
  const text = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(text, /^Builders: \d+$/m);
  assert.match(text, /^## A run$/m);
  assert.equal(tracker.builders(root) >= 0, true);
});

test('the check waiter is green only when every newest check finished well', () => {
  const run = (name, status, conclusion, started_at = '2026-11-23T00:00:00Z') => ({ name, status, conclusion, started_at });
  assert.equal(summarize([]).done, false);
  assert.equal(summarize([run('a', 'completed', 'success'), run('b', 'in_progress', null)]).done, false);
  const green = summarize([run('a', 'completed', 'success'), run('b', 'completed', 'skipped'), run('c', 'completed', 'neutral')]);
  assert.equal(green.green, true);
  const red = summarize([run('a', 'completed', 'success'), run('b', 'completed', 'failure'), run('c', 'completed', 'cancelled')]);
  assert.equal(red.green, false);
  assert.deepEqual(red.failed, ['b', 'c']);
  // A rerun replaces the older result of the same check only when it is newer.
  const rerun = summarize([run('a', 'completed', 'failure', '2026-11-23T00:00:00Z'), run('a', 'completed', 'success', '2026-11-23T01:00:00Z')]);
  assert.equal(rerun.green, true);
});

test('the check waiter never reads GREEN while a workflow run of the commit has not finished (Q-003)', () => {
  const SHA = 'a'.repeat(40);
  const check = (name, suite, status = 'completed', conclusion = 'success') => ({ name, status, conclusion, started_at: '2026-11-23T00:00:00Z', check_suite: { id: suite } });
  const wf = (name, suite, status, conclusion = null) => ({ name, status, conclusion, check_suite_id: suite });
  const stub = (checks, workflows) => p => {
    if (p.endsWith('/commits/' + SHA + '/check-runs')) return { check_runs: checks };
    if (p.endsWith('/actions/runs')) return { workflow_runs: workflows };
    throw new Error('unexpected ' + p);
  };
  const four = [check('a', 1), check('b', 1), check('c', 2), check('d', 2)];
  // Four finished green check runs, one workflow still queued with no jobs yet: RUNNING, not GREEN.
  const early = readVerdict('o/r', SHA, stub(four, [wf('One', 1, 'completed', 'success'), wf('Two', 2, 'completed', 'success'), wf('Slow', 3, 'queued')]));
  assert.equal(early.green, false);
  assert.equal(early.done, false);
  assert.deepEqual(early.pending, ['Slow']);
  // Every check run finished, but its workflow run still reports in progress: not done either.
  const finishing = readVerdict('o/r', SHA, stub(four, [wf('One', 1, 'completed', 'success'), wf('Two', 2, 'in_progress')]));
  assert.equal(finishing.done, false);
  // The same after the slow workflow's jobs finish green: GREEN.
  const later = readVerdict('o/r', SHA, stub(four.concat([check('e', 3)]), [wf('One', 1, 'completed', 'success'), wf('Two', 2, 'completed', 'success'), wf('Slow', 3, 'completed', 'success')]));
  assert.equal(later.green, true);
  assert.equal(later.count, 5);
  // A workflow that ended badly without creating any job is a failure, named by the workflow.
  const broken = readVerdict('o/r', SHA, stub(four, [wf('One', 1, 'completed', 'success'), wf('Two', 2, 'completed', 'success'), wf('Bad', 3, 'completed', 'startup_failure')]));
  assert.equal(broken.done, true);
  assert.equal(broken.green, false);
  assert.deepEqual(broken.failed, ['Bad']);
  // A run cancelled before any job and replaced by a newer run of the same workflow and event does not count.
  const replaced = readVerdict('o/r', SHA, stub(four.concat([check('e', 4)]), [wf('One', 1, 'completed', 'success'), wf('Two', 2, 'completed', 'success'),
    Object.assign(wf('Slow', 3, 'completed', 'cancelled'), { workflow_id: 9, event: 'push', run_number: 5 }),
    Object.assign(wf('Slow', 4, 'completed', 'success'), { workflow_id: 9, event: 'push', run_number: 6 })]));
  assert.equal(replaced.green, true);
  // A branch name is resolved to its commit before the workflow runs are read.
  const seen = [];
  const named = readVerdict('o/r', 'master', p => { seen.push(p); return p.endsWith('/commits/master') ? { sha: SHA } : stub(four, [wf('One', 1, 'completed', 'success'), wf('Two', 2, 'completed', 'success')])(p); });
  assert.equal(named.green, true);
  assert.ok(seen.some(p => p.endsWith('/commits/master')));
});

test('the push guard denies every force push and every push to the default branch', () => {
  const deny = (c, cur = 'feature/x') => assert.ok(guard.reason(c, cur), c);
  const allow = (c, cur = 'feature/x') => assert.equal(guard.reason(c, cur), '', c);
  deny('git push --force origin feature/x');
  deny('git push -f origin feature/x');
  deny('git push --force-with-lease origin feature/x');
  deny('git push origin +feature/x');
  deny('git push origin HEAD:master');
  deny('git push origin feature/x:refs/heads/main');
  deny('git -C /some/dir push origin master');
  deny('cd x && git push -u origin master');
  deny('git push --all origin');
  deny('git push', 'master');
  allow('git push -u origin feature/be-090-x');
  allow('git push', 'feature/x');
  allow('git commit -m "then push to master by PR"');
  const out = guard.decide({ tool_name: 'Bash', tool_input: { command: 'git push origin HEAD:master' } }, 'feature/x');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(guard.decide({ tool_name: 'Read', tool_input: {} }, 'master'), null);
});

test('the canary adds the line HOOKS ON and the settings load both hooks', () => {
  assert.equal(canary.output().hookSpecificOutput.additionalContext, 'HOOKS ON');
  const s = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'));
  assert.match(JSON.stringify(s.hooks.SessionStart), /canary\.js/);
  assert.match(JSON.stringify(s.hooks.PreToolUse), /push-guard\.js/);
  // The generic folders carry nothing specific to one project.
  for (const dir of ['.claude/hooks', '.claude/skills/run', '.claude/skills/builders']) {
    for (const f of fs.readdirSync(path.join(root, dir))) {
      assert.doesNotMatch(fs.readFileSync(path.join(root, dir, f), 'utf8'), /PiRaiders/i, dir + '/' + f);
    }
  }
});

// The lease over plain git, against a local bare repository standing in for GitHub.
function sh(cwd, ...args) { return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); }
function leaseRepo() {
  const d = tmp('lease'), origin = path.join(d, 'origin.git'), seed = path.join(d, 'seed');
  sh(d, 'init', '-q', '--bare', origin);
  sh(d, 'init', '-q', seed);
  for (const [k, v] of [['user.name', 'Test'], ['user.email', 'test@example.invalid'], ['commit.gpgsign', 'false']]) sh(seed, 'config', k, v);
  write(seed, 'agent/lease.json', JSON.stringify({ schemaVersion: 1, status: 'idle', owner: null, fence: 7, task: null, workBranch: null,
    acquiredAt: null, lastHeartbeat: null, expiresAt: null, releasedAt: null }, null, 2) + '\n');
  sh(seed, 'add', '.'); sh(seed, 'commit', '-q', '-m', 'seed');
  sh(seed, 'push', '-q', origin, 'HEAD:refs/heads/coordination/agent-lease');
  const clone = name => {
    const c = path.join(d, name);
    sh(d, 'clone', '-q', origin, c);
    for (const [k, v] of [['user.name', 'Test'], ['user.email', 'test@example.invalid'], ['commit.gpgsign', 'false']]) sh(c, 'config', k, v);
    return c;
  };
  return { origin, clone };
}

test('the git lease: one writer at a time, fence increases, renew carries the row, release frees it', async () => {
  const { run } = await import('../scripts/builder/lease-git.mjs');
  const { clone } = leaseRepo();
  const a = clone('a'), b = clone('b');
  const t0 = '2026-11-23T10:00:00.000Z';
  const first = run('acquire', { cwd: a, now: t0 });
  assert.equal(first.code, 0, JSON.stringify(first.out));
  assert.equal(first.out.fence, 8);
  assert.equal(first.out.resume, null);
  const second = run('acquire', { cwd: b, now: '2026-11-23T10:05:00.000Z' });
  assert.equal(second.code, 3);
  assert.equal(second.out.error, 'LEASE_BUSY');
  assert.equal(run('assert', { cwd: b }).code, 3, 'a clone without the lease cannot assert it');
  const claim = run('renew', { cwd: a, now: '2026-11-23T10:10:00.000Z', task: '5b', branch: 'feature/5b-setup' });
  assert.equal(claim.code, 0, JSON.stringify(claim.out));
  assert.equal(claim.out.task, '5b');
  assert.equal(claim.out.expiresAt, '2026-11-23T11:40:00.000Z');
  // The first run dies holding the row; after expiry the next run takes over with fence + 1 and is told to resume it.
  const taken = run('acquire', { cwd: b, now: '2026-11-23T12:00:00.000Z' });
  assert.equal(taken.code, 0, JSON.stringify(taken.out));
  assert.equal(taken.out.fence, 9);
  assert.deepEqual(taken.out.resume, { task: '5b', workBranch: 'feature/5b-setup', owner: first.out.owner });
  // The woken first owner has lost the lease and can neither renew nor release.
  assert.equal(run('renew', { cwd: a, now: '2026-11-23T12:01:00.000Z' }).code, 3);
  assert.equal(run('release', { cwd: a, now: '2026-11-23T12:01:00.000Z' }).code, 3);
  const freed = run('release', { cwd: b, now: '2026-11-23T12:02:00.000Z' });
  assert.equal(freed.code, 0, JSON.stringify(freed.out));
  const st = run('status', { cwd: a, now: '2026-11-23T12:03:00.000Z' });
  assert.equal(st.out.status, 'idle');
  assert.equal(st.out.fence, 9);
  assert.equal(st.out.busy, false);
});

test('the git lease loses a race instead of overwriting: the push is a fast-forward only', async () => {
  const { readLease, writeLease } = await import('../scripts/builder/lease-git.mjs');
  const { clone } = leaseRepo();
  const a = clone('a'), b = clone('b');
  const ra = readLease(a), rb = readLease(b);
  assert.equal(ra.head, rb.head);
  writeLease(a, 'origin', ra.head, { ...ra.lease, status: 'active', owner: 'claude-test-owner-a', fence: 8, expiresAt: '2099-01-01T00:00:00.000Z' }, 'a');
  assert.throws(() => writeLease(b, 'origin', rb.head, { ...rb.lease, status: 'active', owner: 'claude-test-owner-b', fence: 8, expiresAt: '2099-01-01T00:00:00.000Z' }, 'b'),
    e => e.code === 'RACE_LOST');
  assert.equal(readLease(b).lease.owner, 'claude-test-owner-a');
});

test('the git lease fails closed on a missing or corrupt lease file', async () => {
  const { run } = await import('../scripts/builder/lease-git.mjs');
  const { clone } = leaseRepo();
  const a = clone('a');
  sh(a, 'checkout', '-q', 'coordination/agent-lease');
  write(a, 'agent/lease.json', '{ not json');
  sh(a, 'commit', '-qam', 'corrupt'); sh(a, 'push', '-q', 'origin', 'HEAD:coordination/agent-lease');
  const r = run('acquire', { cwd: a });
  assert.equal(r.code, 1);
  assert.equal(r.out.error, 'CORRUPT_LEASE');
});
