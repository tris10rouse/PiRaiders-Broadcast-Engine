# Real Windows output proof: pinned components and gates

Research checkpoint, 2026-11-14. These components have **not yet been executed** in the PiRaiders Windows CI pipeline. Existing AMCP/NDI stand-ins and Chromium output are not proof of real CasparCG/NDI integration. Do not enable production deployment or publish a release from this document.

## Candidate pins

| Component | Download/evidence | SHA-256 |
|---|---|---|
| CasparCG2.5.1 stable Windows | [Official release](https://github.com/CasparCG/server/releases/tag/v2.5.1-stable), [ZIP](https://github.com/CasparCG/server/releases/download/v2.5.1-stable/casparcg-server-v2.5.1-windows.zip), official asset568155896,295641939bytes | c0756f53f49908fba94f17a43b83d45fd275201e24ab1676530d7bb26832efc6 |
| Mesa26.2.6 MinGW | [Release](https://github.com/pal1000/mesa-dist-win/releases/tag/26.2.6), [archive](https://github.com/pal1000/mesa-dist-win/releases/download/26.2.6/mesa3d-26.2.6-release-mingw.7z) | da0f71d9181b672c1918f3c342f11118c687f6059a46b16502845160733cc388 |
| NDI Runtime6.3.2.0 | [Official runtime installer](https://downloads.ndi.tv/SDK/NDI_SDK/NDI%206%20Runtime.exe), pinned by [Microsoft manifest commit](https://github.com/microsoft/winget-pkgs/blob/87a75bbd0101d13899cd4c7198703c17da16694f/manifests/n/NDI/NDIRuntime/6.3.2.0/NDI.NDIRuntime.installer.yaml) | 7ee73eedb56402bca5100868353dbab4e944b6c37d2d9881580698a3b61346cd |

The NDI URL is mutable: reject hash drift; do not silently install a different runtime. Validate Authenticode and record actual installed x64 DLL/FileVersion and NDIlib_version. Caspar's ZIP contains neither NDI runtime DLL/license nor MSVC runtime DLLs. Inspect/detect the x64 VC++ prerequisite on the runner; if needed use the official Microsoft installer with checked provenance. No unnecessary system driver or tool installation.

Caspar requires OpenGL4.5; html.enable-gpu=false disables CEF GPU, not its OpenGL mixer. Current upstream documents Windows11 recommended and Windows10 best effort. Neither a Windows-latest run nor a software-renderer test certifies the target Windows10 GPU/performance. Prefer current stable software proof over an unverified older version just to assume hardware support.

## Disposable software OpenGL attempt

Use Mesa's x64 MinGW per-application OpenGL files beside temporary casparcg.exe, with required x64 dependencies and notices. Current release notes warn that its MSVC software build is broken. Set child-only GALLIUM_DRIVER=llvmpipe and LIBGL_ALWAYS_SOFTWARE=1. Never replace system drivers or Caspar CEF libEGL/libGLESv2/dxil files. Caspar's bundled Chromium SwiftShader does not replace its core OpenGL mixer. Record actual GL renderer/version and prove rendered frames; successful extraction/start is insufficient. Keep this software renderer CI-only unless separately benchmarked and deliberately selected for a user build.

NDI loads Processing.NDI.Lib.x64.dll from the application directory or NDI_RUNTIME_DIR_V6; upstream requires runtime6.0 or newer. The SDK header's MIT notice covers headers, not the entire proprietary runtime. Review [NDI licensing](https://docs.ndi.video/all/developing-with-ndi/sdk/licensing), [distribution](https://docs.ndi.video/all/developing-with-ndi/sdk/software-distribution) and [third-party rights](https://docs.ndi.video/all/developing-with-ndi/sdk/3rd-party-rights). Initial owner package can use the official separately installed runtime with its GUI EULA. Do not bundle NDI Tools. Any later runtime redistribution needs its specific licenses/notices/EULA/NDI attribution and ndi.video links. Keep Caspar GPLv3-or-later notices and corresponding-source obligations separate from proprietary runtime conditions.

## Security before loading a presentation URL

Upstream Caspar2.5.1 logs full AMCP arguments at info, HTML failedUrl at warning, original producer URLs in print(), and producer paths in telemetry. The managed program URL contains a bootstrap capability. Parent stdout redaction alone cannot protect Caspar's own file logs. Before actual URL loading:

- Disable internal file logging using the source-supported log-path disable option.
- Redact capabilities from complete captured UTF-8 lines and all protocol/diagnostic paths. Bound line buffering; drop overlong raw fragments rather than exposing partial secrets. Publish no raw Caspar logs.
- Disable OSC sending to AMCP clients with osc.disable-send-to-amcp-clients=true, omit predefined OSC clients, and avoid exporting INFO producer paths. Consider one-time/private credential handoff before production use.
- Do not invent a loopback-only AMCP XML setting: stock server's AsyncEventServer binds tcp::endpoint(tcp::v4(),port), i.e.0.0.0.0. Isolated disposable CI can use an ephemeral port and local clients, but that is not a loopback-only listener. Production needs a reviewed binding patch/rebuild or explicitly approved firewall isolation; channel LOCK is not network isolation.

Source evidence at [tagv2.5.1-stable](https://github.com/CasparCG/server/tree/v2.5.1-stable): src/protocol/amcp/AMCPProtocolStrategy.cpp, src/modules/html/producer/html_producer.cpp, server controller setup and AsyncEventServer implementation. Recheck exact source/configuration while implementing; XML examples that upstream ignores are not security controls.

## Required real software acceptance

Run actual launcher/JobHost/window supervisor, Caspar and the managed HTML template with a fixed explicit NDI consumer identity and eight-bit1080p30 channel. Suggested source-supported fields include html.enable-gpu=false, html.remote-debugging-port=0, ndi.name=PiRaiders Broadcast and ndi.allow-fields=false; verify generated XML against the pinned source/binary.

A small native dynamically linked test receiver must receive actual NDI frames and validate synthetic colors through Launch/Next/Previous/Reload. Stop must yield black while frames continue under the same identity. Window end must stop sender/process tree; subsequent startup must recover. Test missing DLL, startup failure and interrupted shutdown. Retain only sanitized software provenance and results. This is software integration, not GPU performance, external receiver, DMP/D8VIDEO-P, board routing or stadium evidence.

Real nonproduction Windows10 testing and later explicit off-air hardware authorization remain separate gates. No current user-action blocker has been established by this research; implement and evaluate the disposable software proof first.
