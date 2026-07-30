# IntentSmith Gate 0 Deterministic Audit

Status: reviewed one-shot verification candidate. Systemd installation and
activation are disabled during Gate 0 and are not release evidence.

The orchestrator is locked to:

- remote: `origin`;
- branch: `codex/intentsmith-1.0`;
- profiles: `offline,database`;
- dependency install: `npm ci`;
- concurrency: `1`.

The canonical registry currently contains 262 runnable programs. This Gate 0
orchestrator selects exactly the 171 `offline` and 21 `database` entries. The
remaining `server`, `model`, `soak`, and `manual` profiles are not silently
counted as passing. The reviewed registry fingerprint is
`4804c79e582e937d48fe59540b38233d35c48796b57a6793205b7ade3bb5d90a`;
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
3. performs clean `npm ci`;
4. proves the exact HEAD and clean worktree immediately after installation and
   before and after every preflight;
5. validates the registry and test-trust self-tests;
6. runs the 192 deterministic registry entries;
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

- `0`: all 192 required entries passed and all required evidence validated;
- `1`: at least one required entry failed or timed out;
- `2`: a prerequisite blocked execution or orchestration/evidence validation
  failed.

A printed assertion count is never a substitute for this process exit and
validated report.

## Known Gate 0 boundary

The `offline` registry profile means the test was statically classified as not
requiring network access. This command does not yet prove OS-level egress
denial. That remains a separate mandatory offline/security gate.

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
