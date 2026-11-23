#!/usr/bin/env node
'use strict';
/**
 * Wait until every GitHub check on one commit has finished, renewing this clone's lease while waiting
 * (the lease must be renewed at least every 15 minutes). Reads check runs with `gh api` (read only).
 *
 *   node scripts/builder/wait-checks.cjs <sha> [--repo owner/name] [--timeout-min 75] [--once]
 *
 * Prints one line per check, then a verdict line. Exit 0 every check passed (success, skipped or
 * neutral) · 1 a check failed · 2 timed out or no check appeared · 3 the lease was lost (stop writing).
 * --once reads once and prints, exit 0 green, 1 red, 2 still running or none.
 */
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');

const PASS = ['success', 'skipped', 'neutral'];

/** Check runs → { done, green, lines }. A name seen twice counts only its newest run. */
function summarize(runs) {
  const newest = {};
  for (const r of runs || []) {
    const k = r.name;
    if (!newest[k] || Date.parse(r.started_at || 0) >= Date.parse(newest[k].started_at || 0)) newest[k] = r;
  }
  const list = Object.values(newest).sort((a, b) => a.name < b.name ? -1 : 1);
  const done = list.length > 0 && list.every(r => r.status === 'completed');
  const failed = list.filter(r => r.status === 'completed' && PASS.indexOf(r.conclusion) < 0);
  return {
    count: list.length, done, green: done && failed.length === 0, failed: failed.map(r => r.name),
    lines: list.map(r => r.name + '\t' + r.status + '\t' + (r.conclusion || '') + (r.html_url ? '\t' + r.html_url : ''))
  };
}

function repoSlug(cwd) {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd }).toString().trim();
  const m = /[/:]([^/:]+)\/([^/]+?)(?:\.git)?$/.exec(url);
  return m ? m[1] + '/' + m[2] : '';
}

function readRuns(repo, sha) {
  const out = execFileSync('gh', ['api', '-X', 'GET', 'repos/' + repo + '/commits/' + sha + '/check-runs', '-f', 'per_page=100'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  return JSON.parse(out).check_runs || [];
}

function renew(cwd) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'lease-git.mjs'), 'renew'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  return r.status;
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function main() {
  const a = process.argv.slice(2), get = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const cwd = path.resolve(__dirname, '..', '..');
  const sha = a[0];
  if (!sha || /^--/.test(sha)) { console.error('usage: wait-checks.cjs <sha> [--repo owner/name] [--timeout-min 75] [--once]'); process.exit(2); }
  const repo = get('--repo') || repoSlug(cwd);
  if (a.indexOf('--once') >= 0) {
    const s = summarize(readRuns(repo, sha));
    s.lines.forEach(l => console.log(l));
    console.log(s.green ? 'GREEN ' + s.count + ' checks' : s.done ? 'RED: ' + s.failed.join(', ') : 'RUNNING (' + s.count + ' so far)');
    process.exit(s.green ? 0 : s.done ? 1 : 2);
  }
  const deadline = Date.now() + Number(get('--timeout-min') || 75) * 60000;
  const started = Date.now();
  let lastRenew = Date.now(), stableDone = 0, lastCount = -1, s = null;
  while (Date.now() < deadline) {
    if (Date.now() - lastRenew > 10 * 60000) {
      const code = renew(cwd);
      if (code === 3) { console.log('LEASE LOST: stop writing'); process.exit(3); }
      lastRenew = Date.now();
    }
    try { s = summarize(readRuns(repo, sha)); } catch (e) { s = null; }
    if (s && s.done) {
      // Workflows register their checks a little apart: finish only after two quiet reads, never in the first 3 minutes.
      stableDone = s.count === lastCount ? stableDone + 1 : 0;
      if (stableDone >= 1 && Date.now() - started > 3 * 60000) break;
    } else stableDone = 0;
    lastCount = s ? s.count : -1;
    await sleep(60000);
  }
  if (!s || !s.done) { console.log('TIMEOUT: ' + (s ? s.count + ' checks, not all finished' : 'no checks read')); process.exit(2); }
  s.lines.forEach(l => console.log(l));
  console.log(s.green ? 'GREEN ' + s.count + ' checks' : 'RED: ' + s.failed.join(', '));
  process.exit(s.green ? 0 : 1);
}

module.exports = { summarize, repoSlug };
if (require.main === module) main();
