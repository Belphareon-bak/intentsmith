import { createHash } from 'node:crypto';

import {
  EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V080,
} from './2026_08_24_080_m2_effect_semantic_authority.js';
import {
  EXPECTED_M2_EFFECT_INVALIDATION_SCHEMA_FINGERPRINT_V081,
  EXPECTED_M2_EFFECT_RESULT_SEMANTIC_V2_FINGERPRINT,
  computeM2EffectResultSemanticV2Fingerprint,
} from './2026_08_24_093_m2_effect_result_semantic_authority_v2.js';
import {
  computeM2EffectInvalidationSchemaFingerprint,
} from './2026_08_24_077_m2_effect_invalidations.js';
import {
  computeM2EffectCoreFingerprintV073,
} from '../m2-effect-core-v073-prerequisite.js';

export const version = '2026_08_25_094_m2_preexecution_approval_terminals';
export const description = 'Close expired or revoked unstarted approvals with durable cancellation truth';

// Filled from canonical sqlite_master projections after this migration.
export const EXPECTED_M2_PREEXECUTION_TERMINAL_FINGERPRINT_V082 = 'f9eab072777369a91bd388f16da00ec6aa7998a08476b26197b9146e2d11b917';
export const EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V082 = '912a9bf368e934609a876450c34938883f8b9565fc443fea19e977dc379346c5';

const OBJECT_NAMES = Object.freeze([
  'm2_effect_preexecution_terminal_claims',
  'trg_m2_effect_preexecution_terminal_claims_exact',
  'trg_m2_effect_preexecution_terminal_claims_append_only_update',
  'trg_m2_effect_preexecution_terminal_claims_append_only_delete',
  'trg_m2_effect_execution_claims_preexecution_terminal_fence',
  'trg_m2_approval_grants_preexecution_terminal_fence',
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

export function computeM2PreexecutionTerminalFingerprintV082(db) {
  return fingerprint(db, OBJECT_NAMES);
}

function installPreexecutionTerminalAuthority(db) {
  db.exec(`
    CREATE TABLE m2_effect_preexecution_terminal_claims (
      effect_id TEXT PRIMARY KEY
        REFERENCES m2_effect_requests(effect_id) ON DELETE RESTRICT,
      grant_id TEXT NOT NULL UNIQUE
        REFERENCES m2_approval_grants(grant_id) ON DELETE RESTRICT,
      request_digest TEXT NOT NULL,
      reason_code TEXT NOT NULL CHECK (
        reason_code IN ('APPROVAL_GRANT_EXPIRED', 'APPROVAL_GRANT_REVOKED')
      ),
      claimed_at_ms INTEGER NOT NULL CHECK (
        typeof(claimed_at_ms) = 'integer' AND claimed_at_ms >= 0
      )
    );

    CREATE TRIGGER trg_m2_effect_preexecution_terminal_claims_exact
    BEFORE INSERT ON m2_effect_preexecution_terminal_claims
    WHEN NOT EXISTS (
      SELECT 1
      FROM m2_effect_requests request
      JOIN m2_approval_grants grant ON grant.effect_id = request.effect_id
      WHERE request.effect_id = NEW.effect_id
        AND request.request_digest = NEW.request_digest
        AND request.created_at_ms <= NEW.claimed_at_ms
        AND grant.grant_id = NEW.grant_id
        AND grant.consumed_at_ms IS NULL
        AND grant.consumed_by_effect_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM m2_effect_execution_claims execution
          WHERE execution.effect_id = NEW.effect_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM m2_effect_results result
          WHERE result.effect_id = NEW.effect_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM m2_effect_invalidations invalidation
          WHERE invalidation.effect_id = NEW.effect_id
        )
        AND (
          (NEW.reason_code = 'APPROVAL_GRANT_EXPIRED'
            AND grant.revoked_at_ms IS NULL
            AND grant.expires_at_ms <= NEW.claimed_at_ms)
          OR
          (NEW.reason_code = 'APPROVAL_GRANT_REVOKED'
            AND grant.revoked_at_ms IS NOT NULL
            AND grant.revoked_at_ms <= NEW.claimed_at_ms)
        )
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_PREEXECUTION_TERMINAL_AUTHORITY_MISMATCH');
    END;

    CREATE TRIGGER trg_m2_effect_preexecution_terminal_claims_append_only_update
    BEFORE UPDATE ON m2_effect_preexecution_terminal_claims
    BEGIN
      SELECT RAISE(ABORT, 'm2_effect_preexecution_terminal_claims is append-only');
    END;

    CREATE TRIGGER trg_m2_effect_preexecution_terminal_claims_append_only_delete
    BEFORE DELETE ON m2_effect_preexecution_terminal_claims
    BEGIN
      SELECT RAISE(ABORT, 'm2_effect_preexecution_terminal_claims is append-only');
    END;

    CREATE TRIGGER trg_m2_effect_execution_claims_preexecution_terminal_fence
    BEFORE INSERT ON m2_effect_execution_claims
    WHEN EXISTS (
      SELECT 1 FROM m2_effect_preexecution_terminal_claims terminal
      WHERE terminal.effect_id = NEW.effect_id
        AND terminal.grant_id = NEW.grant_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_PREEXECUTION_TERMINAL_ALREADY_CLAIMED');
    END;

    CREATE TRIGGER trg_m2_approval_grants_preexecution_terminal_fence
    BEFORE UPDATE ON m2_approval_grants
    WHEN EXISTS (
      SELECT 1 FROM m2_effect_preexecution_terminal_claims terminal
      WHERE terminal.effect_id = OLD.effect_id
        AND terminal.grant_id = OLD.grant_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_PREEXECUTION_TERMINAL_ALREADY_CLAIMED');
    END;

    DROP TRIGGER trg_m2_effect_results_authority;
    CREATE TRIGGER trg_m2_effect_results_authority
    BEFORE INSERT ON m2_effect_results
    WHEN NOT EXISTS (
      SELECT 1
      FROM m2_approval_grants grant
      JOIN m2_effect_execution_claims claim
        ON claim.effect_id = grant.effect_id AND claim.grant_id = grant.grant_id
      WHERE grant.grant_id = NEW.approval_grant_id
        AND grant.effect_id = NEW.effect_id
        AND grant.run_id = NEW.run_id
        AND grant.project_id = NEW.project_id
        AND grant.consumed_at_ms IS NOT NULL
        AND grant.consumed_by_effect_id = NEW.effect_id
        AND grant.revoked_at_ms IS NULL
        AND coalesce(json_extract(NEW.result_json, '$.errorCode'), '')
          NOT IN ('APPROVAL_GRANT_EXPIRED', 'APPROVAL_GRANT_REVOKED')
        AND (
          CAST(strftime('%s', json_extract(NEW.result_json, '$.startedAt')) AS INTEGER) * 1000
          + CAST(substr(json_extract(NEW.result_json, '$.startedAt'), 21, 3) AS INTEGER)
        ) >= claim.claimed_at_ms
    ) AND NOT EXISTS (
      SELECT 1
      FROM m2_effect_preexecution_terminal_claims terminal
      JOIN m2_approval_grants grant ON grant.grant_id = terminal.grant_id
      WHERE terminal.effect_id = NEW.effect_id
        AND terminal.grant_id = NEW.approval_grant_id
        AND terminal.request_digest = NEW.request_digest
        AND grant.effect_id = NEW.effect_id
        AND grant.run_id = NEW.run_id
        AND grant.project_id = NEW.project_id
        AND grant.consumed_at_ms IS NULL
        AND grant.consumed_by_effect_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM m2_effect_execution_claims execution
          WHERE execution.effect_id = NEW.effect_id
        )
        AND json_extract(NEW.result_json, '$.terminalStatus') = 'cancelled'
        AND json_extract(NEW.result_json, '$.errorCode') = terminal.reason_code
        AND (
          CAST(strftime('%s', json_extract(NEW.result_json, '$.startedAt')) AS INTEGER) * 1000
          + CAST(substr(json_extract(NEW.result_json, '$.startedAt'), 21, 3) AS INTEGER)
        ) = terminal.claimed_at_ms
        AND NEW.completed_at_ms = (
          CAST(strftime('%s', json_extract(NEW.result_json, '$.completedAt')) AS INTEGER) * 1000
          + CAST(substr(json_extract(NEW.result_json, '$.completedAt'), 21, 3) AS INTEGER)
        )
        AND NEW.completed_at_ms >= terminal.claimed_at_ms
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_RESULT_AUTHORITY_MISSING');
    END;
  `);
}

export function up(db) {
  const preexecution = computeM2PreexecutionTerminalFingerprintV082(db);
  const effectCore = computeM2EffectCoreFingerprintV073(db);
  const invalidation = computeM2EffectInvalidationSchemaFingerprint(db);
  const semantics = computeM2EffectResultSemanticV2Fingerprint(db);
  if (preexecution === EXPECTED_M2_PREEXECUTION_TERMINAL_FINGERPRINT_V082) {
    if (
      effectCore !== EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V082
      || invalidation !== EXPECTED_M2_EFFECT_INVALIDATION_SCHEMA_FINGERPRINT_V081
      || semantics !== EXPECTED_M2_EFFECT_RESULT_SEMANTIC_V2_FINGERPRINT
    ) throw new Error('M2_PREEXECUTION_TERMINAL_082_INSTALLED_SCHEMA_FINGERPRINT_MISMATCH');
    return;
  }
  if (effectCore !== EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V080) {
    throw new Error('M2_PREEXECUTION_TERMINAL_082_EFFECT_CORE_SOURCE_FINGERPRINT_MISMATCH');
  }
  if (
    invalidation !== EXPECTED_M2_EFFECT_INVALIDATION_SCHEMA_FINGERPRINT_V081
    || semantics !== EXPECTED_M2_EFFECT_RESULT_SEMANTIC_V2_FINGERPRINT
  ) throw new Error('M2_PREEXECUTION_TERMINAL_082_SEMANTIC_SOURCE_FINGERPRINT_MISMATCH');

  const existing = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name = 'm2_effect_preexecution_terminal_claims'
       OR name GLOB 'trg_m2_effect_preexecution_terminal_claims_*'
  `).get().count;
  if (existing !== 0) {
    throw new Error('M2_PREEXECUTION_TERMINAL_082_SOURCE_SCHEMA_FINGERPRINT_MISMATCH');
  }

  installPreexecutionTerminalAuthority(db);
  const installedPreexecution = computeM2PreexecutionTerminalFingerprintV082(db);
  const installedCore = computeM2EffectCoreFingerprintV073(db);
  if (installedPreexecution !== EXPECTED_M2_PREEXECUTION_TERMINAL_FINGERPRINT_V082) {
    throw new Error(`M2_PREEXECUTION_TERMINAL_082_FINAL_SCHEMA_FINGERPRINT_MISMATCH:${installedPreexecution}`);
  }
  if (installedCore !== EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V082) {
    throw new Error(`M2_PREEXECUTION_TERMINAL_082_FINAL_EFFECT_CORE_FINGERPRINT_MISMATCH:${installedCore}`);
  }
}

export default { version, description, up };
