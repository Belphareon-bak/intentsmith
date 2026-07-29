# Minimal contracts

This document explains IntentSmith's contract model. The executable source of truth is `packages/contracts/src/index.ts`, together with the contract suites in the relevant package tests.

## Contract rules

- All data entering a trusted boundary is runtime-validated.
- Transport- and vendor-specific shapes stop at their adapter.
- Identifiers connect records; adapters do not receive repository objects.
- Unknown enum values, protocol versions and state transitions fail closed.
- Audit and evidence records avoid raw prompts, responses, credentials and hardware identifiers.

## Core records

| Record | Purpose | Important invariants |
| --- | --- | --- |
| `Project` | Identifies a local workspace and policy context | Workspace paths must pass path policy |
| `Task` | Durable user intent | Outlives individual execution attempts |
| `TaskRun` | One attempt to execute a task | Belongs to exactly one task; terminal states do not resume |
| `WorkerDescriptor` | Truthful adapter capabilities | Unsupported capabilities cannot be pretended |
| `WorkerEvent` | Validated run evidence | Bound to the expected run/session and ordered by lifecycle |
| `GateResult` | Deterministic verification evidence | Records command identity and outcome, not authority |
| `CoreVerdict` | Core's result | `pass` requires sufficient successful evidence |
| `AuditEntry` | Accepted or rejected operation record | Append-only through the public API |

## Task and TaskRun

Intent and execution are deliberately separate:

```text
Task 1 ── TaskRun 1 (failed)
       ├─ TaskRun 2 (blocked)
       └─ TaskRun 3 (passed)
```

This preserves a complete attempt history and keeps future retry policy explicit. A resume continues a paused run; it does not fabricate a new worker or a missing run.

See [ADR 0006](../adr/0006-task-and-task-run.md).

## Lifecycle and terminal evidence

Only transitions accepted by Core change state. Invalid transitions are rejected and audited.

A worker run must produce at most one terminal event. Events after a terminal event remain observable as protocol violations; they are not silently converted into success. Cancellation, timeout and failure are distinct outcomes.

For ACP workers, a protocol-version mismatch, missing/foreign session identifier, invalid stop reason or malformed message is a protocol error.

## Verdict contract

The worker does not determine the final result.

Core evaluates the run state and required evidence. A passing verdict requires:

- a valid terminal lifecycle;
- an accepted successful worker outcome;
- every required deterministic gate to have run and passed;
- evidence associated with the correct task and task run;
- no blocking policy or protocol violation.

Missing evidence fails closed. A worker claim, text message or proposed file alone is never enough.

## Capability envelope

Capabilities describe what a component can do and what policy may grant. They are not proof of operating-system containment.

Examples include:

- pause/cancel support;
- filesystem scope;
- local inference access;
- approval support;
- sandbox strength;
- protocol version.

An adapter must report unsupported or degraded features honestly. Core decides whether that profile is acceptable for the requested workspace.

## Provider boundary

The inference provider contract contains only IntentSmith request, response, cancellation and error semantics. It intentionally excludes Ollama HTTP types and model-specific payloads.

Model fit is a Hardware Director decision, not a transport error. See [ADR 0009](../adr/0009-inference-provider-port.md).

## Persistence boundary

State changes and related audit entries commit atomically. Reentrant transactions are supported within one store; separate stores have isolated transaction contexts. Interrupted runs recover conservatively and are never silently restarted.

See [ADR 0007](../adr/0007-orphaned-run-recovery.md) and [ADR 0010](../adr/0010-per-store-transaction-context.md).

## Changing a contract

A contract change must include:

1. runtime schema changes;
2. positive and negative contract tests;
3. persistence migration or compatibility decision where relevant;
4. adapter-suite updates without encoding fake-specific internals;
5. documentation and an ADR for a lasting architectural change.

If a real adapter requires weakening the shared suite, first determine whether the suite tests behaviour or an implementation detail. Product guarantees are not relaxed to accommodate a vendor.
