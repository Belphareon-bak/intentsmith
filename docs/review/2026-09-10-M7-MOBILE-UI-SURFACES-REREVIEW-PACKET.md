# M7 mobile UI surfaces — narrow re-review packet

Review status: `RE_REVIEW_REQUIRED`.

Candidate status: `REMEDIATION_IMPLEMENTED / HOST_GATE_GREEN /
DEVICE_NOT_RUN / NOT_ACCEPTED`.

Review exactly:

```text
427cc13e58df4d4394700aaec85132fa2eb9354c..429b779f26b2f66a1c378e529c082d6b436609ca
```

The [original independent review](2026-09-10-M7-MOBILE-UI-SURFACES-REVIEW-RESULT.md)
accepted the rest of the M7 UI candidate and required one narrow correction:
settings must reject a second activation while the first operation exists in
the durable journal but `store.flush()` has not yet completed.

The remediation adds `openSettingAttempt()` and uses it in both the dispatch
guard and the rendered write gate. The regression holds the next encrypted
domain write open, invokes `updateSetting` twice, proves that exactly one open
settings operation exists and zero requests have left before durability, then
releases the write and proves that exactly one request leaves.

## Review questions

1. Does the journal guard close the pre-`settingsSaving` window without relying
   on timing or the server's optimistic-concurrency rejection?
2. Does a pending or ambiguous settings operation keep both direct dispatch and
   the rendered controls locked until recovery resolves it?
3. Does the test actually hold the durability boundary open and prove one
   journal entry, zero early dispatches and one eventual dispatch?

## Reproduction

```bash
node tests/m7-mobile-app-runtime.test.js
npm run test:mobile
node tests/artifact-validation.test.js
node scripts/specialist-boundary-ratchet.mjs
(cd mobile-app && npm run sync)
(cd mobile-app/android && \
  JAVA_HOME=/home/belphareon/toolchain/jdk21 \
  ANDROID_HOME=/home/belphareon/toolchain/android-sdk \
  ANDROID_SDK_ROOT=/home/belphareon/toolchain/android-sdk \
  ./gradlew --no-daemon test lint)
```

Current implementer results are runtime 7/7, mobile 47/47 and Gradle
`BUILD SUCCESSFUL` with 172 tasks. Documentation validation and the boundary
ratchet are rerun after the documentation commit. Physical Android/VPN/pairing/
revocation/TalkBack, production credentials, release signing and distribution
remain outside this host-only remediation and are still `NOT RUN / NOT DONE`.

Please return `REVIEW_PASSED` or `CHANGES_REQUIRED` bound to the full candidate
hash `429b779f26b2f66a1c378e529c082d6b436609ca`.
