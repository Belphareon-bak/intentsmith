# M5 PRIVACY section — independent review result

## Verdict

```text
M5 PRIVACY = CHANGES_REQUIRED
             0 CRITICAL / 0 HIGH / 1 MEDIUM

M5 = 8/9 REVIEW_PASSED
     PRIVACY CHANGES_REQUIRED
     ACCEPTANCE_BLOCKED
```

The adversarial security substance of the PRIVACY section passes. M5-R17 and
M5-R18 are both closed and I found no new critical or high defect. The section
does not reach `REVIEW_PASSED` because one required, ACTIVE, offline test named
in this work package's own verification block is red, and the breakage is caused
by a commit in this section's lineage.

## Reviewed identity

```text
productCandidate = 37edf30d738f780594af98a7a1076e3200038478
candidateTree    = 76b67e054d04ce61765f4ca9b6a56843083ade6e
evidenceHead     = 14db52e2cb301a858d476fb081212e3b67936f8b
```

## Closed blockers

### M5-R17 — CRITICAL — auth capability bypass

Closed structurally, not by patching the symptom.

`authorizeGlobalRequest()` is no longer exported; it is module-private and
reachable only through `createGlobalAuthAuthority()`. That factory holds a
closure-private `WeakSet`, mints subjects only inside `authorize()`, does not
expose the mint on its frozen return value, and captures `localCapability` and
`adminToken` at construction rather than accepting them per request. The
original bypass — a caller supplying both the expected and the presented
capability — is therefore not expressible. `isAuthenticatedSubject()` tests
`WeakSet` membership, so a structurally identical clone is rejected on identity.

One instance is created at `src/server.js:984`, used for HTTP at `1477` and
passed to the WebSocket server at `1533`; `src/ws-bridge/ws-server.js:87`
refuses to start without it. HTTP, WS and the privacy boundary share one issuer.

Migration 091 enforces the capability at the SQL boundary. The ticket in
`withM5PrivacyReceiptWriterAuthority()` is one-shot, bound to the exact
`receiptId` and `recordJson`, marked `consumed` by the UDF, guarded against
reentrancy, cleared in `finally`, and requires `record.actor.actorId` to equal
the authenticated subject. The verifier is pinned per database and a second,
different verifier raises `transport-subject-verifier-conflict`.

The layering is proven adversarially rather than asserted. With both UDFs
replaced in-process, a self-consistent legacy row inserts and `summary()` still
fails closed on `UNSIGNED_LEGACY_RECEIPT`. From a second SQLite connection with
its own replacement UDF, a receipt signed by an attacker-generated Ed25519 key
inserts and `summary()` fails closed on `SIGNED_RECEIPT_INVALID`. Full database
compromise cannot forge a privacy PASS, because authority rests on the signature
checked against the Git-pinned trust store, not on SQLite.

### M5-R18 — HIGH — scanner blind spots and Git TOCTOU

Closed. The scanner rejects a dirty tree before the scan and again afterwards
(`dirty-worktree-after-scan`), and re-reads `HEAD` after the scan to confirm the
revision did not move. It reads exact `HEAD` blobs through
`ls-tree -r -z --full-tree` piped to `cat-file --batch` instead of the working
filesystem, and derives its roots from the digest-pinned
`M5_DISTRIBUTION_MANIFEST` rather than an ad-hoc list. Sensitive tracked paths
are counted but not opened, and reachability is computed from the declared ref
census rather than physical object existence.

Current output on the evidence HEAD is truthful:

```text
scannedFiles      = 1922
contentReadFiles  = 1015
findings          = []
checkedObjects    = 13   reachable = 13
verdict           = PASS_CURRENT_TREE_HISTORY_REMEDIATION_REQUIRED
```

### Retired minting surface

The application holds no signing key and no mint factory. Both attest routes
authenticate first and then return a typed `410` without reading the request
body. `src/server.js:992` constructs the repository without a transport subject
verifier, so no write path is reachable in production at all.

## Verification

```text
tests/m5-privacy-remediation.test.js      19 PASS / 0 FAIL
tests/schema-migrations.test.js           38 PASS / 0 FAIL
tests/routes-smoke.test.js               119 PASS / 0 FAIL
tests/module-boundary-ratchet.test.js     13 PASS / 0 FAIL
scripts/scan-m5-privacy.js                   PASS
tests/m1-model-failover-schema.test.js    17 PASS / 3 FAIL   ← blocking
```

## Open finding

### M5-R19 — MEDIUM — required migration oracle left stale by the privacy work

`tests/m1-model-failover-schema.test.js` pins the exact migration contract.
Commit `860d5268` ("fix(privacy): require offline signed remediation receipts")
added `src/db/migrations/2026_08_28_100_signed_privacy_receipts.js` without
updating that oracle, so three assertions fail:

```text
latest migration   expected 2026_08_27_098_m6_model_artifact_authority
                   got      2026_08_28_100_signed_privacy_receipts
migration count    expected 79   got 80
applied list       expected [ … 098 ]   got [ … 098, 100 ]
```

The suite's last edit (`37d9035b`) predates `860d5268`, so this is a regression
introduced by this section, not pre-existing drift. `tests/registry.json` marks
it `state: ACTIVE`, `required: true`, tier T1, profile `database`, with no
network, Ollama, server or GPU requirement — it runs offline in seconds, so the
"full deterministic gate was not run" disclosure does not cover it. It is also
listed in `WP-M5-PRIVACY.md`'s own verification block.

All three failures share one cause and the defect is in the oracle, not in the
failover schema. The purpose of a pinned oracle is to force every schema
addition to be acknowledged; leaving it red disables that mechanism for the next
change.

Acceptance condition: update the three pinned expectations, re-run the suite to
`20/20`, and confirm no other pinned oracle drifted for migration 100.

## Non-blocking observations

1. `withM5PrivacyReceiptWriterAuthority()` has no caller anywhere in `src/`,
   `scripts/` or `tests/`, and the 090/091 tables have no INSERT path — only two
   `SELECT count(*)` reads at `privacy-authority-repository.js:190` and `:193`.
   The M5-R17 SQL-boundary control is therefore correct, fingerprint-locked and
   fail-closed, but vestigial: it is never exercised. State this in the work
   package so no later reader treats it as the live control. The live control is
   signature verification against the Git-pinned trust store.
2. Because the repository is constructed without a transport subject verifier,
   the positive authorized-write path has no production or test coverage. That
   is consistent with the retired mint and is fail-closed, but it means the
   capability's success path is unproven.
3. `ROADMAP.md` pins the scanner census to `b15090a4` at 1 853 scanned and 983
   content-read. Current HEAD reports 1 922 and 1 015. The pin names its commit
   so it is not stale, but it reads as current at a glance.

## Sequencing note

Fixing M5-R19 touches `tests/`, which is not an evidence-only path, so it
produces a new product candidate and supersedes the Decision 041
`REVIEW_PASSED` recorded against `37edf30d`. This costs nothing extra, because
the offline key ceremony publishes
`contracts/authority/trusted-public-keys-v1.json`, which is also outside the
evidence-only set and creates a new candidate regardless. M5-R19 can be bundled
with that commit. `docs/wp/WP-M5-PRIVACY.md` is likewise a product path;
`ROADMAP.md` and `SYSTEM-MAP.md` are evidence-only exact paths.

## Not addressed by this review

M5 acceptance additionally requires operator remediation that no review can
supply and that remains untouched:

```text
rotation receipts            0 / 8
history disposition receipt  missing
incident objects reachable   13 / 13
signed M5 acceptance receipt missing
```

These depend on the offline key ceremony, which is not authorized. No rotation,
history disposition, key generation, promotion, tag, publish or push was
performed or is authorized by this document.
