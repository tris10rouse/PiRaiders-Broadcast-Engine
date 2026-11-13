# PiRaiders coding-agent guidance

Read `AGENTS.md` and `ROADMAP.md` before making changes. Treat `docs/decisions/0001-SPX-first.md` and `docs/design/CONTROLLER_BRIEF.md` as approved architectural and UX constraints.

This is a maintained fork of MIT-licensed SPX Solo 1.4.1, not a greenfield slide-only application. Preserve SPX projects, rundowns, HTML templates, OGraf packages, layered playout, CasparCG, and Play/Continue/Update/Stop behavior. Use feature branches, focused diffs and tests with reproducible evidence. Never claim real Daktronics/NDI hardware behavior from a simulator.

The PiRaiders desktop UI is for the Wylie ISD graphics operator. The separate All Sport Pro iPad operator sees no PiRaiders UI; their preprogrammed Daktronics buttons issue RossTalk commands. Auto/manual/reload confirmations appear briefly on the audience-facing board output.

No OBS/vMix dependency for this application's playout. Avoid off-event NDI transmission; warm source before show. Report commands run, verification, risks, and rollback with every PR.
