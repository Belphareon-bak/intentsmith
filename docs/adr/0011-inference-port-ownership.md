# ADR 0011: Inference Port Ownership and Adapter Direction

Status: accepted for Phase 2

Date: 2026-07-28

## Context

Phase 1.1 placed the `InferenceProvider` port in `packages/core`. That was fine
while the only implementation was a fake living in `packages/testing`, which
already depended on Core.

A real adapter changes the picture. `packages/adapter-ollama` implements the
port, so with the port inside Core the adapter would have to depend on Core.
That inverts the intended direction: Core is the authority that *uses* a
provider, not a library that providers build on. It would also drag lifecycle,
persistence ports and domain errors into a package whose only job is
translating one vendor's HTTP API.

## Decision

The port moves to a new `packages/inference` that depends on no other
IntentSmith package.

```text
packages/inference       port, normalized types, endpoint policy,
                         remote-execution detection, scheduler
packages/adapter-ollama  depends on inference only; Ollama HTTP and DTOs
packages/hardware        hardware discovery and model-fit; uses the
                         ModelDescriptor type from inference
packages/core            may depend on inference and hardware,
                         never on a concrete adapter
apps/server              composition root; the only place that may
                         instantiate an adapter
```

The endpoint policy, remote-execution detection and the scheduler live in
`packages/inference` rather than in the adapter, because they are provider
*rules* rather than Ollama details. A second adapter must inherit them, not
reimplement them.

`tools/architecture/boundaries.test.ts` enforces every arrow above, so a
regression fails `pnpm verify` rather than being caught in review.

## Consequences

- The provider contract suite is unchanged and still passes, which is the point:
  the Ollama adapter is held to exactly the same bar as the fake.
- No compatibility re-export was left in Core. There is one definition of the
  port, and the move was mechanical.
- Adding a vendor SDK import to Core or to `packages/inference` now fails a test.
