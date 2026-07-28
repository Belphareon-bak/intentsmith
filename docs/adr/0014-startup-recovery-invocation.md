# ADR 0014: Startup Recovery Runs Before The Server Listens

Status: accepted for Phase 2

Date: 2026-07-28

## Context

ADR 0007 defined what to do with a `TaskRun` found in a non-terminal state
after a restart, but left open *when* that runs. Phase 1.1 shipped
`recoverInterruptedRuns()` without an invocation point, so a restarted server
could serve requests while stale `running` rows were still on disk.

## Decision

`ServerRuntime.prepare()` runs recovery, and the process calls it before
`app.listen()`. The resulting summary is held in runtime state and exposed at
`GET /runtime/recovery` and through `intentsmith runtime recovery`.

If recovery fails, startup fails. The server does not bind, `/health` does not
report healthy, and no inference or worker request starts. Serving from a
half-recovered database is exactly the ambiguity the policy exists to remove, so
a partial success is treated as a failure.

The summary carries a timestamp, the number of recovered runs, the affected task
IDs, a status and an error code when it failed. Task IDs are opaque local
identifiers carrying no prompt or user content, so they are safe to surface
locally.

Interrupted work is still never restarted automatically. A new attempt remains
an explicit user action.

## Consequences

- A client can never observe a dead run presented as live work.
- `/health` reports recovery state, so a supervisor can tell the difference
  between "starting" and "refusing to start".
- A future Studio client reads this over the local API. Studio must never open
  SQLite directly.
