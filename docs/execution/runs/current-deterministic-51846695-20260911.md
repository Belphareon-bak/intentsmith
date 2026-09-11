# Current deterministic gate — 2026-09-11

Status: `PASS / 352_OF_352 / CURRENT_SPEC_CANDIDATE_INCLUDED /
MODEL_AND_PHYSICAL_GATES_NOT_RUN`.

## Exact source and result

```text
source revision        = 51846695b27d5d45fedaab2b4d9d241bec03739d
last product revision  = 3291b5d49af5832ca8528c9c9395a18e9906fbdf
run id                 = current-deterministic-51846695-20260911-01
inventory              = 352 programs
profiles               = 279 offline + 73 database
result                 = 352 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
exit code              = 0
started UTC            = 2026-09-11T12:23:50.896Z
ended UTC              = 2026-09-11T12:28:33.433Z
registry fingerprint   = 3ce12a0edffe7e6da0f875ce3f0b25758524641557023d00aae39d0784fdbbfc
inventory fingerprint  = c1a621012e464e5139fe860c3732d78fdfa83482ad966eba55c5fa7311c3110b
options fingerprint    = 533fb61b7113b560d7e9cdb0cbaea3bb96a1f4621554c41f3836b378a94f4c20
```

Report:
`.intentsmith-artifacts/current-convergence-20260911/current-deterministic-51846695-20260911-01/report.json`

Report SHA-256:
`3591dca58b39b5de6eea935ea26d9b96308ede20d1bfdeeb56fde94234ce7417`.

All 352 result IDs are unique, every result carries the exact source revision,
all 352 log files exist and all 352 report-bound log digests match their bytes.
The worktree was clean before and after the run.

## Invocation

```bash
LC_ALL=C \
INTENTSMITH_PDF_PYTHON=/home/belphareon/worktrees/is-m6-operator-demo-prep-20260827/.intentsmith-artifacts/pdf-runtime/bin/python \
npm run test:deterministic -- \
  --allow-blocker=toolchain:git \
  --allow-blocker=toolchain:bwrap \
  --allow-blocker=toolchain:bubblewrap \
  --allow-blocker=toolchain:prlimit \
  --allow-blocker=toolchain:python-pdf-runtime \
  --run-id=current-deterministic-51846695-20260911-01 \
  --out-dir=/home/belphareon/worktrees/is-mobile-completion-20260908/.intentsmith-artifacts/current-convergence-20260911
```

The audit ran with concurrency one, a 10-minute per-suite timeout and an
eight-hour overall deadline. It included no model, GPU, external-network,
owned-server, soak or manual profile.

## Privacy-safe companion check

The production M5 scanner on the same clean source returned current tree
`PASS`, 2333 scanned paths, 1101 content-read files and zero findings. All 13
known incident objects remain reachable, so the combined verdict remains
`PASS_CURRENT_TREE_HISTORY_REMEDIATION_REQUIRED`. Personal content was not
inspected and no secret value was recorded.

Raw scan:
`.intentsmith-artifacts/current-convergence-20260911/preflight-51846695/privacy-scan.json`

Raw scan SHA-256:
`f1ed4503f7e0cbd59ebe59b7e5ed0b95c1353cbcfce1b6e1bcd69cd418f5189d`.

## Boundary

This run includes the Decision 043 implementation and its tests. It is strong
deterministic integration evidence, but it is not the independent source
review, the real complete-SPEC model cookbook, M5 privacy completion, M6
acceptance, a physical M7 result or release authority. No push, tag, merge,
signature or publication occurred.
