import { readFileSync } from 'node:fs';

import {
  SIGNED_AUTHORITY_DOMAIN,
} from '../../contracts/authority/signed-authority-receipt-v1.js';
import {
  M5_PRIVACY_INCIDENT_ID,
  M5_PRIVACY_KIND,
  M5_PRIVACY_ROTATION_CATEGORIES,
} from '../../contracts/m5/privacy-remediation-v1.js';
import {
  validateSignedM5PrivacyHistoryReceipt,
  validateSignedM5PrivacyRotationReceipt,
} from '../../contracts/m5/signed-privacy-receipts-v1.js';
import {
  createSignedAuthorityVerifier,
  verifySignedAuthorityReceiptSet,
} from './signed-authority-verifier.js';
import {
  registerM5PrivacyAuthorityFunctions,
} from './privacy-authority-validation.js';
import {
  registerSignedAuthorityStorageFunctions,
} from './signed-authority-storage-validation.js';

const DEFAULT_TRUST_STORE = Object.freeze(JSON.parse(readFileSync(
  new URL('../../contracts/authority/trusted-public-keys-v1.json', import.meta.url),
  'utf8',
)));

const EXPECTED_BINDING_KEYS = Object.freeze([
  'artifactManifestSha256',
  'evidenceHeadSha',
  'productCandidateSha',
  'productCandidateTree',
  'registryFingerprint',
  'releaseEvidenceIndexSha256',
]);

export const M5PrivacyAuthorityErrorCode = Object.freeze({
  BINDINGS_REQUIRED: 'M5_PRIVACY_SIGNED_BINDINGS_REQUIRED',
  HISTORY_ALREADY_RECORDED: 'M5_PRIVACY_HISTORY_ALREADY_RECORDED',
  OFFLINE_SIGNATURE_REQUIRED: 'M5_PRIVACY_OFFLINE_SIGNATURE_REQUIRED',
  ROTATION_ALREADY_RECORDED: 'M5_PRIVACY_ROTATION_ALREADY_RECORDED',
  SIGNED_RECEIPT_INVALID: 'M5_PRIVACY_SIGNED_RECEIPT_INVALID',
  STORAGE_FAILURE: 'M5_PRIVACY_STORAGE_FAILURE',
  UNSIGNED_LEGACY_RECEIPT: 'M5_PRIVACY_UNSIGNED_LEGACY_RECEIPT',
});

export class M5PrivacyAuthorityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'M5PrivacyAuthorityError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new M5PrivacyAuthorityError(code, message);
}

function storageFailure(error) {
  if (error instanceof M5PrivacyAuthorityError) throw error;
  fail(M5PrivacyAuthorityErrorCode.STORAGE_FAILURE, 'Privacy authority storage failed');
}

function exactExpectedBindings(value) {
  if (!(value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...EXPECTED_BINDING_KEYS].sort()))) {
    return false;
  }
  return /^[a-f0-9]{40}$/u.test(value.productCandidateSha)
    && /^[a-f0-9]{40}$/u.test(value.productCandidateTree)
    && /^[a-f0-9]{40}$/u.test(value.evidenceHeadSha)
    && /^[a-f0-9]{64}$/u.test(value.registryFingerprint)
    && /^sha256:[a-f0-9]{64}$/u.test(value.releaseEvidenceIndexSha256)
    && /^sha256:[a-f0-9]{64}$/u.test(value.artifactManifestSha256);
}

function orderLinearChain(receipts) {
  if (receipts.length === 0) return [];
  const byPrevious = new Map();
  for (const receipt of receipts) {
    const previous = receipt.previousReceiptId ?? null;
    const children = byPrevious.get(previous) || [];
    children.push(receipt);
    byPrevious.set(previous, children);
  }
  const ordered = [];
  let previous = null;
  while (ordered.length < receipts.length) {
    const children = byPrevious.get(previous) || [];
    if (children.length !== 1) fail(
      M5PrivacyAuthorityErrorCode.SIGNED_RECEIPT_INVALID,
      'Signed privacy receipt chain is missing, cyclic, or branched',
    );
    const next = children[0];
    ordered.push(next);
    previous = next.receiptId;
  }
  if ((byPrevious.get(previous) || []).length !== 0) fail(
    M5PrivacyAuthorityErrorCode.SIGNED_RECEIPT_INVALID,
    'Signed privacy receipt chain has trailing entries',
  );
  return ordered;
}

function validatePrivacySequence(receipts) {
  const rotations = [];
  let history = null;
  for (const [index, receipt] of receipts.entries()) {
    if (receipt.domain === SIGNED_AUTHORITY_DOMAIN.M5_PRIVACY_ROTATION) {
      const semantic = validateSignedM5PrivacyRotationReceipt(receipt);
      if (!semantic.valid) fail(
        M5PrivacyAuthorityErrorCode.SIGNED_RECEIPT_INVALID,
        `Signed rotation receipt is invalid: ${semantic.errors.join(',')}`,
      );
      if (history !== null || index >= M5_PRIVACY_ROTATION_CATEGORIES.length) fail(
        M5PrivacyAuthorityErrorCode.SIGNED_RECEIPT_INVALID,
        'Signed privacy rotations must precede the history receipt',
      );
      const expectedCategory = M5_PRIVACY_ROTATION_CATEGORIES[index];
      if (receipt.payload.categoryId !== expectedCategory.categoryId) fail(
        M5PrivacyAuthorityErrorCode.SIGNED_RECEIPT_INVALID,
        'Signed privacy rotations are not in the canonical category order',
      );
      rotations.push(receipt);
    } else if (receipt.domain === SIGNED_AUTHORITY_DOMAIN.M5_PRIVACY_HISTORY) {
      const semantic = validateSignedM5PrivacyHistoryReceipt(receipt);
      if (!semantic.valid) fail(
        M5PrivacyAuthorityErrorCode.SIGNED_RECEIPT_INVALID,
        `Signed history receipt is invalid: ${semantic.errors.join(',')}`,
      );
      if (history !== null || rotations.length !== M5_PRIVACY_ROTATION_CATEGORIES.length) fail(
        M5PrivacyAuthorityErrorCode.SIGNED_RECEIPT_INVALID,
        'Signed history receipt requires all eight ordered rotations',
      );
      history = receipt;
    } else {
      fail(
        M5PrivacyAuthorityErrorCode.SIGNED_RECEIPT_INVALID,
        'Receipt domain is not an M5 privacy authority domain',
      );
    }
  }
  return Object.freeze({ rotations: Object.freeze(rotations), history });
}

export class M5PrivacyAuthorityRepository {
  constructor(database, {
    trustStore = DEFAULT_TRUST_STORE,
    expectedBindings = null,
  } = {}) {
    if (!database || typeof database.prepare !== 'function' || typeof database.transaction !== 'function') {
      throw new TypeError('m5-privacy-authority:database-required');
    }
    if (expectedBindings !== null && !exactExpectedBindings(expectedBindings)) {
      throw new TypeError('m5-privacy-authority:expected-bindings-invalid');
    }
    this.database = database;
    this.expectedBindings = expectedBindings === null
      ? null
      : Object.freeze({ ...expectedBindings });
    this.verifier = createSignedAuthorityVerifier({ trustStore });
    // Migrations install persistent triggers, but SQLite functions are scoped
    // to a single connection and disappear on restart. Re-register every UDF
    // used by those triggers whenever the production repository is wired.
    registerM5PrivacyAuthorityFunctions(database);
    registerSignedAuthorityStorageFunctions(database);
  }

  recordRotation() {
    fail(
      M5PrivacyAuthorityErrorCode.OFFLINE_SIGNATURE_REQUIRED,
      'Privacy rotation receipts must be signed by the offline M5 privacy operator',
    );
  }

  recordHistory() {
    fail(
      M5PrivacyAuthorityErrorCode.OFFLINE_SIGNATURE_REQUIRED,
      'Privacy history receipts must be signed by the offline M5 privacy operator',
    );
  }

  #assertNoUnsignedLegacyReceipts() {
    const rotationCount = this.database.prepare(
      'SELECT count(*) count FROM m5_privacy_rotation_receipts',
    ).get().count;
    const historyCount = this.database.prepare(
      'SELECT count(*) count FROM m5_privacy_history_receipts',
    ).get().count;
    if (rotationCount !== 0 || historyCount !== 0) fail(
      M5PrivacyAuthorityErrorCode.UNSIGNED_LEGACY_RECEIPT,
      'Unsigned legacy privacy receipts require explicit offline remediation',
    );
  }

  #loadVerifiedReceipts({ requireBindings }) {
    this.#assertNoUnsignedLegacyReceipts();
    if (requireBindings && this.expectedBindings === null) fail(
      M5PrivacyAuthorityErrorCode.BINDINGS_REQUIRED,
      'Exact signed receipt candidate and evidence bindings are required',
    );
    const rows = this.database.prepare(`
      SELECT CAST(record_json AS BLOB) AS record_bytes
      FROM m5_signed_privacy_receipts
      ORDER BY issued_at_ms, receipt_id
    `).all();
    const receipts = rows.map((row, index) => {
      // SQLite TEXT decoding is lossy for malformed UTF-8. Authority is bound
      // to the exact stored bytes, so re-read the underlying bytes as a BLOB
      // before every verification instead of trusting the decoded JS string.
      const verification = this.verifier.verifyRaw(row.record_bytes, {
        expected: this.expectedBindings || {},
      });
      if (!verification.valid) fail(
        M5PrivacyAuthorityErrorCode.SIGNED_RECEIPT_INVALID,
        `Stored signed privacy receipt ${index} is invalid: ${verification.errors.join(',')}`,
      );
      return verification.receipt;
    });
    const ordered = orderLinearChain(receipts);
    const set = verifySignedAuthorityReceiptSet(this.verifier, ordered, {
      expected: this.expectedBindings || {},
      requireLinearChain: true,
    });
    if (!set.valid) fail(
      M5PrivacyAuthorityErrorCode.SIGNED_RECEIPT_INVALID,
      `Stored signed privacy receipt set is invalid: ${set.errors.join(',')}`,
    );
    return Object.freeze({ ordered: Object.freeze(ordered), ...validatePrivacySequence(ordered) });
  }

  importSignedReceipt(rawReceipt) {
    if (this.expectedBindings === null) fail(
      M5PrivacyAuthorityErrorCode.BINDINGS_REQUIRED,
      'Offline import requires exact candidate and evidence bindings',
    );
    const verification = this.verifier.verifyRaw(rawReceipt, {
      expected: this.expectedBindings,
    });
    if (!verification.valid) fail(
      M5PrivacyAuthorityErrorCode.SIGNED_RECEIPT_INVALID,
      `Offline signed privacy receipt is invalid: ${verification.errors.join(',')}`,
    );
    const receipt = verification.receipt;
    if (![SIGNED_AUTHORITY_DOMAIN.M5_PRIVACY_ROTATION,
      SIGNED_AUTHORITY_DOMAIN.M5_PRIVACY_HISTORY].includes(receipt.domain)) fail(
      M5PrivacyAuthorityErrorCode.SIGNED_RECEIPT_INVALID,
      'Offline signed receipt does not belong to M5 privacy',
    );
    try {
      const insert = this.database.transaction(() => {
        const current = this.#loadVerifiedReceipts({ requireBindings: true });
        const candidate = [...current.ordered, receipt];
        const ordered = orderLinearChain(candidate);
        const set = verifySignedAuthorityReceiptSet(this.verifier, ordered, {
          expected: this.expectedBindings,
          requireLinearChain: true,
        });
        if (!set.valid) fail(
          M5PrivacyAuthorityErrorCode.SIGNED_RECEIPT_INVALID,
          `Offline signed privacy chain is invalid: ${set.errors.join(',')}`,
        );
        validatePrivacySequence(ordered);
        this.database.prepare(`
          INSERT INTO m5_signed_privacy_receipts (
            receipt_id, domain, authority_id, issued_at_ms, nonce,
            previous_receipt_id, record_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          receipt.receiptId,
          receipt.domain,
          receipt.authorityId,
          receipt.issuedAtMs,
          receipt.nonce,
          receipt.previousReceiptId,
          String(rawReceipt),
        );
      });
      insert();
      return receipt;
    } catch (error) {
      storageFailure(error);
    }
  }

  summary() {
    try {
      const authorityBindingsVerified = this.expectedBindings !== null;
      const { rotations, history } = this.#loadVerifiedReceipts({
        requireBindings: false,
      });
      const completed = new Set(rotations.map(receipt => receipt.payload.categoryId));
      const missingCategoryIds = M5_PRIVACY_ROTATION_CATEGORIES
        .map(category => category.categoryId)
        .filter(categoryId => !completed.has(categoryId));
      return Object.freeze({
        contract: M5_PRIVACY_KIND.REMEDIATION_STATUS,
        version: 2,
        authorityProtocol: 'OFFLINE_ED25519_SIGNED_RECEIPTS',
        authorityBindingsVerified,
        incidentId: M5_PRIVACY_INCIDENT_ID,
        rotationRequired: M5_PRIVACY_ROTATION_CATEGORIES.length,
        rotationCompleted: rotations.length,
        missingCategoryIds: Object.freeze(missingCategoryIds),
        rotations,
        historyDisposition: history,
        secretValuesRecorded: false,
        verdict: authorityBindingsVerified && missingCategoryIds.length === 0 && history
          ? 'OPERATOR_REMEDIATION_RECORDED'
          : 'INCOMPLETE',
      });
    } catch (error) {
      storageFailure(error);
    }
  }
}

export default M5PrivacyAuthorityRepository;
