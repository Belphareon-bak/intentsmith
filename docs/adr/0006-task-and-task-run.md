# ADR 0006: Separate Task and TaskRun

Status: accepted for Phase 1

Date: 2026-07-27

## Context

The Phase 0 `Task` proposal mixed long-lived user intent, lifecycle status, retry
policy, execution evidence, and worker attempts. That shape makes audit and
retry ambiguous because a failed execution attempt can overwrite evidence from a
previous attempt.

## Decision

Phase 1 separates:

- `Task`: user intent, capability envelope, acceptance criteria, and long-lived
  lifecycle state;
- `TaskRun`: one concrete execution attempt with its own attempt number, status,
  and timestamps. Claims, evidence, artifacts, and verdict are stored in the
  immutable `TaskResult` linked to that run.

## Lifecycle Rules

- `paused` is resumable.
- `cancelled` is terminal.
- A cancelled task cannot be resumed.
- Resume is allowed only from `paused`.
- Invalid transitions produce a domain error and an append-only audit event.

## Consequences

- Failed runs remain immutable.
- A future retry can create a new run without rewriting previous evidence.
- Phase 1 remains simpler because audit entries can point to a concrete run ID.
