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
| D-014 | Gate verdict wording is normative and lives in `GATE-CRITERIA.md`; a verdict names its candidate commit and registry fingerprint. Product/source/test/config changes invalidate it; a generated evidence-only attestation commit may name and follow the unchanged candidate | Gate 0 evidence design | ACCEPTED |
| D-015 | The G0-C5 scope is the registry's reviewed deterministic T1/T2 profiles (`offline`, `database`), never an ad-hoc per-verdict subset. Currently 199 required ACTIVE suites: 173 offline + 26 database | normative test system and reviewed orchestrator policy | ACCEPTED |
| D-016 | The privacy incident is excluded from CONDITIONAL PASS and carries its own verdict; CONDITIONAL PASS covers only prerequisites outside the codebase | current user decision | ACCEPTED |
| D-017 | The 78 recovered E2E suites are activated one at a time against isolation → truthful exits → real execution; never as a set | current user decision | ACCEPTED |
| D-018 | `REBUILD` closes into `ACCEPTED`, `DEFERRED(<prerequisite>)`, or `REPAIRED`; a bare `REBUILD/REPAIR` is unfinished classification | current user decision | ACCEPTED |
| D-019 | Registry membership follows executability, not filename. Exclusions are explicit, reasoned rows validated like any other | current user decision | ACCEPTED |
| D-020 | `STATUS.md`, `EVIDENCE-INDEX.json`, `GATE0-BASELINE-REPORT.md`, and the Opus packet are generated from a clean candidate commit. They live in one evidence-only attestation commit whose parent is that candidate; the generator refuses a dirty input tree | Gate 0 evidence design; avoids impossible self-referential commit SHAs | ACCEPTED |
| D-021 | Gate 0 evidence must be reproducible by a third party from the commit alone: exact command, exit status, output SHA-256 | current user decision | ACCEPTED |
| D-022 | `data/c3.db` is not read, deleted, reverted, or chmod-ed; the decision to leave it untouched is recorded as a decision with an owner | current user decision | ACCEPTED |
| D-023 | Gate 0 verdicts are derived, never supplied by `--verdict`. A well-formed red validator report generates `FAIL` evidence and exits 1; a malformed, contradictory, signalled, or unexecutable validator is evidence-infrastructure failure exit 2. Open repository-local trust blockers cannot be converted to `CONDITIONAL PASS` | Gate 0 generator repair and current user direction | ACCEPTED |
| D-024 | Every risk-register row has one validated machine-readable `gateImpact`: `G0_FAIL`, `G0_REVIEW_REQUIRED`, `LATER_GATE`, or `SEPARATE_INCIDENT`. Open `G0_FAIL` and every unclassified open/local risk fail closed; no fixed risk-ID allowlist defines the verdict. A non-failing class requires a concrete condition. `G0-R018` remains later-gate only while the legacy listener is loopback-only; privacy remains a separate incident | current user decision and Gate 0 risk-policy repair | ACCEPTED |

## Pending operator decisions

| ID | Decision needed | Earliest gate | Current safe default |
|---|---|---|---|
| P-001 | Repository visibility/containment | Gate 0 incident response | make no remote change |
| P-002 | Credential rotation execution | Gate 0 incident response | provide category list only |
| P-003 | Public Git history remediation and coordination | after Gate 0 evidence | preserve history; no rewrite |
| P-004 | PR, merge, tag, release, or publication | after review | push only the integration branch; do not change `main` |
