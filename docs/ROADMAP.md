# Roadmap

The roadmap is ordered by product dependency, not calendar promises. A phase closes only when its stated evidence and safety gates pass on a clean clone.

## Phase 0 — foundation ✅

Goal: establish the product boundary before implementation.

- Define local-first policy and component ownership.
- Research reusable open-source components and protocols.
- Record core architecture decisions.
- Define the monorepo and dependency boundaries.

Exit evidence: ADRs, component research and a reviewable implementation plan.

## Phase 1 — deterministic core ✅

Goal: build an offline, deterministic control plane without a real model or external agent.

- Runtime contracts and lifecycle.
- Separate tasks and task runs.
- SQLite persistence, audit and migrations.
- Fake worker with success, failure, pause, resume, cancel and invalid-event scenarios.
- Localhost API and CLI.
- Evidence-based verdict.

Exit evidence: 54 tests and all quality gates passing.

## Phase 1.1 — contract stabilization ✅

Goal: prove that the Phase 1 guarantees survive concurrency, malformed adapters and restart boundaries.

- Shared worker and provider contract suites.
- Transaction serialization and per-store context isolation.
- Conservative interrupted-run recovery.
- Virtual-time timeout tests.
- Boundary enforcement and clean-tree verification.
- Remediation of all audit findings.

Exit evidence: 202 tests, coverage gates and clean-clone verification.

## Phase 2 — local inference ✅

Goal: provide a useful local model path without weakening Core.

- Sanitized hardware discovery.
- Hardware/model fit policy and explicit `MODEL_TOO_LARGE`.
- Ollama provider adapter.
- Timeout, cancellation and single-GPU semaphore.
- Optional real-Ollama verification.
- Scoped loopback worker gateway, off by default.

Exit evidence: `phase-2` tag, 410 tests, real-Ollama evidence and unchanged quality thresholds.

## Phase 3 — first coding worker 🚧

Goal: run a real open-source coding worker while keeping lifecycle, permissions and verdict authority in Core.

Planned deliverables:

- shared worker SDK and unchanged behavioural contract suite;
- supervised, no-shell external processes;
- official ACP SDK with explicit initialization and hard protocol-version negotiation;
- real `opencode-ai` capability/configuration and network-behaviour probe;
- generated forced-local configuration that selects only the IntentSmith gateway provider/model;
- truthful capability and sandbox reporting;
- run-scoped gateway tokens, redaction and revocation;
- persisted approval requests, decisions and expiry;
- git-backed `ProposedChangeSet`;
- deterministic gate execution;
- cancellation, timeout, failure and restart recovery;
- API and CLI surface;
- opt-in real-OpenCode integration suite.

Exit gates:

- one terminal outcome per run;
- no adapter writes Core state or persistence;
- no token survives a terminal path;
- unsupported capability is rejected, never simulated;
- an unconfigured cloud model can never be selected for an IntentSmith run;
- unavoidable provider-catalog traffic is either disabled or explicitly disclosed and policy-gated;
- degraded isolation is clearly blocked or explicitly limited to disposable fixtures;
- a real worker produces an inspectable change set and deterministic verdict;
- default verification stays offline and deterministic.

## Phase 4 — context and code intelligence

Goal: give workers useful project context without turning context services into authorities.

- MCP client boundary and protocol validation.
- Serena adapter for code navigation and semantic tooling.
- capability discovery and least-authority tool exposure;
- bounded context budgets and cancellation;
- audit metadata without persisting sensitive payloads;
- contract and opt-in real-integration suites.

Exit gates:

- no MCP server can change Core lifecycle directly;
- every tool call is attributed to a task run and policy decision;
- context failure degrades clearly and cannot create a pass;
- external tools remain replaceable adapters.

## Cross-cutting track — C3 semantic inheritance

Goal: retain the mature product model proven across C3's long development
history without importing its monolithic implementation or weakening
IntentSmith Core.

The normative intake and progress record is the
[C3 Capability & Lifecycle Ledger](migration/c3-capability-lifecycle-ledger.md).
Roadmap work derived from C3 is not ready until its ledger entry identifies the
source evidence, invariants, test families, ownership and migration decision.

This track begins before Phase 4 and supplies contracts to later phases:

1. **Semantic ledger** — inventory definitions, invariants, tests, failure modes
   and version history for Expertises, Skills, Specialists, Autonomous Agents
   and project lifecycle.
2. **Contract ADRs** — freeze boundaries and resolve naming/ownership
   ambiguities before writing runtime code.
3. **Expertise contracts** — read-only synthesis profiles, deterministic
   selection, 5D compatibility, inheritance and max-three composition.
4. **Skill contracts** — versioned workflow definitions, persisted execution
   state, interactive checkpoints and validation outcomes.
5. **Specialist contracts** — self-contained manifests, capability routing,
   deterministic ToolAdapters, knowledge provenance, scenarios, memory,
   telemetry, dependency ordering and rollback-ready updates.
6. **Autonomous-agent contracts** — schedules, sources, deterministic
   conditions, edge triggers, cooldowns, crash-safe deduplication and
   Core-governed actions.
7. **Lifecycle extraction** — preserve specification, planning, milestone
   scope, deterministic gates, checkpoint modes, bounded repair, drift review,
   change management and recovery as policies over `Task`/`TaskRun`.

Exit gates:

- no layer is collapsed into another for implementation convenience;
- every migrated invariant has a contract or negative test;
- C3 code is not copied wholesale;
- Core remains the only authority for state, approvals and verdicts;
- legacy behaviour is classified as preserve, redesign, replace with open
  source, or retire, with recorded evidence.

## Phase 5 — multi-worker orchestration and hardening

Goal: support more than one worker without creating implicit or unreviewable authority.

- OpenHands feasibility/adapter work.
- explicit routing policy based on capability, hardware and task type;
- retry and multi-run orchestration;
- approval escalation and expiry;
- stronger platform-specific isolation profiles;
- resource budgets and backpressure;
- multi-process design decision before Studio needs a second writer.

## Phase 6 — domain intelligence, evaluation and observability

Goal: make successful workflows reusable and measurable.

- versioned IntentSmith Expertises and deterministic composition;
- controlled IntentSmith Skills with checkpoints;
- self-contained IntentSmith Specialists;
- governed IntentSmith Autonomous Agents;
- local evaluation corpus and regression harness;
- structured performance and quality evidence;
- privacy-preserving local diagnostics;
- explicit project memory with retention and deletion controls.

## Phase 7 — IntentSmith Studio

Goal: provide a visual Theia-based experience over the same Core APIs.

- project and task views;
- plan, approval and change-set review;
- run timeline and gate evidence;
- local model and hardware settings;
- worker/skill management;
- no privileged Studio-only lifecycle path.

## Phase 8 — IntentSmith Forge Local

Goal: package the complete local product for developers who do not want to assemble the monorepo.

- desktop installer and updates;
- guided hardware/model setup;
- local service lifecycle;
- diagnostics, backup and export;
- signed artifacts and dependency provenance;
- clear offline and optional-network modes.

## Cross-phase rules

Every phase must:

- keep stable contracts runtime-validated;
- preserve deterministic offline tests;
- avoid silent cloud fallback;
- keep vendor shapes out of Core;
- add or update threat models for new trust boundaries;
- record architectural decisions before they become expensive to reverse;
- publish exact evidence and known limitations;
- avoid lowering quality gates to make a phase pass.
