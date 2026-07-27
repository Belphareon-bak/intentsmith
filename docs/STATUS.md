# Status

## Current Phase

Phase 1.1 - Contract stabilization, adversarial tests, and CI baseline.

Phase 1 (`ed21dd8`) is published on `origin/main`. Phase 1.1 lives on
`phase-1-1-contract-stabilization`.

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

## Deferred Beyond Phase 1

- Run formal trademark and domain checks before final public naming.
- Ollama, external workers, ACP, MCP, Serena, Studio, desktop distribution,
  authentication, and shell execution remain unimplemented. The
  `InferenceProvider` port added in Phase 1.1 is a boundary definition only.
- `recoverInterruptedRuns()` is implemented and tested but is not yet invoked
  automatically at server startup; that needs a product decision about how the
  user is informed.
- Concurrency is serialized per SQLite connection, and independent stores run
  independently. That is correct for a single local control-plane process;
  nothing coordinates two OS processes against one database file beyond
  SQLite's own locking and the configured busy timeout.
- Retry policy is represented in contracts; retry orchestration begins in a
  later phase.
