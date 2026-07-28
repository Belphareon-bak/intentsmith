# ADR 0019: Single-GPU Model Residency

Status: accepted for Phase 3B

Date: 2026-07-28

## Context

During the Phase 3B probe, GPU memory was sampled for 3h08m on an RTX 3090 and
peaked at 23981 of 24576 MiB — 97.6 %. A single 27B model at Q4 leaves no room
for a second large one. With `keep_alive: "10m"` in effect, loading another large
model while the previous was still resident returned HTTP 500.

The raw error body was not preserved, so that specific observation is recorded
at the strength it has. The structural conclusion does not depend on it: two
large models cannot be co-resident on 24 GiB.

## Decision

Residency is scheduled explicitly by a manager under the Hardware Director,
rather than left to the daemon evicting something eventually. "Eventually" is
what produced the failure.

- **One exclusive lease per GPU.** Concurrent requests queue.
- **A switch waits for the running inference to finish**, then unloads the
  previous model through the daemon's HTTP API with `keep_alive: 0`, then
  **verifies it is no longer resident** before loading the next. "Asked to
  unload" and "unloaded" are different claims and only the second may be acted
  on.
- **No CLI, no shell.** Not `ollama`, not `nvidia-smi`. A product that shells out
  to manage its own memory inherits that process's environment, PATH and
  version.
- **`MODEL_RESIDENCY_CONFLICT` is its own error code**, distinct from inference
  and model failures. The daemon is healthy and the model is fine; the memory is
  occupied. Retrying the request is right; retrying it as though the model were
  broken is not.
- **`keep_alive` is derived from the queue**, not fixed. Same model next: retain
  briefly. Different model next: unload immediately. Nothing queued: the
  configured idle window. A universal 10-minute TTL is wrong in both directions
  — it wastes a reload in the first case and starves the next job in the second.
- **The queue is served strictly in arrival order.** Serving same-model requests
  first would be faster and would let a stream of fast jobs starve a deep one
  indefinitely.
- **A cancelled request leaves the queue.** Handing a lease to a caller that has
  given up would pin the GPU until code that no longer exists released it.

## Consequences

Throughput is lower than letting the daemon juggle models, and deliberately so:
the alternative is an HTTP 500 whose cause is invisible from the error.

Switching is proven against a fake daemon in both directions, `qwen3.5:27b` to
`qwen3-coder:30b` and back, so the scheduling logic is tested without a GPU. A
real-hardware version stays opt-in alongside the Ollama suite.

This manager governs residency only. It does not choose models, does not decide
fitness, and holds no policy about which model a task should use; those remain
with model-fit assessment and the profiles in ADR 0018.
