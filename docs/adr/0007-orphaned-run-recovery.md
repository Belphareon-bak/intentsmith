# ADR 0007: Recovery Policy for Interrupted Runs

Status: accepted for Phase 1.1

Date: 2026-07-27

## Context

A `TaskRun` row with status `running` or `paused` only means that a process once
started that run. If IntentSmith Core exits unexpectedly, the row survives while
the worker behind it does not. Phase 1 had no recovery step at all, so a
restarted process presented such a row as if it were still live work.

Auto-resuming is not acceptable either. The interrupted worker may have already
applied side effects, and re-running it without a user decision can duplicate
them.

## Decision

On demand, `IntentSmithCore.recoverInterruptedRuns()` closes every run found in
a non-terminal state:

- the run moves to `failed` with `endedAt` set;
- a `TaskResult` is written for that run with `coreVerdict: 'blocked'` and an
  unresolved risk stating that the run was interrupted by a restart;
- the owning task moves to `failed` unless it is already terminal;
- a `task.verdict` audit event records the recovery;
- nothing is restarted.

Existing audit events and evidence are never rewritten, because the audit table
is append-only and `TaskResult` rows are immutable per run. Recovery is
idempotent: a second pass finds nothing to close.

A new attempt is an explicit user action. Retry orchestration itself stays
deferred, as recorded in `docs/STATUS.md`.

## Rationale

`failed` plus a `blocked` verdict is honest with the vocabulary the contracts
already have: the run did not succeed, and the reason is an interruption rather
than a deterministic quality failure. Adding an `interrupted` run status was
rejected as a contract change that buys no behaviour in Phase 1.1.

## Consequences

- A restarted process never reports a dead run as running.
- The distinction between "failed on merit" and "interrupted" lives in the
  result's verdict and unresolved risks, not in the run status.
- Callers that want a fresh attempt must ask for one.
