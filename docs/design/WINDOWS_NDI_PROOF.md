# Native NDI Windows software proof

## Acceptance and scope

BE-002 increment: an isolated Windows Actions runner must compile the x64 native receiver, reject a missing runtime, receive actual 1920×1080 progressive 30fps CasparCG NDI frames and verify synthetic pixels with fresh distinct SDK timestamps. The same receiver and exact source identity must survive an owned Caspar root crash/restart. Launch/Next/Previous/Reload must render staged PNG/JPEG through native CEF, Stop must produce opaque black while connected, and the real wall-clock window must end the owned sender tree. After buffered frames drain, require zero receiver connections and continuous video silence. No injected scheduling clock or simulated frame ACK is used in this proof.

The persistent SPX process is a labeled Node stand-in in this focused probe; separate extracted-package CI exercises actual SPX. This is same-machine SDK reception, which may use optimized local transport. It proves neither LAN transport nor Windows10, D8VIDEO-P, DMP, stadium routing or on-air operation. No release readiness follows from this component proof.

## Reproduction on a disposable Windows x64 computer

Use Node22+ and PowerShell7 (both preinstalled on the Actions runner), then `npm run setup`, `node scripts/build-ndi-probe.cjs`, `node scripts/prepare-caspar-proof.cjs`, `node scripts/prepare-ndi-proof.cjs`, then `node scripts/smoke-ndi-windows.cjs`. The preparation installs the official NDI runtime into the private build tools directory; use a disposable test computer, not a stadium PC. No NDI Tools or firewall changes are required by these scripts. Installation failure fails the proof rather than falling back to simulated NDI.

The official installer URL is `https://downloads.ndi.tv/SDK/NDI_SDK/NDI%206%20Runtime.exe`, pinned SHA256 `7ee73eedb56402bca5100868353dbab4e944b6c37d2d9881580698a3b61346cd`. The pin is corroborated by Microsoft's winget NDI.NDIRuntime 6.3.2.0 manifest at commit `87a75bbd0101d13899cd4c7198703c17da16694f`. Require exact downloaded hash and valid Windows Authenticode signature; record observed signer, installer/file versions, DLL hash/x64 PE identity and SDK-reported version separately. A package display version is not an asserted DLL/SDK version. Existing Caspar/Mesa pins and logging caveats remain in WINDOWS_OUTPUT_PROOF.md.

The C# helper uses ABI declarations from the MIT-noticed CasparCG v2.5.1-stable NDI interop headers. Their notice is retained in source. The runtime itself remains proprietary; no runtime/installer/helper binary is added to the application ZIP or uploaded evidence. Installed notices remain in the disposable tools directory. Redistribution/installation policy for a user release remains a separate gate.

## Security and evidence

The helper loads the exact absolute runtime DLL with restricted Windows search flags, asserts x64 layouts, filters only the uniquely named CI sender on this machine and never logs discovered names or URLs. Its bounded authenticated loopback protocol uses a child-only random capability. Every captured video frame is released in a finally block. Receiver and sender are contained by kill-on-close Job Objects; closing parent pipes is the final cleanup boundary.

Caspar uses file/CEF logging controls, no OSC clients, bounded pre-auth startup diagnostics and discarded post-auth native output. Scan known text files for the private presentation capability after recovery. Evidence contains only synthetic received PNGs, sanitized versions/hashes, hashed source identity and explicit coverage flags. Failure emits fixed categories. Artifact retention is14days. No raw logs, source catalog, student media, real configuration or NDI binaries are published.

## Executed Windows evidence

Implementation `aab86b1780436425165ef636125ccc2fa08b736b` passed both independent Windows jobs:

- https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43636937515
- https://github.com/tris10rouse/PiRaiders-Broadcast-Engine/actions/runs/43636930636

Each produced10 actual received BGRA PNGs: mixer red, prepared black, Launch red, Next JPEG blue, Previous red, Reload green, Stop black, restarted black, explicit restarted Launch green and near-boundary black. Each frame sample required distinct nonzero native timestamps; Stop black persisted over1.5seconds (46/47 distinct frames). The same native receiver recovered the identical source name after the owned Caspar root was forcibly terminated; the old process tree disappeared and the renderer required a fresh stopped epoch and explicit Launch.

Production windows used actual wall clock with explicit zero prewarm for a short bench. Sender stopping was recorded176ms and193ms after the exclusive end, with the complete recorded tree gone. Both receivers drained9 buffered frames and then reported zero connections with1508ms/1507ms of continuous video silence. The tiny process-stop latency is measured scheduling/shutdown time, not a claim of zero physical frame latency. Default15-minute prewarm is covered separately by policy tests.

Observed installer and DLL signatures were Valid, signer Vizrt AG. Installer/DLL versions were6.3.2.0; SDK reported `NDI SDK WIN64 16:38:09 Apr 14 2026 6.3.2.0`. DLL SHA256 `2b6602075868ba4401f82f417d72424805d69b11ca86078023d0d489ff45dd84` (29,863,120bytes). Installed notices found: `NDI License Agreement.pdf` and `Processing.NDI.Lib.Licenses.txt`. The initial signature-module mismatch was fixed by invoking the runner's PowerShell7. Actual SDK source-change notification101 is handled explicitly; error4/source-change reset quiet timing, unknown types fail, and notifications never count as video. Cleanup must finish naturally with exit0 before the proof can pass.

Local syntax79, baseline247/256 passes with nine Windows-only skips, and actual Chromium27/27 passed. Final documentation-head Windows/Ubuntu, native browser/package, actual Caspar and actual NDI checks remain required before merge; PR22 records their final status. No hardware, LAN or Windows10 claim is added.

Rollback removes the unreferenced proof files/workflow; default launcher and SPX behavior are unchanged.


## Native NDI proof diagnostic increment · 2026-11-15

Acceptance: distinguish intentional missing-runtime failure from the active receiver; report fixed crash enumeration, root selection, termination and recovery phases; preserve safe assertion labels and allowlisted OS error categories without raw arguments, paths, output or private URLs. Keep native connection/fresh-frame, strict process identity, cleanup and timing assertions unchanged. Master run43758140180 and its single retry failed at different stages; neither cause is established. This diagnostic increment must pass final-SHA Windows CI before merge and does not establish a failure fix or release readiness.
