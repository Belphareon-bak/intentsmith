# Dependency Boundaries

## Package Boundaries

Initial Phase 1 workspace layout:

```text
apps/
  server/
  cli/
packages/
  contracts/
  core/
  persistence/
  testing/
```

Phase 1 implements only the minimum packages required for a fake-worker
headless flow:

- `packages/contracts`
- `packages/core`
- `packages/persistence`
- `packages/testing`
- `apps/server`
- `apps/cli`

## Allowed Dependencies

```text
apps/* -> packages/core
apps/* -> packages/contracts
apps/* -> packages/persistence
apps/server -> packages/testing (Phase 1 fake worker runtime only)
packages/core -> packages/contracts
packages/persistence -> packages/contracts
packages/testing -> packages/contracts
packages/testing -> packages/core
packages/testing -> packages/persistence
```

## Forbidden Dependencies

```text
packages/core -X-> packages/adapter-opencode
packages/core -X-> packages/adapter-openhands
packages/core -X-> packages/adapter-goose
apps/studio -X-> packages/persistence
worker adapters -X-> approvals database
LLM providers -X-> lifecycle state mutation
MCP tools -X-> direct side effects outside capability envelope
```

## Authority Rules

- IntentSmith Core owns lifecycle, task state, approvals, audit, and final verdicts.
- Workers propose actions, diffs, artifacts, and claims.
- Deterministic gates produce pass/fail evidence.
- LLM critics may recommend repair, but cannot convert deterministic failure to pass.
- The UI renders state and submits approvals through public APIs only.
