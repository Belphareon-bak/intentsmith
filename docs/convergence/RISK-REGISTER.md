# IntentSmith Risk Register

| ID | Severity | Probability | Risk / trigger | Mitigation / next evidence | Owner | State |
|---|---|---|---|---|---|---|
| G0-R001 | P0 | confirmed | Public repository exposed a tracked backup reported to contain 877 conversations | Treat as compromise; inventory paths/reachability without opening content; prepare rotation and history-remediation decisions | operator + primary implementer | OPEN |
| G0-R002 | P0 | high | Runtime/private/generated material remains reachable in Git history | Clean candidate tree in follow-up commits; do not rewrite history without approval | primary implementer | OPEN |
| G0-R003 | P1 | confirmed | `ffd21cf` mixes valid product changes with damaged and private/generated files | Complete per-path disposition with evidence | primary implementer | OPEN |
| G0-R004 | P1 | confirmed | Clean lockfile installation is not reproducible because of `tree-sitter` peer requirements | Reproduce in isolation, resolve without broad upgrades, rerun clean install | primary implementer | OPEN |
| G0-R005 | P1 | confirmed | Test harness or runners may report false green / incomplete coverage | Reproduce exit semantics; generate inventory from filesystem; add meta-tests | primary implementer | OPEN |
| G0-R006 | P1 | confirmed | Release suites have recorded failures | Re-run and classify every deterministic failure; never weaken assertions | primary implementer | OPEN |
| G0-R007 | P1 | confirmed | README, test source, version and status documentation are inconsistent | Reconstruct from valid history plus newer evidence | primary implementer | OPEN |
| G0-R008 | P1 | medium | Generated E2E projects may contain conversation-derived or otherwise private material | Exclude current-tree artifacts without opening conversation content; retain only sanitized fixtures with proof | primary implementer | OPEN |
| G0-R009 | P2 | confirmed | Local Validation candidate ref is missing locally | Fetch exact ref only if needed for Gate 0 evidence; do not substitute another commit | primary implementer | OPEN |
| G0-R010 | P0 | confirmed | GitHub read-only metadata check on 2026-07-30 reports both `Belphareon-bak/C3-agent` and `Belphareon-bak/intentsmith` as public | Keep the clean integration branch free of disputed private/runtime content; operator decides containment and history remediation | operator + primary implementer | OPEN |
| G0-R011 | P1 | confirmed | The disputed E2E runner writes raw transcripts into the tracked `tests/` tree | Rebuild the runner to use ignored `.intentsmith-artifacts/`; commit only bounded summaries/checksums | primary implementer | OPEN |
