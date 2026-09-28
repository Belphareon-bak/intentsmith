import {
  validateApprovalGrantForRequest,
} from '../../../contracts/m2/effect-v1.js';
import {
  EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V077,
  computeM2EffectCoreFingerprintV073,
} from '../m2-effect-core-v073-prerequisite.js';

export const version = '2026_08_24_080_m2_effect_semantic_authority';
export const description = 'Bind approval grant constraints to immutable effect requests';

// Filled from the canonical sqlite_master projection after this migration.
export const EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V080 = 'd100945c46e38aee2ad2c25226ed5c9a44ae35bb880cf612d1f2537adcfd9203';

export function registerM2ApprovalGrantSemanticFunction(db) {
  db.function('m2_approval_grant_matches_request_v1', {
    deterministic: true,
  }, (requestJson, grantJson) => {
    try {
      return validateApprovalGrantForRequest(
        JSON.parse(requestJson),
        JSON.parse(grantJson),
      ).valid ? 1 : 0;
    } catch {
      return 0;
    }
  });
}

function installSemanticGrantTrigger(db) {
  db.exec(`
    DROP TRIGGER trg_m2_approval_grants_exact_scope;
    CREATE TRIGGER trg_m2_approval_grants_exact_scope
    BEFORE INSERT ON m2_approval_grants
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_effect_requests request
      WHERE request.effect_id = NEW.effect_id
        AND request.run_id = NEW.run_id
        AND request.project_id = NEW.project_id
        AND request.kind = NEW.kind
        AND request.payload_digest = NEW.payload_digest
        AND request.payload_bytes = NEW.payload_bytes
        AND request.workspace_revision = NEW.workspace_revision
        AND json_extract(request.request_json, '$.actor.type') = 'user'
        AND json_extract(request.request_json, '$.actor.id') = json_extract(NEW.grant_json, '$.subject.actorId')
        AND json_extract(NEW.grant_json, '$.subject.actorType') = 'user'
        AND m2_approval_grant_matches_request_v1(
          request.request_json,
          NEW.grant_json
        ) = 1
        AND NOT EXISTS (
          SELECT 1 FROM m2_effect_results result WHERE result.effect_id = request.effect_id
        )
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_APPROVAL_GRANT_SCOPE_MISMATCH');
    END;
  `);
}

export function up(db) {
  registerM2ApprovalGrantSemanticFunction(db);
  const current = computeM2EffectCoreFingerprintV073(db);
  if (current === EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V080) return;
  if (current !== EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V077) {
    throw new Error('M2_EFFECT_SEMANTIC_AUTHORITY_080_SOURCE_SCHEMA_FINGERPRINT_MISMATCH');
  }

  const invalid = db.prepare(`
    SELECT grant.grant_id AS grantId
    FROM m2_approval_grants grant
    JOIN m2_effect_requests request ON request.effect_id = grant.effect_id
    WHERE m2_approval_grant_matches_request_v1(
      request.request_json,
      grant.grant_json
    ) <> 1
    LIMIT 1
  `).get();
  if (invalid) {
    throw new Error(`M2_EFFECT_SEMANTIC_AUTHORITY_080_EXISTING_GRANT_INVALID:${invalid.grantId}`);
  }

  installSemanticGrantTrigger(db);
  const installed = computeM2EffectCoreFingerprintV073(db);
  if (installed !== EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V080) {
    throw new Error(`M2_EFFECT_SEMANTIC_AUTHORITY_080_FINAL_SCHEMA_FINGERPRINT_MISMATCH:${installed}`);
  }
}

export default { version, description, up };
