# ADR 0001: Keep SPX as graphics-controller foundation

**Status:** Accepted in design discussion (2026-11-13); implementation and hardware verification pending.

## Decision
Preserve SPX's project and rundown model, native HTML/CSS/JS template lifecycle, EBU OGraf packages and CasparCG integration. Integrate PiRaiders event preparation and the slideshow into a maintainable fork. Preserve upstream attribution and MIT terms.

The Windows graphics operator gets Game Day, SPX Graphics, Library, and Settings & Diagnostics. The Daktronics All Sport Pro iPad operator **never views PiRaiders** and controls the show through preprogrammed Daktronics buttons/RossTalk.

## Output and runtime
No PiRaiders OBS/vMix playout dependency. CasparCG with NDI is the initial candidate; validate DMP input on actual stadium network. Avoid continuous off-event NDI; prepare files early, warm NDI before launch, and end transmission after production. Slideshow is a separate compatible template, not a replacement for original SPX graphics.

## Consequences
- Add regression tests for HTML templates, OGraf, Play/Continue/Update/Stop, layers and preview before modifying operational code.
- Agent guidance: `AGENTS.md` and `ROADMAP.md`; PRs with concrete test evidence.
- Treat NoaCG authoring/export compatibility as an integration test; consider SuperConductor design ideas; review AGPL licensing before code incorporation.
- Packaging into one operator-facing launcher is a milestone, not a demonstrated capability yet.
