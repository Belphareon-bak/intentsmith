# IntentSmith Test Registry

This is the canonical rendered ledger for `tests/registry.json`.
It is generated deterministically; edit the JSON manifest and run
`node scripts/validate-test-registry.js --write-doc`.

A suite verdict is derived from child exit status, signal, timeout, required
evidence, and cleanup. Printed assertion totals are metrics only and cannot
override a failed or blocked suite.

A `modelFixture` requirement is a non-bypassable read-only preflight. It
pins model digest, allocated context and request concurrency, pre-load free
VRAM, post-load headroom, GPU residency and fallback policy.

## Inventory

- Runnable programs: 463
- Explicit support-module exclusions: 14
- Profiles: offline=238, database=57, server=41, model=85, soak=26, manual=16
- States: ACTIVE=368, HISTORICAL=16, BLOCKED=79

## Execution profiles

| Profile | Scope | Default prerequisites |
|---|---|---|
| `offline` | deterministic tests with no external services; either `network:none` or the exact self-owned loopback fixture | isolated HOME/temp; owned loopback is declared and validator-enforced; strict OS egress proof is separate |
| `database` | deterministic SQLite/integration checks | per-suite temporary DB |
| `server` | local API/WS programs | hard-blocked until an owned, identity-verified server supervisor exists |
| `model` | real-model or external-network programs | pinned model/GPU; external network remains hard-blocked |
| `soak` | long-running stability programs | dedicated clean commit and artifact root |
| `manual` | historical/operator tools | never release evidence by default |

## Suites

| ID | Path | Capability | Tier | Profile | Expected | Timeout | Requirements | Required | State | Last green | Owner |
|---|---|---|---|---|---:|---:|---|---:|---|---|---|
| `IS-T3-E2E-RUN-E2E` | `e2e/run-e2e.js` | `C3-027` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T5-TESTS-LEGACY-BENCHMARK` | `tests/_legacy/benchmark.cjs` | `C3-027` | T5 | `manual` | 30 min | 60 min | network:external, temp-db, server, ollama, gpu | no | `HISTORICAL` | — | primary implementer |
| `IS-T5-TESTS-LEGACY-E2E-LLM-VALIDATION` | `tests/_legacy/e2e-llm-validation.cjs` | `C3-027` | T5 | `manual` | 30 min | 60 min | network:external, temp-db, server, ollama, gpu | no | `HISTORICAL` | — | primary implementer |
| `IS-T5-TESTS-LEGACY-E2E-LOOP` | `tests/_legacy/e2e-loop.js` | `C3-027` | T5 | `manual` | 30 min | 60 min | network:external, temp-db, server, ollama, gpu | no | `HISTORICAL` | — | primary implementer |
| `IS-T5-TESTS-LEGACY-E2E-QUALITY-DEEP` | `tests/_legacy/e2e-quality-deep.cjs` | `C3-027` | T5 | `manual` | 30 min | 60 min | network:external, temp-db, server, ollama, gpu | no | `HISTORICAL` | — | primary implementer |
| `IS-T5-TESTS-LEGACY-P5-SCORING-SIMULATION` | `tests/_legacy/p5-scoring-simulation.js` | `C3-027` | T5 | `manual` | 30 min | 60 min | network:external, temp-db, server, ollama, gpu | no | `HISTORICAL` | — | primary implementer |
| `IS-T5-TESTS-LEGACY-PHASE-C-TEST` | `tests/_legacy/phase-c.test.cjs` | `C3-027` | T5 | `manual` | 30 min | 60 min | network:external, temp-db, server, ollama, gpu | no | `HISTORICAL` | — | primary implementer |
| `IS-T5-TESTS-LEGACY-PHASE-F-TEST` | `tests/_legacy/phase-f.test.cjs` | `C3-027` | T5 | `manual` | 30 min | 60 min | network:external, temp-db, server, ollama, gpu | no | `HISTORICAL` | — | primary implementer |
| `IS-T5-TESTS-LEGACY-RUN-ALL-EXPERTISE-E2E` | `tests/_legacy/run-all-expertise-e2e.sh` | `C3-027` | T5 | `manual` | 30 min | 60 min | network:external, temp-db, server, ollama, gpu | no | `HISTORICAL` | — | primary implementer |
| `IS-T5-TESTS-LEGACY-SCENARIOS` | `tests/_legacy/scenarios.cjs` | `C3-027` | T5 | `manual` | 30 min | 60 min | network:external, temp-db, server, ollama, gpu | no | `HISTORICAL` | — | primary implementer |
| `IS-T5-TESTS-LEGACY-SEARCH-STRESS` | `tests/_legacy/search-stress.cjs` | `C3-027` | T5 | `manual` | 30 min | 60 min | network:external, temp-db, server, ollama, gpu | no | `HISTORICAL` | — | primary implementer |
| `IS-T5-TESTS-LEGACY-SPRINTS-SPRINT4-TEST` | `tests/_legacy/sprints/sprint4.test.cjs` | `C3-027` | T5 | `manual` | 30 min | 60 min | network:external, temp-db, server, ollama, gpu | no | `HISTORICAL` | — | primary implementer |
| `IS-T5-TESTS-LEGACY-SPRINTS-SPRINT5-TEST` | `tests/_legacy/sprints/sprint5.test.cjs` | `C3-027` | T5 | `manual` | 30 min | 60 min | network:external, temp-db, server, ollama, gpu | no | `HISTORICAL` | — | primary implementer |
| `IS-T5-TESTS-LEGACY-SPRINTS-SPRINT6-TEST` | `tests/_legacy/sprints/sprint6.test.cjs` | `C3-027` | T5 | `manual` | 30 min | 60 min | network:external, temp-db, server, ollama, gpu | no | `HISTORICAL` | — | primary implementer |
| `IS-T5-TESTS-LEGACY-SPRINTS-SPRINT7-TEST` | `tests/_legacy/sprints/sprint7.test.cjs` | `C3-027` | T5 | `manual` | 30 min | 60 min | network:external, temp-db, server, ollama, gpu | no | `HISTORICAL` | — | primary implementer |
| `IS-T1-TESTS-ACCOUNTANT-E2E-TEST` | `tests/accountant-e2e.test.js` | `C3-014` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-ACCOUNTANT-SELF-CONTAINED-TEST` | `tests/accountant-self-contained.test.js` | `C3-014` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-ACCOUNTANT-TOOLS-TEST` | `tests/accountant-tools.test.js` | `C3-014` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-ADVERSARIAL-CRE-TEST` | `tests/adversarial-cre.test.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-AGENT-LOG-UX-TEST` | `tests/agent-log-ux.test.js` | `C3-015` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-AGENT-RUNNER-TEST` | `tests/agent-runner.test.js` | `C3-015` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-AGENT-SOURCES-TEST` | `tests/agent-sources.test.js` | `C3-015` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-AGENT-WIZARD-TEST` | `tests/agent-wizard.test.js` | `C3-015` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-API-CONTRACT-REGISTRY-TEST` | `tests/api-contract-registry.test.js` | `C3-023` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-ARCHITECT-SMOKE-TEST` | `tests/architect-smoke.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-ARCHITECTURE-CHECK-TEST` | `tests/architecture-check.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-ARCHITECTURE-DETECTOR-TEST` | `tests/architecture-detector.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-ARCHITECTURE-GOVERNANCE-TEST` | `tests/architecture-governance.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-ARCHITECTURE-POLICY-TEST` | `tests/architecture-policy.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-ARCHIVE-LIFECYCLE-TEST` | `tests/archive-lifecycle.test.js` | `C3-024` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-ARTIFACT-VALIDATION` | `tests/artifact-validation.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-AST-ANALYZER-TEST` | `tests/ast-analyzer.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-ATTACHMENTS-PROJECTS-TEST` | `tests/attachments-projects.test.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-AUDIT-SUMMARY-SELF-TEST` | `tests/audit-summary-self-test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-AUTO-EXPERTISE-SELECT-TEST` | `tests/auto-expertise-select.test.js` | `C3-011` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-BUILD-DEFERRAL-TEST` | `tests/build-deferral.test.js` | `C3-027` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-BUILD-HANDOFF-TEST` | `tests/build-handoff.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-BUILD-INTENT-TEST` | `tests/build-intent.test.js` | `C3-027` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-BUILD-PATTERNS-TEST` | `tests/build-patterns.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-BUILD-ROUTING-PROJECT-MODE-TEST` | `tests/build-routing-project-mode.test.js` | `C3-027` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-BUILD-STRATEGY-TEST` | `tests/build-strategy.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CANDIDATE-TRIAL-TEST` | `tests/candidate-trial.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CAPABILITY-01-SERVER-BEHAVIOURS-TEST` | `tests/capability-01-server-behaviours.test.js` | `C3-023` | T1 | `offline` | 90 s | 5 min | network:loopback | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CAPABILITY-02-CRE-BEHAVIOURS-TEST` | `tests/capability-02-cre-behaviours.test.js` | `C3-003` | T1 | `offline` | 20 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-CAPABILITY-02-CRE-MODEL-BEHAVIOURS-TEST` | `tests/capability-02-cre-model-behaviours.test.js` | `C3-003` | T3 | `model` | 30 s | 5 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CAPABILITY-ENFORCER-TEST` | `tests/capability-enforcer.test.js` | `C3-020` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CAPABILITY-REGISTRY-TEST` | `tests/capability-registry.test.js` | `C3-020` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CAPABILITY-SANDBOX-TEST` | `tests/capability-sandbox.test.js` | `C3-020` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CATALOG-ENRICHMENT-TEST` | `tests/catalog-enrichment.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CHAT-EXPORT-BUDGET-TEST` | `tests/chat-export-budget.test.js` | `C3-003` | T1 | `offline` | 30 s | 2 min | network:none, toolchain:python-pdf-runtime | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CHAT-FIXES-TEST` | `tests/chat-fixes.test.js` | `C3-003` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CHAT-OUTPUT-QUALITY-TEST` | `tests/chat-output-quality.test.js` | `C3-003` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-CHAT-PERSISTENCE-TEST` | `tests/chat-persistence.test.js` | `C3-003` | T3 | `server` | 30 s | 3 min | network:loopback, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-CHAT-PIPELINE-TEST` | `tests/chat-pipeline.test.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-CHAT-QUALITY-TEST` | `tests/chat-quality.test.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:external, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CHAT-SEARCH-QUALITY-TEST` | `tests/chat-search-quality.test.js` | `C3-003` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CHAT-SYNTHESIS-HARDENING-TEST` | `tests/chat-synthesis-hardening.test.js` | `C3-003` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CHUNKER-TEST` | `tests/chunker.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CIRCUIT-BREAKER-V55-TEST` | `tests/circuit-breaker-v55.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CODE-ANALYZER-TEST` | `tests/code-analyzer.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CODE-EVOLUTION-TEST` | `tests/code-evolution.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CODE-PATCH-RUNNER-TEST` | `tests/code-patch-runner.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CODE-PATCH-SUITE-TEST` | `tests/code-patch-suite.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CODE-SEARCH-TEST` | `tests/code-search.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CODE-TASK-EXTRACTOR-TEST` | `tests/code-task-extractor.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CONCEPT-REGISTRY-TEST` | `tests/concept-registry.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CONFIRMATION-OWNERSHIP-TEST` | `tests/confirmation-ownership.test.js` | `C3-027` | T1 | `offline` | 5 s | 1 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CONTEXT-BUILDER-TEST` | `tests/context-builder.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CONTEXT-COMPACT-MODEL-CTX-TEST` | `tests/context-compact-model-ctx.test.js` | `C3-016` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CONTEXT-DELTA-TEST` | `tests/context-delta.test.js` | `C3-016` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CONTEXT-ENGINE-TEST` | `tests/context-engine.test.js` | `C3-016` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CONTEXT-OPTIMIZER-TEST` | `tests/context-optimizer.test.js` | `C3-016` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CONTINUOUS-IMPROVEMENT-TEST` | `tests/continuous-improvement.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-CONV-CZECH-NODIACRITICS-TEST` | `tests/conv-czech-nodiacritics.test.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:external, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-CONV-CZECH-TEST` | `tests/conv-czech.test.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:external, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-CONV-ENGLISH-TEST` | `tests/conv-english.test.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:external, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-CRE-BUILD-ARBITRATION-TEST` | `tests/cre-build-arbitration.test.js` | `C3-003` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-CRE-COMPREHENSIVE-TEST` | `tests/cre-comprehensive.test.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-CRE-DIALOG-SCENARIOS-TEST` | `tests/cre-dialog-scenarios.test.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-CRE-FILE-REFERENCE-GUARD-TEST` | `tests/cre-file-reference-guard.test.js` | `C3-003` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-CRE-FOLLOWUP-DIAGNOSTIC-TEST` | `tests/cre-followup-diagnostic.test.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CRE-GATEKEEPER-TEST` | `tests/cre-gatekeeper.test.js` | `C3-003` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-CRE-GUARD-INTERACTIONS-TEST` | `tests/cre-guard-interactions.test.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-CRE-REPORT-STICKY-BREAK-TEST` | `tests/cre-report-sticky-break.test.js` | `C3-003` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CREATE-EXPERTISE-INTEGRATION-TEST` | `tests/create-expertise-integration.test.js` | `C3-003` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CREATE-SPECIALIST-SKILL-TEST` | `tests/create-specialist-skill.test.js` | `C3-003` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CRITIC-AGENT-TEST` | `tests/critic-agent.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CROSS-PROJECT-LEARNER-TEST` | `tests/cross-project-learner.test.js` | `C3-016` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-DB-AUTOREPAIR-TEST` | `tests/db-autorepair.test.js` | `C3-024` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-DEAD-CODE-DETECTOR-TEST` | `tests/dead-code-detector.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-DEBUG-AGENT-TEST` | `tests/debug-agent.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-DEPENDENCY-MANAGER-TEST` | `tests/dependency-manager.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-DESIGN-SPRINT34-TEST` | `tests/design-sprint34.test.js` | `C3-027` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-DESIGN-TESTS-TEST` | `tests/design-tests.test.js` | `C3-027` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-DETERMINISTIC-ANSWER-LATENCY-TEST` | `tests/deterministic-answer-latency.test.js` | `C3-004` | T1 | `offline` | 5 s | 1 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-DOMAINS-TEST` | `tests/domains.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-DRIFT-DETECTOR-TEST` | `tests/drift-detector.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-E2E-COMPLEX-TEST` | `tests/e2e-complex.test.js` | `C3-027` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-E2E-HARNESS-ISOLATION-TEST` | `tests/e2e-harness-isolation.test.js` | `C3-027` | T2 | `database` | 30 s | 2 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-E2E-NOTIFICATIONS-TEST` | `tests/e2e-notifications.test.js` | `C3-027` | T3 | `model` | 5 min | 15 min | network:external | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-E2E-PIPELINE-TEST` | `tests/e2e-pipeline.test.js` | `C3-027` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-E2E-RESILIENCE-TEST` | `tests/e2e-resilience.test.js` | `C3-027` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-E2E-SPECIALISTS-TEST` | `tests/e2e-specialists.test.js` | `C3-027` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-E2E-WORKERS-TEST` | `tests/e2e-workers.test.js` | `C3-027` | T3 | `model` | 5 min | 15 min | network:external, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-E2E-HELPERS-SELF-CHECK` | `tests/e2e/_helpers.self-check.js` | `C3-027` | T1 | `offline` | 5 s | 30 s | network:loopback | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-E2E-01-HEALTH-SMOKE` | `tests/e2e/01-health-smoke.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-02-CHAT-API` | `tests/e2e/02-chat-api.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-03-CONVERSATIONS` | `tests/e2e/03-conversations.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-04-PROJECTS` | `tests/e2e/04-projects.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-05-ATTACHMENTS` | `tests/e2e/05-attachments.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-06-EXPERTISES` | `tests/e2e/06-expertises.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-07-SPECIALISTS` | `tests/e2e/07-specialists.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-08-AGENTS` | `tests/e2e/08-agents.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-09-SKILLS` | `tests/e2e/09-skills.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-10-MARKETPLACE` | `tests/e2e/10-marketplace.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:external, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-11-MEMORY` | `tests/e2e/11-memory.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-12-NOTIFICATIONS` | `tests/e2e/12-notifications.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-13-SECURITY` | `tests/e2e/13-security.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-14-SYSTEM` | `tests/e2e/14-system.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server, ollama | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-15-QUALITY` | `tests/e2e/15-quality.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-16-SETUP-WIZARD` | `tests/e2e/16-setup-wizard.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server, ollama | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-17-EXPORT` | `tests/e2e/17-export.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-18-WEBSOCKET` | `tests/e2e/18-websocket.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-19-RATE-LIMIT` | `tests/e2e/19-rate-limit.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-20-SECURITY-HARDENING` | `tests/e2e/20-security-hardening.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T5-E2E-200-S1-MINIC3-P1` | `tests/e2e/200-s1-minic3-p1.e2e.js` | `C3-027` | T5 | `soak` | 60 min | 90 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T5-E2E-201-S1-MINIC3-P2` | `tests/e2e/201-s1-minic3-p2.e2e.js` | `C3-027` | T5 | `soak` | 60 min | 90 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T5-E2E-202-S1-MINIC3-P3` | `tests/e2e/202-s1-minic3-p3.e2e.js` | `C3-027` | T5 | `soak` | 60 min | 90 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T5-E2E-203-S1-MINIC3-P4` | `tests/e2e/203-s1-minic3-p4.e2e.js` | `C3-027` | T5 | `soak` | 60 min | 90 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T5-E2E-204-S1-MINIC3-P5` | `tests/e2e/204-s1-minic3-p5.e2e.js` | `C3-027` | T5 | `soak` | 60 min | 90 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T5-E2E-205-S1-MINIC3-P6` | `tests/e2e/205-s1-minic3-p6.e2e.js` | `C3-027` | T5 | `soak` | 60 min | 90 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T5-E2E-206-S2-SHOPFLOW-P1` | `tests/e2e/206-s2-shopflow-p1.e2e.js` | `C3-027` | T5 | `soak` | 60 min | 90 min | network:external, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T5-E2E-207-S2-SHOPFLOW-P2` | `tests/e2e/207-s2-shopflow-p2.e2e.js` | `C3-027` | T5 | `soak` | 60 min | 90 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T5-E2E-208-S2-SHOPFLOW-P3` | `tests/e2e/208-s2-shopflow-p3.e2e.js` | `C3-027` | T5 | `soak` | 60 min | 90 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T5-E2E-209-S2-SHOPFLOW-P4` | `tests/e2e/209-s2-shopflow-p4.e2e.js` | `C3-027` | T5 | `soak` | 60 min | 90 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-21-MODEL-UPGRADE` | `tests/e2e/21-model-upgrade.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T5-E2E-210-S2-SHOPFLOW-P5` | `tests/e2e/210-s2-shopflow-p5.e2e.js` | `C3-027` | T5 | `soak` | 60 min | 90 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T5-E2E-211-S2-SHOPFLOW-P6` | `tests/e2e/211-s2-shopflow-p6.e2e.js` | `C3-027` | T5 | `soak` | 60 min | 90 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-22-AUTONOMY` | `tests/e2e/22-autonomy.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T5-E2E-220-E2E-SUITE-RUNNER` | `tests/e2e/220-e2e-suite-runner.js` | `C3-027` | T5 | `soak` | 720 min | 1080 min | network:external, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-23-FEEDBACK` | `tests/e2e/23-feedback.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-24-DRAFTS` | `tests/e2e/24-drafts.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-25-FEATURES` | `tests/e2e/25-features.e2e.js` | `C3-023` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-50-CHAT-CONVERSATION` | `tests/e2e/50-chat-conversation.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-51-CRE-CLASSIFICATION` | `tests/e2e/51-cre-classification.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:external, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-52-CHAT-QUALITY-GATE` | `tests/e2e/52-chat-quality-gate.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-53-LONG-CONVERSATION` | `tests/e2e/53-long-conversation.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-54-CHAT-WITH-EXPERTISE` | `tests/e2e/54-chat-with-expertise.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-55-CHAT-WITH-SPECIALIST` | `tests/e2e/55-chat-with-specialist.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-56-CHAT-WITH-PROJECT` | `tests/e2e/56-chat-with-project.e2e.js` | `C3-003` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-57-LIFECYCLE-FULL` | `tests/e2e/57-lifecycle-full.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu, model:qwen3.5:27b@sha256:7653528ba5cb, ctx:8192x1, free-vram:20128MiB, headroom:1024MiB, gpu-residency:100%, fallback:forbid | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-58-CODE-GENERATION` | `tests/e2e/58-code-generation.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu, model:qwen3.5:27b@sha256:7653528ba5cb, ctx:8192x1, free-vram:20128MiB, headroom:1024MiB, gpu-residency:100%, fallback:forbid | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-59-CROSS-FEATURE` | `tests/e2e/59-cross-feature.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu, model:qwen3.5:27b@sha256:7653528ba5cb, ctx:8192x1, free-vram:20128MiB, headroom:1024MiB, gpu-residency:100%, fallback:forbid | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-60-WS-CHAT` | `tests/e2e/60-ws-chat.e2e.js` | `C3-003` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-61-AUTOCOMPLETE` | `tests/e2e/61-autocomplete.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-62-VALIDATION-SUITES` | `tests/e2e/62-validation-suites.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-63-AGENT-EXECUTION` | `tests/e2e/63-agent-execution.e2e.js` | `C3-003` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-64-M3-PROJECT-HEALTH-AGENT` | `tests/e2e/64-m3-project-health-agent.e2e.js` | `C3-013` | T3 | `server` | 5 s | 2 min | network:loopback, temp-db, server | yes | `ACTIVE` | — | WP-M3-AGENT-PROJECT-HEALTH |
| `IS-T3-E2E-70-CRE-INTENT-SEMANTIC` | `tests/e2e/70-cre-intent-semantic.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-71-LANGUAGE-ENFORCEMENT` | `tests/e2e/71-language-enforcement.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-72-FOLLOWUP-COHERENCE` | `tests/e2e/72-followup-coherence.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-73-QUALITY-GATE-CONTENT` | `tests/e2e/73-quality-gate-content.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-74-SESSION-ISOLATION` | `tests/e2e/74-session-isolation.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-75-EXPERTISE-BEHAVIORAL` | `tests/e2e/75-expertise-behavioral.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-76-SPECIALIST-DOMAIN` | `tests/e2e/76-specialist-domain.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-77-PROJECT-CONTEXT-INJECTION` | `tests/e2e/77-project-context-injection.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-78-GUARD-RULES` | `tests/e2e/78-guard-rules.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-79-RESPONSE-SEMANTICS` | `tests/e2e/79-response-semantics.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-80-WS-SEMANTIC-EVENTS` | `tests/e2e/80-ws-semantic-events.e2e.js` | `C3-003` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-81-CONVERSATION-LIFECYCLE` | `tests/e2e/81-conversation-lifecycle.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-82-CRE-CONFLICT-RESOLUTION` | `tests/e2e/82-cre-conflict-resolution.e2e.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-83-M3-EXPERTISE-EXTENSION` | `tests/e2e/83-m3-expertise-extension.e2e.js` | `C3-007` | T3 | `server` | 2 s | 2 min | network:loopback, temp-db, server | yes | `ACTIVE` | — | WP-M3-EXPERTISE |
| `IS-T3-E2E-84-M3-CODE-REVIEW-SPECIALIST` | `tests/e2e/84-m3-code-review-specialist.e2e.js` | `C3-013` | T3 | `server` | 5 s | 2 min | network:loopback, temp-db, server | yes | `ACTIVE` | — | WP-M3-SPECIALIST-CODE-REVIEW |
| `IS-T3-E2E-85-LONG-SESSION-DEGRADATION` | `tests/e2e/85-long-session-degradation.e2e.js` | `C3-003` | T3 | `model` | 45 min | 60 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-86-CODE-SEMANTIC-QUALITY` | `tests/e2e/86-code-semantic-quality.e2e.js` | `C3-003` | T3 | `model` | 45 min | 60 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-87-SECURITY-INJECTION` | `tests/e2e/87-security-injection.e2e.js` | `C3-003` | T3 | `model` | 45 min | 60 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-88-CONCURRENT-LOAD` | `tests/e2e/88-concurrent-load.e2e.js` | `C3-003` | T3 | `model` | 45 min | 60 min | network:loopback, temp-db, server, ollama, gpu, model:qwen3.5:27b@sha256:7653528ba5cb, ctx:8192x3, free-vram:24016MiB, headroom:1024MiB, gpu-residency:100%, fallback:forbid | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-89-RESPONSE-USEFULNESS` | `tests/e2e/89-response-usefulness.e2e.js` | `C3-003` | T3 | `model` | 45 min | 60 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-90-LARGE-PROJECT-GENERATION` | `tests/e2e/90-large-project-generation.e2e.js` | `C3-003` | T3 | `model` | 45 min | 60 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-91-MULTI-TURN-PROJECT-BUILD` | `tests/e2e/91-multi-turn-project-build.e2e.js` | `C3-003` | T3 | `model` | 45 min | 60 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-92-CODE-ANALYSIS-DEPTH` | `tests/e2e/92-code-analysis-depth.e2e.js` | `C3-003` | T3 | `model` | 45 min | 60 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-93-CHAT-RESPONSE-QUALITY` | `tests/e2e/93-chat-response-quality.e2e.js` | `C3-003` | T3 | `model` | 45 min | 60 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-94-LONG-CONVERSATION-QUALITY` | `tests/e2e/94-long-conversation-quality.e2e.js` | `C3-003` | T3 | `model` | 45 min | 60 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-95-CODE-GENERATION-QUALITY` | `tests/e2e/95-code-generation-quality.e2e.js` | `C3-003` | T3 | `model` | 45 min | 60 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-96-PROJECT-WORKFLOW-QUALITY` | `tests/e2e/96-project-workflow-quality.e2e.js` | `C3-003` | T3 | `model` | 45 min | 60 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-97-PROJECT-BUILD-QUALITY` | `tests/e2e/97-project-build-quality.e2e.js` | `C3-003` | T3 | `model` | 45 min | 60 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T3-E2E-98-ANALYSIS-QUALITY` | `tests/e2e/98-analysis-quality.e2e.js` | `C3-003` | T3 | `model` | 45 min | 60 min | network:loopback, temp-db, server, ollama, gpu | yes | `BLOCKED` | — | primary implementer |
| `IS-T1-TESTS-ERROR-NORMALIZER-TEST` | `tests/error-normalizer.test.js` | `C3-007` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-EXECUTION-GRAPH-TEST` | `tests/execution-graph.test.js` | `C3-007` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-EXECUTION-LOOP-TEST` | `tests/execution-loop.test.js` | `C3-007` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-EXECUTION-TRACE-STRESS-TEST` | `tests/execution-trace-stress.test.js` | `C3-007` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-EXECUTOR-CAPABILITIES-TEST` | `tests/executor-capabilities.test.js` | `C3-020` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-EXPERTISE-AB-QUALITY-TEST` | `tests/expertise-ab-quality.test.js` | `C3-011` | T3 | `model` | 10 min | 15 min | network:loopback, ollama, gpu | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-EXPERTISE-COMPARISON-E2E-B-TEST` | `tests/expertise-comparison-e2e-b.test.js` | `C3-011` | T3 | `model` | 10 min | 15 min | network:external, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-EXPERTISE-COMPARISON-E2E-C-TEST` | `tests/expertise-comparison-e2e-c.test.js` | `C3-011` | T3 | `model` | 10 min | 15 min | network:external, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-EXPERTISE-COMPARISON-E2E-D-TEST` | `tests/expertise-comparison-e2e-d.test.js` | `C3-011` | T3 | `model` | 10 min | 15 min | network:external, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-EXPERTISE-COMPARISON-E2E-E-TEST` | `tests/expertise-comparison-e2e-e.test.js` | `C3-011` | T3 | `model` | 10 min | 15 min | network:external, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-EXPERTISE-COMPARISON-E2E-TEST` | `tests/expertise-comparison-e2e.test.js` | `C3-011` | T3 | `model` | 10 min | 15 min | network:external, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-EXPERTISE-DISCOVERY-TEST` | `tests/expertise-discovery.test.js` | `C3-011` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-EXPERTISE-INTEGRATION-TEST` | `tests/expertise-integration.test.js` | `C3-011` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-EXPERTISE-ROUTING-CORRECTNESS-TEST` | `tests/expertise-routing-correctness.test.js` | `C3-011` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-EXPERTISE-SYSTEM-TEST` | `tests/expertise-system.test.js` | `C3-011` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-EXPERTISE-WIZARD-TEST` | `tests/expertise-wizard.test.js` | `C3-011` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-EXPLORATION-AGENT-TEST` | `tests/exploration-agent.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-EXPORT-PDF-DOCX-TEST` | `tests/export-pdf-docx.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none, toolchain:python-pdf-runtime | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-FILE-DISCOVERY-TEST` | `tests/file-discovery.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-FILE-WRITE-EXTRACT-TEST` | `tests/file-write-extract.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-FIX-STRATEGY-TEST` | `tests/fix-strategy.test.js` | `C3-007` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-FIXES-V582-TEST` | `tests/fixes-v582.test.js` | `C3-027` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-FUNCTION-SPAN-TEST` | `tests/function-span.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-GOVERNOR-TEST` | `tests/governor.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-GRAPH-QUERY-TEST` | `tests/graph-query.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-GRAPH-RETRIEVAL-TEST` | `tests/graph-retrieval.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-GRAPH-SYNC-TEST` | `tests/graph-sync.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-HARNESS-EXIT-CODE-TEST` | `tests/harness-exit-code.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-HUGGINGFACE-CLIENT-TEST` | `tests/huggingface-client.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-IMPACT-ANALYZER-TEST` | `tests/impact-analyzer.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-IMPORT-MAP-TEST` | `tests/import-map.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-IMPROVEMENT-LOOPS-TEST` | `tests/improvement-loops.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-INTENT-CONTEXT-TEST` | `tests/intent-context.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-KNOWLEDGE-BASE-TEST` | `tests/knowledge-base.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-KNOWLEDGE-GRAPH-TEST` | `tests/knowledge-graph.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-LARGE-PROJECT-SCALING-TEST` | `tests/large-project-scaling.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-LEDGER-ANNUAL-TEST` | `tests/ledger-annual.test.js` | `C3-024` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-LEDGER-COMPLIANCE-TEST` | `tests/ledger-compliance.test.js` | `C3-024` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-LEDGER-CORE-TEST` | `tests/ledger-core.test.js` | `C3-024` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-LEDGER-INSURANCE-TEST` | `tests/ledger-insurance.test.js` | `C3-024` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-LEDGER-REPORTS-TEST` | `tests/ledger-reports.test.js` | `C3-024` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-LEDGER-REWIRE-TEST` | `tests/ledger-rewire.test.js` | `C3-024` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-LEDGER-VAT-TEST` | `tests/ledger-vat.test.js` | `C3-024` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-LIFECYCLE-ANALYSIS-E2E-TEST` | `tests/lifecycle-analysis-e2e.test.js` | `C3-005` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-LIFECYCLE-ANDROID-APP-E2E-TEST` | `tests/lifecycle-android-app-e2e.test.js` | `C3-005` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-LIFECYCLE-BLOCKED-MILESTONE-TEST` | `tests/lifecycle-blocked-milestone.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-LIFECYCLE-BUILD-TEST` | `tests/lifecycle-build.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-LIFECYCLE-CONTEXT-LOSS-TEST` | `tests/lifecycle-context-loss.test.js` | `C3-005` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-LIFECYCLE-CONVERSATION-E2E-TEST` | `tests/lifecycle-conversation-e2e.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-LIFECYCLE-COOKBOOK-E2E-TEST` | `tests/lifecycle-cookbook-e2e.test.js` | `C3-005` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-LIFECYCLE-DB-TEST` | `tests/lifecycle-db.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-LIFECYCLE-E2E-TEST` | `tests/lifecycle-e2e.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-LIFECYCLE-HANDOFF-TEST` | `tests/lifecycle-handoff.test.js` | `C3-005` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-LIFECYCLE-HUMAN-FRICTION-TEST` | `tests/lifecycle-human-friction.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-LIFECYCLE-IMAGEGEN-E2E-TEST` | `tests/lifecycle-imagegen-e2e.test.js` | `C3-005` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-LIFECYCLE-INVARIANTS-TEST` | `tests/lifecycle-invariants.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-LIFECYCLE-KLICENKA-E2E-TEST` | `tests/lifecycle-klicenka-e2e.test.js` | `C3-005` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-LIFECYCLE-LLM-REALISTIC-TEST` | `tests/lifecycle-llm-realistic.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-LIFECYCLE-REAL-LLM-TEST` | `tests/lifecycle-real-llm.test.js` | `C3-005` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-LIFECYCLE-REVIEW-CHANGE-TEST` | `tests/lifecycle-review-change.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-LIFECYCLE-STRESS-ADVANCED-TEST` | `tests/lifecycle-stress-advanced.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-LIFECYCLE-TEST` | `tests/lifecycle.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-LLM-GATEWAY-RUNTIME-SIGNAL-TEST` | `tests/llm-gateway-runtime-signal.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-LLM-INTEGRATION-2-TEST` | `tests/llm-integration-2.test.js` | `C3-027` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, ollama, gpu | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-LLM-INTEGRATION-TEST` | `tests/llm-integration.test.js` | `C3-027` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, ollama, gpu | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-LOCAL-MATH-NONFINITE-TEST` | `tests/local-math-nonfinite.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-M1-CHAT-CONTRACT-TEST` | `tests/m1-chat-contract.test.js` | `C3-004` | T2 | `database` | 30 s | 2 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-CONTRACT-TEST` | `tests/m1-contract.test.js` | `C3-023` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T5-TESTS-M1-JOURNEY-TEST` | `tests/m1-journey.test.js` | `C3-001` | T5 | `soak` | 10 min | 20 min | network:loopback, temp-db, server, ollama, gpu, toolchain:linux-user-network-namespace, toolchain:iproute2, toolchain:x11-display | yes | `ACTIVE` | d518d7ec2156b108c5d71b72d16ee855781c6be5 / m1-journey.json | primary implementer |
| `IS-T1-TESTS-M1-MODEL-AUTOMATION-POLICY-TEST` | `tests/m1-model-automation-policy.test.js` | `C3-010` | T1 | `offline` | 15 s | 2 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-MODEL-BINDING-APPLICATION-TEST` | `tests/m1-model-binding-application.test.js` | `C3-010` | T1 | `database` | 30 s | 2 min | network:loopback, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-MODEL-BINDING-REPOSITORY-TEST` | `tests/m1-model-binding-repository.test.js` | `C3-010` | T1 | `database` | 30 s | 2 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-MODEL-BINDING-STORAGE-TEST` | `tests/m1-model-binding-storage.test.js` | `C3-010` | T1 | `database` | 30 s | 2 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-MODEL-CONTRACT-TEST` | `tests/m1-model-contract.test.js` | `C3-010` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-MODEL-FAILOVER-APPLICATION-TEST` | `tests/m1-model-failover-application.test.js` | `C3-010` | T1 | `database` | 30 s | 2 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-MODEL-FAILOVER-COORDINATOR-TEST` | `tests/m1-model-failover-coordinator.test.js` | `C3-010` | T1 | `database` | 30 s | 2 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-MODEL-FAILOVER-MEASUREMENT-TEST` | `tests/m1-model-failover-measurement.test.js` | `C3-010` | T1 | `offline` | 30 s | 2 min | network:loopback | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-MODEL-FAILOVER-PARENT-ACCEPTANCE-TEST` | `tests/m1-model-failover-parent-acceptance.test.js` | `C3-010` | T1 | `offline` | 30 s | 2 min | network:loopback | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-MODEL-FAILOVER-PROOF-ARTIFACTS-TEST` | `tests/m1-model-failover-proof-artifacts.test.js` | `C3-010` | T1 | `offline` | 10 s | 2 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-MODEL-FAILOVER-PROOF-ISSUER-TEST` | `tests/m1-model-failover-proof-issuer.test.js` | `C3-010` | T1 | `database` | 10 s | 2 min | network:loopback, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-MODEL-FAILOVER-PROOF-POLICY-TEST` | `tests/m1-model-failover-proof-policy.test.js` | `C3-010` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-MODEL-FAILOVER-REPOSITORY-TEST` | `tests/m1-model-failover-repository.test.js` | `C3-010` | T1 | `database` | 30 s | 2 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-MODEL-FAILOVER-SCHEMA-TEST` | `tests/m1-model-failover-schema.test.js` | `C3-010` | T1 | `database` | 30 s | 2 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-MODEL-FAILOVER-TERMINAL-TEST` | `tests/m1-model-failover-terminal.test.js` | `C3-010` | T1 | `database` | 30 s | 2 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-M1-MODEL-GPU-PILOT-TEST` | `tests/m1-model-gpu-pilot.test.js` | `C3-010` | T3 | `model` | 10 min | 15 min | network:loopback, ollama, gpu | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-MODEL-IDENTITY-TEST` | `tests/m1-model-identity.test.js` | `C3-010` | T1 | `database` | 30 s | 2 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-MODEL-SETTINGS-TEST` | `tests/m1-model-settings.test.js` | `C3-010` | T1 | `database` | 30 s | 2 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-MODEL-USE-AUTHORITY-TEST` | `tests/m1-model-use-authority.test.js` | `C3-010` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-QUALITY-CONTRACT-TEST` | `tests/m1-quality-contract.test.js` | `C3-003` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-M1-QUALITY-GPU-AB-TEST` | `tests/m1-quality-gpu-ab.test.js` | `C3-003` | T3 | `manual` | 10 min | 15 min | network:loopback, ollama, gpu | no | `HISTORICAL` | — | primary implementer |
| `IS-T1-TESTS-M1-STUDIO-CLIENT-TEST` | `tests/m1-studio-client.test.js` | `C3-001` | T1 | `offline` | 30 s | 2 min | network:loopback | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M1-VRAM-ARTIFACT-USE-TEST` | `tests/m1-vram-artifact-use.test.js` | `C3-010` | T1 | `offline` | 10 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-M2-EFFECT-AUTHORITY-REPOSITORY-TEST` | `tests/m2-effect-authority-repository.test.js` | `C3-016` | T1 | `database` | 1 s | 30 s | network:none, temp-db | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-EFFECT-BROKER-V1-TEST` | `tests/m2-effect-broker-v1.test.js` | `C3-016` | T1 | `database` | 3 s | 30 s | network:none, temp-db | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-EFFECT-CONTRACT-V1-TEST` | `tests/m2-effect-contract-v1.test.js` | `C3-016` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-EFFECT-EXECUTION-OWNER-TEST` | `tests/m2-effect-execution-owner.test.js` | `C3-016` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-EFFECT-FILE-CONSUMER-TEST` | `tests/m2-effect-file-consumer.test.js` | `C3-016` | T1 | `database` | 1 s | 30 s | network:none, temp-db | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-EFFECT-FILE-RUNTIME-TEST` | `tests/m2-effect-file-runtime.test.js` | `C3-016` | T1 | `database` | 45 s | 2 min | network:none, temp-db | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-EXECUTION-AUTHORITY-REPOSITORY-TEST` | `tests/m2-execution-authority-repository.test.js` | `C3-011` | T1 | `database` | 5 s | 30 s | network:none, temp-db | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-EXECUTION-CONTRACT-V1-TEST` | `tests/m2-execution-contract-v1.test.js` | `C3-011` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-EXECUTION-GIT-PRESERVATION-TEST` | `tests/m2-execution-git-preservation.test.js` | `C3-011` | T1 | `soak` | 5 s | 30 s | network:none, toolchain:git | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-EXECUTION-PROCESS-SUPERVISION-TEST` | `tests/m2-execution-process-supervision.test.js` | `C3-011` | T1 | `soak` | 10 s | 1 min | network:none, toolchain:bwrap | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-EXECUTION-PROJECT-CHANGE-TEST` | `tests/m2-execution-project-change.test.js` | `C3-011` | T1 | `soak` | 10 s | 1 min | network:none, temp-db, toolchain:bwrap, toolchain:git | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-GOVERNANCE-CONTRACT-V1-TEST` | `tests/m2-governance-contract-v1.test.js` | `C3-018` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-GOVERNANCE-EVALUATOR-TEST` | `tests/m2-governance-evaluator.test.js` | `C3-018` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-LIFECYCLE-APPLICATION-SERVICE-TEST` | `tests/m2-lifecycle-application-service.test.js` | `C3-005` | T1 | `soak` | 10 s | 1 min | network:none, temp-db, toolchain:bwrap, toolchain:git | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-LIFECYCLE-AUTHORITY-REPOSITORY-TEST` | `tests/m2-lifecycle-authority-repository.test.js` | `C3-005` | T1 | `database` | 5 s | 30 s | network:none, temp-db | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-LIFECYCLE-CONTRACT-V1-TEST` | `tests/m2-lifecycle-contract-v1.test.js` | `C3-005` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-LIFECYCLE-PROPOSAL-COMPILER-TEST` | `tests/m2-lifecycle-proposal-compiler.test.js` | `C3-005` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-LIFECYCLE-ROUTES-TEST` | `tests/m2-lifecycle-routes.test.js` | `C3-005` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-LIFECYCLE-STUDIO-SURFACE-TEST` | `tests/m2-lifecycle-studio-surface.test.js` | `C3-005` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-LIFECYCLE-SURFACE-RETIREMENT-TEST` | `tests/m2-lifecycle-surface-retirement.test.js` | `C3-005` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-NEGOTIATED-LIFECYCLE-QUARANTINE-TEST` | `tests/m2-negotiated-lifecycle-quarantine.test.js` | `C3-005` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-PROJECT-CONTEXT-BOUNDARY-TEST` | `tests/m2-project-context-boundary.test.js` | `C3-012` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-PROJECT-CONTEXT-CONSUMER-TEST` | `tests/m2-project-context-consumer.test.js` | `C3-012` | T1 | `offline` | 30 s | 2 min | network:none, temp-db | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-PROJECT-CONTEXT-CONTRACT-TEST` | `tests/m2-project-context-contract.test.js` | `C3-012` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-PROJECT-CONTEXT-RETRIEVAL-TEST` | `tests/m2-project-context-retrieval.test.js` | `C3-012` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-REMOTE-CORE-PORT-BOUNDARY-TEST` | `tests/m2-remote-core-port-boundary.test.js` | `C3-023` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-REMOTE-CORE-PORT-CONTRACT-V1-TEST` | `tests/m2-remote-core-port-contract-v1.test.js` | `C3-023` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-TOOL-AUTHORITY-REPOSITORY-TEST` | `tests/m2-tool-authority-repository.test.js` | `C3-020` | T1 | `database` | 1 s | 30 s | network:none, temp-db | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-TOOL-BROKER-V1-TEST` | `tests/m2-tool-broker-v1.test.js` | `C3-020` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-TOOL-CONTRACT-V1-TEST` | `tests/m2-tool-contract-v1.test.js` | `C3-020` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M2-TOOL-PRODUCTION-CONSUMER-TEST` | `tests/m2-tool-production-consumer.test.js` | `C3-020` | T1 | `database` | 1 s | 30 s | network:none, temp-db | yes | `ACTIVE` | c070ed7383e522fb58b53a799cbbc0e16c4b09a7 / docs/execution/runs/m2-pinned-closeout-20260825.md | primary implementer |
| `IS-T1-TESTS-M3-CODE-REVIEW-SPECIALIST-TEST` | `tests/m3-code-review-specialist.test.js` | `C3-013` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | — | WP-M3-SPECIALIST-CODE-REVIEW |
| `IS-T1-TESTS-M3-EXPERTISE-EXTENSION-TEST` | `tests/m3-expertise-extension.test.js` | `C3-007` | T1 | `database` | 1 s | 30 s | network:none, temp-db | yes | `ACTIVE` | — | WP-M3-EXPERTISE |
| `IS-T1-TESTS-M3-EXTENSION-CONTRACT-V1-TEST` | `tests/m3-extension-contract-v1.test.js` | `C3-013` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | — | WP-M3-BOUNDARY |
| `IS-T1-TESTS-M3-LEGACY-AGENT-SURFACE-RETIREMENT-TEST` | `tests/m3-legacy-agent-surface-retirement.test.js` | `C3-013` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | — | WP-M3-LEGACY-AGENT-RETIREMENT |
| `IS-T1-TESTS-M3-PROJECT-HEALTH-AGENT-TEST` | `tests/m3-project-health-agent.test.js` | `C3-013` | T1 | `database` | 2 s | 30 s | network:none, temp-db | yes | `ACTIVE` | — | WP-M3-AGENT-PROJECT-HEALTH |
| `IS-T1-TESTS-M3-SKILL-EFFECT-AUTHORITY-TEST` | `tests/m3-skill-effect-authority.test.js` | `C3-013` | T1 | `database` | 2 s | 30 s | network:none, temp-db | yes | `ACTIVE` | — | WP-M3-SKILL |
| `IS-T1-TESTS-M4-LEARNING-API-TEST` | `tests/m4-learning-api.test.js` | `C3-016` | T1 | `database` | 1 s | 30 s | network:none, temp-db | yes | `ACTIVE` | 286f5ba881aa5dce3797955efe68a7d5cd97f39c / docs/review/2026-08-26-M4-OPERATOR-REVIEW-RESULT.md | WP-M4-HTTP |
| `IS-T1-TESTS-M4-LEARNING-AUTHORITY-REPOSITORY-TEST` | `tests/m4-learning-authority-repository.test.js` | `C3-016` | T1 | `database` | 1 s | 30 s | network:none, temp-db | yes | `ACTIVE` | 286f5ba881aa5dce3797955efe68a7d5cd97f39c / docs/review/2026-08-26-M4-OPERATOR-REVIEW-RESULT.md | WP-M4-MEMORY |
| `IS-T1-TESTS-M4-LEARNING-CONTRACT-V1-TEST` | `tests/m4-learning-contract-v1.test.js` | `C3-016` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | 286f5ba881aa5dce3797955efe68a7d5cd97f39c / docs/review/2026-08-26-M4-OPERATOR-REVIEW-RESULT.md | WP-M4-OBSERVATION |
| `IS-T3-TESTS-M4-LEARNING-JOURNEY-E2E-TEST` | `tests/m4-learning-journey-e2e.test.js` | `C3-027` | T3 | `database` | 3 s | 1 min | network:none, temp-db | yes | `ACTIVE` | 286f5ba881aa5dce3797955efe68a7d5cd97f39c / docs/review/2026-08-26-M4-OPERATOR-REVIEW-RESULT.md | WP-M4-E2E |
| `IS-T1-TESTS-M4-LEARNING-OUTCOME-EVALUATOR-TEST` | `tests/m4-learning-outcome-evaluator.test.js` | `C3-016` | T1 | `database` | 1 s | 30 s | network:none, temp-db | yes | `ACTIVE` | 286f5ba881aa5dce3797955efe68a7d5cd97f39c / docs/review/2026-08-26-M4-OPERATOR-REVIEW-RESULT.md | WP-M4-OUTCOME |
| `IS-T1-TESTS-M4-LEARNING-PATTERN-PRODUCER-TEST` | `tests/m4-learning-pattern-producer.test.js` | `C3-027` | T1 | `database` | 1 s | 30 s | network:none, temp-db | yes | `ACTIVE` | 286f5ba881aa5dce3797955efe68a7d5cd97f39c / docs/review/2026-08-26-M4-OPERATOR-REVIEW-RESULT.md | WP-M4-CODEINTEL |
| `IS-T1-TESTS-M4-LEARNING-STUDIO-SURFACE-TEST` | `tests/m4-learning-studio-surface.test.js` | `C3-005` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | 286f5ba881aa5dce3797955efe68a7d5cd97f39c / docs/review/2026-08-26-M4-OPERATOR-REVIEW-RESULT.md | WP-M4-STUDIO |
| `IS-T1-TESTS-M4-PROJECT-LEARNING-CONTEXT-TEST` | `tests/m4-project-learning-context.test.js` | `C3-027` | T1 | `database` | 1 s | 30 s | network:none, temp-db | yes | `ACTIVE` | 286f5ba881aa5dce3797955efe68a7d5cd97f39c / docs/review/2026-08-26-M4-OPERATOR-REVIEW-RESULT.md | WP-M4-CONTEXT |
| `IS-T1-TESTS-M5-CONDITIONAL-SURFACES-TEST` | `tests/m5-conditional-surfaces.test.js` | `C3-023` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | — | WP-M5-CONDITIONAL-SURFACES |
| `IS-T1-TESTS-M5-DATA-RESTORE-TEST` | `tests/m5-data-restore.test.js` | `C3-004` | T1 | `database` | 1 s | 30 s | network:none, temp-db | yes | `ACTIVE` | — | WP-M5-DATA |
| `IS-T1-TESTS-M5-GLOBAL-AUTH-TEST` | `tests/m5-global-auth.test.js` | `C3-012` | T1 | `server` | 3 s | 1 min | network:loopback, temp-db, server | yes | `ACTIVE` | — | WP-M5-AUTH |
| `IS-T1-TESTS-M5-INSTALL-PROFILE-TEST` | `tests/m5-install-profile.test.js` | `C3-005` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | — | WP-M5-PACKAGE |
| `IS-T1-TESTS-M5-OBSERVABILITY-TEST` | `tests/m5-observability.test.js` | `C3-012` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | — | WP-M5-OBSERVE |
| `IS-T1-TESTS-M5-OUTBOUND-POLICY-TEST` | `tests/m5-outbound-policy.test.js` | `C3-020` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | — | WP-M5-OUTBOUND |
| `IS-T1-TESTS-M5-PERFORMANCE-BUDGET-TEST` | `tests/m5-performance-budget.test.js` | `C3-012` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | — | WP-M5-PERF |
| `IS-T1-TESTS-M5-PRIVACY-REMEDIATION-TEST` | `tests/m5-privacy-remediation.test.js` | `C3-012` | T1 | `database` | 1 s | 30 s | network:none, temp-db | yes | `ACTIVE` | — | WP-M5-PRIVACY |
| `IS-T1-TESTS-M5-PROCESS-HARDENING-TEST` | `tests/m5-process-hardening.test.js` | `C3-011` | T1 | `soak` | 3 s | 1 min | network:none, toolchain:bubblewrap, toolchain:prlimit | yes | `ACTIVE` | — | WP-M5-PROCESS |
| `IS-T1-TESTS-M5-REMOTE-CORE-ADAPTER-TEST` | `tests/m5-remote-core-adapter.test.js` | `C3-023` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | — | WP-M5-REMOTE-PORT |
| `IS-T1-TESTS-M6-CANDIDATE-PLAN-TEST` | `tests/m6-candidate-plan.test.js` | `C3-012` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | — | WP-M6-RELEASE |
| `IS-T1-TESTS-M6-L0-EVIDENCE-TEST` | `tests/m6-l0-evidence.test.js` | `C3-012` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | — | WP-M6-RELEASE |
| `IS-T1-TESTS-M6-MODEL-DISCOVERY-JOURNEY-TEST` | `tests/m6-model-discovery-journey.test.js` | `C3-023` | T1 | `offline` | 1 s | 30 s | network:loopback | yes | `ACTIVE` | — | WP-M6-RELEASE |
| `IS-T1-TESTS-M6-PLATFORM-JOURNEY-TEST` | `tests/m6-platform-journey.test.js` | `C3-023` | T1 | `offline` | 2 s | 1 min | network:none | yes | `ACTIVE` | — | WP-M6-RELEASE |
| `IS-T1-TESTS-M6-RELEASE-ARTIFACT-TEST` | `tests/m6-release-artifact.test.js` | `C3-012` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | — | WP-M6-RELEASE |
| `IS-T1-TESTS-M6-RELEASE-VALIDATION-TEST` | `tests/m6-release-validation.test.js` | `C3-012` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | — | WP-M6-RELEASE |
| `IS-T1-TESTS-M6-TECHNICAL-EVIDENCE-TEST` | `tests/m6-technical-evidence.test.js` | `C3-012` | T1 | `offline` | 1 s | 30 s | network:none | yes | `ACTIVE` | — | WP-M6-RELEASE |
| `IS-T1-TESTS-MANIFEST-V2-TEST` | `tests/manifest-v2.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MARKETPLACE-CATALOG-V125-TEST` | `tests/marketplace-catalog-v125.test.js` | `C3-022` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MARKETPLACE-TEST` | `tests/marketplace.test.js` | `C3-022` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MERGE-COMPATIBILITY-TEST` | `tests/merge-compatibility.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MERGE-ENFORCEMENT-INTEGRATION-TEST` | `tests/merge-enforcement-integration.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MERGE-ENGINE-TEST` | `tests/merge-engine.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MILESTONE-SIZE-TEST` | `tests/milestone-size.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MODEL-CTX-TEST` | `tests/model-ctx.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MODEL-SIMILARITY-TEST` | `tests/model-similarity.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MODEL-SWEEP-TEST` | `tests/model-sweep.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MODEL-UNIVERSE-STORE-TEST` | `tests/model-universe-store.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MODEL-UPGRADE-PHASE2-TEST` | `tests/model-upgrade-phase2.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MODEL-UPGRADE-PHASE3-TEST` | `tests/model-upgrade-phase3.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MODEL-UPGRADE-TEST` | `tests/model-upgrade.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MODULE-BOUNDARY-RATCHET-TEST` | `tests/module-boundary-ratchet.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | WP-M1-BOUNDARY-RATCHET |
| `IS-T1-TESTS-MODULES-TEST` | `tests/modules.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-MULTI-SOURCE-EXTERNAL-TEST` | `tests/multi-source-external.test.js` | `C3-015` | T3 | `model` | 30 s | 2 min | network:external | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MULTI-SOURCE-INTEGRATION-TEST` | `tests/multi-source-integration.test.js` | `C3-015` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MULTIMEDIA-TEST` | `tests/multimedia.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-NIGHTLY-AUDIT-RUNNER-SELF-TEST` | `tests/nightly-audit-runner-self-test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST` | `tests/nightly-orchestrator-self-test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-NOTIFICATIONS-TEST` | `tests/notifications.test.js` | `C3-021` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-ONLINE-DISCOVERY-TEST` | `tests/online-discovery.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-OUTBOUND-NETWORK-OPTIN-TEST` | `tests/outbound-network-optin.test.js` | `C3-027` | T1 | `offline` | 5 s | 1 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-OUTPUT-GATE` | `tests/output-gate.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T5-TESTS-P5-ONLY-TEST` | `tests/p5-only.test.js` | `C3-005` | T5 | `manual` | 10 min | 15 min | network:loopback, temp-db, ollama, gpu | no | `HISTORICAL` | — | primary implementer |
| `IS-T1-TESTS-PAIRWISE-TRIAL-TEST` | `tests/pairwise-trial.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-PATCH-ENGINE-TEST` | `tests/patch-engine.test.js` | `C3-007` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-PATTERN-MINER-TEST` | `tests/pattern-miner.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-PERF-ANALYZER-TEST` | `tests/perf-analyzer.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-PILOT-C1C2C3-TEST` | `tests/pilot-c1c2c3.test.js` | `C3-027` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-PROJECT-CONVERSATION-E2E-P5P7-TEST` | `tests/project-conversation-e2e-p5p7.test.js` | `C3-005` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-PROJECT-CONVERSATION-E2E-V2-TEST` | `tests/project-conversation-e2e-v2.test.js` | `C3-005` | T3 | `model` | 45 min | 60 min | network:loopback, temp-db, ollama, gpu | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-PROJECT-CONVERSATION-E2E-TEST` | `tests/project-conversation-e2e.test.js` | `C3-005` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-PROJECT-E2E-V131-TEST` | `tests/project-e2e-v131.test.js` | `C3-005` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-PROJECT-E2E-TEST` | `tests/project-e2e.test.js` | `C3-005` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-PROJECT-KB-DECOMPOSER-TEST` | `tests/project-kb-decomposer.test.js` | `C3-005` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-PROJECT-LIFECYCLE-CHANGE-MGMT-TEST` | `tests/project-lifecycle-change-mgmt.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-PROJECT-LIFECYCLE-ENTRY-TEST` | `tests/project-lifecycle-entry.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-PROJECT-LIFECYCLE-EXPERTISE-TEST` | `tests/project-lifecycle-expertise.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-PROJECT-LIFECYCLE-HAPPY-PATH-TEST` | `tests/project-lifecycle-happy-path.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-PROJECT-LIFECYCLE-INTERCEPT-TEST` | `tests/project-lifecycle-intercept.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-PROJECT-LIFECYCLE-INTERRUPTS-TEST` | `tests/project-lifecycle-interrupts.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-PROJECT-LIFECYCLE-KLICENKA-TEST` | `tests/project-lifecycle-klicenka.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-PROJECT-WELCOME-TEST` | `tests/project-welcome.test.js` | `C3-005` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-PROMPT-BUILDER-TEST` | `tests/prompt-builder.test.js` | `C3-016` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-PROPOSAL-STALE-CLEANUP-TEST` | `tests/proposal-stale-cleanup.test.js` | `C3-025` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-PUSH-CHANNEL-TEST` | `tests/push-channel.test.js` | `C3-021` | T3 | `model` | 5 min | 15 min | network:external | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-QG-IDEMPOTENCE-TEST` | `tests/qg-idempotence.test.js` | `C3-008` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-QUALITY-GATE-TEST` | `tests/quality-gate.test.js` | `C3-008` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-QUALITY-GATES-TEST` | `tests/quality-gates.test.js` | `C3-008` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-QUALITY-REPORT-TEST` | `tests/quality-report.test.js` | `C3-008` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-QUALITY-SCORE-TEST` | `tests/quality-score.test.js` | `C3-008` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-QUALITY-SPRINT-Q-TEST` | `tests/quality-sprint-q.test.js` | `C3-008` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-QUALITY-TELEMETRY-TEST` | `tests/quality-telemetry.test.js` | `C3-008` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-QUERY-EXPANDER-TEST` | `tests/query-expander.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-REFACTOR-AGENT-TEST` | `tests/refactor-agent.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-REGRESSION-PREDICTOR-TEST` | `tests/regression-predictor.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-REPOSITORY-HYGIENE-TEST` | `tests/repository-hygiene.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-RESPONSE-SCORER-TEST` | `tests/response-scorer.test.js` | `C3-008` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-RISK-ANALYZER-TEST` | `tests/risk-analyzer.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-ROUTES-SMOKE-TEST` | `tests/routes-smoke.test.js` | `C3-023` | T1 | `offline` | 30 s | 2 min | network:loopback | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-ROUTING-ACCURACY-TEST` | `tests/routing-accuracy.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-RSS-INTEGRATION-TEST` | `tests/rss-integration.test.js` | `C3-015` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-RUNTIME-FEEDBACK-TEST` | `tests/runtime-feedback.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SCENARIO-ENGINE-TEST` | `tests/scenario-engine.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SCHEDULER-TEST` | `tests/scheduler.test.js` | `C3-015` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SCHEMA-MIGRATIONS-TEST` | `tests/schema-migrations.test.js` | `C3-024` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SCOPE-LIMITER-TEST` | `tests/scope-limiter.test.js` | `C3-007` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SEARCH-QUALITY-A123-TEST` | `tests/search-quality-a123.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SECURITY-HARDENING-V126-TEST` | `tests/security-hardening-v126.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SECURITY-HARDENING-TEST` | `tests/security-hardening.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SELF-CRITIQUE-TEST` | `tests/self-critique.test.js` | `C3-008` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SEMANTIC-INDEX-TEST` | `tests/semantic-index.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SERVER-SHUTDOWN-TEST` | `tests/server-shutdown.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SESSION-CONTEXT-TEST` | `tests/session-context.test.js` | `C3-024` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SIGNATURE-CACHE-TEST` | `tests/signature-cache.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SIGNATURE-MAP-TEST` | `tests/signature-map.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SKILL-META-DETECTION-TEST` | `tests/skill-meta-detection.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-SKILL-ROUTING-CRE-TEST` | `tests/skill-routing-cre.test.js` | `C3-013` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-SMOKE-TEST` | `tests/smoke.test.js` | `C3-005` | T2 | `database` | 2 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T5-TESTS-SOAK-ATTACHMENT-HEAVY-TEST` | `tests/soak/attachment-heavy.test.js` | `C3-027` | T5 | `soak` | 30 min | 60 min | network:loopback, temp-db, ollama, gpu | yes | `ACTIVE` | — | primary implementer |
| `IS-T5-TESTS-SOAK-BREAK-PATTERN-PROBE-TEST` | `tests/soak/break-pattern-probe.test.js` | `C3-027` | T5 | `soak` | 30 min | 60 min | network:loopback, temp-db, ollama, gpu | yes | `ACTIVE` | — | primary implementer |
| `IS-T5-TESTS-SOAK-FOLLOWUP-LOAD-TEST` | `tests/soak/followup-load.test.js` | `C3-027` | T5 | `soak` | 30 min | 60 min | network:loopback, temp-db, ollama, gpu | yes | `ACTIVE` | — | primary implementer |
| `IS-T5-TESTS-SOAK-MIXED-SESSION-SIMULATION-TEST` | `tests/soak/mixed-session-simulation.test.js` | `C3-027` | T5 | `soak` | 30 min | 60 min | network:loopback, temp-db, ollama, gpu | yes | `ACTIVE` | — | primary implementer |
| `IS-T5-TESTS-SOAK-SHORT-INPUT-STRESS-TEST` | `tests/soak/short-input-stress.test.js` | `C3-027` | T5 | `soak` | 30 min | 60 min | network:loopback, temp-db, ollama, gpu | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SPECIALIST-BOUNDARY-RATCHET-TEST` | `tests/specialist-boundary-ratchet.test.js` | `C3-013` | T1 | `offline` | 1 s | 30 s | network:none, temp-db | yes | `ACTIVE` | — | WP-M3-L0-8-ENFORCEMENT |
| `IS-T1-TESTS-SPECIALIST-HANDLER-TEST` | `tests/specialist-handler.test.js` | `C3-013` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SPECIALIST-LOADER-TEST` | `tests/specialist-loader.test.js` | `C3-013` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SPECIALIST-REGISTRIES-TEST` | `tests/specialist-registries.test.js` | `C3-013` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SPECIALIST-RUNTIME-TEST` | `tests/specialist-runtime.test.js` | `C3-013` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-STORAGE-ARCHITECTURE-TEST` | `tests/storage-architecture.test.js` | `C3-024` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-STUDIO-CDP-EVIDENCE-TEST` | `tests/studio-cdp-evidence.test.js` | `C3-001` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T5-TESTS-STUDIO-ELECTRON-BOUNDARY-E2E` | `tests/studio-electron-boundary.e2e.js` | `C3-001` | T5 | `soak` | 2 min | 5 min | network:loopback, temp-db, toolchain:linux-user-network-namespace, toolchain:iproute2, toolchain:x11-display | yes | `ACTIVE` | c35e47bb48883e2ac88682a393d971e63e72db83 / studio-electron-boundary.json | primary implementer |
| `IS-T1-TESTS-STUDIO-ELECTRON-RUNNER-CONTRACT-TEST` | `tests/studio-electron-runner-contract.test.js` | `C3-001` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T5-TESTS-STUDIO-M1-ELECTRON-JOURNEY-E2E` | `tests/studio-m1-electron-journey.e2e.js` | `C3-001` | T5 | `soak` | 2 min | 5 min | network:loopback, temp-db, toolchain:linux-user-network-namespace, toolchain:iproute2, toolchain:x11-display | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SYMBOL-INDEX-TEST` | `tests/symbol-index.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-TASK-MEMORY-TEST` | `tests/task-memory.test.js` | `C3-016` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-TELEMETRY-AGGREGATION-VERSION-TEST` | `tests/telemetry-aggregation-version.test.js` | `C3-027` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-TELEMETRY-SOAK-TEST` | `tests/telemetry-soak.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-TELEMETRY-TEST` | `tests/telemetry.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-TEST-COVERAGE-EXPLORER-TEST` | `tests/test-coverage-explorer.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-TIMEOUT-DIAGNOSTIC-TEST` | `tests/timeout-diagnostic.test.js` | `C3-027` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-TIMEOUT-POLICY-TEST` | `tests/timeout-policy.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-TOOL-ADAPTER-TEST` | `tests/tool-adapter.test.js` | `C3-020` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-TOOL-ENFORCEMENT-TEST` | `tests/tool-enforcement.test.js` | `C3-020` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-TOOL-PIPELINE-E2E-TEST` | `tests/tool-pipeline-e2e.test.js` | `C3-020` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-TOOL-REGISTRY-E2E-TEST` | `tests/tool-registry-e2e.test.js` | `C3-020` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-TRUST-FEEDBACK-TEST` | `tests/trust-feedback.test.js` | `C3-021` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-ULTIMATE-E2E-TEST` | `tests/ultimate-e2e.test.js` | `C3-027` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-UPGRADE-APPLY-TEST` | `tests/upgrade-apply.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-UPGRADE-FLOW-TEST` | `tests/upgrade-flow.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-UPGRADE-UX-V125-TEST` | `tests/upgrade-ux-v125.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-V583-TIER1-TEST` | `tests/v583-tier1.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-VALIDATION-SUITES-TEST` | `tests/validation-suites.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-VRAM-COORDINATION-TEST` | `tests/vram-coordination.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-VRAM-MEASUREMENT-TEST` | `tests/vram-measurement.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-WHATLLM-CLIENT-TEST` | `tests/whatllm-client.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-WORKERS-PHASE-B-TEST` | `tests/workers-phase-b.test.js` | `C3-015` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-WORKFLOW-ORCHESTRATOR-TEST` | `tests/workflow-orchestrator.test.js` | `C3-027` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-WORKFLOW-TEST` | `tests/workflow.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-WS-BRIDGE-TEST` | `tests/ws-bridge.test.js` | `C3-023` | T1 | `offline` | 30 s | 2 min | network:loopback | yes | `ACTIVE` | — | primary implementer |

## Explicit support-module exclusions

Every supported program-language file below `tests/` must be either a suite
above or a reasoned exclusion below. File naming cannot hide it from the
ledger.

| Path | Reason |
|---|---|
| `tests/e2e-harness.js` | Imported legacy E2E harness library with no top-level test entry point. |
| `tests/e2e/_e2e-state.js` | Imported E2E state support module with no top-level test entry point. |
| `tests/e2e/_helpers.js` | Imported E2E harness support module; its direct checks live in _helpers.self-check.js. |
| `tests/e2e/_quality-evaluator.js` | Imported deterministic scoring library with no top-level test entry point. |
| `tests/e2e/_test-fixtures.js` | Imported synthetic fixture data module with no top-level test entry point. |
| `tests/fixtures/m2-project-context/project-a/src/auth/validateSessionToken.js` | Static source fixture consumed by the M2 project-context retrieval and consumer suites. |
| `tests/fixtures/m2-project-context/project-a/src/billing/calculateInvoiceTotal.js` | Static source fixture consumed by the M2 project-context retrieval quality oracle. |
| `tests/fixtures/m2-project-context/project-a/src/shared/sharedTieBreaker-alpha.js` | Static bytewise-order fixture consumed by the M2 project-context retrieval suite. |
| `tests/fixtures/m2-project-context/project-a/src/shared/sharedTieBreaker-beta.js` | Static bytewise-order fixture consumed by the M2 project-context retrieval suite. |
| `tests/fixtures/m2-project-context/project-b/src/canary-b.js` | Static cross-project containment canary consumed by the M2 project-context suites. |
| `tests/fixtures/studio-m1-electron-backend.js` | Suite-owned M1 Electron backend fixture launched only by studio-m1-electron-journey.e2e.js. |
| `tests/harness.js` | Imported unit-test harness library with no top-level test entry point. |
| `tests/helpers/isolated-test-db.js` | Imported direct-run database isolation bootstrap, not a standalone test. |
| `tests/run-all.js` | Aggregate compatibility entry point; registering it as a child suite would recurse into the registry runner. |

Required fields per run: exact command and commit, clean-tree status, start/end
time, isolated environment paths, stdout/stderr artifact and hash, exit code
or signal, timeout classification, cleanup result, and deterministic verdict.
