# Game Day UI — developer surface record

Recorded 2026-11-15 from the reviewed UI implementation; this document is not a deployment or whole-application approval. Keep it development-only, outside browser assets.

## Overview

Game Day is an **Operate** surface for the Windows workstation operator: select a local event, prepare and review its candidate, activate its controls, then operate playback. The Daktronics iPad operator never uses this interface. Preparation, activation, renderer acknowledgment, output configuration, receiver connection and board routing remain distinct.

The inherited visual authority is `PRODUCT.md`, `docs/design/CONTROLLER_BRIEF.md` and the approved structural prototype `docs/design/spx-first-controller.html`. This extension preserves their dark neutral SPX/prototype world, restrained blue actions, native controls and compact task hierarchy. Original SPX projects, rundowns, HTML/OGraf and Play/Continue/Update/Stop remain separate. Navigation points to real `/shows` and `/` routes; unimplemented workspaces and fabricated program previews are absent.

No root `DESIGN.md` exists. This ordinary surface extension does not establish or replace a global design system. The tokens below describe this implementation; they are not exact copies of every prototype value or authority for recoloring the original SPX controller.

## Colors

Actual reusable custom properties in `static/css/piraiders-game-day.css`:

| Token | Value | Application |
| --- | --- | --- |
| `--bg` | `#101419` | Page background |
| `--surface` | `#1b2028` | Shared preparation/playback workspace |
| `--raised` | `#252e39` | Default controls |
| `--line` | `#37404b` | Borders and dividers |
| `--text` | `#edf1f5` | Primary text |
| `--muted` | `#b1bdca` | Supporting text and labels |
| `--blue` | `#70b8ef` | Links and quiet actions |
| `--primary` | `#236a9e` | Primary action fill |
| `--focus` | `#93ceff` | Visible keyboard focus |
| `--amber` | `#efc37b` | Warning/error notices |
| `--green` | `#86d6b3` | Acknowledged success/readiness |
| `--red` | `#ffc3c6` | Declared, currently unused |

Stop uses the implemented danger fill/border/text (`#573138` / `#9f626b` / `#ffe0e3`); pressed mode controls use `#263f51` / `#659bc1` / `#d4eeff`. Disabled controls have explicit muted variants. Status text carries meaning independently of color. CSS remains the source of truth for the detailed hover, active and disabled values.

## Typography

The font stack is `system-ui, -apple-system, "Segoe UI", Arial, sans-serif`; the base is 14px with 1.5 line height. The page heading is 26px/650, becoming 24px on mobile; section headings are 17px/650. Active event names are 21px/600, becoming 19px on mobile. Supporting labels and help text generally use 12px; the footer uses 11px. Event settings revisions use `ui-monospace, Consolas, monospace`; slide positions and version measurements use tabular numerals. Event names and notices wrap rather than expanding the application width.

## Layout

The centered main/footer container is at most 1380px. Desktop main padding is 30px. One bordered workspace pairs event selection/preparation on the left (`minmax(280px,360px)`) with flexible playback on the right. Readiness has three labeled columns. Playback uses a three-column action grid, with Stop and its explanation in a separate row.

At 900px and below, spacing tightens, readiness becomes labeled rows and playback uses two columns. At 620px and below, navigation wraps and preparation precedes playback in one column, with 16px main side padding. Above 1500px, the preparation column becomes 380px and panel padding increases. These are surface breakpoints, not new global tokens.

When an event is active or activating on mobile, the body is a bounded `100dvh` flex layout. Main is the vertical scrollport; the footer remains outside it, and 76px is reserved for the fixed Stop dock. Stop sits 12px above the bottom with 20px side insets and a minimum 48px height. This reserved region must remain separate from candidate controls and footer links. The verified narrow case is 390×844; the CSS body minimum width is 320px, which is not evidence of testing every smaller device.

## Elevation & Depth

The interface uses flat tonal layers and one-pixel dividers, without box shadows or decorative gradients. The only fixed elevated control is mobile Stop. State transitions are limited to button background/border changes (160ms ease-out). Reduced-motion preference disables transitions and animations.

## Shapes

The workspace has gently rounded corners (8px); buttons, selects and warning messages use 5px corners, with 4px navigation highlights. Standard controls have a 42px minimum height, while the compact Refresh list control is 36px. Preserve native button/select behavior and the restrained bordered form language.

## Components

- **Event preparation:** native labeled selection persists through polling. Loading, empty, invalid, unreadable and previously unavailable selection states have explicit copy. Selecting an event does not activate it. Catalog settings revision, preparation status, Activate and Discard remain grouped together. Protected production windows disable preparation/activation.
- **Readiness:** renderer acknowledgment, configured output and unverified receiver/board route have separate labeled entries. Optional slide totals and source names render only when supplied. “NDI configured” does not establish sender output, discovery, reception or on-air status.
- **Playback and Stop:** Launch starts at slide 1; Previous/Next, Auto/Manual and Reload retain separate controls. Mode buttons expose `aria-pressed`. Normal mutations share one request slot. Stop has an independent coalesced slot, remains reachable during normal work, and disables/refuses normal mutations while pending. Duplicate Stop reuses its pending promise; an older command result cannot overwrite newer Stop intent. Black is acknowledged only after successful API response. Stop does not control sender lifetime; the production window does.
- **Connection/recovery:** retain last received state when disconnected and offer Retry connection. Authentication requires Sign in to SPX (`/login`); CSRF expiration requires Reload Game Day; missing auth policy points to SPX configuration (`/config`) then reload; origin/local/fetch refusal explains direct local launcher access. Access failures latch until page recovery, so later status success cannot silently re-enable controls. An uncertain command response directs the operator to check status before retrying.
- **API boundary:** the standalone Handlebars page receives `csrfToken` in a meta element and loads same-origin external CSS/JS. Requests use `/game-day/api/`; mutations send JSON, `X-PiRaiders-CSRF` and the expected event/selection tuple, plus candidate ID where required. State polling is serialized/coalesced and ignores pre-mutation responses. There is no inline script/style, iframe or program-preview URL; closing the tab sends no shutdown.
- **Accessibility:** semantic headings, sections, labels and definition lists support scanning; skip navigation reaches main. Connection and notices use status semantics, with polite live notices. Native controls expose disabled/busy state. Keyboard focus is a 3px outline with 3px offset; successful preparation/activation moves focus to the corresponding heading. Mobile scroll/focus behavior and dock hit targets were tested as described below; this is not a screen-reader conformance claim.

## Do's and Don'ts

- Do preserve the preparation → candidate review → activation sequence and original SPX navigation.
- Do keep Stop independently reachable, coalesced and truthful about acknowledgment and sender policy.
- Do keep locally prepared, renderer-ready, configured output and unverified hardware states separate.
- Do retain last-good state/content and show fixed, actionable recovery messages.
- Don't promote this page's composition or tokens into a replacement global system.
- Don't place development direction, synthetic fixture labels or private source data in audience graphics.
- Don't infer actual SPX, Windows, CasparCG, NDI, receiver or stadium behavior from these fixtures.

### Verification provenance and review boundary

Source inspected: `work/game-day-ui/views/view-game-day.handlebars`, `static/css/piraiders-game-day.css`, `static/js/piraiders-game-day.js`, `DIRECTION.md`, `README.md` and the browser harness. At documentation time, the three UI candidate files were byte-identical to their corresponding root UI files. No UI source was edited for this record.

The reviewed screenshots are `work/game-day-ui/evidence/desktop.png` (1440×1052 full-page capture) and `mobile.png` (390×844 viewport capture). Both were opened and show the intended rendered page, long event names and honest readiness. Mobile intentionally shows only the visible portion of the bounded main scrollport. `mobile-layout.json` records visible, hit-tested, nonoverlapping selector, Discard, Launch, Reload and footer positions after scrolling; Stop occupies y=784–832 while main ends at y≈699.6. Screenshot sample events, counts, source names and times are synthetic.

The existing `/tmp/game-day-ui-browser-review-fix.log` was checked: **8 tests passed; 0 failed/skipped**, using actual Chromium against an explicitly simulated HTTP API. The harness covers selection/tuples/CSRF, catalog states, priority Stop and duplicate coalescing, request ordering, disconnect/stale selection, distinct access recoveries, keyboard focus and narrow layout. Its recorded command was:

```sh
PIRAIDERS_BROWSER_EXECUTABLE=/usr/bin/chromium PIRAIDERS_UI_EVIDENCE_DIR=/workspace/PiRaiders-Broadcast-Engine/work/game-day-ui/evidence node --test --test-concurrency=1 work/game-day-ui/tests/browser/game-day-ui.browser.cjs
```

This documentation pass inspected the harness, log, measurements and captures; it did not rerun tests. The log is an ephemeral local artifact, not durable CI evidence. Earlier README references to 6/6 and unresolved findings describe the pre-fix pass; its later “Fresh reviewer FIX batch” records the superseding 8/8 result.

Root's fresh independent substitute finish review marked **all three fixes RESOLVED**: normal-request gating while Stop is held, nonoverlapping mobile Stop placement, and distinct CSRF/auth-policy/auth-required recovery. Its ship verdict applies **only to those fixes**, not the whole application or hardware readiness. The shipped Impeccable runtime/context launcher and detector were unavailable; existing product/design context was read directly, and the independent substitute review is not a detector pass. This record adds no fresh approval or new polish.

### Remaining integration gates

Actual secure SPX route/auth/asset integration and original SPX HTML/OGraf/project/rundown control regressions remain a separate workstream. Verify the final integrated head and package on Windows, including launcher lifecycle, native presentation and actual command/black acknowledgments. Existing component/software proofs elsewhere in the repository do not automatically validate this new page's integration.

Real CasparCG/NDI sending, source discovery, receiver connection, board routing and on-air output require their respective native/off-air hardware evidence. Apps Script/Drive source authority and authenticated catalog integration remain separate from this local-event UI. Windows 10 target behavior, production deployment and stadium readiness are not established here. Preserve the production-window sender policy, last-good content behavior and applicable operator approval gates for actual production/network changes.


The candidate revision displayed as “Event settings version” is the SHA256 of the catalog JSON. It is not a media fingerprint or source loaded/on-board tick. Slide totals are taken from the accepted immutable media snapshot. The enabled-mode SPX dropdown also links back to Game Day; that conditional anchor does not change original project/rundown controls.
