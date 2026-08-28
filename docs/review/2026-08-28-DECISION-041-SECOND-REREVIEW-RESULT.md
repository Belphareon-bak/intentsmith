# Decision 041 second re-review result

## Verdict

```text
Decision 041 = CHANGES_REQUIRED

M5 = 8/9 REVIEW_PASSED
     PRIVACY CHANGES_REQUIRED
     ACCEPTANCE_BLOCKED

M6 = SIGNED_AUTHORITY_CHANGES_REQUIRED
     TECHNICAL_REVIEW_CHANGES_REQUESTED
     ACCEPTANCE_BLOCKED

offline key ceremony = NOT READY
```

The independent review covered exact product candidate
`75498c69cb7587378b0fe29e44dde7cc03c9cc4c`, tree
`1b1aaaa790a579f14d89718a4c5b83e113694567`, with evidence-only HEAD
`32887531c9d4fa87682c31413222df42add62882`. It independently reproduced
`375/375 PASS`, registry 471 with fingerprint `ffb7110746…`, and confirmed that
the earlier restart-UDF, exact-binding, nonce, index/manifest and disposition
lineage repairs held.

Two independent HIGH blockers remained:

1. `m5_signed_privacy_receipts.record_json` was read as SQLite `TEXT`. A
   one-byte invalid UTF-8 mutation failed direct raw verification but became a
   valid signed JavaScript string after the SQLite text round-trip, violating
   the exact-byte contract.
2. Both standalone release paths checked only the terminal
   `git diff candidate..HEAD`. A product mutation followed by a later revert
   disappeared from that diff and could therefore sit inside the signed
   candidate-to-evidence history.

The review also required local Git hardening against `refs/replace`, grafts,
`assume-unchanged` and `skip-worktree`, a real temp-Git standalone CLI test,
per-receipt candidate-to-evidence-head proof and derived source/test LOC
censuses. No key ceremony, rotation, history disposition, promotion, tag,
publish or push was authorized.

This record preserves the review verdict; it does not claim that later
remediation passed review.
