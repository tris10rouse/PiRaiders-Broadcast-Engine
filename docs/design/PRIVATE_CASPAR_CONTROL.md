# Private CasparCG control

BE-002 acceptance: control the owned Windows CasparCG process without opening an AMCP TCP listener, while preserving containment under blocked input and launcher/service failures. This opt-in component does not activate the default launcher or complete PreparedEventRuntime.

## Native boundary

`JobHost.exe --forward-stdin <absolute executable> [args...]` keeps the existing NUL-input default unchanged. The target receives a separate anonymous input pipe. Only its read end and explicit stdout/stderr handles are inherited; the parent lifetime pipe, job handle and input write handle remain private. Create suspended, assign kill-on-close Job Object, then resume remains mandatory.

An independent reader detects parent EOF/error and coalesces data into at most32 queued4KiB buffers plus one in-flight writer buffer and fixed reader scratch. Admission never waits for space. Overflow/input failure signals main-thread job termination. The separate background writer may block; main-thread root/parent checks and kernel kill-on-close remain independent. Teardown never joins the blocked writer or closes/reuses its handle from another thread. Killing the job breaks target reads; worker/OS exit releases remaining resources. No input bytes enter diagnostics.

## Console contract

Stock Caspar2.5.1 `shell/main.cpp` creates its Console AMCP strategy independently of TCP controllers. Explicit `<controllers/>` disables controller construction; omitting that required node is different. `shell/windows_specific.cpp` selects UTF16 stdin and UTF8 stdout. `ClientInfo.h` prefixes Console responses with `#`; AMCP supports `REQ <id> <command>` and `RES <id> <status>`. These are source facts; runtime proof is required before integration.

`CasparConsole` serializes one pending request, encodes bounded UTF16LE without BOM and accepts only the exact correlated fixed status header. It discards native echoes and payloads. A timeout, unknown/malformed response, wrong status, pipe/process loss or quota violation fails the generation closed and ends the lifetime pipe. No late ACK can reactivate it. Busy callers fail explicitly rather than creating an unbounded queue. Native stdout/stderr are captured privately; fixed errors contain no echoed commands. A successful status proves command acceptance, not a rendered frame, NDI reception or on-air output.

Native logs can contain private producer URLs even with Console input. Keep Caspar file logging disabled with its actual `disabled` attribute; disable CEF logs/cache and OSC subscriptions, consume raw output privately and scan known text files in the disposable proof. The production launcher must use equivalent protection before handing off a private URL.

## Required verification

- Real Windows default-NUL regression and byte-exact fragmented Unicode forwarding.
- Unread target overflow, EOF/abrupt launcher death with writer blocked, root crash and host-only death: all test-owned descendants gone within bounded deadlines.
- Actual pinned Caspar Console VERSION/PLAY, exact correlated replies, no TCP listener owned by its root before/after crash, actual managed CEF pixels, fresh stopped renderer epoch and window-end tree cleanup.
- Existing SPX/OGraf, native Job Objects, package, actual Caspar TCP and actual NDI software regressions.

Local protocol tests use real pipes to a synthetic peer and establish framing/failure behavior only. Windows native and actual Caspar proof are pending CI. The focused Console proof uses a persistent SPX Node stand-in and injected scheduling clock; processes/CEF/mixed pixels must be real. Existing separate NDI proof uses a real wall-clock window. Windows10, LAN/stadium hardware and a complete user-testable build remain unverified.

Rollback removes the opt-in adapter/proof and restores the previous native helper; default service input remains NUL. No firewall change, code signing, deployment or third-party binary redistribution is performed.
