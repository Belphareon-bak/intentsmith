# C3 Capability & Lifecycle Ledger

## Purpose

This ledger prevents IntentSmith from losing mature product semantics developed
and tested in C3. It is the mandatory intake for C3-derived work: a capability
cannot be silently copied, collapsed into another concept or omitted without a
recorded decision.

IntentSmith remains a greenfield implementation. The objective is to preserve
valuable behaviour, invariants, tests and failure lessons, not to transplant
C3's monolith.

## Fixed source baseline

| Field | Value |
| --- | --- |
| Repository | `Belphareon-bak/C3-agent` |
| Reference commit | `a7b90e36aa80310305703f54f2332e1c0e7f9e8f` |
| Declared version | 135.0.0 |
| Declared scale | 380+ modules, 294 test suites, 137,000+ lines |
| Inspection date | 2026-07-28 |

Normative C3 inputs include `README.md`, `docs/EXPERTISES.md`,
`docs/SPECIALISTS.md`, `docs/SPECIALIST-LIFECYCLE.md`,
`docs/skills-v1.md`, `docs/WORKERS.md`, `docs/PROJECT-SYSTEM.md`,
`docs/AUTHORITY.md`, `docs/MEMORY.md`, `docs/ARCHITECTURE.md` and the tool
executor/registry contracts.

The commit is immutable. Later C3 findings require a new baseline entry instead
of silently changing this ledger's evidence.

## Decision vocabulary

| Decision | Meaning |
| --- | --- |
| **Preserve** | Keep the product semantics and invariants |
| **Redesign** | Keep the capability, but implement it over IntentSmith contracts |
| **OSS** | Replace custom infrastructure with a bounded open-source component |
| **Retire** | Deliberately omit after documenting why and what replaces it |
| **Research** | Evidence is incomplete or contradictory; no implementation yet |

Most valuable C3 systems require both **Preserve** and **Redesign**: preserve
behaviour, redesign ownership and implementation.

## Capability ledger

| ID | C3 capability | Decision | IntentSmith destination | Priority |
| --- | --- | --- | --- | --- |
| C3-001 | CRE single-authority intent routing and guards | Preserve + Redesign | Core intent/policy decision contract | P0 contract |
| C3-002 | Project lifecycle: spec, planning, build, review, change | Preserve + Redesign | Project workflow over `Task`/`TaskRun` | P0 contract |
| C3-003 | Milestone scope, checkpoints, retry and blocked state | Preserve + Redesign | Core orchestration and evidence gates | P0 contract |
| C3-004 | Execution repair loop and normalized failures | Preserve + Redesign | Worker/gate repair policy | P0/P1 |
| C3-005 | Expertises and 5D composition | Preserve + Redesign | Expertise contracts and pure composer | P0 contract, P1 runtime |
| C3-006 | Controlled Skills with checkpoints | Preserve + Redesign | Skill definitions and SkillRun orchestration | P0 contract, P1 runtime |
| C3-007 | Self-contained Specialists | Preserve + Redesign | Specialist SDK, loader and registries | P0 contract, P1 runtime |
| C3-008 | Specialist ToolAdapter lifecycle | Preserve | Typed deterministic tool contract | P0 contract |
| C3-009 | Specialist knowledge, scenarios, memory and telemetry | Preserve + Redesign | Scoped specialist services | P1 |
| C3-010 | Autonomous Agents and scheduler | Preserve + Redesign | Agent definitions/runs creating governed tasks | P0 contract, P2 runtime |
| C3-011 | HUNTER crash-safe deduplication | Preserve | Autonomous-agent persistence invariant | P1 |
| C3-012 | Tool registry, risk metadata and circuit breaker | Preserve + Redesign | Capability/tool registry and approval policy | P0 |
| C3-013 | Quality Gate v2 and deterministic output checks | Preserve + Redesign | Gate framework and output policy | P1 |
| C3-014 | Code intelligence and project graph | Preserve outcomes + OSS | MCP/Serena plus IntentSmith evidence adapter | Phase 4 |
| C3-015 | LTM, task memory and cross-project learning | Preserve selectively + Redesign | Explicit local memory with retention policy | P1/P2 |
| C3-016 | Context budgeting and incremental context | Preserve + Redesign | Context Director with hard caps | P1 |
| C3-017 | Quality score, telemetry and regression signals | Preserve + Redesign | Local evaluation/observability | P1/P2 |
| C3-018 | Architecture governance, drift and impact analysis | Preserve + OSS | Core policy plus Serena/MCP evidence | P1/Phase 4 |
| C3-019 | Model roles and upgrade/evaluation system | Preserve policy + Redesign | Hardware Director and model catalog/evals | P2 |
| C3-020 | Marketplace and transactional package lifecycle | Preserve safety + Redesign | Local-first package registry | P2/P3 |
| C3-021 | Studio IDE | Preserve UX lessons + OSS | Theia-based IntentSmith Studio | Phase 7 |
| C3-022 | Notifications and trust feedback | Preserve selectively | Autonomous-agent delivery adapters | P2 |
| C3-023 | Setup, diagnostics and desktop packaging | Preserve outcomes + OSS | IntentSmith Forge Local | Phase 8 |
| C3-024 | Legacy monolithic module coupling | Retire | Replaced by enforced package boundaries | Immediate |
| C3-025 | Direct runtime mutation outside public registries | Retire | Replaced by Core ports and capability grants | Immediate |

Priority describes when contracts must be understood, not when every UI or
runtime must ship.

## Preserved lifecycle contracts

### Project lifecycle

```text
SPEC → SPEC_REVIEW → PLANNING → PLAN_REVIEW
     → BUILD → PROJECT_REVIEW → COMPLETED
```

Additional paths: revision, pause, failure, blocked, change management and
recovery.

Invariants to preserve:

- specifications contain measurable goals, requirements and acceptance tests;
- architecture decisions retain rationale and considered alternatives;
- roadmap revisions create versions rather than rewriting history;
- completed milestones are immutable;
- milestone dependencies are acyclic and scope is bounded;
- local plan approval precedes execution;
- deterministic compile/test gates precede model review;
- checkpoint mode is explicit: structural, functional or security;
- repair attempts are bounded and reuse previous findings;
- exhausted repair moves to a user-visible blocked decision;
- actual diffs are checked against declared scope;
- project reviews record alignment, scope creep, architecture drift and debt;
- commits/tags happen only after passing evidence.

IntentSmith mapping:

- `Project` owns the long-lived product context;
- a workflow definition owns phase policy;
- `Task` stores an approved unit of intent;
- each execution attempt is a `TaskRun`;
- milestones and reviews become immutable workflow/evidence records;
- Core remains the only lifecycle and verdict authority.

### Skill lifecycle

```text
IDLE → CONFIRMING → EXECUTING → DONE
          │             ├──→ AWAITING_INPUT ──→ EXECUTING
          └──→ CANCELLED └──→ FAILED
```

Invariants:

- definitions are versioned;
- parameters and success criteria validate before execution;
- confirmation occurs before capability-bearing steps;
- `ask` and `review` persist state before returning control;
- resume consumes input exactly once and continues from the valid next step;
- only declared transient failures retry;
- validation and security failures do not retry optimistically;
- step outputs remain attributable and bounded.

### Specialist package lifecycle

```text
ABSENT → INSTALLED → ENABLED ↔ DISABLED
                         └──→ UPDATING
```

Invariants:

- manifest-driven discovery and engine compatibility;
- install, enable and disable are idempotent;
- dependencies enable in deterministic topological order;
- disable unregisters runtime capabilities but preserves data;
- updates are refused while the specialist is busy;
- reversible migrations provide `down()` and roll back in reverse order;
- the stored version changes only after successful re-enable;
- failed cleanup is followed by defensive registry cleanup;
- plugins import neither Core internals nor another plugin's private modules.

### Specialist tool lifecycle

```text
match → validate → normalize → execute → validateResult
```

Outcomes remain explicit: `ok`, `clarify`, `error`, with warnings and structured
data. Deterministic claims must originate in tools/knowledge, not be invented by
the model formatting the result.

### Autonomous-agent lifecycle

```text
schedule → fetch → filter seen → merge/dedupe
         → conditions → edge trigger → mark seen
         → governed actions → persist run
```

Invariants:

- condition and edge decisions are deterministic;
- `mark_seen` occurs transactionally before non-idempotent business actions;
- first run establishes an explicit baseline;
- cooldown and maximum-fire limits are persisted;
- partial source failure does not silently corrupt merged state;
- severe schema degradation disables the agent visibly;
- only declared retriable delivery actions retry;
- every side effect passes through Core capability/approval policy.

### Task worker lifecycle

IntentSmith's `Task`/`TaskRun` lifecycle remains distinct from all preceding
lifecycles. OpenCode/OpenHands Workers execute one run and emit evidence. They
are not Specialists, Skills or scheduled Autonomous Agents.

## Open-source substitution ledger

| C3-owned implementation | IntentSmith approach | What must still be preserved |
| --- | --- | --- |
| Ollama gateway | Ollama adapter | Local-only policy, cancellation, redaction and hardware fit |
| Custom coding execution | OpenCode/OpenHands adapters through ACP | Core authority, bounded capabilities and evidence |
| Custom code search/intelligence | Serena through MCP, supplemented only where needed | Attribution, cancellation, drift/impact evidence |
| Custom IDE | Eclipse Theia | Workflow, specialist focus and evidence-review UX |
| Custom protocol plumbing | Official stable SDKs where lifecycle-complete | Strict validation and explicit version negotiation |
| Custom package/runtime infrastructure | Existing package formats where safe, IntentSmith manifests otherwise | Transactional install/update, provenance and rollback |

Open source replaces infrastructure, not IntentSmith product semantics.

## Test-harvesting ledger

The migration unit is a guarantee plus its negative/recovery tests, not a source
file.

| Test family | Required extraction |
| --- | --- |
| Lifecycle | Every valid/invalid transition, pause/resume, retry exhaustion, recovery and immutable evidence |
| Expertise | Selection priority, 5D conflicts, inheritance, deterministic merge, non-trimmable constraints and drift |
| Skill | Confirmation, persistence, multiple checkpoints, resume-once, cancellation and failure classification |
| Specialist | Manifest rejection, dependency cycles, idempotence, busy update, migration rollback and cleanup |
| Tools | Parameter validation, risk classification, deterministic outputs, circuit breaker and approval |
| Agents | Baseline, deduplication, edge triggers, cooldown, source degradation, crash points and delivery retry |
| Memory | Decay, reinforcement, attribution, retention, deletion and cross-project isolation |
| Quality | Structural/language/intent/content failures, evidence provenance and no optimistic pass |
| Model evaluation | Tool-transport eligibility, varied formulations, distribution and tail-risk reporting, long project outcomes, GPU switching and empirical runtime evidence |

For every family, the ledger must link the exact C3 tests before the IntentSmith
implementation task can be marked ready.

The model-evaluation family is further scoped in
[Local model evaluation strategy](../testing/local-model-evaluation-strategy.md).
It records C3's useful separation of deterministic, statistical, project and
empirical evidence together with the legacy false-green and history-loss
failure modes. It is a research input; adopting a corpus, scorer or role policy
still requires an IntentSmith ADR.

## Known semantic conflicts requiring ADRs

| ID | Conflict | Required decision |
| --- | --- | --- |
| SEM-001 | Some C3 docs say a Specialist owns expertises; the newer plugin contract references registry IDs | Prefer reusable global definitions referenced by a Specialist; a package may ship a default definition |
| SEM-002 | C3 “worker agents” conflict with IntentSmith “Workers” | Reserve Worker for task adapters; use Autonomous Agent for scheduled automation |
| SEM-003 | Some C3 routing used an LLM while later guards were deterministic | Define which decisions must be deterministic, model-assisted or user-confirmed |
| SEM-004 | Skill validation may use an LLM | LLM validation is advisory evidence unless deterministic acceptance criteria also pass |
| SEM-005 | C3 sandboxing and network tools are broad | Re-evaluate every capability under IntentSmith's local-first and degraded-isolation policy |
| SEM-006 | Cross-project learning can leak context | Require explicit scope, provenance, retention and deletion controls |
| SEM-007 | Marketplace and model discovery introduce network access | Keep disabled by default and separate metadata access from inference |

## Intake workflow

Before implementing a ledger capability:

1. resolve the immutable C3 source files and tests;
2. record user value, invariants, known defects and recovery behaviour;
3. identify authority, data ownership and sensitive inputs;
4. decide Preserve, Redesign, OSS, Retire or Research;
5. write/update the IntentSmith ADR and runtime contracts;
6. port negative and recovery tests first;
7. implement the smallest vertical slice;
8. run deterministic tests and an opt-in real integration where applicable;
9. compare representative outcomes against C3;
10. update this ledger with commit, evidence and remaining gaps.

## Progress states

Each capability moves through:

```text
INVENTORIED → CONTRACTED → TEST_HARVESTED
            → IMPLEMENTED → VERIFIED → ADOPTED
```

`ADOPTED` requires documentation, evidence and merge into `main`. Code existing
on a development branch is only `IMPLEMENTED`.

## Immediate extraction queue

1. P0 project lifecycle and execution/checkpoint invariants.
2. P0 Tool/Capability metadata and approval mapping.
3. P0 semantic contracts for Expertise, Skill, Specialist and Autonomous Agent.
4. P0 C3 negative/recovery test index.
5. P1 expertise composer and SkillRun vertical slices.
6. P1 specialist SDK/lifecycle with one deterministic fixture specialist.
7. Phase 4 code-intelligence outcome mapping to MCP/Serena.
8. P1 memory/privacy and context-budget contracts.

This queue runs alongside provider/worker integration. It must shape Core
contracts before later phases make incompatible assumptions.
