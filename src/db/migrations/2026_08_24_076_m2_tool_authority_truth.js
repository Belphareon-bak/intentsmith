import { createHash } from 'node:crypto';

import {
  canonicalizeM2ToolValue,
  validateM2ToolRequest,
  validateM2ToolResult,
} from '../../../contracts/m2/tool-v1.js';
import {
  validateEffectRequest,
  validateEffectResultForRequest,
} from '../../../contracts/m2/effect-v1.js';
import {
  getM2ToolDescriptor,
  expectedM2EffectOperationKey,
  projectM2EffectToolTerminal,
} from '../../tools/m2-tool-registry.js';
import {
  EXPECTED_TOOL_V1_SCHEMA_FINGERPRINT,
  computeToolV1SchemaFingerprint,
} from './2026_08_24_074_m2_tool_authority.js';
import {
  EXPECTED_M2_TOOL_EFFECT_LINK_SCHEMA_FINGERPRINT,
  computeM2ToolEffectLinkSchemaFingerprint,
} from './2026_08_24_075_m2_tool_effect_links.js';
import {
  EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V073,
  EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V077,
  computeM2EffectCoreFingerprintV073,
} from '../m2-effect-core-v073-prerequisite.js';
import { up as repairModelPolicyTriggers } from './2026_08_24_081_model_policy_trigger_compatibility.js';
import { up as repairModelProofTriggers } from './2026_08_24_081_model_proof_trigger_compatibility.js';

export const version = '2026_08_24_076_m2_tool_authority_truth';
export const description = 'Preserve nullable-project tool denials and exact single-owner terminal truth';

export const EXPECTED_M2_TOOL_TRUTH_SCHEMA_FINGERPRINT = '1e58ff70356ddf138745e18e5bd278902074ccce55a6edf486dabd40eac4a479';

function canonicalEqual(left, right) {
  return canonicalizeM2ToolValue(left) === canonicalizeM2ToolValue(right);
}

function projectionMatches(toolRequestJson, effectRequestJson, effectResultJson, toolResultJson) {
  try {
    const request = JSON.parse(toolRequestJson);
    const effectRequest = JSON.parse(effectRequestJson);
    const effectResult = JSON.parse(effectResultJson);
    const result = JSON.parse(toolResultJson);
    if (
      !validateM2ToolRequest(request).valid
      || !validateEffectRequest(effectRequest).valid
      || !validateEffectResultForRequest(effectRequest, effectResult).valid
      || !validateM2ToolResult(result).valid
    ) return 0;
    const descriptor = getM2ToolDescriptor(request.toolId);
    if (
      !descriptor
      || descriptor.version !== request.toolVersion
      || descriptor.riskClass !== request.riskClass
      || descriptor.authorityMode !== request.authorityMode
      || descriptor.requiredEffectKind !== request.requiredEffectKind
      || descriptor.validateInput(request.input).length !== 0
      || typeof descriptor.validateEffectTranslation !== 'function'
      || descriptor.validateEffectTranslation(request, effectRequest) !== true
      || effectRequest.idempotencyKey !== expectedM2EffectOperationKey(request)
    ) return 0;
    const projection = projectM2EffectToolTerminal(
      request,
      descriptor,
      effectRequest,
      effectResult,
    );
    return projection
      && result.status === projection.status
      && canonicalEqual(result.output, projection.output)
      && result.outputDigest === projection.outputDigest
      && result.effectRequestId === projection.effectRequestId
      && canonicalEqual(result.error, projection.error)
      && result.startedAt === projection.startedAt
      && result.completedAt === projection.completedAt
      && canonicalEqual(result.evidenceRefs, projection.evidenceRefs)
      && result.lateCompletionRejected === projection.lateCompletionRejected
      ? 1
      : 0;
  } catch {
    return 0;
  }
}

export function registerM2ToolProjectionFunction(db) {
  db.function('m2_tool_effect_projection_matches_v1', {
    deterministic: true,
  }, projectionMatches);
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
}

export function computeM2ToolTruthSchemaFingerprint(db) {
  const rows = db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL AND (
      name GLOB 'tool_v1_*'
      OR name GLOB 'trg_tool_v1_*'
      OR name = 'm2_tool_effect_links'
      OR name GLOB 'trg_m2_tool_effect_link_*'
    )
    ORDER BY type, name
  `).all().map(row => ({
    type: row.type,
    name: row.name,
    sql: row.sql.replace(/\s+/g, ' ').trim(),
  }));
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

function tableSql(db, name) {
  const row = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(name);
  if (!row?.sql) throw new Error(`M2_TOOL_TRUTH_076_MISSING_SOURCE_TABLE:${name}`);
  return row.sql;
}

function replacementSql(sql, oldName, newName, { nullableEffectProject = false } = {}) {
  let value = sql.replace(
    new RegExp(`^CREATE TABLE ${oldName}\\b`),
    `CREATE TABLE ${newName}`,
  );
  value = value.replaceAll(`REFERENCES ${oldName}(`, `REFERENCES ${newName}(`);
  if (oldName !== 'tool_v1_requests') {
    value = value.replaceAll(
      'REFERENCES tool_v1_requests(',
      'REFERENCES tool_v1_requests_076(',
    );
  }
  if (oldName === 'tool_v1_results') {
    const marker = 'result_json TEXT NOT NULL CHECK (json_valid(result_json))';
    if (!value.includes(marker)) {
      throw new Error('M2_TOOL_TRUTH_076_RESULT_SCHEMA_SOURCE_MISMATCH');
    }
    value = value.replace(marker, `execution_generation INTEGER NOT NULL CHECK (
        typeof(execution_generation) = 'integer' AND execution_generation > 0
      ),
      execution_owner_id TEXT NOT NULL CHECK (length(execution_owner_id) BETWEEN 1 AND 128),
      ${marker}`);
  }
  if (nullableEffectProject) {
    const oldConstraint = "AND project_id IS NOT NULL AND actor_type = 'user'";
    if (!value.includes(oldConstraint)) {
      throw new Error('M2_TOOL_TRUTH_076_REQUEST_CONSTRAINT_SOURCE_MISMATCH');
    }
    value = value.replace(oldConstraint, "AND actor_type = 'user'");
  }
  return value;
}

function sourceTriggers(db) {
  return db.prepare(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND (
      name GLOB 'trg_tool_v1_*' OR name GLOB 'trg_m2_tool_effect_link_*'
    )
    ORDER BY name
  `).all();
}

function preflightExistingLinkedTerminals(db) {
  const invalid = db.prepare(`
    SELECT link.request_id
    FROM m2_tool_effect_links link
    JOIN tool_v1_results result ON result.request_id = link.request_id
    LEFT JOIN m2_effect_results effect_result ON effect_result.effect_id = link.effect_id
    LEFT JOIN m2_effect_requests effect_request ON effect_request.effect_id = link.effect_id
    LEFT JOIN tool_v1_requests request ON request.request_id = link.request_id
    WHERE result.effect_request_id IS NOT link.effect_id
      OR effect_result.effect_id IS NULL
      OR effect_request.effect_id IS NULL
      OR request.request_id IS NULL
      OR m2_tool_effect_projection_matches_v1(
        request.request_json,
        effect_request.request_json,
        effect_result.result_json,
        result.result_json
      ) <> 1
    LIMIT 1
  `).get();
  if (invalid) {
    throw new Error(`M2_TOOL_TRUTH_076_EXISTING_LINKED_TERMINAL_INVALID:${invalid.request_id}`);
  }
}

function installTruthObjects(db) {
  db.exec(`
    CREATE TABLE tool_v1_execution_claims (
      request_id TEXT NOT NULL REFERENCES tool_v1_requests(request_id) ON DELETE RESTRICT,
      request_digest TEXT NOT NULL,
      generation INTEGER NOT NULL CHECK (typeof(generation) = 'integer' AND generation > 0),
      owner_id TEXT NOT NULL CHECK (
        length(owner_id) BETWEEN 1 AND 128
        AND substr(owner_id, 1, 1) GLOB '[A-Za-z0-9]'
        AND owner_id NOT GLOB '*[^A-Za-z0-9._:-]*'
      ),
      owner_pid INTEGER NOT NULL CHECK (typeof(owner_pid) = 'integer' AND owner_pid > 0),
      owner_boot_id TEXT NOT NULL CHECK (length(owner_boot_id) BETWEEN 1 AND 256),
      owner_start_identity TEXT NOT NULL CHECK (length(owner_start_identity) BETWEEN 1 AND 256),
      claimed_at_ms INTEGER NOT NULL CHECK (
        typeof(claimed_at_ms) = 'integer' AND claimed_at_ms >= 0
      ),
      PRIMARY KEY (request_id, generation)
    );

    CREATE TRIGGER trg_tool_v1_execution_claims_exact_request
    BEFORE INSERT ON tool_v1_execution_claims
    WHEN NOT EXISTS (
      SELECT 1 FROM tool_v1_requests request
      WHERE request.request_id = NEW.request_id
        AND request.request_digest = NEW.request_digest
        AND request.created_at_ms <= NEW.claimed_at_ms
    ) OR NEW.generation <> COALESCE((
      SELECT max(claim.generation) + 1
      FROM tool_v1_execution_claims claim
      WHERE claim.request_id = NEW.request_id
    ), 1)
    BEGIN
      SELECT RAISE(ABORT, 'M2_TOOL_EXECUTION_CLAIM_AUTHORITY_MISMATCH');
    END;

    CREATE TRIGGER trg_tool_v1_execution_claims_append_only_update
    BEFORE UPDATE ON tool_v1_execution_claims
    BEGIN
      SELECT RAISE(ABORT, 'tool_v1_execution_claims is append-only');
    END;

    CREATE TRIGGER trg_tool_v1_execution_claims_append_only_delete
    BEFORE DELETE ON tool_v1_execution_claims
    BEGIN
      SELECT RAISE(ABORT, 'tool_v1_execution_claims is append-only');
    END;

    CREATE TRIGGER trg_tool_v1_results_latest_execution
    BEFORE INSERT ON tool_v1_results
    WHEN NOT EXISTS (
      SELECT 1 FROM tool_v1_execution_claims claim
      WHERE claim.request_id = NEW.request_id
        AND claim.generation = NEW.execution_generation
        AND claim.owner_id = NEW.execution_owner_id
        AND claim.claimed_at_ms <= NEW.started_at_ms
        AND claim.generation = (
          SELECT max(latest.generation) FROM tool_v1_execution_claims latest
          WHERE latest.request_id = NEW.request_id
        )
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_TOOL_RESULT_EXECUTION_FENCE_MISMATCH');
    END;

    CREATE TRIGGER trg_m2_tool_effect_link_no_terminal
    BEFORE INSERT ON m2_tool_effect_links
    WHEN EXISTS (
      SELECT 1 FROM tool_v1_results result WHERE result.request_id = NEW.request_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_TOOL_EFFECT_LINK_AFTER_TERMINAL');
    END;

    CREATE TRIGGER trg_m2_tool_effect_link_operation_key
    BEFORE INSERT ON m2_tool_effect_links
    WHEN NOT EXISTS (
      SELECT 1
      FROM tool_v1_requests tool
      JOIN m2_effect_requests effect ON effect.effect_id = NEW.effect_id
      WHERE tool.request_id = NEW.request_id
        AND m2_tool_effect_operation_key_matches_v1(
          tool.request_json,
          effect.request_json
        ) = 1
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_TOOL_EFFECT_OPERATION_KEY_MISMATCH');
    END;

    CREATE TRIGGER trg_m2_tool_effect_link_terminal_exact
    BEFORE INSERT ON tool_v1_results
    WHEN EXISTS (
      SELECT 1 FROM m2_tool_effect_links link WHERE link.request_id = NEW.request_id
    ) AND NOT EXISTS (
      SELECT 1
      FROM m2_tool_effect_links link
      JOIN tool_v1_requests request ON request.request_id = link.request_id
      JOIN m2_effect_requests effect_request ON effect_request.effect_id = link.effect_id
      JOIN m2_effect_results effect_result ON effect_result.effect_id = link.effect_id
      WHERE link.request_id = NEW.request_id
        AND NEW.effect_request_id = link.effect_id
        AND m2_tool_effect_projection_matches_v1(
          request.request_json,
          effect_request.request_json,
          effect_result.result_json,
          NEW.result_json
        ) = 1
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_TOOL_LINKED_TERMINAL_PROJECTION_MISMATCH');
    END;
  `);
}

export function up(db) {
  // Some accepted pre-082 databases contain the exact M1 tables plus invalid
  // legacy triggers installed by 066/067. Repair those known collisions before
  // 076 asks SQLite to reparse unrelated M2 schemas. The later 081 migrations
  // are idempotent and still own the canonical migration stamps.
  const hasPolicyCollisionCandidate = db.prepare(`
    SELECT 1 AS ok FROM sqlite_master
    WHERE type = 'trigger' AND name = 'trg_model_automation_policy_events_no_update'
  `).get();
  const hasProofCollisionCandidate = db.prepare(`
    SELECT 1 AS ok FROM sqlite_master
    WHERE type = 'trigger' AND name = 'trg_model_failover_proofs_require_artifacts'
  `).get();
  if (hasPolicyCollisionCandidate) repairModelPolicyTriggers(db);
  if (hasProofCollisionCandidate) repairModelProofTriggers(db);
  registerM2ToolProjectionFunction(db);
  const current = computeM2ToolTruthSchemaFingerprint(db);
  const effectCore = computeM2EffectCoreFingerprintV073(db);
  if (current === EXPECTED_M2_TOOL_TRUTH_SCHEMA_FINGERPRINT) {
    if (![
      EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V073,
      EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V077,
    ].includes(effectCore)) {
      throw new Error('M2_TOOL_TRUTH_076_EFFECT_CORE_SCHEMA_FINGERPRINT_MISMATCH');
    }
    return;
  }
  if (effectCore !== EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V073) {
    throw new Error('M2_TOOL_TRUTH_076_EFFECT_CORE_SCHEMA_FINGERPRINT_MISMATCH');
  }
  if (
    computeToolV1SchemaFingerprint(db) !== EXPECTED_TOOL_V1_SCHEMA_FINGERPRINT
    || computeM2ToolEffectLinkSchemaFingerprint(db)
      !== EXPECTED_M2_TOOL_EFFECT_LINK_SCHEMA_FINGERPRINT
  ) throw new Error('M2_TOOL_TRUTH_076_SOURCE_SCHEMA_FINGERPRINT_MISMATCH');

  preflightExistingLinkedTerminals(db);
  const triggers = sourceTriggers(db);
  const counts = Object.fromEntries([
    'tool_v1_requests',
    'tool_v1_results',
    'm2_tool_effect_links',
  ].map(name => [name, db.prepare(`SELECT count(*) AS count FROM ${name}`).get().count]));

  db.exec(replacementSql(
    tableSql(db, 'tool_v1_requests'),
    'tool_v1_requests',
    'tool_v1_requests_076',
    { nullableEffectProject: true },
  ));
  db.exec(replacementSql(
    tableSql(db, 'tool_v1_results'),
    'tool_v1_results',
    'tool_v1_results_076',
  ));
  db.exec(replacementSql(
    tableSql(db, 'm2_tool_effect_links'),
    'm2_tool_effect_links',
    'm2_tool_effect_links_076',
  ));
  db.exec(`
    INSERT INTO tool_v1_requests_076 SELECT * FROM tool_v1_requests;
    INSERT INTO tool_v1_results_076 (
      request_id, request_digest, run_id, project_id, tool_id, tool_version,
      status, output_schema, output_json, output_digest, effect_request_id,
      error_json, started_at_ms, completed_at_ms, evidence_json,
      late_completion_rejected, execution_generation, execution_owner_id,
      result_json
    ) SELECT
      request_id, request_digest, run_id, project_id, tool_id, tool_version,
      status, output_schema, output_json, output_digest, effect_request_id,
      error_json, started_at_ms, completed_at_ms, evidence_json,
      late_completion_rejected, 1, 'migration:pre-076', result_json
    FROM tool_v1_results;
    INSERT INTO m2_tool_effect_links_076 SELECT * FROM m2_tool_effect_links;
  `);
  for (const trigger of triggers) db.exec(`DROP TRIGGER ${trigger.name}`);
  db.exec(`
    DROP TABLE m2_tool_effect_links;
    DROP TABLE tool_v1_results;
    DROP TABLE tool_v1_requests;
    ALTER TABLE tool_v1_requests_076 RENAME TO tool_v1_requests;
    ALTER TABLE tool_v1_results_076 RENAME TO tool_v1_results;
    ALTER TABLE m2_tool_effect_links_076 RENAME TO m2_tool_effect_links;
  `);
  for (const trigger of triggers) db.exec(trigger.sql);
  installTruthObjects(db);
  db.exec(`
    INSERT INTO tool_v1_execution_claims (
      request_id, request_digest, generation, owner_id, owner_pid,
      owner_boot_id, owner_start_identity, claimed_at_ms
    )
    SELECT
      request.request_id,
      request.request_digest,
      1,
      'migration:pre-076',
      1,
      'unknown:migration-pre-076',
      'unknown:migration-pre-076',
      COALESCE(result.started_at_ms, request.created_at_ms)
    FROM tool_v1_requests request
    LEFT JOIN tool_v1_results result ON result.request_id = request.request_id
    WHERE result.request_id IS NOT NULL OR EXISTS (
      SELECT 1 FROM m2_tool_effect_links link WHERE link.request_id = request.request_id
    );

    CREATE TRIGGER trg_tool_v1_execution_claims_terminal_fence
    BEFORE INSERT ON tool_v1_execution_claims
    WHEN EXISTS (
      SELECT 1 FROM tool_v1_results result WHERE result.request_id = NEW.request_id
    ) OR EXISTS (
      SELECT 1 FROM m2_tool_effect_links link WHERE link.request_id = NEW.request_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_TOOL_EXECUTION_CLAIM_AFTER_TERMINAL_OR_LINK');
    END;
  `);

  for (const [name, count] of Object.entries(counts)) {
    const copied = db.prepare(`SELECT count(*) AS count FROM ${name}`).get().count;
    if (copied !== count) throw new Error(`M2_TOOL_TRUTH_076_ROW_LOSS:${name}`);
  }
  const installed = computeM2ToolTruthSchemaFingerprint(db);
  if (installed !== EXPECTED_M2_TOOL_TRUTH_SCHEMA_FINGERPRINT) {
    throw new Error('M2_TOOL_TRUTH_076_FINAL_SCHEMA_FINGERPRINT_MISMATCH');
  }
}

export default { version, description, up };
