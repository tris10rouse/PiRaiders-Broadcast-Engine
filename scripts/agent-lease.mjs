#!/usr/bin/env node
/**
 * Cooperative exclusive development lease on a dedicated GitHub branch.
 * Uses fast-forward-only Git ref updates as the atomic compare-and-swap.
 * No third-party dependencies; Node >= 20.
 *
 * Optional environment: GITHUB_REPOSITORY, GITHUB_TOKEN / GH_TOKEN,
 * PI_GITHUB_API_URL (for local testing).
 */
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  acquireLease, assertLeaseHeld, renewLease, releaseLease,
  DEFAULT_TTL_MINUTES, LeaseError
} from './lib/agent-lease-state.mjs';

const LOCK_BRANCH = 'coordination/agent-lease';
const LOCK_FILE = 'agent/lease.json';
const API_BASE = (process.env.PI_GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const repo = process.env.GITHUB_REPOSITORY || 'tris10rouse/PiRaiders-Broadcast-Engine';
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

function options(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--') || i + 1 >= argv.length) {
      throw new Error('Expected --key value; got ' + arg);
    }
    parsed[arg.slice(2)] = argv[++i];
  }
  return parsed;
}

async function api(method, endpoint, body) {
  const headers = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API_BASE + '/repos/' + repo + endpoint, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) {
    // Do not echo response bodies or authentication information.
    throw new LeaseError(
      [409, 422].includes(res.status) ? 'REF_CONFLICT' : 'GITHUB_ERROR',
      'GitHub ' + method + ' ' + endpoint.split('?')[0] + ' returned HTTP ' + res.status
    );
  }
  return res.json();
}

async function snapshot() {
  const ref = await api('GET', '/git/ref/heads/' + LOCK_BRANCH);
  const headSha = ref.object.sha;
  // Pin every subsequent read to this exact commit, never to a moving branch.
  const [commit, data] = await Promise.all([
    api('GET', '/git/commits/' + headSha),
    api('GET', '/contents/' + LOCK_FILE + '?ref=' + encodeURIComponent(headSha))
  ]);
  const lease = JSON.parse(Buffer.from((data.content || '').replace(/\s/g, ''), 'base64').toString('utf8'));
  return { headSha, treeSha: commit.tree.sha, lease };
}

async function fastForwardLease(snap, nextLease, action) {
  // This Git ref update is atomic for competing sessions:
  // one commit can fast-forward from observed head; a competitor's
  // sibling commit cannot fast-forward and fails with HTTP 422.
  const tree = await api('POST', '/git/trees', {
    base_tree: snap.treeSha,
    tree: [{ path: LOCK_FILE, mode: '100644', type: 'blob', content: JSON.stringify(nextLease, null, 2) + '\n' }]
  });
  const commit = await api('POST', '/git/commits', {
    message: 'agent lease: ' + action + ' (' + (nextLease.owner || 'idle') + ')',
    tree: tree.sha, parents: [snap.headSha]
  });
  await api('PATCH', '/git/refs/heads/' + LOCK_BRANCH, { sha: commit.sha, force: false });
  return commit.sha;
}

async function main() {
  const [command = 'status', ...rest] = process.argv.slice(2);
  const opts = options(rest);
  if (!['status', 'acquire', 'assert', 'heartbeat', 'release'].includes(command)) {
    throw new Error('Use status | acquire | assert | heartbeat | release');
  }
  if (command !== 'status' && !token) {
    throw new Error('GITHUB_TOKEN or GH_TOKEN is required for lease mutations and assertions');
  }
  if (command === 'acquire' && opts.owner) {
    throw new Error('Acquire generates a unique owner ID; do not supply --owner');
  }
  const snap = await snapshot();
  if (command === 'status') {
    console.log(JSON.stringify({ coordinationHead: snap.headSha, lease: snap.lease }, null, 2));
    return;
  }
  const nowMs = Date.now();
  const ttlMinutes = opts.ttl ? Number(opts.ttl) : DEFAULT_TTL_MINUTES;
  if (command === 'acquire') {
    const owner = 'agent-' + randomUUID();
    const next = acquireLease(snap.lease, {
      owner, nowMs, ttlMinutes, task: opts.task || '', workBranch: opts.branch || ''
    });
    const head = await fastForwardLease(snap, next, 'acquire');
    console.log(JSON.stringify({ status: 'acquired', owner, fence: next.fence, expiresAt: next.expiresAt, coordinationHead: head }));
    return;
  }
  const owner = opts.owner;
  const fence = Number(opts.fence);
  if (!owner || !Number.isSafeInteger(fence) || fence < 1) {
    throw new Error('Provide --owner <from-acquire> --fence <from-acquire>');
  }
  const payload = { owner, fence, nowMs, ttlMinutes };
  if (command === 'assert') {
    assertLeaseHeld(snap.lease, payload);
    console.log(JSON.stringify({ status: 'held', owner, fence, expiresAt: snap.lease.expiresAt }));
    return;
  }
  const next = command === 'heartbeat' ? renewLease(snap.lease, payload) : releaseLease(snap.lease, payload);
  const head = await fastForwardLease(snap, next, command);
  console.log(JSON.stringify({
    status: command === 'release' ? 'released' : 'renewed',
    owner, fence, expiresAt: next.expiresAt, coordinationHead: head
  }));
}

main().catch(error => {
  const code = error instanceof LeaseError ? error.code : 'UNEXPECTED_ERROR';
  console.error(JSON.stringify({ status: 'error', code, message: error.message }));
  // LEASE_BUSY is expected overlap: do not retry with force.
  process.exitCode = code === 'LEASE_BUSY' || code === 'REF_CONFLICT' ? 3 : 1;
});
