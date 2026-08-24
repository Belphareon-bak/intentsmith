import { createHash } from 'node:crypto';

export const version = '2026_08_24_075_m2_tool_effect_links';
export const description = 'Bind M2 ToolRequest authority to one exact EffectRequest';

export const EXPECTED_M2_TOOL_EFFECT_LINK_SCHEMA_FINGERPRINT = 'c3d2f5ebfa10334bab6ba3aa7ef07c224e2b4cd465c4a3b7dabd5beee628b35a';

export function computeM2ToolEffectLinkSchemaFingerprint(db) {
  const rows = db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL
      AND (name = 'm2_tool_effect_links' OR name GLOB 'trg_m2_tool_effect_link_*')
    ORDER BY type, name
  `).all().map(row => ({
    type: row.type,
    name: row.name,
    sql: row.sql.replace(/\s+/g, ' ').trim(),
  }));
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

export function up(db) {
  const currentFingerprint = computeM2ToolEffectLinkSchemaFingerprint(db);
  if (currentFingerprint === EXPECTED_M2_TOOL_EFFECT_LINK_SCHEMA_FINGERPRINT) return;
  const existingObjects = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name = 'm2_tool_effect_links' OR name GLOB 'trg_m2_tool_effect_link_*'
  `).get().count;
  if (existingObjects !== 0) {
    throw new Error('M2_TOOL_EFFECT_LINK_075_SOURCE_SCHEMA_FINGERPRINT_MISMATCH');
  }

  db.exec(`
    CREATE TABLE m2_tool_effect_links (
      request_id TEXT PRIMARY KEY REFERENCES tool_v1_requests(request_id) ON DELETE RESTRICT,
      effect_id TEXT NOT NULL UNIQUE REFERENCES m2_effect_requests(effect_id) ON DELETE RESTRICT,
      tool_request_digest TEXT NOT NULL CHECK (
        length(tool_request_digest) = 71
        AND substr(tool_request_digest, 1, 7) = 'sha256:'
        AND substr(tool_request_digest, 8) NOT GLOB '*[^0-9a-f]*'
      ),
      effect_request_digest TEXT NOT NULL CHECK (
        length(effect_request_digest) = 71
        AND substr(effect_request_digest, 1, 7) = 'sha256:'
        AND substr(effect_request_digest, 8) NOT GLOB '*[^0-9a-f]*'
      ),
      translation_digest TEXT NOT NULL UNIQUE CHECK (
        length(translation_digest) = 71
        AND substr(translation_digest, 1, 7) = 'sha256:'
        AND substr(translation_digest, 8) NOT GLOB '*[^0-9a-f]*'
      ),
      link_json TEXT NOT NULL CHECK (json_valid(link_json)),
      linked_at_ms INTEGER NOT NULL CHECK (typeof(linked_at_ms) = 'integer' AND linked_at_ms >= 0),
      CHECK (json_extract(link_json, '$.requestId') = request_id),
      CHECK (json_extract(link_json, '$.effectId') = effect_id),
      CHECK (json_extract(link_json, '$.toolRequestDigest') = tool_request_digest),
      CHECK (json_extract(link_json, '$.effectRequestDigest') = effect_request_digest),
      CHECK (json_extract(link_json, '$.translationDigest') = translation_digest),
      CHECK (json_extract(link_json, '$.linkedAtMs') = linked_at_ms)
    );

    CREATE TRIGGER trg_m2_tool_effect_link_exact_authority
    BEFORE INSERT ON m2_tool_effect_links
    WHEN NOT EXISTS (
      SELECT 1
      FROM tool_v1_requests tool_request
      JOIN m2_effect_requests effect_request ON effect_request.effect_id = NEW.effect_id
      WHERE tool_request.request_id = NEW.request_id
        AND tool_request.request_digest = NEW.tool_request_digest
        AND effect_request.request_digest = NEW.effect_request_digest
        AND json_extract(tool_request.request_json, '$.authorityMode') = 'effect'
        AND json_type(tool_request.request_json, '$.effectBinding') = 'object'
        AND effect_request.run_id = tool_request.run_id
        AND effect_request.project_id IS tool_request.project_id
        AND effect_request.kind = json_extract(tool_request.request_json, '$.effectBinding.kind')
        AND effect_request.payload_digest = json_extract(tool_request.request_json, '$.effectBinding.payloadDigest')
        AND effect_request.payload_bytes = json_extract(tool_request.request_json, '$.effectBinding.payloadBytes')
        AND json_extract(effect_request.request_json, '$.requiredCapability')
          = json_extract(tool_request.request_json, '$.effectBinding.requiredCapability')
        AND json_extract(effect_request.request_json, '$.riskClass')
          = json_extract(tool_request.request_json, '$.effectBinding.riskClass')
        AND json_extract(effect_request.request_json, '$.actor.type')
          = json_extract(tool_request.request_json, '$.actor.type')
        AND json_extract(effect_request.request_json, '$.actor.id')
          = json_extract(tool_request.request_json, '$.actor.id')
        AND json_extract(effect_request.request_json, '$.origin.surface')
          = json_extract(tool_request.request_json, '$.origin.surface')
        AND json_extract(effect_request.request_json, '$.origin.sessionId')
          = json_extract(tool_request.request_json, '$.origin.sessionId')
        AND json_extract(effect_request.request_json, '$.origin.conversationId')
          = json_extract(tool_request.request_json, '$.origin.conversationId')
        AND json_extract(effect_request.request_json, '$.target.type')
          = json_extract(tool_request.request_json, '$.effectBinding.target.type')
        AND (
          (
            json_extract(tool_request.request_json, '$.effectBinding.target.type') = 'filesystem'
            AND json_extract(effect_request.request_json, '$.target.relativePath')
              = json_extract(tool_request.request_json, '$.effectBinding.target.relativePath')
          )
          OR
          (
            json_extract(tool_request.request_json, '$.effectBinding.target.type') = 'network'
            AND json_extract(effect_request.request_json, '$.target.url')
              = json_extract(tool_request.request_json, '$.effectBinding.target.url')
            AND json_extract(effect_request.request_json, '$.target.origin')
              = json_extract(tool_request.request_json, '$.effectBinding.target.origin')
            AND json_extract(effect_request.request_json, '$.target.method')
              = json_extract(tool_request.request_json, '$.effectBinding.target.method')
            AND json_extract(effect_request.request_json, '$.target.redirectPolicy')
              = json_extract(tool_request.request_json, '$.effectBinding.target.redirectPolicy')
            AND json_extract(effect_request.request_json, '$.target.dnsPolicy')
              = json_extract(tool_request.request_json, '$.effectBinding.target.dnsPolicy')
          )
        )
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_TOOL_EFFECT_LINK_AUTHORITY_MISMATCH');
    END;

    CREATE TRIGGER trg_m2_tool_effect_link_append_only_update
    BEFORE UPDATE ON m2_tool_effect_links
    BEGIN
      SELECT RAISE(ABORT, 'm2_tool_effect_links is append-only');
    END;

    CREATE TRIGGER trg_m2_tool_effect_link_append_only_delete
    BEFORE DELETE ON m2_tool_effect_links
    BEGIN
      SELECT RAISE(ABORT, 'm2_tool_effect_links is append-only');
    END;

    CREATE TRIGGER trg_m2_tool_effect_link_result_authority
    BEFORE INSERT ON tool_v1_results
    WHEN NEW.effect_request_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM m2_tool_effect_links link
      WHERE link.request_id = NEW.request_id
        AND link.effect_id = NEW.effect_request_id
        AND link.tool_request_digest = NEW.request_digest
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_TOOL_RESULT_EFFECT_LINK_MISSING');
    END;

    CREATE TRIGGER trg_m2_tool_effect_link_result_shape
    BEFORE INSERT ON tool_v1_results
    WHEN EXISTS (
      SELECT 1 FROM tool_v1_requests request
      WHERE request.request_id = NEW.request_id
        AND (
          json_extract(request.request_json, '$.outputSchema') IS NOT NEW.output_schema
          OR (
            json_extract(request.request_json, '$.authorityMode') <> 'effect'
            AND NEW.effect_request_id IS NOT NULL
          )
        )
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_TOOL_RESULT_REQUEST_SHAPE_MISMATCH');
    END;

    CREATE TRIGGER trg_m2_tool_effect_link_file_write_output
    BEFORE INSERT ON tool_v1_results
    WHEN NEW.status = 'ok'
      AND EXISTS (
        SELECT 1 FROM tool_v1_requests request
        WHERE request.request_id = NEW.request_id
          AND request.tool_id = 'file.write'
          AND (
            NEW.effect_request_id IS NULL
            OR json_extract(NEW.result_json, '$.output.path')
              IS NOT json_extract(request.request_json, '$.input.path')
            OR json_extract(NEW.result_json, '$.output.effectId') IS NOT NEW.effect_request_id
            OR json_extract(NEW.result_json, '$.output.terminalStatus') IS NOT 'succeeded'
          )
      )
    BEGIN
      SELECT RAISE(ABORT, 'M2_TOOL_FILE_WRITE_OUTPUT_MISMATCH');
    END;
  `);

  if (
    computeM2ToolEffectLinkSchemaFingerprint(db)
    !== EXPECTED_M2_TOOL_EFFECT_LINK_SCHEMA_FINGERPRINT
  ) throw new Error('M2_TOOL_EFFECT_LINK_075_FINAL_SCHEMA_FINGERPRINT_MISMATCH');
}

export default { version, description, up };
