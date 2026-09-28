# M7 settings and stored-information core adapters — review packet

**Requested verdict:** `REVIEW_PASSED` or `CHANGES_REQUIRED`

**Product candidate:** `1b0654f01784a9ae41c2cfbb1e5345c74b6f3c6e`

**Product tree:** `ea40b1bc3559302d425afe4b0cb2278e79cc57a6`

**Review range:** `35a82422daeab645e503e285436cc4068de4b97c..1b0654f01784a9ae41c2cfbb1e5345c74b6f3c6e`

## Review questions

Trace real `user_settings`, SQLite migration/UDF behavior, journal settlement
and injected mediator call order, not only candidate fixtures:

1. Is the mobile settings surface a closed, Git-pinned allowlist, or can an
   unknown/request-selected key observe or mutate security, provider, model,
   notification or administrative bytes?
2. Are defaults emitted only for genuinely absent keys while malformed JSON,
   invalid stored values and DB failures remain typed failures?
3. Does each item revision bind key and canonical value, and does the snapshot
   bind the entire ordered projection? Can stale revision or a concurrent
   writer become false success?
4. Do all settings mutations pass through the durable operation journal and
   the injected approval/effect mediator? Can pending, rejected, thrown or
   invalid mediation reach `perform` or be relabelled as applied?
5. Does the settings transaction preserve every unrelated byte and derive the
   returned revision from the exact written document rather than a racing
   post-write read?
6. Are manual notes append-only and partitioned by trusted subject plus
   optional project? Can request bytes assert subject, device, project
   authority, grant or effect identity?
7. Is project authorization checked before protected content and again at the
   final mutation/release boundary? Does revocation leave no inserted row and
   a durable UNKNOWN settlement rather than a retryable rejection?
8. Is the list cursor HMAC-bound to device, subject, operation, filters,
   snapshot and offset? Do tamper, cross-subject replay, filter drift and
   snapshot drift fail closed without partial protected content?
9. Are legacy task/long-term rows explicitly unavailable instead of exposed
   without a provable mobile subject identity or represented as an empty
   success?
10. Do migration 102, its triggers and the read path reject invalid direct SQL
    bytes and UPDATE/DELETE attempts without inventing signed-authority claims?
11. Are the two new module edges the exact minimum, with no route, server,
    session, listener or transport dependency and no cycle growth?
12. Do the two red gates prove fail-closed M6 evidence rebinding, and is the
    final `330/330` report bound to the exact clean candidate rather than the
    later evidence commit?

## Reproduction minimum

```bash
git diff --check 35a82422..1b0654f0
node tests/m7-settings-information-core-adapters.test.js
node tests/m7-in-process-capability-provider.test.js
node tests/m7-operation-journal.test.js
node tests/mobile-remote-capability-contract.test.js
node tests/mobile-remote-capability-provider-contract.test.js
node scripts/mobile-gate.js
node tests/schema-migrations.test.js
node tests/m1-model-failover-schema.test.js
node tests/m6-runtime-evidence.test.js
node tests/m6-technical-evidence.test.js
node tests/m6-release-validation.test.js
node tests/nightly-orchestrator-self-test.js
node tests/module-boundary-ratchet.test.js
node tests/artifact-validation.test.js
node scripts/validate-test-registry.js --json
```

Green report:
`.intentsmith-artifacts/m7-settings-information-offline-database-final-20260829/2026-08-29T03-45-01-525Z/report.json`.
Verify report SHA-256
`cd8b180e7f6785ab92b0588f0cbc5dd34a096678b5ea58c3fb3767a84d24c11d`,
source `1b0654f01784a9ae41c2cfbb1e5345c74b6f3c6e`, registry
`f322661b468ed5dc202ba6c37743a7002d8b9c251cedbb539b4a5b553f72a53a`,
verdict `PASS`, exit 0 and counts `330/0/0/0/0`.

Red intermediate reports:

- source `9296338c`: `328/2/0/0/0`, verdict `FAIL`, exit 1, SHA-256
  `6f3f299358e00ffb1a476eb550ffcc144299733ec0d9c3567b3f3dff6beb92e9`;
- source `cbdb0300`: `329/1/0/0/0`, verdict `FAIL`, exit 1, SHA-256
  `3109c60dc400a97e3bb9b5aa37446219d5edb68f2b07c91ae960575df1fd251b`.

This packet requests a verdict only for this adapter block. It does not request
M7 acceptance or authorize production mediator composition, session/cursor
keys, pairing, listener/transport activation, mobile distribution, real
LLM/GPU/device work, M5/M6 signing, rotations, history changes, promotion, tag,
publish or push.
