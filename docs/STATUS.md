# Status

## Current Phase

Phase 3 - OpenCode Worker POC, on `phase-3-opencode-worker`. Complete through
run 2F and a **local closure candidate**: every Phase 3 gate has been executed
and recorded, and nothing required remains FAIL. **It is not merged, not tagged
and not pushed** — independent review comes before integration.

Phase 1.1 is merged (`bd0a6a5`, PR #1) and tagged `phase-1.1`. Phase 2 is merged
(`ec87dd0`, PR #2) and tagged `phase-2`, which satisfies the Phase 3 entry gate.
Phase 3 reached a green H checkpoint at `0fca7fd` (inference-only OpenCode
integration, tool calling refused outright); Phase 3B built on it without
rewriting it, and runs 2A-2D built on Phase 3B.

The requirement-level audit against the original Phase 3 specification is
`docs/testing/phase-3-acceptance-matrix.md`, and the closure evidence is
`docs/testing/phase-3-results.md` with `artifacts/phase-3-verification.json`.

## Reference State

- Source repository: `Belphareon-bak/C3-agent`
- Local reference path: `/home/belphareon/Projects/c3-agent-wip`
- Reference commit: `a7b90e36aa80310305703f54f2332e1c0e7f9e8f`
- Current repository: `/home/belphareon/Projects/intentsmith`
- Current repository purpose: local deterministic control-plane implementation

## Product Names

- Whole product: IntentSmith
- Local control plane: IntentSmith Core
- Theia IDE: IntentSmith Studio
- Worker layer: IntentSmith Workers
- Workflow and specialist layer: IntentSmith Skills
- Desktop distribution: IntentSmith Forge Local
- CLI: `intentsmith`
- Main package: `intentsmith-core`

## Phase 1 Implementation

- Existing C3 worktree was inspected and left unmodified.
- No source file from C3 was copied into this repository.
- The workspace contains contracts, core, SQLite persistence, testing utilities,
  localhost Fastify API, and the `intentsmith` CLI.
- The fake worker uses no shell, network, LLM, or external process.
- Core owns lifecycle transitions, final verdicts, and audit meaning.
- `Task` and `TaskRun` are separate by ADR 0006.
- Phase 1 verification evidence is stored in
  `artifacts/phase-1-verification.json`.

## Phase 1.1 Implementation

- An independent audit of Phase 1 returned **FAIL**: every declared gate passed,
  but four defects broke guarantees the Phase 1 documentation and ADR 0006
  claim. All four were reproduced before any code changed and now have
  regression tests. Details in `docs/testing/phase-1-1-results.md`.
- Transactions are concurrency-safe and lifecycle commands are serialized per
  task, so two overlapping requests produce a domain error rather than a raw
  SQLite failure.
- Lifecycle commands are validated as commands, not bare state edges, so resume
  works only from `paused` (ADR 0008).
- A worker that completes while its task is paused is finalized on resume
  instead of having its outcome dropped.
- Worker timeouts run on an injected timer, so no test result depends on machine
  speed.
- Interrupted runs found after a restart are closed as failed with a blocked
  result and are never auto-restarted (ADR 0007).
- Dependency boundaries are enforced automatically and fail `pnpm verify`.
- A reusable WorkerAdapter contract suite and a minimal InferenceProvider port
  with `FakeInferenceProvider` exist (ADR 0009). No real provider is implemented
  and the port is not wired into the task lifecycle.
- Coverage is reported with regression gates, and GitHub Actions runs
  `pnpm verify` on pull requests and pushes to `main`. The clean-tree gate uses
  `git status --porcelain`, so a new untracked artefact fails the build too.
- A post-audit review of the Phase 1.1 changes found that the reentrant
  transaction context was module-level and therefore shared between separate
  `SQLiteStore` instances, which could drop a nested store's rollback. The
  context is now owned by the store instance (ADR 0010).
- Test count went from 54 to 196; the suite runs faster because timeouts are
  virtual.

## Phase 2 Implementation

- The `InferenceProvider` port moved from Core into `packages/inference` so a
  concrete adapter never depends on Core (ADR 0011).
- `packages/adapter-ollama` implements the unchanged provider contract against a
  local Ollama daemon, pinned against observed version `0.17.7`.
- Local-only endpoint policy and metadata-driven remote-model rejection
  (ADR 0012). A request to `127.0.0.1:11434` is not automatically local: a
  signed-in Ollama serves cloud models over the same socket, so enforcement uses
  `remote_model`/`remote_host` metadata at discovery, preflight and every stream
  record. The `-cloud` name suffix is advisory only.
- `packages/hardware` reports evidence without false precision and never
  modifies the machine. `nvidia-smi` runs through a dedicated read-only probe
  with no shell and a frozen argument list. Driver versions are always read
  live, never hardcoded.
- Model-fit estimation is separate from execution policy (ADR 0013). VRAM is
  never summed across GPUs, and unknown stays unknown.
- Provider scheduler: one active generation by default, FIFO, bounded queue.
- Startup recovery runs before the server binds and stops startup on failure
  (ADR 0014), resolving the invocation point ADR 0007 deferred.
- A loopback-only worker inference gateway (ADR 0015) gives a future external
  worker the same guarantees as the user's own API, behind a per-run token.
- 402 tests across 24 files; `pnpm verify` stays fully offline.

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
- 694 tests across 44 files; `pnpm verify` stays fully offline.

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
at all, because the branch is deliberately not pushed and the workflow triggers
only on pull requests and pushes to `main`.

## Phase 3B - Not Proven

- Cancel, timeout and process failure while a permission is outstanding, against
  the real binary.
- Parallel tool calls (refused, not supported).
- `skill`, `task`, `todowrite` and `webfetch` payload shapes and side effects.
- Strict-offline execution: NOT PROVEN while OpenCode fetches its provider
  catalog. "No cloud traffic observed" is not "cloud traffic impossible".
- Degraded-sandbox runs remain disposable-fixture-only. No real project.
- Model defaults. The ten-formulation robustness run supersedes the
  repeated-prompt scores and moved `qwen3.5:27b` from 30/30 to 91/100.

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
- Retry policy is represented in contracts; retry orchestration begins in a
  later phase.
