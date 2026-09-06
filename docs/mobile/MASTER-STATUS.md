# IntentSmith Mobile Master Status

Updated: 2026-09-06
Branch: `mobile/master-prod-ready`
Current milestones: `MM3`–`MM6` in parallel (`MM2` freeze dependency and MM3
run authority remain open)
Release verdict: `NOT READY`

## Milestone ledger

| Milestone | Status | Review commit/range | Notes |
|---|---|---|---|
| `MM0` provenance and branch | `COMPLETE` | `550856e5` | core base selected; prototype integration follows |
| `MM1` prototype integration | `COMPLETE` | `550856e5..fec916b8` | merge `c1994d9b`; mobile gate 37/37 active |
| `MM2` RemoteCorePort | `IN PROGRESS` | candidate `f4861bca` | 7 production provider registrations; freeze remains open |
| `MM3` primary mobile surfaces | `IN PROGRESS` | projects `1a7be999`; conversations `ddb90e7e` | project list/detail and conversation reads implemented; search/runs open |
| `MM4` governed surfaces | `IN PROGRESS` | settings `87a51930`; memory `2c33fd9b`; workers/specialists `49dd991d`; devices `13fa98c6` | read projections and paired-device revocation implemented; remaining safe mutations stay open |
| `MM5` transport and hardening | `IN PROGRESS` | transport `a5d5bab4`; vault `14be72b8..71746be5` | packaged native transport and direct AndroidKeyStore vault implemented; remote TLS/identity, push/offline policy and external security review remain open |
| `MM6` Android release | `IN PROGRESS` | platform `d4607100`; CLI `d8bbea33`; artifacts `8e98924d` | API 36, cross-platform workflow, versioned APK/AAB manifest and SBOM implemented; binary build, production signing and device evidence open |

## Known external blockers

- The future local mobile implementation and its security work are unavailable;
  no equivalence or superiority claim is made against it.
- Production signing keys and distribution accounts are intentionally absent.
- Physical Android hardware is not attached to the current build host.
- JDK 21 and the Android SDK are absent on this host; no APK/AAB build is
  claimed, and the Android SDK licence was not accepted on the operator's behalf.
- Chromium is unavailable on this host, so the registered browser accessibility
  suite remains explicitly withheld rather than counted as passing.

## Latest verification

- Mobile gate: `PASS` — 54/54 active suites, 1 prerequisite-blocked suite.
- RemoteCorePort candidate: 12/12 contract checks.
- Backend inventory: 245 unique static routes, including 21 exact `/m1`
  routes; digest
  `2ef4a8c06e53b7afd63aa3f9d82d1959fa7ad9a50a223138f2c270efcfb9ad62`.
- Android platform invariant suite: `PASS` — 8/8; Capacitor 8.4.3, API 36,
  Java 21 and fail-closed signing configuration.
- Mobile-app dependency audit: `PASS` — 0 known vulnerabilities in the full
  and production-only dependency trees.
- Packaged transport: `PASS` — 8/8 checks; no production `server.url`, no
  remote cleartext endpoint, no CORS widening and all client API calls retain
  the `/m1` boundary.
- Android release CLI: `PASS` — 11/11 checks on Windows; `doctor` runs without
  Bash and accurately reports the absent JDK, SDK, signing material and device.
- Direct AndroidKeyStore boundary: `PASS` — 12/12 source invariants and 19/19
  client credential/lifecycle scenarios. Three device-side instrumented tests
  are implemented but not run without an Android toolchain and target.
- Paired-device lifecycle: `PASS` — 8/8 gateway/database scenarios and 11/11
  client scenarios. Revocation is journalled and self-revocation clears the
  local credential; remote wipe is explicitly not claimed.
- Release artifacts: `PASS` — 10/10 checks; Gradle consumes the tracked
  `0.1.0`/`1000` metadata and the workflow requires signed APK+AAB, CycloneDX
  SBOM and a source/endpoint/signer manifest.
- Test registry: 437 runnable programs; digest
  `ba13e78b08c7b8e4e505668a1fe867ca5a526dc36317734c308d212d237df031`.
- Module boundary: `PASS` — 1,106 edges, 3 pre-existing cycles; reviewed
  provider additions are pinned to their MM3/MM4 checkpoint commits.

## Truth rules

- `IMPLEMENTED` means code exists and is reachable.
- `TESTED` additionally names an executable test and its result.
- `DEVICE VERIFIED` requires captured evidence from a physical device.
- `RELEASE READY` requires a clean-clone build, current target API, dependency
  review, signed-artifact procedure and accepted device/security reviews.
