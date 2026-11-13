# BE-002: NDI sender eligibility policy (software-only)

The `scripts/lib/production-window.cjs` module provides an independently tested production-window policy and serialized start/stop gate. It **does not yet control the real CasparCG process**, establish an NDI source, or enforce zero NDI traffic. Integration with the Windows launcher, real process-tree cleanup and off-air network verification remain mandatory before any stadium use.

A schedule has explicit ISO 8601 timestamps with `Z` or UTC offsets, e.g. `2026-11-13T19:00:00-06:00`. Ambiguous local timestamps are rejected. The prewarm defaults to 15 minutes, is bounded to 60 minutes, and only makes a sender eligible to start. The end is exclusive. A production window cannot exceed 24 hours. Event metadata must provide the actual offset at each endpoint for DST transitions.

`normalizeWindow(config)` validates the input, `senderAllowed(window, nowMs)` checks eligibility, and `nextBoundary(window, nowMs)` provides the next scheduling boundary. `ProductionWindowGate` serializes idempotent sender start/stop callbacks, retries failed transitions on a later reconcile, and requests stop on shutdown. A launcher adapter should poll reconcile at a bounded interval (including after wake from sleep) and use boundary scheduling for prompt start/end. A rejected stop must trigger escalation to Windows process-tree termination and report the sender state as unknown until verified.

Test: `node --test tests/production-window.test.cjs`. The tests cover invalid/ambiguous timestamps, prewarm and end boundaries, DST, duplicate calls, transition failures, and shutdown during startup.

**Hardware gates:** prove no NDI sender/packets outside the window using a local NDI monitor and packet capture, prove sender stability during prewarm and STOP-black, then verify D8VIDEO-P ingest off-air with operator approval. This policy alone is not evidence of NDI suppression.
