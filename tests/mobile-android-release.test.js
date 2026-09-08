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
  MOBILE_RELEASE_DIRTY_SOURCE_BLOCKER,
  MOBILE_RELEASE_REMOTE_PINS,
  classifyMobileReleaseArtifact,
  describeMobileReleaseSourceProvenanceV1,
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

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = relative => readFileSync(path.join(ROOT, relative), 'utf8');

function artifactBindingFixture(gatewayUrl = 'https://gateway.example.test:4443') {
  const sourceRuntimeConfig = read('src/mobile/client/runtime-config.js');
  const runtimeIdentity = readMobileSourceRuntimeIdentityV1(sourceRuntimeConfig);
  const sourceIndex = read('src/mobile/client/index.html');
  const sourceAssets = Object.fromEntries(MOBILE_RELEASE_EXACT_SOURCE_ASSETS.map(asset => [
    asset,
    read(`src/mobile/client/${asset}`),
  ]));
  const generatedRuntimeConfig = renderMobileGeneratedRuntimeConfigV1({
    gatewayUrl,
    ...runtimeIdentity,
  });
  const generatedIndex = renderMobileGeneratedIndexV1(sourceIndex, gatewayUrl);
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
  assert.match(script, /npx cap sync android/);
  assert.match(script, /:app:assembleRelease :app:bundleRelease/);
  assert.match(script, /C3_MOBILE_ALLOW_DEBUG_SIGNING/);
  assert.match(script, /trap restore_policy EXIT/);
  assert.match(script, /mobile-release-source-manifest\.mjs/);
  assert.match(script, /podpisový klíč není/);
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
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

await test('release evidence binds both archives to the exact reviewed client and native config', () => {
  const fixture = artifactBindingFixture();
  const binding = validateMobileReleaseArtifactBindingV1(fixture);
  assert.equal(binding.gatewayUrl, 'https://gateway.example.test:4443');
  assert.equal(binding.transportMode, 'legacy-m1-dev');
  assert.equal(binding.nativeHttpPatchEnabled, true);
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
  patchedConfig.plugins.CapacitorHttp.enabled = false;
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

  const productionSourceRuntime = base.sourceRuntimeConfig.replace(
    "transportMode: 'legacy-m1-dev'",
    "transportMode: 'remote-core-v1'",
  );
  const productionIdentity = readMobileSourceRuntimeIdentityV1(productionSourceRuntime);
  const productionRuntime = renderMobileGeneratedRuntimeConfigV1({
    gatewayUrl: 'https://gateway.example.test:4443',
    ...productionIdentity,
  });
  assert.throws(
    () => validateMobileReleaseArtifactBindingV1({
      ...base,
      sourceRuntimeConfig: productionSourceRuntime,
      apkRuntimeConfig: productionRuntime,
      aabRuntimeConfig: productionRuntime,
    }),
    /reviewed client still blocks it/,
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
  assert.match(policy, /M7_REMOTE_LISTENER_AUTH_PAIRING_AND_WIRE_TRANSPORT_NOT_IMPLEMENTED/);
  assert.match(policy, /CAPACITOR_HTTP_GLOBAL_FETCH_PATCH_MUST_BE_REPLACED_OR_DISABLED/);
  assert.match(evidence, /validateMobileAndroidObservationsV1/);
  assert.match(evidence, /bundled CSP does not pin the selected gateway origin/);
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
    sourceDirty: false,
    expectedSigner: 'a'.repeat(64),
    descriptorDigest: MOBILE_RELEASE_REMOTE_PINS.descriptorDigest,
    adapterManifestDigest: MOBILE_RELEASE_REMOTE_PINS.adapterManifestDigest,
    nativeHttpPatchEnabled: true,
    expectedAabSigner: 'b'.repeat(64),
    aabSignerVerified: true,
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

  const missingAabAuthority = classifyMobileReleaseArtifact({
    ...shared,
    expectedAabSigner: null,
    aabSignerVerified: false,
    transportMode: 'remote-core-v1',
    nativeHttpPatchEnabled: false,
  });
  assert.equal(missingAabAuthority.classification, 'CANDIDATE_SIGNED_AAB_UNVERIFIED');
  assert.deepEqual(missingAabAuthority.releaseBlockers, [
    'MOBILE_AAB_UPLOAD_SIGNER_NOT_VERIFIED',
  ]);

  assert.throws(
    () => classifyMobileReleaseArtifact({
      ...shared,
      transportMode: 'remote-core-v1',
      descriptorDigest: `sha256:${'0'.repeat(64)}`,
    }),
    /does not match the reviewed M2\/M5 contract/,
  );
});

await test('dirty or unspecified source provenance cannot become release ready', () => {
  const cleanInput = {
    debugSigned: false,
    sourceDirty: false,
    expectedSigner: 'a'.repeat(64),
    expectedAabSigner: 'b'.repeat(64),
    aabSignerVerified: true,
    transportMode: 'remote-core-v1',
    descriptorDigest: MOBILE_RELEASE_REMOTE_PINS.descriptorDigest,
    adapterManifestDigest: MOBILE_RELEASE_REMOTE_PINS.adapterManifestDigest,
    nativeHttpPatchEnabled: false,
  };
  const clean = classifyMobileReleaseArtifact(cleanInput);
  assert.equal(clean.classification, 'CANDIDATE_SIGNED_UNREVIEWED');
  assert.equal(clean.releaseTransportReady, true);
  assert.deepEqual(clean.releaseBlockers, []);

  const { sourceDirty: _sourceDirty, ...missingSourceState } = cleanInput;
  assert.throws(() => classifyMobileReleaseArtifact(missingSourceState), /sourceDirty must be an explicit boolean/);
  for (const sourceDirty of [undefined, null, 0, 1, '', 'false', [], {}]) {
    assert.throws(() => classifyMobileReleaseArtifact({ ...cleanInput, sourceDirty }), /sourceDirty must be an explicit boolean/);
  }
  for (const debugSigned of [false, true]) {
    const dirty = classifyMobileReleaseArtifact({ ...cleanInput, debugSigned, sourceDirty: true });
    assert.equal(dirty.classification, 'THROWAWAY_DIRTY_SOURCE');
    assert.equal(dirty.releaseTransportReady, false);
    assert.deepEqual(dirty.releaseBlockers, [MOBILE_RELEASE_DIRTY_SOURCE_BLOCKER]);
  }

  const baseRevision = 'c'.repeat(40);
  assert.deepEqual(describeMobileReleaseSourceProvenanceV1({ baseRevision, sourceDirty: false }), {
    baseRevision, sourceRevision: baseRevision, sourceDirty: false, verification: 'COMMITTED_SOURCE',
  });
  assert.deepEqual(describeMobileReleaseSourceProvenanceV1({ baseRevision, sourceDirty: true }), {
    baseRevision, sourceRevision: null, sourceDirty: true, verification: 'WORKTREE_ONLY',
  });
  assert.throws(() => describeMobileReleaseSourceProvenanceV1({ baseRevision }), /sourceDirty must be an explicit boolean/);
  assert.throws(() => describeMobileReleaseSourceProvenanceV1({ baseRevision: 'not-a-commit', sourceDirty: false }), /source base revision must be an exact Git commit/);

  const evidence = read('scripts/mobile-release-evidence.mjs');
  assert.match(evidence, /sourceDirty: dirty\.length > 0/);
  assert.match(evidence, /sourceDirty: sourceProvenance\.sourceDirty/);
  assert.match(evidence, /source: sourceProvenance/);
  assert.match(evidence, /declaredSourceRevision: apkObservation\.sourceRevision/);
  assert.match(evidence, /declaredSourceRevision: aabObservation\.sourceRevision/);
  assert.equal((evidence.match(/sourceRevision: sourceProvenance\.sourceRevision/g) || []).length, 2);
});

console.log(`\nAndroid production release boundary: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
