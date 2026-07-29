# Local Validation Runner Foundation

Status: LV-0 implementation foundation, after the annotated `phase-3` closure
gate. It does not claim that an overnight or week-long run has happened.

## Safety contract

The runner resolves one 40-character Git commit, refuses a dirty source, and
executes only in an owned detached Git worktree below the configured run root.
Each execution gets a new owned session identifier plus isolated `HOME` and
`XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME` and `XDG_STATE_HOME`.
Cleanup requires the live session marker to match. A PID or process group read
from a checkpoint is never signalled because it may have been reused.

Run IDs match `^[a-z0-9][a-z0-9_-]{0,63}$`. Existing non-resume run
directories are immutable history and are refused.

The result vocabulary is exactly `PASS`, `FAIL` or `BLOCKED`. `BLOCKED` is only
a missing precondition. Timeout, crash, non-zero exit, deterministic invariant
failure, leak or redaction failure are `FAIL`. `SKIPPED` exists only as an
internal scheduler/checkpoint state.

JSON is authoritative. The Markdown summary is rendered from the JSON object,
and its test reloads JSON before comparing the generated Markdown.

## Commands

Dry-run is the default and performs read-only Git checks:

```sh
corepack pnpm local-validation -- \
  --source /absolute/path/to/clean/intentsmith \
  --revision 6676902c5f6fe7a5d66aba0d79cb502e0f3a60e4 \
  --runs-root /absolute/path/to/disposable/evidence \
  --run-id lv-dry-1
```

It emits the exact revision, paths, isolated environment, explicit scenario
manifest, preconditions, commands, expected versions, blocker policy,
fingerprints and artifact destinations. It does not create a worktree or run
OpenCode, Ollama, a database or a scenario.

Execution has two independent opt-ins:

```sh
INTENTSMITH_RUN_LOCAL_VALIDATION=1 \
corepack pnpm local-validation -- --execute \
  --source /absolute/path/to/clean/intentsmith \
  --revision 6676902c5f6fe7a5d66aba0d79cb502e0f3a60e4 \
  --runs-root /absolute/path/to/disposable/evidence \
  --run-id lv-smoke-1 \
  --opencode-bin /absolute/path/to/opencode
```

Execution does not install OpenCode, Ollama, a model or a GPU driver. It checks
for exactly OpenCode 1.18.8, local Ollama `qwen3:14b`, an RTX 3090 and an idle
GPU. A missing, mismatched or busy prerequisite records `BLOCKED` and does not
disturb any process or model. Project dependencies are materialized only in the
disposable worktree with a frozen, offline pnpm install.

Resume adds `--resume` and is accepted only when source commit, runner version,
scenario manifest, model profile and options fingerprints match. Corrupt,
incompatible and stale checkpoints fail closed. BLOCKED and scheduler-SKIPPED
work may be attempted later. Earlier FAIL attempts remain in the authoritative
history and keep the aggregate deterministic verdict at FAIL.

## Initial profile and manifest

The opt-in profile is:

- `opencode-ai@1.18.8`;
- local Ollama with `qwen3:14b`;
- `NVIDIA GeForce RTX 3090`;
- concurrency exactly one;
- strict offline explicitly **NOT PROVEN**.

The LV-1 smoke manifest is deliberately limited to `approved-edit` and
`deny-while-pending`, using the Phase 3 product-level real-binary harness.

## systemd

The package contains a pure unit/timer renderer only. It defaults to 00:30 in
`Europe/Prague`, sets `Persistent=false`, requires absolute paths and uses
`flock`. Rendering neither installs, enables nor starts a unit. Installation is
a separate, explicit operator action and is not part of LV-0.

## Baseline and evidence

`artifacts/local-validation-baseline.json` is the explicit, immutable Phase 3
closure baseline. Later runner artifacts compare their structure to it.
Differences are evidence; only deterministic invariants decide a verdict.
Raw attempts and behavioural observations stay in JSON, while the Markdown
summary clusters scenario IDs by structured reason.

Resource evidence records process-group survivors, owned listeners and sockets,
owned temporary and isolated-environment paths, file-descriptor and disk deltas,
approval waiters, live grants, live gateway tokens and operator-secret
findings. Process output is fully flushed, then redacted before a result is
finalized.
