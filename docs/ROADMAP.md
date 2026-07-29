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

## Phase 3 — first coding worker, closure candidate

Status: complete through run 2F, pushed to `origin` for review, not merged and
not tagged.

Goal: run a real open-source coding worker while keeping lifecycle, permissions and verdict authority in Core.

Delivered:

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
- default tests and build stay deterministic and independent of external
  runtimes; strict network isolation and a cold-network install remain separate
  evidence questions.

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

## Phase 3 integration record

Entry gate (satisfied): Phase 2 is merged into `main` (`ec87dd0`, PR #2), the
annotated `phase-2` tag exists, and CI for that merge completed successfully
(workflow run `30337726989`).

### Runs

| Run | Subject |
|---|---|
| 2A | fail-closed OpenCode configuration, evidence-bounded protocol retries, Git-backed evidence required for code verdicts, permission-pending lifecycle cleanup |
| 2B | executable authority stack, run-scoped approval decision surface, structured lifecycle and protocol evidence, trusted verdict provenance |
| 2C | pinned real `opencode-ai@1.18.8` with real local `qwen3:14b` on an RTX 3090: approved edit plus four terminal paths |
| 2D | authenticated remote access for a single operator over a private VPN (ADR 0020) |
| 2E | security closure audit, ADR 0020, process-level refusal proof, acceptance matrix |
| 2F | restart recovery on the OpenCode composition, focused real-binary regression, wording corrections, closure documents and gates |

Runs 2A-2F are complete. The requirement-level audit against this specification
is `docs/testing/phase-3-acceptance-matrix.md`, and the closure evidence is
`docs/testing/phase-3-results.md` with `artifacts/phase-3-verification.json`.

### Phase 3 closure work, and what closed it

1. **Restart recovery on the OpenCode composition** — closed by
   `apps/server/src/opencode/restart-recovery.process.test.ts`, which SIGKILLs a
   real Core running the production composition at a pending approval and proves
   the next Core reconciles everything it left behind and can do useful work.
   No production defect was found and no production code changed.
2. **Five identical deterministic full-suite runs** — recorded in the results
   document.
3. **Clean-clone `pnpm verify`** — recorded in the results document.
4. **`docs/testing/phase-3-results.md` and `artifacts/phase-3-verification.json`**
   — produced, in the shape every previous phase produced.
5. **README "Current State"** — updated.
6. **CI status** — the entry gate's run is recorded and green. The closure
   candidate itself has no CI run: the workflow triggers only on pull requests
   and pushes to `main`, so pushing the branch triggered nothing. That is
   recorded as NOT PROVEN with its reason rather than implied to be green.
7. **Two wording corrections** — made in `docs/test-matrix-phase-1-to-4.md`.
   Neither promoted a verdict: the rows stay PARTIAL because what changed was
   the specification's accuracy, not the evidence behind it.

Phase 3 is a **closure candidate**, published for review. It is not merged and
not tagged; independent review comes before integration.

## Phase 3B - Tool Capability Mediation

Inserted between H and I after the H checkpoint proved that an inference-only
OpenCode integration is not a finished Phase 3, and that closing Phase 3 there
would have moved the problem silently into Phase 4.

Gate: a contract spike against the pinned real binary, run before any
implementation. Verdict PASS, conditional on an IntentSmith-generated permission
config (`docs/testing/phase-3b-tool-mediation-spike.md`).

Delivered:

- capability and lifecycle ledger for every observed tool;
- bounded tool-calling gateway path that translates and never executes;
- single-use, payload-bound approvals with append-only audit;
- vendor-neutral permission bridge that cannot grant standing access;
- git-backed change capture, and a verdict that refuses a success it cannot
  corroborate;
- Core-owned model profiles and single-GPU residency scheduling.

ADRs 0017, 0018, 0019. Evidence in `artifacts/phase-3b-verification.json`.

## Phase 3 run 2D - Remote Operator Access

Delivered: the main API can be bound to a private VPN interface behind one
operator bearer token, supplied at runtime. The loopback default is unchanged
and requires no configuration and no credential.

Remote mode is an explicit opt-in that fails closed before anything is opened: a
non-loopback bind without the opt-in, the opt-in without a credential, a weak
credential, a credential nothing would enforce, an unsupported opt-in value, a
wildcard bind and a hostname are all startup errors. Authentication is one
`onRequest` hook registered before any route, so no route can forget to ask, and
in remote mode nothing is public. The worker inference gateway stays
loopback-only with its own per-run tokens.

Transport confidentiality is entirely the VPN's; IntentSmith terminates no TLS,
and direct public-internet exposure is unsupported. Accepted alpha limits:
rotation is a restart, no accounts, no roles, no rate limiting.

ADR 0020. Documented in `docs/security/remote-vpn-access.md`.

## Post-Phase-3 - Local Validation and Soak Testing

A validation stage, not a development phase. It runs **after** Phase 3 is closed
and **before** Phase 3.1 begins. Nothing in it is implemented yet, and this
section is a specification only.

Its purpose is to find out what a week of real use does to a system that has so
far been proven one scenario at a time. Phase 3 proved that each guarantee holds
once. This stage asks whether they hold repeatedly, overnight, and under a real
model's variability.

Environment, pinned:

- real `opencode-ai@1.18.8`, installed outside this repository, version-checked
  before every session;
- local Ollama serving `qwen3:14b` on the RTX 3090;
- disposable managed workspaces, created and destroyed per run, never a real
  project;
- an isolated `HOME` and `XDG_*` per run, so nothing inherits or leaves behind
  developer state.

Method:

- an overnight runner with checkpoint and resume, so an interrupted night is
  resumable evidence rather than a discarded one;
- **deterministic gates** (exit codes, schema-valid artifacts, invariant checks)
  evaluated separately from **behavioural evidence** (what the model and the
  agent actually did), because the second is not reproducible and must never be
  scored as though it were;
- every scenario classified **PASS**, **FAIL** or **BLOCKED**, with BLOCKED
  reserved for a missing precondition and never used to hide a failure;
- comparison against a recorded baseline, so a regression is a difference rather
  than an opinion;
- machine-readable artifacts as the primary output, with prose derived from them
  and never the other way round.

Leak checks, run after every session:

- **resources** — file descriptors, sockets, temporary directories, disk;
- **processes** — no orphan in any run's process group, no surviving child;
- **tokens** — no gateway or operator credential in any artifact, log, audit
  record, database row or error message;
- **approvals** — no grant outliving its run, no standing permission, no waiter
  left suspended.

Constraints:

- the runner **never changes production code automatically**. It reports; a
  human decides;
- **no claim of strict-offline operation** unless network activity is actually
  observed and the observation is part of the artifact. "No cloud traffic seen"
  is not "cloud traffic impossible", and the distinction has already been
  recorded once in Phase 3B.

Carried into this stage from Phase 3: strict-offline behaviour, sandboxed
(`preferSandbox`) execution, degraded-sandbox runs, real-hardware single-GPU
model switching, and model default selection.

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

The evaluation harness will be designed from the staged research recorded in
[Local model evaluation strategy](testing/local-model-evaluation-strategy.md):
transport eligibility first, varied tool-selection and repair scenarios second,
long finalist coding runs and GPU switching evidence after that, followed by
carefully weighted empirical outcomes. This records direction, not final
weights, thresholds or model assignments; those require an ADR.

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
