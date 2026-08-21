# Implementation agent protocol

This document governs how an autonomous or semi-autonomous **implementation
agent** works on IntentSmith. It exists because a long autonomous run failed by
generating documents and tests that then justified further documents and tests,
without moving any release criterion.

"Implementation agent" here means a coding agent working *on this repository*.
It is not the product's `Autonomous Agent` concept, which is a scheduled
in-product automation described in
[Domain intelligence and autonomy](../product/domain-intelligence.md). The two
must never be conflated.

The operative subset of this protocol is in [`CLAUDE.md`](../../CLAUDE.md) at
the repository root. This document is the full text and is authoritative where
the two differ.

## 0. Precedence

This protocol **supplements** the normative documents. It never authorises
skipping a gate, a required test, a required document update or a security
control. On conflict, the higher entry wins:

1. [SECURITY.md](../../SECURITY.md) and `docs/security/`;
2. accepted [ADRs](../adr/) and [architecture](../architecture/) boundaries;
3. required checks and rules in [CONTRIBUTING.md](../../CONTRIBUTING.md);
4. phase exit gates in [ROADMAP.md](../ROADMAP.md) and the
   [verification matrix](../test-matrix-phase-1-to-4.md);
5. this protocol;
6. anything the agent produced during the current run.

If this protocol appears to permit omitting something an entry above requires,
the entry above is correct and this protocol is being misread.

## 1. Run entry

Before the first change, establish the baseline from existing documents:

1. read [STATUS.md](../STATUS.md) for the current state;
2. read the current phase in [ROADMAP.md](../ROADMAP.md), including its exit
   gates;
3. read the acceptance evidence for that phase — the
   [verification matrix](../test-matrix-phase-1-to-4.md) and the phase report in
   [`docs/testing/`](../testing/);
4. **name the specific authoritative item this run advances**: a named exit
   gate, a row of the verification matrix, an acceptance-matrix requirement, an
   entry in the [C3 capability ledger](../migration/c3-capability-lifecycle-ledger.md),
   an open regression, or an explicit user instruction.

If no such item can be named, stop and ask. Do not begin work in order to
discover what the work is.

## 2. Authority

The authoritative baseline is the set of existing normative sources:

| Question | Authoritative source |
| --- | --- |
| What must this phase satisfy to close? | Exit gates in [ROADMAP.md](../ROADMAP.md) |
| Which guarantee needs which evidence? | [Verification matrix](../test-matrix-phase-1-to-4.md) |
| What is proven for the current phase? | [`docs/testing/`](../testing/), `artifacts/` |
| What is stable today? | [STATUS.md](../STATUS.md) |
| Why is a boundary the way it is? | [ADRs](../adr/) |
| Which C3 semantics are in scope? | [C3 capability ledger](../migration/c3-capability-lifecycle-ledger.md) |
| What is the trust boundary? | [SECURITY.md](../../SECURITY.md), `docs/security/` |
| What must accompany a change? | [CONTRIBUTING.md](../../CONTRIBUTING.md) |
| What do prose and code disagreement resolve to? | `packages/contracts/src/index.ts` and the executable contract suites |

Anything the implementation agent creates during the current run is
**non-authoritative by default**: plans, design notes, reports, ADR proposals,
new tests, TODO lists, inferred requirements, newly discovered expectations and
generated acceptance criteria.

Such an artifact may explain, implement or verify an authoritative requirement.
It must not create a project requirement by itself. It becomes authoritative
only when an existing authoritative rule grants it that status — an ADR accepted
per [CONTRIBUTING.md](../../CONTRIBUTING.md), a ledger entry, a recorded gate
result — or when the user accepts it.

## 3. No recursive specification

Do not derive new scope from artifacts created during the same run.

Allowed:

```
authoritative requirement -> implementation
authoritative requirement -> test
authoritative requirement -> required evidence
authoritative requirement -> proposal for a decision
```

Not allowed:

```
agent-created document -> new requirement -> new test
  -> more implementation -> another document -> more requirements
```

Whenever work is justified primarily by an artifact created during the current
run, trace it back to the originating authoritative requirement. If the trace
cannot be established, stop that work.

## 4. Progress unit

The unit of progress is movement of an **existing** requirement toward
acceptance. Valid progress events:

- an authoritative acceptance criterion becomes satisfied;
- a capability advances toward its required state in the ledger or matrix;
- a confirmed product regression is fixed;
- a release-blocking deterministic failure becomes green;
- a blocker is conclusively diagnosed and converted into an executable repair;
- a required integration is completed;
- required evidence for already completed implementation is obtained;
- a required gate or gate subsection is completed.

The following are not progress **by themselves**:

- documentation created beyond what is required;
- tests added beyond what is required;
- TODOs, reports and more detailed plans;
- refactoring unrelated code;
- increasing test or line count;
- inventing additional acceptance criteria;
- investigating without narrowing uncertainty.

**Required work is progress.** Tests, negative tests, contract suites, threat
model updates, status and documentation updates that are required by
[CONTRIBUTING.md](../../CONTRIBUTING.md), by a phase exit gate or by the
verification matrix are part of the requirement they serve and count as
progress. This section constrains only what is produced *beyond* an
authoritative requirement.

## 5. Current-work invariant

At all times the agent must be able to answer:

1. Which authoritative requirement am I advancing?
2. What is the current executable task?
3. Why is this task necessary for that requirement?
4. What observable state will be closer to acceptance when it succeeds?

If any answer cannot be established, stop and return to the last authoritative
state. Do not invent work in order to remain active.

## 6. Test provenance

A test is evidence, not an independent source of product requirements. Before
changing product behaviour because a test demands it, classify the failure:

- implementation regression;
- valid existing requirement not yet implemented;
- defective test;
- stale expectation;
- environment or infrastructure problem;
- nondeterminism;
- unclear provenance.

A test written during the current run may verify an existing requirement. Its
failure does not by itself authorise changing product behaviour. If the
expectation cannot be traced to an authoritative requirement, do not modify the
product to satisfy the test.

Two limits, which follow from
[CONTRIBUTING.md](../../CONTRIBUTING.md) ("do not lower coverage thresholds,
skip a failing case or weaken a shared adapter contract"):

- classifying a test as **defective** or **stale** requires recorded evidence,
  and never authorises skipping, disabling, quarantining, weakening or deleting
  it;
- a test that maps to a row of the [verification matrix](../test-matrix-phase-1-to-4.md),
  to a phase exit gate or to a shared contract suite cannot be reclassified by
  the implementation agent at all. That is an escalation under section 11.

## 7. Documentation discipline

Create or update documentation only when it is:

- required by a normative rule, a gate, or [CONTRIBUTING.md](../../CONTRIBUTING.md);
- required as evidence for acceptance;
- necessary to preserve a decision that materially affects implementation;
- necessary for an accurate handoff;
- necessary to correct documentation that conflicts with shipped behaviour.

Prefer updating the canonical document over creating another one. Do not create
parallel specifications, duplicate status systems, duplicate test registries or
alternative roadmaps. Before creating a project-control document, verify against
the table in section 2 that the information has no canonical location already.

Two constraints from [`docs/README.md`](../README.md) limit "prefer updating":

- phase reports in [`docs/testing/`](../testing/), machine-readable evidence in
  `artifacts/` and historical ADRs are **preserved, not rewritten**. Correct
  them by adding a superseding record, not by editing the past;
- current documents must stand on their own and must separate stable behaviour
  from work in progress.

## 8. Progress watchdog

A **work cycle** is one completed executable task or one commit, whichever comes
first.

At the end of each cycle determine:

- the requirement being advanced;
- acceptance state before and now;
- concrete evidence gained;
- blocker removed or remaining;
- whether the current strategy is still converging.

Record this in the handoff message or the pull request description. **Do not
create a file for it** — a watchdog that generates documents is the failure it
is meant to prevent.

If two consecutive cycles produce no measurable movement toward acceptance, the
strategy is **stalled**. On a stall:

1. stop producing new implementation or specification artifacts;
2. return to the authoritative requirement;
3. identify why progress stopped and classify the problem;
4. choose a materially different bounded strategy.

If the second strategy also fails, record the blocker in
[STATUS.md](../STATUS.md) (see section 12) and escalate under section 11.

## 9. Anti-loop rule

This pattern is a mandatory stop condition:

```
new document -> new test -> new failure -> new inferred requirement
  -> new document/test
```

Concrete detection signal: **a file created during this run is being cited as
the source of a requirement.** When that happens, stop.

Also stop when work repeatedly produces:

- more tests without acceptance movement;
- more documentation without resolving uncertainty;
- repeated redesign of the same solution;
- repairs of failures introduced only by newly invented expectations;
- expanding scope without closing existing requirements.

On detection, discard the derived chain **as authority** and return to the last
independently authoritative requirement. Do not delete useful artifacts
automatically; simply stop treating them as authority.

## 10. Bounded investigation and scope

Investigation is legitimate when it reduces uncertainty required by an existing
requirement. Every investigation states a question, a bounded scope and an
expected decision or diagnosis. Prefer the smallest experiment that
discriminates between the competing explanations. Investigation that only
produces further questions is stalled work.

Newly discovered work is classified before execution:

| Class | Meaning | Action |
| --- | --- | --- |
| Required | Needed for an existing acceptance criterion | Proceed within existing authority |
| Regression | Existing required behaviour broke | Repair under current project rules |
| Blocker | Prevents required work | Diagnose and resolve within existing authority |
| Improvement | Useful, not needed for current acceptance | Record for later; keep off the critical path |
| New requirement | Changes behaviour, architecture, scope or acceptance | Do not implement without a decision |

## 11. Decision policy

Do not escalate ordinary engineering choices resolvable from existing
requirements, architecture, tests, evidence or recorded principles.

Escalate when the choice needs user or product authority:

- changing intended product behaviour;
- weakening or changing an accepted release criterion or gate;
- reclassifying a gate-mapped test as defective or stale;
- changing an authority or security boundary;
- removing a mandatory capability;
- accepting a significant compatibility regression;
- destructive or hard-to-reverse actions already protected by project
  governance;
- materially expanding the critical path where existing documents require user
  approval;
- adding an ADR-triggering change under
  [CONTRIBUTING.md](../../CONTRIBUTING.md) that is not already decided.

When escalating, state the decision required, why existing authority cannot
resolve it, viable options, consequences, the recommended option, and what work
is blocked.

## 12. Failures found along the way

A failing suite does not automatically expand the current task. Classify by
causality:

- **caused by the current change** — part of the current work;
- **pre-existing and release-blocking** — record it in the "Known limits and
  open work" area of [STATUS.md](../STATUS.md), or as a GitHub issue linked from
  there, and handle it by priority. That is the canonical location; do not open
  a new tracking document;
- **unrelated and non-blocking** — do not absorb it into the current work merely
  because it was observed;
- **causality unclear** — perform a bounded diagnostic comparison first
  (section 10).

## 13. Efficiency

When several approaches satisfy the same requirement, prefer the one reaching
trustworthy acceptance with the least unnecessary scope, the least irreversible
change, the strongest deterministic evidence, the lowest regression risk and a
reasonable compute cost — in that order. Do not trade correctness for token
economy, and do not spend substantial effort elaborating something off the
critical path.

## 14. Completion and handoff

Completion is determined by the existing acceptance and release system, not by
effort expended. At every meaningful handoff report:

- authoritative requirement(s) advanced;
- acceptance state before;
- acceptance state now;
- blockers removed;
- blockers remaining;
- regressions introduced or discovered;
- decisions genuinely required from the user;
- next highest-value executable action.

Artifact counts, test counts, commits, token usage and elapsed time are
secondary metrics and are never the headline.

## 15. Optimisation target

Optimise for **acceptance progress per unit of human intervention**, subject to
every security, correctness, evidence and release constraint above.

A necessary escalation does not count against a run. A *suppressed* necessary
escalation is a failed run. A long autonomous run with no acceptance movement is
a failed run regardless of how much work it produced.
