# Status

## Current Phase

Phase 1 - Monorepo, contracts, and deterministic vertical slice.

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

## Deferred Beyond Phase 1

- Run formal trademark and domain checks before final public naming.
- Ollama, external workers, ACP, MCP, Serena, Studio, desktop distribution,
  authentication, and shell execution remain unimplemented.
- Retry policy is represented in contracts; retry orchestration begins in a
  later phase.
