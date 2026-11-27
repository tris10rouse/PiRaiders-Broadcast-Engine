# Bundled runtime: CasparCG, Mesa and the NDI runtime in the Windows ZIP

Q-016, owner's decision in chat on 2026-11-27: he accepts the CasparCG (GPL v3 or later), Mesa (MIT and its notices) and NDI SDK/runtime licence terms, and asks for everything the app needs to be bundled instead of proposed. He believes every target PC has a graphics card with OpenGL 4.5 but is not sure, so Mesa ships as the fallback. Split on 2026-11-27 (fence 108) into Q-017 to Q-022.

Status after Q-018 (2026-11-27, fence 109): `npm run package:windows` downloads the pins, refuses any SHA-256 mismatch, stages the components and the ZIP carries them (`runtime/caspar/`, `runtime/mesa/`, `runtime/ndi/`, `licenses/`, `THIRD-PARTY-NOTICES.md`, all in `BUILD-MANIFEST.json`). **The app does not start them yet** (Q-020). The Microsoft VC++ runtime Caspar needs is not in the ZIP yet (Q-023). Nothing is signed, released or deployed.

## The list

`scripts/lib/bundled-components.cjs` is the one list: id, name, version, download URL, SHA-256 of that download, licence, ZIP folder, the files taken, and the source link where the licence needs one.

| Component | Version | ZIP folder | Download checked by SHA-256 | Licence |
|---|---|---|---|---|
| CasparCG Server | 2.5.1-stable | `runtime/caspar/` | official release ZIP (pin in `WINDOWS_OUTPUT_PROOF.md`) | GPL-3.0-or-later; source: tag `v2.5.1-stable` |
| Mesa 3D (MinGW) | 26.2.6 | `runtime/mesa/` | release 7z, x64 OpenGL files only | MIT with further notices |
| NDI 6 Runtime | 6.4.0.2 | `runtime/ndi/` | the vendor's installer (pin in `WINDOWS_NDI_PROOF.md`); only `Processing.NDI.Lib.x64.dll` is taken | NDI SDK License Agreement |

The CI proofs keep their own pins (`prepare-caspar-proof.cjs`, `prepare-ndi-proof.cjs`); `tests/bundled-components.test.cjs` fails if they and the list disagree. A re-pin changes both in one pull request. The Microsoft x64 VC++ runtime files Caspar needs are not in the list yet: Q-018 finds on hosted Windows whether Caspar's own release archive already carries them and pins them if not.

`renderNotices()` writes `THIRD-PARTY-NOTICES.md` for the ZIP root from the list: each component's version, licence, download, SHA-256, folder and source link, and NDI's attribution. Same list, same text.

## What NDI requires (read 2026-11-27)

Read from the vendor's pages [Software Distribution](https://docs.ndi.video/all/developing-with-ndi/sdk/software-distribution) and [Licensing](https://docs.ndi.video/all/developing-with-ndi/sdk/licensing):

- Binary files: "You may distribute these files within your application if your EULA terms cover the specific requirements of the NDI SDK EULA, and your application covers the terms of the License section above."
- "You should include the NDI DLLs as part of your own application and keep them in your application folders." and "Please do not install your NDI DLLs into the system path." Hence `runtime/ndi/` and the layout rule below; nothing is copied to a system folder.
- Trademark: "NDI® is a registered trademark of Vizrt NDI AB", with ® on the first use of "NDI" in a document, the statement near that first use or at the foot of the page; also in the About box or other attribution place.
- "Your application must provide a link to ndi.video in a location close to all locations where NDI is used/selected within the product, on your website, and in its documentation." Q-020 puts the link beside the NDI output in the Game Day Diagnostics panel and in README-WINDOWS.md; the notices carry it now.
- NDI Tools may not be distributed (a link to ndi.video/tools is allowed). They are not bundled.
- Keep distributed versions reasonably up to date. The pin is 6.4.0.2, the version CI proves.
- The pages name no specific DLL file and say nothing of a required runtime version or of a redistribution URL constant.

The licence agreement text itself comes from the installed runtime (`NDI License Agreement.pdf`, `Processing.NDI.Lib.Licenses.txt`, seen in CI, `WINDOWS_NDI_PROOF.md`) and goes in `licenses/NDI/` (Q-018).

## How the ZIP build takes them (Q-018)

`scripts/build-windows-bundle.cjs` first runs `scripts/bundle-runtime.cjs` (build machine only, not packaged): it downloads each pin through the CI proofs' `download()` (SHA-256 refused on mismatch, size bounded), unpacks with 7-Zip, and stages into `build/windows/runtime-stage/`; `buildWindowsBundle({ runtimeStage })` refuses to run without that stage, copies it only into `runtime/caspar/`, `runtime/mesa/`, `runtime/ndi/`, `licenses/` and the notices file (no file may replace one already in the bundle), then checks the notices text and `checkRuntimeLayout()` over the whole `runtime/` folder again. Any code stops the build.

- **CasparCG:** every file of the release archive, unchanged (the archive has its files at its root). Its `LICENSE` (GPL v3 text, checked) also becomes `licenses/CasparCG-LICENSE.txt`.
- **Mesa:** `x64/opengl32.dll` and `x64/libgallium_wgl.dll` only (opengl32 is the WGL front that loads libgallium_wgl; both checked x64). The CI Caspar proof copies more of Mesa's x64 DLLs beside Caspar; whether these two are enough for Caspar's software path is proven only when Q-020/Q-021 run the bundled Caspar on hosted Windows. The release archive carries no licence text, so `packaging/windows/licenses/Mesa/` holds committed copies of Mesa's `licenses/` folder and `docs/license.rst` at tag `mesa-26.2.6` and mesa-dist-win's `LICENSE` at tag `26.2.6`; they go to `licenses/Mesa/`.
- **NDI:** the installer is never run. A build-only tool, innoextract 1.9 (its Windows release ZIP, SHA-256 `6989342c…3065` pinned in `bundle-runtime.cjs`; zlib-style licence; not shipped), reads the installer's files. Only `Processing.NDI.Lib.x64.dll` is taken, refused unless its SHA-256 is `adca7e9c…028a`, it is an x64 PE and its version resource reads 6.4.0.2. `NDI License Agreement.pdf` and `Processing.NDI.Lib.Licenses.txt` (each SHA-256 pinned) go to `licenses/NDI/`. The installer's x86, DirectShow and File DLLs are not taken; NDI Tools are not in it.
- Checked on Linux on 2026-11-27 with the real pinned downloads (unpacked with Linux unzip, 7z and innoextract 1.9, not the Windows tools): 306 runtime files, layout rule clean, about 818 MB unpacked.

## VC++ runtime (Q-018 finding)

Caspar's release archive does **not** carry the Microsoft x64 VC++ runtime. Read on 2026-11-27 from the import tables of `casparcg.exe` and every DLL in the archive: `casparcg.exe`, the three SFML DLLs and the three TBB DLLs import `MSVCP140.dll`, `VCRUNTIME140.dll` and `VCRUNTIME140_1.dll`, none of which is in the archive (the `api-ms-win-crt-*` imports are the Universal CRT, part of Windows 10 and later). Hosted Windows runners have the VC++ runtime installed system-wide, so CI cannot show its absence. Shipping it is Q-023: either the three DLLs app-local beside `casparcg.exe` (Microsoft's documented local deployment) or the official `VC_redist.x64.exe` (a versioned download exists: Microsoft's `aka.ms` link redirected on 2026-11-27 to a URL carrying SHA-256 `cc0ff0eb…713b`), run by Setup only with the operator's consent.

**Licence finding (Q-023, fence 111, 2026-11-27):** the licence inside that installer (`license.rtf`, "MICROSOFT VISUAL C++ 2015 - 2022 RUNTIME") allows installing and using any number of copies, but says you may not "share, publish, rent or lease the software" or "provide the software as a stand-alone offering or combined with any of your applications for others to use, or transfer the software or this agreement to any third party". Redistribution rights normally come from a Visual Studio licence's Distributable Code terms, which this project does not hold. Neither the DLLs nor the installer are bundled until the owner decides (proposal linked from `queue/needs-you/Q-023.md`).

## Layout rule

Windows loads `opengl32.dll` from the executable's own folder before the system's. Mesa's copy beside the Caspar executable that should use the graphics card would replace the driver. `checkRuntimeLayout(paths)` answers fixed codes for a bundle's `runtime/` paths: `CASPAR_MISSING`, `CASPAR_NOT_UNIQUE`, `MESA_BESIDE_CASPAR` (any letter case), `MESA_MISSING`, `NDI_RUNTIME_MISSING` (the DLL must be in `runtime/ndi/`). The ZIP build (Q-018) refuses any code. How the software renderer then reaches Mesa without that copy is Q-020's decision.

## OpenGL 4.5 check and renderer choice (Q-019)

`native/windows/GraphicsCheck.cs`, built at ZIP build time with the installed .NET Framework compiler (x64, as JobHost is built) and shipped as `app/build/windows/PiRaiders.GraphicsCheck.exe`. No Python. It loads the system's `opengl32.dll` only (`LoadLibraryExW` with `LOAD_LIBRARY_SEARCH_SYSTEM32`, before any OpenGL call), never Mesa's copy, opens a hidden 16x16 window, makes a plain context and then asks for a 4.5 core context with `wglCreateContextAttribsARB`. It prints exactly one line: `GPU_OPENGL_45` (a 4.5 context made and reporting 4.5 or later), `GPU_OPENGL_TOO_OLD` (4.5 refused and the plain context reports older) or `GPU_OPENGL_UNKNOWN` (anything else). It never reads `GL_RENDERER` or `GL_VENDOR`, so no GPU name or driver path exists to leak.

`scripts/lib/graphics-check.cjs` runs it with a 15 s bound and 256 bytes of output, takes its line only when it is exactly one code with exit 0, and otherwise answers `GPU_OPENGL_UNKNOWN`; it never echoes what the check printed. `probe` says whether the check `ran`, was `missing` (no regular file), `failed` (no valid answer, timeout, crash) or was not run (`not-windows`). The machine file's optional `renderer` is `auto` (default), `gpu` or `software`; anything else refuses the file (`MACHINE_CONFIG_INVALID`). The choice is `gpu` only for `GPU_OPENGL_45` under `auto`; `gpu` and `software` force it. Setup and Diagnose print `graphics: {check, probe, setting, renderer}` once the machine file has loaded; it is a report, never a refusal, and it is not one of Diagnose's six states.

Evidence: Linux tests with stand-in checks (stub runner, and stand-in executables through the real runner: hang, flood, crash, missing, link); a Windows test compiles and runs the real check and, on GitHub's hosted runner, requires it not to say 4.5; the extracted-ZIP entries job requires the bundled check to have `ran` and answered too-old or unknown with `software`. The `GPU_OPENGL_45` path is a manual gate on a real PC with a graphics card, not tested. Starting Caspar with the choice (and how the software path reaches Mesa without a copy beside Caspar) is Q-020's; the existing `caspar.rendererProfile` is unchanged here.

## Parts

Q-017 list, notices, rule (this note) · Q-018 the ZIP carries them · Q-023 the VC++ runtime Caspar needs · Q-019 OpenGL 4.5 check · Q-020 the app runs the bundled Caspar with the chosen renderer, defaults point at the bundle · Q-021 extracted-ZIP Windows proof from bundled components only · Q-022 new evaluation build recorded.
