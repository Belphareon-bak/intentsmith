# WP-M7-MOBILE-UI-SURFACES-20260910

**Type:** write-enabled M7 mobile client integration

**Base revision:** `8a811381519eb1e409b8953eb61ee1cc57c7858f`

**Product candidate:** `427cc13e58df4d4394700aaec85132fa2eb9354c`

**Status:** `IMPLEMENTATION_GREEN / HOST_GATE_GREEN / REVIEW_REQUIRED /
DEVICE_NOT_RUN / NOT_ACCEPTED`

## 1. User outcome

Finish the three M7 screen mappings that remained open after mobile convergence:
projects, the safe server-settings projection and stored manual information.
Use the existing production-backed M7 DTOs and native pinned transport. Do not
invent a legacy `/m1` mapping or expose broader server data.

The implementation is split into two reviewable commits:

1. `9d12cef04c3400699901eba3c3e62861ea324bf2` maps the five core operations in
   `m7-ui-api-adapter.js` and validates their response envelopes;
2. `427cc13e58df4d4394700aaec85132fa2eb9354c` adds the three user surfaces,
   mutation recovery rules and runtime coverage.

Review range: `8a811381519eb1e409b8953eb61ee1cc57c7858f..427cc13e58df4d4394700aaec85132fa2eb9354c`.

## 2. Implemented boundary

- Projects are read-only and use `project.list`, including server pagination,
  lifecycle state and workspace revision. Host roots never enter the client.
- Settings expose only the five server-authorized `settings@1` fields. An update
  requires `write:settings`, a confirmed connection and the exact fresh snapshot
  revision. The journal is persisted before native dispatch and the UI performs
  no optimistic write.
- Stored information lists only `manual_note` rows and can append a manual note
  with optional project and validated tags. The content draft is encrypted by
  the existing native domain store before dispatch.
- An ambiguous append remains `UNKNOWN`, retains the operation-bound draft and
  blocks blind resubmission until the recovery screen resolves or abandons it.
- Scope loss removes the corresponding cache and late responses are discarded.
  Offline mutation attempts do not dispatch.

The legacy transport still shows Projects as locked and has no routes for these
DTOs. Edit/delete of stored information, project mutations, agent screens and
worker/specialist/device operations remain outside this block.

## 3. Required evidence and stop conditions

Required before review:

- full registered mobile gate, including browser accessibility;
- native `/remote/v1/invoke` runtime fixture with browser fetch forbidden;
- byte-identical source and Android packaged assets after `cap sync`;
- Android JVM tests and lint under the pinned JDK 21/SDK;
- unchanged specialist boundary and current documentation census.

Stop before claiming production readiness. No physical Android, lifecycle,
TalkBack, VPN, pairing/revocation journey, production gateway identity, release
signer, APK/AAB release build or distribution is established by host tests.

Results: [execution handoff](../execution/runs/mobile/m7-ui-surfaces-20260910.md).
Independent review input:
[review packet](../review/2026-09-10-M7-MOBILE-UI-SURFACES-REVIEW-PACKET.md).
