# PiRaiders Windows development bundle

This is an unsigned development artifact, **not the first user-testable release**. It contains SPX, its native HTML/EBU OGraf assets and locales, locked production dependencies, Node for Windows x64, and the PiRaiders process-containment host. CasparCG/NDI binaries are not included. Slideshow, staged media, RossTalk control and the full Game Day workflow remain unfinished. Do not install this build on stadium or production equipment.

## Contents and prerequisites

Extract the entire ZIP to a writable folder on a nonproduction Windows x64 computer; do not run inside the ZIP or overwrite an existing installation. Node and npm do not need to be installed. The containment host requires installed .NET Framework v4. The build manifest records exact source and Node versions and file checksums. Windows CI is not evidence of Windows 10 target-PC or stadium compatibility.

`BUILD-MANIFEST.json` detects accidental file drift; it is unsigned and does not establish download authenticity. Keep `licenses/` and dependency license files with the bundle. A ZIP SHA-256 sidecar accompanies the build artifact. Preserve the original extracted folder if comparing hashes: first use creates configuration, data and logs that are intentionally absent from the original inventory.

## Developer configuration and startup

Only perform a controlled off-air test on an isolated nonproduction computer. No manual testing is required from the project owner until the first honest user-testable build is announced.

1. Obtain the separately selected/legal CasparCG build and NDI runtime only after their deployment instructions are verified. This bundle does not select or validate them. If those components are unavailable, use CI evidence and continue development; do not bypass the supervisor with a separate always-on sender.
2. Copy `app/config/piraiders-launcher.example.json` to `app/config/piraiders-launcher.json`. Replace both invalid timestamp placeholders with actual ISO timestamps including `Z` or an explicit UTC offset, for example `2026-11-13T19:00:00-06:00`. Use the correct date, timezone and end; prewarm defaults to 15 minutes. Adjust CasparCG executable/cwd and both health ports to match the local services. SPX uses the bundled `../runtime/node.exe`.
3. From PowerShell in the extracted folder, run `./Launch-PiRaiders.cmd`. The launcher works with spaces/Unicode in the folder path. It rejects missing configuration, invalid schedules or missing executables before starting services. No global Node, npm, PM2 or repository checkout is required.
4. SPX runs for the launcher lifetime. CasparCG is eligible only during prewarm/production time and stops at the exclusive end. SPX creates its normal local configuration/data/logs on first use. Access the workstation SPX controller at the configured local HTTP port; the iPad operator never sees this interface.
5. Inspect console lifecycle and `service-health` messages. Windows PIDs identify containment hosts. Endpoint readiness does not prove PID ownership, rendering, NDI sending/discovery/reception or board routing. The launcher keeps existing SPX HTML/OGraf Play/Continue/Update/Stop workflows.
6. Ctrl+C requests shutdown with bounded retries. A failure reports unknown process state; inspect the logged PIDs and resolve it before restarting. Closing/killing the Node launcher also closes service jobs. Graceful service-specific shutdown, persistent launcher log rotation and deployment hardening are still release work.

## Automated artifact checks and remaining gates

Windows CI extracts this ZIP under a path containing spaces/Unicode, verifies the inventory, checks missing-configuration failure, and uses the fixed `.cmd` entry point to start actual bundled SPX plus an explicitly simulated CasparCG AMCP service. It checks local HTTP pages/assets and the sender-window end, then proves fixture process cleanup. A separate bundled-Node check fully decodes generated PNG/JPEG fixtures through worker threads, stages an immutable snapshot and reloads it after deleting the simulated source; pinned decoder versions and complete license notices are verified. This is automated staging-library evidence, not an operator staging workflow. The simulator sends no video or NDI; successful CI is not a CasparCG/NDI or stadium demonstration.

Before announcing a user-testable release, finish slideshow/control/staging/event behavior, persistent diagnostics and startup safety, validate a selected CasparCG/NDI build and source identity, and provide an operator test checklist. Direct Daktronics/D8VIDEO-P/DMP ingest and board routing require separately authorized off-air evidence. No hardware compatibility is claimed.

Rollback: stop the development launcher, preserve any configuration/content/logs you intentionally created, then remove its extracted folder. Do not overwrite or delete an existing SPX installation or operator media.

The development bundle also contains the opt-in managed native presentation host/client. The extracted-package smoke exercises authenticated HTTP/WebSocket transport with simulated frame acknowledgments; separate Windows Chromium CI proves actual browser pixels. The default launcher does not yet wire that host into events/RossTalk/CasparCG. Do not treat this component coverage as a user-testable application or NDI proof.

Managed-host component smoke now also exercises mode feedback and playing/stopped replacement of prepared snapshots using the bundled runtime. Its frame ACKs are simulated and labeled runtimeReloadAndFeedback; real Chromium CI separately verifies overlays, last-good pixels and Stop. No event/RossTalk/sender integration is enabled by this component addition.

The optional managed RossTalk facade is packaged and its smoke probe uses actual loopback TCP/WebSocket transport with simulated presentation ACKs. It requires explicit gate/source callbacks and listener start; the default launcher still enables no RossTalk port. This artifact includes no newly selected Caspar/NDI/Mesa runtime and proves no hardware compatibility.
