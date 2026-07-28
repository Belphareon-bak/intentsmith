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

Phase 3 is being developed on `phase-3-opencode-worker`. The latest published implementation and ADR checkpoints are `f9dabf5` and `0898d18`, with 557 passing tests and the Phase 2 coverage thresholds unchanged.

The checkpoint includes work on:

- worker SDK and package ownership;
- no-shell process supervision and process-group termination;
- allowlisted environment construction;
- honest sandbox capability reporting;
- ACP validation, session identity and terminal-event rules;
- the official ACP SDK using `connectWith`, a public typed `initialize` request, hard protocol-version negotiation and then `session/new`;
- a strict per-instance NDJSON stream that rejects malformed, oversized and non-object input before it reaches the SDK;
- 12 wire-level handshake tests proving initialization order, cancellation and connection isolation;
- the unchanged worker contract suite running against FakeWorker and OpenCodeWorker;
- deterministic gates and workspace policy;
- per-run gateway token containment, ingress redaction and revocation;
- a real child-process/loopback-gateway/local-model integration proof.

The real `opencode-ai@1.18.8` probe has additionally verified:

- ACP protocol version 1 and OpenCode agent version 1.18.8;
- advertised session, MCP and embedded-context/image capabilities;
- no advertised terminal capability;
- a loopback HTTP listener in ACP mode, with mDNS off by default;
- an unsafe default: with `--pure`, isolated home/config and no user configuration, `session/new` selected the cloud-backed `opencode/big-pickle` model and fetched an approximately 3.2 MB provider catalog into the isolated cache.

The observed fetch was provider/model metadata resolution, not observed inference traffic. It is still a blocking product risk because it disproves any claim that an unconfigured OpenCode process is offline.

These items remain work in progress until the phase closes:

- prove that generated `opencode.json` configuration forces `intentsmith-local/<model>` through the run-scoped gateway;
- determine whether provider-catalog fetching can be disabled; otherwise document and policy-gate the residual network behaviour;
- finish the real probe for prompt outcome, `stopReason`, session updates, permissions, cancellation and gateway-token environment expansion;
- gate degraded-sandbox execution so it cannot be mistaken for safe real-project isolation;
- persist approvals, expiry and recovery semantics in Core;
- capture git-backed diffs into a `ProposedChangeSet`;
- cover worker crash and restart recovery points;
- expose worker operations through API and CLI;
- add an opt-in real-OpenCode suite;
- complete Phase 3 evidence, documentation, pull request and merge.

Nothing on the Phase 3 branch is advertised as stable merely because it has tests or because the ACP handshake succeeds.

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
- expertise composition runtime;
- skills workflow runtime;
- specialist plugin runtime;
- autonomous-agent scheduler;
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

## C3 semantic inheritance

No C3 source code is used by the stable IntentSmith runtime. The following
proven concepts are, however, explicit migration inputs rather than discarded
prototype ideas:

- 15 built-in expertises, deterministic auto-selection, 5D compatibility and
  composition of up to three profiles;
- controlled Skills with persisted checkpoints and result contracts;
- self-contained Specialists with manifest-driven lifecycle, deterministic
  tools, knowledge, scenarios, memory and telemetry;
- deterministic Autonomous Agents with scheduling, sources, conditions,
  edge-triggering and crash-safe deduplication;
- project lifecycle from specification and planning through milestone gates,
  review, change management and recovery.

Their current status is **documented for semantic extraction, not implemented in
IntentSmith**. See [Domain intelligence and autonomy](product/domain-intelligence.md).
