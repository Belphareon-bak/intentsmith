# IntentSmith Gate Criteria

Normative definition of what each gate verdict means. A verdict that does not
satisfy every clause below is not that verdict.

This document is the authority for gate wording. `STATUS.md` records which
verdict currently holds and against which commit; it does not redefine terms.
The historical `f11026f` attestation is explicitly superseded by
`GATE0-EVIDENCE-CORRECTION.md`; generated files are refreshed only through the
generator, never by hand.

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
| G0-C1 | Worktree is clean | the fixed producer requires the same candidate SHA and empty tracked/untracked porcelain before and after all nine executions; it also rejects ignored paths outside its fixed allowlist, rejects non-canonical/symlinked/other-writable execution and dependency roots, and normalizes safe package-manager-created directory modes to 0700 before reuse |
| G0-C2 | All 225 disposition records resolve and all 60 repaired subjects match the current candidate | `node scripts/validate-final-disposition.js --json` exits 0; the sanitized subject sidecar matches path/blob/mode/resolution/rationale, and the post-commit validator reruns and exactly compares the typed result |
| G0-C3 | Test registry is complete and valid | `node scripts/validate-test-registry.js --json` exits 0, rejects a `BLOCKED` row without external-network/server/Ollama/GPU prerequisites, and the post-commit validator reruns and exactly compares its typed result |
| G0-C4 | Clean install reproduces from the verdict commit | two consecutive locked `scripts/install.sh --minimal` executions exit 0 against the same isolated cache; no stronger installed-state idempotence claim is inferred |
| G0-C5 | Every required deterministic T1/T2 suite and all five pilot repeats pass | all `offline` and `database` registry rows plus five exact `IS-T2-TESTS-PILOT-C1C2C3-TEST` reports |
| G0-C6 | No `KNOWN_DEFECTIVE` suite is counted as green evidence | the generator validates every deterministic result against the registry; the post-commit validator independently derives the deterministic profile/state inventory from the candidate-parent registry and binds this clause |
| G0-C7 | Every `BLOCKED` suite names a specific technical prerequisite | each `BLOCKED` row names external network, owned server, Ollama or GPU; the post-commit validator recomputes the gap list from the candidate-parent registry and binds this clause together with the five-suite soak guard |
| G0-C8 | Evidence and status documentation derive from typed producer evidence for the clean candidate | schema-7 index binds all nine typed executions and the three generated Markdown blobs; the evidence-only commit is post-validated by `npm run gate0:validate-attestation` for its sole candidate parent, exact four-file diff, output modes/hashes and parent-derived evidence |
| G0-C9 | Every risk has one valid machine-readable Gate 0 impact | `GATE0-RISK-IMPACT.json` validates against every row in `RISK-REGISTER.md`; both parent blobs, derived blockers and typed summary are recomputed after the evidence commit |

### "Available" is derived, never judged

G0-C5 is computed from the canonical deterministic profiles, not decided by
whoever writes the verdict:

> A suite is in the Gate 0 deterministic scope when its registry profile is
> `offline` (T1) or `database` (T2). Every row in those profiles must be
> `ACTIVE` and `required: true`.

`offline` means no external service or unowned network dependency. It normally
requires `network:none`; the only loopback exception is the exact
`isolated-home-and-owned-loopback-server` fixture, where the suite creates,
owns, bounds, and closes its listener in-process and declares no server,
database, Ollama, or GPU prerequisite. The registry validator enforces that
tuple. This keeps a live local-boundary regression deterministic without
misrepresenting it as zero-socket execution.

At the current registry fingerprint that is **199 suites**: 173 `offline` and
26 `database`, all `ACTIVE` and required. This count is reproducible; it is not
an estimate. If the number moves, the registry moved, and the change is
reviewable as a diff.

Here and in generated Gate 0 evidence, “registry fingerprint” means the
parsed-registry serialization fingerprint
`sha256-json-stringify-v1`: SHA-256 over
`JSON.stringify(JSON.parse(registryBytes))`. It is not a byte-level file hash;
the candidate Git commit separately binds the exact registry blob and mode.

Model, server, external-network, soak, and manual profiles are outside G0-C5 by
construction — not by exemption. They are governed by later gates and G0-C7,
which requires blocked runs to say *what specifically* is missing. Five soak
programs previously misdeclared as model-free are now guarded by explicit
`ollama` and `gpu` requirements.

### Risk impact policy

`docs/convergence/GATE0-RISK-IMPACT.json` is the committed policy that tells the
evidence generator how each row in `RISK-REGISTER.md` affects Gate 0. Every
register row must have exactly one valid entry with a rationale. An entry that
does not have `G0_FAIL` impact must also carry a concrete condition. The four
allowed impacts are:

- `G0_FAIL`: any state not recognized as closed is a repository-local blocker
  and forces `FAIL`;
- `G0_REVIEW_REQUIRED`: the named bounded review is required before `PASS`;
- `LATER_GATE`: the risk belongs to a named later gate and is non-blocking only
  while its concrete safety condition holds;
- `SEPARATE_INCIDENT`: the incident is reported verbatim under its own
  operator-controlled decision instead of being disguised as a Gate 0
  prerequisite.

The policy, not a JavaScript risk-ID allowlist, classifies repository-local
risks with `G0_FAIL` impact. Closed `G0-R012`, `G0-R014`, `G0-R017`,
`G0-R019`, `G0-R020`, `G0-R026`, `G0-R027`, `G0-R028`, and `G0-R029` retain
that impact and become blockers again if reopened.
`G0-R015` is `G0_REVIEW_REQUIRED`. `G0-R018` is `LATER_GATE` only under the
condition that the legacy listener remains loopback-only; off-loopback binding
is prohibited until the separate authenticated boundary and its bypass-negative
tests pass. `G0-R030` is `LATER_GATE` only while failed media-output retries
remain bounded by the per-cache 60-second/256-entry contract; `C3-001` cannot
pass Gate 1 until health scheduling and teardown are repaired and tested. The
confirmed privacy findings `G0-R001`, `G0-R002`, and `G0-R010` are
`SEPARATE_INCIDENT`.

Validation fails closed. A missing or duplicate entry, unknown impact, empty
required condition, malformed policy entry, extra policy entry without a
register row, or newly added unclassified open/local risk makes G0-C9 fail.
Reopening a closed `G0_FAIL` row makes it a blocker without a generator code
change.

### CONDITIONAL PASS

Permitted only when every local G0-C1..C9 clause holds but the mandatory
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

### Independent review result contract

An `APPROVED` string is not review evidence and cannot promote Gate 0. The
locked promotion design is a linear `C → E → R → A` chain:

- `C` is the exact candidate commit;
- `E` is its valid four-output `PENDING` evidence attestation;
- `R` is a one-file commit containing
  `docs/convergence/reviews/GATE0-OPUS-RESULT.json`;
- `A` is the final four-output approved attestation.

The result uses an exact schema and binds full `C` and `E` SHAs, the
`sha256-json-stringify-v1` parsed-registry serialization fingerprint, the exact
review range, the SHA-256 of the packet in `E`, reviewer role `Opus 5`, method
`independent-read-only`, every sorted `G0_REVIEW_REQUIRED` risk, completion
time, decision and bounded findings. `APPROVED` cannot contain a blocking
finding. Reviewer identity is procedural unless a separately approved
signature system is introduced; the unsigned result does not claim
cryptographic authorship.

The schema-7 validator deliberately rejects a bare `APPROVED`. The schema-8
pure validator accepts it only when it can first validate the complete schema-7
`E`, prove the exact one-file `R` parent and result binding, preserve every
candidate-derived evidence field, re-derive `PASS` through the shared verdict
function, and bind the exact four outputs in `A`. The three schema-8 Markdown
outputs are deterministic approval envelopes followed by the exact reviewed
schema-7 bytes; the validator re-derives those bytes from `E` and `R`, so a
hand-edited status plus a recomputed self-hash is invalid. The envelope clearly
marks the preserved PENDING/CONDITIONAL text as a historical reviewed snapshot
and binds its original digest. The current-HEAD loader dispatches explicitly on
schema 7 versus schema 8, obtains `C/E/R/A` only from physical Git parents,
loads every artifact from Git objects, and rejects unknown schemas or broken
lineage before validator subprocesses run. The argument-free promotion writer
runs only at the exact one-file `R`, revalidates `E`, derives the same payload,
and atomically prepares exactly four unstaged outputs with rollback on failure
or interruption. The current Gate 0 outcome remains `CONDITIONAL PASS` until a
new candidate receives its own independent review result and committed `A`;
tooling cannot reuse an earlier review.

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
- a non-closed risk classified `G0_FAIL` remains in the risk register;
- the risk-impact policy is missing, malformed, incomplete, duplicated, uses an
  unknown impact or omits a required concrete condition. These are local
  evidence defects, so `CONDITIONAL PASS` cannot absorb them.

A deterministic failure is never downgraded to CONDITIONAL PASS. If code is
wrong, the verdict is FAIL regardless of how much else is green.

A validator that passes is evidence only of what it actually asserts. If a
decision is recorded but unenforced, the gate is open regardless of the exit
code — the exit code merely fails to mention it.

The evidence generator derives the verdict and accepts no manual command,
artifact-root, checkout-root, or `--verdict` input. A well-formed red validator
or candidate execution produces generated `FAIL` documents and generator exit
1. An unexecutable validator, malformed producer/report/inventory output,
unsupported schema, signal termination, symlink/path escape, or disagreement
between report, provenance and process exit is an evidence-infrastructure
failure and generator exit 2; it is not a Gate verdict.

### Repeatability

A single green run is evidence for a deterministic suite and only weak evidence
for anything else. Suites carrying `flakeCount > 0` require two consecutive
green runs at the verdict commit before they count toward G0-C5.

### Independent reproducibility

Gate 0 evidence is produced by the same process that produced the tree. That is
acceptable only if a third party can repeat it from the commit alone. The
candidate therefore contains a fixed, argument-free runner. Its ignored
producer record carries, for every phase, the exact spawn-boundary executable,
argv tokens, a fixed host-independent inherited-environment allowlist, explicit isolated
overrides, source state before/after, exit status, and SHA-256 of the captured
log. The producer refuses pre-existing ignored dependency/build/runtime paths
and rejects new ignored paths outside its fixed dependency/build/evidence
allowlist after every phase. It terminates its owned process groups on
interruption. A caller-supplied
shell command or textual log marker is never evidence.

The committed schema-7 evidence index binds that producer record by path, byte
count and SHA-256, records the bounded toolchain identity, and exposes an
`env -i` typed `$PWD` replay recipe derived field-by-field.
It commits only source SHA and a cleanliness boolean, never porcelain path names,
host-specific absolute paths or secret values. The generator derives
the fixed producer location from full current `HEAD`; every report, inventory
and suite log must be a regular non-symlink file below that canonical directory
through mode-0700 canonical directories, itself mode 0600, and have matching
content digest, candidate SHA, registry fingerprint, exact
selection/options fingerprint and recomputed result counters. Every audit
summary has an exact nested schema, and its verdict/exit/passed fields must
agree with the complete PASS/FAIL/TIMEOUT/BLOCKED/SKIPPED counters. Evidence
that cannot satisfy this contract from a fresh clone is not evidence.

The evidence names logical, portable execution contexts rather than absolute
checkout paths. `ATTESTED_CANDIDATE_RUN` is the clean candidate `C` after its
bound dependency installation. `COMMITTED_DATA_ONLY_VALIDATION` is the
dependency-free Git-object/validator check at `E` or `A`. A supplemental direct
test that requires `node_modules` must identify that prerequisite and cannot be
reported as if it ran in the committed-data-only context.

After the four generated files are committed alone, run
`npm run gate0:validate-attestation`. The validator reads blobs from the commit,
requires exactly one parent equal to the indexed candidate, recomputes the
candidate registry fingerprint, verifies that only the four generated paths
changed with mode 100644, and checks the three Markdown blobs against hashes in
the index. It then reruns the registry and disposition validators in the locked
environment, recomputes G0-C9 and repository blockers from both parent risk
blobs, recomputes inventory plus G0-C6/G0-C7 prerequisite facts from the
candidate-parent registry, and binds the sanitized privacy summary to the
complete parent incident blob without republishing private paths or secret
examples. Before either validator subprocess starts, a segment-aware boundary
check derives registry discovery/document inputs and every disposition subject
path from the same constants and source manifest used by those validators; it
rejects any exact or ancestor-tree overlap with an attestated output. All
committed summary records use exact nested fields, so an
unreviewed extension cannot hide inside the evidence schema. The validator
checks HEAD and cleanliness again after those executions. A pre-commit G0-C8
row is not a valid attestation without this post-commit check.

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
