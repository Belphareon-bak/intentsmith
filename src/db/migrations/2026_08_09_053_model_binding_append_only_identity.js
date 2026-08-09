// Migration 053 — make append-only identity and ordering explicit.
//
// SQLite INSERT OR REPLACE can delete a conflicting row before inserting its
// replacement, while DELETE triggers are not recursive by default.  Declared
// key guards alone are also insufficient on ordinary rowid tables: an explicit
// hidden rowid can become the replacement identity.  Finally, INTEGER PRIMARY
// KEY exposes -1 as the BEFORE INSERT sentinel for an omitted sequence, but a
// caller can explicitly persist that value unless an AFTER guard rejects it.
//
// This migration therefore gives every journal one mutually exclusive insert
// authority, makes pre-existing business triggers silent on non-sentinel
// ordering and identity conflicts,
// and rolls back explicit non-positive sentinel rows after insertion.  Before
// installing any trigger it also rejects legacy rows with a non-positive
// ordering value or a NULL TEXT identity.  Positive historical rowid/sequence
// provenance is not recoverable, so the upgrade can prove current shape but
// cannot prove whether an older positive value was caller- or DB-assigned.

import { createHash } from 'node:crypto';

export const version = '2026_08_09_053_model_binding_append_only_identity';
export const description = 'Reject replacement and caller ordering in model binding audit journals';

const TABLE_AUTHORITIES = Object.freeze([
  Object.freeze({
    table: 'model_failover_proofs',
    valueColumn: 'rowid',
    sequenceTrigger: 'trg_model_failover_proofs_rowid_authority',
    sequenceSignal:
      'MODEL_FAILOVER_PROOF_ROWID_AUTHORITY: proof rowid is database assigned',
    identityTrigger: 'trg_model_failover_proofs_append_only_insert_conflict',
    identitySignal:
      'MODEL_FAILOVER_PROOF_IDENTITY_CONFLICT: proof audit identity is already committed',
    identityRequiredSql: 'NEW.proof_id IS NULL',
    identityRequiredColumn: 'proof_id',
    identityRequiredTrigger: 'trg_model_failover_proofs_identity_required',
    identityRequiredSignal:
      'MODEL_FAILOVER_PROOF_IDENTITY_REQUIRED: proof identity must be non-null',
    positiveTrigger: 'trg_model_failover_proofs_rowid_positive',
    identityExistsSql: `EXISTS (
      SELECT 1
      FROM model_failover_proofs existing
      WHERE existing.proof_id = NEW.proof_id
         OR (
           existing.validation_run_id = NEW.validation_run_id
           AND existing.role = NEW.role
         )
    )`,
    businessTriggers: Object.freeze([]),
    existingAuthorityTriggers: Object.freeze([]),
    beforeInsertDigest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  }),
  Object.freeze({
    table: 'model_failover_events',
    valueColumn: 'seq',
    sequenceTrigger: 'trg_model_failover_events_sequence_authority',
    sequenceSignal:
      'MODEL_FAILOVER_EVENT_SEQUENCE_AUTHORITY: event sequence is database assigned',
    identityTrigger: 'trg_model_failover_events_append_only_insert_conflict',
    identitySignal:
      'MODEL_FAILOVER_EVENT_IDENTITY_CONFLICT: event audit identity is already committed',
    positiveTrigger: 'trg_model_failover_events_sequence_positive',
    identityExistsSql: `EXISTS (
      SELECT 1
      FROM model_failover_events existing
      WHERE existing.event_id = NEW.event_id
         OR (
           NEW.operation_id IS NOT NULL
           AND existing.operation_id = NEW.operation_id
           AND existing.event_type = NEW.event_type
         )
    )`,
    businessTriggers: Object.freeze([
      'trg_model_failover_events_claim_expired',
      'trg_model_failover_events_fallback_proof',
      'trg_model_failover_events_manual_supersede',
      'trg_model_failover_events_restore_proof',
      'trg_model_failover_events_terminal_claim',
    ]),
    existingAuthorityTriggers: Object.freeze([]),
    beforeInsertDigest: 'a72edc2e42329d5ec3095cd01e6cba1ef1813aa458e17092ed3f4118a3239486',
  }),
  Object.freeze({
    table: 'model_binding_operations',
    valueColumn: 'rowid',
    sequenceTrigger: 'trg_model_binding_operations_rowid_authority',
    sequenceSignal:
      'MODEL_BINDING_OPERATION_ROWID_AUTHORITY: binding operation rowid is database assigned',
    identityTrigger: 'trg_model_binding_operations_append_only_insert_conflict',
    identitySignal:
      'MODEL_BINDING_OPERATION_IDENTITY_CONFLICT: binding audit identity is already committed',
    identityRequiredSql: 'NEW.operation_id IS NULL',
    identityRequiredColumn: 'operation_id',
    identityRequiredTrigger: 'trg_model_binding_operations_identity_required',
    identityRequiredSignal:
      'MODEL_BINDING_OPERATION_IDENTITY_REQUIRED: binding operation identity must be non-null',
    positiveTrigger: 'trg_model_binding_operations_rowid_positive',
    identityExistsSql: `EXISTS (
      SELECT 1
      FROM model_binding_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.desired_event_id = NEW.desired_event_id
         OR (
           existing.role = NEW.role
           AND existing.committed_binding_revision = NEW.committed_binding_revision
         )
         OR (
           NEW.rollback_of_operation_id IS NOT NULL
           AND existing.rollback_of_operation_id = NEW.rollback_of_operation_id
         )
    )`,
    businessTriggers: Object.freeze([
      'trg_model_binding_operation_noop_request_conflict',
      'trg_model_binding_operation_provider_lineage',
      'trg_model_binding_operation_provider_not_superseded',
      'trg_model_binding_operation_provider_pending',
      'trg_model_binding_operation_provider_unresolved_success',
      'trg_model_binding_operations_audit_event',
      'trg_model_binding_operations_current_projection',
      'trg_model_binding_operations_manual_predecessor',
      'trg_model_binding_operations_no_incident',
      'trg_model_binding_operations_predecessor',
      'trg_model_binding_operations_rollback_lineage',
      'trg_model_binding_operations_user_actor',
    ]),
    existingAuthorityTriggers: Object.freeze([]),
    beforeInsertDigest: '58104684a095076886da38cf549d1e4b4f056b8b895cc5f2b9e9f5b88c06eb6a',
  }),
  Object.freeze({
    table: 'model_binding_application_attempts',
    valueColumn: 'seq',
    sequenceTrigger: 'trg_model_binding_application_sequence_authority',
    sequenceSignal:
      'MODEL_BINDING_APPLICATION_SEQUENCE_AUTHORITY: application sequence is database assigned',
    identityTrigger: 'trg_model_binding_application_append_only_insert_conflict',
    identitySignal:
      'MODEL_BINDING_APPLICATION_IDENTITY_CONFLICT: application audit identity is already committed',
    positiveTrigger: 'trg_model_binding_application_sequence_positive',
    identityExistsSql: `EXISTS (
      SELECT 1
      FROM model_binding_application_attempts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.attempt_revision = NEW.attempt_revision
         )
    )`,
    businessTriggers: Object.freeze([
      'trg_model_binding_application_current_desired',
      'trg_model_binding_application_nonretryable_runtime_terminal',
      'trg_model_binding_application_notification_once',
      'trg_model_binding_application_revision',
      'trg_model_binding_application_runtime_apply_after_rehydrate',
      'trg_model_binding_application_runtime_apply_once',
      'trg_model_binding_application_runtime_changed_shape',
      'trg_model_binding_application_runtime_prerequisite',
      'trg_model_binding_application_success_identity',
      'trg_model_binding_application_time_order',
      'trg_model_binding_application_verification_terminal',
    ]),
    existingAuthorityTriggers: Object.freeze([]),
    beforeInsertDigest: '50497434f798b9ea5d2c16f1787e070f5d7a47cb5e73890d8d76a9c3f7de2814',
  }),
  Object.freeze({
    table: 'model_binding_provider_operations',
    valueColumn: 'command_seq',
    sequenceTrigger: 'trg_model_binding_provider_command_sequence_authority',
    sequenceSignal:
      'MODEL_BINDING_PROVIDER_COMMAND_SEQUENCE_AUTHORITY: command sequence is database assigned',
    identityTrigger: 'trg_model_binding_provider_operations_append_only_insert_conflict',
    identitySignal:
      'MODEL_BINDING_PROVIDER_OPERATION_IDENTITY_CONFLICT: provider audit identity is already committed',
    positiveTrigger: 'trg_model_binding_provider_command_sequence_positive',
    identityExistsSql: `EXISTS (
      SELECT 1
      FROM model_binding_provider_operations existing
      WHERE existing.operation_id = NEW.operation_id
         OR existing.request_key = NEW.request_key
         OR existing.initial_claim_token = NEW.initial_claim_token
    )`,
    businessTriggers: Object.freeze([
      'trg_model_binding_provider_claim_conflict',
      'trg_model_binding_provider_desired_revision',
      'trg_model_binding_provider_noop_request_conflict',
      'trg_model_binding_provider_operations_user_actor',
      'trg_model_binding_provider_unresolved_success',
    ]),
    existingAuthorityTriggers: Object.freeze([
      'trg_model_binding_provider_command_sequence_authority',
    ]),
    beforeInsertDigest: 'c6db2fe5ef4d8d6ed3470c110017619dc6648a28ce7fc9d47b1580d64c04843f',
  }),
  Object.freeze({
    table: 'model_binding_provider_attempts',
    valueColumn: 'seq',
    sequenceTrigger: 'trg_model_binding_provider_attempts_sequence_authority',
    sequenceSignal:
      'MODEL_BINDING_PROVIDER_ATTEMPT_SEQUENCE_AUTHORITY: provider attempt sequence is database assigned',
    identityTrigger: 'trg_model_binding_provider_attempts_append_only_insert_conflict',
    identitySignal:
      'MODEL_BINDING_PROVIDER_ATTEMPT_IDENTITY_CONFLICT: provider attempt identity is already committed',
    positiveTrigger: 'trg_model_binding_provider_attempts_sequence_positive',
    identityExistsSql: `EXISTS (
      SELECT 1
      FROM model_binding_provider_attempts existing
      WHERE existing.seq = NEW.seq
         OR (
           existing.operation_id = NEW.operation_id
           AND existing.attempt_revision = NEW.attempt_revision
         )
    )`,
    businessTriggers: Object.freeze([
      'trg_model_binding_provider_attempt_once',
      'trg_model_binding_provider_success_identity',
      'trg_model_binding_provider_terminal_claim',
      'trg_model_binding_provider_time_order',
    ]),
    existingAuthorityTriggers: Object.freeze([]),
    beforeInsertDigest: 'cf559dc1b215cf231dd756bed7c46fca5932462dacc28e23e1412b9e1f5ec050',
  }),
  Object.freeze({
    table: 'model_binding_user_noop_receipts',
    valueColumn: 'rowid',
    sequenceTrigger: 'trg_model_binding_user_noop_rowid_authority',
    sequenceSignal:
      'MODEL_BINDING_USER_NOOP_ROWID_AUTHORITY: receipt rowid is database assigned',
    identityTrigger: 'trg_model_binding_user_noop_append_only_insert_conflict',
    identitySignal:
      'MODEL_BINDING_USER_NOOP_APPEND_ONLY_CONFLICT: receipt identity is already committed',
    identityRequiredSql: 'NEW.receipt_id IS NULL',
    identityRequiredColumn: 'receipt_id',
    identityRequiredTrigger: 'trg_model_binding_user_noop_identity_required',
    identityRequiredSignal:
      'MODEL_BINDING_USER_NOOP_IDENTITY_REQUIRED: receipt identity must be non-null',
    positiveTrigger: 'trg_model_binding_user_noop_rowid_positive',
    identityExistsSql: `EXISTS (
      SELECT 1
      FROM model_binding_user_noop_receipts existing
      WHERE existing.receipt_id = NEW.receipt_id
         OR existing.request_key = NEW.request_key
    )`,
    businessTriggers: Object.freeze([
      'trg_model_binding_user_noop_actor',
      'trg_model_binding_user_noop_projection',
      'trg_model_binding_user_noop_provider_frontier',
      'trg_model_binding_user_noop_provider_pending',
      'trg_model_binding_user_noop_provider_time_order',
      'trg_model_binding_user_noop_request_key',
      'trg_model_binding_user_noop_source_provider_lineage',
    ]),
    existingAuthorityTriggers: Object.freeze([
      'trg_model_binding_user_noop_append_only_insert_conflict',
    ]),
    beforeInsertDigest: 'dd898f01e39d095af7f061dc324f0e9db8cf72dff4c8d5c4a4d41f6a6edf428f',
  }),
  Object.freeze({
    table: 'model_binding_user_noop_provider_supersedes',
    valueColumn: 'rowid',
    sequenceTrigger: 'trg_model_binding_user_noop_provider_supersedes_rowid_authority',
    sequenceSignal:
      'MODEL_BINDING_USER_NOOP_PROVIDER_SUPERSEDES_ROWID_AUTHORITY: provider lineage rowid is database assigned',
    identityTrigger: 'trg_model_binding_user_noop_provider_supersedes_insert_conflict',
    identitySignal:
      'MODEL_BINDING_USER_NOOP_PROVIDER_SUPERSEDES_CONFLICT: provider lineage is already committed',
    positiveTrigger: 'trg_model_binding_user_noop_provider_supersedes_rowid_positive',
    identityExistsSql: `EXISTS (
      SELECT 1
      FROM model_binding_user_noop_provider_supersedes existing
      WHERE (
          existing.receipt_id = NEW.receipt_id
          AND existing.provider_operation_id = NEW.provider_operation_id
        )
        OR existing.provider_operation_id = NEW.provider_operation_id
    )`,
    businessTriggers: Object.freeze([
      'trg_model_binding_user_noop_provider_cutoff',
      'trg_model_binding_user_noop_provider_lineage',
    ]),
    existingAuthorityTriggers: Object.freeze([
      'trg_model_binding_user_noop_provider_supersedes_insert_conflict',
    ]),
    beforeInsertDigest: 'ebb854fb486e668e933fe36ca5ff60229528b6e35d1b2c951bfa9c08d4317e4b',
  }),
]);

function beforeInsertTriggers(db, table) {
  return db.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'trigger'
      AND tbl_name = ?
      AND upper(sql) LIKE '%BEFORE INSERT%'
    ORDER BY name
  `).all(table);
}

function addAuthorityExclusion(sql, guardSql, triggerName) {
  const whenMatch = /\bWHEN\b/i.exec(sql);
  if (!whenMatch) {
    throw new Error(`migration 053 cannot locate WHEN in ${triggerName}`);
  }
  const afterWhen = sql.slice(whenMatch.index + whenMatch[0].length);
  const beginMatch = /\bBEGIN\b/i.exec(afterWhen);
  if (!beginMatch) {
    throw new Error(`migration 053 cannot locate BEGIN in ${triggerName}`);
  }
  const condition = afterWhen.slice(0, beginMatch.index).trim();
  const body = afterWhen.slice(beginMatch.index);
  return `${sql.slice(0, whenMatch.index)}WHEN NOT (${guardSql})\n`
    + `  AND (${condition})\n${body}`;
}

function preflightBusinessTriggers(db, authority) {
  const expected = [
    ...authority.businessTriggers,
    ...authority.existingAuthorityTriggers,
  ].sort();
  const triggerRows = beforeInsertTriggers(db, authority.table);
  const actual = triggerRows.map(row => row.name);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `migration 053 ${authority.table} BEFORE INSERT trigger set drifted: `
      + `expected ${expected.join(',')}; got ${actual.join(',')}`,
    );
  }
  const actualDigest = createHash('sha256')
    .update(triggerRows.map(row => `${row.name}\0${row.sql}`).join('\0'))
    .digest('hex');
  if (actualDigest !== authority.beforeInsertDigest) {
    throw new Error(
      `migration 053 ${authority.table} BEFORE INSERT trigger SQL drifted: `
      + `expected ${authority.beforeInsertDigest}; got ${actualDigest}`,
    );
  }

  return authority.businessTriggers.map(name => {
    const row = triggerRows.find(trigger => trigger.name === name);
    if (!row?.sql) throw new Error(`migration 053 cannot read trigger ${name}`);
    return { name, sql: row.sql };
  });
}

function preflightPersistedRows(db, authority) {
  const invalidOrder = db.prepare(`
    SELECT COUNT(*) AS count
    FROM ${authority.table}
    WHERE ${authority.valueColumn} <= 0
  `).get().count;
  if (invalidOrder > 0) {
    throw new Error(
      `MODEL_BINDING_APPEND_ONLY_PREEXISTING_ORDER_VIOLATION: `
      + `${authority.table}.${authority.valueColumn} contains ${invalidOrder} `
      + 'non-positive persisted value(s)',
    );
  }

  if (!authority.identityRequiredColumn) return;
  const missingIdentity = db.prepare(`
    SELECT COUNT(*) AS count
    FROM ${authority.table}
    WHERE ${authority.identityRequiredColumn} IS NULL
  `).get().count;
  if (missingIdentity > 0) {
    throw new Error(
      `MODEL_BINDING_APPEND_ONLY_PREEXISTING_IDENTITY_VIOLATION: `
      + `${authority.table}.${authority.identityRequiredColumn} contains `
      + `${missingIdentity} NULL persisted value(s)`,
    );
  }
}

function rewriteBusinessTriggers(db, authority, business) {
  const existing = [
    ...authority.businessTriggers,
    ...authority.existingAuthorityTriggers,
  ].sort();
  for (const name of existing) db.exec(`DROP TRIGGER "${name}"`);
  const identityRequired = authority.identityRequiredSql
    ? `${authority.identityRequiredSql} OR `
    : '';
  const guardSql = `NEW.${authority.valueColumn} <> -1 OR `
    + `${identityRequired}${authority.identityExistsSql}`;
  for (const trigger of business) {
    db.exec(addAuthorityExclusion(trigger.sql, guardSql, trigger.name));
  }
}

function createAuthorityTriggers(db, authority) {
  const value = `NEW.${authority.valueColumn}`;
  const identityRequired = authority.identityRequiredSql
    ? `
    CREATE TRIGGER ${authority.identityRequiredTrigger}
    BEFORE INSERT ON ${authority.table}
    WHEN ${value} = -1 AND ${authority.identityRequiredSql}
    BEGIN
      SELECT RAISE(ABORT, '${authority.identityRequiredSignal}');
    END;
    `
    : '';
  const identityShape = authority.identityRequiredSql
    ? `NOT (${authority.identityRequiredSql}) AND `
    : '';
  db.exec(`
    CREATE TRIGGER ${authority.sequenceTrigger}
    BEFORE INSERT ON ${authority.table}
    WHEN ${value} <> -1
    BEGIN
      SELECT RAISE(ABORT, '${authority.sequenceSignal}');
    END;

    ${identityRequired}

    CREATE TRIGGER ${authority.identityTrigger}
    BEFORE INSERT ON ${authority.table}
    WHEN ${value} = -1 AND ${identityShape}${authority.identityExistsSql}
    BEGIN
      SELECT RAISE(ABORT, '${authority.identitySignal}');
    END;

    CREATE TRIGGER ${authority.positiveTrigger}
    AFTER INSERT ON ${authority.table}
    WHEN ${value} <= 0
    BEGIN
      SELECT RAISE(ABORT, '${authority.sequenceSignal}');
    END;
  `);
}

export function up(db) {
  const requiredTables = TABLE_AUTHORITIES.map(authority => authority.table);
  const presentTables = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN (${requiredTables.map(() => '?').join(',')})
    ORDER BY name
  `).all(...requiredTables).map(row => row.name);
  if (JSON.stringify(presentTables) !== JSON.stringify([...requiredTables].sort())) {
    throw new Error('model binding append-only authority tables are incomplete before migration 053');
  }

  for (const authority of TABLE_AUTHORITIES) preflightPersistedRows(db, authority);
  const preflight = TABLE_AUTHORITIES.map(authority => ({
    authority,
    business: preflightBusinessTriggers(db, authority),
  }));
  for (const { authority, business } of preflight) {
    rewriteBusinessTriggers(db, authority, business);
  }
  for (const authority of TABLE_AUTHORITIES) createAuthorityTriggers(db, authority);
}
