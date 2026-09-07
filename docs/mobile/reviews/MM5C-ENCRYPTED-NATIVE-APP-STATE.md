# MM5-C review — encrypted native app state

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `3817cc00`

This checkpoint closes the current Android client's plaintext-at-rest gap for
cache snapshots, message drafts, the operation recovery journal, scope state
and local preferences. The browser/PWA remains an explicitly weaker mode; the
packaged Android shell stores client state in a separate authenticated record
under the existing non-exportable `AndroidKeyStore` key.

## Delivered boundary

- `VaultPlugin` exposes locked-state-aware `readAppState` and `writeAppState`
  methods backed by the direct AES-256-GCM `KeystoreVault`;
- the native record is a bounded JSON object of at most 8 MiB and accepts only
  the client's `is.*` namespace; `is.auth.token` and `is.auth.device` are
  forbidden because their S3 identities remain separate credential records;
- credential save still commits token, device and scopes as one group; the
  app-state record carries the lower-classification synchronous scope snapshot
  beside cache, drafts, journal and preferences;
- the client hydrates the authenticated snapshot into process memory before
  any synchronous store read and serializes whole-snapshot writes through one
  ordered promise chain;
- legacy WebView `localStorage` state is copied once and erased only after the
  encrypted write succeeds; legacy token/device values are discarded, never
  promoted into a native credential;
- a present native record always wins over stale plaintext; corrupt content,
  a missing bridge or a failed write makes the native shell fail closed without
  falling back to WebView storage;
- every native non-GET API request waits for all preceding encrypted writes,
  so an operation journal entry and draft become durable before their server
  mutation can leave the phone;
- pairing performs the same durability preflight before consuming its one-time
  code. If the post-claim state write fails, the just-written credential is
  removed and the UI truthfully requires a fresh code;
- app lock removes token and decrypted app state from WebView memory while the
  encrypted record remains sealed for the reload after unlock;
- logout waits for older bridge writes, destroys the old key and vault, then
  creates a fresh key containing at most `is.prefs`; native validation refuses
  any attempt to carry cache, drafts or journal across rotation;
- the tenth failed fallback-PIN attempt removes credential and app-state
  records in the same encrypted-store commit;
- the security card reports credential storage and app-data storage separately,
  including the plaintext limitation of the browser/PWA.

## Acceptance and failure model

```text
native boot
  -> locked: read nothing; overlay remains authoritative; reload after unlock
  -> valid app.state: hydrate memory; delete stale WebView plaintext
  -> no app.state: encrypt allowed legacy is.* data; then delete plaintext
  -> invalid/unreadable/missing bridge: no localStorage fallback; block pairing

native mutation
  -> update memory and queue encrypted whole-snapshot write
  -> wait at the transport boundary
  -> confirmed write: request may leave
  -> failed write: request never reaches fetch

logout
  -> settle already-issued writes
  -> validate preferences-only reset snapshot
  -> destroy old vault and key
  -> seed preferences under a new key
```

The browser path intentionally keeps the existing synchronous `localStorage`
behavior. It is labelled as plaintext in the UI and is not evidence for the
Android at-rest property.

## Verification

Observed on 2026-09-07 from checkpoint `3817cc00` under repository-required
Node `v22.16.0`:

| Command | Result |
|---|---|
| `node --check src/mobile/client/app.js` | PASS |
| `node tests/mobile-secure-credential.test.js` | PASS — 25/25 |
| `node tests/mobile-android-keystore.test.js` | PASS — 15/15 |
| `node tests/mobile-ms14-decision.test.js` | PASS — 79/79 |
| `node tests/mobile-data-model.test.js` | PASS — 41/41 |
| `npm --prefix mobile-app run sync` | PASS — canonical client copied into the Android project |
| `npm run test:mobile` | PASS — 54/54 active; 1 Chromium prerequisite withheld |
| `npm run test:registry` | PASS — 437 registered programs |
| `node tests/module-boundary-ratchet.test.js` | PASS — 13/13 |
| `node scripts/module-boundary-ratchet.mjs` | PASS — 1,106 edges; 3 pre-existing cycles; no delta |
| `npm run mobile:inventory` | PASS — 250 routes |
| `npm run mobile:android:doctor` | diagnostic completed; JDK 21, API 36, adb target, apksigner, signing config and gateway unavailable |

The generated backend inventory remains 250 static routes, 26 exact mobile-v1
routes, 224 broader desktop/core routes and 86 candidate-port mappings. Its
digest remains
`c47a580b144d78619ca71b60c6862bf353ffa1868bf120a807c09fcb17093277`.
The registry remains 437 runnable programs with digest
`ba13e78b08c7b8e4e505668a1fe867ca5a526dc36317734c308d212d237df031`.

No new test program was created. Existing registered suites were extended:
`mobile-secure-credential` from 19 to 25 scenarios and
`mobile-android-keystore` from 12 to 15 source invariants. A fourth Android
instrumented test now covers real-provider app-state round-trip, negative
plaintext assertions, forbidden credential keys and preferences-only reset.
It was written but not executed on this host.

## Explicit non-claims

- Source tests do not prove Android provider, process-death, storage-pressure
  or physical-device behavior. The four instrumented checks and device matrix
  remain mandatory.
- This is the protected persistence implementation for the current snapshot
  store, not a general encrypted relational database or a frozen future storage
  format. Whole-snapshot write latency near the 8 MiB limit is not measured.
- Browser/PWA storage remains plaintext `localStorage`; MM5-C does not claim a
  browser keychain or make the PWA equivalent to the Android shell.
- The non-exportable key is not hardware-attested and does not protect against
  a compromised native process while the application is unlocked.
- MM5-C adds no gateway route, scope, wire field, RemoteCorePort operation,
  backend authority, search, run-progress/cancel or push behavior.
- Remote TLS/peer identity, production notification policy, production signing,
  clean-clone binary build, distribution and independent security/release
  acceptance remain open. The release verdict stays `NOT READY`.
- The unavailable local security implementation has not been compared; no
  equivalence or superiority claim is made.

## Review focus

Review the namespace and size validation, one-way migration ordering, absence
of every native-to-plaintext fallback, mutation durability barrier, lock-time
memory erasure, logout write ordering and preferences-only key rotation. Do not
treat source coverage as device, hardware-backed or release evidence.
