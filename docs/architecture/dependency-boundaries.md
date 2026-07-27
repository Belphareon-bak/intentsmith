# Dependency Boundaries

## Package Boundaries

Initial Phase 1 workspace layout:

```text
apps/
  server/
  cli/
  studio/
packages/
  contracts/
  core/
  lifecycle/
  policy/
  governance/
  hardware/
  inference/
  persistence/
  telemetry/
  worker-sdk/
  adapter-opencode/
  adapter-mcp/
  adapter-serena/
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
packages/core -> packages/contracts
packages/core -> packages/lifecycle
packages/core -> packages/policy
packages/core -> packages/governance
packages/core -> packages/hardware
packages/core -> packages/inference
packages/core -> packages/persistence
packages/core -> packages/telemetry
packages/core -> packages/worker-sdk
packages/adapters/* -> packages/contracts
packages/adapters/* -> packages/worker-sdk
packages/testing -> packages/contracts
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
