# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing SPX Solo fork: native HTML/CSS/JavaScript templates, EBU OGraf, Node/Express controller and CasparCG integration. The Windows launcher uses Node and a C#/.NET containment host. No OBS/vMix dependency. This record summarizes the owner's already confirmed requirements in AGENTS.md, ROADMAP.md and docs/design/CONTROLLER_BRIEF.md; it adds no new product decisions.

## Users

The stadium Windows workstation operator prepares events/media and diagnoses readiness. A separate Daktronics All Sport Pro iPad operator uses only preprogrammed Daktronics buttons/RossTalk and never sees PiRaiders UI. The stadium audience sees graphics and brief mode/reload indicators.

## Product Purpose

A reliable Windows broadcast-graphics application preserving SPX projects/rundowns, HTML/OGraf and Play/Continue/Update/Stop. One launcher supervises services; sender eligibility follows a configurable production window with default15-minute prewarm. Sender, receiver, board route and on-air state are distinct.

## Operating Context

Target is a nonproduction-tested Windows10 stadium PC. Launch selects slide1, Next/Previous wrap, Auto defaults10seconds and manual navigation resets it. Stop requests black while sender lifetime remains window-controlled. Preparation/reload retains last-good content. Native slideshow is a separate compatible template; it does not replace existing SPX graphics.

Apps Script owns source Sheet semantics and writes; Drive supplies source files by stable ID. File Key identifies occurrences. The source integration contract is docs/design/APPS_SCRIPT_MEDIA_CONTRACT.md. Generic local-folder mode remains distinct. Private scripts/PDFs/crew data never become audience media.

## Capabilities and Constraints

Supervision/window policy, RossTalk transport, slideshow state/timers and full-decode immutable local snapshots are tested foundations. Launcher/control/rendering/source-catalog integration is incomplete. No user-testable release or stadium hardware compatibility is claimed. Authenticated source export/order/board/event-time details and CasparCG/NDI redistribution/output proof remain implementation gates.

## Brand Commitments

Preserve SPX identity/attribution and the owner's pinned audience feedback: small lower-right white-bordered AUTO/MANUAL indicator, upward easing to75% opacity, about1-second hold then fade; small Reload feedback. The slideshow surface is the media itself against black, with no application dashboard or developer labels on program output.

## Evidence on Hand

Repository CI and development ZIP evidence are linked in docs/agent/CODEX_CHECKPOINT.md. Native Windows process tests are real; rendering/CasparCG/NDI/hardware evidence must be described at its actual scope. The approved structural prototype is illustrative, not an integrated app or hardware demonstration.

## Product Principles

Preserve original graphics compatibility. Keep preparation separate from activation and sender lifetime. Fail safely and retain last-good content. Keep source data read-only by default and exclude private content from audience paths. Make readiness claims only from actual evidence.
