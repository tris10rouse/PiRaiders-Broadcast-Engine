#!/usr/bin/env node
/**
 * The exclusive agent lease (docs/agent/LOCKING_PROTOCOL.md) over plain git, for sessions that can push
 * through git but hold no GitHub API token. Same state machine as scripts/agent-lease.mjs
 * (scripts/lib/agent-lease-state.mjs); only the transport differs:
 *   read   = git fetch of the coordination branch, lease read pinned to that exact commit;
 *   write  = a new commit whose sole parent is the observed head, pushed WITHOUT force, so the
 *            remote accepts it only as a fast-forward of what was read (compare-and-swap).
 * A refused push means another agent won: exit 3, stop writing. This tool never force-pushes.
 *
 *   node scripts/builder/lease-git.mjs status
 *   node scripts/builder/lease-git.mjs acquire [--task T] [--branch B]
 *   node scripts/builder/lease-git.mjs renew   [--task T] [--branch B]   (also the "claim" of a queue row)
 *   node scripts/builder/lease-git.mjs assert
 *   node scripts/builder/lease-git.mjs release
 *
 * The owner id and fence of this session are kept in .git/builder-lease.json (never committed).
 * Exit 0 done · 3 lease busy, lost or race lost · 1 anything else (fail closed).
 * Options for tests: --remote NAME (default origin) --now ISO --cwd DIR.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  acquireLease, assertLeaseHeld, renewLease, releaseLease, leaseBusy, LeaseError
} from '../lib/agent-lease-state.mjs';

export const LOCK_BRANCH = 'coordination/agent-lease';
export const LOCK_FILE = 'agent/lease.json';

function gitIn(cwd, env) {
  return (args, input) => execFileSync('git', args, {
    cwd, input, env: { ...process.env, ...(env || {}) }, stdio: ['pipe', 'pipe', 'pipe']
  }).toString();
}

/** Read the lease pinned to the coordination branch's current remote head. */
export function readLease(cwd, remote = 'origin') {
  const git = gitIn(cwd);
  git(['fetch', '-q', remote, '+refs/heads/' + LOCK_BRANCH + ':refs/builder/lease-head']);
  const head = git(['rev-parse', 'refs/builder/lease-head']).trim();
  let lease;
  try { lease = JSON.parse(git(['show', head + ':' + LOCK_FILE])); }
  catch (e) { throw new LeaseError('CORRUPT_LEASE', 'Lease file missing or unreadable; fail closed'); }
  return { head, lease };
}

/** Commit `next` on top of `head` (sole parent) and push it as a fast-forward only. */
export function writeLease(cwd, remote, head, next, message) {
  const git = gitIn(cwd);
  const blob = git(['hash-object', '-w', '--stdin'], JSON.stringify(next, null, 2) + '\n').trim();
  const index = path.join(git(['rev-parse', '--git-dir']).trim(), 'builder-lease.index');
  const absIndex = path.isAbsolute(index) ? index : path.join(cwd, index);
  const gi = gitIn(cwd, { GIT_INDEX_FILE: absIndex });
  gi(['read-tree', head]);
  gi(['update-index', '--add', '--cacheinfo', '100644,' + blob + ',' + LOCK_FILE]);
  const tree = gi(['write-tree']).trim();
  fs.rmSync(absIndex, { force: true });
  const commit = git(['commit-tree', tree, '-p', head, '-m', message]).trim();
  try {
    git(['push', '-q', remote, commit + ':refs/heads/' + LOCK_BRANCH]);
  } catch (e) {
    throw new LeaseError('RACE_LOST', 'The coordination branch moved since it was read: another agent won; stop writing');
  }
  return commit;
}

function localFile(cwd) {
  const gd = execFileSync('git', ['rev-parse', '--git-dir'], { cwd }).toString().trim();
  return path.join(path.isAbsolute(gd) ? gd : path.join(cwd, gd), 'builder-lease.json');
}
function mine(cwd) {
  try { return JSON.parse(fs.readFileSync(localFile(cwd), 'utf8')); }
  catch (e) { throw new LeaseError('LEASE_NOT_HELD', 'This clone holds no lease (no .git/builder-lease.json)'); }
}

export function newOwner(nowMs) {
  return 'claude-' + new Date(nowMs).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') + '-' + randomBytes(3).toString('hex');
}

/** One command. Returns { code, out } and never throws. */
export function run(cmd, opts = {}) {
  const cwd = opts.cwd || process.cwd(), remote = opts.remote || 'origin';
  const nowMs = opts.now ? Date.parse(opts.now) : Date.now();
  try {
    const { head, lease } = readLease(cwd, remote);
    if (cmd === 'status') {
      return { code: 0, out: { ...lease, busy: leaseBusy(lease, nowMs) } };
    }
    if (cmd === 'acquire') {
      const owner = newOwner(nowMs);
      const prior = lease.status === 'active' ? { task: lease.task, workBranch: lease.workBranch, owner: lease.owner } : null;
      const next = acquireLease(lease, { owner, task: opts.task || 'builder run', workBranch: opts.branch || null, nowMs });
      writeLease(cwd, remote, head, next, 'lease: acquire ' + owner + ' fence ' + next.fence);
      fs.writeFileSync(localFile(cwd), JSON.stringify({ owner, fence: next.fence }) + '\n');
      // An expired lease that still named a row belonged to a run that died: the new owner resumes it first.
      return { code: 0, out: { owner, fence: next.fence, expiresAt: next.expiresAt, resume: prior && prior.workBranch ? prior : null } };
    }
    const { owner, fence } = mine(cwd);
    if (cmd === 'assert') {
      assertLeaseHeld(lease, { owner, fence, nowMs });
      return { code: 0, out: { owner, fence, expiresAt: lease.expiresAt, task: lease.task, workBranch: lease.workBranch } };
    }
    if (cmd === 'renew') {
      const next = renewLease(lease, { owner, fence, nowMs });
      if (opts.task) next.task = String(opts.task).slice(0, 180);
      if (opts.branch) next.workBranch = String(opts.branch).slice(0, 180);
      writeLease(cwd, remote, head, next, 'lease: renew ' + owner + ' fence ' + fence);
      return { code: 0, out: { owner, fence, expiresAt: next.expiresAt, task: next.task, workBranch: next.workBranch } };
    }
    if (cmd === 'release') {
      const next = releaseLease(lease, { owner, fence, nowMs });
      writeLease(cwd, remote, head, next, 'lease: release ' + owner + ' fence ' + fence);
      fs.rmSync(localFile(cwd), { force: true });
      return { code: 0, out: { released: owner, fence } };
    }
    return { code: 1, out: { error: 'USAGE', message: 'status | acquire | renew | assert | release' } };
  } catch (e) {
    const busy = e instanceof LeaseError && ['LEASE_BUSY', 'LEASE_NOT_HELD', 'RACE_LOST'].includes(e.code);
    return { code: busy ? 3 : 1, out: { error: e.code || 'FAILED', message: String(e.message).split('\n')[0] } };
  }
}

function parse(argv) {
  const o = { cmd: argv[0] };
  for (let i = 1; i < argv.length; i += 2) o[String(argv[i]).replace(/^--/, '')] = argv[i + 1];
  return o;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = parse(process.argv.slice(2));
  const r = run(o.cmd, o);
  process.stdout.write(JSON.stringify(r.out) + '\n');
  process.exitCode = r.code;
}
