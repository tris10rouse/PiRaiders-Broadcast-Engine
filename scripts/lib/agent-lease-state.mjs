/**
 * Pure lease state machine. No network or secrets. Used by GitHub-ref adapter
 * and by executable regression tests.
 */
export const DEFAULT_TTL_MINUTES = 90;
export const HEARTBEAT_INTERVAL_MINUTES = 15;

export class LeaseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LeaseError';
    this.code = code;
  }
}

function validTime(value) {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) throw new LeaseError('CORRUPT_LEASE', 'Invalid lease timestamp');
  return t;
}

function validate(previous) {
  if (!previous || previous.schemaVersion !== 1 ||
      !['active', 'idle'].includes(previous.status)) {
    throw new LeaseError('CORRUPT_LEASE', 'Unrecognized lease schema/state; refusing mutation');
  }
  if (previous.status === 'active') {
    if (typeof previous.owner !== 'string' || !previous.owner ||
        !Number.isSafeInteger(previous.fence) || previous.fence < 1) {
      throw new LeaseError('CORRUPT_LEASE', 'Active lease lacks owner/fencing token');
    }
    validTime(previous.expiresAt);
  }
}

function requireTTL(ttlMinutes) {
  if (!Number.isSafeInteger(ttlMinutes) || ttlMinutes < 20 || ttlMinutes > 180) {
    throw new LeaseError('INVALID_TTL', 'Lease duration must be 20 through 180 minutes');
  }
}
function nowDate(nowMs) {
  if (!Number.isFinite(nowMs)) throw new LeaseError('BAD_CLOCK', 'Invalid current time');
  return new Date(nowMs).toISOString();
}
function requireOwner(owner) {
  if (typeof owner !== 'string' || owner.length < 12 || owner.length > 160) {
    throw new LeaseError('INVALID_OWNER', 'Owner ID must be a unique 12-160 character string');
  }
}

export function leaseBusy(previous, nowMs = Date.now()) {
  validate(previous);
  return previous.status === 'active' && validTime(previous.expiresAt) > nowMs;
}

export function acquireLease(previous, { owner, task, workBranch, nowMs = Date.now(), ttlMinutes = DEFAULT_TTL_MINUTES }) {
  validate(previous);
  requireOwner(owner);
  requireTTL(ttlMinutes);
  if (leaseBusy(previous, nowMs)) {
    throw new LeaseError('LEASE_BUSY', 'Another agent session owns an unexpired lease');
  }
  const started = nowDate(nowMs);
  const fence = (Number.isSafeInteger(previous.fence) ? previous.fence : 0) + 1;
  return {
    schemaVersion: 1, status: 'active', owner, fence,
    task: typeof task === 'string' ? task.slice(0, 180) : null,
    workBranch: typeof workBranch === 'string' ? workBranch.slice(0, 180) : null,
    acquiredAt: started, lastHeartbeat: started,
    expiresAt: nowDate(nowMs + ttlMinutes * 60000),
    releasedAt: null
  };
}

export function assertLeaseHeld(previous, { owner, fence, nowMs = Date.now() }) {
  validate(previous);
  if (previous.status !== 'active' || previous.owner !== owner ||
      previous.fence !== fence || validTime(previous.expiresAt) <= nowMs) {
    throw new LeaseError('LEASE_NOT_HELD', 'Session no longer owns an unexpired lease; stop all GitHub mutations');
  }
  return true;
}

export function renewLease(previous, { owner, fence, nowMs = Date.now(), ttlMinutes = DEFAULT_TTL_MINUTES }) {
  requireTTL(ttlMinutes);
  assertLeaseHeld(previous, { owner, fence, nowMs });
  return {
    ...previous, lastHeartbeat: nowDate(nowMs),
    expiresAt: nowDate(nowMs + ttlMinutes * 60000)
  };
}

export function releaseLease(previous, { owner, fence, nowMs = Date.now() }) {
  assertLeaseHeld(previous, { owner, fence, nowMs });
  return {
    ...previous, status: 'idle', owner: null, task: null, workBranch: null,
    lastHeartbeat: nowDate(nowMs), expiresAt: null, releasedAt: nowDate(nowMs)
  };
}
