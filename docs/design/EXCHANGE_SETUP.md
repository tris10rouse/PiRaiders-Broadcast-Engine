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

## What it prints

One JSON line: `{ok, step, code, done}`, where `done` names the steps passed and what happened to each store. No path, store id or feed id. Exit 0 done, 1 refused, 2 wrong arguments (`SETUP_USAGE`).

## Not here

- The linked source root rule (5b-2): setup checks the resolved spelling and reads from it, so it accepts a media root reached through a link, while the reader refuses one when the service reads through the alias. 5b-2 decides.
- Offline pins and cached startup (5b-3), and the Windows job using this command (5b-4: that job still sets up its stores through the fixture).
- Store ids are written into the machine file by whoever writes it; setup does not generate or change the machine file.
- No screen, route or source write. Nothing about Windows, the stadium PC or the board is shown by these tests.

## Tests

`tests/exchange-setup.test.cjs`, 6 tests on real temporary stores with the synthetic exchange documents of the activation fixture: first run and an unchanged second run; the command's printed answer and exit codes; machine without a source and a non-loader copy; absent and redirected roots, a foreign feed and a broken catalog making no store; foreign, empty and wrongly bound stores refused and left as they were; half-done setups finished. Each guard (loader check, root check, feed check, binding check, "missing only" for both stores, the binding confirmation) was removed in turn and at least one test failed every time.
