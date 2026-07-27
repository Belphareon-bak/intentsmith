# ADR 0009: Minimal InferenceProvider Port Before Any Real Provider

Status: accepted for Phase 1.1

Date: 2026-07-27

## Context

Phase 2 introduces a real local model provider. Defining that boundary while
writing the first adapter would let one vendor's HTTP shape leak into core, and
would leave no way to prove that a second provider behaves the same.

## Decision

`packages/core/src/inference.ts` defines the port and nothing else. Phase 1.1
ships no HTTP client, no model download, no hardware probing, and no wiring into
the task lifecycle.

The port covers provider identity, health, capability discovery, model
discovery, one generation request, a stream of normalized events, timeout,
`AbortSignal` cancellation, normalized errors, and explicit stream completion.
No vendor endpoint, header, or response structure appears in core.

Stable error codes:

```text
PROVIDER_UNAVAILABLE
MODEL_NOT_FOUND
REQUEST_INVALID
REQUEST_TIMEOUT
REQUEST_CANCELLED
STREAM_INVALID
PROVIDER_PROTOCOL_ERROR
```

`MODEL_TOO_LARGE` is deliberately excluded. Model fit depends on hardware and
policy, which is the Phase 2 Hardware Director's responsibility, not a
transport-level provider error.

A provider never throws out of its stream; it emits a terminal `failed` event.
Exactly one terminal event (`completed` or `failed`) ends a stream, and nothing
may follow it.

## Consequences

- `FakeInferenceProvider` and a future real adapter are checked by the same
  suite in `packages/testing/src/provider-contract.ts`, unchanged.
- Adding a vendor SDK import to core fails the dependency boundary test.
