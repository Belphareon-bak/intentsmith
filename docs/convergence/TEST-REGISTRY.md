# IntentSmith Test Registry

This is the canonical rendered ledger for `tests/registry.json`.
It is generated deterministically; edit the JSON manifest and run
`node scripts/validate-test-registry.js --write-doc`.

A suite verdict is derived from child exit status, signal, timeout, required
evidence, and cleanup. Printed assertion totals are metrics only and cannot
override a failed or blocked suite.

## Inventory

- Runnable programs: 263
- Profiles: offline=171, database=22, server=7, model=44, soak=5, manual=14
- States: ACTIVE=249, HISTORICAL=14

## Execution profiles

| Profile | Scope | Default prerequisites |
|---|---|---|
| `offline` | tests declared deterministic and network-independent | isolated HOME/temp; strict OS egress proof is a separate gate |
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
| `IS-T1-TESTS-CAPABILITY-ENFORCER-TEST` | `tests/capability-enforcer.test.js` | `C3-020` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CAPABILITY-REGISTRY-TEST` | `tests/capability-registry.test.js` | `C3-020` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CAPABILITY-SANDBOX-TEST` | `tests/capability-sandbox.test.js` | `C3-020` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CHAT-EXPORT-BUDGET-TEST` | `tests/chat-export-budget.test.js` | `C3-003` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CHAT-FIXES-TEST` | `tests/chat-fixes.test.js` | `C3-003` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CHAT-OUTPUT-QUALITY-TEST` | `tests/chat-output-quality.test.js` | `C3-003` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CHAT-PERSISTENCE-TEST` | `tests/chat-persistence.test.js` | `C3-003` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-CHAT-PIPELINE-TEST` | `tests/chat-pipeline.test.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-CHAT-QUALITY-TEST` | `tests/chat-quality.test.js` | `C3-003` | T3 | `model` | 10 min | 15 min | network:external, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CHAT-SEARCH-QUALITY-TEST` | `tests/chat-search-quality.test.js` | `C3-003` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CHAT-SYNTHESIS-HARDENING-TEST` | `tests/chat-synthesis-hardening.test.js` | `C3-003` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CHUNKER-TEST` | `tests/chunker.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CIRCUIT-BREAKER-V55-TEST` | `tests/circuit-breaker-v55.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CODE-ANALYZER-TEST` | `tests/code-analyzer.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CODE-EVOLUTION-TEST` | `tests/code-evolution.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CODE-SEARCH-TEST` | `tests/code-search.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-CONCEPT-REGISTRY-TEST` | `tests/concept-registry.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
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
| `IS-T1-TESTS-DOMAINS-TEST` | `tests/domains.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-DRIFT-DETECTOR-TEST` | `tests/drift-detector.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-E2E-COMPLEX-TEST` | `tests/e2e-complex.test.js` | `C3-027` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-E2E-NOTIFICATIONS-TEST` | `tests/e2e-notifications.test.js` | `C3-027` | T3 | `model` | 5 min | 15 min | network:external | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-E2E-PIPELINE-TEST` | `tests/e2e-pipeline.test.js` | `C3-027` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-E2E-RESILIENCE-TEST` | `tests/e2e-resilience.test.js` | `C3-027` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-E2E-SPECIALISTS-TEST` | `tests/e2e-specialists.test.js` | `C3-027` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-E2E-WORKERS-TEST` | `tests/e2e-workers.test.js` | `C3-027` | T3 | `model` | 5 min | 15 min | network:external, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-ERROR-NORMALIZER-TEST` | `tests/error-normalizer.test.js` | `C3-007` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-EXECUTION-GRAPH-TEST` | `tests/execution-graph.test.js` | `C3-007` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-EXECUTION-LOOP-TEST` | `tests/execution-loop.test.js` | `C3-007` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-EXECUTION-TRACE-STRESS-TEST` | `tests/execution-trace-stress.test.js` | `C3-007` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-EXECUTOR-CAPABILITIES-TEST` | `tests/executor-capabilities.test.js` | `C3-020` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-EXPERTISE-AB-QUALITY-TEST` | `tests/expertise-ab-quality.test.js` | `C3-011` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
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
| `IS-T1-TESTS-EXPORT-PDF-DOCX-TEST` | `tests/export-pdf-docx.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-FILE-DISCOVERY-TEST` | `tests/file-discovery.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-FILE-WRITE-EXTRACT-TEST` | `tests/file-write-extract.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-FIX-STRATEGY-TEST` | `tests/fix-strategy.test.js` | `C3-007` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-FIXES-V582-TEST` | `tests/fixes-v582.test.js` | `C3-027` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-GOVERNOR-TEST` | `tests/governor.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-GRAPH-QUERY-TEST` | `tests/graph-query.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-GRAPH-RETRIEVAL-TEST` | `tests/graph-retrieval.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-GRAPH-SYNC-TEST` | `tests/graph-sync.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-HARNESS-EXIT-CODE-TEST` | `tests/harness-exit-code.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
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
| `IS-T3-TESTS-LLM-INTEGRATION-2-TEST` | `tests/llm-integration-2.test.js` | `C3-027` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-LLM-INTEGRATION-TEST` | `tests/llm-integration.test.js` | `C3-027` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-LOCAL-MATH-NONFINITE-TEST` | `tests/local-math-nonfinite.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MANIFEST-V2-TEST` | `tests/manifest-v2.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MARKETPLACE-CATALOG-V125-TEST` | `tests/marketplace-catalog-v125.test.js` | `C3-022` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MARKETPLACE-TEST` | `tests/marketplace.test.js` | `C3-022` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MERGE-COMPATIBILITY-TEST` | `tests/merge-compatibility.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MERGE-ENFORCEMENT-INTEGRATION-TEST` | `tests/merge-enforcement-integration.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MERGE-ENGINE-TEST` | `tests/merge-engine.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MILESTONE-SIZE-TEST` | `tests/milestone-size.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MODEL-CTX-TEST` | `tests/model-ctx.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MODEL-SIMILARITY-TEST` | `tests/model-similarity.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MODEL-UNIVERSE-STORE-TEST` | `tests/model-universe-store.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MODEL-UPGRADE-PHASE2-TEST` | `tests/model-upgrade-phase2.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MODEL-UPGRADE-PHASE3-TEST` | `tests/model-upgrade-phase3.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MODEL-UPGRADE-TEST` | `tests/model-upgrade.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MODULES-TEST` | `tests/modules.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MULTI-AGENT-TEST` | `tests/multi-agent.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MULTI-SOURCE-INTEGRATION-TEST` | `tests/multi-source-integration.test.js` | `C3-015` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-MULTIMEDIA-TEST` | `tests/multimedia.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-NIGHTLY-AUDIT-RUNNER-SELF-TEST` | `tests/nightly-audit-runner-self-test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST` | `tests/nightly-orchestrator-self-test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-NOTIFICATIONS-TEST` | `tests/notifications.test.js` | `C3-021` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-ONLINE-DISCOVERY-TEST` | `tests/online-discovery.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-OUTPUT-GATE` | `tests/output-gate.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-PATCH-ENGINE-TEST` | `tests/patch-engine.test.js` | `C3-007` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-PATTERN-MINER-TEST` | `tests/pattern-miner.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-PERF-ANALYZER-TEST` | `tests/perf-analyzer.test.js` | `C3-018` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-PILOT-C1C2C3-TEST` | `tests/pilot-c1c2c3.test.js` | `C3-027` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-PROJECT-CONVERSATION-E2E-P5P7-TEST` | `tests/project-conversation-e2e-p5p7.test.js` | `C3-005` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-PROJECT-CONVERSATION-E2E-TEST` | `tests/project-conversation-e2e.test.js` | `C3-005` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-PROJECT-E2E-V131-TEST` | `tests/project-e2e-v131.test.js` | `C3-005` | T3 | `model` | 10 min | 15 min | network:loopback, temp-db, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-PROJECT-E2E-TEST` | `tests/project-e2e.test.js` | `C3-005` | T3 | `server` | 2 min | 15 min | network:loopback, temp-db, server, ollama, gpu | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-PROJECT-KB-DECOMPOSER-TEST` | `tests/project-kb-decomposer.test.js` | `C3-005` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-PROJECT-LIFECYCLE-CHANGE-MGMT-TEST` | `tests/project-lifecycle-change-mgmt.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-PROJECT-LIFECYCLE-EXPERTISE-TEST` | `tests/project-lifecycle-expertise.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-PROJECT-LIFECYCLE-HAPPY-PATH-TEST` | `tests/project-lifecycle-happy-path.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-PROJECT-LIFECYCLE-INTERCEPT-TEST` | `tests/project-lifecycle-intercept.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-PROJECT-LIFECYCLE-INTERRUPTS-TEST` | `tests/project-lifecycle-interrupts.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T2-TESTS-PROJECT-LIFECYCLE-KLICENKA-TEST` | `tests/project-lifecycle-klicenka.test.js` | `C3-005` | T2 | `database` | 1 min | 5 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-PROJECT-WELCOME-TEST` | `tests/project-welcome.test.js` | `C3-005` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-PROMPT-BUILDER-TEST` | `tests/prompt-builder.test.js` | `C3-016` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
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
| `IS-T1-TESTS-ROUTES-SMOKE-TEST` | `tests/routes-smoke.test.js` | `C3-023` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
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
| `IS-T5-TESTS-SOAK-ATTACHMENT-HEAVY-TEST` | `tests/soak/attachment-heavy.test.js` | `C3-027` | T5 | `soak` | 30 min | 60 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T5-TESTS-SOAK-BREAK-PATTERN-PROBE-TEST` | `tests/soak/break-pattern-probe.test.js` | `C3-027` | T5 | `soak` | 30 min | 60 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T5-TESTS-SOAK-FOLLOWUP-LOAD-TEST` | `tests/soak/followup-load.test.js` | `C3-027` | T5 | `soak` | 30 min | 60 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T5-TESTS-SOAK-MIXED-SESSION-SIMULATION-TEST` | `tests/soak/mixed-session-simulation.test.js` | `C3-027` | T5 | `soak` | 30 min | 60 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T5-TESTS-SOAK-SHORT-INPUT-STRESS-TEST` | `tests/soak/short-input-stress.test.js` | `C3-027` | T5 | `soak` | 30 min | 60 min | network:none, temp-db | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SPECIALIST-HANDLER-TEST` | `tests/specialist-handler.test.js` | `C3-013` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SPECIALIST-LOADER-TEST` | `tests/specialist-loader.test.js` | `C3-013` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SPECIALIST-REGISTRIES-TEST` | `tests/specialist-registries.test.js` | `C3-013` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-SPECIALIST-RUNTIME-TEST` | `tests/specialist-runtime.test.js` | `C3-013` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-STORAGE-ARCHITECTURE-TEST` | `tests/storage-architecture.test.js` | `C3-024` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
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
| `IS-T1-TESTS-WHATLLM-CLIENT-TEST` | `tests/whatllm-client.test.js` | `C3-025` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-WORKERS-PHASE-B-TEST` | `tests/workers-phase-b.test.js` | `C3-015` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T3-TESTS-WORKFLOW-ORCHESTRATOR-TEST` | `tests/workflow-orchestrator.test.js` | `C3-027` | T3 | `model` | 10 min | 15 min | network:loopback, ollama | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-WORKFLOW-TEST` | `tests/workflow.test.js` | `C3-027` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |
| `IS-T1-TESTS-WS-BRIDGE-TEST` | `tests/ws-bridge.test.js` | `C3-023` | T1 | `offline` | 30 s | 2 min | network:none | yes | `ACTIVE` | — | primary implementer |

Required fields per run: exact command and commit, clean-tree status, start/end
time, isolated environment paths, stdout/stderr artifact and hash, exit code
or signal, timeout classification, cleanup result, and deterministic verdict.
