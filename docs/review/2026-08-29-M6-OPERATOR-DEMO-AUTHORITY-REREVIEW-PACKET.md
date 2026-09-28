# M6 signed operator-demo authority — independent re-review packet

## Requested verdict

```text
PRODUCT_CANDIDATE = d71ac77a44545792860d5ab8dea9c747359577e7
PRODUCT_TREE      = ffd0eaf965eeeb12f693423ff9ddd600d623fb5f
EVIDENCE_HEAD     = 9a958a34e2e8e6db043440a4c850760a234a883c
REVIEW_RANGE      = 8eb56a168fd5af612c3a121dc47ecc7225263cdb..d71ac77a44545792860d5ab8dea9c747359577e7
REQUESTED_RESULT  = REVIEW_PASSED | CHANGES_REQUIRED
CURRENT_STATE     = IMPLEMENTATION_GREEN / REVIEW_PENDING
ACTUAL_DEMO       = NOT_RUN
APPROVAL_RECEIPT  = NOT_ISSUED
M5                = ACCEPTANCE_BLOCKED
M6                = ACCEPTANCE_BLOCKED
```

Review the exact product candidate, not the documentation commit as product
bytes. `9a958a34` adds only allowed M6 execution/status evidence. This packet is
the following one-file review request. No push, tag or publish was performed.

## Scope

The review subject is the operator-demo authority integrated after the accepted
model-evaluation closeout:

- `contracts/m6/operator-demo-v1.js`;
- `src/release/m6-operator-demo.js`;
- `scripts/run-m6-operator-demo.js`;
- the new final-verifier consumer in
  `src/release/signed-authority-bundle-verifier.js`;
- the focused tests, registry entry, exact module edge and nightly registry
  policy correction through `d71ac77a`.

The execution report is
[`m6-operator-demo-authority-integration-20260829.md`](../execution/runs/m6/m6-operator-demo-authority-integration-20260829.md).
It preserves the first `303 PASS / 1 FAIL` diagnostic as red evidence and binds
the later accepted `304/304 PASS` run to the corrected exact candidate.

## Acceptance questions

1. Is observation structurally distinct from approval, with no runner path that
   can sign, approve or read an offline private key?
2. Does even a complete nine-step observation remain
   `DEMO_COMPLETED_AWAITING_OPERATOR_APPROVAL` until a valid
   `m6-release-operator` signed receipt exists?
3. Does the receipt bind the dedicated operator-demo domain, exact candidate,
   tree, registry, release index, artifact manifest, one observation artifact
   and its raw evidence without cross-role replay?
4. Does the final standalone bundle verifier reload the observation from the
   signed evidence HEAD and revalidate canonical UTF-8 bytes, semantics and
   every Git-pinned raw artifact rather than trusting a stored projection?
5. Do dirty/linked checkout, path escape, symlink, empty artifact, digest drift,
   reordered/missing step, unexpected egress and forged approval all fail
   closed?
6. Was the `d71ac77a` Gate 0 registry-policy change an exact consequence of the
   new required registry row (`245 offline + 59 database`), with the old stale
   pin demonstrably red and the corrected self-test green?
7. Do documentation and runtime remain truthful that the real demo, approval,
   live model/GPU evidence, M5 acceptance and M6 release are still incomplete?

## Reproduction

Use a new detached worktree or clone at the product candidate. Install the PDF
runtime only below that checkout's own ignored artifact root:

```bash
./scripts/install-pdf-runtime.sh \
  --venv "$PWD/.intentsmith-artifacts/pdf-runtime"

export INTENTSMITH_PDF_PYTHON="$PWD/.intentsmith-artifacts/pdf-runtime/bin/python"

node scripts/nightly-audit.js \
  --profile=offline,database \
  --concurrency=1 \
  --deadline-hours=8 \
  --allow-blocker=toolchain:python-pdf-runtime,toolchain:bwrap,toolchain:git,toolchain:bubblewrap,toolchain:prlimit

node scripts/validate-test-registry.js --json
node tests/m6-operator-demo.test.js
node tests/signed-authority-bundle.test.js
node tests/nightly-orchestrator-self-test.js
node tests/artifact-validation.test.js
node tests/module-boundary-ratchet.test.js
node scripts/run-m6-operator-demo.js --plan
git diff --check
git status --short --branch
```

Expected complete gate:

```text
304 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
verdict PASS / exit 0
registry 79e9864f495d6af23c9817cff9a74fc329a8643ecba8fff14b2a82b31c8d7797
sourceRevision d71ac77a44545792860d5ab8dea9c747359577e7
```

Expected plan-only boundary:

```text
planDigest a3b4a5ccf25e99ab8844ff6ffa76a7f2640c7539c5840cfd26c217fba87de5c0
outcome PLAN_ONLY_NOT_DEMO
```

## Required adversarial probes

- mutate one observation byte, including invalid UTF-8, after signing;
- sign the demo envelope with reviewer, privacy or M5 acceptance role/domain;
- reference zero, two or a non-observation artifact from the demo receipt;
- bind a valid observation from a different candidate, tree, registry or
  evidence HEAD;
- replace a raw step artifact, use a symlink/empty file or escape its candidate
  root;
- omit, duplicate or reorder a step, or change one PASS to `FAIL`/`NOT_RUN`;
- inject an unexpected egress attempt into an otherwise complete observation;
- bypass repository projections and feed a caller-forged `APPROVED` object to
  the final verifier;
- restore the preceding registry fingerprint/profile counts and verify that the
  orchestration self-test fails.

## Explicit non-claims and external blockers

This packet requests review of implementation only. It does not authorize or
claim an actual operator demonstration, private-key use, signature, privacy
rotation, history rewrite, M5 acceptance, Gate 0 promotion, model activation,
GPU hunt, tag, publish or push.

The four production keys still require genuinely offline and role-separated
custody. Live LLM/model-quality and physical GPU rows remain explicitly
deferred until the model set is frozen. A technical `REVIEW_PASSED` here would
close this implementation slice, not M5 or M6 acceptance.
