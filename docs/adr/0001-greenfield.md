# ADR 0001: Greenfield Product

Status: accepted for Phase 0 review

Date: 2026-07-27

## Context

C3 is large, historically layered, and currently under stabilization. A direct
refactor would mix stabilization, architecture change, and external component
integration in one regression surface.

## Decision

IntentSmith starts as a new repository and does not copy C3 source files.

C3 is a read-only reference for:

- product lessons;
- test scenarios;
- safety failures;
- lifecycle concepts;
- architectural constraints.

## Consequences

- New code must be justified by contracts and tests rather than inherited shape.
- Selective ports require characterization tests and ADRs.
- Phase 1 begins from typed contracts and fake adapters, not production C3 code.
