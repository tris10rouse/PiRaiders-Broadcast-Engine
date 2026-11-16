# Pre-action process evidence in disposable Windows proofs

The private Console proof selects its actual Caspar child only after capturing complete PID, parent PID, creation-tick and executable identity for its live JobHost tree. The JobHost must have the expected Node parent and image, remain the same live ChildProcess before/after capture, and match the generation pinned during earlier captures. Destructive selection uses the current coherent tree, not a discarded older sample.

Missing creation/image fields on present rows are incomplete evidence. A separate asynchronous capture helper may query again within one immutable monotonic15s deadline, including every wait/query. Late completion cannot pass. Only missing fields retry: malformed tables/fields, contradictory siblings, wrong ownership, query errors and changed generations fail immediately. The Node process is a positive control. All relevant siblings are inspected, so an earlier missing field cannot mask malformed evidence.

Previously complete owned identities remain available for cleanup across retries. If a later coherent positive-control query shows an incomplete candidate absent, no identity is fabricated or counted for it; the new snapshot establishes sampled absence. A still-present incomplete row continues blocking capture. This is not atomic OS enumeration and cannot claim observation of every process between samples.

The existing strict descendants/processTable/treeState/observeTree APIs remain intact. Post-action cleanup still refuses success unless surviving===0 AND unknown===0 under its existing budget. No process ownership, native image, receiver or timeout assertion is disabled. Other proofs retain their current capture implementations; broader adoption requires caller-specific root and real-window deadline review.

Regression evidence: PR37 job133114778383 failed RECOVERY/IMAGE_MISSING before processChecks. The precise underlying OS cause remains unproven. Portable synthetic tests exercise retry/error/deadline/PID-generation behavior; they do not execute CIM. A separate Windows native test and actual private Console crash/restart/window proof are mandatory before merge. Source/extracted real Caspar/CEF/NDI proof remains mandatory.

Rollback reverts these disposable proof-tool changes; no application runtime, staged content, source publisher, network or stadium equipment is modified.


Root verification before publishing: all three candidate hashes inspected; focused process suite25 passes/3 native-Windows skips; complete baseline479 tests,452 passes/27 explicit Windows-only skips,0 failures; syntax127 files passed. Root changed the portable rollback regression's incidental1s elapsed assertion to a5s test watchdog plus shrinking-budget assertion, avoiding a scheduler-speed claim; the actual15s capture budget is unchanged. Independent candidate review/failure paths retained; real async Windows capture and final actual Console CI remain required.
