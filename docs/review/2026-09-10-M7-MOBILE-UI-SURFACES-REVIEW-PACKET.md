# M7 mobile UI surfaces — review packet

Review status: `CHANGES_REQUIRED` on
`427cc13e58df4d4394700aaec85132fa2eb9354c`.
Candidate status: `IMPLEMENTATION_GREEN / HOST_GATE_GREEN / DEVICE_NOT_RUN /
NOT_ACCEPTED`.

Review exactly:

```text
8a811381519eb1e409b8953eb61ee1cc57c7858f..427cc13e58df4d4394700aaec85132fa2eb9354c
```

The range contains two milestones: the five-operation UI adapter in `9d12cef0`
and the projects/settings/stored-information screens in `427cc13e`. The
authoritative scope and implementer evidence are in
[`WP-M7-MOBILE-UI-SURFACES-20260910`](../wp/WP-M7-MOBILE-UI-SURFACES-20260910.md)
and the [execution handoff](../execution/runs/mobile/m7-ui-surfaces-20260910.md).

## Review questions

1. Do the adapter outputs preserve the exact server DTO meaning, cursors,
   revisions and outcome vocabulary without importing legacy `/m1` shapes?
2. Can settings dispatch without `write:settings`, a confirmed connection and
   a fresh server snapshot revision, including a scope change during the read?
3. Is a stored-information append durably recoverable if native dispatch is
   ambiguous, and can the UI accidentally submit it a second time?
4. Can a late response republish data after the corresponding read scope was
   removed?
5. Do the docs keep host verification separate from physical-device and release
   acceptance?

## Reproduction

```bash
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

Expected current results are mobile `47/47`, artifact validation `158/158`,
boundary ratchet zero violations and Gradle `BUILD SUCCESSFUL`. These results
support implementation review only. They do not substitute for a physical
Android/VPN/pairing/revocation/TalkBack run, production configuration, approved
signers, release build or distribution.

Please return one of `REVIEW_PASSED` or `CHANGES_REQUIRED` bound to the full
candidate hash. M7 remains `NOT_ACCEPTED` after code review until its remaining
physical and release prerequisites are separately evidenced.

The independent result is preserved in
[`2026-09-10-M7-MOBILE-UI-SURFACES-REVIEW-RESULT`](2026-09-10-M7-MOBILE-UI-SURFACES-REVIEW-RESULT.md).
It accepted the five review questions and found one narrow pre-dispatch race in
settings. The remediation candidate and exact reduced range are in the
[`re-review packet`](2026-09-10-M7-MOBILE-UI-SURFACES-REREVIEW-PACKET.md).
