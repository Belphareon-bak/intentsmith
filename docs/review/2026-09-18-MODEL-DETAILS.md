# Model workspace: task details, catalogue and operational evidence

Status: IMPLEMENTATION_VERIFIED / INSTALLATION_PENDING / REVIEW_PENDING.
Authority: the operator's eight follow-up requests of 2026-09-18, after
`f5c5ccad`. This is a bounded UI/read-model/catalogue repair, not a new scoring
policy or a claim that a seven-task benchmark measures general coding ability.

## Changes

- Tables have visible row separators. Role alternatives have rank, a clickable
  model name and a separate aligned score. Role, quality and measurement-history
  headers sort their rows; unknown scores remain last.
- Evaluation results use bullets and human-readable task labels. Expanded tasks
  have one mean score, test type, grading notes and an information disclosure
  with criteria, source and repeat scores. Previously the API dropped `parts`,
  `penalties` and `schema`, causing blank numbered grading lists.
- History loads the selected immutable run through
  `GET /api/system/models/evaluations/:runId`. Current task descriptions are
  attached only when suite name, version and contract match. An older score is
  never replaced with the current result. Reconnect invalidates in-flight detail
  state, without replaying a mutation.
- The catalogue contains 76 entries, 33 marked with vision capability and 13
  dated in 2026. There are 23 entries with explicit release-date sources. This
  is a curated catalogue, not a claim to enumerate every published model.
  Qwen 3.5 vision metadata and dates and Devstral Small 2's date were corrected;
  Qwen3-VL, Qwen3.6/3.8, Gemma4 and Ministral3 variants were added. Verified
  catalogue fields override provisional discovery fields. Cloud/MLX tags are
  excluded from this local Linux candidate list. Missing release dates remain
  explicitly unverified; discovery timestamps are not release dates. The VISION
  filter and default newest-release sort make multimodal candidates discoverable.
- Governor reads completed gateway calls from `model_usage` and real project
  test exits from `m2_execution_results`. Case-insensitive `SUCCESS` is recognized;
  null outcomes are excluded from the success denominator and disclosed. Missing
  SQL sources fail explicitly. Empty available sources are `NO_ACTIVITY`, not
  invented 50% scores; counts alone do not become success rates. Trends do not
  overwrite measured scores. Coverage is the actual completed-role fraction.
  Idempotency now compares evidence as well as the aggregate score so fresh
  activity is not hidden behind an unchanged number.

## Why Coder scores 11.4%, and why it is fast

Live, read-only evidence for `qwen3-coder:latest`:
`eval_51da4e2a-7465-4837-b310-41305e890ccf`, artifact
`06c1097efce0431c2045fe7b2e5108366e43bee1b4603a7aded8f21689e90bca`,
CODE contract `6ee5ab47cbc4a42649835cac02d6cca82ad43d97ba12a9fbaa84276fe6fc7035`,
provider `0.34.0-intentsmith.1`, RESPONSE_BOUND. Seven JavaScript repair tasks,
three repeats each, 109278 ms. Six task means are zero; the response/error/
cancellation repair passes 4/5 targeted checks, scoring 0.8. Therefore
`(0 + 0 + 0 + 0 + 0.8 + 0 + 0) / 7 = 0.1142857`.

The 3m36s hunt duration also includes preparation. A previous 44s result reused
an older valid measurement; the current New test action already forces a new
measurement. This change exposes the actual complete current-suite scope at
confirmation and in the result. It does not artificially prolong inference or
introduce an unvalidated quick/full scoring contract. A broader 20–30 minute
benchmark remains separate work requiring broader tasks, not a timer.

## Six Governor sources versus six quality scores

Read-only production check: all six sources are readable. Models: 402 confirmed
calls in 30 days, without a failure denominator. CRE: one recorded success and
two outcomes not recorded. Builds: one real failed focused project test.
Architecture: no recorded audit. Specialists: 930 observability events, no
completed tool outcome in seven days. All seven bound roles have measurements.
These are distinct states. Six available collectors does **not** mean six
successful measurements; architecture and specialist quality cannot be claimed
until the corresponding real activity has occurred. Existing user data is not
seeded with synthetic events to fill those fields.

## Verification so far

Focused regression suites: read model 20/20, Governor 74/74, catalogue 22/22,
desktop hunt 30/30. Built Electron diagnostic journey loaded seven tabs from
actual production read evidence through the changed readers/routes, sorted
roles, opened Coder's grading, opened the older Qwen3.5 28.6% run, filtered VISION
with 2026 models, and observed six available Governor sources.

Evidence root (private):
`/home/belphareon/Projects/coworker/intentsmith-model-details-20260918`.
The diagnostic bridge forwards other GETs to the installed backend and rejects
mutations. It runs a private Electron profile, NODE_ENV=production and diagnostic
`--no-sandbox`. This is not yet the installed-backend journey.

Retained non-PASS attempts: first GUI script looked for the removed old column
heading and timed out (fixed selector); initial unit fixtures expected invented
0.5 fallbacks or omitted the renderer's color helper; a route test found a
missing handler return; LOC census needed refresh after source edits. The first
full-audit invocation correctly refused a dirty checkout. None is hidden as a
successful test; final results will be appended after clean-source validation.

## Catalogue provenance

- [Qwen news and dates](https://github.com/QwenLM/Qwen3.8#news),
  [Qwen3-VL news](https://github.com/QwenLM/Qwen3-VL#news).
- [Gemma4 launch](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/),
  [Gemma4 12B launch](https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemma-4-12b/).
- [Devstral 2](https://mistral.ai/news/devstral-2-vibe-cli/),
  [Mistral 3](https://mistral.ai/news/mistral-3/).
- Variant size/context/modality: official Ollama library pages linked in each
  refreshed entry. Download-size-based VRAM remains an estimate; runtime
  placement is still enforced by the existing measurement gate.

## Clean-source validation follow-up

The first full offline/database profile on `fa249009` finished 356 PASS / 3 FAIL.
Two failures were integration follow-ups: the isolated `m1-studio-client` VM
needed the existing color helper (132/132 after fixture completion), and the
static backend-capability inventory needed regeneration for the new read
endpoint (247 desktop declarations; unchanged 7 M7 transports / 17 operations).
The third failure is the inherited release seal; no seal or registry gate was
weakened. The CODE task label for the old-model selection fixture was also
narrowed to canonical deduplication rather than implying binding protection.
The read-model suite remains 20/20. A second full profile is pending.

The clean-snapshot Electron journey also passed alternative-model links,
ascending quality sort and the 7-task × 3-repeat confirmation. A separate
controlled HTTP 503 on the historical detail was disclosed and recovered through
Zkusit znovu. Screenshots were scrolled to the actual expanded detail, rather
than merely capturing an unrelated part of the tab.
