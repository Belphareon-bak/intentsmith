// Migration 062 — bind each new model failover proof to both immutable
// evidence artifacts and make all four eligibility checks strictly expire.
//
// Historical inactive proofs remain as audit data but cannot acquire a
// companion after this migration and therefore cannot become eligible. An
// already-active legacy failover is rejected before the first schema mutation;
// silently blessing it would manufacture evidence that migration 046 never
// recorded.

import { createHash } from 'node:crypto';

export const version = '2026_08_10_062_model_failover_proof_issuance';
export const description = 'Bind failover proofs to immutable artifacts and strict expiry';

const EXPECTED_COLUMNS = Object.freeze({
  model_failover_proofs: Object.freeze([
    'completed_at_ms', 'created_at_ms', 'duration_ms', 'expires_at_ms',
    'inventory_after_digest', 'inventory_after_name', 'inventory_before_digest',
    'inventory_before_name', 'model_canonical_name', 'model_digest_sha256',
    'model_name', 'passed_count', 'policy_version', 'proof_id',
    'required_passed_count', 'required_score', 'result', 'role',
    'role_contract_sha256', 'score', 'started_at_ms', 'suite', 'total_count',
    'validation_run_id', 'validation_version',
  ]),
  model_failover_events: Object.freeze([
    'actor', 'binding_revision', 'created_at_ms', 'desired_digest_sha256',
    'desired_model_name', 'details_json', 'episode_id', 'event_id', 'event_type',
    'failure_phase', 'fallback_canonical_name', 'fallback_digest_sha256',
    'fallback_model_name', 'operation_id', 'policy_version', 'proof_id',
    'reason_code', 'role', 'row_version', 'seq', 'state_after', 'state_before',
    'verified',
  ]),
  model_failover_state: Object.freeze([
    'activated_at_ms', 'active_event_id', 'active_failover', 'actor',
    'claim_expires_at_ms', 'claim_kind', 'claim_operation_id',
    'claim_started_at_ms', 'claim_token', 'desired_revision', 'detected_at_ms',
    'episode_id', 'failure_phase', 'fallback_canonical_name',
    'fallback_digest_sha256', 'fallback_model_name', 'last_event_id',
    'policy_version', 'proof_id', 'proof_verified_at_ms', 'reason_code',
    'resolved_at_ms', 'role', 'row_version', 'state', 'updated_at_ms',
  ]),
  model_desired_bindings: Object.freeze([
    'actor', 'binding_revision', 'canonical_name', 'digest_sha256',
    'last_event_id', 'model_name', 'observed_at_ms', 'role', 'source',
    'updated_at_ms',
  ]),
});

const EXPECTED_TABLE_DIGESTS = Object.freeze({
  model_failover_proofs: '9c3c7f82e291f1cce5596a79c9503db5148a5eeb7e43e248661ce4d66fb581f9',
  model_failover_events: 'b64f5e4e2b64448b397d967da7b2b5cf36d8d925e205bb5ea3bfe917410ea0fb',
  model_failover_state: 'c7e7cc69609cd465069b6c7a9e55f719970b539ab9245c62cfca59a3e22d68d5',
  model_desired_bindings: 'de7518085d5c6473c38c7026526bbab803bbde2bb6381bf713d848e24a93c464',
});

const EXPECTED_TRIGGER_AUTHORITY = Object.freeze({
  model_failover_proofs: Object.freeze({
    names: Object.freeze([
      'trg_model_failover_proofs_append_only_delete',
      'trg_model_failover_proofs_append_only_insert_conflict',
      'trg_model_failover_proofs_append_only_update',
      'trg_model_failover_proofs_identity_required',
      'trg_model_failover_proofs_rowid_authority',
      'trg_model_failover_proofs_rowid_positive',
    ]),
    digest: '8bd322793bca8877c3ae6b0f1b41b21cd92eebfb39e8ff2eb007a6255c818e4a',
  }),
  model_failover_events: Object.freeze({
    names: Object.freeze([
      'trg_model_failover_events_append_only_delete',
      'trg_model_failover_events_append_only_insert_conflict',
      'trg_model_failover_events_append_only_update',
      'trg_model_failover_events_claim_expired',
      'trg_model_failover_events_fallback_proof',
      'trg_model_failover_events_manual_supersede',
      'trg_model_failover_events_restore_proof',
      'trg_model_failover_events_sequence_authority',
      'trg_model_failover_events_sequence_positive',
      'trg_model_failover_events_terminal_claim',
    ]),
    digest: 'c40b4e57a73412958b9b822b3bb5af616a3d6cf3334186351a2dcbb8fcb59c1e',
  }),
  model_failover_state: Object.freeze({
    names: Object.freeze([
      'trg_model_failover_state_active_event_insert',
      'trg_model_failover_state_active_event_update',
      'trg_model_failover_state_active_proof_insert',
      'trg_model_failover_state_active_proof_update',
      'trg_model_failover_state_claim_event_insert',
      'trg_model_failover_state_claim_event_update',
      'trg_model_failover_state_delete_authority',
      'trg_model_failover_state_last_event_insert',
      'trg_model_failover_state_last_event_update',
      'trg_model_failover_state_manual_supersede',
      'trg_model_failover_state_manual_supersede_insert',
      'trg_model_failover_state_terminal_immutable',
    ]),
    digest: '41d44199ad2ccf09911000a60779953dc10e6879210908aa61626f5bbc63e8c0',
  }),
});

const NEW_OBJECT_NAMES = Object.freeze([
  'model_failover_proof_artifacts',
  'trg_model_failover_proof_artifacts_append_only_delete',
  'trg_model_failover_proof_artifacts_append_only_update',
  'trg_model_failover_proof_artifacts_historical_attach',
  'trg_model_failover_proof_artifacts_identity_conflict',
  'trg_model_failover_proofs_artifact_companion',
]);

function canonicalTriggerDigest(rows) {
  return createHash('sha256')
    .update(rows.map(row => `${row.name}\0${row.sql}`).join('\0'))
    .digest('hex');
}

function preflightTable(db, table) {
  const tableRow = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(table);
  if (!tableRow?.sql
    || createHash('sha256').update(tableRow.sql).digest('hex') !== EXPECTED_TABLE_DIGESTS[table]) {
    throw new Error(`model failover proof issuance ${table} table SQL drifted`);
  }
  const columns = db.prepare(`PRAGMA table_info('${table}')`)
    .all()
    .map(row => row.name)
    .sort();
  if (JSON.stringify(columns) !== JSON.stringify(EXPECTED_COLUMNS[table])) {
    throw new Error(`model failover proof issuance ${table} column authority drifted`);
  }

  const expected = EXPECTED_TRIGGER_AUTHORITY[table];
  if (!expected) return;
  const triggers = db.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'trigger' AND tbl_name = ?
    ORDER BY name
  `).all(table);
  if (JSON.stringify(triggers.map(row => row.name)) !== JSON.stringify(expected.names)) {
    throw new Error(`model failover proof issuance ${table} trigger authority drifted`);
  }
  const digest = canonicalTriggerDigest(triggers);
  if (digest !== expected.digest) {
    throw new Error(
      `model failover proof issuance ${table} trigger SQL drifted: `
      + `expected ${expected.digest}; got ${digest}`,
    );
  }
}

export function up(db) {
  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new Error('MODEL_FAILOVER_PROOF_FOREIGN_KEYS_REQUIRED: foreign_keys must be ON');
  }
  const foreignKeyViolations = db.pragma('foreign_key_check');
  if (foreignKeyViolations.length > 0) {
    throw new Error(
      `MODEL_FAILOVER_PROOF_PREEXISTING_FOREIGN_KEY_VIOLATION: `
      + `${foreignKeyViolations.length} row(s)`,
    );
  }
  const existingObjects = db.prepare(`
    SELECT type, name
    FROM sqlite_master
    WHERE name IN (${NEW_OBJECT_NAMES.map(() => '?').join(',')})
    ORDER BY type, name
  `).all(...NEW_OBJECT_NAMES);
  if (existingObjects.length > 0) {
    throw new Error(
      'model failover proof issuance objects pre-exist migration authority: '
      + existingObjects.map(row => `${row.type}:${row.name}`).join(','),
    );
  }

  for (const table of Object.keys(EXPECTED_COLUMNS)) preflightTable(db, table);

  const activeLegacyFailovers = db.prepare(`
    SELECT COUNT(*) AS count
    FROM model_failover_state
    WHERE active_failover = 1
  `).get().count;
  if (activeLegacyFailovers !== 0) {
    throw new Error(
      'MODEL_FAILOVER_PROOF_PREEXISTING_ACTIVE_STATE: '
      + `${activeLegacyFailovers} active failover row(s) lack artifact authority`,
    );
  }

  db.exec(`
    CREATE TABLE model_failover_proof_artifacts (
      proof_id TEXT PRIMARY KEY
        CHECK (length(trim(proof_id)) BETWEEN 16 AND 128),
      validation_run_id TEXT NOT NULL
        CHECK (length(trim(validation_run_id)) BETWEEN 1 AND 128),
      parent_run_id TEXT NOT NULL UNIQUE
        CHECK (length(trim(parent_run_id)) BETWEEN 1 AND 128),
      source_revision TEXT NOT NULL
        CHECK (
          length(source_revision) = 40
          AND source_revision = lower(source_revision)
          AND source_revision NOT GLOB '*[^0-9a-f]*'
        ),
      measurement_artifact_sha256 TEXT NOT NULL UNIQUE
        CHECK (
          length(measurement_artifact_sha256) = 64
          AND measurement_artifact_sha256 = lower(measurement_artifact_sha256)
          AND measurement_artifact_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      measurement_artifact_byte_length INTEGER NOT NULL
        CHECK (
          typeof(measurement_artifact_byte_length) = 'integer'
          AND measurement_artifact_byte_length > 0
          AND measurement_artifact_byte_length <= 9007199254740991
        ),
      acceptance_artifact_sha256 TEXT NOT NULL UNIQUE
        CHECK (
          length(acceptance_artifact_sha256) = 64
          AND acceptance_artifact_sha256 = lower(acceptance_artifact_sha256)
          AND acceptance_artifact_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      acceptance_artifact_byte_length INTEGER NOT NULL
        CHECK (
          typeof(acceptance_artifact_byte_length) = 'integer'
          AND acceptance_artifact_byte_length > 0
          AND acceptance_artifact_byte_length <= 9007199254740991
        ),
      role TEXT NOT NULL
        CHECK (role IN ('D1','D2','CODE','R1','R2','CHAT','VISION')),
      suite TEXT NOT NULL
        CHECK (suite IN ('reasoning','code','chat','vision','review')),
      role_contract_sha256 TEXT NOT NULL
        CHECK (
          length(role_contract_sha256) = 64
          AND role_contract_sha256 = lower(role_contract_sha256)
          AND role_contract_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      model_name TEXT NOT NULL
        CHECK (length(trim(model_name)) BETWEEN 1 AND 512),
      model_canonical_name TEXT NOT NULL
        CHECK (length(trim(model_canonical_name)) BETWEEN 1 AND 512),
      model_digest_sha256 TEXT NOT NULL
        CHECK (
          length(model_digest_sha256) = 64
          AND model_digest_sha256 = lower(model_digest_sha256)
          AND model_digest_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      validation_version TEXT NOT NULL
        CHECK (length(trim(validation_version)) BETWEEN 1 AND 64),
      policy_version TEXT NOT NULL
        CHECK (length(trim(policy_version)) BETWEEN 1 AND 64),
      score REAL NOT NULL CHECK (score >= 0 AND score <= 1),
      required_score REAL NOT NULL CHECK (required_score > 0 AND required_score <= 1),
      passed_count INTEGER NOT NULL
        CHECK (typeof(passed_count) = 'integer' AND passed_count >= 0),
      required_passed_count INTEGER NOT NULL
        CHECK (typeof(required_passed_count) = 'integer' AND required_passed_count >= 1),
      total_count INTEGER NOT NULL
        CHECK (typeof(total_count) = 'integer' AND total_count > 0),
      duration_ms INTEGER NOT NULL
        CHECK (typeof(duration_ms) = 'integer' AND duration_ms >= 0),
      result TEXT NOT NULL CHECK (result = 'PASS'),
      inventory_before_name TEXT NOT NULL
        CHECK (length(trim(inventory_before_name)) BETWEEN 1 AND 512),
      inventory_before_digest TEXT NOT NULL,
      inventory_after_name TEXT NOT NULL
        CHECK (length(trim(inventory_after_name)) BETWEEN 1 AND 512),
      inventory_after_digest TEXT NOT NULL,
      measurement_started_at_ms INTEGER NOT NULL
        CHECK (
          typeof(measurement_started_at_ms) = 'integer'
          AND measurement_started_at_ms > 0
          AND measurement_started_at_ms <= 9007199254740991
        ),
      measurement_completed_at_ms INTEGER NOT NULL
        CHECK (
          typeof(measurement_completed_at_ms) = 'integer'
          AND measurement_completed_at_ms >= measurement_started_at_ms
          AND measurement_completed_at_ms <= 9007199254740991
        ),
      acceptance_completed_at_ms INTEGER NOT NULL
        CHECK (
          typeof(acceptance_completed_at_ms) = 'integer'
          AND acceptance_completed_at_ms >= measurement_completed_at_ms
          AND acceptance_completed_at_ms <= 9007199254740991
        ),
      proof_ttl_ms INTEGER NOT NULL
        CHECK (
          typeof(proof_ttl_ms) = 'integer'
          AND proof_ttl_ms > 0
          AND proof_ttl_ms <= 9007199254740991
        ),
      expires_at_ms INTEGER NOT NULL
        CHECK (
          typeof(expires_at_ms) = 'integer'
          AND expires_at_ms > measurement_completed_at_ms
          AND expires_at_ms <= 9007199254740991
        ),
      issued_at_ms INTEGER NOT NULL
        CHECK (
          typeof(issued_at_ms) = 'integer'
          AND issued_at_ms >= acceptance_completed_at_ms
          AND issued_at_ms <= 9007199254740991
        ),

      FOREIGN KEY (proof_id)
        REFERENCES model_failover_proofs(proof_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
      UNIQUE(validation_run_id, role),
      CHECK (acceptance_artifact_sha256 <> measurement_artifact_sha256),
      CHECK (passed_count <= total_count),
      CHECK (required_passed_count <= total_count),
      CHECK (score >= required_score),
      CHECK (passed_count >= required_passed_count),
      CHECK (inventory_before_digest = model_digest_sha256),
      CHECK (inventory_after_digest = model_digest_sha256),
      CHECK (duration_ms = measurement_completed_at_ms - measurement_started_at_ms),
      CHECK (acceptance_completed_at_ms <= 9007199254740991 - proof_ttl_ms),
      CHECK (expires_at_ms = acceptance_completed_at_ms + proof_ttl_ms),
      CHECK (issued_at_ms < expires_at_ms)
    ) WITHOUT ROWID;

    CREATE TRIGGER trg_model_failover_proof_artifacts_historical_attach
    BEFORE INSERT ON model_failover_proof_artifacts
    WHEN EXISTS (
      SELECT 1 FROM model_failover_proofs proof
      WHERE proof.proof_id = NEW.proof_id
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_PROOF_HISTORICAL_ATTACH_FORBIDDEN: proof already exists');
    END;

    CREATE TRIGGER trg_model_failover_proof_artifacts_identity_conflict
    BEFORE INSERT ON model_failover_proof_artifacts
    WHEN EXISTS (
      SELECT 1 FROM model_failover_proof_artifacts existing
      WHERE existing.proof_id = NEW.proof_id
         OR existing.parent_run_id = NEW.parent_run_id
         OR (
           existing.validation_run_id = NEW.validation_run_id
           AND existing.role = NEW.role
         )
         OR existing.measurement_artifact_sha256 = NEW.measurement_artifact_sha256
         OR existing.acceptance_artifact_sha256 = NEW.acceptance_artifact_sha256
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_PROOF_ARTIFACT_IDENTITY_CONFLICT: evidence is committed');
    END;

    CREATE TRIGGER trg_model_failover_proof_artifacts_append_only_update
    BEFORE UPDATE ON model_failover_proof_artifacts
    BEGIN
      SELECT RAISE(ABORT, 'model_failover_proof_artifacts is append-only');
    END;

    CREATE TRIGGER trg_model_failover_proof_artifacts_append_only_delete
    BEFORE DELETE ON model_failover_proof_artifacts
    BEGIN
      SELECT RAISE(ABORT, 'model_failover_proof_artifacts is append-only');
    END;

    CREATE TRIGGER trg_model_failover_proofs_artifact_companion
    AFTER INSERT ON model_failover_proofs
    WHEN NEW.rowid > 0 AND NOT EXISTS (
      SELECT 1
      FROM model_failover_proof_artifacts artifact
      WHERE artifact.proof_id = NEW.proof_id
        AND artifact.validation_run_id = NEW.validation_run_id
        AND artifact.role = NEW.role
        AND artifact.suite = NEW.suite
        AND artifact.role_contract_sha256 = NEW.role_contract_sha256
        AND artifact.model_name = NEW.model_name
        AND artifact.model_canonical_name = NEW.model_canonical_name
        AND artifact.model_digest_sha256 = NEW.model_digest_sha256
        AND artifact.validation_version = NEW.validation_version
        AND artifact.policy_version = NEW.policy_version
        AND artifact.score = NEW.score
        AND artifact.required_score = NEW.required_score
        AND artifact.passed_count = NEW.passed_count
        AND artifact.required_passed_count = NEW.required_passed_count
        AND artifact.total_count = NEW.total_count
        AND artifact.duration_ms = NEW.duration_ms
        AND artifact.result = NEW.result
        AND artifact.inventory_before_name = NEW.inventory_before_name
        AND artifact.inventory_before_digest = NEW.inventory_before_digest
        AND artifact.inventory_after_name = NEW.inventory_after_name
        AND artifact.inventory_after_digest = NEW.inventory_after_digest
        AND artifact.measurement_started_at_ms = NEW.started_at_ms
        AND artifact.measurement_completed_at_ms = NEW.completed_at_ms
        AND artifact.expires_at_ms = NEW.expires_at_ms
        AND artifact.issued_at_ms = NEW.created_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT,
        'MODEL_FAILOVER_PROOF_ARTIFACT_MISMATCH: proof lacks exact evidence companion');
    END;

    DROP TRIGGER trg_model_failover_events_fallback_proof;
    DROP TRIGGER trg_model_failover_events_restore_proof;
    DROP TRIGGER trg_model_failover_state_active_proof_insert;
    DROP TRIGGER trg_model_failover_state_active_proof_update;

    CREATE TRIGGER trg_model_failover_events_fallback_proof
    BEFORE INSERT ON model_failover_events
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_failover_events existing
      WHERE existing.event_id = NEW.event_id
         OR (
           NEW.operation_id IS NOT NULL
           AND existing.operation_id = NEW.operation_id
           AND existing.event_type = NEW.event_type
         )
    )) AND (NEW.event_type IN ('ACTIVATED','REAPPLIED') AND NOT EXISTS (
      SELECT 1
      FROM model_failover_proofs proof
      JOIN model_failover_proof_artifacts artifact
        ON artifact.proof_id = proof.proof_id
      JOIN model_desired_bindings desired
        ON desired.role = NEW.role
       AND desired.binding_revision = NEW.binding_revision
      WHERE proof.proof_id = NEW.proof_id
        AND proof.role = NEW.role
        AND proof.model_canonical_name = NEW.fallback_canonical_name
        AND proof.model_digest_sha256 = NEW.fallback_digest_sha256
        AND proof.policy_version = NEW.policy_version
        AND proof.completed_at_ms <= NEW.created_at_ms
        AND proof.expires_at_ms > NEW.created_at_ms
        AND NEW.desired_model_name = desired.model_name
        AND NEW.desired_digest_sha256 = desired.digest_sha256
        AND proof.result = 'PASS'
    ))
    BEGIN
      SELECT RAISE(ABORT, 'verified fallback event requires matching fresh proof');
    END;

    CREATE TRIGGER trg_model_failover_events_restore_proof
    BEFORE INSERT ON model_failover_events
    WHEN NOT (NEW.seq <> -1 OR EXISTS (
      SELECT 1
      FROM model_failover_events existing
      WHERE existing.event_id = NEW.event_id
         OR (
           NEW.operation_id IS NOT NULL
           AND existing.operation_id = NEW.operation_id
           AND existing.event_type = NEW.event_type
         )
    )) AND (NEW.event_type = 'RESTORED' AND NOT EXISTS (
      SELECT 1
      FROM model_failover_proofs proof
      JOIN model_failover_proof_artifacts artifact
        ON artifact.proof_id = proof.proof_id
      JOIN model_desired_bindings desired
        ON desired.role = NEW.role
       AND desired.binding_revision = NEW.binding_revision
      WHERE proof.proof_id = NEW.proof_id
        AND proof.role = NEW.role
        AND proof.model_canonical_name = desired.canonical_name
        AND proof.model_digest_sha256 = desired.digest_sha256
        AND proof.policy_version = NEW.policy_version
        AND proof.completed_at_ms <= NEW.created_at_ms
        AND proof.expires_at_ms > NEW.created_at_ms
        AND NEW.desired_model_name = desired.model_name
        AND NEW.desired_digest_sha256 = desired.digest_sha256
        AND proof.result = 'PASS'
    ))
    BEGIN
      SELECT RAISE(ABORT, 'verified restore event requires matching fresh desired proof');
    END;

    CREATE TRIGGER trg_model_failover_state_active_proof_insert
    BEFORE INSERT ON model_failover_state
    WHEN NEW.active_failover = 1 AND NOT EXISTS (
      SELECT 1
      FROM model_failover_proofs proof
      JOIN model_failover_proof_artifacts artifact
        ON artifact.proof_id = proof.proof_id
      WHERE proof.proof_id = NEW.proof_id
        AND proof.role = NEW.role
        AND proof.model_canonical_name = NEW.fallback_canonical_name
        AND proof.model_digest_sha256 = NEW.fallback_digest_sha256
        AND proof.policy_version = NEW.policy_version
        AND proof.completed_at_ms <= NEW.proof_verified_at_ms
        AND proof.expires_at_ms > NEW.proof_verified_at_ms
        AND proof.result = 'PASS'
    )
    BEGIN
      SELECT RAISE(ABORT, 'active failover requires matching digest-bound proof');
    END;

    CREATE TRIGGER trg_model_failover_state_active_proof_update
    BEFORE UPDATE ON model_failover_state
    WHEN NEW.active_failover = 1 AND NOT EXISTS (
      SELECT 1
      FROM model_failover_proofs proof
      JOIN model_failover_proof_artifacts artifact
        ON artifact.proof_id = proof.proof_id
      WHERE proof.proof_id = NEW.proof_id
        AND proof.role = NEW.role
        AND proof.model_canonical_name = NEW.fallback_canonical_name
        AND proof.model_digest_sha256 = NEW.fallback_digest_sha256
        AND proof.policy_version = NEW.policy_version
        AND proof.completed_at_ms <= NEW.proof_verified_at_ms
        AND proof.expires_at_ms > NEW.proof_verified_at_ms
        AND proof.result = 'PASS'
    )
    BEGIN
      SELECT RAISE(ABORT, 'active failover requires matching digest-bound proof');
    END;
  `);
}
