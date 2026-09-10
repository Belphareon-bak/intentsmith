import { createHash } from 'node:crypto';
import { registerM2EffectCurrentFunctions } from '../../effects/effect-current-functions.js';
import { registerM2FileListOutputFunctions } from '../../effects/effect-file-list-output-repository.js';
import { registerM2FileListToolProjectionFunction } from '../../tools/m2-tool-authority-repository.js';

export const version = '2026_09_10_110_m2_file_list_outputs';
export const description = 'Exact project-root listing authority and immutable metadata output';
export const EXPECTED_M2_FILE_LIST_OUTPUT_FINGERPRINT_V110 = 'ffbd3ffe8b84089642dba1f1f1a767f726277bd30ee116f36851ead8c7560c9a';
const LEGACY_TRIGGER_HASHES = Object.freeze({
  "trg_m2_effect_requests_json_identity": "9cbf1b85b20234d3694940927666fc2566fbdf1a8a0911845bc11f356d4060ab",
  "trg_m2_approval_grants_exact_scope": "b96bc7d9367f13c429f2804c57a73132e03dc5b19d9297ecdf4e2e2be2b12462",
  "trg_m2_effect_results_semantic_authority": "a0165cc7f0e10350f5ade4e3cf48b41cdd1dc32d21d0572d6b766b6f2ecd5a7d",
  "trg_m2_tool_effect_link_terminal_exact": "ef552d42d3dd3a879cbb59321752dc0e56ef706995725108fc2f038deed408d5",
  "trg_m2_tool_effect_link_exact_authority": "543d7026ab975658a8b40dcd19bf63f413a016e5a167944937f2318c8ab3d4ce"
});
const NAMES = Object.freeze([
  "m2_file_list_outputs",
  "trg_m2_file_list_output_no_update",
  "trg_m2_file_list_output_no_delete",
  "trg_m2_file_list_output_exact_bytes",
  "trg_m2_file_list_result_exact_output",
  "m2_file_list_output_tombstones",
  "trg_m2_file_list_tombstone_exact",
  "trg_m2_file_list_tombstone_no_update",
  "trg_m2_file_list_tombstone_no_delete",
  "trg_m2_file_list_tombstone_purge",
  "trg_m2_file_list_conversation_removed",
  "trg_m2_file_list_project_removed",
  "trg_m2_effect_requests_json_identity",
  "trg_m2_approval_grants_exact_scope",
  "trg_m2_effect_results_semantic_authority",
  "trg_m2_tool_effect_link_terminal_exact",
  "trg_m2_tool_effect_link_exact_authority"
]);
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const normalize = value => value.replace(/\s+/gu, ' ').trim();
export function computeM2FileListOutputFingerprintV110(database) {
  return hash(JSON.stringify(database.prepare(`
    SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name
  `).all().filter(row => NAMES.includes(row.name)).map(row => ({ ...row, sql: normalize(row.sql) }))));
}
export function up(database) {
  registerM2EffectCurrentFunctions(database);
  registerM2FileListOutputFunctions(database);
  registerM2FileListToolProjectionFunction(database);
  if (computeM2FileListOutputFingerprintV110(database) === EXPECTED_M2_FILE_LIST_OUTPUT_FINGERPRINT_V110) return;
  const previous = database.prepare('SELECT name, sql FROM sqlite_master').all().filter(row => NAMES.includes(row.name));
  if (previous.length !== Object.keys(LEGACY_TRIGGER_HASHES).length
    || previous.some(row => hash(normalize(row.sql)) !== LEGACY_TRIGGER_HASHES[row.name])) {
    throw new Error('M2_FILE_LIST_OUTPUT_110_SOURCE_SCHEMA_MISMATCH');
  }
  database.exec(`
    CREATE TABLE m2_file_list_outputs (
      effect_id TEXT PRIMARY KEY REFERENCES m2_effect_requests(effect_id) ON DELETE RESTRICT,
      project_id INTEGER NOT NULL CHECK (typeof(project_id) = 'integer' AND project_id > 0),
      request_digest TEXT NOT NULL CHECK (
        length(request_digest) = 71 AND substr(request_digest, 1, 7) = 'sha256:'
        AND substr(request_digest, 8) NOT GLOB '*[^a-f0-9]*'
      ),
      conversation_id TEXT NOT NULL CHECK (length(conversation_id) BETWEEN 1 AND 512),
      project_path TEXT NOT NULL CHECK (length(project_path) BETWEEN 1 AND 4096),
      metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
      payload BLOB CHECK (payload IS NULL OR (typeof(payload) = 'blob' AND length(payload) <= 1048576)),
      FOREIGN KEY(effect_id) REFERENCES m2_effect_results(effect_id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
    );
    CREATE TRIGGER trg_m2_file_list_output_no_update
    BEFORE UPDATE ON m2_file_list_outputs
    WHEN NOT (OLD.payload IS NOT NULL AND NEW.payload IS NULL
      AND NEW.effect_id IS OLD.effect_id AND NEW.project_id IS OLD.project_id
      AND NEW.conversation_id IS OLD.conversation_id AND NEW.project_path IS OLD.project_path
      AND NEW.request_digest IS OLD.request_digest AND NEW.metadata_json IS OLD.metadata_json
      AND EXISTS (SELECT 1 FROM m2_file_list_output_tombstones WHERE effect_id = OLD.effect_id))
    BEGIN
      SELECT RAISE(ABORT, 'M2_FILE_LIST_OUTPUT_IMMUTABLE');
    END;
    CREATE TRIGGER trg_m2_file_list_output_no_delete
    BEFORE DELETE ON m2_file_list_outputs BEGIN
      SELECT RAISE(ABORT, 'M2_FILE_LIST_OUTPUT_IMMUTABLE');
    END;
    CREATE TRIGGER trg_m2_file_list_output_exact_bytes
    BEFORE INSERT ON m2_file_list_outputs
    WHEN EXISTS (SELECT 1 FROM m2_effect_results WHERE effect_id = NEW.effect_id)
      OR NOT EXISTS (
        SELECT 1 FROM m2_effect_requests request
        JOIN conversations conversation ON conversation.id = NEW.conversation_id
        JOIN projects project ON project.id = conversation.project_id
        WHERE project.id = NEW.project_id AND project.path = NEW.project_path
          AND project.status IN ('active', 'archived') AND conversation.state IN ('active', 'archived')
          AND NEW.project_path = json_extract(request.request_json, '$.target.canonicalRoot')
          AND m2_file_list_conversation_origin_v1(conversation.id) = json_extract(request.request_json, '$.origin.conversationId')
          AND request.effect_id = NEW.effect_id AND request.project_id = NEW.project_id
          AND request.request_digest = NEW.request_digest
          AND m2_file_list_output_bytes_match_v1(request.request_json, NEW.metadata_json, NEW.payload) = 1
      )
    BEGIN
      SELECT RAISE(ABORT, 'M2_FILE_LIST_OUTPUT_REQUEST_OR_BYTES_MISMATCH');
    END;
    CREATE TRIGGER trg_m2_file_list_result_exact_output
    BEFORE INSERT ON m2_effect_results
    WHEN EXISTS (
      SELECT 1 FROM m2_effect_requests request WHERE request.effect_id = NEW.effect_id
        AND m2_file_list_output_request_v1(request.request_json) = 1
    ) AND (
      (NEW.terminal_status = 'succeeded' AND NOT EXISTS (
        SELECT 1 FROM m2_effect_requests request
        JOIN m2_file_list_outputs output ON output.effect_id = request.effect_id
        WHERE request.effect_id = NEW.effect_id
          AND output.project_id = NEW.project_id AND output.request_digest = NEW.request_digest
          AND m2_file_list_output_result_match_v1(request.request_json, NEW.result_json, output.metadata_json) = 1
      )) OR (NEW.terminal_status != 'succeeded' AND EXISTS (
        SELECT 1 FROM m2_file_list_outputs WHERE effect_id = NEW.effect_id
      ))
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_FILE_LIST_RESULT_OUTPUT_MISMATCH');
    END;
    CREATE TABLE m2_file_list_output_tombstones (
      effect_id TEXT PRIMARY KEY REFERENCES m2_file_list_outputs(effect_id) ON DELETE RESTRICT,
      reason TEXT NOT NULL CHECK (reason IN ('CONVERSATION_REMOVED', 'PROJECT_REMOVED')),
      deleted_at_ms INTEGER NOT NULL CHECK (typeof(deleted_at_ms) = 'integer' AND deleted_at_ms >= 0)
    );
    CREATE TRIGGER trg_m2_file_list_tombstone_exact
    BEFORE INSERT ON m2_file_list_output_tombstones
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_file_list_outputs output WHERE output.effect_id = NEW.effect_id
        AND ((NEW.reason = 'CONVERSATION_REMOVED' AND NOT EXISTS (
          SELECT 1 FROM conversations WHERE id = output.conversation_id
        )) OR (NEW.reason = 'PROJECT_REMOVED' AND NOT EXISTS (
          SELECT 1 FROM projects WHERE id = output.project_id
        )))
    )
    BEGIN SELECT RAISE(ABORT, 'M2_FILE_LIST_TOMBSTONE_SCOPE_NOT_REMOVED'); END;
    CREATE TRIGGER trg_m2_file_list_tombstone_no_update
    BEFORE UPDATE ON m2_file_list_output_tombstones
    BEGIN SELECT RAISE(ABORT, 'M2_FILE_LIST_TOMBSTONE_IMMUTABLE'); END;
    CREATE TRIGGER trg_m2_file_list_tombstone_no_delete
    BEFORE DELETE ON m2_file_list_output_tombstones
    BEGIN SELECT RAISE(ABORT, 'M2_FILE_LIST_TOMBSTONE_IMMUTABLE'); END;
    CREATE TRIGGER trg_m2_file_list_tombstone_purge
    AFTER INSERT ON m2_file_list_output_tombstones
    BEGIN UPDATE m2_file_list_outputs SET payload = NULL WHERE effect_id = NEW.effect_id; END;
    CREATE TRIGGER trg_m2_file_list_conversation_removed
    AFTER DELETE ON conversations
    BEGIN
      INSERT OR IGNORE INTO m2_file_list_output_tombstones(effect_id, reason, deleted_at_ms)
      SELECT effect_id, 'CONVERSATION_REMOVED', CAST(strftime('%s', 'now') AS INTEGER) * 1000
      FROM m2_file_list_outputs WHERE conversation_id = OLD.id;
    END;
    CREATE TRIGGER trg_m2_file_list_project_removed
    AFTER DELETE ON projects
    BEGIN
      INSERT OR IGNORE INTO m2_file_list_output_tombstones(effect_id, reason, deleted_at_ms)
      SELECT effect_id, 'PROJECT_REMOVED', CAST(strftime('%s', 'now') AS INTEGER) * 1000
      FROM m2_file_list_outputs WHERE project_id = OLD.id;
    END;

DROP TRIGGER trg_m2_effect_requests_json_identity;
CREATE TRIGGER trg_m2_effect_requests_json_identity
    BEFORE INSERT ON m2_effect_requests
    WHEN json_extract(NEW.request_json, '$.contract') IS NOT 'EffectRequest'
      OR (CASE WHEN json_extract(NEW.request_json, '$.version') = 2 THEN
        m2_effect_request_root_list_v2(NEW.request_json, NEW.request_digest, NEW.created_at_ms)
        ELSE json_extract(NEW.request_json, '$.version') IS 1 END) IS NOT 1
      OR json_extract(NEW.request_json, '$.effectId') IS NOT NEW.effect_id
      OR json_extract(NEW.request_json, '$.runId') IS NOT NEW.run_id
      OR json_extract(NEW.request_json, '$.origin.projectId') IS NOT NEW.project_id
      OR json_extract(NEW.request_json, '$.kind') IS NOT NEW.kind
      OR json_extract(NEW.request_json, '$.payloadDigest') IS NOT NEW.payload_digest
      OR json_extract(NEW.request_json, '$.payloadBytes') IS NOT NEW.payload_bytes
      OR json_extract(NEW.request_json, '$.workspaceRevision') IS NOT NEW.workspace_revision
      OR json_extract(NEW.request_json, '$.idempotencyKey') IS NOT NEW.idempotency_key
      OR json_extract(NEW.request_json, '$.approvalGrantId') IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_REQUEST_JSON_IDENTITY_MISMATCH');
    END;
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
        AND m2_approval_grant_matches_request_v2(
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
DROP TRIGGER trg_m2_effect_results_semantic_authority;
CREATE TRIGGER trg_m2_effect_results_semantic_authority
    BEFORE INSERT ON m2_effect_results
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_effect_requests request
      WHERE request.effect_id = NEW.effect_id
        AND m2_effect_result_matches_request_v3(
          request.request_json,
          NEW.result_json
        ) = 1
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_EFFECT_RESULT_SEMANTIC_AUTHORITY_MISMATCH');
    END;
DROP TRIGGER trg_m2_tool_effect_link_terminal_exact;
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
      LEFT JOIN m2_file_list_outputs listing ON listing.effect_id = link.effect_id
        AND listing.project_id = effect_result.project_id
        AND listing.request_digest = effect_result.request_digest
      LEFT JOIN m2_file_read_outputs output ON output.effect_id = link.effect_id
        AND output.project_id = effect_result.project_id
        AND output.request_digest = effect_result.request_digest
      WHERE link.request_id = NEW.request_id AND NEW.effect_request_id = link.effect_id
        AND CASE WHEN request.tool_id = 'file.list' AND request.tool_version = 2 THEN
          m2_tool_effect_projection_matches_v3(request.request_json, effect_request.request_json,
            effect_result.result_json, NEW.result_json, listing.metadata_json)
        WHEN request.tool_id = 'file.read' AND request.tool_version = 2 THEN
          m2_tool_effect_projection_matches_v2(request.request_json, effect_request.request_json,
            effect_result.result_json, NEW.result_json, output.metadata_json)
        ELSE m2_tool_effect_projection_matches_v1(request.request_json, effect_request.request_json,
          effect_result.result_json, NEW.result_json) END = 1
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_TOOL_LINKED_TERMINAL_PROJECTION_MISMATCH');
    END;
DROP TRIGGER trg_m2_tool_effect_link_exact_authority;
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
            (json_extract(tool_request.request_json, '$.effectBinding.target.type') = 'filesystem' OR m2_tool_effect_request_matches_v2(tool_request.request_json, effect_request.request_json) = 1)
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
  `);
  if (computeM2FileListOutputFingerprintV110(database) !== EXPECTED_M2_FILE_LIST_OUTPUT_FINGERPRINT_V110) {
    throw new Error('M2_FILE_LIST_OUTPUT_110_TARGET_SCHEMA_MISMATCH');
  }
}
