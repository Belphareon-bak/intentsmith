# M7 project core adapters — independent review packet

**Requested verdict:** `REVIEW_PASSED` or `CHANGES_REQUIRED`

**Product candidate:** `e937344a94b71303646ccdae1b658c7c4fba6248`

**Product tree:** `299daec816c3e8f2ff084fe2680561b6618d25ad`

**Review range:**
`6e4fc2cfb50da4a76f0e69564f581d96ea955b3c..e937344a94b71303646ccdae1b658c7c4fba6248`

## Review questions

Trace the production handler and M2 provider call graph, not only fixtures:

1. Can request bytes self-assert device, subject, project access, canonical
   root or the cursor key, or do all of them come from trusted composition?
2. Does denial happen before filesystem observation, and can revocation during
   list/context work still release metadata or content?
3. Is the cursor canonical and authenticated across device, subject,
   capability/version, operation, filters, complete snapshot and offset?
4. Do one-request workspace/catalog races, between-page drift, tampering and
   wrong-key replay fail closed without mixing snapshots?
5. Can a project path appear in any result, error or provider metadata, and
   does absence share the same response as access denial?
6. Does rootless context invoke the accepted M2 manifest/retrieval authority
   and validate the returned exact snapshot instead of rebuilding a weaker
   retrieval path?
7. Does the 200-project bound fail before partial authorization/projection, and
   are the non-atomic cross-resource and active-only limits stated truthfully?
8. Do the two admitted imports grow cycles or reach route, server, DB singleton,
   session, listener or network authority?
9. Is the first `327/1` full gate preserved, and does `e937344a` correctly pin
   the 120th protected DB root rather than hiding the oracle failure?

## Reproduction minimum

```bash
git diff --check 6e4fc2cf..e937344a
node tests/m7-project-core-adapters.test.js
node tests/m7-in-process-capability-provider.test.js
node tests/m7-operation-journal.test.js
node scripts/mobile-gate.js
node tests/schema-migrations.test.js
node tests/m1-model-failover-schema.test.js
node tests/harness-exit-code.test.js
node tests/module-boundary-ratchet.test.js
node tests/artifact-validation.test.js
node tests/m6-runtime-evidence.test.js
node tests/m6-technical-evidence.test.js
node tests/m6-candidate-plan.test.js
node scripts/validate-test-registry.js --json
```

The green full-gate report is at
`.intentsmith-artifacts/m7-project-core-offline-database-rerun-20260829/m7-project-core-e937344a-final/report.json`.
Verify SHA-256 `bbf234ae74589f22c3d2ae4d46c44d916fec7754c895335822627154bb9fa2a4`,
source `e937344a94b71303646ccdae1b658c7c4fba6248`, registry
`82c2d70acfbfbc84f2d8db8f950824133e71baacbfe6e1cddc5daed5a4fd10e2`,
verdict `PASS`, exit 0 and counts `328/0/0/0/0`.

The superseded red report is at
`.intentsmith-artifacts/m7-project-core-offline-database-final-20260829/m7-project-core-54e62859-final/report.json`
with SHA-256 `daba8f29655407ed9338f45bfa628d412aa9ddd0d95d49e37a740084531d7be4`,
verdict `FAIL`, exit 1 and counts `327/1/0/0/0`.

This packet requests a verdict only for the project core adapter block. It does
not request M7 acceptance or authorize production composition, a session key,
pairing, revocation, listener/transport activation, mobile distribution,
LLM/GPU work or any M5/M6 operator action.
