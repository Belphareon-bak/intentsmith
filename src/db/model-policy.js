// IntentSmith model automation policy authority.
//
// This repository is deliberately separate from the legacy user_settings JSON
// document.  One append-only event and the singleton projection move in the
// same BEGIN IMMEDIATE transaction; every reader re-joins both records before
// it can treat the policy as valid.

import { randomUUID } from 'node:crypto';
import {
  SETTINGS_BACKUP_KIND,
  SETTINGS_BACKUP_SCHEMA_VERSION,
  SETTINGS_PORTABLE_PATHS,
  SettingsPortabilityError,
  createSettingsBackup,
  parseSettingsBackup,
} from './settings-portability.js';
import {
  UserSettingsError,
  createUserSettingsRepository,
  projectPublicUserSettings,
} from './user-settings.js';
import { getModelFailoverMeasurementContract } from '../upgrade/model-failover-proof-policy.js';
import {
  canonicalModelName,
  normalizeModelDigestSha256,
} from '../upgrade/model-identity.js';

export const ModelAutomationPolicyStatus = Object.freeze({
  VALID: 'VALID',
  INVALID: 'INVALID',
  DB_ERROR: 'DB_ERROR',
});

export const DEFAULT_MODEL_AUTOMATION_POLICY = Object.freeze({
  autoFailoverEnabled: false,
  autoCleanupEnabled: false,
  autoCleanupDays: 14,
});

const INPUT_KEYS = Object.freeze([
  'expectedRevision',
  'autoFailoverEnabled',
  'autoCleanupEnabled',
  'autoCleanupDays',
]);
const INPUT_KEY_SET = new Set(INPUT_KEYS);
export const MODEL_AUTOMATION_POLICY_GENERIC_KEYS = Object.freeze([
  'autoFailoverEnabled',
  'autoCleanupEnabled',
  'autoCleanupDays',
]);
export const MODEL_SETTINGS_BACKUP_KIND = SETTINGS_BACKUP_KIND;
export const MODEL_SETTINGS_BACKUP_SCHEMA_VERSION = SETTINGS_BACKUP_SCHEMA_VERSION;
export const MODEL_SETTINGS_PORTABLE_PATHS = SETTINGS_PORTABLE_PATHS;
const POLICY_SETTINGS_KEYS = Object.freeze([
  'autoFailoverEnabled',
  'autoCleanupEnabled',
  'autoCleanupDays',
]);
const POLICY_SETTINGS_KEY_SET = new Set(POLICY_SETTINGS_KEYS);
const SETTINGS_IMPORT_REQUEST_KEYS = Object.freeze(['backup', 'expectedRevision']);
const GLOBAL_SETTINGS_RESET_KEYS = Object.freeze([
  'expectedPolicyRevision',
  'expectedRevision',
  'scope',
]);
const GLOBAL_SETTINGS_RESET_SCOPE = 'SERVER_SETTINGS_V1';
export const MODEL_FAILOVER_TARGET_ROLES = Object.freeze([
  'D1',
  'D2',
  'CODE',
  'R1',
  'R2',
  'CHAT',
  'VISION',
]);
const MODEL_FAILOVER_TARGET_ROLE_SET = new Set(MODEL_FAILOVER_TARGET_ROLES);
const TARGET_SET_KEYS = Object.freeze(['expectedRevision', 'role', 'target']);
const TARGET_CLEAR_KEYS = Object.freeze(['expectedRevision', 'role']);
const TARGET_VALUE_KEYS = Object.freeze([
  'canonicalName',
  'digestSha256',
  'requestedName',
]);
const TARGET_INVENTORY_KEYS = Object.freeze([
  'canonicalName',
  'digestSha256',
  'name',
]);

const DEFAULT_IDS = Object.freeze({
  event: () => `policy-event-${randomUUID()}`,
  request: () => `policy-request-${randomUUID()}`,
});

export class ModelAutomationPolicyError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'ModelAutomationPolicyError';
    this.code = code;
    this.details = options.details || null;
  }
}

export const ModelFailoverTargetStatus = Object.freeze({
  VALID: 'VALID',
  INVALID: 'INVALID',
  DB_ERROR: 'DB_ERROR',
});

function fail(code, message, details = null) {
  throw new ModelAutomationPolicyError(code, message, { details });
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireExactObjectKeys(value, expectedKeys, code, label) {
  if (!isPlainObject(value)) fail(code, `${label} must be a plain object`);
  const ownKeys = Reflect.ownKeys(value);
  const keys = ownKeys.filter(key => typeof key === 'string').sort();
  if (ownKeys.length !== expectedKeys.length
    || keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])) {
    fail(code, `${label} has an invalid field set`, {
      expected: expectedKeys,
      actual: keys,
    });
  }
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
      fail(code, `${label} fields must be enumerable data properties`);
    }
  }
  return value;
}

function requireTargetRole(value) {
  if (typeof value !== 'string') {
    fail('MODEL_FAILOVER_TARGET_ROLE_INVALID', 'Target role must be a string');
  }
  const role = value.trim().toUpperCase();
  if (!MODEL_FAILOVER_TARGET_ROLE_SET.has(role)) {
    fail('MODEL_FAILOVER_TARGET_ROLE_INVALID', 'Unknown target role', { role });
  }
  return role;
}

function requireTargetRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(
      'MODEL_FAILOVER_TARGET_REVISION_INVALID',
      'Target expectedRevision must be a non-negative safe integer',
    );
  }
  return value;
}

function requireTargetName(value, field) {
  if (typeof value !== 'string'
    || value !== value.trim()
    || value.length < 1
    || value.length > 255) {
    fail('MODEL_FAILOVER_TARGET_IDENTITY_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function requireTargetDigest(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    fail(
      'MODEL_FAILOVER_TARGET_DIGEST_INVALID',
      'Target digestSha256 must be exact lowercase 64hex',
    );
  }
  return value;
}

function requireTargetValue(value) {
  requireExactObjectKeys(
    value,
    TARGET_VALUE_KEYS,
    'MODEL_FAILOVER_TARGET_INPUT_SHAPE_INVALID',
    'Target identity',
  );
  const requestedName = requireTargetName(value.requestedName, 'requestedName');
  const canonicalName = requireTargetName(value.canonicalName, 'canonicalName');
  const derivedCanonicalName = canonicalModelName(requestedName);
  if (canonicalName !== derivedCanonicalName) {
    fail(
      'MODEL_FAILOVER_TARGET_CANONICAL_MISMATCH',
      'Target canonicalName does not match requestedName',
      { requestedName, canonicalName, derivedCanonicalName },
    );
  }
  return {
    requestedName,
    canonicalName,
    digestSha256: requireTargetDigest(value.digestSha256),
  };
}

function requireTargetSetInput(value) {
  requireExactObjectKeys(
    value,
    TARGET_SET_KEYS,
    'MODEL_FAILOVER_TARGET_INPUT_SHAPE_INVALID',
    'Target set request',
  );
  return {
    role: requireTargetRole(value.role),
    expectedRevision: requireTargetRevision(value.expectedRevision),
    target: requireTargetValue(value.target),
  };
}

function requireTargetClearInput(value) {
  requireExactObjectKeys(
    value,
    TARGET_CLEAR_KEYS,
    'MODEL_FAILOVER_TARGET_INPUT_SHAPE_INVALID',
    'Target clear request',
  );
  return {
    role: requireTargetRole(value.role),
    expectedRevision: requireTargetRevision(value.expectedRevision),
  };
}

function requireTargetInventory(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(
      'MODEL_FAILOVER_TARGET_INVENTORY_INVALID',
      'Installed model inventory must be a non-empty array',
    );
  }
  const canonicalNames = new Set();
  return value.map((item, index) => {
    requireExactObjectKeys(
      item,
      TARGET_INVENTORY_KEYS,
      'MODEL_FAILOVER_TARGET_INVENTORY_INVALID',
      `Installed model inventory row ${index}`,
    );
    const name = requireTargetName(item.name, `inventory[${index}].name`);
    const canonicalName = requireTargetName(
      item.canonicalName,
      `inventory[${index}].canonicalName`,
    );
    if (canonicalModelName(name) !== canonicalName || canonicalNames.has(canonicalName)) {
      fail(
        'MODEL_FAILOVER_TARGET_INVENTORY_AMBIGUOUS',
        'Installed inventory has a missing, duplicate or mismatched canonical identity',
        { index, name, canonicalName },
      );
    }
    canonicalNames.add(canonicalName);
    return {
      name,
      canonicalName,
      digestSha256: normalizeModelDigestSha256(item.digestSha256) || fail(
        'MODEL_FAILOVER_TARGET_INVENTORY_INVALID',
        `inventory[${index}].digestSha256 is invalid`,
      ),
    };
  });
}

export function createModelFailoverTargetInventoryReader(inventoryValue) {
  const inventory = requireTargetInventory(inventoryValue).map(item => Object.freeze(item));
  const reader = targetValue => {
    const target = requireTargetValue(targetValue);
    const matches = inventory.filter(item => item.canonicalName === target.canonicalName);
    if (matches.length === 0) {
      fail(
        'MODEL_FAILOVER_TARGET_NOT_INSTALLED',
        'Target canonical identity is not installed locally',
        { canonicalName: target.canonicalName },
      );
    }
    if (matches.length !== 1) {
      fail(
        'MODEL_FAILOVER_TARGET_INVENTORY_AMBIGUOUS',
        'Installed target identity is ambiguous',
        { canonicalName: target.canonicalName },
      );
    }
    return Object.freeze({ ...matches[0] });
  };
  return Object.freeze(reader);
}

function cloneJsonDocument(
  value,
  errorCode = 'MODEL_AUTOMATION_POLICY_BACKUP_GENERAL_SETTINGS_INVALID',
) {
  if (!isPlainObject(value)) {
    fail(
      errorCode,
      'Backup generalSettings must be a plain object',
    );
  }
  let encoded;
  try {
    encoded = JSON.stringify(value, (_key, current) => {
      if (typeof current === 'number' && !Number.isFinite(current)) {
        throw new TypeError('non-finite number');
      }
      if (['bigint', 'function', 'symbol', 'undefined'].includes(typeof current)) {
        throw new TypeError(`unsupported ${typeof current}`);
      }
      if (current !== null
        && typeof current === 'object'
        && !Array.isArray(current)
        && !isPlainObject(current)) {
        throw new TypeError('non-plain object');
      }
      return current;
    });
  } catch (error) {
    throw new ModelAutomationPolicyError(
      errorCode,
      'Backup generalSettings must be finite JSON data',
      { cause: error },
    );
  }
  if (typeof encoded !== 'string') {
    fail(
      errorCode,
      'Backup generalSettings cannot be serialized',
    );
  }
  return { document: JSON.parse(encoded), encoded };
}

function readStoredGeneralSettings(db) {
  try {
    return createUserSettingsRepository(db).readImportSnapshotInTransaction();
  } catch (error) {
    if (error instanceof UserSettingsError) {
      throw new ModelAutomationPolicyError(
        'MODEL_AUTOMATION_POLICY_STORED_GENERAL_SETTINGS_INVALID',
        'Stored general settings do not satisfy the versioned authority',
        { cause: error, details: { settingsCode: error.code } },
      );
    }
    throw new ModelAutomationPolicyError(
      'MODEL_AUTOMATION_POLICY_STORED_GENERAL_SETTINGS_INVALID',
      'Stored general settings cannot be read',
      { cause: error },
    );
  }
}

function requirePolicySettings(value) {
  if (value === null) return null;
  if (!isPlainObject(value)) {
    fail(
      'MODEL_AUTOMATION_POLICY_BACKUP_POLICY_INVALID',
      'Backup modelAutomationPolicy must be an object or null',
    );
  }
  const unknown = Object.keys(value).filter(key => !POLICY_SETTINGS_KEY_SET.has(key));
  const missing = POLICY_SETTINGS_KEYS.filter(key => !Object.hasOwn(value, key));
  if (unknown.length > 0 || missing.length > 0) {
    fail(
      'MODEL_AUTOMATION_POLICY_BACKUP_POLICY_INVALID',
      'Backup modelAutomationPolicy must contain the exact settings fields',
      { unknown: unknown.sort(), missing },
    );
  }
  return requireExactInput({ expectedRevision: 1, ...value }).settings;
}

function requireBackupEnvelope(value) {
  let parsed;
  try {
    parsed = parseSettingsBackup(value);
  } catch (error) {
    if (error instanceof SettingsPortabilityError) {
      const versionError = error.code === 'SETTINGS_PORTABILITY_BACKUP_VERSION_UNSUPPORTED'
        || error.code === 'SETTINGS_PORTABILITY_PROFILE_UNSUPPORTED';
      throw new ModelAutomationPolicyError(
        versionError
          ? 'MODEL_AUTOMATION_POLICY_BACKUP_VERSION_UNSUPPORTED'
          : 'MODEL_AUTOMATION_POLICY_BACKUP_INPUT_INVALID',
        error.message,
        { cause: error, details: error.details },
      );
    }
    throw error;
  }
  return {
    sourceSchemaVersion: parsed.sourceSchemaVersion,
    portableValues: parsed.values,
    ignoredSourcePaths: parsed.ignoredSourcePaths,
    policySettings: requirePolicySettings(parsed.modelAutomationPolicy),
  };
}

function requireSettingsImportRequest(value) {
  if (!isPlainObject(value)) {
    fail(
      'MODEL_AUTOMATION_POLICY_BACKUP_INPUT_INVALID',
      'Settings import request must be a plain object',
    );
  }
  const actualKeys = Object.keys(value).sort();
  if (actualKeys.length !== SETTINGS_IMPORT_REQUEST_KEYS.length
    || actualKeys.some((key, index) => key !== SETTINGS_IMPORT_REQUEST_KEYS[index])) {
    fail(
      'MODEL_AUTOMATION_POLICY_BACKUP_INPUT_INVALID',
      'Settings import request must contain exact backup and expectedRevision fields',
    );
  }
  if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1) {
    fail(
      'USER_SETTINGS_EXPECTED_REVISION_INVALID',
      'Settings import expectedRevision must be a positive safe integer',
    );
  }
  return {
    expectedRevision: value.expectedRevision,
    backup: requireBackupEnvelope(value.backup),
  };
}

function requireGlobalSettingsResetRequest(value) {
  if (!isPlainObject(value)) {
    fail('SETTINGS_RESET_INPUT_INVALID', 'Settings reset request must be a plain object');
  }
  const ownKeys = Reflect.ownKeys(value);
  const actualKeys = ownKeys.filter(key => typeof key === 'string').sort();
  if (ownKeys.length !== GLOBAL_SETTINGS_RESET_KEYS.length
    || actualKeys.length !== GLOBAL_SETTINGS_RESET_KEYS.length
    || actualKeys.some((key, index) => key !== GLOBAL_SETTINGS_RESET_KEYS[index])) {
    fail(
      'SETTINGS_RESET_INPUT_INVALID',
      'Settings reset request must contain the exact scope and dual revisions',
    );
  }
  for (const key in value) {
    if (!Object.hasOwn(value, key)) {
      fail('SETTINGS_RESET_INPUT_INVALID', 'Settings reset request cannot inherit fields');
    }
  }
  for (const key of GLOBAL_SETTINGS_RESET_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
      fail('SETTINGS_RESET_INPUT_INVALID', 'Settings reset fields must be enumerable data properties');
    }
  }
  if (value.scope !== GLOBAL_SETTINGS_RESET_SCOPE
    || !Number.isSafeInteger(value.expectedRevision)
    || value.expectedRevision < 1
    || !Number.isSafeInteger(value.expectedPolicyRevision)
    || value.expectedPolicyRevision < 1) {
    fail('SETTINGS_RESET_INPUT_INVALID', 'Settings reset scope or revisions are invalid');
  }
  return {
    scope: GLOBAL_SETTINGS_RESET_SCOPE,
    expectedRevision: value.expectedRevision,
    expectedPolicyRevision: value.expectedPolicyRevision,
  };
}

/**
 * Strip only model-automation keys from the legacy whole-document settings
 * surface. The generic route retains every unrelated and future model key but
 * can neither activate nor overwrite the versioned policy authority.
 */
export function sanitizeGenericModelAutomationSettings(document) {
  if (!isPlainObject(document) || !isPlainObject(document.models)) {
    return { document, ignoredReservedKeys: [] };
  }

  const ignoredReservedKeys = MODEL_AUTOMATION_POLICY_GENERIC_KEYS.filter(
    key => Object.hasOwn(document.models, key),
  );
  if (ignoredReservedKeys.length === 0) {
    return { document, ignoredReservedKeys };
  }

  const models = { ...document.models };
  for (const key of ignoredReservedKeys) delete models[key];
  return {
    document: { ...document, models },
    ignoredReservedKeys,
  };
}

function requireDatabase(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    fail('MODEL_AUTOMATION_POLICY_DB_INVALID', 'A better-sqlite3 database is required');
  }
  return db;
}

function requireExactInput(value) {
  if (!isPlainObject(value)) {
    fail('MODEL_AUTOMATION_POLICY_INPUT_INVALID', 'Policy update must be a plain object');
  }
  const unknown = Object.keys(value).filter(key => !INPUT_KEY_SET.has(key));
  const missing = INPUT_KEYS.filter(key => !Object.hasOwn(value, key));
  if (unknown.length > 0 || missing.length > 0) {
    fail(
      'MODEL_AUTOMATION_POLICY_INPUT_SHAPE_INVALID',
      'Policy update must contain the exact expected-revision and settings fields',
      { unknown: unknown.sort(), missing },
    );
  }
  if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1) {
    fail(
      'MODEL_AUTOMATION_POLICY_REVISION_INVALID',
      'expectedRevision must be a positive safe integer',
    );
  }
  if (typeof value.autoFailoverEnabled !== 'boolean') {
    fail(
      'MODEL_AUTOMATION_POLICY_AUTO_FAILOVER_INVALID',
      'autoFailoverEnabled must be a boolean',
    );
  }
  if (typeof value.autoCleanupEnabled !== 'boolean') {
    fail(
      'MODEL_AUTOMATION_POLICY_AUTO_CLEANUP_INVALID',
      'autoCleanupEnabled must be a boolean',
    );
  }
  if (!Number.isSafeInteger(value.autoCleanupDays)
    || value.autoCleanupDays < 1
    || value.autoCleanupDays > 3650) {
    fail(
      'MODEL_AUTOMATION_POLICY_CLEANUP_DAYS_INVALID',
      'autoCleanupDays must be an integer between 1 and 3650',
    );
  }
  return {
    expectedRevision: value.expectedRevision,
    settings: {
      autoFailoverEnabled: value.autoFailoverEnabled,
      autoCleanupEnabled: value.autoCleanupEnabled,
      autoCleanupDays: value.autoCleanupDays,
    },
  };
}

function mapConsistentRow(row) {
  if (!row) return null;
  const integerFields = [
    'schema_version',
    'revision',
    'auto_failover_enabled',
    'auto_cleanup_enabled',
    'auto_cleanup_days',
    'event_schema_version',
    'event_previous_revision',
    'event_committed_revision',
    'event_after_auto_failover_enabled',
    'event_after_auto_cleanup_enabled',
    'event_after_auto_cleanup_days',
    'updated_at_ms',
    'event_created_at_ms',
  ];
  if (integerFields.some(field => !Number.isSafeInteger(row[field]))) return null;
  if (row.schema_version !== 1 || row.event_schema_version !== 1) return null;
  if (row.id !== 1 || row.revision < 1) return null;
  if (row.event_previous_revision !== row.revision - 1) return null;
  if (row.event_committed_revision !== row.revision) return null;
  if (row.auto_failover_enabled !== row.event_after_auto_failover_enabled) return null;
  if (row.auto_cleanup_enabled !== row.event_after_auto_cleanup_enabled) return null;
  if (row.auto_cleanup_days !== row.event_after_auto_cleanup_days) return null;
  if (row.updated_at_ms !== row.event_created_at_ms) return null;
  if (![0, 1].includes(row.auto_failover_enabled)) return null;
  if (![0, 1].includes(row.auto_cleanup_enabled)) return null;
  if (row.auto_cleanup_days < 1 || row.auto_cleanup_days > 3650) return null;
  if (typeof row.last_event_id !== 'string' || row.last_event_id.length < 16) return null;
  if (row.last_event_id !== row.event_id) return null;
  return {
    status: ModelAutomationPolicyStatus.VALID,
    valid: true,
    schemaVersion: 1,
    revision: row.revision,
    settings: {
      autoFailoverEnabled: row.auto_failover_enabled === 1,
      autoCleanupEnabled: row.auto_cleanup_enabled === 1,
      autoCleanupDays: row.auto_cleanup_days,
    },
    lastEventId: row.last_event_id,
    updatedAtMs: row.updated_at_ms,
    reason: null,
  };
}

function invalidPolicy(reason, status = ModelAutomationPolicyStatus.INVALID) {
  return {
    status,
    valid: false,
    schemaVersion: 1,
    revision: 0,
    settings: { ...DEFAULT_MODEL_AUTOMATION_POLICY },
    lastEventId: null,
    updatedAtMs: null,
    reason,
  };
}

function selectConsistentPolicy(db) {
  return db.prepare(`
    SELECT
      policy.id,
      policy.schema_version,
      policy.revision,
      policy.auto_failover_enabled,
      policy.auto_cleanup_enabled,
      policy.auto_cleanup_days,
      policy.last_event_id,
      policy.updated_at_ms,
      event.event_id,
      event.schema_version AS event_schema_version,
      event.previous_revision AS event_previous_revision,
      event.committed_revision AS event_committed_revision,
      event.after_auto_failover_enabled AS event_after_auto_failover_enabled,
      event.after_auto_cleanup_enabled AS event_after_auto_cleanup_enabled,
      event.after_auto_cleanup_days AS event_after_auto_cleanup_days,
      event.created_at_ms AS event_created_at_ms
    FROM model_automation_policy policy
    LEFT JOIN model_automation_policy_events event
      ON event.event_id = policy.last_event_id
    WHERE policy.id = 1
  `).get();
}

/**
 * Fail-closed read used by both runtime policy consumers.  Storage corruption
 * and DB failures are data, not exceptions, so schedulers cannot accidentally
 * turn an unreadable policy into an opt-in.
 */
export function readModelAutomationPolicy(db) {
  try {
    requireDatabase(db);
    const policy = mapConsistentRow(selectConsistentPolicy(db));
    return policy || invalidPolicy('MODEL_AUTOMATION_POLICY_PROJECTION_INVALID');
  } catch (_) {
    return invalidPolicy(
      'MODEL_AUTOMATION_POLICY_DB_READ_FAILED',
      ModelAutomationPolicyStatus.DB_ERROR,
    );
  }
}

function selectTargetProjection(db, role) {
  return db.prepare(`
    SELECT
      target.role,
      target.schema_version,
      target.revision,
      target.requested_name,
      target.canonical_name,
      target.digest_sha256,
      target.actor,
      target.authority_source,
      target.last_target_event_id,
      target.last_policy_event_id,
      target.updated_at_ms,
      target_event.event_id AS target_event_id,
      target_event.schema_version AS target_event_schema_version,
      target_event.role AS target_event_role,
      target_event.committed_revision AS target_event_committed_revision,
      target_event.actor AS target_event_actor,
      target_event.after_requested_name AS target_event_after_requested_name,
      target_event.after_canonical_name AS target_event_after_canonical_name,
      target_event.after_digest_sha256 AS target_event_after_digest_sha256,
      target_event.created_at_ms AS target_event_created_at_ms,
      reset_event.event_id AS reset_event_id,
      reset_event.event_kind AS reset_event_kind,
      reset_event.actor AS reset_event_actor,
      reset_event.source AS reset_event_source,
      reset_event.created_at_ms AS reset_event_created_at_ms
    FROM model_failover_targets target
    LEFT JOIN model_failover_target_events target_event
      ON target_event.event_id = target.last_target_event_id
    LEFT JOIN model_automation_policy_events reset_event
      ON reset_event.event_id = target.last_policy_event_id
    WHERE target.role = ?
  `).get(role);
}

function mapTargetProjection(row) {
  if (!row
    || !MODEL_FAILOVER_TARGET_ROLE_SET.has(row.role)
    || row.schema_version !== 1
    || !Number.isSafeInteger(row.revision)
    || row.revision < 0
    || !Number.isSafeInteger(row.updated_at_ms)
    || row.updated_at_ms < 1) {
    return null;
  }
  const isClear = row.requested_name === null
    && row.canonical_name === null
    && row.digest_sha256 === null;
  const isTarget = typeof row.requested_name === 'string'
    && row.requested_name.length >= 1
    && row.requested_name.length <= 255
    && typeof row.canonical_name === 'string'
    && row.canonical_name === canonicalModelName(row.requested_name)
    && /^[0-9a-f]{64}$/.test(row.digest_sha256);
  if (!isClear && !isTarget) return null;

  let lastEventId = null;
  let resetEventId = null;
  if (row.authority_source === 'MIGRATION') {
    if (row.revision !== 0
      || row.actor !== 'system:migration-065'
      || !isClear
      || row.last_target_event_id !== null
      || row.last_policy_event_id !== null) return null;
  } else if (row.authority_source === 'TARGET_EVENT') {
    if (row.revision < 1
      || row.actor !== 'operator:model-failover-target-cli'
      || row.last_policy_event_id !== null
      || row.last_target_event_id !== row.target_event_id
      || row.target_event_schema_version !== 1
      || row.target_event_role !== row.role
      || row.target_event_committed_revision !== row.revision
      || row.target_event_actor !== row.actor
      || row.target_event_after_requested_name !== row.requested_name
      || row.target_event_after_canonical_name !== row.canonical_name
      || row.target_event_after_digest_sha256 !== row.digest_sha256
      || row.target_event_created_at_ms !== row.updated_at_ms) return null;
    lastEventId = row.last_target_event_id;
  } else if (row.authority_source === 'GLOBAL_RESET') {
    if (row.revision < 1
      || row.actor !== 'user:global-reset'
      || !isClear
      || row.last_target_event_id !== null
      || row.last_policy_event_id !== row.reset_event_id
      || row.reset_event_kind !== 'GLOBAL_RESET'
      || row.reset_event_actor !== row.actor
      || row.reset_event_source !== 'GLOBAL_RESET'
      || row.reset_event_created_at_ms !== row.updated_at_ms) return null;
    resetEventId = row.last_policy_event_id;
  } else {
    return null;
  }

  return {
    status: ModelFailoverTargetStatus.VALID,
    valid: true,
    schemaVersion: 1,
    role: row.role,
    revision: row.revision,
    target: isTarget ? {
      requestedName: row.requested_name,
      canonicalName: row.canonical_name,
      digestSha256: row.digest_sha256,
    } : null,
    actor: row.actor,
    authoritySource: row.authority_source,
    lastEventId,
    resetEventId,
    updatedAtMs: row.updated_at_ms,
    reason: null,
  };
}

function invalidTarget(role, reason, status = ModelFailoverTargetStatus.INVALID) {
  return {
    status,
    valid: false,
    schemaVersion: 1,
    role,
    revision: 0,
    target: null,
    actor: null,
    authoritySource: null,
    lastEventId: null,
    resetEventId: null,
    updatedAtMs: null,
    reason,
  };
}

export function readModelFailoverTarget(db, roleValue) {
  let role;
  try {
    requireDatabase(db);
    role = requireTargetRole(roleValue);
    return mapTargetProjection(selectTargetProjection(db, role))
      || invalidTarget(role, 'MODEL_FAILOVER_TARGET_PROJECTION_INVALID');
  } catch (error) {
    if (error instanceof ModelAutomationPolicyError
      && error.code === 'MODEL_FAILOVER_TARGET_ROLE_INVALID') throw error;
    return invalidTarget(
      role ?? null,
      'MODEL_FAILOVER_TARGET_DB_READ_FAILED',
      ModelFailoverTargetStatus.DB_ERROR,
    );
  }
}

export function readModelFailoverTargets(db) {
  requireDatabase(db);
  return MODEL_FAILOVER_TARGET_ROLES.map(role => readModelFailoverTarget(db, role));
}

function selectEligibleTargetProof(
  db,
  role,
  target,
  nowMs,
  policyVersion,
  roleContractSha256,
) {
  return db.prepare(`
    SELECT proof.proof_id, proof.expires_at_ms
    FROM model_failover_proofs proof
    JOIN model_failover_proof_artifacts artifact
      ON artifact.proof_id = proof.proof_id
     AND artifact.validation_run_id = proof.validation_run_id
     AND artifact.role = proof.role
     AND artifact.suite = proof.suite
     AND artifact.role_contract_sha256 = proof.role_contract_sha256
     AND artifact.model_name = proof.model_name
     AND artifact.model_canonical_name = proof.model_canonical_name
     AND artifact.model_digest_sha256 = proof.model_digest_sha256
     AND artifact.validation_version = proof.validation_version
     AND artifact.policy_version = proof.policy_version
     AND artifact.result = proof.result
     AND artifact.expires_at_ms = proof.expires_at_ms
    WHERE proof.role = ?
      AND proof.model_name = ?
      AND proof.model_canonical_name = ?
      AND proof.model_digest_sha256 = ?
      AND proof.policy_version = ?
      AND proof.role_contract_sha256 = ?
      AND proof.result = 'PASS'
      AND proof.completed_at_ms <= ?
      AND proof.expires_at_ms > ?
      AND proof.created_at_ms <= ?
    ORDER BY proof.expires_at_ms DESC, proof.proof_id
    LIMIT 1
  `).get(
    role,
    target.requestedName,
    target.canonicalName,
    target.digestSha256,
    policyVersion,
    roleContractSha256,
    nowMs,
    nowMs,
    nowMs,
  );
}

export class ModelAutomationPolicyRepository {
  constructor(db, options = {}) {
    this.db = requireDatabase(db);
    if (!isPlainObject(options)) {
      fail('MODEL_AUTOMATION_POLICY_OPTIONS_INVALID', 'Repository options must be a plain object');
    }
    this.clock = options.clock ?? Date.now;
    if (typeof this.clock !== 'function') {
      fail('MODEL_AUTOMATION_POLICY_OPTIONS_INVALID', 'Repository clock must be a function');
    }
    this.ids = options.ids ?? DEFAULT_IDS;
    if (!isPlainObject(this.ids)
      || typeof this.ids.event !== 'function'
      || typeof this.ids.request !== 'function') {
      fail('MODEL_AUTOMATION_POLICY_OPTIONS_INVALID', 'Repository ID factories are invalid');
    }
    this.targetInventoryReader = options.targetInventoryReader ?? null;
    if (this.targetInventoryReader !== null
      && (typeof this.targetInventoryReader !== 'function'
        || !Object.isFrozen(this.targetInventoryReader))) {
      fail(
        'MODEL_AUTOMATION_POLICY_OPTIONS_INVALID',
        'Target inventory reader must be a frozen function',
      );
    }
  }

  #now() {
    let value;
    try {
      value = this.clock();
    } catch (error) {
      throw new ModelAutomationPolicyError(
        'MODEL_AUTOMATION_POLICY_CLOCK_FAILED',
        'Policy repository clock failed',
        { cause: error },
      );
    }
    if (!Number.isSafeInteger(value) || value < 1) {
      fail('MODEL_AUTOMATION_POLICY_CLOCK_INVALID', 'Policy repository clock is invalid');
    }
    return value;
  }

  #id(kind) {
    let value;
    try {
      value = this.ids[kind]();
    } catch (error) {
      throw new ModelAutomationPolicyError(
        'MODEL_AUTOMATION_POLICY_ID_FACTORY_FAILED',
        `Policy ${kind} ID factory failed`,
        { cause: error, details: { kind } },
      );
    }
    if (typeof value !== 'string' || value.length < 16 || value.length > 160) {
      fail('MODEL_AUTOMATION_POLICY_ID_INVALID', `Policy ${kind} ID is invalid`, { kind });
    }
    return value;
  }

  #translateWriteError(operation, error) {
    if (error instanceof ModelAutomationPolicyError) throw error;
    if (error instanceof UserSettingsError) {
      if (error.code === 'USER_SETTINGS_REVISION_CONFLICT') {
        throw new ModelAutomationPolicyError(
          'USER_SETTINGS_REVISION_CONFLICT',
          `Policy ${operation} used a stale settings revision`,
          { cause: error, details: error.details },
        );
      }
      throw new ModelAutomationPolicyError(
        'MODEL_AUTOMATION_POLICY_STORAGE_CONTRACT',
        `Policy ${operation} violated the user settings storage contract`,
        { cause: error, details: { settingsCode: error.code } },
      );
    }
    const sqliteCode = typeof error?.code === 'string' ? error.code : null;
    if (sqliteCode?.startsWith('SQLITE_BUSY') || sqliteCode?.startsWith('SQLITE_LOCKED')) {
      throw new ModelAutomationPolicyError(
        'MODEL_AUTOMATION_POLICY_DB_BUSY',
        `Policy ${operation} could not acquire the database`,
        { cause: error, details: { sqliteCode } },
      );
    }
    if (sqliteCode === 'SQLITE_CONSTRAINT_UNIQUE'
      || sqliteCode === 'SQLITE_CONSTRAINT_PRIMARYKEY'
      || (sqliteCode === 'SQLITE_CONSTRAINT_TRIGGER'
        && error.message?.startsWith('MODEL_FAILOVER_TARGET_EVENT_IDENTITY_CONFLICT:'))) {
      const targetOperation = operation.startsWith('TARGET_');
      throw new ModelAutomationPolicyError(
        targetOperation
          ? 'MODEL_FAILOVER_TARGET_ID_CONFLICT'
          : 'MODEL_AUTOMATION_POLICY_ID_CONFLICT',
        targetOperation
          ? `Target ${operation} generated a conflicting identity`
          : `Policy ${operation} generated a conflicting identity`,
        { cause: error, details: { sqliteCode } },
      );
    }
    if (sqliteCode === 'SQLITE_CONSTRAINT_UNIQUE'
      || sqliteCode === 'SQLITE_CONSTRAINT_PRIMARYKEY'
      || (sqliteCode === 'SQLITE_CONSTRAINT_TRIGGER'
        && error.message?.startsWith('MODEL_AUTOMATION_POLICY_EVENT_IDENTITY_CONFLICT:'))) {
      throw new ModelAutomationPolicyError(
        'MODEL_AUTOMATION_POLICY_ID_CONFLICT',
        `Policy ${operation} generated a conflicting identity`,
        { cause: error, details: { sqliteCode } },
      );
    }
    if (sqliteCode?.startsWith('SQLITE_CONSTRAINT')) {
      throw new ModelAutomationPolicyError(
        'MODEL_AUTOMATION_POLICY_STORAGE_CONTRACT',
        `Policy ${operation} violated the storage contract`,
        { cause: error, details: { sqliteCode } },
      );
    }
    throw new ModelAutomationPolicyError(
      'MODEL_AUTOMATION_POLICY_DB_WRITE_FAILED',
      `Policy ${operation} failed`,
      { cause: error },
    );
  }

  #requireTransactionOwnership(operation) {
    if (this.db.inTransaction) {
      fail(
        'MODEL_AUTOMATION_POLICY_TRANSACTION_OWNERSHIP_REQUIRED',
        `Policy ${operation} must own the top-level transaction`,
      );
    }
  }

  #write(operation, callback) {
    this.#requireTransactionOwnership(operation);
    const transaction = this.db.transaction(callback);
    try {
      return transaction.immediate();
    } catch (error) {
      return this.#translateWriteError(operation, error);
    }
  }

  async #readInstalledTarget(target) {
    if (this.targetInventoryReader === null) {
      fail(
        'MODEL_FAILOVER_TARGET_INVENTORY_UNAVAILABLE',
        'Target set requires the trusted local installed-model inventory',
      );
    }
    let installed;
    try {
      installed = await this.targetInventoryReader(Object.freeze({ ...target }));
    } catch (error) {
      if (error instanceof ModelAutomationPolicyError) throw error;
      throw new ModelAutomationPolicyError(
        'MODEL_FAILOVER_TARGET_INVENTORY_UNAVAILABLE',
        'Installed model inventory is unavailable',
        { cause: error },
      );
    }
    requireExactObjectKeys(
      installed,
      TARGET_INVENTORY_KEYS,
      'MODEL_FAILOVER_TARGET_INVENTORY_INVALID',
      'Installed target',
    );
    const match = {
      name: requireTargetName(installed.name, 'installed.name'),
      canonicalName: requireTargetName(installed.canonicalName, 'installed.canonicalName'),
      digestSha256: normalizeModelDigestSha256(installed.digestSha256) || fail(
        'MODEL_FAILOVER_TARGET_INVENTORY_INVALID',
        'installed.digestSha256 is invalid',
      ),
    };
    if (canonicalModelName(match.name) !== match.canonicalName
      || match.name !== target.requestedName
      || match.canonicalName !== target.canonicalName
      || match.digestSha256 !== target.digestSha256) {
      fail(
        'MODEL_FAILOVER_TARGET_INVENTORY_MISMATCH',
        'Installed target does not match the requested exact identity',
        { requested: target, installed: match },
      );
    }
    return match;
  }

  #currentTarget(role) {
    const current = mapTargetProjection(selectTargetProjection(this.db, role));
    if (!current) {
      fail(
        'MODEL_FAILOVER_TARGET_INVALID_STATE',
        'Target projection does not match its authority lineage',
        { role },
      );
    }
    return current;
  }

  #commitTargetChange(input, target, eventKind, createdAtMs, currentValue = null) {
    const current = currentValue ?? this.#currentTarget(input.role);
    if (current.revision !== input.expectedRevision) {
      fail(
        'MODEL_FAILOVER_TARGET_STALE',
        'Target expected revision is stale',
        {
          role: input.role,
          expectedRevision: input.expectedRevision,
          currentRevision: current.revision,
        },
      );
    }
    if (current.revision === Number.MAX_SAFE_INTEGER) {
      fail(
        'MODEL_FAILOVER_TARGET_REVISION_EXHAUSTED',
        'Target revision cannot advance safely',
        { role: input.role, currentRevision: current.revision },
      );
    }

    const eventId = this.#id('event');
    const requestId = this.#id('request');
    const committedRevision = current.revision + 1;
    const updated = this.db.prepare(`
      UPDATE model_failover_targets
      SET revision = ?, requested_name = ?, canonical_name = ?, digest_sha256 = ?,
          actor = 'operator:model-failover-target-cli',
          authority_source = 'TARGET_EVENT', last_target_event_id = ?,
          last_policy_event_id = NULL, updated_at_ms = ?
      WHERE role = ? AND revision = ?
        AND requested_name IS ? AND canonical_name IS ? AND digest_sha256 IS ?
        AND authority_source = ?
        AND last_target_event_id IS ? AND last_policy_event_id IS ?
    `).run(
      committedRevision,
      target?.requestedName ?? null,
      target?.canonicalName ?? null,
      target?.digestSha256 ?? null,
      eventId,
      createdAtMs,
      input.role,
      current.revision,
      current.target?.requestedName ?? null,
      current.target?.canonicalName ?? null,
      current.target?.digestSha256 ?? null,
      current.authoritySource,
      current.lastEventId,
      current.resetEventId,
    );
    if (updated.changes !== 1) {
      fail(
        'MODEL_FAILOVER_TARGET_STALE',
        'Target changed before the projection commit',
        { role: input.role, expectedRevision: input.expectedRevision },
      );
    }

    this.db.prepare(`
      INSERT INTO model_failover_target_events (
        event_id, request_id, role, previous_revision, committed_revision,
        event_kind, actor, before_requested_name, before_canonical_name,
        before_digest_sha256, after_requested_name, after_canonical_name,
        after_digest_sha256, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, 'operator:model-failover-target-cli',
        ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      requestId,
      input.role,
      current.revision,
      committedRevision,
      eventKind,
      current.target?.requestedName ?? null,
      current.target?.canonicalName ?? null,
      current.target?.digestSha256 ?? null,
      target?.requestedName ?? null,
      target?.canonicalName ?? null,
      target?.digestSha256 ?? null,
      createdAtMs,
    );

    const committed = this.#currentTarget(input.role);
    if (committed.revision !== committedRevision || committed.lastEventId !== eventId) {
      fail(
        'MODEL_FAILOVER_TARGET_INVALID_STATE',
        'Committed target does not match its append-only event',
        { role: input.role },
      );
    }
    return {
      ...committed,
      event: {
        eventId,
        requestId,
        eventKind,
        actor: 'operator:model-failover-target-cli',
      },
    };
  }

  #resetTargetsForPolicyEvent(eventId, createdAtMs) {
    for (const role of MODEL_FAILOVER_TARGET_ROLES) {
      const current = this.#currentTarget(role);
      if (current.revision === Number.MAX_SAFE_INTEGER) {
        fail(
          'SETTINGS_RESET_REVISION_EXHAUSTED',
          'Settings reset target revisions cannot advance safely',
          { role, currentTargetRevision: current.revision },
        );
      }
      const updated = this.db.prepare(`
        UPDATE model_failover_targets
        SET revision = ?, requested_name = NULL, canonical_name = NULL,
            digest_sha256 = NULL, actor = 'user:global-reset',
            authority_source = 'GLOBAL_RESET', last_target_event_id = NULL,
            last_policy_event_id = ?, updated_at_ms = ?
        WHERE role = ? AND revision = ?
          AND requested_name IS ? AND canonical_name IS ? AND digest_sha256 IS ?
          AND authority_source = ?
          AND last_target_event_id IS ? AND last_policy_event_id IS ?
      `).run(
        current.revision + 1,
        eventId,
        createdAtMs,
        role,
        current.revision,
        current.target?.requestedName ?? null,
        current.target?.canonicalName ?? null,
        current.target?.digestSha256 ?? null,
        current.authoritySource,
        current.lastEventId,
        current.resetEventId,
      );
      if (updated.changes !== 1) {
        fail(
          'SETTINGS_RESET_REVISION_CONFLICT',
          'A target changed during the global settings reset',
          { role, currentTargetRevision: current.revision },
        );
      }
    }
  }

  #commitValidated(input, authority) {
    const current = mapConsistentRow(selectConsistentPolicy(this.db));
    if (!current) {
      fail(
        'MODEL_AUTOMATION_POLICY_INVALID_STATE',
        'Policy projection does not match its append-only event',
      );
    }
    if (current.revision !== input.expectedRevision) {
      fail(
        'MODEL_AUTOMATION_POLICY_STALE',
        'Policy expected revision is stale',
        { expectedRevision: input.expectedRevision, currentRevision: current.revision },
      );
    }

    const eventId = this.#id('event');
    const requestId = this.#id('request');
    const createdAtMs = this.#now();
    const committedRevision = current.revision + 1;
    const result = this.db.prepare(`
        UPDATE model_automation_policy
        SET revision = ?,
            auto_failover_enabled = ?,
            auto_cleanup_enabled = ?,
            auto_cleanup_days = ?,
            last_event_id = ?,
            updated_at_ms = ?
        WHERE id = 1 AND revision = ? AND last_event_id = ?
    `).run(
      committedRevision,
      input.settings.autoFailoverEnabled ? 1 : 0,
      input.settings.autoCleanupEnabled ? 1 : 0,
      input.settings.autoCleanupDays,
      eventId,
      createdAtMs,
      current.revision,
      current.lastEventId,
    );
    if (result.changes !== 1) {
      fail(
        'MODEL_AUTOMATION_POLICY_STALE',
        'Policy changed before the projection commit',
        { expectedRevision: input.expectedRevision },
      );
    }

    if (authority.eventKind === 'GLOBAL_RESET') {
      this.#resetTargetsForPolicyEvent(eventId, createdAtMs);
    }

    this.db.prepare(`
        INSERT INTO model_automation_policy_events (
          event_id,
          request_id,
          previous_revision,
          committed_revision,
          event_kind,
          actor,
          source,
          before_auto_failover_enabled,
          before_auto_cleanup_enabled,
          before_auto_cleanup_days,
          after_auto_failover_enabled,
          after_auto_cleanup_enabled,
          after_auto_cleanup_days,
          legacy_quarantine_json,
          created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      eventId,
      requestId,
      current.revision,
      committedRevision,
      authority.eventKind,
      authority.actor,
      authority.source,
      current.settings.autoFailoverEnabled ? 1 : 0,
      current.settings.autoCleanupEnabled ? 1 : 0,
      current.settings.autoCleanupDays,
      input.settings.autoFailoverEnabled ? 1 : 0,
      input.settings.autoCleanupEnabled ? 1 : 0,
      input.settings.autoCleanupDays,
      createdAtMs,
    );

    const committed = mapConsistentRow(selectConsistentPolicy(this.db));
    if (!committed || committed.revision !== committedRevision) {
      fail(
        'MODEL_AUTOMATION_POLICY_INVALID_STATE',
        'Committed policy does not match its event',
      );
    }
    return {
      ...committed,
      event: {
        eventId,
        requestId,
        eventKind: authority.eventKind,
        actor: authority.actor,
        source: authority.source,
      },
    };
  }

  #commit(inputValue, authority) {
    const input = requireExactInput(inputValue);
    return this.#write(authority.eventKind, () => {
      return this.#commitValidated(input, authority);
    });
  }

  read() {
    return readModelAutomationPolicy(this.db);
  }

  readTarget(role) {
    return readModelFailoverTarget(this.db, role);
  }

  readTargets() {
    return readModelFailoverTargets(this.db);
  }

  async setTarget(value) {
    const input = requireTargetSetInput(value);
    const installed = Object.freeze({ ...await this.#readInstalledTarget(input.target) });
    return this.#write('TARGET_SET', () => {
      const current = this.#currentTarget(input.role);
      if (current.revision !== input.expectedRevision) {
        fail(
          'MODEL_FAILOVER_TARGET_STALE',
          'Target expected revision is stale',
          {
            role: input.role,
            expectedRevision: input.expectedRevision,
            currentRevision: current.revision,
          },
        );
      }
      if (current.target
        && current.target.requestedName === input.target.requestedName
        && current.target.canonicalName === input.target.canonicalName
        && current.target.digestSha256 === input.target.digestSha256) {
        fail(
          'MODEL_FAILOVER_TARGET_UNCHANGED',
          'Target set must change the exact target identity',
          { role: input.role, revision: current.revision },
        );
      }
      const policy = mapConsistentRow(selectConsistentPolicy(this.db));
      if (!policy) {
        fail(
          'MODEL_FAILOVER_TARGET_POLICY_INVALID',
          'Target set requires a valid model automation policy',
        );
      }
      if (policy.settings.autoFailoverEnabled !== true) {
        fail(
          'MODEL_FAILOVER_TARGET_POLICY_OFF',
          'Target set requires auto failover policy ON',
          { policyRevision: policy.revision },
        );
      }
      const createdAtMs = this.#now();
      const measurementContract = getModelFailoverMeasurementContract(input.role);
      const policyVersion = measurementContract.contract.policyVersion;
      const roleContractSha256 = measurementContract.measurementContractSha256;
      const proof = selectEligibleTargetProof(
        this.db,
        input.role,
        input.target,
        createdAtMs,
        policyVersion,
        roleContractSha256,
      );
      if (!proof) {
        fail(
          'MODEL_FAILOVER_TARGET_PROOF_INELIGIBLE',
          'Target set requires a fresh exact digest-bound proof',
          { role: input.role, target: input.target, policyVersion },
        );
      }
      // Revalidate the frozen result immediately before the CAS.  The later
      // activation path repeats exact inventory/digest validation; no DB lock
      // is held across the provider read.
      if (installed.name !== input.target.requestedName
        || installed.canonicalName !== input.target.canonicalName
        || installed.digestSha256 !== input.target.digestSha256) {
        fail(
          'MODEL_FAILOVER_TARGET_INVENTORY_MISMATCH',
          'Installed target snapshot changed before the target CAS',
        );
      }
      const committed = this.#commitTargetChange(
        input,
        input.target,
        current.target === null ? 'SET' : 'REPLACE',
        createdAtMs,
        current,
      );
      return {
        ...committed,
        eligibility: {
          proofId: proof.proof_id,
          expiresAtMs: proof.expires_at_ms,
          policyRevision: policy.revision,
          policyVersion,
          roleContractSha256,
        },
      };
    });
  }

  clearTarget(value) {
    const input = requireTargetClearInput(value);
    return this.#write('TARGET_CLEAR', () => {
      const current = this.#currentTarget(input.role);
      if (current.revision !== input.expectedRevision) {
        fail(
          'MODEL_FAILOVER_TARGET_STALE',
          'Target expected revision is stale',
          {
            role: input.role,
            expectedRevision: input.expectedRevision,
            currentRevision: current.revision,
          },
        );
      }
      if (current.target === null) {
        fail(
          'MODEL_FAILOVER_TARGET_ALREADY_CLEAR',
          'Target is already clear',
          { role: input.role, revision: current.revision },
        );
      }
      return this.#commitTargetChange(input, null, 'CLEAR', this.#now(), current);
    });
  }

  updateFromTypedApi(input) {
    return this.#commit(input, {
      eventKind: 'USER_UPDATE',
      actor: 'user:model-settings-api',
      source: 'TYPED_API',
    });
  }

  exportSettingsBackup() {
    if (this.db.inTransaction) {
      fail(
        'MODEL_AUTOMATION_POLICY_TRANSACTION_OWNERSHIP_REQUIRED',
        'Settings backup export must own its read transaction',
      );
    }
    const transaction = this.db.transaction(() => {
      const policy = mapConsistentRow(selectConsistentPolicy(this.db));
      if (!policy) {
        fail(
          'MODEL_AUTOMATION_POLICY_INVALID_STATE',
          'Policy projection does not match its append-only event',
        );
      }
      const stored = readStoredGeneralSettings(this.db);
      const general = sanitizeGenericModelAutomationSettings(stored.document).document;
      return createSettingsBackup(general, { ...policy.settings }).backup;
    });
    try {
      return transaction.deferred();
    } catch (error) {
      if (error instanceof ModelAutomationPolicyError) throw error;
      if (error instanceof SettingsPortabilityError) {
        const invalidStoredValue = error.code === 'SETTINGS_PORTABILITY_VALUE_INVALID';
        throw new ModelAutomationPolicyError(
          invalidStoredValue
            ? 'MODEL_AUTOMATION_POLICY_STORED_PORTABLE_VALUE_INVALID'
            : 'MODEL_AUTOMATION_POLICY_STORED_GENERAL_SETTINGS_INVALID',
          invalidStoredValue
            ? 'A stored portable setting has an unsupported value'
            : 'Stored general settings cannot be exported safely',
          { cause: error, details: error.details },
        );
      }
      throw new ModelAutomationPolicyError(
        'MODEL_AUTOMATION_POLICY_BACKUP_READ_FAILED',
        'Settings backup export failed',
        { cause: error },
      );
    }
  }

  replaceFromSettingsImport(value) {
    const request = requireSettingsImportRequest(value);
    const backup = request.backup;
    return this.#write('BACKUP_IMPORT', () => {
      const current = mapConsistentRow(selectConsistentPolicy(this.db));
      if (!current) {
        fail(
          'MODEL_AUTOMATION_POLICY_INVALID_STATE',
          'Policy projection does not match its append-only event',
        );
      }
      const settingsRepository = createUserSettingsRepository(this.db);
      let settingsCommit;
      try {
        settingsCommit = settingsRepository.applyPortableImportInTransaction({
          expectedRevision: request.expectedRevision,
          portableValues: backup.portableValues,
        });
      } catch (error) {
        if (error instanceof SettingsPortabilityError) {
          throw new ModelAutomationPolicyError(
            'MODEL_AUTOMATION_POLICY_STORED_GENERAL_SETTINGS_INVALID',
            error.message,
            { cause: error, details: error.details },
          );
        }
        throw error;
      }
      const committed = this.#commitValidated({
        expectedRevision: current.revision,
        settings: backup.policySettings || current.settings,
      }, {
        eventKind: 'BACKUP_IMPORT',
        actor: 'user:settings-import',
        source: 'SETTINGS_IMPORT',
      });
      return {
        settings: settingsCommit.settings,
        settingsRevision: settingsCommit.revision,
        sourceSchemaVersion: backup.sourceSchemaVersion,
        appliedPortablePaths: settingsCommit.appliedPortablePaths,
        ignoredSourcePaths: backup.ignoredSourcePaths,
        preservedLocalPaths: settingsCommit.preservedLocalPaths,
        policy: committed,
      };
    });
  }

  resetFromGlobalSettings(value) {
    const input = requireGlobalSettingsResetRequest(value);
    return this.#write('GLOBAL_RESET', () => {
      const current = mapConsistentRow(selectConsistentPolicy(this.db));
      if (!current) {
        fail(
          'MODEL_AUTOMATION_POLICY_INVALID_STATE',
          'Policy projection does not match its append-only event',
        );
      }
      const settingsRepository = createUserSettingsRepository(this.db);
      const stored = settingsRepository.readResetSnapshotInTransaction();
      if (stored.revision !== input.expectedRevision
        || current.revision !== input.expectedPolicyRevision) {
        fail(
          'SETTINGS_RESET_REVISION_CONFLICT',
          'Settings or model policy changed since the reset snapshots were read',
          {
            expectedRevision: input.expectedRevision,
            currentRevision: stored.revision,
            expectedPolicyRevision: input.expectedPolicyRevision,
            currentPolicyRevision: current.revision,
          },
        );
      }
      if (stored.revision === Number.MAX_SAFE_INTEGER
        || current.revision === Number.MAX_SAFE_INTEGER) {
        fail(
          'SETTINGS_RESET_REVISION_EXHAUSTED',
          'Settings reset revisions cannot advance safely',
          {
            currentRevision: stored.revision,
            currentPolicyRevision: current.revision,
          },
        );
      }
      const settingsCommit = settingsRepository.resetOwnedInTransaction({
        expectedRevision: input.expectedRevision,
      });
      const committed = this.#commitValidated({
        expectedRevision: input.expectedPolicyRevision,
        settings: { ...DEFAULT_MODEL_AUTOMATION_POLICY },
      }, {
        eventKind: 'GLOBAL_RESET',
        actor: 'user:global-reset',
        source: 'GLOBAL_RESET',
      });
      return {
        settings: projectPublicUserSettings(settingsCommit.document),
        settingsRevision: settingsCommit.revision,
        policy: committed,
      };
    });
  }
}

export function createModelAutomationPolicyRepository(db, options = {}) {
  return new ModelAutomationPolicyRepository(db, options);
}
