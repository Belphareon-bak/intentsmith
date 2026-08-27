import {
  M5_PRIVACY_INCIDENT_ID,
  M5_PRIVACY_KIND,
  M5_PRIVACY_ROTATION_CATEGORIES,
  canonicalizeM5PrivacyValue,
  createM5PrivacyHistoryReceipt,
  createM5PrivacyRotationReceipt,
  expectedM5PrivacyAuthorityKind,
  validateM5PrivacyHistoryReceipt,
  validateM5PrivacyRotationReceipt,
} from '../../contracts/m5/privacy-remediation-v1.js';
import {
  registerM5PrivacyAuthorityFunctions,
  withM5PrivacyReceiptWriterAuthority,
} from './privacy-authority-validation.js';

export const M5PrivacyAuthorityErrorCode = Object.freeze({
  AUTH_REQUIRED: 'M5_PRIVACY_AUTH_REQUIRED',
  HISTORY_ALREADY_RECORDED: 'M5_PRIVACY_HISTORY_ALREADY_RECORDED',
  INPUT_INVALID: 'M5_PRIVACY_INPUT_INVALID',
  ROTATION_ALREADY_RECORDED: 'M5_PRIVACY_ROTATION_ALREADY_RECORDED',
  STORAGE_FAILURE: 'M5_PRIVACY_STORAGE_FAILURE',
  WRITER_AUTHORITY_REQUIRED: 'M5_PRIVACY_WRITER_AUTHORITY_REQUIRED',
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

function requireActor(subject) {
  if (
    subject?.actorType !== 'user'
    || typeof subject.actorId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(subject.actorId)
  ) fail(M5PrivacyAuthorityErrorCode.AUTH_REQUIRED, 'Authenticated user authority is required');
  return subject.actorId;
}

function requireCompletedAt(value, now) {
  if (!Number.isSafeInteger(value) || value < 1 || value > now) {
    fail(M5PrivacyAuthorityErrorCode.INPUT_INVALID, 'completedAtMs must not be in the future');
  }
  return value;
}

function parseStored(raw, validator, label) {
  try {
    const value = JSON.parse(raw);
    const validation = validator(value);
    if (!validation.valid || canonicalizeM5PrivacyValue(value) !== raw) throw new Error();
    return Object.freeze({ ...value, actor: Object.freeze({ ...value.actor }) });
  } catch {
    fail(M5PrivacyAuthorityErrorCode.STORAGE_FAILURE, `Stored ${label} is invalid`);
  }
}

function storageFailure(error) {
  if (error instanceof M5PrivacyAuthorityError) throw error;
  fail(M5PrivacyAuthorityErrorCode.STORAGE_FAILURE, 'Privacy authority storage failed');
}

export class M5PrivacyAuthorityRepository {
  constructor(database, { clock = Date.now, isAuthenticatedTransportSubject } = {}) {
    if (!database || typeof database.prepare !== 'function' || typeof database.transaction !== 'function') {
      throw new TypeError('m5-privacy-authority:database-required');
    }
    if (typeof clock !== 'function') throw new TypeError('m5-privacy-authority:clock-required');
    if (typeof isAuthenticatedTransportSubject !== 'function') {
      throw new TypeError('m5-privacy-authority:transport-subject-verifier-required');
    }
    this.database = database;
    this.clock = clock;
    this.isAuthenticatedTransportSubject = isAuthenticatedTransportSubject;
    registerM5PrivacyAuthorityFunctions(database, isAuthenticatedTransportSubject);
  }

  #now() {
    const now = this.clock();
    if (!Number.isSafeInteger(now) || now < 1) {
      fail(M5PrivacyAuthorityErrorCode.INPUT_INVALID, 'Privacy authority clock is invalid');
    }
    return now;
  }

  recordRotation({ authenticatedSubject, categoryId, authorityKind, completedAtMs }) {
    const actorId = requireActor(authenticatedSubject);
    const expectedAuthority = expectedM5PrivacyAuthorityKind(categoryId);
    if (expectedAuthority === null || authorityKind !== expectedAuthority) {
      fail(M5PrivacyAuthorityErrorCode.INPUT_INVALID, 'Rotation category or authority kind is invalid');
    }
    const attestedAtMs = this.#now();
    requireCompletedAt(completedAtMs, attestedAtMs);
    let receipt;
    try {
      receipt = createM5PrivacyRotationReceipt({
        categoryId,
        authorityKind,
        completedAtMs,
        attestedAtMs,
        actorId,
      });
    } catch {
      fail(M5PrivacyAuthorityErrorCode.INPUT_INVALID, 'Rotation attestation is invalid');
    }
    try {
      const recordJson = canonicalizeM5PrivacyValue(receipt);
      const write = this.database.transaction(() => {
        const existing = this.database.prepare(`
          SELECT record_json FROM m5_privacy_rotation_receipts
          WHERE incident_id = ? AND category_id = ?
        `).get(M5_PRIVACY_INCIDENT_ID, categoryId);
        if (existing) fail(
          M5PrivacyAuthorityErrorCode.ROTATION_ALREADY_RECORDED,
          'Rotation category already has an append-only receipt',
        );
        return withM5PrivacyReceiptWriterAuthority(
          this.database,
          authenticatedSubject,
          { receiptId: receipt.receiptId, recordJson },
          () => this.database.prepare(`
            INSERT INTO m5_privacy_rotation_receipts (
              receipt_id, incident_id, category_id, completed_at_ms,
              attested_at_ms, actor_id, record_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            receipt.receiptId,
            receipt.incidentId,
            receipt.categoryId,
            receipt.completedAtMs,
            receipt.attestedAtMs,
            receipt.actor.actorId,
            recordJson,
          ),
        );
      });
      write();
      return receipt;
    } catch (error) {
      if (error?.message === 'm5-privacy-authority:authenticated-transport-subject-required') {
        fail(
          M5PrivacyAuthorityErrorCode.WRITER_AUTHORITY_REQUIRED,
          'Transport writer authority is required',
        );
      }
      storageFailure(error);
    }
  }

  recordHistory({
    authenticatedSubject,
    decision,
    actionStatus,
    repositoryVisibility,
    completedAtMs,
  }) {
    const actorId = requireActor(authenticatedSubject);
    const attestedAtMs = this.#now();
    requireCompletedAt(completedAtMs, attestedAtMs);
    let receipt;
    try {
      receipt = createM5PrivacyHistoryReceipt({
        decision,
        actionStatus,
        repositoryVisibility,
        completedAtMs,
        attestedAtMs,
        actorId,
      });
    } catch {
      fail(M5PrivacyAuthorityErrorCode.INPUT_INVALID, 'History attestation is invalid');
    }
    try {
      const recordJson = canonicalizeM5PrivacyValue(receipt);
      const write = this.database.transaction(() => {
        const existing = this.database.prepare(`
          SELECT record_json FROM m5_privacy_history_receipts WHERE incident_id = ?
        `).get(M5_PRIVACY_INCIDENT_ID);
        if (existing) fail(
          M5PrivacyAuthorityErrorCode.HISTORY_ALREADY_RECORDED,
          'History disposition already has an append-only receipt',
        );
        return withM5PrivacyReceiptWriterAuthority(
          this.database,
          authenticatedSubject,
          { receiptId: receipt.receiptId, recordJson },
          () => this.database.prepare(`
            INSERT INTO m5_privacy_history_receipts (
              receipt_id, incident_id, decision, action_status,
              repository_visibility, completed_at_ms, attested_at_ms,
              actor_id, record_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            receipt.receiptId,
            receipt.incidentId,
            receipt.decision,
            receipt.actionStatus,
            receipt.repositoryVisibility,
            receipt.completedAtMs,
            receipt.attestedAtMs,
            receipt.actor.actorId,
            recordJson,
          ),
        );
      });
      write();
      return receipt;
    } catch (error) {
      if (error?.message === 'm5-privacy-authority:authenticated-transport-subject-required') {
        fail(
          M5PrivacyAuthorityErrorCode.WRITER_AUTHORITY_REQUIRED,
          'Transport writer authority is required',
        );
      }
      storageFailure(error);
    }
  }

  summary() {
    try {
      const rotations = this.database.prepare(`
        SELECT record_json FROM m5_privacy_rotation_receipts
        WHERE incident_id = ? ORDER BY category_id
      `).all(M5_PRIVACY_INCIDENT_ID).map(row => (
        parseStored(row.record_json, validateM5PrivacyRotationReceipt, 'rotation receipt')
      ));
      const historyRow = this.database.prepare(`
        SELECT record_json FROM m5_privacy_history_receipts WHERE incident_id = ?
      `).get(M5_PRIVACY_INCIDENT_ID);
      const history = historyRow
        ? parseStored(historyRow.record_json, validateM5PrivacyHistoryReceipt, 'history receipt')
        : null;
      const completed = new Set(rotations.map(receipt => receipt.categoryId));
      const missingCategoryIds = M5_PRIVACY_ROTATION_CATEGORIES
        .map(category => category.categoryId)
        .filter(categoryId => !completed.has(categoryId));
      return Object.freeze({
        contract: M5_PRIVACY_KIND.REMEDIATION_STATUS,
        version: 1,
        incidentId: M5_PRIVACY_INCIDENT_ID,
        rotationRequired: M5_PRIVACY_ROTATION_CATEGORIES.length,
        rotationCompleted: rotations.length,
        missingCategoryIds: Object.freeze(missingCategoryIds),
        rotations: Object.freeze(rotations),
        historyDisposition: history,
        secretValuesRecorded: false,
        verdict: missingCategoryIds.length === 0 && history
          ? 'OPERATOR_REMEDIATION_RECORDED'
          : 'INCOMPLETE',
      });
    } catch (error) {
      storageFailure(error);
    }
  }
}

export default M5PrivacyAuthorityRepository;
