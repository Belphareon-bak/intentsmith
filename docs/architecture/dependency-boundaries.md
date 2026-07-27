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
apps/* -> packages/inference
apps/* -> packages/hardware
apps/server -> packages/adapter-ollama (composition root only)
apps/server -> packages/testing (Phase 1 fake worker runtime only)
packages/core -> packages/contracts
packages/core -> packages/inference
packages/core -> packages/hardware
packages/persistence -> packages/contracts
packages/inference -> (nothing)
packages/adapter-ollama -> packages/inference
packages/hardware -> packages/inference
packages/testing -> packages/contracts
packages/testing -> packages/core
packages/testing -> packages/persistence
packages/testing -> packages/inference
```

`packages/inference` deliberately depends on nothing, so a concrete adapter can
implement the port without pulling in Core (ADR 0011). Only `apps/server` may
instantiate a concrete adapter.

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

## Enforcement

These rules are executable. `tools/architecture/boundaries.test.ts` scans the
sources and fails `pnpm test`, and therefore `pnpm verify`, when a boundary is
crossed. It is a deterministic scan rather than an extra lint dependency.

Enforced rules:

```text
contracts      -X-> core, persistence, fastify, better-sqlite3
core           -X-> fastify, better-sqlite3, concrete worker adapter,
                    adapter-ollama, inference vendor SDK
inference      -X-> core, persistence, hardware, adapter-ollama, fastify,
                    better-sqlite3, inference vendor SDK
adapter-ollama -X-> core, persistence, hardware, fastify, better-sqlite3
hardware       -X-> core, persistence, adapter-ollama, fastify, better-sqlite3
persistence    -X-> fastify
worker adapter -X-> persistence, better-sqlite3
CLI            -X-> better-sqlite3, persistence
server route   -X-> better-sqlite3 (composition in runtime.ts is exempt)
```

Two additional checks run alongside them:

- no runtime source may reference a non-local URL, so no code path can reach a
  cloud or inference endpoint;
- every cross-package import must be declared in that package's manifest.

Test files are exempt, because a test may import whatever it needs to drive the
system under test.

`apps/server -> packages/testing` remains allowed for the Phase 1 fake worker
runtime. To keep that exception safe, the package entry point re-exports no
module that imports a test framework, and `FakeWorker` lives in its own module
that does not import persistence.

## Authority Rules

- IntentSmith Core owns lifecycle, task state, approvals, audit, and final verdicts.
- Workers propose actions, diffs, artifacts, and claims.
- Deterministic gates produce pass/fail evidence.
- LLM critics may recommend repair, but cannot convert deterministic failure to pass.
- The UI renders state and submits approvals through public APIs only.
