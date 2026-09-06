import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  artifactRecord,
  assertJarsignerVerified,
  createReleaseManifest,
  parseApkSignerDigest,
  readReleaseMetadata,
  renderReleaseManifest,
  validateReleaseMetadata,
  versionCodeFor,
} from '../scripts/mobile-release-artifacts.mjs';

const read = file => readFileSync(file, 'utf8');
const metadata = readReleaseMetadata('mobile-app/release.json');
const mobilePackage = JSON.parse(read('mobile-app/package.json'));
const appGradle = read('mobile-app/android/app/build.gradle');
const workflow = read('scripts/mobile-android.mjs');
const artifactModule = read('scripts/mobile-release-artifacts.mjs');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

console.log('\n=== Mobile Android release metadata and artifacts ===');

await test('tracked metadata is the single valid mobile version authority', () => {
  assert.equal(metadata.versionName, mobilePackage.version);
  assert.equal(metadata.versionCode, 1000);
  assert.equal(versionCodeFor(metadata.versionName), metadata.versionCode);
  assert.equal(metadata.applicationId, 'cz.intentsmith.companion');
  assert.equal(metadata.channel, 'internal');
});

await test('version scheme rejects ambiguity, overflow and mismatched codes', () => {
  assert.equal(versionCodeFor('2.15.9'), 2_015_009);
  for (const invalid of ['1.2', '01.2.3', '1.1000.0', '2101.0.0', '0.0.0']) {
    assert.throws(() => versionCodeFor(invalid), invalid);
  }
  assert.throws(
    () => validateReleaseMetadata({ ...metadata, versionCode: metadata.versionCode + 1 }),
    /does not match/,
  );
  assert.throws(() => validateReleaseMetadata({ ...metadata, extra: true }), /keys must be exactly/);
});

await test('Gradle consumes release.json instead of duplicating version literals', () => {
  assert.match(appGradle, /new JsonSlurper\(\)\.parse\(mobileReleaseFile\)/);
  assert.match(appGradle, /applicationId = mobileRelease\.applicationId/);
  assert.match(appGradle, /versionCode = mobileRelease\.versionCode/);
  assert.match(appGradle, /versionName = mobileRelease\.versionName/);
  assert.doesNotMatch(appGradle, /versionCode\s*=\s*1\b/);
  assert.doesNotMatch(appGradle, /versionName\s*=\s*["']1\.0["']/);
});

await test('release workflow builds both install and publishing artifacts', () => {
  assert.match(workflow, /':app:assembleRelease', ':app:bundleRelease'/);
  assert.match(workflow, /Signed release APK was not produced/);
  assert.match(workflow, /Signed release AAB was not produced/);
  assert.match(workflow, /\['-verify', '-verbose', '-certs', bundle\]/);
  assert.match(workflow, /assertJarsignerVerified/);
});

await test('AAB verifier rejects unsigned and unproven jarsigner output', () => {
  assert.doesNotThrow(() => assertJarsignerVerified('sm      42 classes.dex\njar verified.'));
  assert.throws(() => assertJarsignerVerified('jar is unsigned.'), /did not prove/);
  assert.throws(() => assertJarsignerVerified('jar verified.'), /did not prove/);
});

await test('APK signer certificate digest is mandatory and normalized', () => {
  const upper = 'A'.repeat(64);
  assert.equal(
    parseApkSignerDigest(`Signer #1 certificate SHA-256 digest: ${upper}`),
    'a'.repeat(64),
  );
  assert.throws(() => parseApkSignerDigest('Signer verified, digest absent'), /did not contain/);
});

await test('artifact records bind relative path, byte length and SHA-256', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'is-release-artifact-'));
  try {
    const file = path.join(dir, 'artifact.apk');
    writeFileSync(file, 'IntentSmith fixture');
    assert.deepEqual(artifactRecord(file, dir), {
      path: 'artifact.apk',
      bytes: 19,
      sha256: 'caad605f5f5f392f66cab5e56c2b8b302f00595274849de9aedb5a93d9814092',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test('release manifest binds source, endpoint, signer, inputs and SBOM', () => {
  const manifest = createReleaseManifest({
    generatedAt: '2026-09-06T00:00:00.000Z',
    sourceRevision: '1'.repeat(40),
    sourceDirty: false,
    metadata,
    gatewayOrigin: 'https://gateway.example',
    debugSigning: false,
    certificateSha256: 'a'.repeat(64),
    nodeVersion: 'v22.16.0',
    javaMajor: 21,
    capacitorVersion: '8.4.3',
    gradleDistribution: 'gradle-8.14.3-bin.zip',
    dependencyLockSha256: 'b'.repeat(64),
    artifacts: [
      { path: 'app.apk', bytes: 1, sha256: 'c'.repeat(64) },
      { path: 'app.aab', bytes: 2, sha256: 'd'.repeat(64) },
    ],
    sbom: { path: 'release-sbom.cdx.json', bytes: 3, sha256: 'e'.repeat(64) },
  });
  const rendered = JSON.parse(renderReleaseManifest(manifest));
  assert.equal(rendered.source.revision, '1'.repeat(40));
  assert.equal(rendered.transport.gatewayOrigin, 'https://gateway.example');
  assert.equal(rendered.signing.certificateSha256, 'a'.repeat(64));
  assert.equal(rendered.application.versionCode, 1000);
  assert.equal(rendered.artifacts.length, 2);
  assert.match(rendered.sbom.path, /cyclonedx|cdx/i);
});

await test('CycloneDX SBOM generation is a mandatory build step', () => {
  assert.match(workflow, /'sbom',[\s\S]+?'--omit=dev',[\s\S]+?'--sbom-format=cyclonedx'/);
  assert.match(workflow, /sbom\.bomFormat !== 'CycloneDX'/);
  assert.match(workflow, /release-sbom\.cdx\.json/);
  assert.match(workflow, /dependencyLockSha256: sha256File/);
});

await test('release builds refuse dirty sources unless explicitly marked', () => {
  assert.match(workflow, /source\.dirty && !allowDirty/);
  assert.match(workflow, /Release build requires a clean worktree/);
  assert.match(workflow, /--allow-dirty is valid only with build/);
  assert.match(artifactModule, /source: \{ revision: sourceRevision\.toLowerCase\(\), dirty: Boolean\(sourceDirty\) \}/);
});

console.log(`\nMobile release artifacts: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
