#!/usr/bin/env node
'use strict';
/**
 * The builders' queue (AGENTS.md › A run): queue/ORDER.md plus one file per request in
 * queue/todo, queue/needs-you, queue/blocked and queue/parked. There is no "building" folder:
 * the claim on a row is the exclusive agent lease (task + workBranch in agent/lease.json).
 *
 * A queue file starts with header lines, then a line "---", then the owner's or the backlog's
 * words, copied word for word. This repository is public, so lint() also refuses anything that
 * looks private: an email address, an IP address, a Google Drive/Docs link, a Drive-style id,
 * or any link other than github.com and claude.ai.
 *
 *   node scripts/builder/queue.cjs lint      (exit 1 and one line per problem)
 *   node scripts/builder/queue.cjs next      (the first row in ORDER.md that is in todo/)
 */
const fs = require('node:fs');
const path = require('node:path');

const FOLDERS = ['todo', 'needs-you', 'blocked', 'parked'];
const KINDS = ['Engine', 'Proof', 'Fix', 'Chore', 'Docs'];
const AREAS = ['Exchange', 'Setup', 'Diagnostics', 'Windows proof', 'Packaging', 'CI', 'SPX', 'Docs', 'Build'];
const SIZES = ['S', 'M', 'L'];
const KEYS = ['Title', 'Kind', 'Area', 'Size', 'Added', 'Needs you', 'Blocked', 'Parked', 'Link', 'Branch', 'PR', 'Parent'];
const ID = /^(?:[0-9]+[a-z]?(?:-[0-9]+)?|Q-[0-9]{3})$/;

function header(text) {
  const out = {}, lines = String(text).split('\n');
  let i = 0;
  for (; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) break;
    const m = /^([A-Za-z][A-Za-z ]*):\s*(.*)$/.exec(lines[i]);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return { fields: out, hasRule: i < lines.length, body: lines.slice(i + 1).join('\n').trim() };
}

function readQueue(root) {
  const q = path.join(root, 'queue'), rows = {};
  for (const f of FOLDERS) {
    const dir = path.join(q, f);
    rows[f] = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter(n => /\.md$/.test(n)).sort().map(n => {
      const text = fs.readFileSync(path.join(dir, n), 'utf8');
      return { id: n.replace(/\.md$/, ''), folder: f, text, ...header(text) };
    });
  }
  const of = path.join(q, 'ORDER.md');
  const order = fs.existsSync(of)
    ? fs.readFileSync(of, 'utf8').split('\n').map(s => s.trim()).filter(s => s && !/^#/.test(s))
    : null;
  return { rows, order };
}

/** Text that must never be in this public repository's queue. Returns the kinds found. */
function privateHits(text) {
  const hits = [];
  const s = String(text);
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(s)) hits.push('an email address');
  if (/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(s)) hits.push('an IP address');
  if (/(drive|docs|sheets)\.google\.com/i.test(s)) hits.push('a Google Drive or Docs link');
  for (const m of s.matchAll(/https?:\/\/([^/\s)>\]]+)/gi)) {
    if (!/^(github\.com|claude\.ai)$/i.test(m[1])) { hits.push('a link to ' + m[1]); break; }
  }
  // A Drive-style id: 25 to 44 characters of letters, digits, - and _, with upper and lower case and a digit.
  for (const m of s.matchAll(/(?<![A-Za-z0-9_/-])[A-Za-z0-9_-]{25,44}(?![A-Za-z0-9_-])/g)) {
    const w = m[0];
    if (/[A-Z]/.test(w) && /[a-z]/.test(w) && /[0-9]/.test(w) && !/^[A-Z_]+$/.test(w.replace(/[0-9]/g, ''))) { hits.push('an id like a Drive id'); break; }
  }
  return hits;
}

function lint(root) {
  const problems = [];
  const { rows, order } = readQueue(root);
  if (!order) problems.push('queue/ORDER.md is missing');
  const where = {};
  for (const f of FOLDERS) {
    for (const r of rows[f]) {
      const at = 'queue/' + f + '/' + r.id + '.md';
      if (where[r.id]) problems.push(at + ': the same row is also in queue/' + where[r.id]);
      where[r.id] = f;
      if (!ID.test(r.id)) problems.push(at + ': a row id is a part number (5b, 5b-2) or Q-nnn');
      if (!r.hasRule) problems.push(at + ': no "---" line after the header');
      for (const k of Object.keys(r.fields)) if (KEYS.indexOf(k) < 0) problems.push(at + ': unknown header line "' + k + '"');
      const h = r.fields;
      if (!h.Title) problems.push(at + ': no Title');
      else if (h.Title.length > 80) problems.push(at + ': Title over 80 characters');
      if (KINDS.indexOf(h.Kind) < 0) problems.push(at + ': Kind must be one of ' + KINDS.join(', '));
      if (AREAS.indexOf(h.Area) < 0) problems.push(at + ': Area must be one of ' + AREAS.join(', '));
      if (SIZES.indexOf(h.Size) < 0) problems.push(at + ': Size must be S, M or L');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(h.Added || '')) problems.push(at + ': Added must be YYYY-MM-DD');
      if (f === 'needs-you' && !h['Needs you']) problems.push(at + ': a needs-you file has a "Needs you:" sentence');
      if (f === 'blocked' && !h.Blocked) problems.push(at + ': a blocked file has a "Blocked:" line');
      if (f === 'todo' && (h['Needs you'] || h.Blocked)) problems.push(at + ': a todo file has no Needs you or Blocked line');
      if (r.body.length < 40) problems.push(at + ': below the "---" line go the words it is built from, word for word');
      for (const hit of privateHits(r.text)) problems.push(at + ': holds ' + hit + ' (this repository is public)');
    }
  }
  if (order) {
    const seen = {};
    for (const id of order) {
      if (seen[id]) problems.push('queue/ORDER.md: ' + id + ' twice');
      seen[id] = true;
      if (!where[id]) problems.push('queue/ORDER.md: ' + id + ' has no queue file');
    }
    for (const r of rows.todo) if (!seen[r.id]) problems.push('queue/todo/' + r.id + '.md is not in ORDER.md');
    for (const hit of privateHits(order.join('\n'))) problems.push('queue/ORDER.md: holds ' + hit);
  }
  return problems;
}

function next(root) {
  const { rows, order } = readQueue(root);
  const todo = new Set(rows.todo.map(r => r.id));
  return (order || []).find(id => todo.has(id)) || null;
}

module.exports = { FOLDERS, KINDS, AREAS, header, readQueue, privateHits, lint, next };

if (require.main === module) {
  const root = path.resolve(__dirname, '..', '..');
  const cmd = process.argv[2];
  if (cmd === 'lint') {
    const p = lint(root);
    p.forEach(x => console.log(x));
    if (p.length) process.exitCode = 1; else console.log('queue: ok');
  } else if (cmd === 'next') {
    console.log(next(root) || '');
  } else {
    console.error('usage: node scripts/builder/queue.cjs lint | next');
    process.exitCode = 2;
  }
}
