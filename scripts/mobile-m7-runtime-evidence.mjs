import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';

export const MOBILE_M7_RUNTIME_EVIDENCE_CONTRACT = 'MobileM7RuntimeEvidence';
export const MOBILE_M7_RUNTIME_EVIDENCE_VERSION = 1;
export const MOBILE_M7_RUNTIME_CHECK_IDS = Object.freeze([
  'candidate-installed',
  'logout-identity-wiped',
  'mutation-approval-roundtrip',
  'offline-reconnect',
  'pairing-single-use',
  'read-invocation-signed',
  'server-restart-replay-fenced',
  'session-open-signed',
  'session-refresh-signed',
  'session-revoke-enforced',
  'tls13-spki-accepted',
  'vpn-only-reachability',
  'wrong-spki-rejected',
]);

const SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PIN = /^sha256:[a-f0-9]{64}$/u;
const OBSERVATION_ID = /^[a-z][a-z0-9-]{0,63}$/u;
const VPN_INTERFACE = /^(?:tailscale0|wg(?:[0-9]+|-[A-Za-z0-9_.-]+)|tun(?:[0-9]+|-[A-Za-z0-9_.-]+))$/u;
const MAX_ARTIFACTS = 64;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MAX_INDEX_BYTES = 1024 * 1024;
const TOP_LEVEL_KEYS = Object.freeze([
  'artifactBindings', 'artifacts', 'candidate', 'checks', 'contract',
  'device', 'recordedAtMs', 'runtime', 'version',
]);

function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  return plain(value)
    && Object.keys(value).join('\0') === expected.join('\0');
}

function decodeCanonicalJson(rawBytes) {
  if (!Buffer.isBuffer(rawBytes)) throw new TypeError('mobile-runtime-evidence:buffer-required');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
  } catch {
    throw new Error('mobile-runtime-evidence:utf8');
  }
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    throw new Error('mobile-runtime-evidence:json');
  }
  if (`${JSON.stringify(record)}\n` !== text) {
    throw new Error('mobile-runtime-evidence:canonical-bytes');
  }
  return record;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 240
    && !path.posix.isAbsolute(value)
    && !value.includes('\\')
    && value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
    && path.posix.normalize(value) === value;
}

function within(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function sameIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function stablePrivateFileBytes(filePath, label, maximumBytes) {
  const beforePath = lstatSync(filePath, { bigint: true });
  if (!beforePath.isFile() || beforePath.isSymbolicLink()) {
    throw new Error(`mobile-runtime-evidence:${label}:regular-file`);
  }
  if ((beforePath.mode & 0o077n) !== 0n) {
    throw new Error(`mobile-runtime-evidence:${label}:private-mode`);
  }
  if (beforePath.size < 1n || beforePath.size > BigInt(maximumBytes)) {
    throw new Error(`mobile-runtime-evidence:${label}:size-limit`);
  }
  const descriptor = openSync(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const beforeRead = fstatSync(descriptor, { bigint: true });
    if (!sameIdentity(beforePath, beforeRead)) {
      throw new Error(`mobile-runtime-evidence:${label}:identity-race`);
    }
    const bytes = readFileSync(descriptor);
    const afterRead = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(filePath, { bigint: true });
    if (!sameIdentity(beforeRead, afterRead) || !sameIdentity(afterRead, afterPath)
      || BigInt(bytes.length) !== afterRead.size) {
      throw new Error(`mobile-runtime-evidence:${label}:read-race`);
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function requirePrivateArtifactPath(evidenceRoot, relativePath, label) {
  let current = evidenceRoot;
  const segments = relativePath.split('/');
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    const metadata = lstatSync(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()
      || (metadata.mode & 0o077) !== 0) {
      throw new Error(`mobile-runtime-evidence:${label}:private-directory`);
    }
  }
  return path.join(current, segments.at(-1));
}

function exactOrigin(value) {
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.port !== '7443'
    || parsed.username || parsed.password || parsed.pathname !== '/'
    || parsed.search || parsed.hash || parsed.origin !== value) return null;
  return parsed.origin;
}

function originHost(value) {
  const origin = exactOrigin(value);
  if (origin === null) return null;
  const hostname = new URL(origin).hostname;
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1).toLowerCase()
    : hostname.toLowerCase();
}

function validateShape(record, expected, errors) {
  if (!exactKeys(record, TOP_LEVEL_KEYS)) errors.push('record:keys');
  if (record?.contract !== MOBILE_M7_RUNTIME_EVIDENCE_CONTRACT) errors.push('record:contract');
  if (record?.version !== MOBILE_M7_RUNTIME_EVIDENCE_VERSION) errors.push('record:version');
  if (!Number.isSafeInteger(record?.recordedAtMs) || record.recordedAtMs <= 0) {
    errors.push('record:timestamp');
  }

  if (!exactKeys(record?.candidate, ['sha', 'treeSha'])
    || !SHA.test(record?.candidate?.sha || '')
    || !SHA.test(record?.candidate?.treeSha || '')) errors.push('candidate:shape');
  if (record?.candidate?.sha !== expected.candidateSha) errors.push('candidate:sha');
  if (record?.candidate?.treeSha !== expected.candidateTreeSha) errors.push('candidate:tree');

  const bindingKeys = [
    'aabSha256', 'aabSignerSha256', 'apkSha256', 'apkSignerSha256',
    'sourceManifestSha256',
  ];
  if (!exactKeys(record?.artifactBindings, bindingKeys)
    || bindingKeys.some(key => !SHA256.test(record?.artifactBindings?.[key] || ''))) {
    errors.push('bindings:shape');
  }
  for (const key of bindingKeys) {
    if (record?.artifactBindings?.[key] !== expected[key]) errors.push(`bindings:${key}`);
  }

  const runtimeKeys = [
    'adapterManifestDigest', 'descriptorDigest', 'listenerAddress', 'listenerPort',
    'serverIdentityPin', 'serverOrigin', 'tlsVersion', 'transportMode', 'vpnInterface',
  ];
  const runtime = record?.runtime;
  if (!exactKeys(runtime, runtimeKeys)
    || runtime?.transportMode !== 'remote-core-v1'
    || runtime?.tlsVersion !== 'TLSv1.3'
    || runtime?.listenerPort !== 7443
    || !VPN_INTERFACE.test(runtime?.vpnInterface || '')
    || typeof runtime?.listenerAddress !== 'string'
    || isIP(runtime.listenerAddress) === 0
    || (isIP(originHost(runtime?.serverOrigin)) !== 0
      && originHost(runtime.serverOrigin) !== runtime.listenerAddress.toLowerCase())
    || exactOrigin(runtime?.serverOrigin) === null
    || !PIN.test(runtime?.serverIdentityPin || '')
    || !PIN.test(runtime?.descriptorDigest || '')
    || !PIN.test(runtime?.adapterManifestDigest || '')) errors.push('runtime:shape');
  for (const key of [
    'adapterManifestDigest', 'descriptorDigest', 'serverIdentityPin', 'serverOrigin',
  ]) {
    if (runtime?.[key] !== expected[key]) errors.push(`runtime:${key}`);
  }

  const device = record?.device;
  if (!exactKeys(device, [
    'apiLevel', 'applicationId', 'model', 'physical', 'sourceRevision',
    'versionCode', 'versionName',
  ])
    || device?.physical !== true
    || device?.applicationId !== 'cz.intentsmith.companion'
    || !Number.isSafeInteger(device?.apiLevel) || device.apiLevel < 29
    || !Number.isSafeInteger(device?.versionCode) || device.versionCode < 1
    || typeof device?.versionName !== 'string' || device.versionName.length < 1
    || device.versionName.length > 64
    || typeof device?.model !== 'string' || device.model.trim().length < 2
    || device?.sourceRevision !== expected.candidateSha) errors.push('device:shape');
}

function validateArtifacts(record, evidenceRoot, errors) {
  if (!Array.isArray(record?.artifacts) || record.artifacts.length < 1
    || record.artifacts.length > MAX_ARTIFACTS) {
    errors.push('artifacts:missing');
    return new Set();
  }
  const ids = new Set();
  let canonicalRoot;
  try {
    const rootMetadata = lstatSync(evidenceRoot);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()
      || (rootMetadata.mode & 0o077) !== 0) throw new Error('private-directory');
    canonicalRoot = realpathSync(evidenceRoot);
    if (canonicalRoot !== path.resolve(evidenceRoot)) throw new Error('canonical-directory');
  } catch {
    errors.push('artifacts:root');
    return ids;
  }
  let previousId = null;
  let totalBytes = 0;
  for (const artifact of record.artifacts) {
    if (!exactKeys(artifact, ['bytes', 'id', 'path', 'sha256'])
      || !OBSERVATION_ID.test(artifact?.id || '')
      || !safeRelativePath(artifact?.path)
      || !Number.isSafeInteger(artifact?.bytes) || artifact.bytes < 1
      || artifact.bytes > MAX_ARTIFACT_BYTES
      || !SHA256.test(artifact?.sha256 || '')) {
      errors.push('artifacts:shape');
      continue;
    }
    if (ids.has(artifact.id) || (previousId !== null && previousId >= artifact.id)) {
      errors.push(`artifacts:order:${artifact.id}`);
      continue;
    }
    previousId = artifact.id;
    ids.add(artifact.id);
    totalBytes += artifact.bytes;
    if (totalBytes > MAX_TOTAL_ARTIFACT_BYTES) {
      errors.push('artifacts:total-size-limit');
      continue;
    }
    try {
      const absolute = requirePrivateArtifactPath(
        evidenceRoot,
        artifact.path,
        `artifact:${artifact.id}`,
      );
      const canonical = realpathSync(absolute);
      if (!within(canonicalRoot, canonical) || canonical !== absolute) {
        throw new Error('outside-or-noncanonical');
      }
      const bytes = stablePrivateFileBytes(
        absolute,
        `artifact:${artifact.id}`,
        MAX_ARTIFACT_BYTES,
      );
      if (bytes.length !== artifact.bytes) errors.push(`artifact:${artifact.id}:bytes`);
      if (sha256(bytes) !== artifact.sha256) errors.push(`artifact:${artifact.id}:sha256`);
    } catch (error) {
      errors.push(`artifact:${artifact.id}:${error.message}`);
    }
  }
  return ids;
}

function validateChecks(record, artifactIds, errors) {
  if (!Array.isArray(record?.checks)
    || record.checks.length !== MOBILE_M7_RUNTIME_CHECK_IDS.length) {
    errors.push('checks:count');
    return false;
  }
  let verified = true;
  for (let index = 0; index < MOBILE_M7_RUNTIME_CHECK_IDS.length; index += 1) {
    const expectedId = MOBILE_M7_RUNTIME_CHECK_IDS[index];
    const check = record.checks[index];
    if (!exactKeys(check, ['artifactIds', 'id', 'status'])
      || check?.id !== expectedId
      || !['PASS', 'FAIL'].includes(check?.status)
      || !Array.isArray(check?.artifactIds) || check.artifactIds.length < 1
      || check.artifactIds.some((id, itemIndex) => !artifactIds.has(id)
        || (itemIndex > 0 && check.artifactIds[itemIndex - 1] >= id))) {
      errors.push(`checks:${expectedId}`);
      verified = false;
      continue;
    }
    if (check.status !== 'PASS') verified = false;
  }
  return verified;
}

export function validateMobileM7RuntimeEvidenceV1({ rawBytes, evidenceRoot, expected }) {
  const errors = [];
  let record;
  try {
    record = decodeCanonicalJson(rawBytes);
  } catch (error) {
    return Object.freeze({ valid: false, verified: false, errors: Object.freeze([error.message]) });
  }
  if (!plain(expected) || typeof evidenceRoot !== 'string') {
    return Object.freeze({
      valid: false,
      verified: false,
      errors: Object.freeze(['mobile-runtime-evidence:expected-bindings']),
    });
  }
  validateShape(record, expected, errors);
  const artifactIds = validateArtifacts(record, evidenceRoot, errors);
  const checksPass = validateChecks(record, artifactIds, errors);
  return Object.freeze({
    valid: errors.length === 0,
    verified: errors.length === 0 && checksPass,
    errors: Object.freeze(errors),
    record: errors.length === 0 ? Object.freeze(record) : null,
    rawSha256: sha256(rawBytes),
  });
}

export function readMobileM7RuntimeEvidenceV1({ evidencePath, expected }) {
  const absolute = path.resolve(evidencePath);
  const evidenceRoot = path.dirname(absolute);
  const rootMetadata = lstatSync(evidenceRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()
    || (rootMetadata.mode & 0o077) !== 0
    || realpathSync(evidenceRoot) !== evidenceRoot) {
    throw new Error('mobile-runtime-evidence:index:private-directory');
  }
  const rawBytes = stablePrivateFileBytes(absolute, 'index', MAX_INDEX_BYTES);
  const result = validateMobileM7RuntimeEvidenceV1({
    rawBytes,
    evidenceRoot,
    expected,
  });
  if (!result.valid) {
    throw new Error(`mobile-runtime-evidence:invalid:${result.errors.join(',')}`);
  }
  return result;
}
