import { createHash } from 'node:crypto';

import {
  validateEffectRequest,
  validateEffectResultForRequest,
  validateEffectResultForRequestV1,
} from '../../../contracts/m2/effect-v1.js';
import {
  EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V080,
} from './2026_08_24_080_m2_effect_semantic_authority.js';
import {
  EXPECTED_M2_EFFECT_INVALIDATION_SCHEMA_FINGERPRINT,
  computeM2EffectInvalidationSchemaFingerprint,
} from './2026_08_24_077_m2_effect_invalidations.js';
import {
  computeM2EffectCoreFingerprintV073,
} from '../m2-effect-core-v073-prerequisite.js';

export const version = '2026_08_24_081_m2_effect_result_semantic_authority_v2';
export const description = 'Version EffectResult semantic authority and quarantine loose legacy terminals';

export const EXPECTED_M2_EFFECT_RESULT_SEMANTIC_V2_FINGERPRINT = 'f00754e3600c2131224b1dd819c5c167ad548090db11773311818ee66f114236';
export const EXPECTED_M2_EFFECT_INVALIDATION_SCHEMA_FINGERPRINT_V081 = 'edf827558f8ea9d9fd67f0c86585646dc291949fe5a8f3c53e9c03adbb2d23b9';

function jsonDigest(value) {
  if (typeof value !== 'string') return null;
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function matches(validator, requestJson, resultJson) {
  try {
    const request = JSON.parse(requestJson);
    const result = JSON.parse(resultJson);
    return validateEffectRequest(request).valid && validator(request, result).valid ? 1 : 0;
  } catch {
    return 0;
  }
}

export function registerM2EffectSemanticV2Functions(db) {
  db.function('m2_effect_result_matches_request_v2', {
    deterministic: true,
  }, (requestJson, resultJson) => matches(
    validateEffectResultForRequest,
    requestJson,
    resultJson,
  ));
  db.function('m2_effect_result_json_digest_v1', {
    deterministic: true,
  }, jsonDigest);
}

export function computeM2EffectResultSemanticV2Fingerprint(db) {
  const names = new Set([
    'm2_effect_result_semantic_quarantine',
    'trg_m2_effect_result_semantic_quarantine_exact',
    'trg_m2_effect_result_semantic_quarantine_append_only_update',
    'trg_m2_effect_result_semantic_quarantine_append_only_delete',
  ]);
  const rows = db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL
    ORDER BY type, name
  `).all()
    .filter(row => names.has(row.name))
    .map(row => ({
      type: row.type,
      name: row.name,
      sql: row.sql.replace(/\s+/g, ' ').trim(),
    }));
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

function installSemanticV2Schema(db) {
  db.exec(`
    CREATE TABLE m2_effect_result_semantic_quarantine (
      effect_id TEXT PRIMARY KEY
        REFERENCES m2_effect_results(effect_id) ON DELETE RESTRICT,
      request_digest TEXT NOT NULL,
      result_digest TEXT NOT NULL CHECK (
        result_digest GLOB 'sha256:*'
        AND length(result_digest) = 71
        AND substr(result_digest, 8) NOT GLOB '*[^0-9a-f]*'
      ),
      reason_code TEXT NOT NULL CHECK (
        reason_code = 'LEGACY_RESULT_V2_SEMANTIC_MISMATCH'
      ),
      rejected_by_validator INTEGER NOT NULL CHECK (rejected_by_validator = 2),
      source_migration TEXT NOT NULL CHECK (
        source_migration = '2026_08_24_081_m2_effect_result_semantic_authority_v2'
      )
    );

    CREATE TRIGGER trg_m2_effect_result_semantic_quarantine_exact
    BEFORE INSERT ON m2_effect_result_semantic_quarantine
    WHEN NOT EXISTS (
      SELECT 1
      FROM m2_effect_results result
      JOIN m2_effect_requests request ON request.effect_id = result.effect_id
      WHERE result.effect_id = NEW.effect_id
        AND result.request_digest = NEW.request_digest
        AND NEW.result_digest = m2_effect_result_json_digest_v1(result.result_json)
        AND m2_effect_result_matches_request_v1(
          request.request_json,
          result.result_json
        ) = 1
        AND m2_effect_result_matches_request_v2(
          request.request_json,
          result.result_json
        ) = 0
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_RESULT_QUARANTINE_AUTHORITY_MISMATCH');
    END;

    CREATE TRIGGER trg_m2_effect_result_semantic_quarantine_append_only_update
    BEFORE UPDATE ON m2_effect_result_semantic_quarantine
    BEGIN
      SELECT RAISE(ABORT, 'm2_effect_result_semantic_quarantine is append-only');
    END;

    CREATE TRIGGER trg_m2_effect_result_semantic_quarantine_append_only_delete
    BEFORE DELETE ON m2_effect_result_semantic_quarantine
    BEGIN
      SELECT RAISE(ABORT, 'm2_effect_result_semantic_quarantine is append-only');
    END;
  `);
}

function quarantineLooseLegacyResults(db) {
  const rows = db.prepare(`
    SELECT result.effect_id AS effectId,
           result.request_digest AS requestDigest,
           result.result_json AS resultJson,
           request.request_json AS requestJson
    FROM m2_effect_results result
    JOIN m2_effect_requests request ON request.effect_id = result.effect_id
    ORDER BY result.effect_id
  `).all();
  const insert = db.prepare(`
    INSERT INTO m2_effect_result_semantic_quarantine (
      effect_id, request_digest, result_digest, reason_code,
      rejected_by_validator, source_migration
    ) VALUES (?, ?, ?, 'LEGACY_RESULT_V2_SEMANTIC_MISMATCH', 2, ?)
  `);
  for (const row of rows) {
    if (matches(validateEffectResultForRequestV1, row.requestJson, row.resultJson) !== 1) {
      throw new Error(`M2_EFFECT_RESULT_SEMANTIC_081_EXISTING_V1_RESULT_INVALID:${row.effectId}`);
    }
    if (matches(validateEffectResultForRequest, row.requestJson, row.resultJson) === 1) continue;
    insert.run(row.effectId, row.requestDigest, jsonDigest(row.resultJson), version);
  }
}

function installSemanticV2Trigger(db) {
  db.exec(`
    DROP TRIGGER trg_m2_effect_results_semantic_authority;
    CREATE TRIGGER trg_m2_effect_results_semantic_authority
    BEFORE INSERT ON m2_effect_results
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_effect_requests request
      WHERE request.effect_id = NEW.effect_id
        AND m2_effect_result_matches_request_v2(
          request.request_json,
          NEW.result_json
        ) = 1
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_RESULT_SEMANTIC_AUTHORITY_MISMATCH');
    END;
  `);
}

export function up(db) {
  registerM2EffectSemanticV2Functions(db);
  const current = computeM2EffectResultSemanticV2Fingerprint(db);
  const invalidation = computeM2EffectInvalidationSchemaFingerprint(db);
  const effectCore = computeM2EffectCoreFingerprintV073(db);
  if (current === EXPECTED_M2_EFFECT_RESULT_SEMANTIC_V2_FINGERPRINT) {
    if (
      invalidation !== EXPECTED_M2_EFFECT_INVALIDATION_SCHEMA_FINGERPRINT_V081
      || effectCore !== EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V080
    ) throw new Error('M2_EFFECT_RESULT_SEMANTIC_081_INSTALLED_SCHEMA_FINGERPRINT_MISMATCH');
    return;
  }
  if (effectCore !== EXPECTED_M2_EFFECT_CORE_FINGERPRINT_V080) {
    throw new Error('M2_EFFECT_RESULT_SEMANTIC_081_EFFECT_CORE_SOURCE_FINGERPRINT_MISMATCH');
  }
  if (invalidation !== EXPECTED_M2_EFFECT_INVALIDATION_SCHEMA_FINGERPRINT) {
    throw new Error('M2_EFFECT_RESULT_SEMANTIC_081_INVALIDATION_SOURCE_FINGERPRINT_MISMATCH');
  }
  const existing = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name = 'm2_effect_result_semantic_quarantine'
       OR name GLOB 'trg_m2_effect_result_semantic_quarantine_*'
  `).get().count;
  if (existing !== 0) {
    throw new Error('M2_EFFECT_RESULT_SEMANTIC_081_SOURCE_SCHEMA_FINGERPRINT_MISMATCH');
  }

  installSemanticV2Schema(db);
  quarantineLooseLegacyResults(db);
  installSemanticV2Trigger(db);

  const installed = computeM2EffectResultSemanticV2Fingerprint(db);
  const installedInvalidation = computeM2EffectInvalidationSchemaFingerprint(db);
  if (installed !== EXPECTED_M2_EFFECT_RESULT_SEMANTIC_V2_FINGERPRINT) {
    throw new Error(`M2_EFFECT_RESULT_SEMANTIC_081_FINAL_SCHEMA_FINGERPRINT_MISMATCH:${installed}`);
  }
  if (installedInvalidation !== EXPECTED_M2_EFFECT_INVALIDATION_SCHEMA_FINGERPRINT_V081) {
    throw new Error(`M2_EFFECT_RESULT_SEMANTIC_081_FINAL_INVALIDATION_FINGERPRINT_MISMATCH:${installedInvalidation}`);
  }
}

export default { version, description, up };
