import { createHash } from 'node:crypto';

import {
  rollbackObservationMatchesJson,
} from '../../effects/effect-rollback-settlement.js';
import {
  EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V082,
  EXPECTED_M2_PREEXECUTION_TERMINAL_FINGERPRINT_V082,
  computeM2PreexecutionTerminalFingerprintV082,
} from './2026_08_25_094_m2_preexecution_approval_terminals.js';
import {
  computeM2EffectCoreFingerprintV073,
} from '../m2-effect-core-v073-prerequisite.js';
import {
  EXPECTED_M2_EXECUTION_SCHEMA_FINGERPRINT,
  computeM2ExecutionSchemaFingerprint,
} from './2026_08_24_078_m2_execution_authority.js';

export const version = '2026_08_25_095_m2_effect_rollback_receipts';
export const description = 'Record append-only standalone effect rollback observations';

// Filled from canonical sqlite_master projections after this migration.
export const EXPECTED_M2_EFFECT_ROLLBACK_RECEIPT_FINGERPRINT_V083 = '5189082bdc43e30795d16f8539a3883e71c82aa538568db3ede765da0947e478';

const OBJECT_NAMES = Object.freeze([
  'm2_effect_rollback_receipts',
  'trg_m2_effect_rollback_receipts_exact',
  'trg_m2_effect_rollback_receipts_append_only_update',
  'trg_m2_effect_rollback_receipts_append_only_delete',
]);

function fingerprint(db, names) {
  const expected = new Set(names);
  const rows = db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL
    ORDER BY type, name
  `).all()
    .filter(row => expected.has(row.name))
    .map(row => ({
      type: row.type,
      name: row.name,
      sql: row.sql.replace(/\s+/g, ' ').trim(),
    }));
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

export function computeM2EffectRollbackReceiptFingerprintV083(db) {
  return fingerprint(db, OBJECT_NAMES);
}

export function registerM2EffectRollbackReceiptFunction(db) {
  db.function('m2_effect_rollback_observation_matches_v1', {
    deterministic: true,
  }, rollbackObservationMatchesJson);
}

function installRollbackReceiptAuthority(db) {
  db.exec(`
    CREATE TABLE m2_effect_rollback_receipts (
      effect_id TEXT PRIMARY KEY
        REFERENCES m2_effect_results(effect_id) ON DELETE RESTRICT,
      request_digest TEXT NOT NULL,
      result_digest TEXT NOT NULL,
      observation_code TEXT NOT NULL CHECK (
        observation_code IN ('matches_forward', 'matches_before', 'foreign')
      ),
      observed_exists INTEGER NOT NULL CHECK (observed_exists IN (0, 1)),
      observed_digest TEXT,
      observed_at_ms INTEGER NOT NULL CHECK (
        typeof(observed_at_ms) = 'integer' AND observed_at_ms >= 0
      ),
      evidence_ref TEXT NOT NULL UNIQUE,
      CHECK (
        (observed_exists = 0 AND observed_digest IS NULL)
        OR
        (observed_exists = 1
          AND length(observed_digest) = 71
          AND substr(observed_digest, 1, 7) = 'sha256:')
      )
    );

    CREATE TRIGGER trg_m2_effect_rollback_receipts_exact
    BEFORE INSERT ON m2_effect_rollback_receipts
    WHEN NOT EXISTS (
      SELECT 1
      FROM m2_effect_results result
      JOIN m2_effect_requests request ON request.effect_id = result.effect_id
      WHERE result.effect_id = NEW.effect_id
        AND result.request_digest = NEW.request_digest
        AND NEW.result_digest = m2_effect_result_json_digest_v1(result.result_json)
        AND json_extract(request.request_json, '$.kind') = 'fs.write'
        AND json_extract(result.result_json, '$.rollback.required') = 1
        AND json_extract(result.result_json, '$.rollback.status') = 'pending'
        AND NEW.observed_at_ms >= result.completed_at_ms
        AND NEW.evidence_ref = 'effect:' || NEW.effect_id
          || ':rollback-observation:' || NEW.observation_code
        AND NOT EXISTS (
          SELECT 1 FROM m2_execution_files execution_file
          WHERE execution_file.forward_effect_id = NEW.effect_id
             OR execution_file.rollback_effect_id = NEW.effect_id
        )
        AND m2_effect_rollback_observation_matches_v1(
          request.request_json,
          result.result_json,
          NEW.observation_code,
          NEW.observed_exists,
          NEW.observed_digest
        ) = 1
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_ROLLBACK_RECEIPT_AUTHORITY_MISMATCH');
    END;

    CREATE TRIGGER trg_m2_effect_rollback_receipts_append_only_update
    BEFORE UPDATE ON m2_effect_rollback_receipts
    BEGIN
      SELECT RAISE(ABORT, 'm2_effect_rollback_receipts is append-only');
    END;

    CREATE TRIGGER trg_m2_effect_rollback_receipts_append_only_delete
    BEFORE DELETE ON m2_effect_rollback_receipts
    BEGIN
      SELECT RAISE(ABORT, 'm2_effect_rollback_receipts is append-only');
    END;
  `);
}

export function up(db) {
  registerM2EffectRollbackReceiptFunction(db);
  const current = computeM2EffectRollbackReceiptFingerprintV083(db);
  const effectCore = computeM2EffectCoreFingerprintV073(db);
  const preexecution = computeM2PreexecutionTerminalFingerprintV082(db);
  const execution = computeM2ExecutionSchemaFingerprint(db);
  if (current === EXPECTED_M2_EFFECT_ROLLBACK_RECEIPT_FINGERPRINT_V083) {
    if (
      effectCore !== EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V082
      || preexecution !== EXPECTED_M2_PREEXECUTION_TERMINAL_FINGERPRINT_V082
      || execution !== EXPECTED_M2_EXECUTION_SCHEMA_FINGERPRINT
    ) throw new Error('M2_EFFECT_ROLLBACK_RECEIPT_083_INSTALLED_SCHEMA_FINGERPRINT_MISMATCH');
    return;
  }
  if (
    effectCore !== EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V082
    || preexecution !== EXPECTED_M2_PREEXECUTION_TERMINAL_FINGERPRINT_V082
    || execution !== EXPECTED_M2_EXECUTION_SCHEMA_FINGERPRINT
  ) throw new Error('M2_EFFECT_ROLLBACK_RECEIPT_083_SOURCE_SCHEMA_FINGERPRINT_MISMATCH');
  const existing = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name = 'm2_effect_rollback_receipts'
       OR name GLOB 'trg_m2_effect_rollback_receipts_*'
  `).get().count;
  if (existing !== 0) {
    throw new Error('M2_EFFECT_ROLLBACK_RECEIPT_083_SOURCE_OBJECT_MISMATCH');
  }

  installRollbackReceiptAuthority(db);
  const installed = computeM2EffectRollbackReceiptFingerprintV083(db);
  if (installed !== EXPECTED_M2_EFFECT_ROLLBACK_RECEIPT_FINGERPRINT_V083) {
    throw new Error(`M2_EFFECT_ROLLBACK_RECEIPT_083_FINAL_SCHEMA_FINGERPRINT_MISMATCH:${installed}`);
  }
}

export default { version, description, up };
