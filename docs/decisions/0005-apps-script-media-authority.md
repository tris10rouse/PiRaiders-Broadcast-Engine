# ADR 0005: Apps Script owns media meaning; the Engine consumes ordered references

Status: accepted design direction from the owner's supplied media-library architecture; integration unimplemented. Source: Apps Script media storage document for version 2.122.0, November 13, 2026. See docs/design/APPS_SCRIPT_MEDIA_CONTRACT.md for provenance, exact layout/table meanings and remaining contract gates.

The Apps Script workbook is authoritative for school year, event membership, Board-button grouping and occurrence sequence. Drive IDs join rows to bytes across renames/moves; Event Files File Keys identify distinct occurrences. Folder names are source-managed organization, not the relationship database. Apps Script remains the sole Sheet writer and owner of source rules/Slides conversion/tidy/undo. The Engine defaults to read-only source access and separate local immutable candidates.

Keep generic local-folder staging and schema-1 snapshots compatible. Add an explicit ordered catalog provider with ID-aware byte resolution; do not silently reinterpret folder-derived identities/order. Preserve repeated occurrences even if byte content is shared. Require complete validated selected decks before explicit Reload activation; keep active/last-good content on failure. On Board/Loaded For remain source statuses, not Engine/NDI/receiver/on-air evidence. Private scripts/PDFs/crew data stay out of the default audience-media projection.

The supplied document establishes storage semantics, not an export/auth API, numeric order column, Event Files Board/Button key fields or complete event times. Do not invent them. Resolve these from a sanitized real contract before implementation. R-158/R-168 UI/tick changes are planned; the Engine cannot depend on them being deployed. No Drive/Sheet actions or source-app modifications are authorized by adopting the reference document.

This extends the SPX-first architecture. It neither replaces SPX HTML/OGraf/projects/rundowns/lifecycle nor changes CasparCG/window/NDI policy. Rendering and local/fixture work can proceed while the source export contract is specified.
