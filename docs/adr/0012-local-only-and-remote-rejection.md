# ADR 0012: Local-Only Endpoint Policy and Remote-Model Rejection

Status: accepted for Phase 2

Date: 2026-07-28

## Context

IntentSmith is local-first. The obvious implementation of that promise —
"only talk to `127.0.0.1:11434`" — is not sufficient.

A signed-in Ollama installation serves cloud-hosted models through the same
loopback socket as local ones. As of 2026-07-28 the Ollama library lists
cloud-tagged models including Gemini 3 Flash Preview, GLM-5.1, Minimax and Kimi
variants, Nemotron-3-Super and DeepSeek-V4. **The address therefore proves
nothing about where the tokens are produced.**

Model naming is not sufficient either. A `-cloud` suffix is a convention, and a
convention is not an enforcement mechanism: it can be absent on a remote model
and present on a local one.

## Decision

Two independent controls.

**Endpoint policy** (`packages/inference/src/endpoint-policy.ts`) runs in the
adapter constructor, so an illegal endpoint fails before any socket exists.
Only plain HTTP to a loopback host is permitted. HTTPS is refused too: a local
daemon needs no TLS, and permitting it widens the surface for a proxy that
terminates somewhere else. Userinfo, paths, query strings, malformed ports,
public addresses, private LAN ranges, arbitrary hostnames and ollama.com are all
rejected. Redirects are disabled, and a response whose final URL is not the
configured origin is treated as a protocol error.

Outbound headers are an allowlist. The process environment, cookies,
`Authorization` and any API-key header are never forwarded, and an attempt to
attach one throws rather than being silently dropped, so a mistake is loud.

**Remote-model rejection** (`packages/inference/src/remote-policy.ts`) is based
on metadata. A non-empty `remote_model` or `remote_host` anywhere in a
`/api/tags`, `/api/show` or `/api/generate` payload marks the model
`remote_forbidden`. The check runs at discovery, again as a generation
preflight, and again on **every stream record**, so a daemon that looks local
when the model is selected cannot switch to a remote backend mid-stream. The
name suffix is recorded as a warning and never enforces on its own.

A new error code, `REMOTE_INFERENCE_FORBIDDEN`, is added to the provider
vocabulary. It is deliberately distinct from:

- the transport errors, which all describe something going wrong while talking
  to a local daemon and may be retryable or environmental. Here the transport
  worked perfectly and the answer is refused anyway;
- `MODEL_TOO_LARGE`, which is a hardware-fit judgement about a model that is
  legitimately local.

It is never retried and never falls back to another provider.

## Consequences

- Remote models still appear in discovery, marked `remote_forbidden` with a
  reason, so a user can see *why* something is unavailable rather than having it
  silently vanish.
- The worker gateway filters them out of `/v1/models` entirely, because a worker
  has no use for a model it may not run.
- The public Ollama API documentation does not specify these fields, so the
  enforcement is defensive and is proven against fixtures rather than a live
  signed-in daemon. If upstream renames them, the nested search still finds them
  by key anywhere in the payload, and the contract suite documents the
  expectation.
