# M7 mobile client integration — independent review packet

**Requested verdict:** `REVIEW_PASSED` or `CHANGES_REQUIRED`

**Product candidate:** `6a5094edbacdac0fd0f5eeaa09218ffb23254193`

**Product tree:** `a86f0717b11bd4e5cf8bf4405275170ff2d5b3e6`

**Review range:** `99005858bed7737c7d3caac0f2542293f6c8fcc5..6a5094edbacdac0fd0f5eeaa09218ffb23254193`

**Exact source candidate:** `7cf1c8b77e04697115a456adf356ee56db4ce9e7`

## Review scope

Review the client/Android integration defined by
`docs/wp/WP-M7-MOBILE-CLIENT-INTEGRATION.md` and the evidence in
`docs/execution/runs/m7/m7-mobile-client-integration-20260829.md`.

Please verify independently:

1. the imported mobile-owned files match source `7cf1c8b7`, while obsolete
   backend, DB and migration surfaces were not revived;
2. `remote-core-v1` is fail-closed and cannot silently use legacy `/m1`;
3. the Android shell has one bundled client, direct AndroidKeyStore-backed
   credential storage, fail-closed release signing and no `server.url`;
4. the mobile gate selects every active C3-032 program, fails on malformed,
   empty or red selections and does not count withheld programs as PASS;
5. the exact module edge is legitimate and does not grow cycles;
6. the 325-program report is content-bound to the product candidate and the
   earlier two-blocker diagnostic is reported truthfully;
7. no claim is made for provider, listener, pairing, revocation, remote wire,
   physical device/TalkBack, production signing or distribution.

## Reproduction minimum

```bash
git diff --check 99005858..6a5094ed
npm run test:registry
npm run test:mobile
node tests/mobile-android-release.test.js
node tests/module-boundary-ratchet.test.js
node tests/artifact-validation.test.js
node tests/m6-candidate-plan.test.js
node tests/nightly-orchestrator-self-test.js
```

For the full report, validate raw bytes and its fields at
`.intentsmith-artifacts/m7-mobile-client-offline-database-rerun-20260829/2026-08-29T01-20-32-886Z/report.json`:

- SHA-256 `74bb3526703e28ea692c56fe7fca61a5b6df74bd7eace2eea4dec89df5d6c9cb`;
- source `6a5094edbacdac0fd0f5eeaa09218ffb23254193`;
- registry `67e9dd3739e59a3587720cf618bca33b633efe0b68111ea2c0d1e49381dd20e6`;
- verdict `PASS`, exit `0`, counts `325/0/0/0/0`.

This packet asks only for the client/Android integration verdict. It does not
ask the reviewer to accept M7 as a release or to reinterpret deferred M5/M6,
LLM/GPU, operator-receipt or production-security gates.
