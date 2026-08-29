#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  classifyMobileReleaseArtifact,
} from './mobile-release-policy.mjs';
import {
  MOBILE_RELEASE_EXACT_SOURCE_ASSETS,
  MOBILE_RELEASE_SOURCE_MANIFEST_ASSET,
  validateMobileReleaseArtifactBindingV1,
  validateMobileNetworkSecurityTreeV1,
} from './mobile-release-artifact-binding.mjs';
import {
  parseAabReleaseObservationV1,
  parseApkReleaseObservationV1,
  validateMobileAndroidObservationsV1,
} from './mobile-release-android-observation.mjs';
import {
  buildCurrentMobileReleaseSourceManifestV1,
  readMobileAndroidSourceMetadataV1,
} from './mobile-release-source-manifest.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ANDROID = path.join(ROOT, 'mobile-app/android');
const APK = path.join(ANDROID, 'app/build/outputs/apk/release/app-release.apk');
const AAB = path.join(ANDROID, 'app/build/outputs/bundle/release/app-release.aab');
const allowDebugSigner = process.argv.includes('--allow-debug-signer');
const allowDirty = process.argv.includes('--allow-dirty');
function signerFlag(primary, alias = null) {
  const primaryIndex = process.argv.indexOf(primary);
  const aliasIndex = alias === null ? -1 : process.argv.indexOf(alias);
  if (primaryIndex !== -1 && aliasIndex !== -1) throw new Error(`${primary} and ${alias} conflict`);
  const index = primaryIndex === -1 ? aliasIndex : primaryIndex;
  const value = index === -1 ? null : String(process.argv[index + 1] || '').toLowerCase();
  if (index !== -1 && !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${primary} requires exactly 64 hexadecimal characters`);
  }
  return value;
}

const expectedApkSigner = signerFlag('--expected-apk-signer-sha256', '--expected-signer-sha256');
const expectedAabSigner = signerFlag('--expected-aab-signer-sha256');
const taskHome = os.homedir();
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  || path.join(taskHome, 'toolchain/android-sdk');
const javaHome = process.env.JAVA_HOME || path.join(taskHome, 'toolchain/jdk21');

function run(command, args, { cwd = ROOT, allowFailure = false, env = {} } = {}) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8',
    env: { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, ...env },
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}):\n${output}`);
  }
  return { status: result.status, output };
}

function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function textDigest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function bundledText(archive, member) {
  return run('unzip', ['-p', archive, member]).output;
}

function bundletool() {
  const output = run('./gradlew', ['-q', 'intentsmithBundletoolClasspath'], { cwd: ANDROID }).output;
  const marker = output.split('\n').find(line => line.startsWith('INTENTSMITH_BUNDLETOOL_CLASSPATH='));
  if (!marker) throw new Error('Gradle did not expose the pinned bundletool classpath');
  const classpath = marker.slice('INTENTSMITH_BUNDLETOOL_CLASSPATH='.length);
  const bundletoolJar = classpath.split(path.delimiter).find(item => /bundletool-1\.18\.1\.jar$/u.test(item));
  if (!bundletoolJar || digest(bundletoolJar) !== 'a73341a7945abcb0e6b8971c7b1b2801bd765006447ca0d2437a4260d572ceac') {
    throw new Error('bundletool 1.18.1 artifact is missing or does not match its SHA-256 pin');
  }
  return Object.freeze({ classpath, jar: bundletoolJar, version: '1.18.1' });
}

function bundletoolRun(tool, args) {
  return run(path.join(javaHome, 'bin/java'), [
    '-cp', tool.classpath,
    'com.android.tools.build.bundletool.BundleToolMain',
    ...args,
  ]).output;
}

function networkSecurityObservation(aapt2, artifact) {
  const resources = run(aapt2, ['dump', 'resources', artifact]).output;
  const resource = resources.match(
    /resource 0x[0-9a-f]+ xml\/network_security_config\s+\(\) \(file\) (res\/[^\s]+\.xml) type=XML/u,
  )?.[1] || null;
  if (!resource) throw new Error('network security config resource could not be resolved');
  const tree = run(aapt2, ['dump', 'xmltree', '--file', resource, artifact]).output;
  return Object.freeze({ resource, tree });
}

function latestBuildTool(name) {
  const root = path.join(sdk, 'build-tools');
  const versions = readdirSync(root).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!versions.length) throw new Error(`no Android build-tools under ${root}`);
  return path.join(root, versions.at(-1), name);
}

const commit = run('git', ['rev-parse', 'HEAD']).output.trim();
const dirty = run('git', ['status', '--porcelain']).output.trim().split('\n').filter(Boolean);
if (dirty.length && !allowDirty) {
  throw new Error('working tree is dirty; build evidence cannot be bound to HEAD (use --allow-dirty only for throwaway proof)');
}
const outputDir = path.join(ROOT, '.intentsmith-artifacts/mobile-release', commit.slice(0, 12));
mkdirSync(outputDir, { recursive: true });

const apksigner = latestBuildTool('apksigner');
const aapt = latestBuildTool('aapt');
const aapt2 = latestBuildTool('aapt2');
const signer = run(apksigner, ['verify', '--verbose', '--print-certs', APK]).output;
const badging = run(aapt, ['dump', 'badging', APK]).output;
const manifestTree = run(aapt, ['dump', 'xmltree', APK, 'AndroidManifest.xml']).output;
const bundleSignature = run(path.join(javaHome, 'bin/jarsigner'), ['-verify', '-verbose', '-certs', AAB]).output;
const aabSignerOutput = run(path.join(javaHome, 'bin/keytool'), ['-printcert', '-jarfile', AAB]).output;
const bundletoolAuthority = bundletool();
const aabManifest = bundletoolRun(bundletoolAuthority, [
  'dump', 'manifest', `--bundle=${AAB}`, '--module=base',
]);
const androidExpected = { ...readMobileAndroidSourceMetadataV1(), sourceRevision: commit };
const apkObservation = parseApkReleaseObservationV1({
  badging,
  manifestTree,
  signerOutput: signer,
});
const aabObservation = parseAabReleaseObservationV1({
  manifestXml: aabManifest,
  signerOutput: aabSignerOutput,
});
validateMobileAndroidObservationsV1({
  expected: androidExpected,
  apk: apkObservation,
  aab: aabObservation,
  expectedApkSignerSha256: expectedApkSigner,
  expectedAabSignerSha256: expectedAabSigner,
});
const gradleVersion = run('./gradlew', ['--version'], { cwd: ANDROID }).output;
const gradleDependencies = run('./gradlew', [
  '--no-daemon', ':app:dependencies', '--configuration', 'releaseRuntimeClasspath',
], { cwd: ANDROID }).output;

const auditRun = run('npm', ['audit', '--prefix', 'mobile-app', '--omit=dev', '--json'], { allowFailure: true });
const audit = JSON.parse(auditRun.output);
const runtimeVulnerabilities = audit.metadata?.vulnerabilities?.total ?? -1;
if (auditRun.status !== 0 || runtimeVulnerabilities !== 0) {
  throw new Error(`mobile runtime audit is not clean (${runtimeVulnerabilities} findings)`);
}
const sbomText = run('npm', [
  'sbom', '--prefix', 'mobile-app', '--omit=dev', '--sbom-format', 'cyclonedx',
]).output;
const sbom = JSON.parse(sbomText);

const lock = JSON.parse(readFileSync(path.join(ROOT, 'mobile-app/package-lock.json'), 'utf8'));
const licenses = Object.entries(lock.packages)
  .filter(([name, data]) => name.startsWith('node_modules/') && !data.dev)
  .map(([name, data]) => {
    const packageName = name.slice('node_modules/'.length);
    let license = null;
    try {
      license = JSON.parse(readFileSync(path.join(ROOT, 'mobile-app', name, 'package.json'), 'utf8')).license || null;
    } catch { /* missing metadata remains explicit */ }
    return { name: packageName, version: data.version, license };
  });

const debugSigned = /CN=Android Debug/.test(signer);
if (debugSigned && !allowDebugSigner) {
  throw new Error('debug signer detected; rerun only for explicit proof with --allow-debug-signer');
}
const signerSha256 = apkObservation.signerSha256;
if (!signerSha256) throw new Error('APK signer SHA-256 could not be read');

const sourceCapacitorConfig = readFileSync(
  path.join(ROOT, 'mobile-app/capacitor.config.json'),
  'utf8',
);
const apkCapacitorConfig = bundledText(APK, 'assets/capacitor.config.json');
const aabCapacitorConfig = bundledText(AAB, 'base/assets/capacitor.config.json');
const apkPlugins = bundledText(APK, 'assets/capacitor.plugins.json');
const aabPlugins = bundledText(AAB, 'base/assets/capacitor.plugins.json');
const apkSourceManifest = bundledText(APK, `assets/${MOBILE_RELEASE_SOURCE_MANIFEST_ASSET}`);
const aabSourceManifest = bundledText(AAB, `base/assets/${MOBILE_RELEASE_SOURCE_MANIFEST_ASSET}`);
const apkRuntimeConfig = bundledText(APK, 'assets/public/runtime-config.js');
const aabRuntimeConfig = bundledText(AAB, 'base/assets/public/runtime-config.js');
const apkIndex = bundledText(APK, 'assets/public/index.html');
const aabIndex = bundledText(AAB, 'base/assets/public/index.html');
const sourceClientRoot = path.join(ROOT, 'src/mobile/client');
const sourceAssets = Object.fromEntries(MOBILE_RELEASE_EXACT_SOURCE_ASSETS.map(asset => [
  asset,
  readFileSync(path.join(sourceClientRoot, asset), 'utf8'),
]));
const apkAssets = Object.fromEntries(MOBILE_RELEASE_EXACT_SOURCE_ASSETS.map(asset => [
  asset,
  bundledText(APK, `assets/public/${asset}`),
]));
const aabAssets = Object.fromEntries(MOBILE_RELEASE_EXACT_SOURCE_ASSETS.map(asset => [
  asset,
  bundledText(AAB, `base/assets/public/${asset}`),
]));
const expectedSourceManifest = buildCurrentMobileReleaseSourceManifestV1({
  sourceRevision: commit,
  generatedRuntimeConfig: apkRuntimeConfig,
});
const artifactBinding = validateMobileReleaseArtifactBindingV1({
  sourceCapacitorConfig,
  apkCapacitorConfig,
  aabCapacitorConfig,
  sourceRuntimeConfig: readFileSync(path.join(sourceClientRoot, 'runtime-config.js'), 'utf8'),
  apkRuntimeConfig,
  aabRuntimeConfig,
  sourceIndex: readFileSync(path.join(sourceClientRoot, 'index.html'), 'utf8'),
  apkIndex,
  aabIndex,
  sourceAssets,
  apkAssets,
  aabAssets,
  sourcePackageJson: readFileSync(path.join(ROOT, 'mobile-app/package.json'), 'utf8'),
  sourcePackageLock: readFileSync(path.join(ROOT, 'mobile-app/package-lock.json'), 'utf8'),
  apkPlugins,
  aabPlugins,
  expectedSourceManifest,
  apkSourceManifest,
  aabSourceManifest,
});
const {
  capacitorConfig: config,
  gatewayUrl,
  transportMode,
  descriptorDigest,
  adapterManifestDigest,
  nativeHttpPatchEnabled,
} = artifactBinding;
const apkNetworkSecurity = networkSecurityObservation(aapt2, APK);
const networkSecurityCleartextDomains = validateMobileNetworkSecurityTreeV1({
  gatewayUrl,
  xmlTree: apkNetworkSecurity.tree,
});
const derivedRoot = mkdtempSync(path.join(os.tmpdir(), 'intentsmith-aab-proof-'));
let aabNetworkSecurity;
try {
  const apks = path.join(derivedRoot, 'release.apks');
  bundletoolRun(bundletoolAuthority, [
    'build-apks', `--bundle=${AAB}`, `--output=${apks}`, `--aapt2=${aapt2}`,
    '--mode=universal', '--overwrite',
  ]);
  run('unzip', ['-q', apks, 'universal.apk', '-d', derivedRoot]);
  aabNetworkSecurity = networkSecurityObservation(aapt2, path.join(derivedRoot, 'universal.apk'));
  validateMobileNetworkSecurityTreeV1({ gatewayUrl, xmlTree: aabNetworkSecurity.tree });
  if (aabNetworkSecurity.tree !== apkNetworkSecurity.tree) {
    throw new Error('APK and AAB network security trees differ');
  }
} finally {
  rmSync(derivedRoot, { recursive: true, force: true });
}
const releasePolicy = classifyMobileReleaseArtifact({
  debugSigned,
  expectedSigner: expectedApkSigner,
  expectedAabSigner,
  aabSignerVerified: expectedAabSigner !== null
    && aabObservation.signerSha256 === expectedAabSigner,
  transportMode,
  descriptorDigest,
  adapterManifestDigest,
  nativeHttpPatchEnabled,
});
const expectedConnectDirective = `connect-src 'self' ${new URL(gatewayUrl).origin}`;
const connectDirective = apkIndex.match(/connect-src\s+[^;"]+/)?.[0] || null;
if (connectDirective !== expectedConnectDirective) {
  throw new Error(`bundled CSP does not pin the selected gateway origin: ${connectDirective || 'missing'}`);
}
const manifest = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  commit,
  dirty,
  classification: releasePolicy.classification,
  artifacts: {
    apk: { path: path.relative(ROOT, APK), sha256: digest(APK) },
    aab: { path: path.relative(ROOT, AAB), sha256: digest(AAB) },
  },
  android: {
    apk: {
      ...apkObservation,
      expectedSignerSha256: expectedApkSigner,
      networkSecurityResource: apkNetworkSecurity.resource,
      networkSecurityTreeSha256: textDigest(apkNetworkSecurity.tree),
    },
    aab: {
      ...aabObservation,
      expectedSignerSha256: expectedAabSigner,
      networkSecurityResource: aabNetworkSecurity.resource,
      networkSecurityTreeSha256: textDigest(aabNetworkSecurity.tree),
    },
    sourceManifestSha256: textDigest(expectedSourceManifest),
  },
  client: {
    bundledWebDir: config.webDir,
    serverUrl: config.server?.url || null,
    gatewayOrigin: new URL(gatewayUrl).origin,
    connectSrc: connectDirective,
    webContentsDebuggingEnabled: config.android?.webContentsDebuggingEnabled,
    transportMode,
    remoteCoreDescriptorDigest: descriptorDigest,
    remoteCoreAdapterManifestDigest: adapterManifestDigest,
    remoteCoreModuleSha256: textDigest(apkAssets['remote-core-v1.js']),
    nativeHttpPatchEnabled,
    networkSecurityCleartextDomains,
    releaseTransportReady: releasePolicy.releaseTransportReady,
  },
  releaseBlockers: releasePolicy.releaseBlockers,
  supplyChain: {
    bundletoolVersion: bundletoolAuthority.version,
    bundletoolSha256: digest(bundletoolAuthority.jar),
    npmRuntimeVulnerabilities: runtimeVulnerabilities,
    sbomFormat: `${sbom.bomFormat} ${sbom.specVersion}`,
    npmRuntimeComponents: sbom.components?.length || 0,
    npmLicensesWithoutIdentity: licenses.filter(item => !item.license).map(item => item.name),
  },
};

writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(path.join(outputDir, 'apksigner.txt'), signer);
writeFileSync(path.join(outputDir, 'aapt-badging.txt'), badging);
writeFileSync(path.join(outputDir, 'aapt-manifest.txt'), manifestTree);
writeFileSync(path.join(outputDir, 'aapt-network-security.txt'), apkNetworkSecurity.tree);
writeFileSync(path.join(outputDir, 'aab-network-security.txt'), aabNetworkSecurity.tree);
writeFileSync(path.join(outputDir, 'aab-jarsigner.txt'), bundleSignature);
writeFileSync(path.join(outputDir, 'aab-keytool-signer.txt'), aabSignerOutput);
writeFileSync(path.join(outputDir, 'aab-manifest.xml'), aabManifest);
writeFileSync(path.join(outputDir, MOBILE_RELEASE_SOURCE_MANIFEST_ASSET), expectedSourceManifest);
writeFileSync(path.join(outputDir, 'gradle-version.txt'), gradleVersion);
writeFileSync(path.join(outputDir, 'gradle-release-dependencies.txt'), gradleDependencies);
writeFileSync(path.join(outputDir, 'npm-audit-runtime.json'), `${JSON.stringify(audit, null, 2)}\n`);
writeFileSync(path.join(outputDir, 'mobile-app-sbom.cdx.json'), `${JSON.stringify(sbom, null, 2)}\n`);
writeFileSync(path.join(outputDir, 'npm-runtime-licenses.json'), `${JSON.stringify(licenses, null, 2)}\n`);

console.log(`Mobile release evidence: ${manifest.classification}`);
console.log(`  ${outputDir}`);
console.log(`  APK ${manifest.artifacts.apk.sha256}`);
console.log(`  AAB ${manifest.artifacts.aab.sha256}`);
console.log(`  runtime audit ${runtimeVulnerabilities} vulnerabilities`);
