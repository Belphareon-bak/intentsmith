import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const MAX_ANDROID_VERSION_CODE = 2_100_000_000;
export const VERSION_SCHEME = 'major*1000000+minor*1000+patch';

export function versionCodeFor(versionName) {
  const match = String(versionName).match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  if (!match) throw new TypeError('versionName must be strict major.minor.patch decimal semver.');
  const [, major, minor, patch] = match.map(Number);
  if (minor > 999 || patch > 999) {
    throw new RangeError('versionName minor and patch components must not exceed 999.');
  }
  const code = (major * 1_000_000) + (minor * 1_000) + patch;
  if (!Number.isSafeInteger(code) || code < 1 || code > MAX_ANDROID_VERSION_CODE) {
    throw new RangeError(`Computed versionCode must be between 1 and ${MAX_ANDROID_VERSION_CODE}.`);
  }
  return code;
}

export function validateReleaseMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Mobile release metadata must be an object.');
  }
  const exactKeys = [
    'applicationId',
    'channel',
    'schemaVersion',
    'versionCode',
    'versionName',
    'versionScheme',
  ];
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(exactKeys)) {
    throw new TypeError(`Mobile release metadata keys must be exactly: ${exactKeys.join(', ')}.`);
  }
  if (value.schemaVersion !== 1) throw new TypeError('Unsupported mobile release metadata schema.');
  if (value.applicationId !== 'cz.intentsmith.companion') {
    throw new TypeError('Unexpected Android applicationId in release metadata.');
  }
  if (value.versionScheme !== VERSION_SCHEME) throw new TypeError('Unexpected versionCode scheme.');
  if (!['internal', 'production'].includes(value.channel)) {
    throw new TypeError('Release channel must be internal or production.');
  }
  const expectedCode = versionCodeFor(value.versionName);
  if (value.versionCode !== expectedCode) {
    throw new TypeError(`versionCode ${value.versionCode} does not match ${value.versionName} (${expectedCode}).`);
  }
  return Object.freeze({ ...value });
}

export function readReleaseMetadata(file) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new TypeError(`Cannot read mobile release metadata ${file}: ${error.message}`);
  }
  return validateReleaseMetadata(parsed);
}

export function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function artifactRecord(file, root) {
  if (!existsSync(file)) throw new TypeError(`Release artifact is missing: ${file}`);
  return {
    path: path.relative(root, file).replaceAll('\\', '/'),
    bytes: statSync(file).size,
    sha256: sha256File(file),
  };
}

export function parseApkSignerDigest(output) {
  const match = String(output).match(/certificate SHA-256 digest:\s*([0-9a-f]{64})/i);
  if (!match) throw new TypeError('apksigner output did not contain a SHA-256 certificate digest.');
  return match[1].toLowerCase();
}

export function assertJarsignerVerified(output) {
  const text = String(output);
  if (/jar is unsigned/i.test(text)
      || !/jar verified/i.test(text)
      || !/^\s*s[m k]*\s+\d+\s+/m.test(text)) {
    throw new TypeError('jarsigner did not prove that the app bundle contains verified signed entries.');
  }
}

function validateArtifactRecord(record, extension) {
  if (!record || typeof record !== 'object'
      || typeof record.path !== 'string' || !record.path.endsWith(extension)
      || !Number.isSafeInteger(record.bytes) || record.bytes < 1
      || !/^[0-9a-f]{64}$/.test(record.sha256)) {
    throw new TypeError(`Invalid ${extension} release artifact record.`);
  }
}

export function createReleaseManifest({
  generatedAt,
  sourceRevision,
  sourceDirty,
  metadata,
  gatewayOrigin,
  debugSigning,
  certificateSha256,
  nodeVersion,
  javaMajor,
  capacitorVersion,
  gradleDistribution,
  artifacts,
  sbom,
  dependencyLockSha256,
}) {
  const normalizedMetadata = validateReleaseMetadata(metadata);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(generatedAt)) throw new TypeError('generatedAt must be ISO-8601.');
  if (!/^[0-9a-f]{40}$/i.test(sourceRevision)) throw new TypeError('sourceRevision must be a full Git SHA-1.');
  let parsedGateway;
  try {
    parsedGateway = new URL(gatewayOrigin);
  } catch {
    throw new TypeError('gatewayOrigin must be normalized before manifest creation.');
  }
  if (!['http:', 'https:'].includes(parsedGateway.protocol) || parsedGateway.origin !== gatewayOrigin) {
    throw new TypeError('gatewayOrigin must be normalized before manifest creation.');
  }
  if (!/^[0-9a-f]{64}$/.test(certificateSha256)) throw new TypeError('certificateSha256 must be lowercase hex.');
  if (!Array.isArray(artifacts) || artifacts.length !== 2) {
    throw new TypeError('A release manifest requires exactly the APK and AAB records.');
  }
  validateArtifactRecord(artifacts[0], '.apk');
  validateArtifactRecord(artifacts[1], '.aab');
  validateArtifactRecord(sbom, '.json');
  if (!/^[0-9a-f]{64}$/.test(dependencyLockSha256)) {
    throw new TypeError('dependencyLockSha256 must be lowercase hex.');
  }
  if (javaMajor !== 21) throw new TypeError('Release manifest requires JDK 21.');
  if (normalizedMetadata.channel === 'production' && (sourceDirty || debugSigning)) {
    throw new TypeError('Production manifests cannot describe dirty or debug-signed builds.');
  }
  return {
    schemaVersion: 1,
    generatedAt,
    source: { revision: sourceRevision.toLowerCase(), dirty: Boolean(sourceDirty) },
    application: normalizedMetadata,
    transport: { gatewayOrigin },
    signing: { debug: Boolean(debugSigning), certificateSha256 },
    toolchain: { nodeVersion, javaMajor, capacitorVersion, gradleDistribution },
    inputs: { dependencyLockSha256 },
    artifacts,
    sbom,
  };
}

export function renderReleaseManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
