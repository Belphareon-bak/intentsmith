# Local model evaluation strategy

## Status

This document records research inputs and a deferred evaluation strategy. It is
not an implementation plan, a commitment to reuse C3 benchmark code, or a
stable assignment of models to IntentSmith roles.

IntentSmith must first prove the provider, worker, capability and evidence
contracts needed by a model evaluation harness. The concrete corpus, weights,
thresholds and model-role policy require a later ADR.

## Why preserve this now

A single successful prompt only proves that one model produced one expected
answer under one formulation. It does not establish:

- structured tool-protocol compatibility;
- correct tool selection when several tools are available;
- safe behaviour after denial, malformed input or a tool error;
- robustness to equivalent prompt formulations;
- the quality of a completed multi-turn code change;
- cold-load, warm-run and model-switch GPU behaviour;
- stability over repeated real tasks.

C3 explored several complementary forms of local-model evaluation. The useful
asset is the separation of evidence layers and the failure lessons, not the
legacy runner implementation.

## C3 evaluation lessons to retain

C3 used four distinct evidence layers:

1. **Role-oriented deterministic suites** for reasoning, code, chat, review and
   vision. A runner invoked a named local model, applied deterministic graders
   and stored per-test and per-suite results.
2. **Repeated response-quality benchmarks** across search, facts, technical,
   strict, multi-domain and edge prompts. Reports included distributions,
   standard deviation, p95, tail risk, language drift and possible bimodality,
   rather than only a mean score.
3. **Long project scenarios** that exercised specification, planning, build,
   repair, review and checkpoint flows against real local models. Full
   transcripts and generated projects supported review of the final artefact.
4. **Empirical runtime signals** such as patch success, checkpoint success,
   iterations, tokens, duration and remaining errors. External benchmark weight
   decreased only after enough local samples existed.

These layers answered different questions and should not be collapsed into one
headline score.

### Known C3 limitations

The legacy evidence cannot be adopted as-is:

- conversational quality suites did not prove structured tool transport;
- selecting a different model often required changing active configuration
  rather than running an immutable model matrix;
- some suites reported failed assertions without a failing process exit;
- an aggregate pass threshold could hide a failed category;
- project assertion counts could remain green while milestones were blocked;
- some stored validation rows replaced the previous result instead of keeping
  immutable run history;
- at least one model comparison extrapolated a single real project run into
  simulated larger sample counts and estimated tokens from turns.

Any IntentSmith harness must make these distinctions visible and must never
turn incomplete, blocked or failed evidence into a pass.

## Proposed staged evaluation

The stages below are a research direction. A later ADR must decide the exact
contracts and promotion thresholds.

### Stage 0: transport and eligibility gate

Run this before spending GPU time on response quality. A model is eligible for
tool-bearing roles only if the observed local provider transport proves:

- native structured tool calls using the advertised schema;
- valid tool name and arguments without a parallel prose answer;
- explicit failure classification when the provider/model does not support
  tools;
- no parsing of call-shaped prose as a tool call;
- compatibility with the bounded context and cancellation contract.

A model that fails this gate may still be evaluated for a no-tool role, but it
must not be promoted to a tool-bearing profile.

### Stage 1: tool selection, policy and repair

Present several tools simultaneously, for example `read_file`, `list_files`,
`edit_file`, `run_command` and `webfetch`. Scenarios should include:

- read a known manifest;
- find tests without assuming one fixed repository layout;
- edit a version using the edit capability rather than a shell workaround;
- run the declared test command;
- answer a general question without invoking a tool;
- remain local when remote access is forbidden;
- reject or clarify a path that escapes the workspace;
- continue safely, or stop truthfully, after a denied command;
- use a read result in a subsequent edit;
- correct invalid arguments after a tool error instead of repeating them.

Each semantic scenario should have at least ten meaning-preserving
formulations. The suite should report per-scenario pass rate, worst case, p95,
tail failures and repeated-error patterns. Repeating one identical prompt is a
stability probe, not a robustness benchmark.

### Stage 2: finalist multi-turn coding benchmark

Only models that pass the eligibility and tool-selection gates should run the
expensive project suite. Each run needs an isolated repository fixture and must
be judged primarily by:

- the resulting git diff and declared-scope alignment;
- deterministic build, test, lint and security gates;
- correct use of evidence from earlier tool results;
- bounded repair after a real gate failure;
- approval and denial compliance;
- the final IntentSmith verdict and terminal state.

Correctly naming a tool or producing a plausible transcript is insufficient.
`blocked`, skipped, incomplete and user-aborted outcomes remain distinct from
`pass`.

### Stage 3: GPU residency and switching

Measure both inference and residency behaviour on the target hardware:

- cold model load;
- warm generation throughput and latency;
- peak and steady VRAM;
- unload latency and VRAM reclaimed;
- a small-model to large-model to small-model sequence;
- behaviour under cancellation and queued work.

The initial high-value sequence is the current fast candidate, then the current
deep candidate, then the fast candidate again. Concrete model names remain
probe results, not stable defaults, until the benchmark and Hardware Director
policy promote them.

### Stage 4: empirical local evidence

After deployment, retain role- and task-type-attributed outcomes such as:

- accepted change sets;
- deterministic gate and checkpoint results;
- iterations and repair count;
- tokens, duration and model switching cost;
- classified failures and errors remaining.

Empirical evidence should gain ranking weight gradually. It must not override a
hard safety, transport, hardware-fit or policy failure.

## Evidence integrity requirements

Every real run should produce an immutable record containing:

- run and suite version;
- exact model identifier, digest and quantization;
- provider and worker versions;
- prompt/scenario identifier and formulation identifier;
- sampling, context and tool-schema parameters;
- hardware and relevant residency measurements;
- tool transcript, deterministic gate evidence and terminal state;
- durations, token counts and classified errors.

Reruns append new records. They do not overwrite earlier outcomes. Reports may
derive aggregates, but promotion decisions must remain traceable to the source
runs.

The harness process must exit non-zero when a required gate or category fails.
Coverage discovery must come from the executable suite registry or filesystem,
not a manually maintained count.

## Open decisions

The later ADR must resolve:

- the role/profile vocabulary and whether `fast`, `coding`, `deep` and
  `coding-deep` remain separate;
- promotion, demotion and blacklist thresholds;
- corpus versioning and contamination controls;
- deterministic graders versus bounded human review;
- how many repetitions justify confidence;
- retention and privacy policy for prompts, diffs and model responses;
- which evidence is advisory and which forms a hard runtime gate.

Until those decisions are made, model measurements are evidence snapshots, not
product defaults.
