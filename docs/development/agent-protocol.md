# Implementation agent protocol

**Verze:** 1 · **Datum:** 2026-08-21 · **Vlastník:** operátor
**Nadřízený dokument:** [`CONTRACT.md`](../../CONTRACT.md) §10

This document governs how an autonomous or semi-autonomous **implementation
agent** works on IntentSmith. It exists because a long autonomous run failed by
generating documents and tests that then justified further documents and tests,
without moving any release criterion.

It is written in English by operator decision; the surrounding normative corpus
is Czech. Where a term is defined in Czech in [`CONTRACT.md`](../../CONTRACT.md),
the Czech term is kept verbatim rather than translated — `schopnost`,
`chování`, `Work Package`, `disposition`, `invariant`.

"Implementation agent" here means a coding agent working *on this repository*.
It is not the product's own agent/specialist concept described in
[`PRODUCT.md`](../../PRODUCT.md). The two must never be conflated.

## 0. Precedence

This protocol **supplements** the normative documents. It is subordinate to
[`CONTRACT.md`](../../CONTRACT.md), which adopts it in §10. It never authorises
skipping an acceptance condition, a required test, a required document update or
a security control. On conflict, the higher entry wins:

1. `L0` invariants — [`CONTRACT.md`](../../CONTRACT.md) §2 and the thirteen
   invariants in [`SYSTEM-MAP.md`](../../SYSTEM-MAP.md); security boundaries in
   [`docs/security/`](../security/) and the deferred security package in
   [`CONTRACT.md`](../../CONTRACT.md) §9;
2. accepted decisions in [`docs/decisions/`](../decisions/);
3. the rest of [`CONTRACT.md`](../../CONTRACT.md), including the agent contract
   in §7 and the Gate 0 rule in §8;
4. product scope in [`PRODUCT.md`](../../PRODUCT.md), evolutionary decisions in
   [`DIRECTION.md`](../../DIRECTION.md), work order in
   [`ROADMAP.md`](../../ROADMAP.md), and the active Work Package assignment in
   [`docs/wp/`](../wp/);
5. this protocol;
6. anything the agent produced during the current run.

If this protocol appears to permit omitting something an entry above requires,
the entry above is correct and this protocol is being misread.

### What "gate" does and does not mean here

[`CONTRACT.md`](../../CONTRACT.md) §8 is an operator decision: **Gate 0 applies
at release, not during development.** This protocol does not reintroduce it. In
this document a *gate* means the acceptance conditions of an active Work Package
and a green `L1`, never the Gate 0 attestation chain `C→E→R→A`. A suite that
[`CONTRACT.md`](../../CONTRACT.md) §8 records as expectedly red during
development — `nightly-orchestrator-self-test` and the sealed registry
fingerprint — is not a defect to chase and not a stall signal.

## 1. Run entry

Before the first change, establish the baseline from existing documents:

1. verify the working tree per [`CLAUDE.md`](../../CLAUDE.md) — `HEAD`, branch,
   remotes, worktrees, uncommitted changes. Preserve foreign or unclearly owned
   changes;
2. read [`SYSTEM-MAP.md`](../../SYSTEM-MAP.md) for the measured current state;
3. read the current position in [`ROADMAP.md`](../../ROADMAP.md) and the active
   Work Package assignment in [`docs/wp/`](../wp/), including its acceptance
   conditions;
4. **name the specific authoritative item this run advances**: the named output
   of an active Work Package, an item of `ROADMAP.md` §12, a `schopnost` in the
   capability picture of [`SYSTEM-MAP.md`](../../SYSTEM-MAP.md), an accepted
   decision in [`docs/decisions/`](../decisions/) that is not yet implemented,
   an open regression, or an explicit operator instruction.

Step 1 includes the **workspace budget** of [`CONTRACT.md`](../../CONTRACT.md)
§6. It does not cap how much work may run; it stops finished workspaces from
accumulating. Work that is merely sequential switches branches in the existing
checkout. Before creating a concurrent worktree, retire every clean,
process-free and evidence-free absorbed checkout; preserve and name dirty,
in-use, detached or evidence-bearing exceptions. `scripts/workspace-budget.sh
report` prints the current state and the reason a checkout is or is not safely
retirable.

If no such item can be named, stop and ask. Do not begin work in order to
discover what the work is. Starting deep implementation without runtime
observation and a delimited Work Package is forbidden by
[`CONTRACT.md`](../../CONTRACT.md) §7.

## 2. Authority

The authoritative baseline is the set of existing normative sources:

| Question | Authoritative source |
| --- | --- |
| Whom does the product serve, what is in 1.0? | [`PRODUCT.md`](../../PRODUCT.md) |
| Why is the product evolved this way? | [`DIRECTION.md`](../../DIRECTION.md) |
| How is work done, what may an agent do? | [`CONTRACT.md`](../../CONTRACT.md) |
| What is the order of work, what is active? | [`ROADMAP.md`](../../ROADMAP.md) |
| What is the assignment of the active Work Package? | [`docs/wp/`](../wp/) |
| What is measured to be true today? | [`SYSTEM-MAP.md`](../../SYSTEM-MAP.md) |
| How does a part actually work? | [`docs/inventory/`](../inventory/) |
| Why is a boundary the way it is? | [`docs/decisions/`](../decisions/) |
| Which suites exist and what do they classify? | [`tests/registry.json`](../../tests/registry.json), [`docs/nightly-audit.md`](../nightly-audit.md) |
| What was proven, and on which commit? | [`docs/execution/runs/`](../execution/runs/), [`docs/review/`](../review/), [`docs/findings/`](../findings/) |
| What is the trust boundary? | [`docs/security/`](../security/), [`CONTRACT.md`](../../CONTRACT.md) §9 |
| What do prose and code disagreement resolve to? | The observed behaviour of the running product — real request, UI or other real input, per [`CONTRACT.md`](../../CONTRACT.md) §4. For the M1 wire shape, [`contracts/m1/`](../../contracts/m1/) |

A document header stating that the file is a working draft is binding: such a
file is read for context and review and does not itself become an operator
decision.

Anything the implementation agent creates during the current run is
**non-authoritative by default**: plans, design notes, reports, decision
proposals, new tests, TODO lists, inferred requirements, newly discovered
expectations and generated acceptance criteria.

Such an artifact may explain, implement or verify an authoritative requirement.
It must not create a project requirement by itself. It becomes authoritative
only when an existing authoritative rule grants it that status — an accepted
decision in [`docs/decisions/`](../decisions/), a recorded acceptance in
[`ROADMAP.md`](../../ROADMAP.md) or [`SYSTEM-MAP.md`](../../SYSTEM-MAP.md) — or
when the operator accepts it.

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

- an acceptance condition of the active Work Package becomes satisfied;
- a `schopnost` advances on the verification ladder of
  [`CONTRACT.md`](../../CONTRACT.md) §5, up to `RUNTIME_VERIFIED`;
- a confirmed product regression is fixed;
- a release-blocking deterministic failure becomes green;
- a blocker is conclusively diagnosed and converted into an executable repair;
- a required integration is completed;
- required evidence for already completed implementation is obtained —
  fresh-clone proof on a named commit per [`CONTRACT.md`](../../CONTRACT.md) §3.

The following are not progress **by themselves**:

- documentation created beyond what is required;
- tests added beyond what is required;
- TODOs, reports and more detailed plans;
- refactoring unrelated code;
- increasing test or line count;
- inventing additional acceptance criteria;
- investigating without narrowing uncertainty.

**Required work is progress.** Tests, negative tests, `chování` recorded as a
regression after a real defect, boundary baselines, threat model updates and the
documentation updates required by [`CONTRACT.md`](../../CONTRACT.md) or by the
acceptance conditions of the active Work Package are part of the requirement
they serve and count as progress. This section constrains only what is produced
*beyond* an authoritative requirement.

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
- expectedly red during development per [`CONTRACT.md`](../../CONTRACT.md) §8;
- unclear provenance.

A test written during the current run may verify an existing requirement. Its
failure does not by itself authorise changing product behaviour. If the
expectation cannot be traced to an authoritative requirement, do not modify the
product to satisfy the test. A test with no link to an approved `chování` does
not count as proof of a `schopnost` ([`CONTRACT.md`](../../CONTRACT.md) §4).

Two limits, which follow from [`CONTRACT.md`](../../CONTRACT.md) §7 — *"nesmí
snížit, přeskočit nebo umlčet test kvůli zelené"*:

- classifying a test as **defective** or **stale** requires recorded evidence,
  and never authorises skipping, disabling, quarantining, weakening or deleting
  it;
- a test registered in [`tests/registry.json`](../../tests/registry.json), bound
  to an acceptance condition of the active Work Package, or belonging to a
  shared contract suite cannot be reclassified by the implementation agent at
  all. That is an escalation under section 11.

Rebaselining a boundary or fingerprint baseline is a recorded act with its own
commit, not a way to make a failure disappear.

## 7. Documentation discipline

Create or update documentation only when it is:

- required by [`CONTRACT.md`](../../CONTRACT.md) or by an acceptance condition
  of the active Work Package;
- required as evidence for acceptance;
- necessary to preserve a decision that materially affects implementation;
- necessary for an accurate handoff;
- necessary to correct documentation that conflicts with shipped behaviour.

[`CONTRACT.md`](../../CONTRACT.md) §7 forbids founding a document that has no
addressee and no reason. Prefer updating the canonical document over creating
another one. Do not create parallel specifications, duplicate status systems,
duplicate test registries or alternative roadmaps. Before creating a
project-control document, verify against the table in section 2 that the
information has no canonical location already.

Three constraints limit "prefer updating":

- [`docs/wp/`](../wp/) holds **assignments, not state**. Per
  [`docs/wp/README.md`](../wp/README.md) it is not a board: nothing there is
  updated, marked done or tracked. State lives in
  [`ROADMAP.md`](../../ROADMAP.md) and the relevant inventory;
- run evidence in [`docs/execution/runs/`](../execution/runs/),
  [`docs/review/`](../review/), [`docs/findings/`](../findings/) and the
  historical [`docs/convergence/`](../convergence/) is **preserved, not
  rewritten**. Correct it by adding a superseding record, not by editing the
  past;
- [`SYSTEM-MAP.md`](../../SYSTEM-MAP.md) is the authority over the legacy claims
  in `docs/ROADMAP.md`, `docs/README.md`, `docs/convergence/*`, `todo.md` and
  `docs/archive/*`. Do not repair those by editing them into agreement.

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
[`SYSTEM-MAP.md`](../../SYSTEM-MAP.md) (see section 12) and escalate under
section 11.

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
- expanding scope without closing existing requirements;
- work on the apparatus while the product stands still — the measured 5 : 1
  ratio recorded in [`DIRECTION.md`](../../DIRECTION.md) §0 is what this rule
  exists to prevent.

On detection, discard the derived chain **as authority** and return to the last
independently authoritative requirement. Do not delete useful artifacts
automatically; simply stop treating them as authority.

## 10. Bounded investigation and scope

Investigation is legitimate when it reduces uncertainty required by an existing
requirement. Every investigation states a question, a bounded scope and an
expected decision or diagnosis. Prefer the smallest experiment that
discriminates between the competing explanations. Investigation that only
produces further questions is stalled work. A read-only probe is a legitimate
form under [`CONTRACT.md`](../../CONTRACT.md) §3 and delivers its result to the
location its assignment names.

Newly discovered work is classified before execution:

| Class | Meaning | Action |
| --- | --- | --- |
| Required | Needed for an existing acceptance condition | Proceed within existing authority |
| Regression | Existing required `chování` broke | Repair, and add the regression per [`CONTRACT.md`](../../CONTRACT.md) §4 |
| Blocker | Prevents required work | Diagnose and resolve within existing authority |
| Improvement | Useful, not needed for current acceptance | Record for later; keep off the critical path |
| New requirement | Changes `chování`, architecture, scope or acceptance | Do not implement without an operator decision |

## 11. Decision policy

The division of authority is set by [`CONTRACT.md`](../../CONTRACT.md) §7 — what
the agent may do unasked, what needs consent, what is forbidden. This section
does not replace it; it says how to escalate when §7 requires consent.

Do not escalate ordinary engineering choices resolvable from existing
requirements, architecture, tests, evidence or recorded decisions.

Escalate when the choice needs operator or product authority:

- changing intended product `chování`;
- weakening or changing an accepted acceptance condition;
- reclassifying a registered or acceptance-bound test as defective or stale;
- changing an authority or security boundary, or anything touching `L0`;
- removing a mandatory `schopnost`, or a `zachovat / nahradit / vyřadit`
  disposition not approved in the active Work Package;
- accepting a significant compatibility regression;
- destructive or hard-to-reverse actions;
- changing the dependency DAG or the release scope;
- replacing any part with open source;
- a decision that belongs in [`docs/decisions/`](../decisions/) and is not
  already made.

When escalating, state the decision required, why existing authority cannot
resolve it, viable options, consequences, the recommended option, and what work
is blocked.

## 12. Failures found along the way

A failing suite does not automatically expand the current task. Classify by
causality:

- **caused by the current change** — part of the current work;
- **pre-existing and release-blocking** — record it under "Otevřené
  release-blocking vady" in [`SYSTEM-MAP.md`](../../SYSTEM-MAP.md) and handle it
  by priority. That is the canonical location; do not open a new tracking
  document. It is distinct from "Známý stav, který se vědomě neřeší", which
  holds items the operator has already decided to defer;
- **unrelated and non-blocking** — do not absorb it into the current work merely
  because it was observed;
- **expectedly red during development** per [`CONTRACT.md`](../../CONTRACT.md)
  §8 — not a defect; do not chase it and do not record it as one;
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

Completion is determined by the existing acceptance system, not by effort
expended. An unfinished `schopnost` must never be recorded as done
([`CONTRACT.md`](../../CONTRACT.md) §7). At every meaningful handoff report:

- authoritative requirement(s) advanced;
- acceptance state before;
- acceptance state now;
- blockers removed;
- blockers remaining;
- regressions introduced or discovered;
- decisions genuinely required from the operator;
- next highest-value executable action.

Artifact counts, test counts, commits, token usage and elapsed time are
secondary metrics and are never the headline.

Handoff also **leaves the workspace within budget** ([`CONTRACT.md`](../../CONTRACT.md)
§6). Before reporting completion:

```bash
scripts/workspace-budget.sh clean --yes   # drops old one-shot sandboxes, keeps evidence
scripts/workspace-budget.sh report        # reports retirable and protected worktrees
```

Sandboxes (`runtime/`, `home/`, `repo/`, `node_modules` under
`.intentsmith-artifacts/`) are run inputs and are disposable only when they do
not contain evidence. Evidence (`report.json`, `checkpoint.json`,
`inventory.json`, `logs/`) is the run output and is never deleted. A dirty,
in-use, detached or evidence-bearing worktree is not auto-retirable; record the
reason and resolve it separately. This is not in tension with §9, which forbids
deleting useful artifacts: a consumed sandbox without evidence is not one.

## 15. Optimisation target

Optimise for **acceptance progress per unit of operator intervention**, subject
to every security, correctness, evidence and acceptance constraint above.

A necessary escalation does not count against a run. A *suppressed* necessary
escalation is a failed run. A long autonomous run with no acceptance movement is
a failed run regardless of how much work it produced.

## 16. Required checks

Daily development mode is a green `L1`, not the attestation chain
([`CONTRACT.md`](../../CONTRACT.md) §8).

```bash
npm run test:deterministic     # offline + database profile
npm run test:registry          # registry reconciliation and validation
```

Focused tests are fine during development. Before handing over a Work Package,
run the profiles its acceptance conditions name; `npm run test:all` and the
`server` / `model` profiles are heavier and are not part of every cycle. The
Gate 0 chain (`npm run gate0:*`) runs only in an explicit release Work Package.

---

**Provenance.** The original text was written on 2026-08-21 in commit
`95ea4c4b` on branch `claude/intentsmith-protocol-review-ela54b`, whose lineage
shares no common ancestor with this tree and which named documents that do not
exist here. This version is the port onto the live tree; adoption and mapping
are recorded in
[`docs/decisions/029-implementation-agent-protocol.md`](../decisions/029-implementation-agent-protocol.md).
