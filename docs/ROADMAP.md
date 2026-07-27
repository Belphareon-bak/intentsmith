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

## Phase 1 - Monorepo, Contracts, and Test Harness

Goal: start a minimal typed skeleton without a real LLM.

Expected outputs:

- pnpm workspace;
- strict TypeScript;
- `packages/contracts`;
- `packages/core`;
- `packages/persistence`;
- fake inference provider;
- fake worker adapter;
- server health endpoint;
- CLI health and version commands;
- minimal SQLite migrations;
- unit and contract test harness.

Acceptance:

- clean install;
- typecheck passes;
- lint passes;
- tests pass offline;
- invalid API boundary payloads are rejected;
- a task can be created, run through a fake worker, cancelled, resumed, and audited.

## Phase 2 - Ollama and Hardware Director

Goal: run the first local model through a provider contract.

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

## Phase 3 - OpenCode Worker POC

Goal: delegate one coding task to OpenCode while preserving core authority.

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
