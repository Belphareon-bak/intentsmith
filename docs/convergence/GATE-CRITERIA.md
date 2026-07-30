# IntentSmith Gate Criteria

Normative definition of what each gate verdict means. A verdict that does not
satisfy every clause below is not that verdict.

This document is the authority for gate wording. `STATUS.md` records which
verdict currently holds and against which commit; it does not redefine terms.

## Scope of a verdict

A verdict is meaningless without the tree it describes.

- Every verdict MUST name the commit it was computed from.
- Every verdict MUST name the `tests/registry.json` fingerprint it was computed
  from (`node scripts/validate-test-registry.js` emits it).
- Any product, source, test, configuration, or non-evidence documentation change
  invalidates the candidate verdict. There is no partial re-validation: the
  evidence run repeats from the new candidate commit.
- A verdict computed from a dirty worktree is not a verdict. Evidence
  generation MUST refuse to run when `git status --porcelain` is non-empty.
- Generated status, index, baseline report, and review packet live in one
  evidence-only attestation commit whose parent is the tested candidate. The
  attestation names the parent SHA; it does not pretend to contain its own
  unknowable future commit SHA.

## Gate 0 — trustworthy baseline recovery

Gate 0 asks one question: *can any later claim about this codebase be trusted?*
It is not a quality gate and not a release gate. It does not assert that the
product is good, only that statements about it are verifiable.

### PASS requires all of

| # | Condition | How it is checked |
|---|---|---|
| G0-C1 | Worktree is clean | `git status --porcelain` is empty |
| G0-C2 | All 225 disposition records resolve | `node scripts/validate-final-disposition.js` exits 0 |
| G0-C3 | Test registry is complete and valid | `node scripts/validate-test-registry.js` exits 0 |
| G0-C4 | Clean install reproduces from the verdict commit | two consecutive `scripts/install.sh --minimal` runs exit 0, second one idempotent |
| G0-C5 | Every required deterministic T1/T2 suite passes | all `offline` and `database` registry rows |
| G0-C6 | No `KNOWN_DEFECTIVE` suite is counted as green evidence | evidence generator refuses to read a green result from a `KNOWN_DEFECTIVE` row |
| G0-C7 | Every `BLOCKED` suite names a specific technical prerequisite | each `BLOCKED` row has a non-generic reason naming the missing capability |
| G0-C8 | Evidence and status documentation derive from the clean candidate | generated attestation carries the candidate SHA and registry fingerprint, and has that candidate as its parent |

### "Available" is derived, never judged

G0-C5 is computed from the canonical deterministic profiles, not decided by
whoever writes the verdict:

> A suite is in the Gate 0 deterministic scope when its registry profile is
> `offline` (T1) or `database` (T2). Every row in those profiles must be
> `ACTIVE` and `required: true`.

At the current registry fingerprint that is **199 suites**: 173 `offline` and
26 `database`, all `ACTIVE` and required. This count is reproducible; it is not
an estimate. If the number moves, the registry moved, and the change is
reviewable as a diff.

Model, server, external-network, soak, and manual profiles are outside G0-C5 by
construction — not by exemption. They are governed by later gates and G0-C7,
which requires blocked runs to say *what specifically* is missing. Five soak
programs previously misdeclared as model-free are now guarded by explicit
`ollama` and `gpu` requirements.

### CONDITIONAL PASS

Permitted only when every local G0-C1..C8 clause holds but the mandatory
independent read-only review or operator acceptance is still pending. It may
also describe later-profile suites that remain unrun for reasons entirely
outside the codebase — absent GPU, absent Ollama, absent operator-provided
fixture — but those suites are never counted inside G0-C5.

Constraints:

- Each unmet prerequisite MUST be listed individually, with the concrete missing
  capability and an owner. "Environment not ready" is not a prerequisite.
- A pending review MUST name its exact packet, candidate SHA, and reviewer role.
- CONDITIONAL PASS is a checkpoint, never a release gate. No downstream gate,
  tag, publication, or release may consume it as if it were PASS.
- CONDITIONAL PASS MUST NOT absorb any finding that lives inside the repository.

**The privacy incident is explicitly outside CONDITIONAL PASS.** A confirmed
exposure of private data in published history is not comparable to absent
hardware, and bundling the two produces a document that reads as nearly green
while carrying an unresolved incident. `G0-R001`, `G0-R002`, and `G0-R010` are
tracked as their own blocking decision with their own verdict, recorded in
`DECISIONS.md` under `P-001`..`P-003`. Gate 0 may reach CONDITIONAL PASS with
those decisions still open, but the Gate 0 document MUST state their state
verbatim rather than folding them into a prerequisite list.

### FAIL

Any of:

- a deterministic `required` suite in G0-C5 scope fails;
- the worktree is dirty at verdict time;
- either validator exits non-zero;
- a `KNOWN_DEFECTIVE` result was used as green evidence;
- a `BLOCKED` row carries no specific prerequisite;
- the attestation and candidate disagree on the commit or registry fingerprint;
- **a validator cannot run from a fresh clone of the IntentSmith remote** — for
  example because it dereferences a revision that no ref in this repository
  contains. Passing only by virtue of unreferenced objects in one operator's
  local object database is not a pass; it is an unreproduced claim that a
  `git gc` can silently destroy;
- **a `REBUILD` record has not reached one of the three terminal states** in
  `FINAL-COMMIT-DISPOSITION.md`. `D-018` is a gate condition, not a convention,
  and it is not satisfied by a validator that never checks it.
- repository-local test-trust findings `G0-R023` or `G0-R025` remain open.
  They are code defects, not missing external prerequisites, so
  `CONDITIONAL PASS` cannot absorb them.

A deterministic failure is never downgraded to CONDITIONAL PASS. If code is
wrong, the verdict is FAIL regardless of how much else is green.

A validator that passes is evidence only of what it actually asserts. If a
decision is recorded but unenforced, the gate is open regardless of the exit
code — the exit code merely fails to mention it.

The evidence generator derives the verdict and rejects a manual `--verdict`
override. A well-formed red validator report produces generated `FAIL`
documents and generator exit 1. An unexecutable validator, malformed structured
report, unsupported schema, signal termination, or disagreement between report
and process exit is an evidence-infrastructure failure and generator exit 2;
it is not a Gate verdict.

### Repeatability

A single green run is evidence for a deterministic suite and only weak evidence
for anything else. Suites carrying `flakeCount > 0` require two consecutive
green runs at the verdict commit before they count toward G0-C5.

### Independent reproducibility

Gate 0 evidence is produced by the same process that produced the tree. That is
acceptable only if a third party can repeat it from the commit alone. Every
evidence record MUST therefore carry the exact command, the exit status, and a
SHA-256 of the captured output — enough to re-run without reading this
conversation, the transcript, or any local state. Evidence that cannot be
reproduced from the commit is not evidence.

Install logs additionally carry the candidate SHA, pre/post clean-worktree
markers, run kind (`clean` or `idempotent`), and SHA-256 of the documented
install command. The evidence generator rejects logs missing or disagreeing
with any marker.

## Later gates

Gate 0 is about trust in measurement. The gates after it are about the product,
and they are only meaningful once Gate 0 holds.

| Gate | Question | Entry condition |
|---|---|---|
| Gate 1 | Does each capability in `CAPABILITY-MATRIX.md` have current acceptance evidence? | Gate 0 PASS |
| Gate 2 | Are the E2E suites truthful and activated in stages? | Gate 1 for the capability under test |
| Gate 3 | Is the product releasable? | Gate 2, plus privacy decisions closed |

Capability rows move out of `UNVERIFIED`/`BASELINE_RED` one at a time, each with
its own evidence record. No bulk promotion.

## Staged E2E activation

The 78 recovered E2E suites are not activated as a set. Activation is per suite
and each transition needs its own evidence:

1. **Isolation restored** — writes only below a runner-owned private root; no
   `$HOME`, no shared `/tmp`. Verifiable statically.
2. **Exit semantics truthful** — no `assert(true)`, no early `return` that
   masks a skip, no acceptance of a 5xx as success.
3. **Actually executed** — a real run at a named commit, with artifacts.

A suite that clears 1 and 2 but cannot clear 3 for environmental reasons is
closed as *isolation restored, verification deferred on `<prerequisite>`*. That
is a terminal state, distinct from "not yet examined". See the disposition
vocabulary in `FINAL-COMMIT-DISPOSITION.md`.

## Registry completeness

The registry must not be evadable by naming. Any executable program under
`tests/` counts as a runnable program, and anything deliberately excluded MUST
appear in the registry as an explicit exclusion with a reason, validated like
any other row. A discovery predicate that skips files by naming convention is a
hole in the evidence, not a convenience — a test can be hidden from the ledger
by choosing an unusual filename.

The validator scans every supported program-language file (`.js`, `.cjs`,
`.mjs`, `.py`, `.sh`) below `tests/`, independent of filename. A support module
or aggregate entry point is allowed only as an explicit path plus a specific
reason in `tests/registry.json`. The current eight exclusions are rendered in
`TEST-REGISTRY.md`; the validator rejects missing, duplicate, overlapping, or
unexplained entries and fails closed on symbolic links. `G0-R013` records the
repaired defect.
