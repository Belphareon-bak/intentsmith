# M5/M6 signed authority implementation — re-review packet

## Identity and verdict boundary

```text
productCandidateSha  = 73fdf8365c97c49292752a0e46697345eada0f44
productCandidateTree = fa309ea69e836a9e3bc3c243739c9cd9334a3e91
implementationRange  = 99571eea..73fdf836
branch               = codex/m6-release-20260827
upstream             = none
push                 = not performed
```

This packet requests re-review of the implementation authorized by Decision
041. It is not a privacy rotation, history disposition, M5 acceptance, M6
review verdict, operator demo, Gate 0 receipt, release promotion, tag, or
publish.

Current milestone states remain:

```text
M5 = PRIVACY_CHANGES_REQUIRED / ACCEPTANCE_BLOCKED
M6 = TECHNICAL_REVIEW_CHANGES_REQUESTED / ACCEPTANCE_BLOCKED
```

## Product commits

| Commit | Scope |
|---|---|
| `c0840f65` | Generic `SignedAuthorityReceipt@1`, four roles, six domains, canonical Ed25519 verifier, empty Git-pinned trust store |
| `860d5268` | M5 privacy signed payloads, untrusted SQLite storage, migration 100, retired HTTP mint, re-verifying import and summary |
| `97848c15` | Exact privacy module-boundary ratchet |
| `d5037467` | Signed M5 acceptance, M6 review/demo/Gate 0 chain and standalone Git bundle verifier |
| `f3e0575f` | Exact release-verifier module-boundary ratchet |
| `73fdf836` | Decision 041 recorded as implemented and requiring re-review |

## Authority design to review

### Keys and domains

- `m5-privacy-operator` signs only privacy rotation/history domains.
- `m5-acceptance-operator` signs only M5 final acceptance.
- `m6-independent-reviewer` signs only independent M6 review.
- `m6-release-operator` signs only operator demo and Gate 0.
- Trust-store validation rejects one key or SPKI reused across roles.
- `keyId` is recomputed from canonical Ed25519 SPKI DER.
- The committed production trust store is deliberately empty. Test programs
  generate only ephemeral fixture keys and never print private material.

### Signed bytes and replay

- UTF-8 canonical JSON uses sorted keys and safe integer-only numbers.
- The signature prefix includes `SignedAuthorityReceipt@1` and the exact
  receipt domain.
- The envelope binds candidate commit/tree, evidence HEAD, registry
  fingerprint, evidence-index and artifact-manifest SHA-256, exact Git artifact
  bindings, decision, integer timestamp, 128-bit nonce, actor and previous
  receipt identity.
- Raw verification requires the exact canonical bytes plus one final newline.
- Duplicate nonce, duplicate receipt, branch/cycle and broken previous-receipt
  links fail closed.

### Privacy boundary

- Application attest POST routes authenticate first and then return typed HTTP
  `410`; they never parse or retain the request body.
- Migration 100 stores only raw signed envelopes. Trigger/UDF checks are shape
  integrity, never authority.
- Import and every summary re-run signature, role, binding, replay, category
  order and privacy payload validation.
- The required chain is eight canonical categories followed by one history
  receipt. Unsigned legacy rows fail closed.
- Rotation payloads contain only provider/action evidence digests. History
  payload binds disposition/action, post-disposition HEAD, ref census and tree
  scan. No schema field accepts a secret value, secret hash, prefix or suffix.

### Final Git verifier

- `node scripts/verify-signed-authority-bundle.js` is independent of the
  running application and SQLite.
- It loads the trust store and candidate tree from the product candidate Git
  object, and registry/index/manifest identities from Git bytes.
- It expects thirteen raw receipt files: eight rotations, history, M5
  acceptance, independent review, demo and Gate 0.
- Each receipt's `evidenceHeadSha` must equal the single parent of the Git
  commit that introduced its final receipt blob. That commit may change only
  declared receipt paths.
- Every bound artifact is re-read from that exact evidence HEAD and checked for
  path, byte count, Git mode and SHA-256.
- M5 acceptance must point to the privacy history receipt; review follows M5;
  demo follows review; Gate 0 follows demo and repeats the exact review/demo
  receipt identities in its signed payload.

## Required negative regressions

| Scenario | Evidence |
|---|---|
| wrong key or role; cross-role replay | `tests/signed-authority-receipt.test.js`, `tests/m6-acceptance-authority.test.js` |
| one changed signed byte | same two programs |
| stale candidate or wrong binding | same two programs |
| different evidence HEAD | `tests/signed-authority-bundle.test.js` |
| duplicate nonce or broken chain | receipt and acceptance programs |
| DB/UDF replacement | `tests/m5-privacy-remediation.test.js` |
| second SQLite connection | `tests/m5-privacy-remediation.test.js` |
| unknown or revoked key | `tests/signed-authority-receipt.test.js` |
| unsigned legacy receipt | receipt, privacy and acceptance programs |
| product change in receipt commit | `tests/signed-authority-bundle.test.js` |
| changed or unreadable bound artifact | `tests/signed-authority-bundle.test.js` |

## Re-run evidence on the candidate

```text
SignedAuthorityReceipt                 5 PASS / 0 FAIL
M5 privacy remediation                16 PASS / 0 FAIL
M6 signed acceptance                   5 PASS / 0 FAIL
Git signed-authority bundle            5 PASS / 0 FAIL
M6 release contract                   13 PASS / 0 FAIL
schema migrations                     38 PASS / 0 FAIL
module-boundary ratchet               13 PASS / 0 FAIL
artifact validation                  155 PASS / 0 FAIL
routes smoke                         119 PASS / 0 FAIL
test registry                        471 programs / fingerprint ffb7110746fba9a07a95dff4076778d5725ed584620204ddfe4c676bd4b9a999
module graph                         1197 edges / 3 cycles / 28 files in cycles
```

The full deterministic gate was not run for this delta. Live LLM, Ollama, GPU,
24-hour soak and model-quality chat tests were not run or touched.

## Truthful current CLI result

Both `m6:verify-signed-authority` and `m6:validate-release` currently return
`BLOCKED` with exit code `2`. No current M6 release evidence index is pinned for
the new product candidate, no production public keys are pinned, and all
thirteen operator receipt paths are absent. This is the intended fail-closed
state before re-review and the offline ceremony.

## Requested reviewer verdict

`REVIEW_PASSED` means only that the Decision 041 implementation is acceptable
for the later offline key and receipt ceremony. It must not be recorded as M5
or M6 acceptance. Any product commit after `73fdf836` invalidates the verdict.
