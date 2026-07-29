# IntentSmith Decisions

## Locked current decisions

| ID | Decision | Source | Status |
|---|---|---|---|
| D-001 | C3 is the product trunk; no greenfield rewrite | current user decision, convergence plan | ACCEPTED |
| D-002 | Final product name is IntentSmith | current user decision | ACCEPTED |
| D-003 | IntentSmith repository is a security/architecture donor | current user decision | ACCEPTED |
| D-004 | `ffd21cf` is disputed input; classify changes individually | current user decision | ACCEPTED |
| D-005 | Preserve working C3 behavior unless replacement benefit is proven and approved | current user decision | ACCEPTED |
| D-006 | C3 executor and C3 Code Intelligence remain the 1.0 incumbents | convergence plan | ACCEPTED |
| D-007 | OpenCode and Serena benchmarks are deferred to 1.1 | current user decision | ACCEPTED |
| D-008 | No history rewrite, force-push, destructive reset, merge, tag, push, publication, credential rotation, or user-data deletion without explicit approval | current user decision and safety constraints | ACCEPTED |
| D-009 | Confirmed public exposure is treated as compromise; third-party download is unknown | current user decision and handoff | ACCEPTED |
| D-010 | All new commits are pushed only to `codex/intentsmith-1.0` in the IntentSmith repository; C3 is reference upstream and receives no pushes | current user decision | ACCEPTED |
| D-011 | The integration branch starts at clean C3 parent `a7b90e3`; classified `ffd21cf` changes are replayed as new clean commits | current user decision and non-destructive baseline strategy | ACCEPTED |
| D-012 | Runtime/private/generated paths from `ffd21cf` are excluded by clean replay; the disputed ref remains untouched and no user data is deleted | Gate 0 disposition evidence | ACCEPTED |
| D-013 | Raw test/model logs go only to ignored `.intentsmith-artifacts/`; committed evidence contains bounded summaries, commands, exits, SHAs, and checksums | current user decision and test system | ACCEPTED |

## Pending operator decisions

| ID | Decision needed | Earliest gate | Current safe default |
|---|---|---|---|
| P-001 | Repository visibility/containment | Gate 0 incident response | make no remote change |
| P-002 | Credential rotation execution | Gate 0 incident response | provide category list only |
| P-003 | Public Git history remediation and coordination | after Gate 0 evidence | preserve history; no rewrite |
| P-004 | PR, merge, tag, release, or publication | after review | push only the integration branch; do not change `main` |
