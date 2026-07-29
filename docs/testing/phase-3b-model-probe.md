# Phase 3B Local Model Probe

Date: 2026-07-28

**Status: development evidence. Not a release quality gate.**

This records what the local hardware and the installed Ollama models actually do
when driven with structured tool calls, so that Phase 3B model profiles rest on
measurement rather than on assumption. It does not decide the Phase 3B contract
gate — that is
[`phase-3b-tool-mediation-spike.md`](phase-3b-tool-mediation-spike.md) — and it
does not by itself justify a shipped default.

## Environment

| Item | Value |
|---|---|
| GPU | NVIDIA GeForce RTX 3090, 24576 MiB |
| Driver | 590.48.01 |
| Ollama | 0.17.7, `127.0.0.1:11434` |
| Transport | `POST /api/chat` with `tools`, structured `tool_calls` only |
| Sampling | `temperature: 0`, `num_predict: 512` |
| Scenarios | 10 cases x 3 repetitions per model |

The ten cases cover tool selection (`read_package`, `find_tests`), editing
(`edit_version`, `read_then_edit`), security posture (`path_escape`,
`denied_command`, `strict_local_docs`), a no-tool control (`general_question`),
recovery (`tool_error_repair`) and command lifecycle (`run_tests`).

## Results

| Model | Score | Median generation | Verdict |
|---|---|---|---|
| `qwen3.5:27b` | 30/30 | 32.3 tok/s | most reliable universal local worker |
| `devstral-small-2:24b` | 24/30 | 50.4 tok/s | coding-experimental; see lifecycle note |
| `qwen3-coder:30b` | 21/30 | 143.0 tok/s | **quarantined for tool use** |
| `qwen3:14b` (thinking on) | 19/30 | 68.5 tok/s | invalid profile, see below |
| `qwen3:14b` (`think: false`) | **30/30** | 74.8 tok/s | accepted fast profile |

## The 19/30 score is a configuration result, not a capability result

`qwen3:14b` with thinking enabled spent the whole 512-token budget reasoning and
never emitted a tool call in 12 responses. The same model, same prompts, same
temperature, with `think: false` passed every scenario and ran faster.

Both halves are kept deliberately:

- **negative configuration proof** — thinking plus a 512-token output budget
  prevents tool use on this model;
- **accepted profile proof** — `think: false` passes the full scenario set.

The 19/30 figure must therefore never be carried forward as this model's
capability score. `think` is a per-model profile field, not a global default.

## Textual pseudo-calls: `qwen3-coder:30b`

Six responses emitted prose containing a fake call instead of a structured
`tool_calls` array, for example:

```
I'll help you find all test and spec files in the workspace. Let me search for
files that match common test and specification patterns.

<function=list_files>
```

This is why the model is quarantined for tool use. It is also the fastest model
measured (143 tok/s median), which makes it tempting and therefore worth stating
plainly:

**Text that resembles a tool call is untrusted text.** It is never parsed and
never executed heuristically. The condition is classified as
`MODEL_TOOL_PROTOCOL_ERROR`, retried at most once, and then blocked or failed
over to a compatible model. The model remains usable for non-side-effecting code
generation.

## Command lifecycle scoring: `devstral-small-2:24b`

Both failing cases (`run_tests`, `denied_command`) are lifecycle-shaped: the
model read `package.json` before choosing a test command. Reading the manifest
before selecting a command is legitimate behaviour, not a failure, so the scorer
must evaluate the whole permitted sequence rather than only the first tool call.

A command workflow fails only when the model never reaches the required command,
cycles, or falsely claims the capability is unavailable. The 24/30 figure was
produced by first-call scoring and is retained only as a record of that scorer's
behaviour.

## GPU residency

Sampled with `nvidia-smi` for 3h08m across the probe session (5652 samples):

```
peak memory.used   23981 MiB of 24576 MiB  (97.6 %)
```

A single 27B model at Q4 occupies roughly 22-23 GiB, which leaves no room for a
second large model. With `keep_alive: "10m"` in effect, loading another large
model while the previous one was still resident returned HTTP 500. The raw error
body was not captured in the recorded run and the observation is therefore
recorded at the strength it has: a reproducible-looking residency conflict
observed live, not a preserved wire sample.

The conclusion that survives regardless of that gap is structural: on a
single 24 GiB GPU, two large models cannot be resident at once, so residency has
to be scheduled explicitly rather than left to eviction. `keep_alive: "10m"` is
wrong as a universal policy — it holds VRAM precisely when the next queued job
needs it for a different model.

## Prompt robustness

Repeating one identical prompt at temperature 0 proves determinism, not
robustness. A second run therefore replayed the same ten cases across **ten
distinct formulations each** — 100 scenarios per model, 300 in total, for the
three non-quarantined models.

| Model | Repeated prompts | Ten formulations |
|---|---|---|
| `qwen3:14b` (`think: false`) | 30/30 | **98/100** |
| `qwen3.5:27b` | 30/30 | **91/100** |
| `devstral-small-2:24b` | 24/30 | **90/100** |

This changes the reading of the first run, which is exactly why it was required.
`qwen3.5:27b` was perfect on repeated prompts and lost nine scenarios once the
wording varied — including two `path_escape` cases, the security-shaped one.
The fast profile was the most robust of the three.

Failures by case:

```
devstral-small-2:24b  run_tests 6, denied_command 2, edit_version 1, read_then_edit 1
qwen3.5:27b           read_then_edit 3, edit_version 2, run_tests 2, path_escape 2
qwen3:14b             edit_version 1, read_then_edit 1
```

`devstral`'s concentration in `run_tests` remains consistent with the first-call
scoring artefact described above.

**No model default is fixed by this either.** The run establishes that the
repeated-prompt scores overstated reliability; picking a default still needs the
lifecycle-aware scorer and a decision about what a `path_escape` failure rate
above zero means for a model allowed to propose edits.

## What this evidence does not establish

- It is not a release gate and no model default is fixed by it.
- The residency conflict has a structural conclusion but no preserved wire
  sample.
- Scoring predates the lifecycle-aware scorer for command workflows.
- No claim is made about any model's behaviour under a real OpenCode session;
  this probe drives Ollama directly.
