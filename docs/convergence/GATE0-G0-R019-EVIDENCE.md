# Gate 0 evidence: G0-R019 milestone truthfulness

Status: deterministic repair verified; model/GPU rerun not claimed

Base commit: `d79a8059e018312a917b268b156aeee80d27a3c6`

Branch: `codex/g0-r019-milestone-truth`

Date: 2026-07-30 Europe/Prague

`tests/project-conversation-e2e-v2.test.js` consumes the shared executor and
BUILD lifecycle in `tests/e2e-harness.js` and
`src/planner/lifecycle-build.js`. The one-hour observation in
`GATE0-GPU-OBSERVATION.md` established two milestone-level false-green paths:

1. a per-file generation exception was logged and discarded, after which the
   executor committed and returned `COMPLETED`;
2. a milestone containing Python test files treated unavailable `pytest` as a
   skipped gate with `allPassed: null`, which the final milestone decision
   allowed.

The outer registered audit still exited 1, so that model run was never valid
green evidence.

## Repair

- The real-model E2E executor now returns `FAILED` immediately after a
  generation exception, before its Git commit and before its completion
  marker. The lifecycle already routes this state to milestone failure.
- The automatic Python test gate now returns `allPassed: false`, a non-zero
  exit code and an explicit blocking summary when Python test files require
  `pytest` but the tool probe fails.
- The final milestone decision uses a focused helper covered by the same
  regression, so an unavailable required Python gate cannot produce
  milestone `PASSED`.
- The no-Python-test-file path still returns `null` without probing `pytest`;
  no unrelated assertion or test strategy was strengthened or weakened.
- The target suite remains registered as T3/model with loopback, database,
  Ollama and GPU prerequisites. No registry field was relaxed.

The production executor API was not changed. Only the test harness executor
accepts an optional injected generator so the failure contract can be
exercised without a model or network.

## Focused positive runs

All test processes used private temporary roots and an explicit
`C3_DB_PATH`; `data/c3.db` was not opened or modified.

```bash
env \
  HOME=/tmp/intentsmith-g0-r019-harness-final.2DPs4u/home \
  TMPDIR=/tmp/intentsmith-g0-r019-harness-final.2DPs4u/tmp \
  C3_DB_PATH=/tmp/intentsmith-g0-r019-harness-final.2DPs4u/test.sqlite \
  INTENTSMITH_TEST_ARTIFACT_DIR=/tmp/intentsmith-g0-r019-harness-final.2DPs4u/.intentsmith-artifacts \
  node tests/e2e-harness-isolation.test.js
```

Result: 3 passed, 0 failed, 0 skipped; exit 0. The new child test requires
`state: "FAILED"`, actionable file/error context, and absence of the executor
completion marker after a synthetic generation exception.

```bash
env \
  HOME=/tmp/intentsmith-g0-r019-lifecycle-helper.E4ZoaS/home \
  TMPDIR=/tmp/intentsmith-g0-r019-lifecycle-helper.E4ZoaS/tmp \
  C3_DB_PATH=/tmp/intentsmith-g0-r019-lifecycle-helper.E4ZoaS/test.sqlite \
  INTENTSMITH_TEST_ARTIFACT_DIR=/tmp/intentsmith-g0-r019-lifecycle-helper.E4ZoaS/.intentsmith-artifacts \
  node tests/lifecycle-build.test.js
```

Result: 68 passed, 0 failed; exit 0. The regression requires a failed pytest
probe to produce `allPassed: false`, exit 1, the explicit prerequisite summary,
and a false final milestone PASS decision. It separately preserves the
not-applicable path when the milestone contains no Python test file.

The broader lifecycle regression used the same isolation contract:

```bash
env \
  HOME=/tmp/intentsmith-g0-r019-lifecycle-regression.jJwSTQ/home \
  TMPDIR=/tmp/intentsmith-g0-r019-lifecycle-regression.jJwSTQ/tmp \
  C3_DB_PATH=/tmp/intentsmith-g0-r019-lifecycle-regression.jJwSTQ/test.sqlite \
  INTENTSMITH_TEST_ARTIFACT_DIR=/tmp/intentsmith-g0-r019-lifecycle-regression.jJwSTQ/.intentsmith-artifacts \
  npm run test:lifecycle
```

Result: all five chained lifecycle programs completed; exit 0.

The harness test was run outside the process sandbox because its existing
containment assertion invokes local `git init`; the sandboxed baseline reported
`spawnSync git EPERM`. The test itself used no network, model or GPU.

## Mutation sensitivity

Two temporary mutations were applied separately and restored without
committing:

| Mutation | Required failure | Result | Exit |
|---|---|---:|---:|
| generation catch returns `COMPLETED` instead of `FAILED` | `generation failure was reported as COMPLETED` | 2 passed, 1 failed | 1 |
| unavailable pytest returns `allPassed: null` instead of `false` | fail-closed result and final milestone decision assertions | 66 passed, 2 failed | 1 |

The restored tree returned 3/3 and 68/68 in the focused suites. These are
author-session mutation results; a commit-bound replay is recorded after the
implementation commit exists.

## Boundary

This evidence repairs the deterministic truthfulness contract behind
`G0-R019`. It does not claim that
`tests/project-conversation-e2e-v2.test.js`, the model registry, or Gate 0 as a
whole is green. A qualifying model run still requires the registered model/GPU
environment, and the VRAM prerequisite gap remains independently open as
`G0-R020`.
