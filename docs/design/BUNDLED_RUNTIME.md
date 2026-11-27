# Bundled runtime: CasparCG, Mesa and the NDI runtime in the Windows ZIP

Q-016, owner's decision in chat on 2026-11-27: he accepts the CasparCG (GPL v3 or later), Mesa (MIT and its notices) and NDI SDK/runtime licence terms, and asks for everything the app needs to be bundled instead of proposed. He believes every target PC has a graphics card with OpenGL 4.5 but is not sure, so Mesa ships as the fallback. Split on 2026-11-27 (fence 108) into Q-017 to Q-022.

Status after Q-017 (2026-11-27): the list, the notices text and the layout rule exist and are tested on Linux. **The ZIP does not carry these components yet**; that is Q-018. Nothing is signed, released or deployed.

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

## Layout rule

Windows loads `opengl32.dll` from the executable's own folder before the system's. Mesa's copy beside the Caspar executable that should use the graphics card would replace the driver. `checkRuntimeLayout(paths)` answers fixed codes for a bundle's `runtime/` paths: `CASPAR_MISSING`, `CASPAR_NOT_UNIQUE`, `MESA_BESIDE_CASPAR` (any letter case), `MESA_MISSING`, `NDI_RUNTIME_MISSING` (the DLL must be in `runtime/ndi/`). The ZIP build (Q-018) refuses any code. How the software renderer then reaches Mesa without that copy is Q-020's decision.

## Parts

Q-017 list, notices, rule (this note) · Q-018 the ZIP carries them · Q-019 OpenGL 4.5 check · Q-020 the app runs the bundled Caspar with the chosen renderer, defaults point at the bundle · Q-021 extracted-ZIP Windows proof from bundled components only · Q-022 new evaluation build recorded.
