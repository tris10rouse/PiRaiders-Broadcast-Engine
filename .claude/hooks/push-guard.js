#!/usr/bin/env node
/* PreToolUse hook on Bash: denies every forced git push (`--force`, `--force-with-lease`, `-f` or a `+refspec`)
 * to any branch, and every push whose destination is the default branch (main or master): work reaches the
 * default branch only through a pull request. A push that names no destination, or pushes --all / --mirror,
 * is denied too when it could reach the default branch. Generic: nothing in it is specific to one project. */
'use strict';
const DEFAULT = ['main', 'master'];

/* Split a command line into simple commands (on ; && || | & and newlines) and each into words (quotes removed). */
function commands(cmd) {
  return String(cmd || '').split(/&&|\|\||[;|&\n]/).map(seg => {
    const words = [], re = /"([^"]*)"|'([^']*)'|(\S+)/g; let m;
    while ((m = re.exec(seg))) words.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
    return words;
  });
}
const branchOf = ref => { const r = ref.replace(/^\+/, ''), dst = r.indexOf(':') >= 0 ? r.slice(r.lastIndexOf(':') + 1) : r; return dst.replace(/^refs\/heads\//, ''); };

/* Why this command must be denied, or '' to allow it. */
function reason(cmd, current) {
  for (const w of commands(cmd)) {
    const g = w.indexOf('git'); if (g < 0) continue;
    let i = g + 1;
    while (i < w.length && w[i] !== 'push') { if (/^-[Cc]$/.test(w[i])) i++; else if (!/^-/.test(w[i])) break; i++; }   // git -C dir push
    if (w[i] !== 'push') continue;
    const flags = [], pos = [];
    const rest = w.slice(i + 1);
    for (let k = 0; k < rest.length; k++) {
      const a = rest[k];
      if (/^(--repo|-o|--push-option|--receive-pack|--exec)$/.test(a)) { flags.push(a); k++; continue; }   // takes the next word
      (/^-/.test(a) ? flags : pos).push(a);
    }
    const force = flags.some(f => /^--force(-with-lease|-if-includes)?(=|$)/.test(f) || /^-[a-z]*f[a-z]*$/i.test(f) && !/^--/.test(f));
    const refs = pos.slice(1);
    if (force || refs.some(r => /^\+/.test(r))) return 'Force-pushing is not allowed in this repository. Rebase or merge and push without force.';
    if (flags.some(f => /^--(all|mirror|branches)$/.test(f))) return 'Push one named branch, never --all or --mirror (it could reach ' + DEFAULT.join('/') + ').';
    // No refspec: git pushes the current branch (push.default simple/current), so the current branch decides.
    const hit = refs.length ? refs.find(r => DEFAULT.indexOf(branchOf(r)) >= 0) : (DEFAULT.indexOf(current || '') >= 0 ? current : '');
    if (hit) return 'Pushing to ' + branchOf(hit) + ' is not allowed: work lands by pull request with every check green.';
  }
  return '';
}
function currentBranch(cwd) {
  try { return require('child_process').execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: cwd || process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch (e) { return ''; }
}
function decide(input, current) {
  if (!input || input.tool_name !== 'Bash') return null;
  const cmd = input.tool_input && input.tool_input.command;
  if (!/\bpush\b/.test(String(cmd || ''))) return null;
  const why = reason(cmd, current !== undefined ? current : currentBranch(input.cwd));
  return why ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } } : null;
}
module.exports = { reason, decide, commands };

if (require.main === module) {
  let s = ''; process.stdin.on('data', d => { s += d; }).on('end', () => {
    let out = null; try { out = decide(JSON.parse(s || '{}')); } catch (e) { out = null; }
    if (out) process.stdout.write(JSON.stringify(out) + '\n');
  });
}
