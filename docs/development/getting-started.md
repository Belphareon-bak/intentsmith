# Development guide

## Prerequisites

- Node.js `>=22 <23`
- pnpm `11.17.0` through Corepack
- Git
- a C/C++ build toolchain supported by `better-sqlite3`

Ollama, a GPU and external workers are optional. The default verification suite does not require them.

## Install and verify

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

Useful focused commands:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:coverage
pnpm build
```

The repository must remain clean after verification. Generated coverage output is ignored; unexpected generated project state is a failure.

## Run the local service

Start the Fastify server:

```bash
pnpm build
pnpm --filter @intentsmith/server start
```

Then use the CLI:

```bash
pnpm --filter intentsmith start version
```

The API is intentionally localhost-only. Do not add a configurable bind host without a new threat model and architecture decision.

## Optional Ollama verification

Install and start Ollama separately, pull a model compatible with the local machine, then run:

```bash
pnpm test:ollama
```

The real suite is opt-in because it depends on machine hardware and locally installed software. It must not replace deterministic provider tests.

## Monorepo responsibilities

| Path | Responsibility |
| --- | --- |
| `apps/cli` | User-facing commands and transport formatting |
| `apps/server` | Local API and composition root |
| `packages/contracts` | Runtime schemas and public data shapes |
| `packages/core` | Use cases, lifecycle, policy and verdicts |
| `packages/persistence` | SQLite and recovery |
| `packages/hardware` | Sanitized hardware profile and fit policy |
| `packages/provider-ollama` | Ollama-specific translation |
| `packages/testing` | Fakes, fixtures and integration harness |

Packages introduced on development branches are listed in [STATUS.md](../STATUS.md). Do not make stable documentation depend on them before merge.

## Change workflow

1. Read the relevant contract, ADR and threat model.
2. Reproduce a bug with the smallest failing test or probe.
3. Change the narrowest owning package.
4. Run focused tests during iteration.
5. Run the complete `pnpm verify` gate before review.
6. Update current documentation and phase evidence in the same pull request.
7. Keep generated files, local databases, model payloads and credentials out of Git.

## Testing rules

- Test externally observable behaviour, not fake implementation details.
- Run the same contract suite against fake and real adapters.
- Use virtual time for deterministic timeout behaviour.
- Keep real sockets and processes limited to tests that genuinely prove those boundaries.
- Never weaken thresholds, skip tests or mark failures flaky to close a phase.
- For nondeterminism, reproduce repeatedly and wait on observable conditions instead of sleeping.
- Include negative paths: malformed input, cancellation, timeout, duplicate terminal events, restart and cleanup.

## Architecture rules

- Core must not import adapter or persistence implementations.
- Adapters must not write task state or persistence.
- Runtime validation happens where untrusted data crosses a boundary.
- Vendor/protocol types remain in their adapter package.
- `child_process` execution uses argument arrays, never a shell command string.
- Capabilities are declared truthfully and policy-gated.
- A pass is calculated from evidence only.

Executable boundary checks supplement this guide; see [dependency boundaries](../architecture/dependency-boundaries.md).

## Adding a provider

1. Run the unchanged inference-provider contract suite against the new adapter.
2. Keep transport payloads private to the adapter.
3. Map timeout, cancellation and failure to stable domain errors.
4. Define model-fit policy in the Hardware Director, not the transport.
5. Add a separate opt-in real integration suite.
6. Document network behaviour and data retention.

## Adding a worker

1. Implement truthful `describe()` capability discovery.
2. Run the unchanged worker contract suite.
3. Validate every protocol message and session identifier.
4. Supervise the process without a shell and guarantee terminal cleanup.
5. Request local inference only through a run-scoped gateway capability.
6. Persist approvals and change evidence through Core APIs.
7. Add adversarial fixtures and a separate real-executable suite.

## Dependencies

Before adding a runtime dependency, record:

- exact package and version;
- license;
- integrity/provenance;
- runtime dependencies and install scripts;
- why the existing platform or dependency set is insufficient;
- which package owns the dependency.

Prefer official stable protocol SDKs when they preserve required lifecycle guarantees. A version constant is not a substitute for observing the actual wire handshake.

## Documentation workflow

- Update [STATUS.md](../STATUS.md) with exact stable and development evidence.
- Update [ROADMAP.md](../ROADMAP.md) only when sequencing or scope changes.
- Add an ADR before changing a durable architecture decision.
- Preserve historical ADRs and reports; add a superseding record instead of rewriting them.
- Keep the root README concise and link detailed explanations here.
