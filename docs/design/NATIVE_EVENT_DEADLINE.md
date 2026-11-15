# Independent prepared-event sender deadline

## Acceptance

The default Windows prepared-event Caspar host must enforce the original UTC production interval and an immutable event-wide elapsed-time cap independently of the SPX/Node event loop. Native admission before target creation and resume must fail closed; the existing 50ms supervision loop must retire the complete owned sender job at expiry while persistent SPX remains alive. A sender restart with rolled-back UTC must never obtain a fresh elapsed-time budget. Expiry is terminal for this prepared event, and delayed callbacks cannot overwrite closing/closed states.

## Clock and ownership contract

The trusted parent asynchronously invokes the bundled JobHost with exactly `--sample-clock` once before staging. This read-only mode creates no target, job or forwarding thread and accepts no extra arguments. It samples Windows GetTickCount64 before UTC and returns one invariant ASCII line, bounded to128bytes and2seconds. The wrapper validates exact format, integer/date bounds and overflow, rounds the UTC millisecond conservatively upward, and retains a frozen WeakSet-registered policy. Clock values never come from event profiles or environment variables.

Every sender generation receives the same original begin/end UTC and absolute boot-clock anchor/deadline. Both clock conditions must hold before CreateProcess, before ResumeThread and during supervision. UTC end, rollback below prewarm, counter regression and exhausted boot budget fail closed. GetTickCount64 includes sleep; actual target-PC sleep behavior still requires off-air validation. Native polling and OS scheduling are not an instantaneous hardware cutoff guarantee.

Only the default prepared-event Caspar boundary receives this policy. Persistent SPX and the legacy component launcher retain their existing arguments and behavior. Explicit synthetic spawners remain test boundaries and provide no native execution evidence. There is no default Windows fallback to an uncontained or native-less sender.

Native exit251 latches the event expired, retires the private presentation/automatic playback and blocks supervisor rearming even if UTC would allow it again. Closing/closed fences remain authoritative. No system clock adjustment, firewall change or live equipment interaction is needed by the tests.

## Verification required

Portable tests exercise exact asynchronous sampling, timeout/output and malformed-protocol rejection, overflow, immutable policy reuse, raw/clone refusal and expiry/close lifecycle fences. Native policy tests compile the actual C# policy with a clock-input harness; those simulated clock inputs do not change production CLI behavior. Real Windows tests must independently prove sample-only mode cannot execute appended targets, malformed/outside-window admission creates no target, a real sender restart shares one cutoff, and a blocked Node owner cannot keep a sender descendant alive past its configured window while a persistent stand-in survives.

The blocked-owner bench retains strict generation identity, confirmed disappearance and original deadlines. Slow process enumeration may invalidate a run; a late observation is not proof of the exact native retirement time. All default full-application/Caspar/Console/NDI, extracted-package and SPX/OGraf regressions must pass at the final source SHA before merge. Native execution is unverified until those Windows checks finish.

## Scope and rollback

No new dependency or native binary is redistributed. Reverting this increment restores the earlier JS scheduling boundary and removes the additional native policy/sampling protocol. The first evaluation release remains gated by extracted actual output, reproducible licensed component setup, source exchange import, diagnostics/preflight and soak. Same-machine Windows CI does not establish Windows10, external NDI/LAN, Daktronics, DMP or stadium compatibility.
