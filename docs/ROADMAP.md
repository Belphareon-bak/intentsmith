# Roadmap

## Phase 0 - Foundation Decisions

Status: ready for review.

Outputs:

- greenfield repository;
- product thesis;
- status and roadmap;
- ADRs 0001 to 0005;
- P0 third-party component records;
- dependency boundary proposal;
- minimal contract schema proposal;
- Phase 1 to Phase 4 test matrix.

Milestone tag: `foundation-decisions`.

## Phase 1 - Monorepo, Contracts, and Deterministic Vertical Slice

Status: complete.

Goal: start a minimal typed vertical slice without a real LLM or external worker.

Expected outputs:

- pnpm workspace;
- strict TypeScript;
- `packages/contracts`;
- `packages/core`;
- `packages/persistence`;
- fake worker adapter;
- localhost Fastify lifecycle API;
- CLI lifecycle commands with text and JSON output;
- minimal SQLite migrations;
- unit, contract, persistence, integration, API, and CLI tests.

Acceptance:

- clean install;
- typecheck passes;
- lint passes;
- tests pass offline;
- invalid API boundary payloads are rejected;
- a task can be created, run through a fake worker, cancelled, resumed, and audited;
- `Task` and `TaskRun` are separate so retries and evidence remain immutable.

Verification: `docs/testing/phase-1-results.md` and
`artifacts/phase-1-verification.json`.

## Phase 1.1 - Contract Stabilization, Adversarial Tests, and CI Baseline

Status: complete.

Goal: independently verify Phase 1, fix what the audit found, and make the
integration base trustworthy enough that Phase 2 can test a real adapter with
the same contract suite as the fake.

Outputs:

- independent audit of Phase 1 with a recorded verdict (FAIL, remediated);
- concurrency-safe transactions and per-task command serialization;
- lifecycle commands validated separately from state edges (ADR 0008);
- deferred finalization for a worker that completes while paused;
- injected timer so timeouts are deterministic;
- restart recovery policy for interrupted runs (ADR 0007);
- per-store transaction context isolation (ADR 0010);
- automatically enforced dependency boundaries;
- reusable WorkerAdapter contract suite;
- minimal InferenceProvider port and FakeInferenceProvider (ADR 0009);
- adversarial lifecycle, persistence/recovery, security, and API/CLI
  negative-path suites;
- coverage reporting with regression gates;
- GitHub Actions CI.

Acceptance:

- `pnpm verify` passes from a clean install;
- a dependency boundary violation fails `pnpm verify`;
- race tests are deterministic across repeated runs;
- no real Ollama call, HTTP inference client, or cloud fallback exists.

Verification: `docs/testing/phase-1-1-results.md` and
`artifacts/phase-1-1-verification.json`.

## Phase 2 - Ollama and Hardware Director

Status: complete (branch `phase-2-ollama-hardware`).

Goal: run the first local model through a provider contract.

Verification: `docs/testing/phase-2-results.md` and
`artifacts/phase-2-verification.json`. ADRs 0011-0015.

Delivered: port ownership moved to `packages/inference`; local-only Ollama
adapter passing the unchanged provider contract suite; metadata-driven cloud
rejection; Hardware Director with injected probes; model-fit estimation
separated from execution policy; provider scheduler; startup recovery before
listen; API and CLI surfaces; loopback-only worker inference gateway; 402
offline tests plus a separate opt-in real-Ollama suite.

Expected outputs:

- Ollama adapter;
- health and model discovery;
- GPU, VRAM, and RAM detection;
- hardware profile;
- model fit estimator;
- single-GPU semaphore;
- timeout and cancel;
- local streaming;
- OpenAI-compatible localhost adapter as a contract test double.

Deferred from Phase 2 to a later phase: OS-level network isolation proving the
daemon is not itself proxying remotely, and full multi-turn chat on the worker
gateway.

## Phase 3 - OpenCode Worker POC

Blocked until Phase 2 is merged into `main`, CI is green, and an annotated
`phase-2` tag exists.

Goal: delegate one coding task to OpenCode while preserving core authority.
The Phase 2 gateway is the only inference path a worker may use; Phase 3 extends
it only after probing a pinned OpenCode build and documenting the requirement.

Expected outputs:

- disposable fixture repository;
- OpenCode external process adapter;
- capability and version discovery;
- normalized event stream;
- proposed diff collection;
- approval before risky actions;
- deterministic test evidence;
- cancel, timeout, and recovery tests.

## Phase 4 - MCP and Serena

Goal: use external code intelligence instead of rebuilding LSP and symbol analysis.

Expected outputs:

- MCP client/server boundary;
- Serena adapter;
- capability map;
- symbol lookup;
- references;
- diagnostics;
- rename proof of concept;
- audited tool calls;
- unavailable-Serena fallback.
