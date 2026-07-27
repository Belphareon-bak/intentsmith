# ADR 0008: Lifecycle Commands Are Validated Separately From State Edges

Status: accepted for Phase 1.1

Date: 2026-07-27

## Context

Phase 1 validated lifecycle changes by checking the state edge alone through
`assertTransition(from, to)`. Both `start` and `resume` target `running`, and
both `pending -> running` and `paused -> running` are legal edges.

The consequence was a real defect: `resumeTask` on a `pending` task passed
validation and set the task to `running` without creating a `TaskRun` or
starting a worker. The task could never finish and could never be resumed
again. This contradicts ADR 0006, which states that resume is allowed only from
`paused`.

## Decision

Lifecycle intent is modelled explicitly. `COMMAND_SOURCE_STATES` maps each
command to the statuses it may be issued from:

```text
start   <- pending
pause   <- running
resume  <- paused
cancel  <- pending, running, paused
```

`assertCommand(command, from)` checks the command first, then the resulting
state edge, and always raises `INVALID_TASK_TRANSITION` so the API and CLI keep
one stable error code. `ALLOWED_TRANSITIONS` is retained as the state-machine
definition and is still enforced.

## Consequences

- Breaking change for callers that relied on `resume` behaving like `start`.
- `startTask` additionally refuses a task that already has an active run.
- Terminal statuses accept no command, so a passed or failed result cannot be
  overwritten through the lifecycle API.
