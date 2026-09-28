# Decision 041 byte/history remediation — independent re-review packet

## Identity and verdict boundary

```text
previousReviewedCandidate = 75498c69cb7587378b0fe29e44dde7cc03c9cc4c
previousEvidenceHead      = 32887531c9d4fa87682c31413222df42add62882
previousVerdict           = CHANGES_REQUIRED
remediatedCandidate       = 37edf30d738f780594af98a7a1076e3200038478
remediatedCandidateTree   = 76b67e054d04ce61765f4ca9b6a56843083ade6e
implementationRange       = 32887531..37edf30d
productDeltaFromReview    = 75498c69..37edf30d
branch                    = codex/m6-release-20260827
upstream                  = none
push                      = not performed
```

This packet requests a narrow independent re-review of the Decision 041
byte-identity and Git-history remediation. It is not an offline key ceremony,
privacy rotation, history disposition, M5 acceptance, M6 technical acceptance,
operator demo, Gate 0 receipt, release promotion, tag, publish or push.

Current milestone states remain:

```text
M5 = 8/9 REVIEW_PASSED / PRIVACY_CHANGES_REQUIRED / ACCEPTANCE_BLOCKED
M6 = SIGNED_AUTHORITY_CHANGES_REQUIRED /
     TECHNICAL_REVIEW_CHANGES_REQUESTED / ACCEPTANCE_BLOCKED
offline key ceremony = NOT READY
```

## Remediation commits

| Commit | Scope |
|---|---|
| `8632c490` | Exact SQLite BLOB receipt reads, per-commit/per-parent and per-receipt Git history validation, hardened Git metadata boundary, real temp-Git CLI E2E and derived LOC census |
| `37edf30d` | Preserve the second independent CHANGES_REQUIRED result and reconcile Decision 041, both WPs, ROADMAP and SYSTEM-MAP without claiming PASS |

## Blocking findings and exact closures

| Review finding | Closure | Negative evidence |
|---|---|---|
| SQLite `TEXT` round-trip lost exact byte identity | Every stored receipt is selected as `CAST(record_json AS BLOB)` and passed to the fatal UTF-8 raw verifier | A signed receipt containing U+FFFD is mutated from `ef bf bd` to invalid `f0 bf bd`; SQLite keeps type `text`, decoded bytes differ, BLOB bytes remain exact and repository summary fails |
| Terminal `candidate..HEAD` diff hid a product mutation followed by revert | Both release paths enumerate every commit, bind every parent diff and reject non-linear/merge history | Pure history test and real Git CLI sequence `evidence → src/server.js mutation → receipt → revert` both fail on `product-path:src/server.js` |
| Receipt evidence HEAD could rely only on final-range inference | Core verifier requires an independently supplied and validated `candidate→receipt.evidenceHeadSha` history for every verified receipt | Per-receipt fixture injects a product path into the signed evidence history and fails |
| Git reads honored local replacement metadata | Every Git subprocess uses `--no-replace-objects` plus `GIT_NO_REPLACE_OBJECTS=1`; verifier rejects `refs/replace` and graft files | Real temp-Git standalone CLI rejects an installed replace ref and then an `info/grafts` file |
| Cleanliness could be hidden by index flags | Verifier inspects `git ls-files -v -z` before trusting porcelain state | Real temp-Git standalone CLI rejects both a hidden modified file under `assume-unchanged` and under `skip-worktree` |
| Source/test LOC values drifted manually | Artifact test derives exact recursive `.js` file and newline counts from current bytes | Independent drift mutations of either source or test total fail |

Merge commits in the evidence range are deliberately forbidden rather than
partially interpreted. The allowed evidence topology is a single-parent linear
chain from product candidate to each receipt evidence HEAD and final evidence
HEAD.

## Exact-candidate verification

All programs below were run from a clean worktree at
`37edf30d738f780594af98a7a1076e3200038478`:

```text
SignedAuthorityReceipt                   5 PASS / 0 FAIL
M5 privacy remediation                  19 PASS / 0 FAIL
M6 signed acceptance                     5 PASS / 0 FAIL
Git signed-authority bundle             12 PASS / 0 FAIL
M6 release contract                     13 PASS / 0 FAIL
schema migrations                       38 PASS / 0 FAIL
module-boundary ratchet                 13 PASS / 0 FAIL
artifact validation                    158 PASS / 0 FAIL
routes smoke                            119 PASS / 0 FAIL
                                       ----------------
focused + structural total             382 PASS / 0 FAIL

registry = 471 runnable programs
registry fingerprint = ffb7110746fba9a07a95dff4076778d5725ed584620204ddfe4c676bd4b9a999
module graph = 1199 edges / 3 cycles / 28 files in cycles
source census = 202574 lines / 537 JavaScript files
test census = 222711 lines / 475 JavaScript files
git diff --check 32887531..37edf30d = PASS
```

The full deterministic gate was not run for this narrow remediation. Live LLM,
Ollama, GPU, model-quality chat, five-minute full resource evidence and the
24-hour soak were not run or touched.

## Truthful empty production state

On the remediated product candidate, both standalone signed-bundle verification
and full M6 release validation remain:

```text
valid      = true
verdict    = BLOCKED
exitCode   = 2
reasonCode = M6_RELEASE_EVIDENCE_NOT_FOUND
```

The committed trust store remains empty and all thirteen production receipt
paths are absent. No production private key was generated and no real
remediation action was performed.

## Requested verdict

`REVIEW_PASSED` means only that Decision 041 implementation is ready for the
separately authorized offline public-key ceremony. It does not accept M5 or M6.
Any product commit after `37edf30d` invalidates that verdict.
