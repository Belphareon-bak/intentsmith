import { createHash } from 'node:crypto';

import {
  validateEffectRequest,
  validateEffectResultForRequestV1,
} from '../../../contracts/m2/effect-v1.js';
import { expectedM2EffectOperationKey } from '../../tools/m2-tool-registry.js';
import {
  EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V073,
  EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V077,
  computeM2EffectCoreFingerprintV073,
} from '../m2-effect-core-v073-prerequisite.js';

export const version = '2026_08_24_077_m2_effect_invalidations';
export const description = 'Invalidate poisoned pending effects and enforce kind-specific terminal evidence';

export const EXPECTED_M2_EFFECT_INVALIDATION_SCHEMA_FINGERPRINT = '67eb1e9a80e4a3c0eea379dffa1817f70dee7f674c7c2728fdf4cefba289e9cb';

function resultMatchesRequest(requestJson, resultJson) {
  try {
    const request = JSON.parse(requestJson);
    const result = JSON.parse(resultJson);
    return validateEffectRequest(request).valid
      && validateEffectResultForRequestV1(request, result).valid
      ? 1
      : 0;
  } catch {
    return 0;
  }
}

export function registerM2EffectSemanticFunction(db) {
  db.function('m2_effect_result_matches_request_v1', {
    deterministic: true,
  }, resultMatchesRequest);
  db.function('m2_tool_effect_operation_key_matches_v1', {
    deterministic: true,
  }, (toolRequestJson, effectRequestJson) => {
    try {
      const toolRequest = JSON.parse(toolRequestJson);
      const effectRequest = JSON.parse(effectRequestJson);
      return effectRequest.idempotencyKey === expectedM2EffectOperationKey(toolRequest) ? 1 : 0;
    } catch {
      return 0;
    }
  });
  db.function('m2_tool_effect_operation_key_equals_v1', {
    deterministic: true,
  }, (toolRequestJson, operationKey) => {
    try {
      return expectedM2EffectOperationKey(JSON.parse(toolRequestJson)) === operationKey ? 1 : 0;
    } catch {
      return 0;
    }
  });
}

export function computeM2EffectInvalidationSchemaFingerprint(db) {
  const rows = db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL AND (
      name = 'm2_effect_invalidations'
      OR name GLOB 'trg_m2_effect_invalidation_*'
      OR name = 'm2_tool_effect_operation_invalidations'
      OR name GLOB 'trg_m2_tool_effect_operation_invalidation_*'
      OR name = 'trg_m2_effect_results_semantic_authority'
      OR name = 'trg_m2_pending_payload_terminal_delete'
    )
    ORDER BY type, name
  `).all().map(row => ({
    type: row.type,
    name: row.name,
    sql: row.sql.replace(/\s+/g, ' ').trim(),
  }));
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

export function up(db) {
  registerM2EffectSemanticFunction(db);
  const current = computeM2EffectInvalidationSchemaFingerprint(db);
  const effectCore = computeM2EffectCoreFingerprintV073(db);
  if (current === EXPECTED_M2_EFFECT_INVALIDATION_SCHEMA_FINGERPRINT) {
    if (effectCore !== EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V077) {
      throw new Error('M2_EFFECT_INVALIDATION_077_EFFECT_CORE_SCHEMA_FINGERPRINT_MISMATCH');
    }
    return;
  }
  if (effectCore !== EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V073) {
    throw new Error('M2_EFFECT_INVALIDATION_077_EFFECT_CORE_SCHEMA_FINGERPRINT_MISMATCH');
  }
  const existing = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master WHERE
      name = 'm2_effect_invalidations'
      OR name GLOB 'trg_m2_effect_invalidation_*'
      OR name = 'm2_tool_effect_operation_invalidations'
      OR name GLOB 'trg_m2_tool_effect_operation_invalidation_*'
      OR name = 'trg_m2_effect_results_semantic_authority'
  `).get().count;
  if (existing !== 0) {
    throw new Error('M2_EFFECT_INVALIDATION_077_SOURCE_SCHEMA_FINGERPRINT_MISMATCH');
  }

  // Existing pre-acceptance terminals must already satisfy the semantic
  // authority that all subsequent direct-SQL inserts will enforce.
  const invalid = db.prepare(`
    SELECT result.effect_id
    FROM m2_effect_results result
    JOIN m2_effect_requests request ON request.effect_id = result.effect_id
    WHERE m2_effect_result_matches_request_v1(
      request.request_json,
      result.result_json
    ) <> 1
    LIMIT 1
  `).get();
  if (invalid) {
    throw new Error(`M2_EFFECT_INVALIDATION_077_EXISTING_RESULT_INVALID:${invalid.effect_id}`);
  }

  db.exec(`
    CREATE TABLE m2_effect_invalidations (
      effect_id TEXT PRIMARY KEY REFERENCES m2_effect_requests(effect_id) ON DELETE RESTRICT,
      request_digest TEXT NOT NULL,
      source_tool_request_id TEXT NOT NULL CHECK (length(source_tool_request_id) BETWEEN 1 AND 128),
      reason_code TEXT NOT NULL CHECK (
        length(reason_code) BETWEEN 1 AND 64
        AND reason_code GLOB '[A-Z]*'
        AND reason_code NOT GLOB '*[^A-Z0-9_:-]*'
      ),
      invalidated_at_ms INTEGER NOT NULL CHECK (
        typeof(invalidated_at_ms) = 'integer' AND invalidated_at_ms >= 0
      )
    );

    CREATE TABLE m2_tool_effect_operation_invalidations (
      source_tool_request_id TEXT PRIMARY KEY
        REFERENCES tool_v1_requests(request_id) ON DELETE RESTRICT,
      tool_request_digest TEXT NOT NULL,
      run_id TEXT NOT NULL CHECK (length(trim(run_id)) BETWEEN 1 AND 128),
      project_id INTEGER NOT NULL CHECK (typeof(project_id) = 'integer' AND project_id > 0),
      effect_idempotency_key TEXT NOT NULL
        CHECK (length(trim(effect_idempotency_key)) BETWEEN 1 AND 128),
      reason_code TEXT NOT NULL CHECK (
        length(reason_code) BETWEEN 1 AND 64
        AND reason_code GLOB '[A-Z]*'
        AND reason_code NOT GLOB '*[^A-Z0-9_:-]*'
      ),
      invalidated_at_ms INTEGER NOT NULL CHECK (
        typeof(invalidated_at_ms) = 'integer' AND invalidated_at_ms >= 0
      )
    );

    CREATE TRIGGER trg_m2_tool_effect_operation_invalidation_exact_authority
    BEFORE INSERT ON m2_tool_effect_operation_invalidations
    WHEN NOT EXISTS (
      SELECT 1
      FROM tool_v1_requests tool
      WHERE tool.request_id = NEW.source_tool_request_id
        AND tool.request_digest = NEW.tool_request_digest
        AND tool.run_id = NEW.run_id
        AND tool.project_id = NEW.project_id
        AND json_extract(tool.request_json, '$.authorityMode') = 'effect'
        AND tool.created_at_ms <= NEW.invalidated_at_ms
        AND NOT EXISTS (
          SELECT 1 FROM tool_v1_results result
          WHERE result.request_id = tool.request_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM m2_tool_effect_links link
          WHERE link.request_id = tool.request_id
        )
        AND m2_tool_effect_operation_key_equals_v1(
          tool.request_json,
          NEW.effect_idempotency_key
        ) = 1
        AND NOT EXISTS (
          SELECT 1
          FROM m2_effect_requests effect
          WHERE effect.run_id = NEW.run_id
            AND effect.idempotency_key = NEW.effect_idempotency_key
            AND (
              effect.created_at_ms > NEW.invalidated_at_ms
              OR EXISTS (
                SELECT 1
                FROM m2_effect_invalidations invalidation
                WHERE invalidation.effect_id = effect.effect_id
                  AND (
                    invalidation.request_digest <> effect.request_digest
                    OR invalidation.source_tool_request_id <> NEW.source_tool_request_id
                    OR invalidation.reason_code <> NEW.reason_code
                  )
              )
              OR
              EXISTS (SELECT 1 FROM m2_approval_grants grant WHERE grant.effect_id = effect.effect_id)
              OR EXISTS (SELECT 1 FROM m2_effect_results result WHERE result.effect_id = effect.effect_id)
            )
        )
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_TOOL_EFFECT_OPERATION_INVALIDATION_AUTHORITY_MISMATCH');
    END;

    CREATE TRIGGER trg_m2_tool_effect_operation_invalidation_append_only_update
    BEFORE UPDATE ON m2_tool_effect_operation_invalidations
    BEGIN
      SELECT RAISE(ABORT, 'm2_tool_effect_operation_invalidations is append-only');
    END;

    CREATE TRIGGER trg_m2_tool_effect_operation_invalidation_append_only_delete
    BEFORE DELETE ON m2_tool_effect_operation_invalidations
    BEGIN
      SELECT RAISE(ABORT, 'm2_tool_effect_operation_invalidations is append-only');
    END;

    CREATE TRIGGER trg_m2_tool_effect_operation_invalidation_neutralizes_existing_effect
    AFTER INSERT ON m2_tool_effect_operation_invalidations
    BEGIN
      INSERT OR IGNORE INTO m2_effect_invalidations (
        effect_id, request_digest, source_tool_request_id, reason_code, invalidated_at_ms
      )
      SELECT
        effect.effect_id,
        effect.request_digest,
        NEW.source_tool_request_id,
        NEW.reason_code,
        NEW.invalidated_at_ms
      FROM m2_effect_requests effect
      WHERE effect.run_id = NEW.run_id
        AND effect.project_id = NEW.project_id
        AND effect.idempotency_key = NEW.effect_idempotency_key;

      DELETE FROM m2_pending_effect_payloads
      WHERE effect_id IN (
        SELECT effect.effect_id
        FROM m2_effect_requests effect
        WHERE effect.run_id = NEW.run_id
          AND effect.project_id = NEW.project_id
          AND effect.idempotency_key = NEW.effect_idempotency_key
      );
    END;

    CREATE TRIGGER trg_m2_tool_effect_operation_invalidation_blocks_late_request
    BEFORE INSERT ON m2_effect_requests
    WHEN EXISTS (
      SELECT 1
      FROM m2_tool_effect_operation_invalidations invalidation
      WHERE invalidation.run_id = NEW.run_id
        AND invalidation.project_id = NEW.project_id
        AND invalidation.effect_idempotency_key = NEW.idempotency_key
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_TOOL_EFFECT_OPERATION_INVALIDATED');
    END;

    CREATE TRIGGER trg_m2_effect_invalidation_exact_authority
    BEFORE INSERT ON m2_effect_invalidations
    WHEN NOT EXISTS (
      SELECT 1
      FROM m2_effect_requests effect
      JOIN tool_v1_requests tool ON tool.request_id = NEW.source_tool_request_id
      WHERE effect.effect_id = NEW.effect_id
        AND effect.request_digest = NEW.request_digest
        AND effect.run_id = tool.run_id
        AND effect.project_id IS tool.project_id
        AND effect.created_at_ms <= NEW.invalidated_at_ms
        AND m2_tool_effect_operation_key_matches_v1(
          tool.request_json,
          effect.request_json
        ) = 1
        AND NOT EXISTS (
          SELECT 1 FROM m2_tool_effect_links link WHERE link.effect_id = effect.effect_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM m2_approval_grants grant WHERE grant.effect_id = effect.effect_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM m2_effect_results result WHERE result.effect_id = effect.effect_id
        )
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_INVALIDATION_AUTHORITY_MISMATCH');
    END;

    CREATE TRIGGER trg_m2_effect_invalidation_neutralizes_pending
    AFTER INSERT ON m2_effect_invalidations
    BEGIN
      DELETE FROM m2_pending_effect_payloads
      WHERE effect_id = NEW.effect_id;
    END;

    CREATE TRIGGER trg_m2_effect_invalidation_append_only_update
    BEFORE UPDATE ON m2_effect_invalidations
    BEGIN
      SELECT RAISE(ABORT, 'm2_effect_invalidations is append-only');
    END;

    CREATE TRIGGER trg_m2_effect_invalidation_append_only_delete
    BEFORE DELETE ON m2_effect_invalidations
    BEGIN
      SELECT RAISE(ABORT, 'm2_effect_invalidations is append-only');
    END;

    CREATE TRIGGER trg_m2_effect_invalidation_blocks_grant
    BEFORE INSERT ON m2_approval_grants
    WHEN EXISTS (
      SELECT 1 FROM m2_effect_invalidations invalidation
      WHERE invalidation.effect_id = NEW.effect_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_INVALIDATED');
    END;

    CREATE TRIGGER trg_m2_effect_invalidation_blocks_pending
    BEFORE INSERT ON m2_pending_effect_payloads
    WHEN EXISTS (
      SELECT 1 FROM m2_effect_invalidations invalidation
      WHERE invalidation.effect_id = NEW.effect_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_INVALIDATED');
    END;

    CREATE TRIGGER trg_m2_effect_invalidation_blocks_result
    BEFORE INSERT ON m2_effect_results
    WHEN EXISTS (
      SELECT 1 FROM m2_effect_invalidations invalidation
      WHERE invalidation.effect_id = NEW.effect_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_INVALIDATED');
    END;

    CREATE TRIGGER trg_m2_effect_invalidation_blocks_tool_link
    BEFORE INSERT ON m2_tool_effect_links
    WHEN EXISTS (
      SELECT 1 FROM m2_effect_invalidations invalidation
      WHERE invalidation.effect_id = NEW.effect_id
    ) OR EXISTS (
      SELECT 1 FROM m2_tool_effect_operation_invalidations invalidation
      WHERE invalidation.source_tool_request_id = NEW.request_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_TOOL_EFFECT_OPERATION_INVALIDATED');
    END;

    CREATE TRIGGER trg_m2_tool_effect_operation_invalidation_requires_neutral_terminal
    BEFORE INSERT ON tool_v1_results
    WHEN NEW.effect_request_id IS NULL AND EXISTS (
      SELECT 1
      FROM tool_v1_requests tool
      JOIN m2_effect_requests effect
        ON effect.run_id = tool.run_id
       AND effect.project_id IS tool.project_id
      WHERE tool.request_id = NEW.request_id
        AND json_extract(tool.request_json, '$.authorityMode') = 'effect'
        AND m2_tool_effect_operation_key_matches_v1(
          tool.request_json,
          effect.request_json
        ) = 1
        AND NOT EXISTS (
          SELECT 1
          FROM m2_effect_invalidations invalidation
          WHERE invalidation.effect_id = effect.effect_id
            AND invalidation.request_digest = effect.request_digest
            AND invalidation.source_tool_request_id = tool.request_id
        )
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_TOOL_EFFECT_TERMINAL_WITH_LIVE_AUTHORITY');
    END;

    CREATE TRIGGER trg_m2_effect_results_semantic_authority
    BEFORE INSERT ON m2_effect_results
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_effect_requests request
      WHERE request.effect_id = NEW.effect_id
        AND m2_effect_result_matches_request_v1(
          request.request_json,
          NEW.result_json
        ) = 1
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_RESULT_SEMANTIC_AUTHORITY_MISMATCH');
    END;

    DROP TRIGGER trg_m2_pending_payload_terminal_delete;

    CREATE TRIGGER trg_m2_pending_payload_terminal_delete
    BEFORE DELETE ON m2_pending_effect_payloads
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_effect_results result WHERE result.effect_id = OLD.effect_id
    ) AND NOT EXISTS (
      SELECT 1 FROM m2_effect_invalidations invalidation
      WHERE invalidation.effect_id = OLD.effect_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_PENDING_EFFECT_PAYLOAD_IS_ACTIVE');
    END;
  `);

  if (
    computeM2EffectInvalidationSchemaFingerprint(db)
    !== EXPECTED_M2_EFFECT_INVALIDATION_SCHEMA_FINGERPRINT
  ) throw new Error('M2_EFFECT_INVALIDATION_077_FINAL_SCHEMA_FINGERPRINT_MISMATCH');
  if (computeM2EffectCoreFingerprintV073(db) !== EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V077) {
    throw new Error('M2_EFFECT_INVALIDATION_077_FINAL_EFFECT_CORE_FINGERPRINT_MISMATCH');
  }
}

export default { version, description, up };
