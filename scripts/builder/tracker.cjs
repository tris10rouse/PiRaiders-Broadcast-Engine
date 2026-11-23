#!/usr/bin/env node
'use strict';
/**
 * Status of the builders as one JSON object (the "status" answer of the builders skill):
 * building (from the lease), needs-you, the next 5 rows, pull requests merged in 7 days,
 * counts per folder and Builders: N from AGENTS.md. Reads only the repository and git.
 *   node scripts/builder/tracker.cjs [--now ISO] [--ref origin/master]
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readQueue, FOLDERS } = require('./queue.cjs');

function builders(root) {
  const f = path.join(root, 'AGENTS.md');
  const m = fs.existsSync(f) ? /^Builders:\s*(\d+)\s*$/m.exec(fs.readFileSync(f, 'utf8')) : null;
  return m ? Number(m[1]) : null;
}

/** "subject\tISO date" lines of first-parent commits → merged pull requests in the 7 days to now. */
function merged(lines, now) {
  const from = now.getTime() - 7 * 864e5, out = [];
  for (const l of String(lines).split('\n')) {
    const [subject, date] = l.split('\t');
    const m = /^(.*) \(#(\d+)\)$/.exec(subject || '');
    const t = Date.parse(date);
    if (m && t >= from && t <= now.getTime()) out.push({ title: m[1], pr: Number(m[2]), date: new Date(t).toISOString().slice(0, 10) });
  }
  return out;
}

function lease(root) {
  try {
    execFileSync('git', ['fetch', '-q', 'origin', '+refs/heads/coordination/agent-lease:refs/builder/lease-head'], { cwd: root, stdio: 'pipe' });
    return JSON.parse(execFileSync('git', ['show', 'refs/builder/lease-head:agent/lease.json'], { cwd: root }).toString());
  } catch (e) { return null; }
}

function track(opts) {
  const root = opts.root, now = opts.now ? new Date(opts.now) : new Date();
  const { rows, order } = readQueue(root);
  const todo = {}; rows.todo.forEach(r => { todo[r.id] = r; });
  const counts = {}; FOLDERS.forEach(f => { counts[f] = rows[f].length; });
  const l = opts.lease === undefined ? lease(root) : opts.lease;
  const active = l && l.status === 'active' && Date.parse(l.expiresAt) > now.getTime();
  let log = opts.log;
  if (log === undefined) {
    try { log = execFileSync('git', ['log', '--first-parent', '--since=8 days ago', '--format=%s%x09%cI', opts.ref || 'origin/master'], { cwd: root }).toString(); }
    catch (e) { log = ''; }
  }
  return {
    building: active ? { task: l.task, branch: l.workBranch, since: l.acquiredAt, until: l.expiresAt } : null,
    needsYou: rows['needs-you'].map(r => ({ id: r.id, title: r.fields.Title || r.id, sentence: r.fields['Needs you'] || '', link: r.fields.Link || '' })),
    next: (order || []).filter(id => todo[id]).slice(0, 5).map(id => ({ id, title: todo[id].fields.Title || id, size: todo[id].fields.Size || '' })),
    merged: merged(log, now),
    counts,
    builders: builders(root),
    asOf: now.toISOString()
  };
}

module.exports = { track, merged, builders };

if (require.main === module) {
  const a = process.argv.slice(2), get = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  console.log(JSON.stringify(track({ root: path.resolve(__dirname, '..', '..'), now: get('--now'), ref: get('--ref') }), null, 2));
}
