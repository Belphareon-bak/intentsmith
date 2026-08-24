# IntentSmith Gate 0 Deterministic Audit

Status: reviewed one-shot verification candidate. Systemd installation and
activation are disabled during Gate 0 and are not release evidence.

The orchestrator is locked to:

- remote: `origin`;
- branch: `codex/intentsmith-1.0`;
- profiles: `offline,database`;
- dependency install: `npm ci`, then the hash-locked isolated PDF runtime;
- concurrency: `1`.

The canonical registry currently contains 384 runnable programs. This Gate 0
orchestrator selects exactly the 191 `offline` and 36 `database` entries. The
remaining 38 `server`, 84 `model`, 19 `soak`, and 16 `manual` programs are not
silently counted as passing. The reviewed parsed-registry serialization
fingerprint uses `sha256-json-stringify-v1` (SHA-256 over
`JSON.stringify(JSON.parse(bytes))`) and is
`a2c4d29e6bcc09bea6fc3baca03c339bbb79a662b0b1a2f6dbebce9116948fd3`;
the run fails closed if either that fingerprint or the reviewed profile counts
change. This is not a byte-level hash: formatting-only JSON whitespace does not
change it. The candidate commit independently binds the exact registry blob.

## Evidence location

Raw logs, isolated homes, temporary databases, worktrees, checkpoints, reports,
and summaries stay in the ignored production-tree boundary:

```text
.intentsmith-artifacts/nightly/
```

Directories are written with mode `0700`; JSON and log files use mode `0600`.
Only bounded checksums and summaries may be promoted into tracked Gate evidence.
The dependency evidence records `package-lock.json`, `requirements/pdf-export.lock`,
their SHA-256 values, the exact PDF package versions, and separate
`npm-ci.log` and `pdf-runtime-install.log` hashes.

## Dry run

```bash
node scripts/nightly-orchestrator.js --dry-run
```

The dry run resolves the existing remote-tracking ref without fetching or
writing anything. It reports commands and isolated path names, never inherited
environment values.

## One-shot run

```bash
node scripts/nightly-orchestrator.js
```

The run:

1. verifies the single raw and effective remote URL, pins the effective SSH
   target to `git@github.com:22` without a proxy/jump/local command, rejects
   repository-local Git transport overrides, and fetches only the locked
   branch without tags;
2. resolves one exact commit and creates an owned detached worktree;
3. performs clean `npm ci`, then builds a fresh private CPython 3.12 venv from
   binary wheels pinned by version and SHA-256 (`ReportLab 5.0.0`,
   `Pillow 12.3.0`, `charset-normalizer 3.4.4`);
4. proves the exact HEAD and clean worktree immediately after installation and
   before and after every preflight;
5. validates the registry and test-trust self-tests;
6. runs the 199 deterministic registry entries with the exact isolated PDF
   interpreter forwarded through the runner whitelist;
7. validates source SHA, registry hash, exact suite IDs, profiles, result
   evidence, log containment/hashes, verdict, and process exit before summary;
8. validates the generated summary contract;
9. records a non-terminal cleanup-pending state, removes only the worktree
   authenticated by its external ownership marker, protects the current run
   from retention even under clock skew, and keeps the global lock held;
10. only then atomically records `completed` or `completed_with_failures` with
    explicit cleanup evidence and releases the global lock while leaving the
    function.

`SIGINT` and `SIGTERM` are handled as failed orchestration. The orchestrator
propagates termination to its owned command group; the audit runner propagates
it to each separately owned suite group. Both layers use bounded
`SIGTERM`-then-`SIGKILL` cleanup, and the orchestrator writes failed metadata
and removes its authenticated worktree and lock before exiting nonzero.

Log open, write, stream-finalization, and hash/read failures are failures, never
passing evidence. A log failure terminates the owned command/suite group before
the runner continues. Resume rejects symlinked run, log, inventory, and
checkpoint boundaries before reading or changing their modes. A stale owned
suite log or runtime directory is preserved and the next attempt uses a
reviewable `.retry-N` path with the matching `retryCount`.

Exit codes are:

- `0`: all 199 required entries passed and all required evidence validated;
- `1`: at least one required entry failed or timed out;
- `2`: a prerequisite blocked execution or orchestration/evidence validation
  failed.

A printed assertion count is never a substitute for this process exit and
validated report.

## Gate 0 evidence generation

From a clean committed candidate, run:

```bash
npm run gate0:run-evidence
npm run gate0:generate-evidence
# after committing only the four generated files:
npm run gate0:validate-attestation
```

After the exact pending attestation `E` has been independently reviewed, add
only `docs/convergence/reviews/GATE0-OPUS-RESULT.json` in its own commit `R`.
From that clean commit run:

```bash
npm run gate0:promote-review
# inspect and commit exactly the four generated evidence outputs as A
npm run gate0:validate-attestation
```

The promotion command accepts no arguments and never stages or commits files.
It requires `R` to add only the mode-`100644` result, revalidates `E` and its
physical candidate `C`, derives the exact schema-8 index and approval envelopes,
and leaves exactly four tracked modifications. Any write, postcondition or
signal failure restores all four original `E` artifacts. A `PASS` claim exists
only after the four outputs are committed as `A` and the current-HEAD validator
accepts the complete physical chain.

The runner accepts no arguments. It executes a fixed nine-phase plan without a
shell: two minimal installs against one isolated cache, the complete
offline/database registry, five exact pilot runs, and the five-suite
model-backed soak prerequisite guard. It writes raw logs, reports, inventories,
and a strict producer provenance record only below the ignored fixed path
`.intentsmith-artifacts/gate0/candidate-<full-HEAD>/`.

The producer record contains the exact spawn-boundary executable, argv tokens,
the fixed host-independent inherited-environment allowlist, explicit isolated environment
overrides, source state before and after each phase, exit status, log size and
log SHA-256. It declares that no secret values were recorded. The runner
refuses a dirty tree, a subdirectory or symlinked checkout root, an existing
candidate evidence directory, any pre-existing ignored dependency/build/runtime
path, and unsafe path components. Before and after every phase it rejects
ignored paths outside the fixed dependency/build/evidence allowlist, verifies
every configured writable root/file parent inside the private candidate
boundary, rejects symlinked, non-canonical, or other-writable dependency/build
roots, and normalizes safe package-manager-created root modes to `0700` before
a later phase can reuse them.
SIGINT/SIGTERM handling terminates every
owned child process group before the runner returns; an interruption during
the no-child finalization tail invalidates the candidate provenance file.

The generator also accepts no artifact, command, root, or verdict arguments.
It derives the only valid evidence path from current full `HEAD`, validates the
producer schema against the fixed plan, requires canonical real paths and
private mode-0700 directory chains plus regular mode-0600 non-symlink files,
and recomputes report, inventory and suite-log contracts. Committed schema-7
evidence contains the producer-file digest, bounded toolchain identity,
path-free source cleanliness booleans, exact process-cleanup fields, hashes of
all three generated Markdown outputs and an `env -i` tokenized `$PWD` replay
recipe; host-specific absolute
paths and raw Git porcelain remain only in the ignored producer record.
The post-commit attestation validator then verifies the sole candidate parent,
candidate registry fingerprint, exact four-output diff, Git modes and bound
Markdown hashes; reruns both offline validators in the locked environment; and
recomputes the registry inventory, G0-C6/G0-C7 prerequisite facts,
risk-policy blockers and privacy-incident binding from the candidate-parent
blobs. Exact nested summary fields and status-count-derived audit verdicts
prevent unreviewed metadata or contradictory aggregates from passing. A
signal during the generator's four-file finalization
restores all original tracked outputs, so an exit-2 run cannot leave a
commit-ready evidence quartet.

The same command dispatches explicitly by committed evidence schema. Schema 7
validates the physical `C → E` parent relation. Schema 8 walks the physical
`C → E → R → A` chain, reads the pending packet from `E`, the one-file review
result from `R`, and the four approved outputs from `A`; JSON claims never
select those commits. Unknown schemas, merges, changed lineage, mixed review
diffs and a review-result path overlapping any validator input fail closed
before the candidate validators run.

The registry and disposition validators are invoked with `--json`. A
well-formed validation report with errors is a valid red state: the generator
writes `STATUS.md`, `EVIDENCE-INDEX.json`, the baseline report and the review
packet with verdict `FAIL`, then exits 1. A validator that cannot execute,
terminates by signal, emits malformed JSON, uses an unsupported schema, breaks
the pinned source/count invariants of a green report, or disagrees with its
process exit is an evidence-infrastructure failure; the generator exits 2 and
does not claim a verdict from that invocation.

The same distinction applies to candidate execution. A structurally valid
nonzero install, deterministic result, or pilot result produces a failed gate
clause and exit 1. Missing, forged, contradictory, symlink-escaped, wrong-SHA,
wrong-options, wrong-layout, or otherwise malformed producer evidence is an
infrastructure failure and exit 2. No clause is promoted by matching text
markers in a log.

Evidence reports distinguish two logical execution contexts without committing
host-private absolute checkout paths:

- `ATTESTED_CANDIDATE_RUN`: revision `C`, cwd `$PWD`, clean/pristine source,
  dependencies installed by the two bound install phases, followed by the
  authoritative registry executions;
- `COMMITTED_DATA_ONLY_VALIDATION`: revision `E` or `A`, cwd `$PWD`,
  dependency-free Git-object and registry/disposition validation. Dependencies
  may be absent in this checkout.

A direct test such as `node tests/harness-exit-code.test.js` is supplemental
and requires installed dependencies. Its failure solely because `node_modules`
is absent does not contradict the same suite's attested PASS inside
`ATTESTED_CANDIDATE_RUN`; any checkpoint table must name which of these contexts
produced the cited exit.

All local clauses G0-C1 through G0-C9 must be green before the generator may derive
`CONDITIONAL PASS`, and that verdict means only that independent read-only
review remains pending. `PASS` additionally requires approved independent
review.

The generator reads the committed
`docs/convergence/GATE0-RISK-IMPACT.json` and validates it against every current
row in `RISK-REGISTER.md`. A missing or duplicate mapping, unknown
`gateImpact`, malformed entry, missing concrete condition, extra policy row, or
new unclassified open/local risk fails G0-C9. Any non-closed `G0_FAIL` row
forces `FAIL`; reopening one is effective without changing generator code. The
current policy has no open repository-local `G0_FAIL` row; `G0-R015` requires
independent review. `G0-R018` remains
a later-gate risk only while the legacy listener stays loopback-only, and the
privacy findings remain separately reported incidents.

The evidence index records the policy path, SHA-256, schema version, validation
errors, row counts, impact counts, and all open risks grouped by impact. The
generated status, baseline report, and review packet render those derived
groups; none uses a fixed risk-ID blocker allowlist.

## Known Gate 0 boundary

Dependency acquisition (`npm ci` and the hash-locked wheel download) may use the
network before the test profiles begin. The `offline` registry profile means
the test itself was statically classified as not requiring network access.
This command does not yet prove OS-level egress denial. That remains a separate
mandatory offline/security gate.

Process-group cleanup covers descendants that remain in the owned group. A
program that deliberately escapes with a new session or a double fork is not
equivalent to cgroup-level containment and remains a recorded residual risk.
Likewise, uncatchable `SIGKILL`, host failure, or power loss can leave a lock,
ownership marker, or disposable worktree. Recovery is intentionally not
automatic: inspect the marker, metadata, exact source revision, and
`git worktree list` before removing only an authenticated stale object.

The legacy files under `systemd/user/c3-nightly-audit.*` are retained only as
migration input. `scripts/install-nightly-audit-systemd.js` refuses writes
during Gate 0; `--dry-run` is inspection-only. No timer has been installed,
enabled, or started by this work.
