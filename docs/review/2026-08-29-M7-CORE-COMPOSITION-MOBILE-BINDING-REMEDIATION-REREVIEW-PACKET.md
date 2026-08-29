# M7 composition/mobile remediation and M6 registry ratchet — re-review packet

## Requested verdicts

```text
M6_REGISTRY_RATCHET    = REVIEW_PASSED | CHANGES_REQUIRED
CORE_COMPOSITION       = REVIEW_PASSED | CHANGES_REQUIRED
MOBILE_RELEASE_BINDING = REVIEW_PASSED | CHANGES_REQUIRED
```

This packet does not request M6 or M7 acceptance. Until independent review
returns pass, the authoritative state remains:

```text
M6 = REGISTRY_RATCHET_REMEDIATION_IMPLEMENTED / RE_REVIEW_REQUIRED /
     ACCEPTANCE_BLOCKED
M7 = CORE_COMPOSITION_CHANGES_REQUIRED /
     MOBILE_RELEASE_BINDING_CHANGES_REQUIRED /
     REMEDIATION_IMPLEMENTED / PROVIDER_NOT_ACTIVE / TRANSPORT_ABSENT
```

## Exact scope

- prior rejected candidate:
  `d43e7ada01d6e5de38a06d79021bde8909d2eba3`;
- exact product candidate:
  `57ac2a4d3154df8016aea907ead5c68c4606d237`;
- product tree:
  `b7131f405ffa74e0fa06297e608cf3ec397b5fdc`;
- remediation range:
  `d43e7ada01d6e5de38a06d79021bde8909d2eba3..57ac2a4d3154df8016aea907ead5c68c4606d237`;
- cumulative range for original composition/mobile assertions:
  `1d04bd42bbaa79e9da1fe2b6b59b6589ce8efad5..57ac2a4d3154df8016aea907ead5c68c4606d237`;
- registry fingerprint:
  `a316db7caa97b966c557d2f6f4c2934048b0b7351eb1eac22c144e5479f96479`.

The rejected review identified five M7 findings. The operator then added two
M6 findings, M6-R01 and M6-R02, caused by the same registry/plan drift. Review
all seven closures rather than only rerunning the focused tests.

## A. M6 registry ratchet

Trace registry → ACTIVE+required derivation → locked plan → release evidence
run selection → Gate 0 reviewed fingerprint.

1. Does the current registry contain 493 runnable programs, 399 ACTIVE and 394
   ACTIVE+required under fingerprint `a316db7c…f96479`?
2. Are `IS-T1-TESTS-SIGNED-AUTHORITY-BUNDLE-TEST` and
   `IS-T1-TESTS-SIGNED-AUTHORITY-RECEIPT-TEST` ACTIVE+required offline suites?
3. Does the locked plan derive the exact complete 394-program set and retain
   explicit sentinels for those two authority proofs?
4. Does the negative regression prove that removing either suite fails the
   plan rather than silently producing a smaller green release run?
5. Does `nightly-orchestrator-self-test` validate the same current registry
   fingerprint instead of the pre-ceremony hash?
6. Are the 394-program complete plan and 333-program offline/database profile
   correctly kept distinct in claims and evidence?

## B. Bounded operation recovery

Trace adapter request → cursor authentication → repository query → result and
next cursor. Do not accept an in-memory post-filter as bounded paging.

1. Is `pageSize` bounded to 1–100 and is SQL limited to `pageSize + 1`?
2. Are filters, partition identity and terminal state enforced inside the
   single joined query, without one query per operation?
3. Does the keyset carry the exact snapshot bound, sequence and operation ID,
   and remain stable when a newer operation is inserted between pages?
4. Does the HMAC cursor bind device, subject, capability, filters and workspace
   revision and fail closed under substitution?
5. Do migration 104 indexes cover the actual partition/order/join predicates?
6. Does the 240-operation adversarial test assert execution shape as well as
   returned values?

## C. Complete APK/AAB source binding

Trace Git source → generated canonical manifest/plugin registry → build
transform → archive extraction → final evidence manifest.

1. Do APK and AAB each contain the same canonical manifest for exact candidate
   `57ac2a4d`, rather than merely matching one another?
2. Are application ID, version code/name, min/target SDK and source revision
   independently parsed from each archive and compared to source-derived
   expectations?
3. Are APK and AAB signer SHA-256 values independently parsed, independently
   expected and stored separately in the evidence?
4. Is the AAB network-security tree derived via the pinned bundletool artifact,
   decoded and compared both to policy and to the APK tree?
5. Is the expected Capacitor plugin registry derived from the pinned package
   graph, with both archives compared to it rather than only to each other?
6. Do stale manifest, signer, plugin, Android metadata, source revision and
   network-policy negative cases fail closed?
7. Does the final manifest retain development transport as non-release even
   under an otherwise accepted signer?

## D. Evidence and documentation truth

1. Do the cumulative and remediation ranges above resolve exactly?
2. Do ROADMAP and SYSTEM-MAP preserve the prior `CHANGES_REQUIRED` verdict
   while recording only remediation implementation and re-review readiness?
3. Are all four new deterministic reports preserved with their real verdicts,
   including the three red diagnostics?
4. Does the final report bind source `57ac2a4d`, registry `a316db7c…f96479`,
   counts `333/0/0/0/0`, verdict PASS and exit 0?
5. Does the physical evidence manifest bind the retained APK/AAB bytes and
   label them `THROWAWAY_DEBUG_SIGNED` with `releaseTransportReady: false`?
6. Does the review avoid transferring the older running M6 soak or claiming
   live LLM/GPU, production signing, device or transport evidence?

## Reproduction

```bash
git diff --check d43e7ada..57ac2a4d
git diff --check 1d04bd42..57ac2a4d

node tests/m7-operation-control-adapters.test.js
node tests/mobile-android-release.test.js
node scripts/mobile-gate.js
node tests/m7-core-composition.test.js
node tests/m6-candidate-plan.test.js
node tests/m6-technical-evidence.test.js
node tests/m6-runtime-evidence.test.js
node tests/schema-migrations.test.js
node tests/m1-model-failover-schema.test.js
node tests/module-boundary-ratchet.test.js
node tests/artifact-validation.test.js
node tests/nightly-orchestrator-self-test.js
node scripts/validate-test-registry.js
```

The exact green gate is:

`.intentsmith-artifacts/m7-remediation-offline-database-20260829/57ac2a4d-final/m7-remediation-57ac2a4d-final/report.json`

Expected SHA-256:
`923070a9982654f83d5bad9074ddc347f67882a0bb6e4c370e73126fb65e5fcc`.

The exact retained physical build evidence is:

`.intentsmith-artifacts/mobile-release/57ac2a4d3154/manifest.json`

Expected SHA-256:
`1ca7ceeaba081cdfd2f21dc539fc9d9e328723e6cfb52dec23327e822edb6acc`.

The complete evidence ledger is
[`m7-core-composition-mobile-binding-remediation-20260829.md`](../execution/runs/m7/m7-core-composition-mobile-binding-remediation-20260829.md).

This packet does not authorize an offline ceremony, production signing,
distribution, device test, session/pairing/listener/transport activation, live
LLM/GPU work, M5/M6 receipts, rotation, history changes, promotion, merge, tag,
publish or push.
