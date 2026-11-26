'use strict';
// 5d-3: the application opens Game Day in the system's default browser, for the
// Windows exchange activation proof. The application started without
// --no-browser hands its /game-day URL to the default handler
// (rundll32 url.dll,FileProtocolHandler, scripts/piraiders-app.cjs); the proof
// then finds the new browser process whose command line holds that exact
// loopback URL, closes the browser itself, and only then closes the
// application, which must still leave nothing it owns.
//
// Command lines are matched inside the PowerShell query and never printed or
// kept: the query answers only a yes/no per process. Only the browser's image
// name (for example msedge.exe) is kept. Disposable hosted Windows CI tooling;
// never shipped in the application ZIP. No stadium PC or hardware claim.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { processTable, descendants, observeTree } = require('./windows-process-evidence.cjs');

// The URL arrives in an environment variable, never in the command text. A
// match is the URL as a whole word: start or a space or quote before it, the
// end or a space or quote after it (so /game-day/api/... is not a match). The
// query holds no double quote (\x22 in the pattern): its text passes through
// Windows command-line quoting unchanged.
const BROWSER_QUERY = "$ErrorActionPreference='Stop'; $url = $env:PIRAIDERS_PROOF_BROWSER_URL; if ([string]::IsNullOrEmpty($url)) { exit 3 }; " +
  "$pattern = '(^|[\\s\\x22])' + [regex]::Escape($url) + '($|[\\s\\x22])'; " +
  "$rows = @(Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object { [pscustomobject]@{ ProcessId = $_.ProcessId; ParentProcessId = $_.ParentProcessId; ExecutablePath = $_.ExecutablePath; " +
  "CreationUtcTicks = $(if ($null -eq $_.CreationDate) { $null } else { $_.CreationDate.ToUniversalTime().Ticks.ToString([System.Globalization.CultureInfo]::InvariantCulture) }); " +
  "HasUrl = ($null -ne $_.CommandLine -and [regex]::IsMatch($_.CommandLine, $pattern)) } }); " +
  "$json = ConvertTo-Json -Compress -InputObject $rows; $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($json); $stream = [Console]::OpenStandardOutput(); $stream.Write($bytes,0,$bytes.Length); $stream.Flush()";

const LOOPBACK_GAME_DAY = /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/game-day$/;
function checkURL(url) { if (typeof url !== 'string' || !LOOPBACK_GAME_DAY.test(url)) throw Error('BROWSER_URL_INVALID'); return url; }
// The query's pattern, in JavaScript's spelling (for the Linux tests).
function urlPattern(url) { return '(^|[\\s\\x22])' + checkURL(url).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '($|[\\s\\x22])'; }

function processKeys(rows) {
  if (!Array.isArray(rows)) throw Error('BROWSER_TABLE_INVALID');
  return new Set(rows.map(row => row.ProcessId + ':' + row.CreationUtcTicks));
}
// The browser: processes the snapshot did not hold whose command line holds the URL.
function browserRoots(rows, before) {
  if (!Array.isArray(rows) || !(before instanceof Set)) throw Error('BROWSER_TABLE_INVALID');
  // A root must carry its image and creation time: the close is checked against them.
  return rows.filter(row => row && row.HasUrl === true && typeof row.ExecutablePath === 'string' && row.ExecutablePath !== '' &&
    typeof row.CreationUtcTicks === 'string' && /^[1-9][0-9]{0,18}$/.test(row.CreationUtcTicks) && !before.has(row.ProcessId + ':' + row.CreationUtcTicks));
}
function browserTable(url, { run = execFileSync } = {}) {
  const raw = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', BROWSER_QUERY], { encoding: 'utf8', timeout: 15000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PIRAIDERS_PROOF_BROWSER_URL: checkURL(url) } });
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) throw Error('BROWSER_TABLE_INVALID');
  return rows;
}
// Every process of the browser: the matched roots, what they started, and any
// other process of the same image started after the snapshot.
function browserTree(rows, roots, before) {
  const found = new Map();
  const add = row => { const key = row.ProcessId + ':' + row.CreationUtcTicks; if (!found.has(key)) found.set(key, row); };
  // A tree that cannot be read whole still keeps its root, so the root is always closed.
  const under = row => { try { return descendants(rows, row.ProcessId); } catch { return [row]; } };
  for (const root of roots) for (const row of under(root)) add(row);
  const images = new Set(roots.map(row => String(row.ExecutablePath).toLowerCase()));
  for (const row of browserRoots(rows.map(row => row && ({ ...row, HasUrl: true })), before)) if (images.has(row.ExecutablePath.toLowerCase())) {
    for (const child of under(row)) add(child);
  }
  return [...found.values()];
}
// The proof closes the browser it found (whole tree, forced), then waits until
// none of it runs. A taskkill that fails because the process already went is fine.
async function closeBrowser(tree, { until, kill = pid => execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 15000, windowsHide: true }), table = processTable, boundMs = 15000 } = {}) {
  for (const row of tree) { try { kill(row.ProcessId); } catch { /* checked below */ } }
  let counts;
  await until(() => { counts = observeTree(table(), tree); return counts.surviving === 0 && counts.unknown === 0; }, 'BROWSER_SURVIVED_CLOSE', boundMs);
  return counts;
}
const IMAGE_NAME = /^[a-z0-9_.-]{1,64}\.exe$/;
function browserRecord({ appReportedOpened, image, roots, tracked, closeMs }) {
  if (appReportedOpened !== true) throw Error('APP_DID_NOT_REPORT_BROWSER_OPENED');
  if (!Number.isInteger(roots) || roots < 1 || !Number.isInteger(tracked) || tracked < roots) throw Error('BROWSER_PROCESS_NOT_SEEN');
  const name = typeof image === 'string' ? path.win32.basename(image).toLowerCase() : '';
  if (!IMAGE_NAME.test(name)) throw Error('BROWSER_IMAGE_INVALID');
  if (!Number.isFinite(closeMs) || closeMs < 0) throw Error('BROWSER_CLOSE_TIME_INVALID');
  return { opener: 'rundll32 url.dll,FileProtocolHandler', appReportedOpened: true, browserImage: name, urlInCommandLine: true, browserRoots: roots,
    browserProcessesTracked: tracked, closedByProofMs: Math.round(closeMs), everyBrowserProcessGone: true };
}

module.exports = { BROWSER_QUERY, urlPattern, processKeys, browserRoots, browserTable, browserTree, closeBrowser, browserRecord };
