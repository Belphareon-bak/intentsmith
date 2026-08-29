#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  classifyMobileReleaseArtifact,
} from './mobile-release-policy.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ANDROID = path.join(ROOT, 'mobile-app/android');
const APK = path.join(ANDROID, 'app/build/outputs/apk/release/app-release.apk');
const AAB = path.join(ANDROID, 'app/build/outputs/bundle/release/app-release.aab');
const allowDebugSigner = process.argv.includes('--allow-debug-signer');
const allowDirty = process.argv.includes('--allow-dirty');
const expectedSignerFlag = process.argv.indexOf('--expected-signer-sha256');
const expectedSigner = expectedSignerFlag === -1
  ? null : String(process.argv[expectedSignerFlag + 1] || '').toLowerCase();
if (expectedSignerFlag !== -1 && !/^[a-f0-9]{64}$/.test(expectedSigner)) {
  throw new Error('--expected-signer-sha256 requires exactly 64 hexadecimal characters');
}
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
const signer = run(apksigner, ['verify', '--verbose', '--print-certs', APK]).output;
const badging = run(aapt, ['dump', 'badging', APK]).output;
const manifestTree = run(aapt, ['dump', 'xmltree', APK, 'AndroidManifest.xml']).output;
const packagedRevision = manifestTree.match(
  /cz\.intentsmith\.SOURCE_REVISION"[^\n]*\n\s*A: android:value[^=]*="([a-f0-9]{40})"/,
)?.[1] || null;
if (packagedRevision !== commit) {
  throw new Error(`APK source revision mismatch: expected ${commit}, received ${packagedRevision || 'missing'}`);
}
const bundleSignature = run(path.join(javaHome, 'bin/jarsigner'), ['-verify', '-verbose', '-certs', AAB]).output;
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
const signerSha256 = signer.match(/certificate SHA-256 digest: ([a-f0-9]+)/i)?.[1]?.toLowerCase() || null;
if (!signerSha256) throw new Error('APK signer SHA-256 could not be read');
if (expectedSigner && signerSha256 !== expectedSigner) {
  throw new Error(`APK signer mismatch: expected ${expectedSigner}, received ${signerSha256}`);
}

const config = JSON.parse(readFileSync(path.join(ROOT, 'mobile-app/capacitor.config.json'), 'utf8'));
const apkRuntimeConfig = bundledText(APK, 'assets/public/runtime-config.js');
const aabRuntimeConfig = bundledText(AAB, 'base/assets/public/runtime-config.js');
const apkIndex = bundledText(APK, 'assets/public/index.html');
const aabIndex = bundledText(AAB, 'base/assets/public/index.html');
const apkRemoteCore = bundledText(APK, 'assets/public/remote-core-v1.js');
const aabRemoteCore = bundledText(AAB, 'base/assets/public/remote-core-v1.js');
if (apkRuntimeConfig !== aabRuntimeConfig || apkIndex !== aabIndex || apkRemoteCore !== aabRemoteCore) {
  throw new Error('APK and AAB do not bundle the same reviewed mobile client');
}
const sourceRemoteCore = readFileSync(path.join(ROOT, 'src/mobile/client/remote-core-v1.js'), 'utf8');
if (apkRemoteCore !== sourceRemoteCore) {
  throw new Error('bundled RemoteCore compatibility module does not match the source revision');
}
const runtimeConfig = apkRuntimeConfig;
const generatedIndex = apkIndex;
const gatewayUrl = runtimeConfig.match(/gatewayUrl:\s*['"]([^'"]+)['"]/)?.[1] || null;
const transportMode = runtimeConfig.match(/transportMode:\s*['"]([^'"]+)['"]/)?.[1] || null;
const descriptorDigest = runtimeConfig.match(/descriptorDigest:\s*['"](sha256:[0-9a-f]{64})['"]/)?.[1] || null;
const adapterManifestDigest = runtimeConfig.match(/adapterManifestDigest:\s*['"](sha256:[0-9a-f]{64})['"]/)?.[1] || null;
const releasePolicy = classifyMobileReleaseArtifact({
  debugSigned,
  expectedSigner,
  transportMode,
  descriptorDigest,
  adapterManifestDigest,
  nativeHttpPatchEnabled: config.plugins?.CapacitorHttp?.enabled === true,
});
if (!gatewayUrl) throw new Error('bundled mobile gateway origin is missing');
const expectedConnectDirective = `connect-src 'self' ${new URL(gatewayUrl).origin}`;
const connectDirective = generatedIndex.match(/connect-src\s+[^;"]+/)?.[0] || null;
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
    applicationId: badging.match(/package: name='([^']+)'/)?.[1] || null,
    versionCode: badging.match(/versionCode='([^']+)'/)?.[1] || null,
    versionName: badging.match(/versionName='([^']+)'/)?.[1] || null,
    minSdk: badging.match(/sdkVersion:'([^']+)'/)?.[1] || null,
    targetSdk: badging.match(/targetSdkVersion:'([^']+)'/)?.[1] || null,
    sourceRevision: packagedRevision,
    signerSha256,
    expectedSignerSha256: expectedSigner,
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
    remoteCoreModuleSha256: textDigest(apkRemoteCore),
    releaseTransportReady: releasePolicy.releaseTransportReady,
  },
  releaseBlockers: releasePolicy.releaseBlockers,
  supplyChain: {
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
writeFileSync(path.join(outputDir, 'aab-jarsigner.txt'), bundleSignature);
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
