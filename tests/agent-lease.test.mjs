import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LeaseError, leaseBusy, acquireLease, assertLeaseHeld, renewLease, releaseLease
} from '../scripts/lib/agent-lease-state.mjs';

const START = Date.parse('2026-11-13T10:00:00.000Z');
const idle = () => ({
  schemaVersion: 1, status: 'idle', owner: null, task: null,
  workBranch: null, acquiredAt: null, lastHeartbeat: null,
  expiresAt: null, releasedAt: null
});
const owner = 'agent-test-owner-0000000001';
const claim = (prior=idle(), nowMs=START) => acquireLease(prior, {
  owner, task: 'BE-001', workBranch: 'feature/be-001', nowMs
});
const matchesCode = code => error => error instanceof LeaseError && error.code === code;

test('first agent claims idle lease with owner, expiry and fencing token', () => {
  const x = claim();
  assert.equal(x.status, 'active');
  assert.equal(x.owner, owner);
  assert.equal(x.fence, 1);
  assert.equal(x.expiresAt, '2026-11-13T11:30:00.000Z');
  assert.equal(leaseBusy(x, START+1), true);
  assert.equal(assertLeaseHeld(x, { owner, fence: 1, nowMs: START+1 }), true);
});

test('second agent cannot claim until the first lease expires', () => {
  const x = claim();
  assert.throws(() => acquireLease(x, {
    owner: 'agent-second-owner-0002', nowMs: START+60000
  }), matchesCode('LEASE_BUSY'));
});

test('expired lease can be reclaimed with increased fencing token', () => {
  const x = claim();
  const next = acquireLease(x, {
    owner: 'agent-second-owner-0002',
    task: 'BE-002', nowMs: START+90*60000, workBranch: 'feature/be-002'
  });
  assert.equal(next.fence, 2);
  assert.equal(next.owner, 'agent-second-owner-0002');
  assert.throws(() => assertLeaseHeld(next, {
    owner, fence: 1, nowMs: START+90*60000+1
  }), matchesCode('LEASE_NOT_HELD'));
});

test('heartbeat is owner-and-fence guarded and extends the expiry', () => {
  const x = claim();
  assert.throws(() => renewLease(x, {
    owner: 'agent-other-owner-0000000', fence: 1, nowMs: START+1000
  }), matchesCode('LEASE_NOT_HELD'));
  assert.throws(() => renewLease(x, {
    owner, fence: 9, nowMs: START+1000
  }), matchesCode('LEASE_NOT_HELD'));
  const renewed = renewLease(x, {
    owner, fence: 1, nowMs: START+15*60000
  });
  assert.equal(renewed.expiresAt, '2026-11-13T11:45:00.000Z');
  assert.equal(renewed.fence, 1);
});

test('expired, released or corrupt lease fails closed on heartbeat/assert', () => {
  const x = claim();
  assert.throws(() => renewLease(x, {
    owner, fence: 1, nowMs: START+90*60000
  }), matchesCode('LEASE_NOT_HELD'));
  const released = releaseLease(x, { owner, fence: 1, nowMs: START+1000 });
  assert.equal(released.status, 'idle');
  assert.equal(released.owner, null);
  assert.equal(released.fence, 1);
  assert.throws(() => assertLeaseHeld(released, {
    owner, fence: 1, nowMs: START+2000
  }), matchesCode('LEASE_NOT_HELD'));
  const bad = { ...x, expiresAt: 'not-a-date' };
  assert.throws(() => leaseBusy(bad, START), matchesCode('CORRUPT_LEASE'));
});

test('invalid lease durations and owner names do not create a lease', () => {
  assert.throws(() => acquireLease(idle(), {
    owner, nowMs: START, ttlMinutes: 0
  }), matchesCode('INVALID_TTL'));
  assert.throws(() => acquireLease(idle(), {
    owner: 'x', nowMs: START
  }), matchesCode('INVALID_OWNER'));
});

test('only one competing fast-forward update can advance a Git ref', () => {
  // Minimal model of GitHub PATCH /git/refs with force:false; both
  // competing commits have the same parent. This model is not a
  // network race test. GitHub enforces non-fast-forward rejection.
  let refHead = 'head-A';
  function push(candidate) {
    if (candidate.parent !== refHead) return false;
    refHead = candidate.sha;
    return true;
  }
  assert.equal(push({ parent: 'head-A', sha: 'agent-1-commit' }), true);
  assert.equal(push({ parent: 'head-A', sha: 'agent-2-commit' }), false);
  assert.equal(refHead, 'agent-1-commit');
});
