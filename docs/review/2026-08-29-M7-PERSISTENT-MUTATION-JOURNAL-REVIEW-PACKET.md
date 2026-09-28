# M7 persistent mutation journal — independent review packet

**Requested verdict:** `REVIEW_PASSED` or `CHANGES_REQUIRED`

**Product candidate:** `ea97c410f061cf2022777a295a986b26ef773464`

**Product tree:** `23b422f435762d03fdadff1d8b1e0450e85869cf`

**Review range:**
`abc2968d0248e56e2ffa2117a8f5878a2679df66..ea97c410f061cf2022777a295a986b26ef773464`

## Review questions

Trace the production repository, provider and SQL boundary, not only fixtures:

1. Can a retry execute a second effect after a completed, concurrent,
   interrupted or handler-error attempt?
2. Does identity bind trusted device, subject and operation, and do changed
   operation type or canonical request bytes fail as conflicts?
3. Is intent durably committed before the callback, with exactly one causal
   outcome and no automatic retry of `UNKNOWN`?
4. Can an invalid provider result enter durable replay state before pair
   validation, or can replay bypass the provider's result validation?
5. Can SQLite text conversion, column/record disagreement, missing UDF, direct
   update/delete or a second connection forge accepted history?
6. Does the schema retain any request payload, or expose an untyped storage
   failure at a public journal boundary?
7. Did the two admitted module edges grow cycles or introduce server, route,
   session or network authority?
8. Are the invocation mistakes, pre-baseline 12/13 and stale-census 157/158
   represented truthfully rather than converted into product PASS?

## Reproduction minimum

```bash
git diff --check abc2968d..ea97c410
node tests/m7-operation-journal.test.js
node tests/m7-in-process-capability-provider.test.js
node scripts/mobile-gate.js
node tests/schema-migrations.test.js
node tests/m1-model-failover-schema.test.js
node tests/module-boundary-ratchet.test.js
node tests/artifact-validation.test.js
node tests/m6-runtime-evidence.test.js
node tests/m6-technical-evidence.test.js
node tests/m6-candidate-plan.test.js
node scripts/validate-test-registry.js --json
```

The final full-gate report is at
`.intentsmith-artifacts/m7-journal-offline-database-final-20260829/m7-journal-ea97c410-final/report.json`.
Verify SHA-256 `a3a3557b305007a3594bf30f8c3b03d3ab1967ecd1d0548b019d88743975b456`,
source `ea97c410f061cf2022777a295a986b26ef773464`, registry
`278c7b9ad957d61fca748452bcc60efbcbfa39d81eab61a5122feb1d684fbab5`,
verdict `PASS`, exit 0 and counts `327/0/0/0/0`.

This packet requests a verdict only for the persistent journal prerequisite.
It does not request M7 acceptance or authorize provider activation, production
handlers, session/pairing/listener work, distribution, LLM/GPU work or any
M5/M6 operator action.
