// Model automation policy authority (decision 020/E).
//
// The three automation keys have exactly one writer: this module. The generic
// settings document cannot enable, disable or overwrite them, and every change
// leaves an append-only event with an actor and a repository-owned request id.
//
// Reads are fail-safe rather than optimistic: a missing row, a malformed value
// or a projection that does not match its event all return default-off with a
// typed reason. Automation never runs because the storage was unreadable.

import { randomUUID } from 'node:crypto';

export const ModelPolicyStatus = Object.freeze({
  VALID: 'VALID',
  MISSING: 'MISSING',
  MALFORMED: 'MALFORMED',
  EVENT_MISMATCH: 'EVENT_MISMATCH',
  DB_ERROR: 'DB_ERROR',
});

export const POLICY_SOURCE = Object.freeze({
  TYPED_ROUTE: 'TYPED_ROUTE',
  EXPLICIT_IMPORT: 'EXPLICIT_IMPORT',
  EXPLICIT_RESET: 'EXPLICIT_RESET',
});

export const DEFAULT_MODEL_AUTOMATION_POLICY = Object.freeze({
  autoFailoverEnabled: false,
  autoCleanupEnabled: false,
  autoCleanupDays: 14,
});

export const RESERVED_MODEL_AUTOMATION_KEYS = Object.freeze([
  'autoFailoverEnabled',
  'autoCleanupEnabled',
  'autoCleanupDays',
]);

// These are the two historical table shapes recognized by migration 081.
// Do not infer authority from one convenient column or silently repair an
// unknown schema. Neither branch rewrites existing events or migration history.
const POLICY_COLUMNS = Object.freeze([
  'id', 'revision', 'auto_failover_enabled', 'auto_cleanup_enabled',
  'auto_cleanup_days', 'last_event_id', 'updated_at_ms',
]);
const EVENT_COLUMNS_066 = Object.freeze([
  'event_id', 'seq', 'revision', 'auto_failover_enabled', 'auto_cleanup_enabled',
  'auto_cleanup_days', 'actor', 'source', 'request_id', 'created_at_ms',
  'quarantined_legacy',
]);
const EVENT_COLUMNS_061 = Object.freeze([
  'seq', 'event_id', 'request_id', 'schema_version', 'previous_revision',
  'committed_revision', 'event_kind', 'actor', 'source',
  'before_auto_failover_enabled', 'before_auto_cleanup_enabled',
  'before_auto_cleanup_days', 'after_auto_failover_enabled',
  'after_auto_cleanup_enabled', 'after_auto_cleanup_days',
  'legacy_quarantine_json', 'created_at_ms',
]);
const SOURCE_AUTHORITY_061 = Object.freeze({
  [POLICY_SOURCE.TYPED_ROUTE]: Object.freeze({ eventKind: 'USER_UPDATE', source: 'TYPED_API' }),
  [POLICY_SOURCE.EXPLICIT_IMPORT]: Object.freeze({ eventKind: 'BACKUP_IMPORT', source: 'SETTINGS_IMPORT' }),
  [POLICY_SOURCE.EXPLICIT_RESET]: Object.freeze({ eventKind: 'GLOBAL_RESET', source: 'GLOBAL_RESET' }),
});

function policySchema(db) {
  const objects = db.prepare(`
    SELECT type FROM sqlite_master
    WHERE name IN ('model_automation_policy', 'model_automation_policy_events')
  `).all();
  if (objects.length !== 2 || objects.some(row => row.type !== 'table')) return null;
  const columns = table => db.prepare(`PRAGMA table_xinfo(${table})`).all().map(row => row.name);
  const exact = (actual, expected) => actual.length === expected.length
    && expected.every(name => actual.includes(name));
  const policy = columns('model_automation_policy');
  const events = columns('model_automation_policy_events');
  if (exact(policy, POLICY_COLUMNS) && exact(events, EVENT_COLUMNS_066)) return '066';
  if (exact(policy, [...POLICY_COLUMNS, 'schema_version']) && exact(events, EVENT_COLUMNS_061)) return '061';
  return null;
}

const VALID_SOURCES = new Set(Object.values(POLICY_SOURCE));

export class ModelPolicyError extends Error {
  constructor(code, message, details = null, httpStatus = null) {
    super(message);
    this.name = 'ModelPolicyError';
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus;
  }
}

function fail(code, message, details = null, httpStatus = null) {
  throw new ModelPolicyError(code, message, details, httpStatus);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function defaultState(status, reason) {
  return Object.freeze({
    status,
    valid: false,
    reason,
    revision: 0,
    lastEventId: null,
    policy: { ...DEFAULT_MODEL_AUTOMATION_POLICY },
  });
}

function decodeBoolean(value) {
  if (value === 0) return false;
  if (value === 1) return true;
  return null;
}

/**
 * Read the authoritative automation policy.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{status: string, valid: boolean, reason: string|null, revision: number,
 *   lastEventId: string|null, policy: {autoFailoverEnabled: boolean,
 *   autoCleanupEnabled: boolean, autoCleanupDays: number}}}
 */
export function readModelAutomationPolicy(db) {
  if (!db || typeof db.prepare !== 'function') {
    return defaultState(ModelPolicyStatus.DB_ERROR, 'MODEL_POLICY_DB_INVALID');
  }

  let row;
  let event;
  let schema;
  try {
    schema = policySchema(db);
    if (!schema) return defaultState(ModelPolicyStatus.DB_ERROR, 'MODEL_POLICY_SCHEMA_UNSUPPORTED');
    row = db.prepare('SELECT * FROM model_automation_policy WHERE id = 1').get();
    if (row) {
      event = db.prepare(schema === '061' ? `
        SELECT event_id, schema_version, previous_revision, created_at_ms,
               committed_revision AS revision,
               after_auto_failover_enabled AS auto_failover_enabled,
               after_auto_cleanup_enabled AS auto_cleanup_enabled,
               after_auto_cleanup_days AS auto_cleanup_days
        FROM model_automation_policy_events WHERE event_id = ?
      ` : `
        SELECT revision, auto_failover_enabled, auto_cleanup_enabled, auto_cleanup_days
        FROM model_automation_policy_events WHERE event_id = ?
      `).get(row.last_event_id);
    }
  } catch (error) {
    return defaultState(ModelPolicyStatus.DB_ERROR, 'MODEL_POLICY_READ_FAILED');
  }

  if (!row) return defaultState(ModelPolicyStatus.MISSING, 'MODEL_POLICY_ROW_MISSING');

  const autoFailoverEnabled = decodeBoolean(row.auto_failover_enabled);
  const autoCleanupEnabled = decodeBoolean(row.auto_cleanup_enabled);
  const autoCleanupDays = row.auto_cleanup_days;
  if (autoFailoverEnabled === null
    || autoCleanupEnabled === null
    || !Number.isInteger(autoCleanupDays)
    || autoCleanupDays < 1
    || autoCleanupDays > 3650
    || !Number.isSafeInteger(row.revision)
    || row.revision < 1
    || (schema === '061' && (row.schema_version !== 1
      || !Number.isSafeInteger(row.updated_at_ms) || row.updated_at_ms < 1))) {
    return defaultState(ModelPolicyStatus.MALFORMED, 'MODEL_POLICY_VALUE_INVALID');
  }

  // The projection is only believed when the event that produced it still says
  // the same thing. Anything else is treated as tampering or corruption.
  if (!event
    || event.revision !== row.revision
    || event.auto_failover_enabled !== row.auto_failover_enabled
    || event.auto_cleanup_enabled !== row.auto_cleanup_enabled
    || event.auto_cleanup_days !== row.auto_cleanup_days
    || (schema === '061' && (event.schema_version !== 1
      || event.previous_revision !== row.revision - 1
      || event.created_at_ms !== row.updated_at_ms
      || event.event_id !== row.last_event_id))) {
    return defaultState(ModelPolicyStatus.EVENT_MISMATCH, 'MODEL_POLICY_EVENT_MISMATCH');
  }

  return Object.freeze({
    status: ModelPolicyStatus.VALID,
    valid: true,
    reason: null,
    revision: row.revision,
    lastEventId: row.last_event_id,
    policy: Object.freeze({ autoFailoverEnabled, autoCleanupEnabled, autoCleanupDays }),
  });
}

function requirePolicyValues(value) {
  if (!isPlainObject(value)) {
    fail('MODEL_POLICY_INPUT_INVALID', 'Policy values must be a plain object', null, 400);
  }
  const unknown = Object.keys(value)
    .filter(key => !RESERVED_MODEL_AUTOMATION_KEYS.includes(key))
    .sort();
  if (unknown.length > 0) {
    fail('MODEL_POLICY_INPUT_INVALID', 'Unknown policy keys', { fields: unknown }, 400);
  }
  for (const key of ['autoFailoverEnabled', 'autoCleanupEnabled']) {
    if (Object.hasOwn(value, key) && typeof value[key] !== 'boolean') {
      fail('MODEL_POLICY_INPUT_INVALID', `${key} must be a boolean`, { field: key }, 400);
    }
  }
  if (Object.hasOwn(value, 'autoCleanupDays')) {
    const days = value.autoCleanupDays;
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      fail(
        'MODEL_POLICY_INPUT_INVALID',
        'autoCleanupDays must be an integer between 1 and 3650',
        { field: 'autoCleanupDays' },
        400,
      );
    }
  }
  return value;
}

function writePolicy(db, { values, expectedRevision, actor, source, quarantinedLegacy = null }) {
  const current = readModelAutomationPolicy(db);
  if (!current.valid) {
    fail('MODEL_POLICY_STATE_INVALID', 'Policy storage must be valid before a change', {
      status: current.status, reason: current.reason,
    }, 503);
  }
  const schema = policySchema(db);
  if (schema === '061' && (!/^user:[A-Za-z0-9:._-]+$/.test(actor) || actor.length > 96)) {
    fail('MODEL_POLICY_INPUT_INVALID', 'actor must satisfy the M1 user authority contract', { field: 'actor' }, 400);
  }
  if (Number.isInteger(expectedRevision) && expectedRevision !== current.revision) {
    fail(
      'MODEL_POLICY_REVISION_CONFLICT',
      'Policy revision no longer matches',
      { expectedRevision, currentRevision: current.revision },
      409,
    );
  }

  const next = { ...current.policy, ...values };
  const revision = current.revision + 1;
  const eventId = `policy-${randomUUID()}`;
  const nowMs = Date.now();
  if (!Number.isSafeInteger(revision) || !Number.isSafeInteger(nowMs) || nowMs < 1) {
    fail('MODEL_POLICY_STATE_INVALID', 'Policy revision or clock is invalid', null, 503);
  }
  if (schema === '061') {
    // Migration 061 requires projection first, then its matching append-only
    // event, inside this transaction. Its deferred FK and lineage triggers
    // protect the interval; 066 has the opposite insertion order below.
    const changed = db.prepare(`
      UPDATE model_automation_policy
      SET revision = ?, auto_failover_enabled = ?, auto_cleanup_enabled = ?,
          auto_cleanup_days = ?, last_event_id = ?, updated_at_ms = ?
      WHERE id = 1 AND schema_version = 1 AND revision = ? AND last_event_id = ?
    `).run(revision, next.autoFailoverEnabled ? 1 : 0, next.autoCleanupEnabled ? 1 : 0,
      next.autoCleanupDays, eventId, nowMs, current.revision, current.lastEventId);
    if (changed.changes !== 1) {
      fail('MODEL_POLICY_REVISION_CONFLICT', 'Policy changed before commit', null, 409);
    }
    const authority = SOURCE_AUTHORITY_061[source];
    db.prepare(`
      INSERT INTO model_automation_policy_events (
        event_id, request_id, schema_version, previous_revision, committed_revision,
        event_kind, actor, source, before_auto_failover_enabled,
        before_auto_cleanup_enabled, before_auto_cleanup_days,
        after_auto_failover_enabled, after_auto_cleanup_enabled, after_auto_cleanup_days,
        legacy_quarantine_json, created_at_ms
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(eventId, `request-${randomUUID()}`, current.revision, revision,
      authority.eventKind, actor, authority.source,
      current.policy.autoFailoverEnabled ? 1 : 0, current.policy.autoCleanupEnabled ? 1 : 0,
      current.policy.autoCleanupDays, next.autoFailoverEnabled ? 1 : 0,
      next.autoCleanupEnabled ? 1 : 0, next.autoCleanupDays, nowMs);
  } else {
    const seqRow = db.prepare(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM model_automation_policy_events',
    ).get();

    db.prepare(`
      INSERT INTO model_automation_policy_events (
        event_id, seq, revision, auto_failover_enabled, auto_cleanup_enabled,
        auto_cleanup_days, actor, source, request_id, created_at_ms, quarantined_legacy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      seqRow.nextSeq,
      revision,
      next.autoFailoverEnabled ? 1 : 0,
      next.autoCleanupEnabled ? 1 : 0,
      next.autoCleanupDays,
      actor,
      source,
      `request-${randomUUID()}`,
      nowMs,
      quarantinedLegacy,
    );

    db.prepare(`
      INSERT INTO model_automation_policy (
        id, revision, auto_failover_enabled, auto_cleanup_enabled,
        auto_cleanup_days, last_event_id, updated_at_ms
      ) VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        revision = excluded.revision,
        auto_failover_enabled = excluded.auto_failover_enabled,
        auto_cleanup_enabled = excluded.auto_cleanup_enabled,
        auto_cleanup_days = excluded.auto_cleanup_days,
        last_event_id = excluded.last_event_id,
        updated_at_ms = excluded.updated_at_ms
    `).run(
      revision,
      next.autoFailoverEnabled ? 1 : 0,
      next.autoCleanupEnabled ? 1 : 0,
      next.autoCleanupDays,
      eventId,
      nowMs,
    );

  }
  const committed = readModelAutomationPolicy(db);
  if (!committed.valid || committed.revision !== revision || committed.lastEventId !== eventId
    || RESERVED_MODEL_AUTOMATION_KEYS.some(key => committed.policy[key] !== next[key])) {
    fail('MODEL_POLICY_STATE_INVALID', 'Committed policy does not match its event', null, 503);
  }
  return Object.freeze({
    ok: true,
    revision,
    eventId,
    policy: Object.freeze({ ...next }),
  });
}

/**
 * The single commit point for every policy change. `expectedRevision` is a CAS:
 * two concurrent writers cannot both win, and a stale client cannot overwrite a
 * newer decision.
 */
export function updateModelAutomationPolicy(db, inputValue) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    fail('MODEL_POLICY_DB_INVALID', 'A better-sqlite3 database is required', null, 503);
  }
  if (!isPlainObject(inputValue)) {
    fail('MODEL_POLICY_INPUT_INVALID', 'Policy update input must be a plain object', null, 400);
  }
  const allowed = ['values', 'expectedRevision', 'actor', 'source'];
  const unexpected = Object.keys(inputValue).filter(key => !allowed.includes(key)).sort();
  if (unexpected.length > 0) {
    fail('MODEL_POLICY_INPUT_INVALID', 'Unknown update fields', { fields: unexpected }, 400);
  }
  const values = requirePolicyValues(inputValue.values);
  if (!VALID_SOURCES.has(inputValue.source)) {
    fail('MODEL_POLICY_INPUT_INVALID', 'Unknown policy source', { field: 'source' }, 400);
  }
  if (typeof inputValue.actor !== 'string' || !inputValue.actor.trim()) {
    fail('MODEL_POLICY_INPUT_INVALID', 'actor is required', { field: 'actor' }, 400);
  }
  if (inputValue.expectedRevision !== undefined
    && (!Number.isInteger(inputValue.expectedRevision) || inputValue.expectedRevision < 0)) {
    fail(
      'MODEL_POLICY_INPUT_INVALID',
      'expectedRevision must be a non-negative integer',
      { field: 'expectedRevision' },
      400,
    );
  }

  const commit = db.transaction(() => writePolicy(db, {
    values,
    expectedRevision: inputValue.expectedRevision,
    actor: inputValue.actor.trim(),
    source: inputValue.source,
  }));
  return commit.immediate ? commit.immediate() : commit();
}

/**
 * Explicit reset writes exactly one audited transition to OFF. It never deletes
 * history — a reset is a decision, not an absence of one.
 */
export function resetModelAutomationPolicy(db, { actor } = {}) {
  return updateModelAutomationPolicy(db, {
    values: { ...DEFAULT_MODEL_AUTOMATION_POLICY },
    actor: actor || 'user:explicit-reset',
    source: POLICY_SOURCE.EXPLICIT_RESET,
  });
}

/**
 * Remove the owned keys from a generic settings document.
 *
 * Decision 020 operator correction: this is a drop, not a reject. `GET
 * /api/settings` returns the whole raw row and Studio posts it back unchanged on
 * every settings change, so rejecting would turn every save into a 400 on any
 * installation whose row already contains `models`. Foreign and future keys
 * inside `models` are preserved.
 *
 * @returns {{settings: object, ignoredReservedKeys: string[]}}
 */
export function stripReservedAutomationKeys(document) {
  if (!isPlainObject(document) || !isPlainObject(document.models)) {
    return { settings: document, ignoredReservedKeys: [] };
  }
  const ignoredReservedKeys = RESERVED_MODEL_AUTOMATION_KEYS
    .filter(key => Object.hasOwn(document.models, key));
  if (ignoredReservedKeys.length === 0) {
    return { settings: document, ignoredReservedKeys: [] };
  }
  const models = { ...document.models };
  for (const key of ignoredReservedKeys) delete models[key];
  return {
    settings: { ...document, models },
    ignoredReservedKeys,
  };
}

export default {
  DEFAULT_MODEL_AUTOMATION_POLICY,
  ModelPolicyStatus,
  POLICY_SOURCE,
  RESERVED_MODEL_AUTOMATION_KEYS,
  readModelAutomationPolicy,
  resetModelAutomationPolicy,
  stripReservedAutomationKeys,
  updateModelAutomationPolicy,
};
