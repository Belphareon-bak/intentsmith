# MM4-D review — paired-device lifecycle

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `13fa98c6`

Subsequent checkpoint MM4-E (`4bb9011d`) completed the revision-checked
settings-write item that was still open when this review was recorded. The
remaining-work section below is historical as of MM4-D.

This checkpoint turns the specified MS-04 device screen into a real,
server-authoritative lifecycle surface. A paired phone can inspect public
metadata for mobile credentials and, only with a separate write scope, revoke
one. The feature is intentionally denial-of-access authority: it can cut off a
credential, but it cannot read, mint, recover or widen one.

## Delivered

- exact allow-list entries `GET /m1/devices` and
  `POST /m1/devices/:id/revoke`;
- pairable `read:devices` and `write:devices` scopes, included in the normal
  full-scope pairing profile;
- a public device DTO containing device ID, name, scopes and lifecycle times,
  but never a token, token hash or admin/security capability;
- `Cache-Control: no-store` on successful list and mutation responses;
- server-derived `current`, `expired`, `revoked` and record-version fields;
- an idempotent `device.revoke` operation bound to the initiating device,
  operation key and exact target;
- atomic SQLite commit of token revocation and its durable operation result;
- a real Settings entry and paired-device screen with loading, empty, failed,
  stale-cache, read-only and scope-withdrawal states;
- two-step, single-target confirmation; every revoke is disabled while the
  list is stale, offline, failed or being refreshed;
- immediate local credential and cache cleanup after self-revocation;
- operation-journal recovery for lost or unreadable mutation results, without
  automatic retry;
- Android-vault cleanup when any request receives `token_revoked`,
  `token_expired` or another invalid-token response. A failed Keystore deletion
  remains visible and the current process still drops its credential.

## Authority and threat boundary

`write:devices` is meaningful authority: a holder can deny service to other
paired mobile credentials. It does not grant `write:security`, access the
desktop token-administration API, reveal credential material, create pairing
codes or modify scopes. Reviewers should nevertheless treat it as a high-impact
scope and issue it only where mobile device management is intended.

Revocation blocks future authenticated requests. It is **not remote wipe** and
cannot erase content already stored on an offline or lost phone. The response
contains `remoteWipe: false`, and both the first confirmation and the success
copy state this limit explicitly.

Self-revocation is a terminal identity transition. The server writes the
revocation and `CONFIRMED` journal result in one transaction because the caller
cannot query that journal after commit. Before dispatch, the UI warns when the
phone holds unresolved operation keys; after a confirmed result, the client
clears the Keystore-backed credential and derived domain data.

## Mutation and recovery rules

1. The client obtains a fresh device list and the user selects one row.
2. A second, target-bound confirmation mints and persists one 128-bit
   `operationId` before dispatch.
3. The server binds `(initiating device, operationId)` to the target fingerprint.
4. Same key plus same target replays the recorded result; same key plus another
   target is `operation_conflict`.
5. A malformed response, transport loss or ambiguous server result leaves the
   local record `UNKNOWN` and points to MS-20. The client never auto-retries.
6. An unknown device ID is rejected before journal allocation.

## Evidence

| Check | Result |
|---|---|
| `node tests/mobile-devices.test.js` | PASS — 8/8 |
| `node tests/mobile-devices-ui.test.js` | PASS — 11/11 |
| `node tests/mobile-capability-inventory.test.js` | PASS |
| `node scripts/module-boundary-ratchet.mjs` | PASS — 1,106 edges; 3 existing cycles; no delta |
| `npm run test:mobile` | PASS — 54/54 active; 1 Chromium suite withheld |
| `node scripts/validate-test-registry.js --json` | PASS — 437 programs |

Registry digest:
`ba13e78b08c7b8e4e505668a1fe867ca5a526dc36317734c308d212d237df031`.

Generated backend inventory: 245 static routes, 21 exact mobile-v1 routes,
digest
`2ef4a8c06e53b7afd63aa3f9d82d1959fa7ad9a50a223138f2c270efcfb9ad62`.

The Chromium suite is still registry-`BLOCKED` because this host has no
Chromium runtime. No browser accessibility pass is inferred from the source
tests. JDK 21, Android SDK 36 and an attached Android target are also absent, so
the current APK/AAB and physical self-revoke journey were not built or run.

## Explicit non-claims

- This is not a remote-wipe implementation.
- It is not a desktop device-administration UI or general security API.
- Source and loopback tests do not establish Android Keystore behavior on a
  physical device.
- The current remote listener, TLS/peer identity, push policy, production
  signing and release acceptance remain open.
- The unavailable local security implementation has not been compared; no
  equivalence or superiority claim is made.
- MM4 remains `IN PROGRESS`: governed worker/specialist actions,
  revision-checked settings writes and safe stored-information mutations are
  separate reviewable work.

## Review focus

Review the scope decision, absence of credential material, transaction boundary
for self-revocation, operation fingerprint/replay behavior, stale-list mutation
lock, scope-withdrawal invalidation, native-vault deletion path and every place
where the UI denies remote wipe. A green source gate is not device evidence.
