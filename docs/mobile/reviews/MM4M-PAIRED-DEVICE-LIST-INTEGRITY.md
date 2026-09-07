# MM4-M review — paired-device list integrity

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `af33f984`

This checkpoint closes the remaining client-side trust gap in the paired-device
list delivered by MM4-D. The gateway already returned a public, versioned
projection, but the mobile client previously accepted partial or extended
objects, published an unvalidated durable cache and treated a fresh cache entry
as sufficient authority for revocation.

## Delivered surface

- strict HTTP 200/success-envelope handling for `GET /m1/devices`;
- explicit browser/native transport `no-store` for device reads and revokes;
- exact 11-field public device DTO validation, including bounded identifiers
  and names, unique scopes, timestamps, revoke coherence and `v1:` versions;
- snapshot validation with unique device ids and exactly one `current` row,
  bound to the device id held by the active credential;
- exact response-scope validation before publication;
- validation of every durable cache entry before render, with corrupt and
  expired entries deleted;
- newest-generation-wins handling for concurrent device reads;
- a volatile `devicesLive` grant: cached data remains readable but can never
  authorize a revoke;
- immediate revoke-control withdrawal while revalidating and after protocol,
  server, offline, scope-loss, lock or reconnect transitions;
- shared connection invalidation now also withdraws live mutation grants for
  stored information and workers, including repeated failures while the client
  is already marked offline.

No route, query parameter, scope, provider operation, wire field or mutation
was added. The exact mobile allow-list remains 26 routes. MM4-M hardens the
existing MM4-D consumer and does not broaden revocation into remote wipe.

## Record and snapshot boundary

An accepted device record contains exactly:

```text
createdAt, current, deviceId, expired, expiresAt, lastUsedAt,
name, revoked, revokedAt, scopes, version
```

The id uses the public token/device identifier alphabet and is bounded to
8–128 characters. The name is non-empty, trimmed and at most 64 characters.
Scopes are non-empty and unique. Required timestamps must parse, nullable
timestamps are either null or parseable, and `revoked` is true exactly when
`revokedAt` is present. Unknown fields — including credential or hash material
— reject the whole snapshot rather than being ignored.

A snapshot is authoritative only when every id is unique and exactly one row
is marked `current`; that row must match the current credential's `deviceId`.
The client therefore cannot render a plausible list belonging to another
credential as the basis for a security action.

## Cache and mutation truth

The existing device cache keeps its one-minute fresh and 15-minute hard-expiry
window. A valid non-expired snapshot can be shown during failure with its age,
but it never grants revocation authority. Invalid or expired content is removed
before publication.

The revoke flow requires both device scopes, the devices route, a healthy
connection, an exact successful live read from the current generation and the
existing two-step confirmation. Starting a new read disarms confirmation.
Offline, server and protocol failures, scope withdrawal, session lock and every
reconnect withdraw the volatile grant. A later successful exact read is the
only way to restore it.

## Authority path

```text
GET /m1/devices (HTTP/browser cache bypassed)
  -> exact route + read:devices
  -> public token repository projection
  -> exact response scopes + exact versioned device records
  -> unique ids + one current row bound to this credential
  -> validated read-only cache publication
  -> volatile live grant may unlock the existing journalled revoke flow
```

## Verification

Observed on 2026-09-07 from checkpoint `af33f984` under repository-required
Node `v22.16.0`:

| Command | Result |
|---|---|
| `node tests/mobile-devices-ui.test.js` | PASS — 15/15 |
| `node tests/mobile-devices.test.js` | PASS — 8/8 |
| `node tests/mobile-stored-information-ui.test.js` | PASS — 21/21 |
| `node tests/mobile-workers-specialists-ui.test.js` | PASS — 24/24 |
| `node tests/mobile-ms13-approvals.test.js` | PASS — 63/63 |
| `node tests/mobile-ms14-decision.test.js` | PASS — 79/79 |
| `npm run test:mobile` | PASS — 54/54 active; 1 Chromium prerequisite withheld |
| `npm run test:registry` | PASS — 437 registered programs |
| `node tests/module-boundary-ratchet.test.js` | PASS — 13/13 |
| `node scripts/module-boundary-ratchet.mjs` | PASS — 1,106 edges; 3 pre-existing cycles; no delta |
| `npm run mobile:inventory` | PASS — 250 routes |

The generated backend inventory remains 250 static routes, 26 exact mobile-v1
routes, 224 broader desktop/core routes and 86 candidate-port mappings. Its
digest remains
`c47a580b144d78619ca71b60c6862bf353ffa1868bf120a807c09fcb17093277`.
The registry remains 437 runnable programs with digest
`ba13e78b08c7b8e4e505668a1fe867ca5a526dc36317734c308d212d237df031`.

Focused coverage includes hidden fields, invalid timestamps and revoke state,
duplicate ids/scopes, missing or mismatched current-device identity, strict
HTTP status, transport cache bypass, validated/corrupt cache, generation races,
live-only mutation authority and lock/offline/reconnect/scope invalidation. No
new test program was created; the existing registered device UI suite was
extended from 11 to 15 scenarios.

## Explicit non-claims

- MM4-M does not add or change the device gateway/provider contract.
- It does not add pairing administration, token viewing, remote wipe, device
  pagination or any broader device mutation.
- The client-side scope copy is UX gating only; the server remains the
  enforcement authority.
- A valid cache is not proof that another device is still active, and it never
  permits revocation.
- Source and loopback tests are not Android device evidence.
- Chromium, JDK 21, Android SDK 36 and a physical Android target are absent on
  this host; no current APK/AAB build, WebView journey or device result is
  claimed.
- Remote TLS/peer identity, production signing/distribution and independent
  release/security acceptance remain open.
- The unavailable local security implementation has not been compared; no
  equivalence or superiority claim is made.

## Review focus

Review the exact public DTO and current-credential binding, cache deletion and
read-only fallback, generation guard, transport `no-store`, cross-surface live
grant invalidation, scope withdrawal and the rule that only a current exact
live read can unlock the existing two-step revoke flow. A green source gate is
not device or release evidence.
