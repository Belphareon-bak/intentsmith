// Android release boundary — invariants that must hold in a clean clone.
// The actual Gradle compile/lint/package proof is generated separately because
// it requires JDK 21 + Android SDK 36; this fast suite prevents configuration
// from silently drifting before that expensive gate runs.

import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  MOBILE_RELEASE_REMOTE_PINS,
  classifyMobileReleaseArtifact,
} from '../scripts/mobile-release-policy.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = relative => readFileSync(path.join(ROOT, relative), 'utf8');
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

console.log('\n=== Android production release boundary ===');

await test('Capacitor release line is exact and lockfile-backed', () => {
  const pkg = JSON.parse(read('mobile-app/package.json'));
  const lock = JSON.parse(read('mobile-app/package-lock.json'));
  for (const name of ['@capacitor/android', '@capacitor/core']) {
    assert.equal(pkg.dependencies[name], '8.5.0');
    assert.equal(lock.packages[''].dependencies[name], '8.5.0');
    assert.equal(lock.packages[`node_modules/${name}`].version, '8.5.0');
    assert.ok(lock.packages[`node_modules/${name}`].integrity, `${name} has no integrity pin`);
  }
  assert.equal(pkg.devDependencies['@capacitor/cli'], '8.5.0');
});

await test('APK bundles the only reviewed client and never loads server.url', () => {
  const config = JSON.parse(read('mobile-app/capacitor.config.json'));
  assert.equal(config.webDir, '../src/mobile/client');
  assert.equal(
    existsSync(path.join(ROOT, 'mobile-app/www')),
    false,
    'legacy mobile-app/www would restore a second client implementation',
  );
  assert.equal(config.server.url, undefined);
  assert.equal(config.server.androidScheme, 'https');
  assert.equal(config.android.webContentsDebuggingEnabled, false);
  assert.equal(config.plugins.CapacitorHttp.enabled, true);
});

await test('Android 16 baseline and JDK 21 wrapper are pinned', () => {
  const variables = read('mobile-app/android/variables.gradle');
  const generated = read('mobile-app/android/app/capacitor.build.gradle');
  const wrapper = read('mobile-app/android/gradle/wrapper/gradle-wrapper.properties');
  const rootBuild = read('mobile-app/android/build.gradle');
  assert.match(variables, /minSdkVersion = 24/);
  assert.match(variables, /compileSdkVersion = 36/);
  assert.match(variables, /targetSdkVersion = 36/);
  assert.match(generated, /JavaVersion\.VERSION_21/g);
  assert.match(wrapper, /gradle-8\.14\.3-all\.zip/);
  assert.match(rootBuild, /com\.android\.tools\.build:gradle:8\.13\.0/);
});

await test('release is shrunk and signing is fail-closed without harming debug tasks', () => {
  const build = read('mobile-app/android/app/build.gradle');
  assert.match(build, /minifyEnabled true/);
  assert.match(build, /shrinkResources true/);
  assert.match(build, /packagesRelease/);
  assert.match(build, /Release build has no signing key/);
  assert.match(build, /allowDebugSigning/);
  assert.match(build, /intentsmithSourceRevision/);
  assert.match(build, /git', 'rev-parse', 'HEAD'/);
  assert.doesNotMatch(build, /implementation\s+["']androidx\.security:security-crypto/);
});

await test('credential and domain stores use direct authenticated AndroidKeyStore encryption', () => {
  const storage = read('mobile-app/android/app/src/main/java/cz/intentsmith/companion/KeystoreStorage.java');
  const plugin = read('mobile-app/android/app/src/main/java/cz/intentsmith/companion/VaultPlugin.java');
  assert.match(storage, /AndroidKeyStore/);
  assert.match(storage, /AES\/GCM\/NoPadding/);
  assert.match(storage, /setRandomizedEncryptionRequired\(true\)/);
  assert.match(storage, /updateAAD\(aad\(entry\)\)/g);
  assert.match(storage, /Arrays\.fill/);
  for (const method of ['readDomain', 'writeDomain', 'clearDomain', 'consumePairingCode']) {
    assert.match(plugin, new RegExp(`void ${method}\\(`), `${method} bridge missing`);
  }
  assert.match(plugin, /device_lock_required/);
});

await test('backup, biometric lock, API 36 config changes and pairing link are declared', () => {
  const manifest = read('mobile-app/android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  assert.match(manifest, /android:fullBackupContent="@xml\/backup_rules"/);
  assert.match(manifest, /android\.permission\.USE_BIOMETRIC/);
  assert.match(manifest, /uiMode\|navigation\|density/);
  assert.match(manifest, /android:scheme="intentsmith" android:host="pair"/);
  assert.match(manifest, /cz\.intentsmith\.SOURCE_REVISION/);
});

await test('bundled client pins API origin and applies a restrictive CSP', () => {
  const html = read('src/mobile/client/index.html');
  const client = read('src/mobile/client/app.js');
  const runtime = read('src/mobile/client/runtime-config.js');
  const remoteCore = read('src/mobile/client/remote-core-v1.js');
  const serviceWorker = read('src/mobile/client/sw.js');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /runtime-config\.js/);
  assert.match(client, /invalid_mobile_gateway_origin/);
  assert.match(client, /credentials: 'omit'/);
  assert.match(client, /redirect: 'error'/);
  assert.match(client, /remote_core_transport_not_implemented/);
  assert.match(client, /Nejdřív nastav zámek obrazovky telefonu/);
  assert.match(runtime, /transportMode: 'legacy-m1-dev'/);
  assert.match(remoteCore, /REMOTE_CORE_V1_PIN/);
  assert.match(remoteCore, /sha256:245abe3a13d7d60ac537c7672522872df20f855d990bee0f02b2826379b56c52/);
  assert.match(serviceWorker, /'\/remote-core-v1\.js'/);
});

await test('release script builds APK and AAB with JDK 21 and restores tracked policy', () => {
  const script = read('scripts/mobile-android.sh');
  assert.match(script, /toolchain\/jdk21/);
  assert.match(script, /:app:assembleRelease :app:bundleRelease/);
  assert.match(script, /trap restore_policy EXIT/);
  assert.match(script, /podpisový klíč není/);
});

await test('generated Android assets pin CSP and RemoteCore identity to the artifact', () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'intentsmith-mobile-config-'));
  const android = path.join(temporary, 'android');
  const publicAssets = path.join(android, 'app/src/main/assets/public');
  const policyDirectory = path.join(android, 'app/src/main/res/xml');
  mkdirSync(publicAssets, { recursive: true });
  mkdirSync(policyDirectory, { recursive: true });
  writeFileSync(path.join(publicAssets, 'runtime-config.js'), '// generated placeholder\n');
  writeFileSync(path.join(publicAssets, 'index.html'), read('src/mobile/client/index.html'));
  writeFileSync(
    path.join(policyDirectory, 'network_security_config.xml'),
    read('mobile-app/android/app/src/main/res/xml/network_security_config.xml'),
  );
  try {
    const result = spawnSync('python3', ['scripts/mobile-android-configure-url.py'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        APP_DIR: temporary,
        ANDROID_DIR: android,
        IS_URL: 'https://gateway.example.test:4443',
      },
    });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const runtime = readFileSync(path.join(publicAssets, 'runtime-config.js'), 'utf8');
    const html = readFileSync(path.join(publicAssets, 'index.html'), 'utf8');
    assert.match(runtime, /transportMode: 'legacy-m1-dev'/);
    assert.match(runtime, new RegExp(MOBILE_RELEASE_REMOTE_PINS.descriptorDigest));
    assert.equal(
      html.match(/connect-src\s+[^;"]+/)?.[0],
      "connect-src 'self' https://gateway.example.test:4443",
      'CSP must contain the exact artifact gateway and no generic https: source',
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

await test('release evidence pins a candidate signer and labels every weaker artifact', () => {
  const evidence = read('scripts/mobile-release-evidence.mjs');
  const policy = read('scripts/mobile-release-policy.mjs');
  assert.match(evidence, /--expected-signer-sha256/);
  assert.match(evidence, /--allow-dirty/);
  assert.match(evidence, /build evidence cannot be bound to HEAD/);
  assert.match(evidence, /APK source revision mismatch/);
  assert.match(evidence, /assets\/public\/runtime-config\.js/);
  assert.match(evidence, /base\/assets\/public\/runtime-config\.js/);
  assert.match(evidence, /APK and AAB do not bundle the same reviewed mobile client/);
  assert.match(evidence, /bundled RemoteCore compatibility module does not match the source revision/);
  assert.match(policy, /THROWAWAY_DEBUG_SIGNED/);
  assert.match(policy, /NON_DEBUG_SIGNED_UNVERIFIED/);
  assert.match(policy, /CANDIDATE_SIGNED_UNREVIEWED/);
  assert.match(policy, /CANDIDATE_SIGNED_TRANSPORT_BLOCKED/);
  assert.match(policy, /M7_REMOTE_LISTENER_AUTH_PAIRING_AND_WIRE_TRANSPORT_NOT_IMPLEMENTED/);
  assert.match(policy, /CAPACITOR_HTTP_GLOBAL_FETCH_PATCH_MUST_BE_REPLACED_OR_DISABLED/);
  assert.match(evidence, /APK signer mismatch/);
  assert.match(evidence, /bundled CSP does not pin the selected gateway origin/);
});

await test('a production signer cannot promote the legacy development transport', () => {
  const shared = {
    debugSigned: false,
    expectedSigner: 'a'.repeat(64),
    descriptorDigest: MOBILE_RELEASE_REMOTE_PINS.descriptorDigest,
    adapterManifestDigest: MOBILE_RELEASE_REMOTE_PINS.adapterManifestDigest,
    nativeHttpPatchEnabled: true,
  };
  const blocked = classifyMobileReleaseArtifact({
    ...shared,
    transportMode: 'legacy-m1-dev',
  });
  assert.equal(blocked.classification, 'CANDIDATE_SIGNED_TRANSPORT_BLOCKED');
  assert.equal(blocked.releaseTransportReady, false);
  assert.deepEqual(blocked.releaseBlockers, [
    'M7_REMOTE_LISTENER_AUTH_PAIRING_AND_WIRE_TRANSPORT_NOT_IMPLEMENTED',
    'CAPACITOR_HTTP_GLOBAL_FETCH_PATCH_MUST_BE_REPLACED_OR_DISABLED',
  ]);

  const future = classifyMobileReleaseArtifact({
    ...shared,
    transportMode: 'remote-core-v1',
    nativeHttpPatchEnabled: false,
  });
  assert.equal(future.classification, 'CANDIDATE_SIGNED_UNREVIEWED');
  assert.equal(future.releaseTransportReady, true);
  assert.deepEqual(future.releaseBlockers, []);

  assert.throws(
    () => classifyMobileReleaseArtifact({
      ...shared,
      transportMode: 'remote-core-v1',
      descriptorDigest: `sha256:${'0'.repeat(64)}`,
    }),
    /does not match the reviewed M2\/M5 contract/,
  );
});

console.log(`\nAndroid production release boundary: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
