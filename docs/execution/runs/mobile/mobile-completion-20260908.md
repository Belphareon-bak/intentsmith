# Mobile completion — 2026-09-08

Status: IMPLEMENTATION_GREEN / REVIEW_PENDING / NOT_RELEASE_READY.
This is exact-run evidence, not a replacement milestone authority.

Base: `de0e81275afa381dd6a73afbb699bde47971b658`.
Owned branch: `work/mobile-completion-20260908`.
Owned checkout: `/home/belphareon/worktrees/is-mobile-completion-20260908`.
Product candidate: NOT_ISSUED. Independent review: PENDING.
Scope and authority: [WP](../../../wp/WP-MOBILE-COMPLETION-20260908.md).

## Inventory and compatibility

Integration `codex/m7-mobile-contract-integration-20260829` was pinned at
`de0e8127`. Its foreign writer is building native M7 Java/client transport;
that dirty work was not modified, imported or tested as committed evidence.
UI donor `wp/mobile-convergence-prep-20260908` was clean at
`5cd14776a621b66292d7124604c215e51ad19636`. Archive donor `ab1940aa` was clean.
Main checkout `832db06f` has foreign dirt and was left untouched. No push.

The UI donor cannot be merged wholesale: `/m1` versus signed `/remote/v1`,
different settings/project/stored-information DTOs, no B projectId list filter,
and no B workers/specialists/device-management operations. Donor navigation
also uses scopes without enforcing advertised availability. These are actual
integration requirements, not completed features. Current core has M7 VPN
runtime wiring; old listener-absent snapshots do not describe this base.

## Implemented in this cut

Source-compatible CSS/a11y changes, fail-closed dirty release provenance and
current README/runbook pointers. No core/server, migration, wire contract,
Android/native foreign code or trust-store changes. Focused tests are green;
whole-gate verification and independent source review remain pending.

Raw logs: `.intentsmith-artifacts/mobile-completion-20260908/` in owned checkout.
Initial browser launch was BLOCKED by root-created artifact directory mode;
0700 correction fixed this run prerequisite, without changing test assertions.
Original browser suite: 22 PASS / 0 FAIL. Strengthened oracle: 21 PASS / 3 FAIL.
Including real MS-14 decision controls: 20 PASS / 4 FAIL. These red runs remain
retained. Measured defects: light primary text 3.90:1, dark danger label 2.80:1,
dark selected navbar 4.28:1 and horizontal overflow at 200% font.
After repair: browser 24 PASS / 0 FAIL across 8 existing integration surfaces;
Android release boundary 16 PASS / 0 FAIL. No donor-only screen is counted.

## Milestone boundaries

Existing donor MM0/MM1 completion belongs to its own lineage, not this candidate.
MM2 needs the accepted B connector/DTO consumer; MM3/MM4 need per-domain porting,
server capability+scope gates and missing BE-owned operations. MM5 requires
native session/security/lifecycle integration plus physical evidence; browser
accessibility alone cannot close it. MM6 requires final-tree APK/AAB binding,
production signer authority, distribution and device acceptance. M7 global
acceptance and M5/M6 receipts remain outside this mobile-only slice.

## Host and remaining prerequisites

2026-09-08 observation: Temurin21.0.12+8, SDK36/build-tools36.0.0,
Gradle8.14.3 cache, Capacitor8.5.0 lock, AGP8.13.0; pinned bundletool1.18.1
SHA-256 `a73341a7945abcb0e6b8971c7b1b2801bd765006447ca0d2437a4260d572ceac`.
Root and mobile dependencies installed offline successfully; Chromium145.0.7632.67
reused from host cache into the owned project cache.
`adb devices -l`: no device (started local adb daemon5037).
`ip -brief address`: lo, Wi-Fi and Docker/veth, no VPN interface.

Needed for actual production acceptance: integrated native client with bundled
Decision042 origin/SPKI and exact source asset manifest; no global HTTP patch;
physical phone/VPN pairing, replay/mismatch/expiry/revocation/recovery/TalkBack
matrix; systemd credential custody; explicit APK/AAB signer identities;
distribution and operator acceptance. No credentials were generated or read,
no real pairing, listener activation, device installation, tag or publication.

## Handoff

Pending source commit, whole tests, independent review and owned sandbox cleanup.
Do not infer PROD_READY from this document or transfer donor test counts.
