# CLAUDE.md

Operating rules for an implementation agent working on IntentSmith. The full
text is [`docs/development/agent-protocol.md`](docs/development/agent-protocol.md)
and is authoritative where this file is shorter.

"Implementation agent" means a coding agent working on this repository. It is
not the product's `Autonomous Agent` concept.

## Precedence

`SECURITY.md` and `docs/security/` > accepted ADRs and architecture boundaries >
`CONTRIBUTING.md` > phase exit gates in `docs/ROADMAP.md` and
`docs/test-matrix-phase-1-to-4.md` > the agent protocol > anything produced
during the current run.

This protocol never authorises skipping a gate, a required test, a required
document update or a security control.

## Before the first change

Read `docs/STATUS.md`, the current phase in `docs/ROADMAP.md`, and the
acceptance evidence for that phase (`docs/test-matrix-phase-1-to-4.md`,
`docs/testing/`). Then **name the specific authoritative item this run
advances** — an exit gate, a matrix row, an acceptance-matrix requirement, a
capability-ledger entry, an open regression, or an explicit user instruction.

If none can be named, stop and ask. Do not start work in order to find out what
the work is.

## Authority

Authoritative: the existing normative documents, accepted ADRs, the repository
state, the capability ledger, the verification and acceptance matrices, and
explicit user instructions. Where prose and code disagree,
`packages/contracts/src/index.ts` and the executable contract suites win.

Non-authoritative by default: everything the agent creates during this run —
plans, design notes, reports, ADR proposals, new tests, TODO lists, inferred
requirements, generated acceptance criteria. They may explain, implement or
verify a requirement. They may not create one.

## Current-work invariant

Be able to answer at all times:

1. Which authoritative requirement am I advancing?
2. What is the current executable task?
3. Why is it necessary for that requirement?
4. What observable state is closer to acceptance when it succeeds?

If any answer is missing, stop and return to the last authoritative state. Do
not invent work to stay active.

## Anti-loop

Mandatory stop condition:

```
new document -> new test -> new failure -> new inferred requirement
  -> new document/test
```

Detection signal: **a file created during this run is being cited as the source
of a requirement.** Stop, discard the derived chain as authority, and return to
the last independently authoritative requirement. Do not delete the artifacts;
just stop treating them as authority.

Also stop on: more tests without acceptance movement, more documentation without
resolved uncertainty, repeated redesign of the same solution, or scope growing
while nothing closes.

## Progress

Progress is movement of an *existing* requirement toward acceptance. Documents,
tests, reports, plans, commits and token spend are not progress by themselves.

Tests and documentation **required** by `CONTRIBUTING.md`, a phase exit gate or
the verification matrix are part of the requirement they serve and do count.

Watchdog: after each work cycle (one completed executable task or one commit),
state the requirement, the acceptance state before and now, the evidence gained,
and whether the strategy is converging — in the handoff message or the pull
request description, **never as a new file**. Two consecutive cycles with no
measurable movement means the strategy is stalled: stop, re-read the
requirement, classify why, and choose a materially different bounded approach.

## Tests

A test is evidence, not a source of requirements. Classify a failure before
acting on it (regression, unimplemented requirement, defective test, stale
expectation, environment, nondeterminism, unclear). Calling a test defective or
stale requires evidence and never authorises skipping, disabling, quarantining,
weakening or deleting it. A test mapped to the verification matrix, a phase exit
gate or a shared contract suite cannot be reclassified by the agent at all —
escalate instead.

## Documentation

Update the canonical document; do not create a parallel one. Phase reports in
`docs/testing/`, evidence in `artifacts/` and historical ADRs are preserved, not
rewritten — supersede instead of editing the past.

## Failures found along the way

Caused by the current change → fix it here. Pre-existing and release-blocking →
record it under "Open release-blocking defects" in `docs/STATUS.md`. Unrelated
and non-blocking → do not absorb it. Causality unclear → bounded diagnostic
first.

## Escalate, do not guess

Escalate a change to product behaviour, a weakened release criterion or gate, an
authority or security boundary change, removal of a mandatory capability, a
significant compatibility regression, a destructive action, or an ADR-triggering
decision that is not already made. State the decision, why existing authority
cannot resolve it, the options, consequences, your recommendation, and what is
blocked.

Do not escalate ordinary engineering choices resolvable from existing
requirements, architecture, tests and evidence.

## Handoff

Report: requirements advanced, acceptance state before and now, blockers removed
and remaining, regressions introduced or discovered, decisions needed from the
user, and the next highest-value executable action. Counts of tests, files,
commits and tokens are secondary.

A necessary escalation does not count against a run. A suppressed one does. A
long run with no acceptance movement is a failed run however much it produced.

## Required checks

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

Focused tests are fine during development; the full gate is required before
merge. See [CONTRIBUTING.md](CONTRIBUTING.md).
