# ADR 0004: Local API Framework

Status: accepted for Phase 0 review

Date: 2026-07-27

## Context

IntentSmith needs a localhost API for CLI, Studio, worker events, approvals,
audit inspection, and recovery. The API must be typed, testable, and easy to
run offline.

## Options

### Raw `node:http`

Pros:

- no framework dependency;
- very small runtime surface;
- direct control over request lifecycle.

Cons:

- own routing, validation, error formatting, OpenAPI generation, and test
  helpers would need to be built or assembled manually;
- higher risk of inconsistent boundary behavior.

### Fastify

Pros:

- mature local HTTP framework;
- strong testability through injection;
- JSON Schema integration;
- predictable lifecycle hooks;
- OpenAPI tooling available through plugins;
- low overhead for a local control plane.

Cons:

- additional dependency and plugin surface;
- plugin versions must be pinned and audited.

## Decision

Use Fastify in Phase 1 for the local API composition root, behind contracts
owned by `packages/contracts`.

Fastify is not domain logic. Core use-cases remain callable without HTTP.

## Consequences

- API boundary validation is a Phase 1 gate.
- Invalid payloads must fail before reaching core.
- OpenAPI output can be generated from the same schema definitions once stable.
