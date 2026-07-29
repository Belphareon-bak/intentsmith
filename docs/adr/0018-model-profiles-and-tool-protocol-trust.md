# ADR 0018: Model Profiles and Tool-Protocol Trust

Status: accepted for Phase 3B

Date: 2026-07-28

## Context

Phase 3B lets a worker call tools. Which local model serves that worker stops
being a performance question at that point and becomes a safety one: a model
that does not speak the structured tool protocol will still produce something
that *looks* like a tool call.

The probe recorded in `docs/testing/phase-3b-model-probe.md` measured four local
models on an RTX 3090 and found two things that cannot be inferred from a model
card:

- `qwen3:14b` with thinking enabled spent its whole 512-token output budget
  reasoning and emitted no tool call in 12 responses. The same model with
  `think: false` passed every scenario and ran faster. Its 19/30 score was a
  configuration result, not a capability.
- `qwen3-coder:30b` emitted `<function=list_files>` as ordinary prose in six
  responses. It is the fastest model measured, at 143 tok/s, and it is named
  after coding.

## Decision

**Inference settings are a Core-owned profile, not a worker request.** A worker
may ask; the profile decides. A smaller output budget is the caller's business,
a larger one is not, a different temperature is recorded as overruled rather
than blended in, and thinking is not negotiable at all — a worker that could
re-enable it on `qwen3:14b` would silently remove that model's ability to call
tools. What actually ran, including which fields were overruled, is reported for
run evidence.

**Tool calling requires observed evidence of the tool protocol.** Each profile
carries `toolProtocol`:

- `structured` — observed emitting structured tool calls;
- `quarantined` — observed emitting call-shaped prose;
- `unobserved` — never measured.

Only `structured` models may be given tools. Plain inference is unaffected for
all three, because that path has been safe since Phase 2 and refusing it would
break existing behaviour for no gain.

Every catalogued Phase 3 profile is explicitly **PROVISIONAL**. Probe evidence
permits bounded development use; it does not silently promote a model to a
verified release default. The thinking-enabled `qwen3:14b` configuration is
retained separately as an `INVALID_NEGATIVE_FIXTURE`, not as a selectable
profile, so the failure cannot disappear from regression coverage.

**Text that resembles a tool call is untrusted text.** It is never parsed and
never executed heuristically. The condition has its own error code,
`MODEL_TOOL_PROTOCOL_ERROR`, separate from transport failures, because the
correct handling differs: at most one safe retry, then block the model for tool
use or fall back to a compatible one.

## Consequences

A model IntentSmith has not measured cannot be handed tools, which is
restrictive and is the point: finding out how a model behaves by letting it
drive edits is not a test anyone should run.

`qwen3-coder:30b` stays available for non-side-effecting code generation. Its
speed is exactly why the rule is written down rather than left to judgement.

The profiles in this ADR are **not** release defaults. The repeated-prompt
scores that produced them prove determinism, not robustness; the follow-up run
over ten formulations per case moved `qwen3.5:27b` from 30/30 to 91/100 and left
the fast profile the most robust of the three. Fixing a default additionally
needs lifecycle-aware scoring for command workflows, and a decision about what a
non-zero `path_escape` failure rate means for a model allowed to propose edits.
