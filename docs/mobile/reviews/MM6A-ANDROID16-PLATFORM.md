# MM6-A review — supported Android 16 platform baseline

Status: `IMPLEMENTED AND STATICALLY TESTED; BINARY BUILD NOT RUN`
Checkpoint commit: `d4607100`

This checkpoint moves the checked-in Android shell from the unsupported
Capacitor 6 / API 34 generation to a supported Capacitor 8 / API 36 baseline.
It intentionally does not combine that migration with the transport or vault
redesign, so the platform delta can be reviewed and reverted independently.

## Delivered

- exact pins for `@capacitor/android`, `@capacitor/core` and `@capacitor/cli`
  at `8.4.3`;
- Android `minSdk 24`, `compileSdk 36` and `targetSdk 36`;
- Gradle `8.14.3`, Android Gradle Plugin `8.13.0`, Google Services plugin
  `4.4.4` and the Capacitor 8 AndroidX floors;
- generated Java 21 compilation settings;
- Android 16 `density` plus keyboard `navigation` activity configuration;
- release WebView debugging and Capacitor logging disabled;
- the existing fail-closed signing behavior retained;
- an offline regression suite that pins these release-relevant invariants.

## Dependency decision

On 2026-09-06, `8.5.1` was the newest Capacitor release, but its CLI dependency
tree produced four moderate development-tool findings in `npm audit`. Capacitor
8.5 changes are iOS-only; this repository currently contains only Android.
The Android shell is therefore pinned to `8.4.3`, still in the active v8 major,
with the safe transitive XML parser patch selected by npm. Both production and
complete mobile-app dependency audits then report zero known vulnerabilities.

Authoritative references used for this checkpoint:

- <https://developer.android.com/google/play/requirements/target-sdk>
- <https://capacitorjs.com/docs/updating/8-0>
- <https://capacitorjs.com/docs/main/reference/support-policy>

## Evidence

| Check | Result |
|---|---|
| `npx cap sync android` | PASS — native project regenerated for Capacitor 8 |
| `npx cap doctor` | PASS — Android project recognized; 8.4.3 pins reported |
| `npm audit` in `mobile-app/` | PASS — 0 known vulnerabilities |
| `npm audit --omit=dev` in `mobile-app/` | PASS — 0 known vulnerabilities |
| `node tests/mobile-android-platform.test.js` | PASS — 8/8 |
| `npm run test:mobile` | PASS — 48/48 active; 1 Chromium suite withheld |

No APK/AAB build is claimed. This host has Node 22 but no JDK 21, Android SDK
or accepted Android SDK licence. It would be incorrect to turn static checks
into a binary-build verdict or to accept a legal licence on the operator's
behalf.

## Remaining release boundary

- `server.url` still loads the gateway as an external live-reload origin. The
  Capacitor documentation explicitly marks this configuration as not intended
  for production; packaged UI plus an explicit transport boundary is MM5/MM6
  work, not hidden by this checkpoint.
- The credential vault still depends on deprecated alpha-generation
  `EncryptedSharedPreferences`; direct AndroidKeyStore storage remains open.
- A Windows-native build/doctor path, clean-clone binary build, production
  signing ceremony and physical-device matrix remain open.
- `DEVICE VERIFIED` and `RELEASE READY` are not claimed.
