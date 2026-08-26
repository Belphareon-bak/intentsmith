# Historical and manual test assets

This directory preserves test-related files that are not part of the
deterministic Gate 0 registry.

The files were moved here without changing their contents unless noted below.
They cover old APIs, require a running server or local LLM, perform stress or
quality experiments, or are historical reports. They must not be counted as
release evidence unless they are explicitly invoked and their prerequisites,
command, output, and exit code are recorded.

## Contents

- `*.cjs`, `sprints/*.cjs`: historical `node:test`, benchmark, stress, and
  live-server programs.
- `run-all-expertise-e2e.sh`: a manual expertise E2E launcher.
- `e2e-loop.js`: a manual, potentially unbounded live-server/LLM/GPU loop.
  Its paths were repaired after relocation and its generated reports default
  to `.intentsmith-artifacts/e2e-loop/`.
- `LIFECYCLE_E2E_REPORT.txt` and `PROJECT-LIFECYCLE-E2E-PLAN.md`: historical
  evidence and planning material, not current results.
- `packages/c3-backend.md`: a portable historical reference replacing the
  machine-local absolute symlink moved by the disputed commit.

The current inventory and execution profiles are generated from the filesystem;
no assertion total in these historical files is authoritative.
