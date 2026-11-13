# SPX-first controller UI: approved structural brief

**Status:** Structural direction approved 2026-11-13. Visual details remain subject to implementation review. This HTML is an operator-only prototype, not integrated with SPX.

**Primary user:** Wylie ISD graphics operator at the stadium Windows workstation. **Other operator:** person using preprogrammed Daktronics All Sport Pro buttons on an iPad; they **never see PiRaiders**, have no app dashboard, and issue only Daktronics-originated commands.

## Workspaces
- Game Day: event selection and readiness, media sync, deck/version status, manual overrides, reload, diagnostic previews and troubleshooting.
- SPX Graphics: retain real project/rundown navigation and editable HTML/OGraf items, preview, output/layer selection, and Play/Continue/Update/Stop semantics.
- Library: reusable slide decks, local template packages, and OGraf.
- Settings & Diagnostics: local synced folder, RossTalk, output startup/shutdown policy, slide transitions, health/logs.

## Broadcast behavior
- Launch starts at slide 1, with Daktronics controlling input/screen routing. Next and Previous wrap. Auto advances every 10 seconds by default, and manual navigation resets the timer.
- AUTO/MANUAL confirmation is **audience visible**, white outlined at bottom right, animating upward to 75% opacity, holding briefly, and fading to zero. Reload holds the last valid frame and uses a small bottom-right loading indicator.
- When stopped: show black, keep NDI present through production window; otherwise avoid NDI traffic outside that window. Warm-up before Launch for receiver discovery.
- The PC interface cannot claim DMP routing or receiving success from merely running a local NDI sender; verify on stadium hardware.

## Fidelity
The prototype in `spx-first-controller.html` simulates controls. Its event and asset data are sample values, not Wylie ISD records. Do not confuse browser preview with the actual graphics output.

## Engineering requirements
Retain SPX Solo's HTML/CSS/JS and EBU OGraf compatibility, template functions, CasparCG path and existing controller routes. Treat graphic output, NDI sender, receiver discovery and board routing as distinct states. Document UI tokens from the incumbent SPX CSS and compare browser captures before changing its controller.
