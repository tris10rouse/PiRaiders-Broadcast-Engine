# PiRaiders design decisions

**Approved:** SPX-first information architecture and Game Day workflow (2026-11-13).

## Authority
Existing SPX Solo `views/view-controller.handlebars` and `static/css/` remain the basis for real controller behavior and component conventions. `spx-first-controller.html` is a clickable *simulation* that demonstrates the approved four-workspace layout, not a new graphics runtime or deployed design system.

## Interaction boundaries
- PiRaiders UI is only for the desktop graphics operator who prepares and verifies a game. Daktronics All Sport Pro iPad operators never see it.
- Respect SPX project→rundown→item hierarchy and editable HTML + OGraf graphics; normal SPX functionality must remain available alongside slideshow.
- Program frame, NDI sending, NDI receiving, board routing, active event and content cache are different operational states.
- Audience-visible status indicator is part of the program output, not a desktop toast: lower right white border, AUTO/MANUAL text, vertical ease/hold/fade at maximum 75% opacity, plus a reload spinner on the actual board image.

## Next UI implementation step
Implement the approved layout as incremental Handlebars/controller changes on a separate feature branch after baseline CI runs. Extract and document real SPX CSS tokens before UI restyling. Verify screenshots at 1440×900, 1024×768 and 768×1024, keyboard focus, errors, empty states and loading states. Record which interactions are simulated and which are integrated.
