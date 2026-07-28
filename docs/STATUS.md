# Project status

Last updated: 2026-07-28.

## Release baseline

The stable branch is `main` at Phase 2:

- merge commit: `ec87dd0f52d010726b2ca9409ec6fbceefa778fe`;
- annotated tag: `phase-2`;
- verification: 410 tests across 25 files;
- coverage: 91.65% statements, 83.10% branches, 90.02% functions, 93.37% lines;
- all install, typecheck, lint, test, coverage, build and verification gates pass.

This is the behaviour described as **stable** in the current documentation.

## Stable capabilities

### Core and contracts

- Runtime-validated TypeBox contracts.
- Explicit `Task` and `TaskRun` records.
- Audited lifecycle with invalid-transition rejection.
- Terminal `cancelled` state and resume only from `paused`.
- Evidence-based `CoreVerdict`; worker self-report alone cannot yield `pass`.
- Provider and worker ports kept independent of vendor transport types.

### Persistence and recovery

- SQLite migrations, foreign keys and WAL.
- Atomic, per-store serialized transactions.
- Instance-isolated async transaction contexts for multiple stores.
- Append-only audit API with no update/delete surface.
- Idempotent conservative recovery of interrupted runs.
- Unknown schema versions fail closed.

### Local inference

- Sanitized hardware discovery.
- Explicit hardware/model profiles and single-GPU concurrency control.
- Ollama adapter behind the provider contract.
- Timeout, cancellation and transport errors mapped to stable domain errors.
- No prompt, model response or GPU UUID persisted by the verified path.
- Optional real-Ollama integration suite.

### Local interfaces

- Fastify API bound to `127.0.0.1`.
- `intentsmith` CLI with text and JSON output.
- Optional worker gateway, disabled by default.
- Gateway binds only to loopback, issues run-scoped tokens and revokes all tokens on close.

### Verification

- Deterministic fake worker and provider.
- Virtual time for timeout tests.
- Shared contract suites.
- Executable dependency-boundary checks.
- Clean-tree and clean-clone verification.
- Default gates require no model, GPU, cloud service or external worker.

## Phase 3 development checkpoint

Phase 3 is being developed on `phase-3-opencode-worker`. The last published checkpoint is `bbda53f90726af58ee2b4a4c5b2aa087f3215cd9`, with 558 passing tests and the Phase 2 coverage thresholds unchanged.

The checkpoint includes work on:

- worker SDK and package ownership;
- no-shell process supervision and process-group termination;
- allowlisted environment construction;
- honest sandbox capability reporting;
- ACP validation, session identity and terminal-event rules;
- the unchanged worker contract suite running against FakeWorker and OpenCodeWorker;
- deterministic gates and workspace policy;
- per-run gateway token containment, ingress redaction and revocation;
- a real child-process/loopback-gateway/local-model integration proof.

These items remain work in progress until the phase closes:

- migrate the ACP lifecycle to the official SDK while retaining an explicit public `initialize` request and hard version negotiation;
- probe the real `opencode-ai` executable and record the observed protocol/configuration surface;
- gate degraded-sandbox execution so it cannot be mistaken for safe real-project isolation;
- persist approvals, expiry and recovery semantics in Core;
- capture git-backed diffs into a `ProposedChangeSet`;
- cover worker crash and restart recovery points;
- expose worker operations through API and CLI;
- add an opt-in real-OpenCode suite;
- complete Phase 3 evidence, documentation, pull request and merge.

Nothing on the Phase 3 branch is advertised as stable merely because it has tests.

## Completed phases

| Phase | Result |
| --- | --- |
| Phase 0 — foundation | Product boundaries, dependency research, ADRs and monorepo plan |
| Phase 1 — deterministic core | Lifecycle, SQLite, fake worker, localhost API and CLI |
| Phase 1.1 — contract stabilization | 14 audit findings plus per-store transaction-context isolation fixed; 202 tests |
| Phase 2 — local inference | Hardware director, Ollama provider and scoped worker gateway; 410 tests |

## Not implemented on stable `main`

- external coding worker execution;
- persisted approval decisions;
- retry orchestration;
- MCP or Serena integration;
- skills runtime;
- Studio;
- desktop packaging;
- multi-process Core coordination;
- authentication for non-loopback or multi-user operation;
- cloud inference.

## Known stable limitations

- The CLI expects a running localhost server.
- SQLite correctness is designed for one local IntentSmith process, not multiple writers.
- Recovery is available and tested but automatic startup invocation requires explicit user-notification policy.
- The gateway has no benefit without an external worker and therefore remains off by default.
- Local process controls do not constitute a portable operating-system sandbox.

## Evidence

Phase-specific human-readable results live in `docs/testing/`, machine-readable verification artifacts in `artifacts/`, and audits in `docs/reports/`. Historical reports retain their original phase context.
