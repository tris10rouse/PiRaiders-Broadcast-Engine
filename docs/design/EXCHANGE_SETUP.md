# Exchange setup (item 5b)

Part 5b-1 (2026-11-23, fence 73). The operator's one setup step for a source machine, run on the PC before the first Game Day:

    node scripts/piraiders-setup.cjs --machine <absolute path to machine.json>

## What it does, in order

1. **machine**: loads the machine file with the real loader (`loadGameDayMachineConfig`); a file without a `source` block, or any object the loader did not make, is `SETUP_MACHINE_NOT_SOURCE`.
2. **source**: the media root must resolve to the retained canonical spelling (`SETUP_SOURCE_UNAVAILABLE`, `SETUP_SOURCE_ROOT_MISMATCH`). Same comparison as the source service (case-insensitive on Windows).
3. **feed**: feed and catalog are read from the canonical spelling and validated with the retained binding by the catalog reader; another feed is `SETUP_FEED_BINDING_MISMATCH`, anything else `SETUP_FEED_<reader code>`.
4. **journal**: missing, it is made (its parent folder too) and the binding confirmed (`initialized`); there without a binding, the binding is confirmed (`bound`); there with this binding, nothing changes (`present`). Another store id or an empty folder is the journal's own code (`JOURNAL_INVALID`); another binding is `SETUP_JOURNAL_BINDING_MISMATCH`.
5. **approvals**: missing, an empty list is made (`initialized`); there, nothing changes (`present`); another store id is `APPROVAL_INVALID`.

Nothing is made before steps 1 to 3 pass. A store that is there is never reinitialized, repaired or replaced: the operator decides. A half-done setup (journal without binding, or without an approval list) is finished by running it again.

## Offline pins (5b-3)

Part 5b-3 (2026-11-23, fence 75). After a button has been confirmed on the PC and prepared online once (the cache holds its pictures):

    node scripts/piraiders-setup.cjs --machine <absolute path to machine.json> --pin-offline

It runs steps 1 to 5 first (so it needs the exchange folder, `SETUP_SOURCE_UNAVAILABLE` without it), then step 6, **offline**, through the source service (`pinOfflineSelections`; no screen or route calls it). For each of this machine's current confirmations (same provider, binding and machine-policy fingerprint) it inspects the button in the source and:

- not eligible (cancelled or finished): `ineligible`, nothing written;
- not complete, or no verified cache snapshot of exactly the current playback (feed, epoch, selection, tuple and playback fingerprint; every snapshot is checked by the cache loader): `notPrepared`, nothing written, an older pin stays;
- already pinned to that snapshot and playback: `unchanged`;
- otherwise it appends the same confirmation (window, machine policy, confirmation) with `offline: {snapshotId, playbackFingerprint}`: `pinned`. The confirmation is still good for online startup.

Just before each write it rereads the list: if the confirmation is no longer exactly the one it inspected (revoked or confirmed again meanwhile), it writes nothing and answers `APPROVAL_CONFLICT`. While another owner in the same process holds this machine's source boundary it is `SETUP_SOURCE_IN_USE`. The cache scan stops at 512 snapshot folders (`OFFLINE_PIN_CACHE_TOO_LARGE`). The answer adds `done.offline: {pinned, unchanged, notPrepared, ineligible}`, counts only.

**Cached startup.** The approved list reads only the approval list. When an approved button has an offline pin and the media root does not resolve at all (the exchange folder is gone), its profile asks for cached startup with that pin; with the folder there it stays a source startup, and a folder that resolves elsewhere stays a source startup and is refused. The startup mode is part of the catalog revision. The provider and the revalidator still decide: the approval must hold exactly that pin (`OFFLINE_AUTHORIZATION_REQUIRED` otherwise), the snapshot is verified again from the cache. A new PC confirmation (a changed window) writes no pin, so the button needs `--pin-offline` again before it can start offline; a revoke removes it.

## What it prints

One JSON line: `{ok, step, code, done}`, where `done` names the steps passed and what happened to each store. No path, store id or feed id. Exit 0 done, 1 refused, 2 wrong arguments (`SETUP_USAGE`).

## Not here

- The linked source root rule (5b-2): setup checks the resolved spelling and reads from it, so it accepts a media root reached through a link, while the reader refuses one when the service reads through the alias. 5b-2 decides.
- 5b-4 (2026-11-23, fence 76): the Windows exchange activation job now sets up its stores with this command (twice), pins with `--pin-offline` and proves a cached start with the exchange folder gone on hosted Windows with real Caspar and NDI software output (`EXCHANGE_ACTIVATION_WINDOWS_PROOF.md`, step 6). Same-machine CI evidence only.
- A pin to an older playback stays when the button's current playback is not prepared; cached startup then plays that older, verified snapshot. Not decided further here.
- Store ids are written into the machine file by whoever writes it; setup does not generate or change the machine file.
- No screen, route or source write. Nothing about Windows, the stadium PC or the board is shown by these tests.

## Tests

`tests/exchange-setup.test.cjs`, 6 tests on real temporary stores with the synthetic exchange documents of the activation fixture: first run and an unchanged second run; the command's printed answer and exit codes; machine without a source and a non-loader copy; absent and redirected roots, a foreign feed and a broken catalog making no store; foreign, empty and wrongly bound stores refused and left as they were; half-done setups finished. Each guard (loader check, root check, feed check, binding check, "missing only" for both stores, the binding confirmation) was removed in turn and at least one test failed every time.

`tests/exchange-offline-pins.test.cjs`, 6 tests (5b-3), same stores and fixture (the fixture gained `eligible: false` and `generation: 2`, the same button with its pictures reversed; its default output is unchanged): pin by the command, an unchanged second run, online startup kept, then with the folder renamed away a manager over the service prepares in cached mode, the cached pictures come in the source order, Next, Next and Stop dispatch; a missing pin, another snapshot id or playback, a changed approval and a revoke each refuse cached startup, and pinning refuses with the folder gone; nothing pinned for an unprepared button, a cache of an older playback, another machine's confirmation or an ineligible button; a cache over the scan bound refused with its own code; a revoke during pinning wins. Each guard (eligibility, playback match, machine-policy filter, the reread before the write, the scan bound's code, "folder gone", "pin present", startup in the revision) was removed in turn and a test failed every time; all fail on the code before 5b-3.
