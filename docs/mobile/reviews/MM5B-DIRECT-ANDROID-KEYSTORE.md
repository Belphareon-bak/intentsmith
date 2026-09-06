# MM5-B review — direct AndroidKeyStore credential vault

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `14be72b8`

This checkpoint removes the deprecated AndroidX Security Crypto wrapper and
makes the secure-storage format an owned, reviewable boundary. It also closes
two client-side downgrade paths found during the review: pairing no longer
continues before the credential is durably stored, and an installed shell with
a broken vault can never fall back to browser `localStorage`.

## Delivered

- AES-256 key generated and retained by the `AndroidKeyStore` provider;
- AES-GCM envelopes with provider-generated 96-bit IVs, 128-bit tags and an
  explicit `v1` storage version;
- package name plus logical record name authenticated as AAD, preventing a
  valid ciphertext from being moved under a different meaning;
- token, device ID, scope snapshot, PIN verifier, salt and failed-attempt
  counter all encrypted by the same narrow store;
- group writes encrypt completely before one synchronous `commit()`;
- the tenth failed PIN attempt records the counter and removes the credential
  in the same commit;
- eager authentication of every envelope at open; corruption or key failure is
  reported as vault unavailability instead of an empty/unpaired store;
- logout/recovery can destroy both preference files and both key aliases even
  when normal decryption is unavailable;
- cold start seals the Capacitor plugin before `BridgeActivity` starts the
  WebView, closing the pre-overlay credential-read race;
- backup remains disabled at the application manifest boundary;
- a broken native vault disables pairing before its one-time code is consumed,
  exposes a local reset action and never writes the token to `localStorage`.

Android's current guidance deprecates `EncryptedSharedPreferences` and
`MasterKey` and points applications to platform cryptography and
`AndroidKeyStore`. The platform documentation also requires randomized
encryption and recommends letting the cipher generate the GCM IV:

- <https://developer.android.com/reference/androidx/security/crypto/package-summary>
- <https://developer.android.com/privacy-and-security/keystore>
- <https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder>

## Legacy format decision

The old prototype stored one credential in
`EncryptedSharedPreferences("intentsmith.vault")`. Its keys and values cannot
be decoded without retaining the deprecated wrapper. No production release was
made with that format, so the checkpoint intentionally does **not** add a
permanent compatibility dependency:

1. only the old private preference file and its default AndroidX master-key
   alias are removed;
2. a non-secret repair marker survives in the new store;
3. the pairing screen explains that one fresh pairing is required;
4. a successfully committed replacement credential clears the marker.

This is a one-time prototype migration, not a general promise that future
storage versions may erase credentials. Any post-release format change needs a
tested forward migration and rollback plan.

## Evidence

| Check | Result |
|---|---|
| `node tests/mobile-android-keystore.test.js` | PASS — 12/12 |
| `node tests/mobile-secure-credential.test.js` | PASS — 19/19 |
| `node tests/mobile-android-platform.test.js` | PASS — 8/8 |
| `npm run test:registry` | PASS — 435 programs |
| `node scripts/mobile-gate.js` | PASS — 52/52 active; 1 Chromium suite withheld |

Registry digest:
`7766af6e373b90d01ea3ea6517d03540be292b5f203202b1d75003a008db46da`.

Three instrumented checks now exist in
`KeystoreVaultInstrumentedTest.java`: real-provider round-trip with a negative
plaintext assertion, authenticated-corruption rejection, and the legacy reset
journey. They were **not run** on this host because JDK 21, Android SDK 36 and a
device/emulator are absent.

## Explicit non-claims and remaining boundary

- Static/source tests do not prove Android provider behavior; the instrumented
  suite and physical-device journey remain mandatory.
- The key is non-exportable, but it is not configured as a second
  user-authentication factor. `BiometricPrompt` plus process lock controls when
  the app releases the credential; a compromised native process remains
  outside this protection model.
- WebView S2 caches and the durable operation journal are not encrypted by this
  checkpoint; `ST-DB` remains an open data-boundary item.
- Production signing, clean-clone binary build, hardware-backed-level
  attestation and independent security acceptance remain open.
- MM5 is therefore still `IN PROGRESS`: remote TLS/peer identity, push/offline
  policy and external security review are not supplied by a local vault.

## Review focus

Reviewers should challenge the envelope/AAD format, key invalidation and
recovery behavior, the intentional legacy reset, Android 7 compatibility, the
cold-start ordering and the absence of every native-to-browser fallback. A
green source gate is not grounds to approve device behavior without running the
instrumented suite.
