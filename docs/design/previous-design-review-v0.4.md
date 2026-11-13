⚠️ DEGRADED: single-context (the Impeccable runner and independent review agents were not available in this workspace; browser inspection and source-code review were completed locally)

# PiRaiders Broadcast Engine — SPX-first UI and graphics architecture review v0.4
Date: 2026-11-13
Status: Design critique and implementation guidance, not an implemented redesign

## Review inputs
- `PiRaiders_SPX_Controller_UI_Concept.html`, checked visually at desktop (1440×900) and tablet (768×1024) sizes with Chromium.
- `UI_Concept_Preview.png`, the earlier concept capture.
- SPX official older `screenshots/05-spx-gc-controller-rundown.png`, and current SPX Solo 1.4.1 `views/view-controller.handlebars`, `static/js/spx_gc.js`, `server.js`, `routes/routes-api-v1.js`, and `static/js/ograf_functions.js`.
- SPX documentation on HTML templates, OGraf, plugins, and CasparCG rendering; EBU OGraf specification; NoaCG and SuperConductor current public repositories.

The SPX reference screenshot in its repo is historical and should not be mistaken for a full current 1.4.1 UI capture. Current server/controller source was reviewed to corroborate behavior.

## Assessment A — design and workflow

### Overall finding
The first mockup demonstrates the PiRaiders feature concept, but it does not adequately preserve SPX's full graphics-operator mental model. It has one slide-specific rundown, a program-preview rectangle, and a global navigation sidebar. A live SPX rundown may contain lower thirds, animated templates, persistent overlays, multi-step graphics, and multiple output layers. The UI should make that mixed-content workflow the foundation.

### Prioritized findings
**P0 — Preserve SPX's core tasks.** Expose project/rundown selection, template editing, item Play/Continue/Update/Stop, active-layer status, output destination, and per-item on-air feedback. These must stay accessible when PiRaiders' Game Day/Slideshow features are active. Keep an advanced SPX workspace or preserve the existing controller directly.

**P0 — Distinguish output state from playback state.** A graphical preview being visible is not proof of live NDI output. Show explicit statuses: engine ready, NDI transmitting, receiver unknown, RossTalk last command, package synced, and current on-air item. Avoid rendering a fake green status that could be mistaken for a receiver acknowledgment.

**P0 — Audience-facing status feedback must live inside the actual rendered graphic.** The Auto/Manual and Reload indicators are not dashboard-only treatments. Overlay them in the template/renderer composition that CasparCG sends to NDI. The board operator is using a separate iPad and needs visually trustworthy feedback. Distinct icons/labels for AUTO ON vs AUTO OFF, in a protected lower-right-safe area, are preferable to an identical generic icon.

**P1 — Offer a purpose-built Game Day mode as one workspace.** The slideshow is one reusable SPX graphic cue. Selecting it opens a slide inspector with thumbnails, current slide, manual/automatic controls, and package update information. The general SPX rundown stays available.

**P1 — Separate preview, program, and future-next states.** Label each unambiguously. Allow a preview to operate when NDI is off, and make package update activation visibly distinct from previewing new files.

**P1 — Reduce explanatory prose in the live workspace.** The earlier concept includes technical explanations inside production panels. Move long explanations to help/diagnostics and reserve permanent screen area for states and actions.

**P1 — Prioritize operational density on desktop.** At 768 px the preview is below the entire rundown and control panel, requiring extensive scrolling. Use a collapsed rail, tabbed/stacked preview, and sticky emergency controls in narrow layouts. Note that the iPad may only host Daktronics buttons, so the primary goal remains a reliable desktop graphics operator interface.

**P2 — Preserve SPX visual language and navigation landmarks.** Start with the existing rundown cards, breadcrumb hierarchy, contextual output controls, and functional color coding, then introduce consistent typography/spacing and more precise status hierarchy. Avoid a wholesale UI replacement before regressing all original SPX flows.

## Assessment B — technical/source inspection
- The mockup is entirely self-contained demonstration HTML. It does not connect to the SPX server, CasparCG, RossTalk, or NDI.
- It has four navigation pages and a slideshow-only rundown. This cannot represent the core SPX mixed-graphics controller.
- Chromium layout check: no page-level horizontal overflow at 1440×900, 1024×768, or 768×1024, but at 768×1024 the preview falls below the controls. The old concept screenshot alone did not expose this.
- The HTML page provides an accessible label and pressed state for the Auto toggle; navigation buttons do not carry a selected-page ARIA state.
- The transition selector sets an opacity transition duration in JavaScript without a coordinated opacity change; true slide dissolves/wipes have not been implemented or verified.
- Current demo timer resets after manual commands and wraps with modulo indexing, matching the proposed behavior. It is browser-timer based, not a broadcast-frame guarantee.
- Current `reloadDeck()` simulates holding last slide and overlaying a spinner, but real atomic package validation, renderer acknowledgments and rollback do not exist yet.
- SPX has extension injection points (`server.js` `hookLoadControllerPlugins` and `view-controller.handlebars` `controllerPluginButtons`), current controller logic in `static/js/spx_gc.js`, HTML template definitions, and OGraf support. Advanced API routes are not all available in Solo and need deliberate support in the fork.
- `package.json` currently has no substantive automated test suite. Add regression/acceptance tests before broad UI refactors.
- Attempted Impeccable executable/detector was unavailable. No formal Impeccable detector score is claimed.

## Proposed page architecture
**A. Game Day (new workspace):** Active event, folder/package ready/version, renderer and NDI state, key commands (Launch, Stop, Next, Previous, Auto, Reload), current slide and thumbnails. Show latest RossTalk command/ack. Keep production-safe status.

**B. Graphics Controller (preserved SPX workspace):** Projects, rundowns, mixed template cues, item fields, Play/Continue/Update/Stop, layers, preview/program, output server state.

**C. Content Library:** Reusable slide packages, HTML graphics templates, OGraf templates, subfolders, source & cached versions, future App Script assignments.

**D. Settings & Diagnostics:** SPX settings preserved; feature-scoped slideshow timing and transitions, RossTalk mappings, NDI activation lifecycle, advanced logs, version/health/rollback. Show semantic grouping and safe defaults.

## Locked playback and overlay behavior
- Launch always shows slide 1 and relies on the preconfigured Daktronics command to select the correct input and display.
- Next/Previous wrap in both directions; auto slides default to 10 seconds; any manual move resets timer.
- Toggle AUTO ON or AUTO OFF: distinct audience-facing white icon/word mark with subtle border at lower-right; vertical ease-up, fade from 0 to about 75%, hold ~1 second, fade to 0. Avoid leaving the indicator persistently visible. Render within video-safe region and preview the exact same overlay in SPX.
- Reload: stage and validate an updated package; hold the last complete rendered frame and display a small corner progress indicator until activation completes. If an update fails, keep the last known good package and surface the failure to the operator.
- Stop: black output, NDI source stays up for the configured show window and then ends. No NDI source required during ordinary idle/off-day operation.
- App startup: lightweight readiness/status process at Windows boot. Four-hour content preparation and 15-minute NDI pre-roll are proposed configuration defaults, to be tested on site.

## Preserve HTML and OGraf as first-class formats
- Preserve SPX HTML template registration: `window.SPXGCTemplateDefinition`, field schemas and standard `play()`, `update(data)`, `next(data)`, `stop()` lifecycle.
- Preserve OGraf import, `.ograf.json` manifest, `.mjs` module, vendor metadata and OGraf lifecycle. EBU OGraf v1 is a stable HTML-based interchange specification.
- Treat slideshow as a packaged graphic/template with its own state machine, rather than replacing the renderer or making static slides a proprietary media type.
- Keep template preview independent of NDI transmission.
- Maintain compatibility fixtures: sample original SPX HTML template; original SPX OGraf template; NoaCG-generated SPX export; NoaCG OGraf package; custom PiRaiders slideshow. Verify Play/Update/Next/Stop, renderer path, fields, fonts, animations, and restart behavior.

## External ecosystem opportunities
**NoaCG Studio (AGPL-3.0 app; CLI Apache-2.0):** Good as an external graphic authoring/export tool. It imports SVGs, including layered Illustrator artwork, and exports OGraf and SPX/CasparCG-compatible HTML graphics. Its own README says SPX exports have not yet been tested on target software. Use exported graphics and optional CLI validation, then run interoperability tests. Do not copy the app's AGPL implementation casually.

**SuperConductor (AGPL-3.0):** Useful conceptual reference for grouped rundowns, timeline-based automation, resource libraries, state-resolved device actions and bridge/service health. Keep true timeline playout out of slideshow v1. Assess licenses and support cost before embedding any implementation code or third-party resolver library.

**CasparCG:** Keep as the renderer/NDI module for the proposed prototype. Measure startup, output removal/re-add, receiver discovery, latency and on-air frame integrity on the actual stadium hardware.

## Suggested implementation order
1. Write regression tests and an SPX compatibility matrix, based on an upstream commit.
2. Add the PiRaiders feature-state and command contract without changing SPX's existing Play/Stop/Continue behavior.
3. Implement the first slideshow as a standard SPX graphic template with auto/manual/overlay state and atomic asset reload.
4. Prove native CasparCG NDI (no OBS/vMix involvement) and RossTalk command-to-frame behavior.
5. Create an SPX-first interface prototype with a Game Day workspace and preserved Graphics Controller workspace.
6. Benchmark and validate on Windows 10 stadium PC; harden boot/update/rollback.

## Review completion status
Design critique completed in degraded single-context mode; browser layout inspection and source review completed. A full accessibility audit, current SPX 1.4.1 live UI run, actual CasparCG/NDI output test, and stadium receiver test remain open.

### References
- SPX source: https://github.com/TuomoKu/SPX-GC
- SPX HTML: https://docs.spxgraphics.com/Documentation/Graphic%2BTemplates/Formats/HTML
- SPX OGraf: https://docs.spxgraphics.com/Documentation/Graphic%2BTemplates/Formats/OGraf
- OGraf v1 specification: https://ograf.ebu.io/v1/specification/docs/Specification.html
- NoaCG: https://github.com/NoaCG/NoaCG-Studio
- NoaCG SPX contract: https://github.com/NoaCG/NoaCG-Studio/blob/main/docs/SPX_TEMPLATE_FORMAT.md
- SuperConductor: https://github.com/SuperFlyTV/SuperConductor