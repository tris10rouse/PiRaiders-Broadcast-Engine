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

Status: implementation and local protocol tests; real Windows proof is pending final-head Actions execution. Rollback removes the unreferenced proof files/workflow; default launcher and SPX behavior are unchanged.
