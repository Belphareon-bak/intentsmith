# Phase 2 Verification Results

Date: 2026-07-28

Baseline: `bd0a6a5dbfc17cd9a692dcedaaf6c4599893648b` (Phase 1.1 merge, tagged `phase-1.1`)

Branch: `phase-2-ollama-hardware`

## Result

All deterministic gates pass on Node.js 22.21.1 and pnpm 11.17.0.

```text
pnpm install --frozen-lockfile  PASS
pnpm typecheck                  PASS
pnpm lint                       PASS
pnpm test                       PASS (25 files, 410 tests)
pnpm test:coverage              PASS (gates met)
pnpm build                      PASS
pnpm verify                     PASS
```

The deterministic tests and build do not require Ollama, NVIDIA hardware, a
model or another external runtime: every transport and probe is injected. The
measured installation used an already populated pnpm store; network isolation
and a cold-network installation were not proven. The full suite was run five
times with identical results.

The gateway lifecycle tests are the only ones that open a real socket, because
loopback binding is precisely what they verify. They use an ephemeral port and
close every handle, so they cannot collide with a parallel run or leak a
listener.

## Test Counts

| | Test files | Tests |
|---|---|---|
| Phase 1.1 (`bd0a6a5`) | 18 | 202 |
| Phase 2 | 25 | 410 |

## Coverage

```text
Statements   91.65% (1834/2001)
Branches     83.10% (1033/1243)
Functions    90.02% (397/441)
Lines        93.37% (1677/1796)
```

Phase 1.1 gates were not lowered. New per-file gates cover the Phase 2 security
surface: endpoint policy, remote-execution detection, the scheduler, the NDJSON
reader, DTO parsing and the model-fit estimator.

## Upstream Behaviour Pinned

Observed against a live local daemon; see `docs/third-party/ollama.md`.

- Ollama version `0.17.7`
- `/api/version`, `/api/tags`, `/api/show`, `/api/ps`, `/api/generate` response
  shapes recorded verbatim
- Streaming is NDJSON, terminal record marked `done: true`
- All durations are nanoseconds; IntentSmith keeps the raw integer as evidence
- Errors are `{"error":"..."}`, but an unknown route returns plain text, so a
  JSON error body is never assumed
- Deprecated `context` state is not used as IntentSmith memory

## Local-Only Enforcement

Fourteen endpoint forms are rejected before any socket opens, including
ollama.com, HTTPS, public addresses, private LAN ranges, link-local, arbitrary
hostnames, userinfo, path manipulation, query strings, non-HTTP protocols and
malformed ports. Redirects are disabled and a cross-origin response is a
protocol error. Outbound headers are an allowlist; `Authorization`, cookies and
API-key headers throw rather than being silently dropped.

## Cloud Rejection

A request to `127.0.0.1:11434` is not automatically local: a signed-in Ollama
serves cloud models through the same socket. Enforcement is metadata-driven.

Proven by test:

- a remote-backed model is marked `remote_forbidden` in discovery, with a reason;
- generation is refused at preflight with `REMOTE_INFERENCE_FORBIDDEN`;
- remote metadata appearing **mid-stream** aborts immediately, and no token
  after the offending record is emitted;
- a locally addressed, otherwise healthy daemon cannot make IntentSmith accept
  cloud-backed output;
- the worker gateway filters remote models out of `/v1/models` entirely.

The `-cloud` name suffix is recorded as a warning and never enforces alone.

## Hardware Director

Provider-independent, with injected probes. `nvidia-smi` runs through
`execFile` with no shell, a frozen argument list, no user input, a bounded
timeout and an output cap. Missing `nvidia-smi`, permission denial, timeout and
malformed CSV are each distinct reported states, never crashes.

Live values are always collected, never hardcoded. On the development machine
the probe reported driver `590.48.01` on an RTX 3090; the implementation
contains no driver version at all.

Uncertainty is explicit: absent metadata stays `unknown` rather than becoming
zero, and a device reporting no VRAM downgrades the profile to `partial`.

## Model Fit

Estimate and policy are separate (ADR 0013). `assessFit` returns a
classification, confidence, the evidence used, its assumptions, warnings and
reason codes, and cannot block. `applyExecutionPolicy` is the only thing that
can return `MODEL_FIT_REJECTED`.

VRAM is never summed across GPUs. Artifact size is treated as evidence, not a
measured requirement, and the overhead factor is stated in the returned
assumptions rather than hidden.

## Scheduler

One active generation by default, FIFO, abortable while queued, bounded queue
with a timeout on an injected timer, idempotent release, deterministic shutdown
drain. Concurrency is configurable only through validated local configuration;
GPU count is deliberately not treated as a concurrency signal, because Ollama
may split one model across devices.

## Startup Recovery

Runs before the server binds (ADR 0014). A failure stops startup rather than
serving from a half-recovered database. Verified for zero, one and multiple
interrupted runs, idempotency across a second startup, failure preventing
listen, and exposure through both API and CLI. Interrupted work is never
auto-retried.

## Worker Inference Gateway

Off by default: it listens only when `INTENTSMITH_GATEWAY=1` or
`INTENTSMITH_GATEWAY_PORT` is set, on an ephemeral port unless one is
configured. The bind host is never read from configuration.

Loopback-only, per-run bearer token required on every route even on loopback,
constant-time comparison, expiry, revocation on run end and shutdown, tokens
never persisted or logged. Closing the gateway revokes every outstanding token. Reuses the same provider, Hardware Director,
model-fit policy and scheduler as the normal API. Surface is deliberately
minimal (`/v1/models` plus the chat shape the Phase 2 provider supports);
Phase 3 extends it only after probing a pinned OpenCode build.

## Optional Real-Ollama Suite

`pnpm test:ollama`, separate config, never part of `pnpm verify` or CI.
Requires `INTENTSMITH_RUN_REAL_OLLAMA=1` and an already installed model in
`INTENTSMITH_OLLAMA_TEST_MODEL`. It never pulls a model, signs in, uses an API
key or contacts ollama.com. A missing daemon or model is reported BLOCKED,
never PASS.

Executed on the development machine: **PASS**.

- Ollama `0.17.7`, endpoint `http://127.0.0.1:11434`
- Model `qwen3:14b`, digest
  `bdbd181c33f2ed1b31c972991882db3cf4d192569092138a7d29e973cd9debe8`,
  classified `local`
- Fit `likely_gpu_fit`, confidence `high`
- 17 prompt tokens, 16 completion tokens, 12.9s total
- `/api/ps` confirmed the model resident in VRAM after the run
- Cancellation of a second generation was requested and observed
- No prompt text and no generated output recorded
  (`promptRecorded: false`, `responseRecorded: false`)
- GPU UUID stripped from the evidence before writing

Time to first token was recorded as `null`: the 16-token budget was consumed by
this model's thinking phase, so no visible response token was emitted. The
completion-token count confirms generation occurred. Reported as observed rather
than adjusted.

Suite output is written to `artifacts/phase-2-ollama-suite.json` and is **not**
committed.

## Known Limitations

- The remote-marker field names are not specified in Ollama's public API docs.
  Detection is defensive and proven against fixtures; this installation has no
  cloud models available to test against a live signed-in daemon.
- IntentSmith cannot verify at OS level that the local daemon is not itself
  proxying to a remote host. That would need OS-level network isolation, which
  is out of Phase 2 scope.
- The gateway chat surface flattens messages onto a single prompt because that
  is what the Phase 2 provider supports. It is not full multi-turn chat.
- Concurrency is enforced in-process; a second IntentSmith process has its own
  scheduler.
- Swap and per-volume storage are not probed; they stay `undefined` rather than
  being guessed.
- No worker exists yet. The gateway is a foundation, not an integration.

## Environment Confirmations

- No new runtime dependency was added; the adapter uses the Node runtime's own
  `fetch` behind an injectable seam. An Ollama SDK was rejected because it would
  bring cloud defaults, auth behaviour and hidden retries.
- No cloud API was called. CI uses no secrets and runs no Ollama.
- No model was downloaded and no `ollama pull` was executed by IntentSmith.
- No driver, CUDA or Ollama installation was modified.
- The C3 reference at `a7b90e36aa80310305703f54f2332e1c0e7f9e8f` was read-only
  and is byte-for-byte unchanged.
