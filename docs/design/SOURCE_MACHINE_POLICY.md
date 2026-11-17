# Source machine policy and verified selection review (BE-006)

This increment supplies trusted configuration and review data needed by the PC confirmation flow. It does not install a selector, enable source playback in the web application, initialize stores or approve a production window. The iPad still has no PiRaiders interface.

## Explicit machine configuration

`loadGameDayMachineConfig(file,{appRoot,nodeExecutable})` retains its existing machine policy and allows one optional `source` object. `isGameDayMachineConfig(value)` recognizes only an exact frozen object returned by this loader, not JSON copies. Source fields are exactly:

```json
{
  "providerId": "approved-feed",
  "journalDirectory": "data/exchange-journal",
  "journalStoreId": "00000000-0000-4000-8000-000000000001",
  "approvalDirectory": "data/exchange-approvals",
  "approvalStoreId": "00000000-0000-4000-8000-000000000002",
  "expectedCanonicalRoot": "C:\\PiRaiders-test\\To Engine",
  "binding": {"feedId":"00000000-0000-4000-8000-000000000003","epoch":1}
}
```

UUIDs and paths above are synthetic. Configure `mediaRoot` as the corresponding read-only export mount. `cacheRoot`, `runtimeRoot` and `catalogDirectory` remain separate named roots. Source journal/approval paths resolve under the application root unless absolute. All six roots must be pairwise disjoint; the retained canonical source spelling must also be disjoint from private roots and cannot contain machine/SPX configuration. A configured alias and the expected canonical source spelling may name the same source. Provider ID is a bounded ASCII machine slug; journal, approval and feed IDs are strict v4 UUIDs, with distinct journal and approval store IDs; epoch is1..999999.

`expectedCanonicalRoot` is the explicitly retained normalized absolute spelling from an approved machine/source setup, not a value learned from a source manifest. The loader does not probe the mount or private stores to infer it, and does not certify current canonical membership, store contents, components or actual output availability. Future online integration must compare observed source canonical identity with this retained policy, repeatedly check private boundaries, open the separately retained store identities, and bind the exact machine policy to an approval. Offline policy cannot silently infer a changed or unavailable source mount.

Config loading reads only its configured machine JSON and established config ancestry. It neither scans source files nor opens/creates/resets journals, caches, runtime directories or approval stores. Invalid source fields retain the existing fixed MACHINE_CONFIG_INVALID category; paths and values are not echoed. `createLocalEventCatalog(machine)` refuses a source-enabled machine: the exchange contract cannot silently fall back to a lexical folder listing or the flat128 local-event model. Until source service/web wiring is complete, the existing application therefore does not enable source mode merely because this optional configuration parses.

## Same-capture selected inspection

`provider.inspectSelection(tuple,{signal?})` preserves its existing result fields and adds an immutable `inspection`. It derives all fields from that operation's fully verified selected manifest and timing-gate result, not the earlier catalog summary or a later coordinator snapshot overwritten by catalog refresh.

The inspection has `ready:false`, a SHA256 revision, selection identity/label/origin/target board/generation/fingerprints/state/declared occurrence count, event identity/display name/date, verified `timingProposal`, source time zone and `sourceTicks`. Revision binds provider feed/epoch, full selection ID, exact manifest digest, generation and both fingerprints. Full200-codepoint labels remain intact. The returned data is independently copied/frozen; no source/cache/manifest paths, executable policy, private URLs, callbacks or playback capability is exposed.

Source ticks are informational publisher state, distinct from Engine preparation or activation. The timing proposal retains `operatorConfirmationRequired:true`, review flags and availability. Missing/ambiguous local timing remains a review requirement. Source lead/tail values are not silently applied again as Engine prewarm. A current pointer ahead of the catalog can yield a later verified proposal; the PC must review that selected version rather than assuming catalog timing is current. No complete-looking manifest, count, timing proposal or eligibility flag certifies actual media or board reception.

Inspection does not stage/read assets or create cache/runtime directories. Existing journaled metadata validation, immutable operation deadlines, physical drain, source admission and last-good active playback behavior remain unchanged. Failures return no stale inspection through provider status. The caller may retain an old returned object, but that object grants no freshness or authority; confirmation must recheck the selected revision and persisted approvals.

## Evidence and limits

The source-enabled lexical fallback and canonical-source/config alias gaps were reproduced in the unpublished draft before fixes. Focused config plus legacy tests passed20/20; selected inspection plus legacy provider passed26/26, followed by5/5 current projection tests including the added ambiguous DST fold and200-codepoint label case. Independent review passed the original9 new tests and approved the canonical-root follow-up. Before-failure logs are retained outside source, and final full/Windows results belong to the PR.

There are no frontend/rendering changes or new screenshots in this prerequisite. Source service, authenticated PC confirmation, machine-policy fingerprint compilation, application-specific approval callback wiring and explicit cached startup remain separate integration work; the awaited manager seam is documented in CANDIDATE_APPROVAL_REFRESH.md. Original SPX/OGraf, local/manual catalog, generic RossTalk controls, production windows and sender lifetime behavior must remain intact. Rollback removes the optional config/projection adapters; no operator data migration or source write is performed. No evaluation release, Windows10/LAN/Drive hydration or stadium compatibility is claimed.
