# ADR 0013: Model-Fit Estimation Is Separate From Execution Policy

Status: accepted for Phase 2

Date: 2026-07-28

## Context

Users want to know whether a model will run. The tempting implementation is to
compare the model's file size against VRAM and return a yes or no.

That answer would be false precision. A GGUF artifact is close to the weight
memory but is not the runtime requirement: the KV cache grows with context
length, the runtime adds compute buffers, weights may be memory-mapped, and
Ollama offloads layers to CPU when a model does not fit. Currently free VRAM
also differs from total VRAM, and on a multi-GPU machine nothing in the metadata
says whether the runtime will split a model across devices.

## Decision

Two functions with different jobs.

`assessFit` answers *what does the evidence suggest?* and cannot block. It
returns a classification (`likely_gpu_fit`, `may_partially_offload`,
`cpu_only_possible`, `unsupported_hardware`, `insufficient_data`,
`remote_forbidden`), a confidence, the exact evidence used, the assumptions it
rests on, warnings, and machine-readable reason codes.

`applyExecutionPolicy` answers *given what the user asked for, is that
acceptable?* and is the only thing that can return a blocking
`MODEL_FIT_REJECTED`. Policies are `gpu_required`, `gpu_preferred` and
`cpu_allowed`.

Rules the estimator follows:

- **VRAM is never summed across GPUs.** The largest single device is used and
  multi-GPU capacity becomes a warning. Adding cards together would convert an
  unknown into a confident wrong answer.
- Artifact size is evidence, not a requirement. The overhead factor is stated in
  the returned assumptions rather than hidden in the code.
- Free VRAM is preferred over total; when free is unknown the estimate is
  labelled optimistic and confidence drops.
- Not fitting in GPU memory is `may_partially_offload`, not a failure. Slower is
  not the same as impossible.
- Unknown stays unknown. A missing artifact size gives `insufficient_data` with
  confidence `none`, never a default of zero.
- A remote model is forbidden regardless of how well it would fit.

`MODEL_TOO_LARGE` is deliberately absent from the Ollama transport error
vocabulary, per ADR 0012.

## Consequences

- `gpu_required` blocks on `insufficient_data`, because a policy that demands
  GPU execution cannot be satisfied by a guess.
- `cpu_allowed` never blocks on missing evidence, because not knowing is not the
  same as knowing it will fail.
- Every assessment is auditable: a user can see the inputs, the assumptions and
  the reason codes rather than a bare verdict.
