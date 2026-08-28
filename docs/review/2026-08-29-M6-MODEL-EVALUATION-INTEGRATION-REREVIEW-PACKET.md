# M6 model-evaluation integration — independent re-review packet

## Requested verdict

```text
PRODUCT_CANDIDATE = 73385eebc8cbca55d337c0cbb4954fbcb9aba93d
PRODUCT_TREE      = 42e4356febdc9d045a6ccb286dac81a10d9ec23a
EVIDENCE_HEAD     = 7e658f19cd0f87032604e04e5db35e9a16e285a8
REQUESTED_RESULT  = REVIEW_PASSED | CHANGES_REQUIRED
CURRENT_STATE     = IMPLEMENTATION_GREEN / REVIEW_PENDING
M5                = 8/9 / KEY_CUSTODY_CHANGES_REQUIRED / ACCEPTANCE_BLOCKED
M6                = ACCEPTANCE_BLOCKED
```

Please review the exact product candidate, not the evidence commit as product
bytes. Commits after the candidate are documentation/review evidence only.
No push, tag or publish was performed.

## Scope

The M6-side integration merge is
`ff9a7dfc93ab37d983d1feaf02418d8254411034`, with M6 parent
`a98114b97240e994caff2002fff5b82c665b6029` and already accepted model-authority
parent `2fdb04736daf5ebaf578dc3b089acd87be5e9478`. The accepted model-evaluation
algorithm and historical live scoring are inputs, not the subject of this
review. The subject is whether their integration into the current M6 product
line is truthful and regression-free.

Include the subsequent product ancestry through `73385eeb`, especially:

- module graph baseline `b26f4858`;
- reviewed M5-R19/M6 history merge `6f7f2902`;
- integrated migration-count/application-upgrade correction `73385eeb`.

The worker monitor at
[`2026-08-29-M6-MODEL-INTEGRATION-MONITOR.md`](2026-08-29-M6-MODEL-INTEGRATION-MONITOR.md)
records the ancestry correction. The execution report at
[`m6-model-evaluation-integration-20260829.md`](../execution/runs/m6/m6-model-evaluation-integration-20260829.md)
records the independent-checkout gate.

## Acceptance questions

1. Does the integrated schema contain one unambiguous migration sequence, 87
   files, tip 100 and 158 fresh tables, without silently changing previously
   committed migration semantics?
2. Are superseded model proposal/ranker/automatic-failover write authorities
   actually absent from the production call graph, while the accepted
   role-specific exact-artifact reader and M6 durable model effect claims both
   remain reachable?
3. Does M6 technical-evidence contract version 5 map only current registered
   programs, including manual binding application, model upgrade and the
   pre-082 upgrade regression?
4. Does the application-upgrade contract derive and enforce the integrated
   migration count 87 rather than accepting a stale fixture or self-asserted
   receipt?
5. Are registry fingerprint, module graph and all focused/deterministic results
   bound to exact candidate `73385eeb` with no dirty-tree or concurrent-writer
   ambiguity?
6. Does any document or runtime path falsely claim a fresh physical GPU,
   live-Ollama model-quality PASS, model activation, hunt-timer enablement or
   M5/M6 acceptance?
7. Did the integration weaken signed-authority, M5 privacy, path/effect or
   upgrade boundaries that were already reviewed?

## Reproduction

Use a new detached worktree or clone at the product candidate. Do not reuse a
checkout with another writer. A hash-locked PDF runtime may be installed into
that checkout's own artifact root:

```bash
./scripts/install-pdf-runtime.sh \
  --venv "$PWD/.intentsmith-artifacts/pdf-runtime"

export INTENTSMITH_PDF_PYTHON="$PWD/.intentsmith-artifacts/pdf-runtime/bin/python"
export C3_PDF_PYTHON="$INTENTSMITH_PDF_PYTHON"

node scripts/nightly-audit.js \
  --profile=offline,database \
  --allow-blocker=toolchain:python-pdf-runtime,toolchain:bwrap,toolchain:git,toolchain:bubblewrap,toolchain:prlimit

node scripts/validate-test-registry.js --json
node tests/module-boundary-ratchet.test.js
node tests/artifact-validation.test.js
git diff --check
git status --short --branch
```

Expected continuous gate result:

```text
303 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
verdict PASS / exit 0
registry ab85f58a854d9271dcf39f321d583f8024ee09b79355e863c5857eaefe29cbca
sourceRevision 73385eebc8cbca55d337c0cbb4954fbcb9aba93d
```

For a narrower first pass, the nine focused files in the execution report are
expected to return `298/298 PASS`.

## Required adversarial probes

- reintroduce a colliding migration identity or change the migration-file
  count without changing the M6 constant; the fast drift guard must fail;
- restore a deleted legacy evaluation writer/import; module and authority tests
  must fail or the production consumer audit must expose it;
- relabel a removed legacy test as a current technical-evidence role; the
  contract must reject it;
- change a candidate source file after the run or alter one result's
  `sourceRevision`; evidence validation must fail;
- remove or substitute the locked PDF runtime while the toolchain blocker is
  explicitly allowed; executable/runtime preflight must block or fail;
- attempt to infer current model quality from historical accepted rows; the
  new candidate must still require fresh deferred live-model evidence.

## Explicit non-claims and external blockers

This packet requests review only of deterministic model-authority integration.
It does not request approval to sign receipts, use the production private keys,
rotate credentials, rewrite history, activate a model, enable the GPU hunt,
run physical GPU tests, promote Gate 0, tag, publish or push.

The four production private keys remain on the same online `/home` filesystem
and are not in acceptable offline/separate custody. Therefore M5 privacy and
M6 acceptance remain blocked even if this integration review passes.
