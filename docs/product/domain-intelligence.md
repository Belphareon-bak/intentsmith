# Domain intelligence and autonomy

IntentSmith preserves five distinct extension layers. Collapsing them into one
generic “skills” feature would lose differences in authority, lifecycle,
composition and safety.

The model is derived from behaviour proven in C3, but is documented here as a
standalone IntentSmith architecture. IntentSmith will reimplement the contracts
over its typed Core rather than copy the legacy runtime.

## The five layers

| Layer | Primary question | Runtime role | Authority |
| --- | --- | --- | --- |
| Expertise | How should the answer be synthesized? | Read-only domain and behaviour profile | Cannot select intent or execute tools |
| Skill | Which known procedure should be followed? | Controlled workflow with checkpoints | Only declared steps and capabilities |
| Specialist | Which domain package can execute this capability? | Self-contained plugin with deterministic tools and knowledge | Cannot mutate Core directly |
| Autonomous Agent | What should be checked repeatedly over time? | Scheduled deterministic monitor and automation | Creates governed actions/tasks |
| Worker | Who executes this particular task run? | External execution adapter | Emits evidence; never decides verdict |

## Expertises

An Expertise affects **how** an answer is synthesized: tone, depth, vocabulary,
caution, output representation and model parameters. It must not change the
intent selected by Core or force an undeclared tool.

The C3 model provides important proven semantics to retain:

- 15 built-in domain profiles plus custom profiles;
- deterministic vocabulary-based selection with manual choice taking priority;
- composition of at most three expertises;
- five-dimensional capability vectors: reasoning, creativity, determinism,
  risk tolerance and verbosity;
- compatibility outcomes from warning through hard block;
- inheritance with bounded depth;
- constraints, antipatterns and disclaimers that cannot be trimmed away;
- post-synthesis enforcement and capability-drift evidence.

IntentSmith should encode these as runtime-validated, immutable definitions and
pure composition functions. Expertise output is evidence/configuration, never a
Core state transition.

## Skills

A Skill is a controlled, repeatable procedure:

> fixed skeleton and result contract + dynamic user inputs.

Important semantics to retain:

- versioned declarative definitions;
- explicit parameters and success criteria;
- ordered steps such as inference, template, transform, ask, review, validate,
  write and governed execution;
- user confirmation before execution;
- persisted state when waiting for input or review;
- resume from the next valid step;
- retries only for declared transient failures;
- validation or security failures never retried optimistically;
- professional workflow pattern:
  clarify → draft → review → refine → validate → persist.

A Skill execution should create or attach to a Core `TaskRun`; it must not
invent a parallel task lifecycle.

## Specialists

A Specialist is a self-contained execution plugin. It may register:

- deterministic tools through ToolAdapter contracts;
- referenced expertises;
- capabilities for N:M routing;
- versioned knowledge with provenance;
- guided multi-step scenarios;
- scoped memory writes;
- telemetry;
- migrations and dependencies.

The plugin lifecycle to retain is:

```text
ABSENT → INSTALLED → ENABLED ↔ DISABLED
                         └──→ UPDATING
```

Required properties:

- manifest-driven discovery and engine compatibility;
- idempotent install/enable/disable;
- zero-restart enable, disable and update where the platform permits;
- data survives disable;
- deterministic dependency ordering;
- update only while idle;
- database version committed only after successful re-enable;
- reversible migrations rolled back on failure;
- defensive unregister of every registered capability;
- no imports into Core internals or another specialist's private modules.

The core domain rule is that numerical or otherwise deterministic claims come
from tools. The model may explain or format a structured result; it does not
silently replace the calculation.

## Autonomous Agents

An Autonomous Agent is a durable scheduled automation, not an external coding
worker and not an Expertise.

The proven execution shape is:

1. fetch declared sources;
2. filter already-seen records;
3. merge and deduplicate multi-source data;
4. evaluate deterministic conditions;
5. detect rising, falling or any change edges;
6. persist crash-safe deduplication state before business actions;
7. execute governed notifications, webhooks or task creation;
8. persist the run outcome.

Useful retained controls include cooldowns, maximum fires per day, partial
source failure, schema-degradation auto-disable, bounded retry and explicit
run states.

In IntentSmith, scheduled agents must submit actions through Core capability
and approval policy. They never write lifecycle state directly.

## Worker distinction

An IntentSmith Worker, such as OpenCode, executes one `TaskRun`. It is selected
by capability, supervised and terminated with the run, and emits untrusted
events and proposed changes.

Autonomous Agents may create tasks. Workers execute those tasks. Specialists
provide deterministic domain capabilities. Skills organize known procedures.
Expertises shape synthesis.

## Project lifecycle inheritance

C3's project lifecycle is more mature than the initial IntentSmith task state
machine and must be mined as a product asset:

```text
SPEC → SPEC_REVIEW → PLANNING → PLAN_REVIEW
     → BUILD → PROJECT_REVIEW → COMPLETED
```

With explicit paths for revision, pause, failure, change management and
recovery.

The semantics to preserve include:

- measurable specification validation;
- versioned roadmaps with immutable completed milestones;
- bounded milestone scope and dependency validation;
- local plan approval before execution;
- deterministic test/compile gates before model review;
- structural, functional and security checkpoint modes;
- adaptive repair using previous findings;
- bounded retries followed by a user-visible blocked state;
- diff-based scope enforcement;
- health and drift evidence;
- change impact analysis;
- commit/tag checkpoints only after passing evidence.

IntentSmith should express these as policies and workflow records over
`Project`, `Task` and `TaskRun`, not as a second competing state machine.

## Extraction method

For every C3 subsystem:

1. inventory code, documentation, tests and version history;
2. write its behavioural invariants and known failures into a semantic ledger;
3. classify each part as **preserve**, **redesign**, **replace with open
   source**, or **retire**;
4. create provider-neutral runtime contracts;
5. port negative and recovery tests before real adapters;
6. implement the smallest vertical slice;
7. compare behaviour against representative C3 scenarios.

This keeps the value accumulated through C3's evolution while avoiding a
second monolith inside IntentSmith.
