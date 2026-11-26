# PiRaiders operator checklist (evaluation bench)

For a disposable, nonproduction Windows x64 PC only. Do the steps in order. Each step says what the command or page shows when it worked, and what to do first when it refuses. The commands print fixed codes only: no paths, ids or names. Before any of them runs, the four `.cmd` entries refuse on their own with a plain sentence and exit 2: a wrong argument, "Bundled Node runtime is missing" (extract the whole ZIP again) or "Application configuration is missing" (step 3). Background and limits: `README-WINDOWS.md` in this folder.

Every step here is behaviour that exists and is tested, on Linux and, where it says so, on a GitHub-hosted Windows runner. It is not tested on the stadium PC. Windows evidence for steps 6 to 11 comes from the same application run from the source tree on a hosted runner; from this extracted ZIP, CI launches with an empty local catalog only, and runs Verify, Setup and Diagnose from the ZIP (parts 5f-3 and Q-013). If a step does not match what you see, stop and keep the console output; do not work around it.

**Not shown by any test yet:** the stadium PC, Windows 10, a cold-booted PC, a synced or linked Google Drive folder as the exchange folder, NDI over a network, an NDI receiver other than the test receiver, the board's input, and anything on air. "NDI sender running" in Diagnose means this PC's sender process runs; it does not mean a receiver found it, the board shows it, or it is on air.

## 1. Check the download

- Keep the ZIP beside its `PiRaiders-Development-win-x64.zip.sha256` file. Before extracting, compare the ZIP's SHA-256 with that file (for example, PowerShell `Get-FileHash -Algorithm SHA256` on the ZIP). Different: do not extract; get the ZIP again.
- Extract the whole ZIP into a new, empty, writable folder. Spaces, non-English letters and `!` in the folder path are fine. Do not run anything from inside the ZIP.
- Leave `BUILD-MANIFEST.json` and the licences as they are.
- Run `Verify-PiRaiders.cmd` from the extracted folder now, before step 3 writes any file of yours: it checks every extracted file against `BUILD-MANIFEST.json` and takes no arguments. The manifest is not signed: it finds a damaged or incomplete extraction, not a forged download (the SHA-256 comparison above is for that).

**Worked:** exit 0 and one line with the code `BUNDLE_VERIFIED` and the number of files checked, for example `{"ok":true,"code":"BUNDLE_VERIFIED","files":1234}`.

| Code | First thing to do |
|---|---|
| `BUNDLE_DIFFERS` | `differences` says which kinds were found: `missing` (a listed file is not there), `changed` (a listed file has other bytes, or is a folder or link) or `extra` (a file the ZIP did not hold), with a count of each. Delete the folder and extract the whole ZIP again into a new, empty folder. `extra` alone after step 3 only means your own files are there; run this check before step 3. |
| `MANIFEST_INVALID` | `BUILD-MANIFEST.json` is missing, unreadable or not a valid manifest: delete the folder and extract the whole ZIP again; if it repeats, get the ZIP again. |
| `VERIFY_USAGE` | Only when `app\scripts\piraiders-verify-bundle.cjs` is run directly with an argument (exit 2); use `Verify-PiRaiders.cmd` instead. |
| `VERIFY_FAILED` | The check stopped unexpectedly: keep the console output, extract the whole ZIP again and run it once more. |

## 2. Choose local or source mode

- **Local mode**: SPX and Game Day without an exchange folder. Start from `app\config\piraiders-app.example.json`. It has no events and no video output; an empty Game Day list is expected. Setup does not apply (it answers `SETUP_MACHINE_NOT_SOURCE`).
- **Source mode**: Game Day reads board buttons from an exchange folder. Start from `app\config\piraiders-app.source.example.json`. Steps 4 to 11 are written for source mode.

## 3. Write the machine file and its ids

- Copy the chosen example to `app\config\piraiders-app.json`. That exact name is the only one the three commands read.
- Source mode: replace every `<REPLACE: ...>` value. The two store ids are two different new random v4 UUIDs (PowerShell `New-Guid`, twice). The feed id and the epoch come from the exchange; the epoch is a number without quotes. `expectedCanonicalRoot` is the exchange folder's real full path.
- For a new SPX bench, also copy `app\config\spx-app.example.json` to `app\config.json` (README-WINDOWS.md, step 2).
- A file with any placeholder left, or any other mistake, is refused by every command: Setup and Diagnose print `MACHINE_CONFIG_INVALID`, Launch prints `APP_CONFIG_INVALID`. Fix the file; nothing was written.

## 4. Run Setup

Run `Setup-PiRaiders.cmd` from the extracted folder, with the application closed.

**Worked:** exit 0 and one line that starts `{"ok":true,"step":"done"` with `journal` and `approvals` each `initialized` (made now) the first time. Run it again: `present` and `present`, nothing changed. (`bound` means a journal that was already there got its binding now.) `"source":"direct"` or `"linked"` says how the exchange folder was reached.

| Code | First thing to do |
|---|---|
| `SETUP_USAGE` | Only when `app\scripts\piraiders-setup.cjs` is run directly with wrong arguments (exit 2); use `Setup-PiRaiders.cmd` instead. |
| `MACHINE_CONFIG_INVALID` | Fix `app\config\piraiders-app.json` (step 3). |
| `SETUP_MACHINE_NOT_SOURCE` | The machine file is a local-mode file; Setup is for source mode only (step 2). |
| `SETUP_SOURCE_UNAVAILABLE` | The exchange folder cannot be opened: check it exists on this PC and is fully synced, then run Setup again. |
| `SETUP_SOURCE_ROOT_MISMATCH` | The exchange folder resolves somewhere other than `expectedCanonicalRoot`: correct one of the two so they name the same real folder. |
| `SETUP_FEED_BINDING_MISMATCH` | The folder holds another feed or epoch: check the feed id and epoch in the machine file against the exchange. |
| `SETUP_FEED_…` (any other) | The feed or catalog in the folder could not be read or checked: let the exchange finish writing, then run Setup again; if it repeats, keep the line for the scheduler side. |
| `JOURNAL_INVALID` | A journal folder is there but is not this machine's (another store id, or empty): do not delete it; check `journalStoreId`, or point the machine file at a new folder. |
| `SETUP_JOURNAL_BINDING_MISMATCH` | This machine's journal is bound to another feed or epoch: do not edit it; ask before rebinding. |
| `SETUP_JOURNAL_PARENT_FAILED` | The journal's parent folder could not be made: check the path and that this Windows user can write there. |
| `APPROVAL_INVALID` | An approval list is there but is not this machine's: check `approvalStoreId`; do not delete the folder. |
| `SETUP_APPROVALS_PARENT_FAILED` | The approval list's parent folder could not be made: check the path and write permission. |
| `SETUP_FAILED` | Unexpected failure: keep the line, run Diagnose (step 5) and report both. |

## 5. Run Diagnose

Run `Diagnose-PiRaiders.cmd`. It reads only; it never writes. It works with the application open or closed.

**Worked:** exit 0 and one line with `"ok":true` and six states. With the application closed, in source mode: `exchangeFolder` is `reachable`, `catalogSequence` is `read` with a number, `approvals` is `readable`; `prepared`, `renderer` and `ndiSender` are `unknown` with `APP_NOT_RUNNING`, and `app` is `not-running`. In local mode the three exchange states are `not-used`. `"ready":false` is always printed: Diagnose never says ready or on air.

Diagnose refuses (exit 1) only with `MACHINE_CONFIG_INVALID` or `DIAGNOSE_FAILED`. Every other code below is one of the state codes inside an exit-0 line with `"ok":true`: read each state's `code`, not only the exit.

| Code | First thing to do |
|---|---|
| `DIAGNOSE_USAGE` | Only when `app\scripts\piraiders-diagnose.cjs` is run directly with wrong arguments (exit 2); use `Diagnose-PiRaiders.cmd` instead. |
| `MACHINE_CONFIG_INVALID` | Fix `app\config\piraiders-app.json` (step 3). |
| `SOURCE_UNAVAILABLE` | Exchange folder not reachable: as `SETUP_SOURCE_UNAVAILABLE` in step 4. |
| `SOURCE_ROOT_MISMATCH` | As `SETUP_SOURCE_ROOT_MISMATCH` in step 4. |
| `CATALOG_UNAVAILABLE` | The catalog could not be read now: wait for the exchange to finish writing and run Diagnose again. |
| `APPROVAL_UNREADABLE` | The approval list cannot be read: run Setup (step 4) and read its code. |
| `APP_NOT_RUNNING` | Expected before step 6. After step 6, the application is not running: read the launch console. |
| `APP_NO_ANSWER` | Something listens on the SPX port but did not answer in time: wait a few seconds, run Diagnose again; if it repeats, close the application (step 9) and launch again. |
| `APP_AUTH_REQUIRED` | SPX asks for a login and Diagnose cannot sign in (signing in in the browser does not change this): read the three application states in the Game Day page's **Diagnostics** panel instead. |
| `APP_UNAVAILABLE` | The application answers but Game Day is not available yet: wait and run Diagnose again. |
| `APP_PORT_INVALID` | The SPX configuration's port cannot be read: check `app\config.json` (`general.port`). |
| `APP_ANSWER_INVALID` | Another program, not this application, answers on the SPX port: close it, or change the SPX port. |
| `APP_MODE_MISMATCH` | The running application uses another machine file (local against source): close it and launch with this one. |
| `STATE_UNAVAILABLE` | A store or the application gave a code Diagnose does not print as it is: run Setup (step 4) and read its code; if the application is running, read the Game Day page's **Diagnostics** panel. |
| `DIAGNOSE_FAILED` | Unexpected failure: keep the line and report it. |

## 6. Launch

Run `Launch-PiRaiders.cmd` and keep its console window open for the whole session. It opens Game Day in the default browser (tested on a hosted Windows runner). `Launch-PiRaiders.cmd --no-browser` prints the page's address instead.

**Worked:** the console prints a line with `controller-available` and `"browserOpened":true` (with `--no-browser`, `false`). `"browserOpened":false` without `--no-browser` means the browser could not be opened: the application keeps running; open the printed address yourself. Run Diagnose again: `"app":"answered"`.

| Code | First thing to do |
|---|---|
| `APP_OPTIONS_INVALID` | Only `--no-browser` is accepted. |
| `APP_CONFIG_INVALID` | Fix `app\config\piraiders-app.json` (step 3) or `app\config.json` (README-WINDOWS.md, step 2). |
| `APP_PORT_BUSY` | Another program uses the SPX port: close it (an earlier PiRaiders included), or change the port in `app\config.json`. |
| `APP_PORT_UNAVAILABLE` | The SPX port could not be checked: wait, then launch again. |
| `WINDOWS_REQUIRED` | This bundle runs only on Windows. |
| `APP_HOST_MISSING` | The process containment helper is missing: extract the whole ZIP again into a new folder. |
| `APP_START_FAILED` | Start failed for another reason (also when the containment helper is missing): extract again, then report the line. |
| `APP_STARTUP_TIMEOUT` | SPX did not become available in time: close any other SPX, then launch again; if it repeats, report it. |
| `APP_PROCESS_FAILED` | SPX kept stopping: read `app\LOG`, check `app\config.json`, then launch again. |
| `APP_IDENTITY_STALE` | SPX restarted during start: launch again. |
| `APP_CLOSED` | The application was closed while it started: launch again. |

## 7. Approve, prepare and activate on Game Day

On the Game Day page (the iPad operator never uses this page):

1. Under **Exchange events**, press [Refresh from exchange] if the list is empty, choose an event, then a board button under **Boards and buttons**, then [Check this button].
2. Under **Approval on this PC**, enter the production window (this PC's clock; the confirmation shows Central time) and the warm-up, press [Approve for this window…] and confirm.
3. Under **Approved board buttons**, press [Refresh list], choose the button, press [Prepare selected button]. Preparation checks every picture.
4. Under **Prepared event**, press [Activate event] (or [Discard]).
5. Under **Playback**: [Launch slide 1], [Next], [Previous]. [Auto] and [Manual] switch the mode; [Reload media] reloads.

**Worked:** each section moves on to the next; Playback names the event. The **Diagnostics** panel ([Read diagnostics again]) shows `prepared` and the renderer acknowledged; the NDI sender running means only that the sender runs (see the top of this page).

**Refused:** the page says why in its own words. First run Diagnose (step 5) and read its codes. A preparation is refused outside the approved window and when the button changed after approval: check and approve it again. An event that stopped and cannot restart offers [End this event] under Playback.

## 8. Stop

Press [Stop · black output]. **Worked:** the output goes black; the event stays active and the sender stays up inside the production window. Stop is not closing the application. On a hosted Windows runner Stop was black every time, also during a four-hour run (240 of 240).

## 9. Close

In the launch console press Ctrl+C (or Ctrl+Break, or close the console window). **Worked:** the console ends within seconds and everything it started is closed (tested on a hosted Windows runner for Ctrl+C and the window's close). Closing the browser tab does not close the application.

| Code | First thing to do |
|---|---|
| `APP_CLOSE_FAILED` | Some started process may still run: do not launch again yet; keep the console output and report it (README-WINDOWS.md, step 6). |

## 10. Pin offline

With the application closed (step 9) and the exchange folder present, run `Setup-PiRaiders.cmd --pin-offline`. It pins every approved button that was prepared online, so it can start from this PC's cache when the exchange folder is gone.

**Worked:** `{"ok":true,"step":"done"` with `"offline"` counts: `pinned` (pinned now), `unchanged` (already pinned), `notPrepared` (prepare it online first, step 7, then pin again), `ineligible` (cancelled or finished in the exchange).

| Code | First thing to do |
|---|---|
| `SETUP_SOURCE_UNAVAILABLE` | Pinning needs the exchange folder: reconnect it first. |
| `SETUP_SOURCE_IN_USE` | This machine's exchange source is open: close the application (step 9), then pin again. |
| `SETUP_SERVICE_FAILED` | The source could not be opened for pinning: run Diagnose, then pin again. |
| `APPROVAL_CONFLICT` | An approval changed while pinning: run `--pin-offline` again. |
| `OFFLINE_PIN_CACHE_TOO_LARGE` | The cache holds too many snapshots to scan: report it; do not delete cache folders by hand. |
| any step 4 code | As in step 4. |

## 11. Cached start

Optional. With the exchange folder disconnected, launch (step 6): the approved, pinned button prepares from the cache under **Approved board buttons** without a new approval and plays the same pictures in the same order (tested on a hosted Windows runner). A new approval (a changed window) needs `--pin-offline` again. Stop (step 8) and close (step 9) as before.

When the evaluation is over: close the application and delete the extracted folder only. Do not delete or overwrite an existing SPX installation or its media.
