# Decision 041 remediation — independent re-review packet

## Identity and verdict boundary

```text
reviewedCandidate        = 73fdf8365c97c49292752a0e46697345eada0f44
reviewedVerdict          = CHANGES_REQUIRED
remediatedCandidate      = 75498c69cb7587378b0fe29e44dde7cc03c9cc4c
remediatedCandidateTree  = 1b1aaaa790a579f14d89718a4c5b83e113694567
implementationRange      = b97d5358..75498c69
branch                   = codex/m6-release-20260827
upstream                 = none
push                     = not performed
```

This packet requests a new independent review of the Decision 041
implementation only. It is not a privacy rotation, history disposition,
offline key ceremony, M5 acceptance, M6 technical review, operator demo,
Gate 0 receipt, release promotion, tag, or publish.

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
| `95a2cd6c` | Fatal UTF-8 decoding, byte equality, restart-safe privacy UDF registration, typed expected bindings |
| `4beced1b` | Global nonce replay boundary, exact evidence-HEAD documents, full candidate-to-HEAD boundary, history lineage and disposition binding |
| `2b5da617` | Exact acceptance of two new module edges without cycle growth |
| `f305ff29` | API, WP, Decision, ROADMAP, SYSTEM-MAP and historical whitespace reconciliation |
| `75498c69` | Executable documentation/status drift regression |

## Blocking review findings and exact closures

| Review finding | Remediation | Negative evidence |
|---|---|---|
| Invalid one-byte UTF-8 mutation decoded to the same JavaScript string | `verifyRaw()` uses fatal UTF-8 decoding and compares canonical `Buffer` bytes | `tests/signed-authority-receipt.test.js` mutates `efbfbd` to `f0bfbd` and requires `raw:utf8` |
| Persistent privacy triggers lost their UDF after SQLite restart | `M5PrivacyAuthorityRepository` re-registers every UDF used by the persistent triggers on each connection | `tests/m5-privacy-remediation.test.js` closes/reopens the DB and performs the real settings route write |
| Six `undefined` expected bindings could produce privacy PASS | The repository accepts only the exact six keys with typed SHA/SHA-256 values; generic expected keys containing `undefined` no longer disappear | Privacy test rejects all-undefined and malformed-SHA binding objects |
| Standalone verifier checked only each receipt commit | The core verifier runs `validateM6EvidenceCommitBoundary()` over the complete candidate-to-final-HEAD range; CLI derives exact name/status entries, clean state and both registry fingerprints | Bundle test adds a later `src/server.js` commit entry and requires `boundary:product-path` |
| Index and manifest could appear only after the signed evidence HEAD | Every receipt re-reads both documents from its own `evidenceHeadSha`, verifies the index digest, index manifest binding and manifest digest | Bundle test separately removes the index and manifest from the signed HEAD |
| History disposition could come from a merged foreign lineage | `postDispositionHeadSha` must be an ancestor of the product candidate and evidence HEAD | Bundle test admits fork→evidence while denying fork→candidate and requires failure |
| M5 acceptance could name a different disposition | Bundle compares M5 acceptance `historyDisposition` with the linked privacy history payload | Bundle mismatch test requires `bundle:m5-history-disposition-binding` |
| Same nonce across different roles passed | Replay identity is the raw nonce globally, not `authorityId + nonce` | Receipt-set test signs the same nonce with reviewer and release roles and requires `replay:nonce` |
| API/WP/SYSTEM-MAP and whitespace were stale | Runtime API v2/typed 410, formal CHANGES_REQUIRED state, registry census and module graph are reconciled; both current and historical-range diff-checks are clean | Artifact test locks the retired HTTP mint, Decision status and exact registry state |

## Exact-candidate verification

All programs below were run again from a clean worktree at
`75498c69cb7587378b0fe29e44dde7cc03c9cc4c`:

```text
SignedAuthorityReceipt                  5 PASS / 0 FAIL
M5 privacy remediation                 18 PASS / 0 FAIL
M6 signed acceptance                    5 PASS / 0 FAIL
Git signed-authority bundle             8 PASS / 0 FAIL
M6 release contract                    13 PASS / 0 FAIL
schema migrations                      38 PASS / 0 FAIL
module-boundary ratchet                13 PASS / 0 FAIL
artifact validation                   156 PASS / 0 FAIL
routes smoke                           119 PASS / 0 FAIL
                                      ----------------
focused + structural total            375 PASS / 0 FAIL

registry = 471 runnable programs
registry fingerprint = ffb7110746fba9a07a95dff4076778d5725ed584620204ddfe4c676bd4b9a999
module graph = 1199 edges / 3 cycles / 28 files in cycles
git diff --check 99571eea..75498c69 = PASS
```

The full deterministic gate was not run for this delta. Live LLM, Ollama,
GPU, model-quality chat, five-minute full resource evidence and the 24-hour
soak were not run or touched.

## Truthful empty production state

On the remediated product candidate, both standalone signed-bundle verification
and full M6 release validation remain:

```text
verdict    = BLOCKED
exitCode   = 2
reasonCode = M6_RELEASE_EVIDENCE_NOT_FOUND
```

The committed trust store is empty and all thirteen production receipt paths
are absent. No production private key was generated and no real remediation
action was performed.

## Requested verdict

`REVIEW_PASSED` means only that Decision 041 is ready for a separately
authorized offline public-key ceremony. It does not accept M5 or M6. Any
product commit after `75498c69` invalidates that verdict.
