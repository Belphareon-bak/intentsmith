# ADR 0015: Loopback-Only Worker Inference Gateway

Status: accepted for Phase 2

Date: 2026-07-28

## Context

A future external worker such as OpenCode expects an OpenAI-shaped inference
API. There are three ways to give it one, and two are wrong.

Pointing the worker at a cloud endpoint abandons the local-first guarantee
outright. Pointing it directly at Ollama is only slightly better: the worker
would then bypass the model-fit policy, the scheduler and the remote-model
rejection, and could select a cloud-backed model that IntentSmith would have
refused. In both cases IntentSmith would be unable to state what actually ran.

## Decision

Workers get inference only through an IntentSmith gateway that runs inside
IntentSmith Server and reuses the same `InferenceProvider`, Hardware Director,
model-fit policy, local-only endpoint checks and scheduler as the normal API. A
worker therefore cannot obtain a capability the user's own API surface does not
have.

Controls:

- binds to loopback only;
- ephemeral or explicitly configured port;
- **every route requires an IntentSmith-issued per-run bearer token, even on
  loopback.** Loopback is not an authorization boundary: every process on the
  machine can reach the port. The token is scoped to one TaskRun, compared in
  constant time, revoked when the run ends and when the server stops, and
  expires on its own;
- tokens live in memory only. They are never written to the database, an audit
  payload, an artifact, or a log line, and never appear in a response;
- remote-backed models are filtered out of `/v1/models` and refused at
  generation;
- cancellation and scheduler limits propagate, so a worker cannot starve the
  user's own requests;
- no cloud fallback exists anywhere in the gateway.

The surface is deliberately minimal: `/v1/models` plus the chat shape the Phase
2 provider genuinely supports, which is a prompt with optional system framing.
Assistant turns are flattened into transcript text rather than pretended to be
real multi-turn support.

Unknown request fields are rejected rather than silently dropped, so a worker
asking for a capability Phase 2 does not implement is told, instead of having
its request quietly reinterpreted.

## Off by default

The gateway does not listen unless the operator sets `INTENTSMITH_GATEWAY=1` or
configures `INTENTSMITH_GATEWAY_PORT`. No external worker exists yet, and an
unused listener is attack surface with no corresponding benefit. The port is
ephemeral unless one is configured, so the usual case leaves nothing
predictable to aim at, and the host is never read from configuration: loopback
is not negotiable.

Closing the gateway revokes every outstanding token, so no token can outlive
the listener that would honour it.

## Why not guess the full OpenCode surface now

Phase 2 has not probed a pinned OpenCode build. Implementing endpoints against
an assumed contract would ship surface that nothing tests and that may not match
what OpenCode actually sends. Phase 3 extends the gateway only after probing the
pinned version and documenting the requirement.

## Consequences

- The gateway is testable today without OpenCode existing.
- Everything a worker can do through it is already covered by the local-only and
  cloud-rejection tests, because it shares the enforcement path.
- Phase 3 inherits a working token lifecycle rather than inventing one under
  time pressure.
