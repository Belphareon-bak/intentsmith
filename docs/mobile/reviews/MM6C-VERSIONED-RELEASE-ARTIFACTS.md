# MM6-C review — versioned APK/AAB release artifacts

Status: `IMPLEMENTED AND TESTED; BINARY OUTPUT NOT RUN`
Checkpoint commit: `8e98924d`

This checkpoint turns the Android build from a single loosely identified APK
into an auditable release set. It does not claim that the set was produced on
this host; the required JDK and Android SDK remain absent.

## Delivered

- one tracked release authority, `mobile-app/release.json`;
- version `0.1.0`, Android `versionCode 1000`, and a validated monotonic mapping
  `major*1000000 + minor*1000 + patch`;
- Gradle reads application ID and version values from that authority and fails
  on missing or malformed metadata;
- one build invocation produces both signed APK and signed AAB;
- APK certificate verification and AAB signed-entry verification are mandatory;
- production dependency CycloneDX 1.5 SBOM generation is mandatory;
- a JSON manifest binds source revision/dirty state, release metadata, packaged
  endpoint, signer certificate, toolchain, dependency lock and the byte length
  plus SHA-256 of each artifact and the SBOM;
- release builds refuse dirty sources by default; production-channel manifests
  additionally reject dirty or debug-signed inputs.

The historical prototype used `versionCode 1`. Starting the new scheme at
`1000` avoids an immediate Android downgrade conflict while preserving a simple
and reviewable mapping for future versions.

Authoritative Android references:

- <https://developer.android.com/studio/publish/versioning>
- <https://developer.android.com/guide/app-bundle/test>

## Evidence

| Check | Result |
|---|---|
| `node tests/mobile-release-artifacts.test.js` | PASS — 10/10 |
| `node tests/mobile-android-cli.test.js` | PASS — 11/11 |
| `node tests/mobile-android-platform.test.js` | PASS — 8/8 |
| dirty `node scripts/mobile-android.mjs build` | expected refusal before toolchain mutation |
| dirty build with `--allow-dirty` | expected API-36 SDK refusal; no binary claim |
| `node scripts/validate-test-registry.js --json` | PASS — 434 programs |
| `node scripts/module-boundary-ratchet.mjs` | PASS — 1,106 edges, 3 pre-existing cycles |
| `npm run test:mobile` | PASS — 51/51 active; 1 Chromium suite withheld |

Registry digest:
`a64556159d6278feaa3ac30664d8535a1632292ad439af9f52215fe87b26e07b`.

## Explicit non-claims and remaining boundary

- No APK, AAB, SBOM or concrete release manifest was produced, because this
  host has no JDK 21 or Android SDK 36.
- A generated internal key is not a production key ceremony or Play App
  Signing enrollment.
- `versionCode 1000` is a repository policy decision, not evidence that the app
  has been accepted by a distribution channel.
- Clean-clone, signer continuity, Play upload, physical-device and accessibility
  evidence remain open; `RELEASE READY` is not claimed.
