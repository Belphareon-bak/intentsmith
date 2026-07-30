# IntentSmith Gate 0 Deterministic Audit

Status: reviewed one-shot verification candidate. Systemd installation and
activation are disabled during Gate 0 and are not release evidence.

The orchestrator is locked to:

- remote: `origin`;
- branch: `codex/intentsmith-1.0`;
- profiles: `offline,database`;
- dependency install: `npm ci`, then the hash-locked isolated PDF runtime;
- concurrency: `1`.

The canonical registry currently contains 350 runnable programs. This Gate 0
orchestrator selects exactly the 173 `offline` and 26 `database` entries. The
remaining 36 `server`, 82 `model`, 18 `soak`, and 15 `manual` programs are not
silently counted as passing. The reviewed registry fingerprint is
`f6edc6ccff693284ee01ed159e90faea20e94662892d7b84b2f61efdf35e03b5`;
the run fails closed if either that fingerprint or the reviewed profile counts
change.

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

`node scripts/generate-gate0-evidence.js ...` accepts only evidence artifacts
bound to its clean candidate SHA and current registry fingerprint. The verdict
is derived; the generator rejects the former manual `--verdict` override.
`--execution-root` names the absolute checkout used for the recorded commands.
The generator preserves those exact commands and mechanically emits a second
portable form in which that root is `$PWD`; any other host-absolute path or
artifact outside the checkout is rejected. Evidence entries therefore carry
both the executed path and a fresh-clone replay locator.

The registry and disposition validators are invoked with `--json`. A
well-formed validation report with errors is a valid red state: the generator
writes `STATUS.md`, `EVIDENCE-INDEX.json`, the baseline report and the review
packet with verdict `FAIL`, then exits 1. A validator that cannot execute,
terminates by signal, emits malformed JSON, uses an unsupported schema, breaks
the pinned source/count invariants of a green report, or disagrees with its
process exit is an evidence-infrastructure failure; the generator exits 2 and
does not claim a verdict from that invocation.

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
