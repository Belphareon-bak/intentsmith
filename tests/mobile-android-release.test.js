// Android release boundary — invariants that must hold in a clean clone.
// The actual Gradle compile/lint/package proof is generated separately because
// it requires JDK 21 + Android SDK 36; this fast suite prevents configuration
// from silently drifting before that expensive gate runs.

import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
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
import {
  MOBILE_RELEASE_EXACT_SOURCE_ASSETS,
  MOBILE_RELEASE_SOURCE_MANIFEST_ASSET,
  deriveMobileCapacitorPluginRegistryV1,
  readMobileSourceRuntimeIdentityV1,
  renderMobileGeneratedIndexV1,
  renderMobileGeneratedRuntimeConfigV1,
  renderMobileReleaseSourceManifestV1,
  validateMobileReleaseArtifactBindingV1,
  validateMobileNetworkSecurityTreeV1,
} from '../scripts/mobile-release-artifact-binding.mjs';
import {
  parseAabReleaseObservationV1,
  parseApkReleaseObservationV1,
  validateMobileAndroidObservationsV1,
} from '../scripts/mobile-release-android-observation.mjs';
import {
  MOBILE_M7_RUNTIME_CHECK_IDS,
  validateMobileM7RuntimeEvidenceV1,
} from '../scripts/mobile-m7-runtime-evidence.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = relative => readFileSync(path.join(ROOT, relative), 'utf8');
const M7_TEST_ORIGIN = 'https://100.64.0.10:7443';
const M7_TEST_SPKI_PIN = `sha256:${'ab'.repeat(32)}`;

function artifactBindingFixture({
  gatewayUrl = 'https://gateway.example.test:4443',
  transportMode = 'legacy-m1-dev',
  serverIdentityPin = null,
} = {}) {
  const sourceRuntimeConfig = read('src/mobile/client/runtime-config.js');
  const sourceRuntimeIdentity = readMobileSourceRuntimeIdentityV1(sourceRuntimeConfig);
  const runtimeIdentity = transportMode === 'remote-core-v1'
    ? {
      transportMode,
      descriptorDigest: MOBILE_RELEASE_REMOTE_PINS.descriptorDigest,
      adapterManifestDigest: MOBILE_RELEASE_REMOTE_PINS.m7AdapterManifestDigest,
      serverIdentityPin,
      serverOrigin: gatewayUrl,
    }
    : sourceRuntimeIdentity;
  const sourceIndex = read('src/mobile/client/index.html');
  const sourceAssets = Object.fromEntries(MOBILE_RELEASE_EXACT_SOURCE_ASSETS.map(asset => [
    asset,
    read(`src/mobile/client/${asset}`),
  ]));
  const generatedRuntimeConfig = renderMobileGeneratedRuntimeConfigV1({
    gatewayUrl,
    ...runtimeIdentity,
  });
  const generatedIndex = renderMobileGeneratedIndexV1(sourceIndex, gatewayUrl, transportMode);
  const sourceCapacitorConfig = read('mobile-app/capacitor.config.json');
  const sourcePackageJson = read('mobile-app/package.json');
  const sourcePackageLock = read('mobile-app/package-lock.json');
  const android = {
    applicationId: 'cz.intentsmith.companion',
    versionCode: '1',
    versionName: '1.0',
    minSdk: '24',
    targetSdk: '36',
  };
  const sourceRevision = 'a'.repeat(40);
  const expectedSourceManifest = renderMobileReleaseSourceManifestV1({
    sourceRevision,
    android,
    gatewayUrl,
    sourceCapacitorConfig,
    sourcePackageJson,
    sourcePackageLock,
    sourceRuntimeConfig,
    generatedRuntimeConfig,
    sourceIndex,
    sourceAssets,
  });
  return {
    sourceCapacitorConfig,
    apkCapacitorConfig: sourceCapacitorConfig,
    aabCapacitorConfig: sourceCapacitorConfig,
    sourceRuntimeConfig,
    apkRuntimeConfig: generatedRuntimeConfig,
    aabRuntimeConfig: generatedRuntimeConfig,
    sourceIndex,
    apkIndex: generatedIndex,
    aabIndex: generatedIndex,
    sourceAssets,
    apkAssets: { ...sourceAssets },
    aabAssets: { ...sourceAssets },
    sourcePackageJson,
    sourcePackageLock,
    apkPlugins: '[]\n',
    aabPlugins: '[]\n',
    expectedSourceManifest,
    apkSourceManifest: expectedSourceManifest,
    aabSourceManifest: expectedSourceManifest,
    android,
    sourceRevision,
  };
}

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
  assert.equal(config.plugins.CapacitorHttp.enabled, false);
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
  assert.match(build, /task\.name == 'packageRelease'/);
  assert.match(build, /task\.name == 'packageReleaseBundle'/);
  assert.doesNotMatch(build, /startsWith\('packageRelease'\)/);
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
  assert.match(client, /createM7NativeRemoteClient/);
  assert.match(client, /createM7UiApiAdapter/);
  assert.match(client, /remote_core_native_shell_required/);
  assert.doesNotMatch(client, /remote_core_transport_not_implemented/);
  assert.match(client, /Nejdřív nastav zámek obrazovky telefonu/);
  assert.match(runtime, /transportMode: 'legacy-m1-dev'/);
  assert.match(remoteCore, /REMOTE_CORE_V1_PIN/);
  assert.match(remoteCore, /sha256:245abe3a13d7d60ac537c7672522872df20f855d990bee0f02b2826379b56c52/);
  assert.match(serviceWorker, /'\/remote-core-v1\.js'/);
  assert.match(serviceWorker, /'\/m7-native-remote-client\.js'/);
  assert.match(serviceWorker, /'\/m7-runtime-contract-v1\.js'/);
  assert.match(serviceWorker, /'\/m7-ui-api-adapter\.js'/);
});

await test('native M7 transport is pinned, serialized and unavailable to WebView fetch', () => {
  const build = read('mobile-app/android/app/build.gradle');
  const activity = read('mobile-app/android/app/src/main/java/cz/intentsmith/companion/MainActivity.java');
  const plugin = read('mobile-app/android/app/src/main/java/cz/intentsmith/companion/M7RemotePlugin.java');
  const transport = read('mobile-app/android/app/src/main/java/cz/intentsmith/companion/M7PinnedHttpsClient.java');
  assert.match(build, /M7_REMOTE_ORIGIN/);
  assert.match(build, /M7_REMOTE_SPKI_PIN/);
  assert.match(build, /org\.bouncycastle:bcprov-jdk18on:1\.79/);
  assert.match(activity, /registerPlugin\(M7RemotePlugin\.class\)/);
  assert.match(plugin, /private final Object serial/);
  assert.match(plugin, /synchronized \(serial\)/);
  assert.match(transport, /Build\.VERSION\.SDK_INT < MINIMUM_REMOTE_API/);
  assert.match(transport, /SSLContext\.getInstance\("TLSv1\.3"\)/);
  assert.match(transport, /openConnection\(Proxy\.NO_PROXY\)/);
  assert.match(transport, /setInstanceFollowRedirects\(false\)/);
  assert.match(transport, /getHeaderField\("Transfer-Encoding"\)/);
  assert.match(transport, /declaredLength < 2/);
  assert.match(transport, /declaredLength != responseBytes\.length/);
  assert.match(transport, /MessageDigest\.isEqual\(expectedPin, observed\)/);
  assert.doesNotMatch(transport, /setHostnameVerifier/);
});

await test('release script builds APK and AAB with JDK 21 and restores tracked policy', () => {
  const script = read('scripts/mobile-android.sh');
  assert.match(script, /toolchain\/jdk21/);
  assert.match(script, /npx cap sync android/);
  assert.match(script, /:app:assembleRelease :app:bundleRelease/);
  assert.match(script, /C3_MOBILE_ALLOW_DEBUG_SIGNING/);
  assert.match(script, /trap restore_policy EXIT/);
  assert.match(script, /mobile-release-source-manifest\.mjs/);
  assert.match(script, /podpisový klíč není/);
  const refused = spawnSync('bash', ['scripts/mobile-android.sh', 'reverse'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, C3_MOBILE_TRANSPORT_MODE: 'remote-core-v1' },
  });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /adb reverse patří jen legacy-m1-dev/);
});

await test('source manifest and plugin registry are derived from the Git-pinned build graph', () => {
  const fixture = artifactBindingFixture();
  assert.equal(
    deriveMobileCapacitorPluginRegistryV1(fixture.sourcePackageJson, fixture.sourcePackageLock),
    '[]\n',
  );
  const manifest = JSON.parse(fixture.expectedSourceManifest);
  assert.equal(manifest.contract, 'MobileReleaseSourceManifest');
  assert.equal(manifest.sourceRevision, fixture.sourceRevision);
  assert.deepEqual(manifest.android, fixture.android);
  assert.equal(Object.keys(manifest.clientAssets).length, MOBILE_RELEASE_EXACT_SOURCE_ASSETS.length);
  const build = read('mobile-app/android/app/build.gradle');
  assert.match(build, /generated\/intentsmithReleaseAssets/);
  assert.equal(MOBILE_RELEASE_SOURCE_MANIFEST_ASSET, 'mobile-release-source-manifest.json');
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
    const identity = readMobileSourceRuntimeIdentityV1(read('src/mobile/client/runtime-config.js'));
    assert.equal(runtime, renderMobileGeneratedRuntimeConfigV1({
      gatewayUrl: 'https://gateway.example.test:4443',
      ...identity,
    }));
    assert.equal(html, renderMobileGeneratedIndexV1(
      read('src/mobile/client/index.html'),
      'https://gateway.example.test:4443',
    ));

    const production = spawnSync('python3', ['scripts/mobile-android-configure-url.py'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        APP_DIR: temporary,
        ANDROID_DIR: android,
        IS_URL: M7_TEST_ORIGIN,
        IS_TRANSPORT_MODE: 'remote-core-v1',
        IS_M7_SPKI_PIN: M7_TEST_SPKI_PIN,
      },
    });
    assert.equal(production.status, 0, `${production.stdout}${production.stderr}`);
    const productionIdentity = {
      transportMode: 'remote-core-v1',
      descriptorDigest: MOBILE_RELEASE_REMOTE_PINS.descriptorDigest,
      adapterManifestDigest: MOBILE_RELEASE_REMOTE_PINS.m7AdapterManifestDigest,
      serverIdentityPin: M7_TEST_SPKI_PIN,
      serverOrigin: M7_TEST_ORIGIN,
    };
    assert.equal(
      readFileSync(path.join(publicAssets, 'runtime-config.js'), 'utf8'),
      renderMobileGeneratedRuntimeConfigV1({ gatewayUrl: M7_TEST_ORIGIN, ...productionIdentity }),
    );
    assert.equal(
      readFileSync(path.join(publicAssets, 'index.html'), 'utf8'),
      renderMobileGeneratedIndexV1(
        read('src/mobile/client/index.html'),
        M7_TEST_ORIGIN,
        'remote-core-v1',
      ),
    );

    const missingPin = spawnSync('python3', ['scripts/mobile-android-configure-url.py'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        APP_DIR: temporary,
        ANDROID_DIR: android,
        IS_URL: M7_TEST_ORIGIN,
        IS_TRANSPORT_MODE: 'remote-core-v1',
        IS_M7_SPKI_PIN: '',
      },
    });
    assert.notEqual(missingPin.status, 0);
    assert.match(`${missingPin.stdout}${missingPin.stderr}`, /SPKI_PIN/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

await test('release evidence binds both archives to the exact reviewed client and native config', () => {
  const fixture = artifactBindingFixture();
  const binding = validateMobileReleaseArtifactBindingV1(fixture);
  assert.equal(binding.gatewayUrl, 'https://gateway.example.test:4443');
  assert.equal(binding.transportMode, 'legacy-m1-dev');
  assert.equal(binding.nativeHttpPatchEnabled, false);
  assert.equal(binding.capacitorConfig.server.url, undefined);
  assert.deepEqual(validateMobileNetworkSecurityTreeV1({
    gatewayUrl: binding.gatewayUrl,
    xmlTree: [
      'E: network-security-config',
      '  E: domain-config',
      '    A: cleartextTrafficPermitted=true',
      '    E: domain',
      '      A: includeSubdomains=false',
      "      T: '127.0.0.1'",
      '    E: domain',
      '      A: includeSubdomains=false',
      "      T: 'localhost'",
      '  E: base-config',
      '    A: cleartextTrafficPermitted=false',
    ].join('\n'),
  }), ['127.0.0.1', 'localhost']);
});

await test('stale or substituted generated release assets fail closed', () => {
  const base = artifactBindingFixture();
  const patchedConfig = JSON.parse(base.apkCapacitorConfig);
  patchedConfig.plugins.CapacitorHttp.enabled = true;
  assert.throws(
    () => validateMobileReleaseArtifactBindingV1({
      ...base,
      apkCapacitorConfig: JSON.stringify(patchedConfig),
    }),
    /APK packaged Capacitor config does not match source revision/,
  );
  assert.throws(
    () => validateMobileReleaseArtifactBindingV1({
      ...base,
      apkAssets: { ...base.apkAssets, 'app.js': `${base.apkAssets['app.js']}\n// stale` },
    }),
    /APK app\.js does not match source revision/,
  );
  assert.throws(
    () => validateMobileReleaseArtifactBindingV1({
      ...base,
      aabAssets: { ...base.aabAssets, 'sw.js': `${base.aabAssets['sw.js']}\n// stale` },
    }),
    /AAB sw\.js does not match source revision/,
  );
  assert.throws(
    () => validateMobileReleaseArtifactBindingV1({ ...base, apkPlugins: '[{"id":"forged"}]\n' }),
    /APK plugin registry does not match source package graph/,
  );
  assert.throws(
    () => validateMobileReleaseArtifactBindingV1({
      ...base,
      aabSourceManifest: base.aabSourceManifest.replace(base.sourceRevision, 'b'.repeat(40)),
    }),
    /AAB source manifest does not match reviewed source/,
  );
  assert.throws(
    () => validateMobileReleaseArtifactBindingV1({
      ...base,
      apkRuntimeConfig: `${base.apkRuntimeConfig}// injected\n`,
    }),
    /APK runtime config is not the exact reviewed build-time transformation/,
  );
  assert.throws(
    () => validateMobileReleaseArtifactBindingV1({
      ...base,
      aabIndex: base.aabIndex.replace("connect-src 'self'", "connect-src 'self' https:"),
    }),
    /AAB index does not match the exact source CSP transformation/,
  );
  assert.throws(
    () => validateMobileReleaseArtifactBindingV1({
      ...base,
      sourceIndex: `${base.sourceIndex}\n<meta http-equiv="Content-Security-Policy" content="connect-src 'self'">`,
    }),
    /source index does not contain exactly one connect-src directive/,
  );
  const wildcardRuntime = renderMobileGeneratedRuntimeConfigV1({
    gatewayUrl: 'http://0.0.0.0:3336',
    ...readMobileSourceRuntimeIdentityV1(base.sourceRuntimeConfig),
  });
  assert.throws(
    () => validateMobileReleaseArtifactBindingV1({
      ...base,
      apkRuntimeConfig: wildcardRuntime,
      aabRuntimeConfig: wildcardRuntime,
    }),
    /must not use a wildcard host/,
  );
  assert.throws(
    () => validateMobileNetworkSecurityTreeV1({
      gatewayUrl: 'https://gateway.example.test:4443',
      xmlTree: [
        'A: cleartextTrafficPermitted=true',
        'A: includeSubdomains=false',
        "T: '127.0.0.1'",
        'A: includeSubdomains=false',
        "T: 'localhost'",
        'A: includeSubdomains=false',
        "T: 'example.org'",
        'A: cleartextTrafficPermitted=false',
      ].join('\n'),
    }),
    /cleartext domains do not match gateway/,
  );

  const production = artifactBindingFixture({
    gatewayUrl: M7_TEST_ORIGIN,
    transportMode: 'remote-core-v1',
    serverIdentityPin: M7_TEST_SPKI_PIN,
  });
  const productionBinding = validateMobileReleaseArtifactBindingV1(production);
  assert.equal(productionBinding.transportMode, 'remote-core-v1');
  assert.equal(productionBinding.serverOrigin, M7_TEST_ORIGIN);
  assert.equal(productionBinding.serverIdentityPin, M7_TEST_SPKI_PIN);
  const substitutedPin = `sha256:${'cd'.repeat(32)}`;
  const forgedManifest = production.expectedSourceManifest.replace(
    M7_TEST_SPKI_PIN,
    substitutedPin,
  );
  assert.throws(
    () => validateMobileReleaseArtifactBindingV1({
      ...production,
      expectedSourceManifest: forgedManifest,
      apkSourceManifest: forgedManifest,
      aabSourceManifest: forgedManifest,
    }),
    /does not bind the M7 server authority/,
  );
});

await test('release evidence pins a candidate signer and labels every weaker artifact', () => {
  const evidence = read('scripts/mobile-release-evidence.mjs');
  const binding = read('scripts/mobile-release-artifact-binding.mjs');
  const policy = read('scripts/mobile-release-policy.mjs');
  assert.match(evidence, /--expected-apk-signer-sha256/);
  assert.match(evidence, /--expected-aab-signer-sha256/);
  assert.match(evidence, /--allow-dirty/);
  assert.match(evidence, /build evidence cannot be bound to HEAD/);
  assert.match(evidence, /copyFileSync\(APK, retainedApk\)/);
  assert.match(evidence, /copyFileSync\(AAB, retainedAab\)/);
  assert.match(evidence, /retainedPath: path\.relative\(ROOT, retainedApk\)/);
  assert.match(evidence, /retainedPath: path\.relative\(ROOT, retainedAab\)/);
  assert.match(evidence, /parseApkReleaseObservationV1/);
  assert.match(evidence, /assets\/public\/runtime-config\.js/);
  assert.match(evidence, /base\/assets\/public\/runtime-config\.js/);
  assert.match(evidence, /assets\/capacitor\.config\.json/);
  assert.match(evidence, /aapt-network-security\.txt/);
  assert.match(evidence, /aab-network-security\.txt/);
  assert.match(evidence, /aab-manifest\.xml/);
  assert.match(evidence, /validateMobileReleaseArtifactBindingV1/);
  assert.match(binding, /APK packaged Capacitor config does not match source revision/);
  assert.match(binding, /APK runtime config is not the exact reviewed build-time transformation/);
  assert.match(binding, /`APK \$\{asset\} does not match source revision`/);
  assert.match(policy, /THROWAWAY_DEBUG_SIGNED/);
  assert.match(policy, /NON_DEBUG_SIGNED_UNVERIFIED/);
  assert.match(policy, /CANDIDATE_SIGNED_UNREVIEWED/);
  assert.match(policy, /CANDIDATE_SIGNED_AAB_UNVERIFIED/);
  assert.match(policy, /CANDIDATE_SIGNED_TRANSPORT_BLOCKED/);
  assert.match(policy, /M7_REMOTE_PRODUCTION_TRANSPORT_NOT_SELECTED/);
  assert.match(policy, /M7_REMOTE_DEVICE_AND_VPN_RUNTIME_EVIDENCE_NOT_RECORDED/);
  assert.match(policy, /CAPACITOR_HTTP_GLOBAL_FETCH_PATCH_MUST_BE_REPLACED_OR_DISABLED/);
  assert.match(evidence, /validateMobileAndroidObservationsV1/);
  assert.match(evidence, /bundled CSP does not pin the selected gateway origin/);
  assert.match(evidence, /readMobileM7RuntimeEvidenceV1/);
  assert.match(evidence, /runtimeEvidenceVerified: runtimeEvidence\?\.verified === true/);
});

await test('physical VPN runtime evidence is canonical, artifact-bound and fail-closed', () => {
  const evidenceRoot = mkdtempSync(path.join(os.tmpdir(), 'm7-runtime-evidence-'));
  try {
    const artifactPath = path.join(evidenceRoot, 'device-observation.txt');
    const artifactBytes = Buffer.from('physical-device-vpn-observation\n');
    writeFileSync(artifactPath, artifactBytes, { mode: 0o600 });
    const digest = value => createHash('sha256').update(value).digest('hex');
    const expected = {
      aabSha256: '1'.repeat(64),
      aabSignerSha256: '2'.repeat(64),
      adapterManifestDigest: `sha256:${'3'.repeat(64)}`,
      apkSha256: '4'.repeat(64),
      apkSignerSha256: '5'.repeat(64),
      candidateSha: '6'.repeat(40),
      candidateTreeSha: '7'.repeat(40),
      descriptorDigest: `sha256:${'8'.repeat(64)}`,
      serverIdentityPin: `sha256:${'9'.repeat(64)}`,
      serverOrigin: 'https://100.64.0.10:7443',
      sourceManifestSha256: 'a'.repeat(64),
    };
    const record = {
      artifactBindings: {
        aabSha256: expected.aabSha256,
        aabSignerSha256: expected.aabSignerSha256,
        apkSha256: expected.apkSha256,
        apkSignerSha256: expected.apkSignerSha256,
        sourceManifestSha256: expected.sourceManifestSha256,
      },
      artifacts: [{
        bytes: artifactBytes.length,
        id: 'device-observation',
        path: 'device-observation.txt',
        sha256: digest(artifactBytes),
      }],
      candidate: { sha: expected.candidateSha, treeSha: expected.candidateTreeSha },
      checks: MOBILE_M7_RUNTIME_CHECK_IDS.map(id => ({
        artifactIds: ['device-observation'], id, status: 'PASS',
      })),
      contract: 'MobileM7RuntimeEvidence',
      device: {
        apiLevel: 36,
        applicationId: 'cz.intentsmith.companion',
        model: 'physical-test-device',
        physical: true,
        sourceRevision: expected.candidateSha,
        versionCode: 1,
        versionName: '1.0',
      },
      recordedAtMs: 1_788_000_000_000,
      runtime: {
        adapterManifestDigest: expected.adapterManifestDigest,
        descriptorDigest: expected.descriptorDigest,
        listenerAddress: '100.64.0.10',
        listenerPort: 7443,
        serverIdentityPin: expected.serverIdentityPin,
        serverOrigin: expected.serverOrigin,
        tlsVersion: 'TLSv1.3',
        transportMode: 'remote-core-v1',
        vpnInterface: 'tailscale0',
      },
      version: 1,
    };
    const rawBytes = Buffer.from(`${JSON.stringify(record)}\n`);
    const valid = validateMobileM7RuntimeEvidenceV1({ rawBytes, evidenceRoot, expected });
    assert.equal(valid.valid, true, valid.errors.join(','));
    assert.equal(valid.verified, true);

    const failedCheck = structuredClone(record);
    failedCheck.checks[0].status = 'FAIL';
    const red = validateMobileM7RuntimeEvidenceV1({
      rawBytes: Buffer.from(`${JSON.stringify(failedCheck)}\n`), evidenceRoot, expected,
    });
    assert.equal(red.valid, true, red.errors.join(','));
    assert.equal(red.verified, false);

    const staleCandidate = validateMobileM7RuntimeEvidenceV1({
      rawBytes, evidenceRoot, expected: { ...expected, candidateSha: 'b'.repeat(40) },
    });
    assert.equal(staleCandidate.valid, false);
    assert(staleCandidate.errors.includes('candidate:sha'));

    writeFileSync(artifactPath, 'tampered\n', { mode: 0o600 });
    const tampered = validateMobileM7RuntimeEvidenceV1({ rawBytes, evidenceRoot, expected });
    assert.equal(tampered.valid, false);
    assert(tampered.errors.some(error => error.includes('artifact:device-observation')));

    const nonCanonical = validateMobileM7RuntimeEvidenceV1({
      rawBytes: Buffer.from(`${JSON.stringify(record, null, 2)}\n`), evidenceRoot, expected,
    });
    assert.equal(nonCanonical.valid, false);
    assert(nonCanonical.errors.includes('mobile-runtime-evidence:canonical-bytes'));

    const invalidUtf8 = validateMobileM7RuntimeEvidenceV1({
      rawBytes: Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x7d]), evidenceRoot, expected,
    });
    assert.equal(invalidUtf8.valid, false);
    assert(invalidUtf8.errors.includes('mobile-runtime-evidence:utf8'));

    const traversal = structuredClone(record);
    traversal.artifacts[0].path = '../device-observation.txt';
    const escaped = validateMobileM7RuntimeEvidenceV1({
      rawBytes: Buffer.from(`${JSON.stringify(traversal)}\n`), evidenceRoot, expected,
    });
    assert.equal(escaped.valid, false);
    assert(escaped.errors.includes('artifacts:shape'));
  } finally {
    rmSync(evidenceRoot, { recursive: true, force: true });
  }
});

await test('the physical-device runbook names the production VPN path and every runtime check', () => {
  const tryingIt = read('docs/mobile/TRYING-IT.md');
  const matrix = read('docs/mobile/DEVICE-MATRIX-RUN.md');
  assert.match(tryingIt, /C3_MOBILE_TRANSPORT_MODE=remote-core-v1/);
  assert.match(tryingIt, /INTENTSMITH_M7_REMOTE_ENABLED=true/);
  assert.match(tryingIt, /--runtime-evidence \/absolute\/private\/path\/runtime-evidence\.json/);
  assert.match(tryingIt, /<sha12>-<run>/);
  assert.doesNotMatch(tryingIt, /is-mobile-prod-client-20260826/);
  assert.match(matrix, /\*\*Stav: `NOT RUN`\.\*\*/);
  for (const checkId of MOBILE_M7_RUNTIME_CHECK_IDS) {
    assert.equal(matrix.includes(`\`${checkId}\``), true, checkId);
  }
});

await test('APK and AAB native observations independently bind signer and Android identity', () => {
  const revision = 'c'.repeat(40);
  const apk = parseApkReleaseObservationV1({
    badging: "package: name='cz.intentsmith.companion' versionCode='1' versionName='1.0'\nsdkVersion:'24'\ntargetSdkVersion:'36'\n",
    manifestTree: `E: meta-data\n  A: android:name="cz.intentsmith.SOURCE_REVISION"\n  A: android:value="${revision}"\n`,
    signerOutput: `Signer #1 certificate SHA-256 digest: ${'ab'.repeat(32)}\n`,
  });
  const aab = parseAabReleaseObservationV1({
    manifestXml: `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="cz.intentsmith.companion" android:versionCode="1" android:versionName="1.0"><uses-sdk android:minSdkVersion="24" android:targetSdkVersion="36"/><application><meta-data android:name="cz.intentsmith.SOURCE_REVISION" android:value="${revision}"/></application></manifest>`,
    signerOutput: `SHA256: ${'CD:'.repeat(31)}CD\n`,
  });
  const expected = {
    applicationId: 'cz.intentsmith.companion', versionCode: '1', versionName: '1.0',
    minSdk: '24', targetSdk: '36', sourceRevision: revision,
  };
  validateMobileAndroidObservationsV1({
    expected, apk, aab,
    expectedApkSignerSha256: 'ab'.repeat(32),
    expectedAabSignerSha256: 'cd'.repeat(32),
  });
  assert.throws(
    () => validateMobileAndroidObservationsV1({
      expected, apk, aab: { ...aab, sourceRevision: 'd'.repeat(40) },
      expectedApkSignerSha256: 'ab'.repeat(32),
      expectedAabSignerSha256: 'cd'.repeat(32),
    }),
    /AAB sourceRevision mismatch/,
  );
});

await test('a production signer cannot promote the legacy development transport', () => {
  const shared = {
    debugSigned: false,
    expectedSigner: 'a'.repeat(64),
    descriptorDigest: MOBILE_RELEASE_REMOTE_PINS.descriptorDigest,
    nativeHttpPatchEnabled: false,
    expectedAabSigner: 'b'.repeat(64),
    aabSignerVerified: true,
  };
  const blocked = classifyMobileReleaseArtifact({
    ...shared,
    transportMode: 'legacy-m1-dev',
    adapterManifestDigest: MOBILE_RELEASE_REMOTE_PINS.m5AdapterManifestDigest,
  });
  assert.equal(blocked.classification, 'CANDIDATE_SIGNED_TRANSPORT_BLOCKED');
  assert.equal(blocked.releaseTransportReady, false);
  assert.deepEqual(blocked.releaseBlockers, [
    'M7_REMOTE_PRODUCTION_TRANSPORT_NOT_SELECTED',
  ]);

  const runtimePending = classifyMobileReleaseArtifact({
    ...shared,
    transportMode: 'remote-core-v1',
    adapterManifestDigest: MOBILE_RELEASE_REMOTE_PINS.m7AdapterManifestDigest,
    serverOrigin: M7_TEST_ORIGIN,
    serverIdentityPin: M7_TEST_SPKI_PIN,
  });
  assert.equal(runtimePending.classification, 'CANDIDATE_SIGNED_TRANSPORT_BLOCKED');
  assert.equal(runtimePending.releaseTransportReady, false);
  assert.deepEqual(runtimePending.releaseBlockers, [
    'M7_REMOTE_DEVICE_AND_VPN_RUNTIME_EVIDENCE_NOT_RECORDED',
  ]);

  const verified = classifyMobileReleaseArtifact({
    ...shared,
    transportMode: 'remote-core-v1',
    adapterManifestDigest: MOBILE_RELEASE_REMOTE_PINS.m7AdapterManifestDigest,
    serverOrigin: M7_TEST_ORIGIN,
    serverIdentityPin: M7_TEST_SPKI_PIN,
    runtimeEvidenceVerified: true,
  });
  assert.equal(verified.classification, 'CANDIDATE_SIGNED_UNREVIEWED');
  assert.equal(verified.releaseTransportReady, true);
  assert.deepEqual(verified.releaseBlockers, []);

  const missingAabAuthority = classifyMobileReleaseArtifact({
    ...shared,
    expectedAabSigner: null,
    aabSignerVerified: false,
    transportMode: 'remote-core-v1',
    adapterManifestDigest: MOBILE_RELEASE_REMOTE_PINS.m7AdapterManifestDigest,
    serverOrigin: M7_TEST_ORIGIN,
    serverIdentityPin: M7_TEST_SPKI_PIN,
    runtimeEvidenceVerified: true,
  });
  assert.equal(missingAabAuthority.classification, 'CANDIDATE_SIGNED_AAB_UNVERIFIED');
  assert.deepEqual(missingAabAuthority.releaseBlockers, [
    'MOBILE_AAB_UPLOAD_SIGNER_NOT_VERIFIED',
  ]);

  const debugArtifact = classifyMobileReleaseArtifact({
    ...shared,
    debugSigned: true,
    transportMode: 'remote-core-v1',
    adapterManifestDigest: MOBILE_RELEASE_REMOTE_PINS.m7AdapterManifestDigest,
    serverOrigin: M7_TEST_ORIGIN,
    serverIdentityPin: M7_TEST_SPKI_PIN,
    runtimeEvidenceVerified: true,
  });
  assert.equal(debugArtifact.classification, 'THROWAWAY_DEBUG_SIGNED');
  assert.equal(debugArtifact.releaseTransportReady, false);

  assert.throws(
    () => classifyMobileReleaseArtifact({
      ...shared,
      transportMode: 'remote-core-v1',
      descriptorDigest: `sha256:${'0'.repeat(64)}`,
      adapterManifestDigest: MOBILE_RELEASE_REMOTE_PINS.m7AdapterManifestDigest,
    }),
    /does not match the reviewed contract/,
  );
});

console.log(`\nAndroid production release boundary: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
