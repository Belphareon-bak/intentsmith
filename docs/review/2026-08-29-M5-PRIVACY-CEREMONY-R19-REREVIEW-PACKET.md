# M5 Privacy ceremony and M5-R19 — re-review packet

## Requested review unit

```text
base evidence HEAD = d3ebf87fa7b4f69c5a14393ed264d1bac094520b
product candidate  = d81be45f890864785502d073df28f8cad8f774bc
candidate tree     = 4de20f69c0fe3785e27b8ac37d8a67eef1c7e817
review range       = d3ebf87f..d81be45f
product commits    = 1
```

The range changes exactly eight tracked files: the public trust store, the two
M5-R19/documentation oracles and five canonical Decision/WP/status documents.
It contains no private-key file or private material.

## Questions for independent review

1. Does the committed trust store contain exactly four distinct Ed25519 public
   keys, one per Decision 041 role, with each `keyId` derived from exact SPKI
   DER and no role/key reuse?
2. Does publishing those keys leave every existing wrong-key, revoked-key,
   changed-byte, cross-role, nonce and candidate/evidence binding regression
   fail-closed?
3. Is M5-R19 closed by a complete migration-100 oracle rather than by weakening
   the schema contract?
4. Are the milestone states truthful: ceremony complete and remediation green,
   but M5/M6 still acceptance-blocked with no operator receipts?
5. Given the operator-confirmed storage choice, is a network-isolated ceremony
   with unencrypted mode-0600 private PKCS#8 files on the same local `/home`
   volume acceptable for the Decision 041 term “offline”, or is additional
   encrypted/removable storage required before receipts may be signed?

## Evidence

- full report:
  [`offline-key-ceremony-20260829.md`](../execution/runs/m6/offline-key-ceremony-20260829.md);
- independent Decision 041 pass that authorized the ceremony:
  [`2026-08-28-DECISION-041-THIRD-REREVIEW-RESULT.md`](2026-08-28-DECISION-041-THIRD-REREVIEW-RESULT.md);
- M5 Privacy finding that required M5-R19:
  [`2026-08-28-M5-PRIVACY-SECTION-REVIEW-RESULT.md`](2026-08-28-M5-PRIVACY-SECTION-REVIEW-RESULT.md).

The candidate has focused/structural `402/402 PASS`, registry 471 with
fingerprint `ffb7110746fba9a07a95dff4076778d5725ed584620204ddfe4c676bd4b9a999`,
clean privacy scan bytes and no replace refs, grafts or hidden index flags.
Both production CLIs remain `BLOCKED / exit 2 / M6_RELEASE_EVIDENCE_NOT_FOUND`
because all 13 signed receipt paths are absent.

## Requested verdict

`REVIEW_PASSED` would close M5-R19 and accept the four pinned public identities
for later signed operator receipts. It would not itself perform rotations,
history disposition, M5 acceptance, M6 review, demo, Gate 0 or release.
