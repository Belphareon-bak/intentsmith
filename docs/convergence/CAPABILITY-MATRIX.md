# IntentSmith Capability Matrix

Statuses are evidence states, not roadmap confidence. No row is green until its
current-baseline acceptance evidence exists. Every suite referenced by Gate 1
acceptance requires a registered execution with non-empty `lastGreen.commit`
equal to the candidate and a bound artifact; registry membership or an empty
evidence row is not acceptance. The legacy states below are not promoted merely
because Gate 0 deterministic coverage passed.

| ID | Capability | Gate 0 status | Evidence / issue | Owner |
|---|---|---|---|---|
| C3-001 | C3 Studio/Theia application | UNVERIFIED | Source wiring is covered, but the production Theia/Electron artifact is not built, digest-bound, or runtime-tested; `G0-R030` also blocks Gate 1 acceptance | primary implementer |
| C3-002 | Chat sessions and history | UNVERIFIED | Current deterministic and E2E evidence pending | primary implementer |
| C3-003 | CRE routing and 19 intents | BASELINE_RED | False-green/corrupt-source cleanup is complete, but candidate-bound routing acceptance evidence is absent | primary implementer |
| C3-004 | Clarification and safe response behavior | UNVERIFIED | Current fixture inventory pending | primary implementer |
| C3-005 | Project lifecycle | BASELINE_RED | Gate 0 deterministic coverage exists, but no candidate-bound lifecycle acceptance record exists | primary implementer |
| C3-006 | D1/CODE/BUILD_VERIFY/R2/D2/R1 workflow | BASELINE_RED | Gate 0 repaired false-green paths; complete candidate-bound workflow evidence is absent | primary implementer |
| C3-007 | Patch parsing, validation, and scope limiting | UNVERIFIED | Current suite pending | primary implementer |
| C3-008 | Deterministic quality gates | BASELINE_RED | A9 and related test-trust defects are repaired; candidate-bound quality acceptance evidence is absent | primary implementer |
| C3-009 | Coding executor | UNVERIFIED | Gate 0 characterization pending | primary implementer |
| C3-010 | Model gateway and GPU serialization | UNVERIFIED | Deterministic characterization pending | primary implementer |
| C3-011 | Expertises and 5D merge behavior | UNVERIFIED | Current suite pending | primary implementer |
| C3-012 | Skills runtime and checkpoints | UNVERIFIED | Current suite pending | primary implementer |
| C3-013 | Specialist runtime and loader | BASELINE_RED | Specialist fixture and exit repairs pass Gate 0 scope; capability acceptance is not yet bound | primary implementer |
| C3-014 | `accountant-cz` specialist | BASELINE_RED | Dynamic package activation is repaired; routing/scenario acceptance is not yet candidate-bound | primary implementer |
| C3-015 | Autonomous agents and scheduler | UNVERIFIED | Current suite pending | primary implementer |
| C3-016 | Memory and context budgeting | UNVERIFIED | Isolation tests pending | primary implementer |
| C3-017 | Cross-project learning | UNVERIFIED | Default-scope behavior must be verified from code/tests | primary implementer |
| C3-018 | C3 Code Intelligence | BASELINE_RED | Gate 0 registry is green, but clean candidate AST/native capability evidence is absent | primary implementer |
| C3-019 | Symbol/reference backend | BASELINE_RED | Gate 0 registry is green, but symbol/reference acceptance evidence is absent | primary implementer |
| C3-020 | Tool and capability registry | UNVERIFIED | Enforcement inventory belongs to Gate 1/2 | primary implementer |
| C3-021 | Notifications | UNVERIFIED | Current suite pending | primary implementer |
| C3-022 | Marketplace/package behavior | UNVERIFIED | Current suite pending | primary implementer |
| C3-023 | API and WebSocket bridge | UNVERIFIED | Legacy numeric bind and HTTP/WS browser-origin guards have registered C3-023 deterministic coverage; complete API/WS, Electron integration and Studio acceptance remains pending | primary implementer |
| C3-024 | SQLite repositories and migrations | BASELINE_RED | Runtime backups are absent from the active tree and import isolation is repaired; Gate 1 migration/repository evidence is pending | primary implementer |
| C3-025 | Model catalog and evaluation fixtures | UNVERIFIED | Current suite pending | primary implementer |
| C3-026 | Product documentation and examples | BASELINE_RED | README and status claims are repaired, but no candidate-bound capability acceptance record exists | primary implementer |
| C3-027 | Test fixtures and nightly scenarios | BASELINE_RED | Registry completeness and truthful exits pass Gate 0; Gate 1 scenario acceptance is not yet bound | primary implementer |
| C3-028 | Process isolation and cleanup | UNVERIFIED | Gate 0 characterization pending | primary implementer |
| C3-029 | Approval and execution audit | UNVERIFIED | Donor component; integration not started | primary implementer |
| C3-030 | Git change evidence and final verdict | UNVERIFIED | Donor component; integration not started | primary implementer |
