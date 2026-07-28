# Status

## Current Phase

Phase 2 - Local Ollama provider, Hardware Director and worker inference gateway.

Phase 1.1 is merged (`bd0a6a5`, PR #1) and tagged `phase-1.1`. Phase 2 lives on
`phase-2-ollama-hardware`.

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

## Deferred Beyond Phase 1

- Run formal trademark and domain checks before final public naming.
- External workers, ACP, MCP, Serena, Studio, desktop distribution,
  authentication, and shell execution remain unimplemented.
- Ollama is implemented as of Phase 2, local-only. IntentSmith never installs
  Ollama, signs in, uses an API key, downloads a model, or contacts ollama.com.
- No worker exists yet; the Phase 2 gateway is a foundation, not an integration.
- Concurrency is serialized per SQLite connection, and independent stores run
  independently. That is correct for a single local control-plane process;
  nothing coordinates two OS processes against one database file beyond
  SQLite's own locking and the configured busy timeout.
- Retry policy is represented in contracts; retry orchestration begins in a
  later phase.
