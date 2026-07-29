# Project status

Last updated: 2026-07-29.

## Phase 3 closure candidate

Phase 3 - OpenCode Worker POC, on `phase-3-opencode-worker`. Complete through
run 2F and a **closure candidate**: every Phase 3 gate has been executed
and recorded, and nothing required remains FAIL. The branch is pushed to
`origin` for review; **it is not merged and not tagged** — independent review
comes before integration.

Phase 1.1 is merged (`bd0a6a5`, PR #1) and tagged `phase-1.1`. Phase 2 is merged
(`ec87dd0`, PR #2) and tagged `phase-2`, which satisfies the Phase 3 entry gate.
Phase 3 reached a green H checkpoint at `0fca7fd` (inference-only OpenCode
integration, tool calling refused outright); Phase 3B built on it without
rewriting it, and runs 2A-2D built on Phase 3B.

The requirement-level audit against the original Phase 3 specification is
`docs/testing/phase-3-acceptance-matrix.md`, and the closure evidence is
`docs/testing/phase-3-results.md` with `artifacts/phase-3-verification.json`.

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
- Gateway binds only to loopback, issues run-scoped tokens and revokes all
  tokens on close.

### Verification

- Deterministic fake worker and provider.
- Virtual time for timeout tests.
- Shared contract suites.
- Executable dependency-boundary checks.
- Clean-tree and clean-clone verification.
- Default deterministic gates require no model, GPU, cloud service or external
  worker.

## Phase 3B Implementation

- The contract spike against the pinned real `opencode-ai@1.18.8` returned
  **PASS, conditional on an IntentSmith-generated permission config**
  (`docs/testing/phase-3b-tool-mediation-spike.md`). Under OpenCode's own
  defaults zero permission requests are emitted and a bash command wrote outside
  the workspace, so mediation is a property of the config IntentSmith writes.
- ADR 0017 records the four separations: the gateway translates and never
  executes, Core owns policy and approval state, an approval authorizes one
  action once against one payload, and no ACP type enters Core.
- The capability ledger classifies every observed tool. `read`/`glob`/`grep` are
  validated-only; `edit`/`write` need an approval; `bash`, `webfetch`, `skill`,
  `task` and `todowrite` are denied; anything unclassified is denied.
- Approvals are scoped to run + action + payload hash, expire, are consumed once
  and are revoked on cancel, timeout, failure and restart. There is no
  "always allow", and the adapter never selects `allow_always` however the agent
  orders its options.
- The gateway's tool path refuses what it cannot mediate rather than
  approximating it: forced or named `tool_choice`, parallel tool calls, tool
  turns with no advertised tools, oversized or too-deeply-nested schemas.
- Model profiles (ADR 0018) are Core-owned. A worker may ask; the profile
  decides. Only a model observed using the structured tool protocol may be given
  tools, and call-shaped prose is `MODEL_TOOL_PROTOCOL_ERROR`, never parsed.
- Single-GPU residency (ADR 0019) leases one model at a time, verifies an unload
  before switching, and derives `keep_alive` from the queue.
- Git-backed change capture reads what the worker actually changed, read-only,
  and a successful claim whose change set is unacceptable does not pass.
- 694 tests across 44 files at that checkpoint. The deterministic tests and
  build do not require OpenCode, Ollama, a GPU or another external runtime. The
  measured installation used an already populated pnpm store; network isolation
  and a cold-network installation were not proven.

## Phase 3 Runs 2A-2D

All four runs are complete. Each item below says which of four things it is:
**implemented and proven**, **partially proven**, **implemented but not
proven**, or **deferred**.

### Run 2A - fail-closed worker configuration

- *Implemented and proven*: an OpenCode configuration that cannot support
  mediation stops startup instead of quietly reverting to the fake worker;
  protocol retries are bounded by side-effect evidence rather than by a count;
  a code verdict requires Git-backed evidence; a permission left pending when a
  run ends is cleaned up rather than left suspended.

### Run 2B - executable authority stack

- *Implemented and proven*: `INTENTSMITH_WORKER=opencode` composes the adapter,
  the approval ledger, the capability mediator, Git evidence, the gates and
  run-scoped inference grants together, with no third state in which OpenCode
  runs without them. The run-scoped approval decision surface is executable over
  HTTP. Lifecycle and protocol evidence is persisted as structured records that
  carry no prompt, model response or wire payload. The terminal verdict cites
  trusted provenance IntentSmith read itself.

### Run 2C - pinned real binary

- *Implemented and proven*: against real `opencode-ai@1.18.8` and real local
  `qwen3:14b` on an RTX 3090, an approved edit reaches `passed` on a Git digest
  and IntentSmith-run gates, and four terminal paths — deny, cancel, timeout and
  worker termination, each with an approval outstanding — leave no side effect,
  no orphan process, no surviving gateway token and no suspended waiter.
  Evidence: `artifacts/phase-3-2c-real-binary.json`.
- *Implemented but not proven*: strict-offline execution, sandboxed
  (`preferSandbox`) execution, and concurrent runs sharing one Git working tree.
  The 2C run recorded these as not proven and they remain so.

### Run 2D - remote operator access

- *Implemented and proven*: the loopback default is unchanged; the VPN opt-in is
  explicit and any other value refuses; one runtime-supplied operator credential
  is required and is never generated, stored, substituted, logged, audited or
  returned; authentication is one `onRequest` hook registered before any route,
  so it runs before body parsing, validation and every handler, and nothing is
  public in remote mode; a wildcard bind and a hostname are refused; the worker
  gateway stays loopback-only with its own per-run tokens and rejects the
  operator credential.
- *Implemented and proven at process level*: the real entry point, spawned as a
  child process, exits non-zero on eight unsafe configurations, opens no
  listener, creates no database, and names the violated rule without echoing the
  supplied credential
  (`apps/server/src/startup-refusal.process.test.ts`).
- *Partially proven*: "direct public exposure is unsupported" is enforced only
  where the process can enforce it — a wildcard bind and a hostname are refused.
  A port forward in front of a correctly bound VPN interface is a documented
  boundary, not an enforced one.
- *Deferred by decision, not oversight*: rotation is a restart; there are no
  accounts, no roles and no rate limiting; the CLI does not send the credential
  and is local-only in this alpha. ADR 0020 records why each is acceptable and
  on what premise.

### Run 2F - restart recovery and closure

- *Implemented and proven*: recovery across a real Core death on the executable
  OpenCode composition. A child process running the product's own composition
  root reaches a pending approval and is SIGKILLed — a signal it cannot catch —
  leaving a `running` run row, an unanswered approval, an orphaned OpenCode
  process and a gateway token that existed only in the dead process's memory. A
  second Core on the same database closes the run as `failed` with a `blocked`
  verdict and reason `process_restart`, revokes the approval without ever
  granting it, writes the verdict before releasing what the run held, answers a
  late decision with 404, keeps the workspace unchanged, and is idempotent. A
  fresh run in the same workspace then reaches `passed` on a Git digest with its
  own approval, and the interrupted run's rows and audit trail are unchanged by
  it. No production code was changed: the regression passed against the
  composition as run 2E left it.
- *Proven again against the real binary*: run 2D moved the loopback peer check
  into a composed operator/approval guard, and 2C's product-level evidence
  predates that change. The approved-edit and deny-while-pending scenarios were
  re-run at the closure candidate against pinned `opencode-ai@1.18.8` and real
  local `qwen3:14b`, and both still behave exactly as 2C recorded.
- *Not supported, by decision*: the recovered **task** cannot start a new run of
  its own. ADR 0007 makes it terminal and ADR 0008 makes terminal statuses
  accept no lifecycle command, so a new attempt is a new task. The regression
  asserts that refusal rather than working around it.
- *Not possible, and not attempted*: cleaning up the worker a SIGKILLed Core
  left behind. Recovery records the process-group leader in the audit trail so
  an operator can find it, and never kills a pid recorded before a restart,
  because that pid may belong to something else by then.

### Partially proven across Phase 3

- **Version discovery.** ACP protocol version and agent capabilities are
  negotiated, recorded and refused on mismatch. The OpenCode *binary* version is
  operator-declared and verified by the real-binary harness, not discovered by
  the adapter. The Phase 3 test matrix now says so.
- **Shell policy.** `bash` is denied outright rather than approval-gated,
  because an approval for a command string cannot be bound to a workspace scope.
  This is stricter than the Phase 3 test matrix row used to say; the row has
  been corrected to state the policy that is actually implemented.

## Phase 3 Closure Work

All seven items are done and recorded in `docs/testing/phase-3-results.md`: the
restart-recovery regression, five identical deterministic full-suite runs, a
clean-clone `pnpm verify`, the results document and verification artifact, the
README, the CI status, and the two specification wording corrections.

The CI item is recorded honestly rather than favourably: the entry gate's run on
`main` is green and identified, and the closure candidate itself has no CI run
at all. Pushing the branch did not change that — the workflow triggers only on
pull requests and pushes to `main`, and no pull request is open.

## Phase 3B - Not Proven

- Parallel tool calls (refused, not supported).
- `skill`, `task`, `todowrite` and `webfetch` payload shapes and side effects.
- Strict-offline execution: NOT PROVEN while OpenCode fetches its provider
  catalog. "No cloud traffic observed" is not "cloud traffic impossible".
- Degraded-sandbox runs remain disposable-fixture-only. No real project.
- Model defaults. The ten-formulation robustness run supersedes the
  repeated-prompt scores and moved `qwen3.5:27b` from 30/30 to 91/100.
- A SIGKILL-orphaned OpenCode process may survive, but it has no usable
  in-memory gateway authority after Core dies.
- `ApprovalLedger.recoverAfterRestart()` is not wired directly into startup.

## Deferred Beyond Phase 1

- Run formal trademark and domain checks before final public naming.
- MCP, Serena, Studio, desktop distribution and shell execution remain
  unimplemented. Shell is not merely absent: `bash` is a denied capability.
- Ollama is implemented as of Phase 2, local-only. IntentSmith never installs
  Ollama, signs in, uses an API key, downloads a model, or contacts ollama.com.
- External workers and ACP are implemented as of Phase 3: the OpenCode adapter
  speaks ACP to a real child process, and the Phase 2 gateway is now a working
  integration rather than a foundation.
- Authentication is implemented as of run 2D, in exactly one shape: a single
  operator bearer token over a private VPN (ADR 0020). There are no accounts,
  roles, sessions or rotation, and the CLI does not send the credential.
- Concurrency is serialized per SQLite connection, and independent stores run
  independently. That is correct for a single local control-plane process;
  nothing coordinates two OS processes against one database file beyond
  SQLite's own locking and the configured busy timeout.
- Phase 3 implements only its evidence-bounded single protocol retry. Generic
  retry and multi-run orchestration remain later work.

## Completed phases

| Phase | Result |
| --- | --- |
| Phase 0 — foundation | Product boundaries, dependency research, ADRs and monorepo plan |
| Phase 1 — deterministic core | Lifecycle, SQLite, fake worker, localhost API and CLI |
| Phase 1.1 — contract stabilization | 14 audit findings plus per-store transaction-context isolation fixed; 202 tests |
| Phase 2 — local inference | Hardware director, Ollama provider and scoped worker gateway; 410 tests |

## Not implemented on stable `main` before Phase 3 integration

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
IntentSmith**. See [Domain intelligence and autonomy](product/domain-intelligence.md)
and the normative
[C3 Capability & Lifecycle Ledger](migration/c3-capability-lifecycle-ledger.md).
