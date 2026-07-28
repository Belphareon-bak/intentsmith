# Contributing to IntentSmith

IntentSmith welcomes focused fixes, tests, documentation and adapter work that preserve its local-first and evidence-driven guarantees.

## Before changing code

Read:

1. [Product vision](docs/product/vision.md)
2. [Domain intelligence and autonomy](docs/product/domain-intelligence.md)
3. [Architecture overview](docs/architecture/overview.md)
4. [Current status](docs/STATUS.md)
5. [Roadmap](docs/ROADMAP.md)
6. the relevant [ADR](docs/adr/) and threat model

For implementation setup, see the [development guide](docs/development/getting-started.md).

## Ground rules

- Core owns lifecycle and verdict authority.
- Providers and workers are replaceable adapters.
- No feature may silently fall back to cloud inference.
- Unsupported or degraded capabilities are reported honestly.
- Runtime contracts and negative tests accompany boundary changes.
- Deterministic evidence, not agent confidence, produces a pass.
- Historical decisions and evidence are preserved.

## Pull requests

Keep a pull request scoped to one coherent change. Its description should state:

- the problem and user impact;
- the owning package or boundary;
- guarantees added or changed;
- tests and real-integration evidence;
- security or privacy impact;
- known limitations and follow-up work.

Draft pull requests are encouraged for architecture or integration work. Do not mix phase work with unrelated refactors.

## Required checks

From a clean checkout:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

Focused tests are useful during development, but the complete gate is required before merge. Do not lower coverage thresholds, skip a failing case or weaken a shared adapter contract to make a contribution pass.

## Architecture decisions

Add an ADR when changing:

- package ownership or dependency direction;
- durable task/run lifecycle semantics;
- persistence or recovery policy;
- an external protocol or SDK decision;
- trust boundaries, authentication or sandbox policy;
- product-wide naming or distribution.

If evidence reverses an earlier decision, add a superseding ADR and explain the observed evidence. Do not silently edit history.

## Dependencies and upstream integrations

Prefer a maintained official library when it exposes the lifecycle guarantees IntentSmith requires. Before adding a dependency, record its version, license, integrity, runtime dependency graph, install scripts and ownership.

Real integrations need both:

- a deterministic fake/contract suite that runs on every pull request;
- an opt-in suite against an observed upstream version before the phase closes.

## Documentation

User-visible behaviour, status, architecture and security claims must be updated in the same pull request as the code. Current documentation must stand on its own; references to predecessor prototypes may appear only in clearly historical research or ADR context.

## Security

Read [SECURITY.md](SECURITY.md) before contributing process execution, filesystem access, model transports, credentials or remote integrations. Report vulnerabilities privately through GitHub's Security tab.
