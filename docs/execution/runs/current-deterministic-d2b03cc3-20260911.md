# Current deterministic gate — 2026-09-11 gateway remediation

Status: `PASS / 352_OF_352 / SPEC_GATEWAY_REMEDIATION_INCLUDED /
MODEL_AND_PHYSICAL_GATES_NOT_RUN`.

## Exact source and result

```text
source revision        = d2b03cc32baf95ade4f096b22d875c4119ee9491
last product revision  = dca0e89bcc47a1dce96fbe0d3f0616aadccd3b2c
run id                 = current-deterministic-d2b03cc3-20260911-01
inventory              = 352 programs
profiles               = 279 offline + 73 database
result                 = 352 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
exit code              = 0
started UTC            = 2026-09-11T15:09:05.988Z
ended UTC              = 2026-09-11T15:14:11.804Z
registry fingerprint   = 3ce12a0edffe7e6da0f875ce3f0b25758524641557023d00aae39d0784fdbbfc
inventory fingerprint  = c1a621012e464e5139fe860c3732d78fdfa83482ad966eba55c5fa7311c3110b
options fingerprint    = 533fb61b7113b560d7e9cdb0cbaea3bb96a1f4621554c41f3836b378a94f4c20
```

Report:
`.intentsmith-artifacts/current-convergence-20260911/current-deterministic-d2b03cc3-20260911-01/report.json`

Report SHA-256:
`023307449433ab34c4c203c6cf0d8681caa84e6a382c6097ba656de0fd8b9d4a`.

All 352 IDs are unique, every result carries the exact source revision, all
352 log files exist and every report-bound log SHA-256 matches its bytes. The
worktree was clean before and after the run.

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
  --run-id=current-deterministic-d2b03cc3-20260911-01 \
  --out-dir=/home/belphareon/worktrees/is-mobile-completion-20260908/.intentsmith-artifacts/current-convergence-20260911
```

The audit ran with concurrency one, a 10-minute per-program timeout and an
eight-hour overall deadline. It included no model, GPU, external-network,
owned-server, soak or manual profile.

## Privacy-safe companion check

The production scanner ran on the same clean source with the accepted
`retain_and_rotate` disposition. It returned current tree `PASS`, 2 336
tracked paths, 1 101 content-read files and zero findings. All 13 incident
objects remain reachable exactly as declared; the combined verdict is
`PASS_CURRENT_TREE_HISTORY_RETAINED_AS_DECLARED`. This is deterministic
scanner evidence, not the still-missing signed history receipt.

Raw scan:
`.intentsmith-artifacts/current-convergence-20260911/preflight-d2b03cc3/privacy-scan.json`

Raw scan SHA-256:
`d4f559b2ec5a3684197d6c42c37edf0e81e72391000bc7d9fe9c529bf36c37b4`.

The scan bound exact HEAD `d2b03cc3`, a 453-ref census with digest
`sha256:762198e20472c1f65325f89f245367fb5bf886be51742a39e1ba394fc67f0fc9`
and reported no secret value or private incident object identity.

## Boundary

This gate includes the gateway role-ceiling remediation and its regression.
It is current deterministic integration evidence. It does not replace the
independent source re-review, real complete-SPEC model cookbook, signed M5
history receipt, credential rotations, M5/M6 acceptance, physical M7 result or
release authority.
