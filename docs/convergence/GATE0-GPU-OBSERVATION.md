# Gate 0 GPU observation

This is a post-attestation observation against the unchanged clean candidate
`22a9b848db1be69f6cd0657d5d0e9bffb44bcb19`. It supplements, but does not
replace, the deterministic Gate 0 evidence in attestation `bf70c79`.

## Command

```bash
env INTENTSMITH_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python C3_PDF_PYTHON=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/install-root/xdg-data/intentsmith/python/pdf/bin/python node scripts/nightly-audit.js --suite=IS-T4-TESTS-PROJECT-CONVERSATION-E2E-V2-TEST --allow-blocker=ollama,gpu --run-id=gate0-gpu-project-conversation --out-dir=/home/belphareon/Projects/intentsmith-1.0/.intentsmith-artifacts/gate0/candidate-22a9b84/gpu-soak --timeout-minutes=60 --deadline-hours=1 --concurrency=1
```

## Result

- Process exit: `1`
- Verdict: `FAIL`
- Status: `TIMEOUT=1`; all other status counts `0`
- Duration: `3600088 ms`
- Signal: `SIGTERM`
- Required failures: `1`
- Source tree: checked and clean at the candidate SHA
- Cleanup: checked, no leak detected, child terminated
- Registry SHA-256:
  `f930d637693759df07c290ed415477ba5bf461a0fe4ec71ab207e5663da0bf60`
- Report:
  `.intentsmith-artifacts/gate0/candidate-22a9b84/gpu-soak/gate0-gpu-project-conversation/report.json`
- Report SHA-256:
  `51ca4f7b799d1fb4fc41f25a18af1a7fce83d2d56f1bd8123054a5d0c8863fe7`
- Log:
  `.intentsmith-artifacts/gate0/candidate-22a9b84/gpu-soak/gate0-gpu-project-conversation/logs/tests_project-conversation-e2e-v2.test.js.4839f89f.log`
- Log SHA-256:
  `df099b061df0d6a6cab8ef97e36ea5d03f2d5a2b9006936961f818e911aef4f8`

## Findings

The log contains seven lines with `Timeout after 120000ms`, sixteen lines with
the CUDA out-of-memory error text, and two
`pytest not installed — skipping test gate` records. Three lifecycle
milestones were nevertheless printed as `BUILD: ... PASSED` after generation
errors or skipped test gates. The outer audit did not false-green: it enforced
the one-hour deadline and exited non-zero.

A point-in-time read-only hardware check during an OOM reported an RTX 3090
with `24054 MiB` of `24576 MiB` in use. `ollama ps` reported
`qwen3.5:27b`, context `8192`, approximately `23 GB`, `100% GPU`. The current
registry requirement `gpu: true` does not capture this headroom requirement.

## Disposition

- Do not count this run or its milestone-level `PASSED` messages as green.
- Keep the deterministic Gate 0 verdict separate; this suite is outside the
  199-suite offline/database acceptance scope.
- Before this suite can provide release evidence, make generation failures and
  missing test tooling fail the milestone, and specify a reproducible
  model/context/VRAM prerequisite or a supported fallback.
