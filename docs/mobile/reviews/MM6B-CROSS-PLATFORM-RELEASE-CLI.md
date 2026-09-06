# MM6-B review — cross-platform Android release CLI

Status: `IMPLEMENTED AND TESTED; BINARY/DEVICE NOT RUN`
Checkpoint commit: `d8bbea33`

This checkpoint replaces the Bash-only Android workflow with one Node CLI used
by npm on Windows, Linux and macOS. The existing shell entry point remains a
six-line compatibility delegate and owns no release behavior.

## Delivered

- native `doctor`, `reverse`, `keystore`, `build`, `install` and `run` commands;
- deterministic Android SDK discovery and explicit JDK 21/API 36 checks;
- direct Gradle wrapper invocation through Java, avoiding `.bat`/shell quoting;
- Capacitor client copy plus validated packaged endpoint preparation;
- fail-closed signing before the build and mandatory `apksigner.jar` verification
  of the produced APK;
- an explicit `--debug-signing` throwaway escape valid only for `build`;
- random internal key passwords passed to `keytool` through a child-only
  environment variable rather than process arguments;
- read-only `doctor`, plus `doctor --strict` for automation.

`npm run mobile:android:doctor` now executes successfully on the current Windows
host. It accurately reports that adb, JDK 21, Android API 36, build-tools,
signing configuration, a device and a local gateway are absent. That is a
diagnostic PASS, not a build PASS.

## Evidence

| Check | Result |
|---|---|
| `node tests/mobile-android-cli.test.js` | PASS — 11/11 |
| `node tests/mobile-android-platform.test.js` | PASS — 8/8 |
| `node tests/mobile-packaged-transport.test.js` | PASS — 8/8 |
| `node scripts/validate-test-registry.js --json` | PASS — 433 programs |
| `node scripts/module-boundary-ratchet.mjs` | PASS — 1,106 edges, 3 pre-existing cycles |
| `node tests/module-boundary-ratchet.test.js` | PASS — 13/13 |
| `npm run test:mobile` | PASS — 50/50 active; 1 Chromium suite withheld |

Registry digest:
`8bebec957011c77b832aee9f74f60df76fdf954395ace3facc0507a27c6679fe`.

## Explicit non-claims and remaining boundary

- No JDK/SDK licence was accepted and no toolchain was installed for the
  operator.
- No APK/AAB build or clean-clone reproduction is claimed.
- The `keystore` command creates an internal development identity only. It is
  not a production key ceremony, backup, ownership or rotation process.
- No device/emulator was attached; install, launch and physical security checks
  remain `NOT RUN`.
- Release versioning, signed AAB output, artifact manifest/SBOM and distribution
  account work remain open.
