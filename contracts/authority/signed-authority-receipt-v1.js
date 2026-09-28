import { createHash } from 'node:crypto';

export const SIGNED_AUTHORITY_RECEIPT_CONTRACT = 'SignedAuthorityReceipt';
export const SIGNED_AUTHORITY_RECEIPT_VERSION = 1;
export const SIGNED_AUTHORITY_ALGORITHM = 'Ed25519';
export const SIGNED_AUTHORITY_RECEIPT_PREFIX = 'sar1:';
export const SIGNED_AUTHORITY_SIGNING_PREFIX =
  'IntentSmith SignedAuthorityReceipt@1';

export const SIGNED_AUTHORITY_ROLE = Object.freeze({
  M5_PRIVACY_OPERATOR: 'm5-privacy-operator',
  M5_ACCEPTANCE_OPERATOR: 'm5-acceptance-operator',
  M6_INDEPENDENT_REVIEWER: 'm6-independent-reviewer',
  M6_RELEASE_OPERATOR: 'm6-release-operator',
});

export const SIGNED_AUTHORITY_DOMAIN = Object.freeze({
  M5_PRIVACY_ROTATION: 'intentsmith.m5.privacy.rotation.v1',
  M5_PRIVACY_HISTORY: 'intentsmith.m5.privacy.history.v1',
  M5_ACCEPTANCE: 'intentsmith.m5.acceptance.v1',
  M6_INDEPENDENT_REVIEW: 'intentsmith.m6.independent-review.v1',
  M6_OPERATOR_DEMO: 'intentsmith.m6.operator-demo.v1',
  M6_GATE0: 'intentsmith.m6.gate0.v1',
});

export const SIGNED_AUTHORITY_DOMAIN_ROLE = Object.freeze({
  [SIGNED_AUTHORITY_DOMAIN.M5_PRIVACY_ROTATION]: SIGNED_AUTHORITY_ROLE.M5_PRIVACY_OPERATOR,
  [SIGNED_AUTHORITY_DOMAIN.M5_PRIVACY_HISTORY]: SIGNED_AUTHORITY_ROLE.M5_PRIVACY_OPERATOR,
  [SIGNED_AUTHORITY_DOMAIN.M5_ACCEPTANCE]: SIGNED_AUTHORITY_ROLE.M5_ACCEPTANCE_OPERATOR,
  [SIGNED_AUTHORITY_DOMAIN.M6_INDEPENDENT_REVIEW]: SIGNED_AUTHORITY_ROLE.M6_INDEPENDENT_REVIEWER,
  [SIGNED_AUTHORITY_DOMAIN.M6_OPERATOR_DEMO]: SIGNED_AUTHORITY_ROLE.M6_RELEASE_OPERATOR,
  [SIGNED_AUTHORITY_DOMAIN.M6_GATE0]: SIGNED_AUTHORITY_ROLE.M6_RELEASE_OPERATOR,
});

const SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const KEY_ID = /^sha256:[a-f0-9]{64}$/u;
const RECEIPT_ID = /^sar1:[a-f0-9]{64}$/u;
const NONCE = /^[A-Za-z0-9_-]{22,64}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const ACTOR_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{1,127}$/u;
const DECISION = /^[A-Z][A-Z0-9_]{1,63}$/u;
const GIT_MODE = /^(?:100644|100755)$/u;

const CORE_KEYS = Object.freeze([
  'actor',
  'algorithm',
  'artifactManifestSha256',
  'artifacts',
  'authorityId',
  'contract',
  'decision',
  'domain',
  'evidenceHeadSha',
  'issuedAtMs',
  'keyId',
  'nonce',
  'payload',
  'previousReceiptId',
  'productCandidateSha',
  'productCandidateTree',
  'registryFingerprint',
  'releaseEvidenceIndexSha256',
  'version',
]);
const RECEIPT_KEYS = Object.freeze([...CORE_KEYS, 'receiptId', 'signature']);
const ACTOR_KEYS = Object.freeze(['actorId', 'actorType']);
const ARTIFACT_KEYS = Object.freeze(['bytes', 'gitMode', 'path', 'sha256']);

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  return isPlainRecord(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function canonicalize(value, seen = new Set(), depth = 0) {
  if (depth > 48) throw new TypeError('signed-authority:canonical-too-deep');
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new TypeError('signed-authority:canonical-number-invalid');
    }
    return String(value);
  }
  if (typeof value !== 'object' || seen.has(value)) {
    throw new TypeError('signed-authority:canonical-value-invalid');
  }
  seen.add(value);
  let encoded;
  if (Array.isArray(value)) {
    encoded = `[${value.map(item => canonicalize(item, seen, depth + 1)).join(',')}]`;
  } else if (isPlainRecord(value)) {
    encoded = `{${Object.keys(value).sort(compareUtf8).map(key => (
      `${JSON.stringify(key)}:${canonicalize(value[key], seen, depth + 1)}`
    )).join(',')}}`;
  } else {
    seen.delete(value);
    throw new TypeError('signed-authority:canonical-object-invalid');
  }
  seen.delete(value);
  return encoded;
}

export function canonicalizeSignedAuthorityValue(value) {
  return canonicalize(value);
}

function safePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\\')
    && !value.includes('\0')
    && !value.startsWith('/')
    && value !== '..'
    && !value.startsWith('../')
    && !value.includes('/../');
}

function exactBase64url(value, bytes) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) return false;
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.length === bytes && decoded.toString('base64url') === value;
  } catch {
    return false;
  }
}

export function signedAuthorityReceiptCore(receipt) {
  return Object.freeze(Object.fromEntries(
    CORE_KEYS.map(key => [key, receipt?.[key]]),
  ));
}

export function signedAuthoritySigningBytes(receipt) {
  const core = signedAuthorityReceiptCore(receipt);
  const prefix = Buffer.from(
    `${SIGNED_AUTHORITY_SIGNING_PREFIX}\0${core.domain}\0`,
    'utf8',
  );
  return Buffer.concat([
    prefix,
    Buffer.from(canonicalizeSignedAuthorityValue(core), 'utf8'),
  ]);
}

export function computeSignedAuthorityReceiptId(receipt) {
  const identity = {
    core: signedAuthorityReceiptCore(receipt),
    signature: receipt?.signature,
  };
  return `${SIGNED_AUTHORITY_RECEIPT_PREFIX}${createHash('sha256')
    .update(canonicalizeSignedAuthorityValue(identity), 'utf8')
    .digest('hex')}`;
}

export function validateSignedAuthorityReceiptShape(receipt) {
  const errors = [];
  if (!exactKeys(receipt, RECEIPT_KEYS)) {
    errors.push('receipt:keys');
    return Object.freeze({ valid: false, errors: Object.freeze(errors) });
  }
  if (receipt.contract !== SIGNED_AUTHORITY_RECEIPT_CONTRACT) errors.push('receipt:contract');
  if (receipt.version !== SIGNED_AUTHORITY_RECEIPT_VERSION) errors.push('receipt:version');
  if (receipt.algorithm !== SIGNED_AUTHORITY_ALGORITHM) errors.push('receipt:algorithm');
  if (SIGNED_AUTHORITY_DOMAIN_ROLE[receipt.domain] !== receipt.authorityId) {
    errors.push('receipt:domain-role');
  }
  if (!Object.values(SIGNED_AUTHORITY_ROLE).includes(receipt.authorityId)) {
    errors.push('receipt:authority');
  }
  if (!KEY_ID.test(receipt.keyId || '')) errors.push('receipt:key-id');
  if (!SHA.test(receipt.productCandidateSha || '')) errors.push('receipt:candidate');
  if (!SHA.test(receipt.productCandidateTree || '')) errors.push('receipt:candidate-tree');
  if (!SHA.test(receipt.evidenceHeadSha || '')) errors.push('receipt:evidence-head');
  if (!/^[a-f0-9]{64}$/u.test(receipt.registryFingerprint || '')) {
    errors.push('receipt:registry');
  }
  if (!SHA256.test(receipt.releaseEvidenceIndexSha256 || '')) {
    errors.push('receipt:evidence-index');
  }
  if (!SHA256.test(receipt.artifactManifestSha256 || '')) {
    errors.push('receipt:artifact-manifest');
  }
  if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length === 0) {
    errors.push('receipt:artifacts');
  } else {
    const paths = new Set();
    for (const artifact of receipt.artifacts) {
      if (!exactKeys(artifact, ARTIFACT_KEYS)
        || !safePath(artifact.path)
        || !Number.isSafeInteger(artifact.bytes)
        || artifact.bytes < 1
        || !GIT_MODE.test(artifact.gitMode || '')
        || !SHA256.test(artifact.sha256 || '')) {
        errors.push('receipt:artifact-shape');
        break;
      }
      if (paths.has(artifact.path)) errors.push('receipt:artifact-duplicate');
      paths.add(artifact.path);
    }
  }
  if (!DECISION.test(receipt.decision || '')) errors.push('receipt:decision');
  if (!Number.isSafeInteger(receipt.issuedAtMs) || receipt.issuedAtMs < 1) {
    errors.push('receipt:issued-at');
  }
  if (!NONCE.test(receipt.nonce || '') || !exactBase64url(receipt.nonce, 16)) {
    errors.push('receipt:nonce');
  }
  if (!(receipt.previousReceiptId === null || RECEIPT_ID.test(receipt.previousReceiptId || ''))) {
    errors.push('receipt:previous-receipt');
  }
  if (!exactKeys(receipt.actor, ACTOR_KEYS)
    || receipt.actor.actorType !== 'user'
    || !ACTOR_ID.test(receipt.actor.actorId || '')) {
    errors.push('receipt:actor');
  }
  if (!isPlainRecord(receipt.payload)) errors.push('receipt:payload');
  if (!SIGNATURE.test(receipt.signature || '') || !exactBase64url(receipt.signature, 64)) {
    errors.push('receipt:signature');
  }
  try {
    if (receipt.receiptId !== computeSignedAuthorityReceiptId(receipt)) {
      errors.push('receipt:id');
    }
    canonicalizeSignedAuthorityValue(receipt);
  } catch {
    errors.push('receipt:canonical');
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
