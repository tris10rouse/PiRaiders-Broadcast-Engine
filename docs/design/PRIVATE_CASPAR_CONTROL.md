# Private CasparCG control

BE-002 acceptance: control the owned Windows CasparCG process without opening an AMCP TCP listener, while preserving containment under blocked input and launcher/service failures. This opt-in component does not activate the default launcher or complete PreparedEventRuntime.

## Native boundary

`JobHost.exe --forward-stdin <absolute executable> [args...]` keeps the existing NUL-input default unchanged. The target receives a separate anonymous input pipe. Only its read end and explicit stdout/stderr handles are inherited; the parent lifetime pipe, job handle and input write handle remain private. Create suspended, assign kill-on-close Job Object, then resume remains mandatory.

An independent reader detects parent EOF/error and coalesces data into at most32 queued4KiB buffers plus one in-flight writer buffer and fixed reader scratch. Admission never waits for space. Overflow/input failure signals main-thread job termination. The separate background writer may block; main-thread root/parent checks and kernel kill-on-close remain independent. Teardown never joins the blocked writer or closes/reuses its handle from another thread. Killing the job breaks target reads; worker/OS exit releases remaining resources. No input bytes enter diagnostics.

## Console contract

Stock Caspar2.5.1 `shell/main.cpp` creates its Console AMCP strategy independently of TCP controllers. Explicit `<controllers/>` disables controller construction; omitting that required node is different. `shell/windows_specific.cpp` selects UTF16 stdin and UTF8 stdout. `ClientInfo.h` prefixes Console responses with `#`; AMCP supports `REQ <id> <command>` and `RES <id> <status>`. These source facts are now exercised by the Windows proof below.

`CasparConsole` serializes one pending request, encodes bounded UTF16LE without BOM and accepts only the exact correlated fixed status header. Windows CRT Unicode output can expand CRLF to CRCRLF; the parser accepts only these bounded endings and continues rejecting other controls. It discards native echoes and payloads. A timeout, unknown/malformed response, wrong status, pipe/process loss or quota violation fails the generation closed and ends the lifetime pipe. No late ACK can reactivate it. Busy callers fail explicitly rather than creating an unbounded queue. Native stdout/stderr are captured privately; fixed errors contain no echoed commands. A successful status proves command acceptance, not a rendered frame, NDI reception or on-air output.

Native logs can contain private producer URLs even with Console input. Keep Caspar file logging disabled with its actual `disabled` attribute; disable CEF logs/cache and OSC subscriptions, consume raw output privately and scan known text files in the disposable proof. The production launcher must use equivalent protection before handing off a private URL.

## Required verification

- Real Windows default-NUL regression and byte-exact fragmented Unicode forwarding.
- Unread target overflow, EOF/abrupt launcher death with writer blocked, root crash and host-only death: all test-owned descendants gone within bounded deadlines.
- Actual pinned Caspar Console VERSION/PLAY, exact correlated replies, no TCP listener owned by its root before/after crash, actual managed CEF pixels, fresh stopped renderer epoch and window-end tree cleanup.
- Existing SPX/OGraf, native Job Objects, package, actual Caspar TCP and actual NDI software regressions.

Local protocol tests use real pipes to a synthetic peer and establish framing/failure behavior only. Windows native and actual Caspar proof passed on implementation `64e1fe595ae4085bec00c3f31f6184b4e7b8e4a1`; final documentation-head checks remain required before merge. The focused Console proof uses a persistent SPX Node stand-in and injected scheduling clock; processes/CEF/mixed pixels must be real. Existing separate NDI proof uses a real wall-clock window. Windows10, LAN/stadium hardware and a complete user-testable build remain unverified.

Rollback removes the opt-in adapter/proof and restores the previous native helper; default service input remains NUL. No firewall change, code signing, deployment or third-party binary redistribution is performed.

## Executed evidence

Both implementation Windows runs passed:

- https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43660490805
- https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43660486158

Each compiled the real helper and passed all seven native process/input cases without skips, then controlled unmodified pinned Caspar2.5.1 via actual UTF16 Console AMCP. Seven actual1080p mixed PNGs verify red mixer, prepared black, Launch red, Next JPEG blue, Stop black, fresh stopped black after owned root crash, and explicit restarted Launch red. Black PNGs are scanned across every RGB/alpha pixel, including overlay corners. A live test-owned Node listener must be visible in terminating-error enumeration before asserting absence of a TCP listener owned by the exact Caspar root at both startup and restart. This does not assert every CEF descendant has no networking.

Old process trees disappear before recovery; fresh renderer epochs require Launch; injected-clock window end removes the owned sender tree. Private capability scans and fixed-only diagnostics are retained. Initial Console framing failed on CRT-expanded line endings and was corrected. A synchronous Windows temp-directory teardown race was corrected with awaited asynchronous removal; process/tree deadlines remain unchanged. Independent native containment/handle and client/privacy/proof reviews found no remaining blocker. The full-frame unit test rejects even one leftover corner/transparent pixel.

Local syntax83, baseline252/268 passes with16 explicit Windows-only skips, and actual Chromium27/27 pass. PR23 requires eight passing latest-head checks: Foundation Windows/Ubuntu push/PR(4), private Console push/PR(2), existing actual Caspar PR(1) and actual NDI PR(1). Failed attempts remain visible; no test was removed or skipped to pass. Artifacts contain synthetic PNGs/sanitized evidence only. Default launcher activation, profile/epoch integration, release packaging and hardware validation remain open.
