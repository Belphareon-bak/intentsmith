# IntentSmith documentation

This directory is the standalone source of truth for understanding IntentSmith. A reader should not need another repository or the history of an earlier prototype to understand the product, architecture or roadmap.

## Start here

| Question | Document |
| --- | --- |
| What problem does IntentSmith solve? | [Product vision](product/vision.md) |
| How do Expertises, Skills, Specialists and Agents differ? | [Domain intelligence and autonomy](product/domain-intelligence.md) |
| How do the pieces work together? | [Architecture overview](architecture/overview.md) |
| What is stable today? | [Current status](STATUS.md) |
| What is being built next? | [Roadmap](ROADMAP.md) |
| How do I run or change it? | [Development guide](development/getting-started.md) |
| What are the security boundaries? | [Security policy](../SECURITY.md) |
| How can I contribute? | [Contributing guide](../CONTRIBUTING.md) |

## Architecture and contracts

- [Architecture overview](architecture/overview.md) explains runtime flow, ownership and trust boundaries.
- [Dependency boundaries](architecture/dependency-boundaries.md) defines allowed package directions and their executable checks.
- [Minimal contracts](architecture/minimal-contracts.md) explains the stable domain records and invariants.
- [Architecture decision records](adr/) preserve the reasoning behind consequential choices.

The runtime schemas in `packages/contracts/src/index.ts` and executable contract suites are authoritative when prose and code disagree.

## Verification and evidence

- [Phase test matrix](test-matrix-phase-1-to-4.md) maps guarantees to tests.
- `docs/testing/` contains phase verification reports.
- `artifacts/` contains machine-readable evidence produced by completed gates.
- `docs/reports/` contains audits and close-out reports.

## Third-party research

`docs/third-party/` records point-in-time research about upstream projects and protocols. These files support dependency decisions, but they are not promises that a component is already integrated or supported.

## Documentation rules

1. Current documents describe IntentSmith without relying on another repository.
2. Stable functionality and work in progress are labelled separately.
3. Security claims state what has been proved, not what an architecture merely intends.
4. Phase evidence is preserved; historical ADRs and reports are not rewritten to make the past look cleaner.
5. A code change that alters behaviour, boundaries or sequencing updates the related document in the same pull request.
