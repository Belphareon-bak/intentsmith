import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from 'node:crypto';
import { TextDecoder } from 'node:util';

import {
  SIGNED_AUTHORITY_ALGORITHM,
  SIGNED_AUTHORITY_ROLE,
  canonicalizeSignedAuthorityValue,
  signedAuthoritySigningBytes,
  validateSignedAuthorityReceiptShape,
} from '../../contracts/authority/signed-authority-receipt-v1.js';

const TRUST_STORE_KEYS = Object.freeze(['algorithm', 'contract', 'keys', 'version']);
const TRUST_KEY_KEYS = Object.freeze([
  'algorithm',
  'authorityId',
  'keyId',
  'publicKeySpkiDerBase64url',
  'status',
]);
const EXPECTED_BINDINGS = Object.freeze([
  'artifactManifestSha256',
  'evidenceHeadSha',
  'productCandidateSha',
  'productCandidateTree',
  'registryFingerprint',
  'releaseEvidenceIndexSha256',
]);
const FATAL_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isRecord(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function decodeSpki(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const der = Buffer.from(value, 'base64url');
    return der.length > 0 && der.toString('base64url') === value ? der : null;
  } catch {
    return null;
  }
}

export function signedAuthorityKeyId(publicKey) {
  const key = publicKey?.type === 'public'
    ? publicKey
    : createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('signed-authority:public-key-not-ed25519');
  }
  const der = key.export({ format: 'der', type: 'spki' });
  return `sha256:${createHash('sha256').update(der).digest('hex')}`;
}

export function validateSignedAuthorityTrustStore(trustStore) {
  const errors = [];
  if (!exactKeys(trustStore, TRUST_STORE_KEYS)) {
    errors.push('trust-store:keys');
    return Object.freeze({ valid: false, errors: Object.freeze(errors), keys: Object.freeze([]) });
  }
  if (trustStore.contract !== 'SignedAuthorityTrustStore') errors.push('trust-store:contract');
  if (trustStore.version !== 1) errors.push('trust-store:version');
  if (trustStore.algorithm !== SIGNED_AUTHORITY_ALGORITHM) errors.push('trust-store:algorithm');
  if (!Array.isArray(trustStore.keys)) errors.push('trust-store:key-list');
  const parsed = [];
  const identities = new Set();
  const keyIds = new Set();
  const publicKeys = new Set();
  for (const [index, entry] of (trustStore.keys || []).entries()) {
    const prefix = `trust-store:key[${index}]`;
    if (!exactKeys(entry, TRUST_KEY_KEYS)) {
      errors.push(`${prefix}:keys`);
      continue;
    }
    if (!Object.values(SIGNED_AUTHORITY_ROLE).includes(entry.authorityId)) {
      errors.push(`${prefix}:authority`);
    }
    if (entry.algorithm !== SIGNED_AUTHORITY_ALGORITHM) errors.push(`${prefix}:algorithm`);
    if (!['ACTIVE', 'REVOKED'].includes(entry.status)) errors.push(`${prefix}:status`);
    const der = decodeSpki(entry.publicKeySpkiDerBase64url);
    if (!der) {
      errors.push(`${prefix}:spki`);
      continue;
    }
    try {
      const publicKey = createPublicKey({ key: der, format: 'der', type: 'spki' });
      const derivedKeyId = signedAuthorityKeyId(publicKey);
      if (entry.keyId !== derivedKeyId) errors.push(`${prefix}:key-id`);
      const identity = `${entry.authorityId}\0${entry.keyId}`;
      if (identities.has(identity)) errors.push(`${prefix}:duplicate`);
      identities.add(identity);
      if (keyIds.has(entry.keyId)) errors.push(`${prefix}:key-reused-across-roles`);
      keyIds.add(entry.keyId);
      if (publicKeys.has(entry.publicKeySpkiDerBase64url)) {
        errors.push(`${prefix}:spki-reused-across-roles`);
      }
      publicKeys.add(entry.publicKeySpkiDerBase64url);
      parsed.push(Object.freeze({ ...entry, publicKey }));
    } catch {
      errors.push(`${prefix}:public-key`);
    }
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    keys: Object.freeze(parsed),
  });
}

export function createSignedAuthorityVerifier({ trustStore } = {}) {
  const validation = validateSignedAuthorityTrustStore(trustStore);
  if (!validation.valid) {
    throw new TypeError(`signed-authority:trust-store-invalid:${validation.errors.join(',')}`);
  }
  const keys = new Map(validation.keys.map(entry => (
    [`${entry.authorityId}\0${entry.keyId}`, entry]
  )));

  function verify(receipt, { expected = {}, seenNonceKeys = new Set() } = {}) {
    const errors = [];
    const shape = validateSignedAuthorityReceiptShape(receipt);
    errors.push(...shape.errors);
    if (shape.valid) {
      const key = keys.get(`${receipt.authorityId}\0${receipt.keyId}`);
      if (!key) errors.push('signature:unknown-key');
      else if (key.status !== 'ACTIVE') errors.push('signature:revoked-key');
      else {
        let valid = false;
        try {
          valid = verifySignature(
            null,
            signedAuthoritySigningBytes(receipt),
            key.publicKey,
            Buffer.from(receipt.signature, 'base64url'),
          );
        } catch {
          valid = false;
        }
        if (!valid) errors.push('signature:invalid');
      }
      for (const name of EXPECTED_BINDINGS) {
        if (Object.hasOwn(expected, name) && receipt[name] !== expected[name]) {
          errors.push(`binding:${name}`);
        }
      }
      if (seenNonceKeys.has(receipt.nonce)) errors.push('replay:nonce');
    }
    return Object.freeze({
      valid: errors.length === 0,
      errors: Object.freeze(errors),
      receipt: errors.length === 0 ? Object.freeze(receipt) : null,
    });
  }

  function verifyRaw(rawBytes, options = {}) {
    const errors = [];
    if (!(typeof rawBytes === 'string' || Buffer.isBuffer(rawBytes))) {
      return Object.freeze({ valid: false, errors: Object.freeze(['raw:bytes']), receipt: null });
    }
    const exactBytes = Buffer.isBuffer(rawBytes)
      ? rawBytes
      : Buffer.from(rawBytes, 'utf8');
    let decoded;
    try {
      decoded = FATAL_UTF8_DECODER.decode(exactBytes);
    } catch {
      return Object.freeze({ valid: false, errors: Object.freeze(['raw:utf8']), receipt: null });
    }
    let receipt;
    try {
      receipt = JSON.parse(decoded);
    } catch {
      return Object.freeze({ valid: false, errors: Object.freeze(['raw:json']), receipt: null });
    }
    let canonicalBytes;
    try {
      canonicalBytes = Buffer.from(`${canonicalizeSignedAuthorityValue(receipt)}\n`, 'utf8');
    } catch {
      errors.push('raw:canonical');
    }
    if (!canonicalBytes?.equals(exactBytes)) errors.push('raw:noncanonical');
    const verified = verify(receipt, options);
    errors.push(...verified.errors);
    return Object.freeze({
      valid: errors.length === 0,
      errors: Object.freeze(errors),
      receipt: errors.length === 0 ? Object.freeze(receipt) : null,
    });
  }

  return Object.freeze({ verify, verifyRaw });
}

export function verifySignedAuthorityReceiptSet(
  verifier,
  receipts,
  {
    expected = {},
    requireLinearChain = false,
    startingPreviousReceiptId = null,
  } = {},
) {
  const errors = [];
  if (!verifier || typeof verifier.verify !== 'function') {
    return Object.freeze({ valid: false, errors: Object.freeze(['set:verifier']), receipts: null });
  }
  if (!Array.isArray(receipts)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['set:receipts']), receipts: null });
  }
  const seenNonceKeys = new Set();
  const seenReceiptIds = new Set();
  let previousReceiptId = startingPreviousReceiptId;
  for (const [index, receipt] of receipts.entries()) {
    const result = verifier.verify(receipt, { expected, seenNonceKeys });
    errors.push(...result.errors.map(error => `receipt[${index}]:${error}`));
    if (result.valid) {
      seenNonceKeys.add(receipt.nonce);
      if (seenReceiptIds.has(receipt.receiptId)) errors.push(`receipt[${index}]:replay:receipt`);
      seenReceiptIds.add(receipt.receiptId);
      if (requireLinearChain && receipt.previousReceiptId !== previousReceiptId) {
        errors.push(`receipt[${index}]:chain:previous`);
      }
      previousReceiptId = receipt.receiptId;
    }
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    receipts: errors.length === 0 ? Object.freeze([...receipts]) : null,
  });
}
