import { createHash } from 'node:crypto';
import { registerM2FileReadOutputFunctions } from '../../effects/effect-file-read-output-repository.js';
import { registerM2FileReadToolProjectionFunction } from '../../tools/m2-tool-authority-repository.js';

export const version = '2026_09_09_109_m2_file_read_outputs';
export const description = 'Immutable private output bytes for exact project file.read@2';
export const EXPECTED_M2_FILE_READ_OUTPUT_FINGERPRINT_V109 = '1655b2853f3c6ed11a9c8c5377f37e0695fce7989f38b2d14c486238c3a61939';
const LEGACY_TRIGGER_HASH = '85eb02998624a6722632535e32af5365e255cbd8444c69aedb3dc5f97490044a';
const NAMES = Object.freeze([
  'm2_file_read_outputs', 'm2_file_read_output_tombstones', 'trg_m2_file_read_tombstone_exact',
  'trg_m2_file_read_tombstone_no_update', 'trg_m2_file_read_tombstone_no_delete',
  'trg_m2_file_read_tombstone_purge', 'trg_m2_file_read_conversation_removed',
  'trg_m2_file_read_project_removed', 'trg_m2_file_read_output_no_update', 'trg_m2_file_read_output_no_delete',
  'trg_m2_file_read_output_exact_bytes', 'trg_m2_file_read_result_exact_output',
  'trg_m2_tool_effect_link_terminal_exact',
]);
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const normalize = value => value.replace(/\s+/gu, ' ').trim();

export function computeM2FileReadOutputFingerprintV109(database) {
  return hash(JSON.stringify(database.prepare(`
    SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name
  `).all().filter(row => NAMES.includes(row.name))
    .map(row => ({ ...row, sql: normalize(row.sql) }))));
}

export function up(database) {
  registerM2FileReadOutputFunctions(database);
  registerM2FileReadToolProjectionFunction(database);
  const before = computeM2FileReadOutputFingerprintV109(database);
  if (before === EXPECTED_M2_FILE_READ_OUTPUT_FINGERPRINT_V109) return;
  const existing = database.prepare(`SELECT name, sql FROM sqlite_master`).all()
    .filter(row => NAMES.includes(row.name));
  if (existing.length !== 1 || existing[0].name !== 'trg_m2_tool_effect_link_terminal_exact'
    || hash(normalize(existing[0].sql)) !== LEGACY_TRIGGER_HASH) {
    throw new Error('M2_FILE_READ_OUTPUT_109_SOURCE_SCHEMA_MISMATCH');
  }
  database.exec(`
    CREATE TABLE m2_file_read_outputs (
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
    CREATE TRIGGER trg_m2_file_read_output_no_update
    BEFORE UPDATE ON m2_file_read_outputs
    WHEN NOT (OLD.payload IS NOT NULL AND NEW.payload IS NULL
      AND NEW.effect_id IS OLD.effect_id AND NEW.project_id IS OLD.project_id
      AND NEW.conversation_id IS OLD.conversation_id AND NEW.project_path IS OLD.project_path
      AND NEW.request_digest IS OLD.request_digest AND NEW.metadata_json IS OLD.metadata_json
      AND EXISTS (SELECT 1 FROM m2_file_read_output_tombstones WHERE effect_id = OLD.effect_id))
    BEGIN
      SELECT RAISE(ABORT, 'M2_FILE_READ_OUTPUT_IMMUTABLE');
    END;
    CREATE TRIGGER trg_m2_file_read_output_no_delete
    BEFORE DELETE ON m2_file_read_outputs BEGIN
      SELECT RAISE(ABORT, 'M2_FILE_READ_OUTPUT_IMMUTABLE');
    END;
    CREATE TRIGGER trg_m2_file_read_output_exact_bytes
    BEFORE INSERT ON m2_file_read_outputs
    WHEN EXISTS (SELECT 1 FROM m2_effect_results WHERE effect_id = NEW.effect_id)
      OR NOT EXISTS (
        SELECT 1 FROM m2_effect_requests request
        JOIN conversations conversation ON conversation.id = NEW.conversation_id
        JOIN projects project ON project.id = conversation.project_id
        WHERE project.id = NEW.project_id AND project.path = NEW.project_path
          AND project.status IN ('active', 'archived') AND conversation.state IN ('active', 'archived')
          AND NEW.project_path = json_extract(request.request_json, '$.target.canonicalRoot')
          AND m2_file_read_conversation_origin_v1(conversation.id) = json_extract(request.request_json, '$.origin.conversationId')
          AND request.effect_id = NEW.effect_id AND request.project_id = NEW.project_id
          AND request.request_digest = NEW.request_digest
          AND m2_file_read_output_bytes_match_v1(request.request_json, NEW.metadata_json, NEW.payload) = 1
      )
    BEGIN
      SELECT RAISE(ABORT, 'M2_FILE_READ_OUTPUT_REQUEST_OR_BYTES_MISMATCH');
    END;
    CREATE TRIGGER trg_m2_file_read_result_exact_output
    BEFORE INSERT ON m2_effect_results
    WHEN EXISTS (
      SELECT 1 FROM m2_effect_requests request WHERE request.effect_id = NEW.effect_id
        AND m2_file_read_output_request_v1(request.request_json) = 1
    ) AND (
      (NEW.terminal_status = 'succeeded' AND NOT EXISTS (
        SELECT 1 FROM m2_effect_requests request
        JOIN m2_file_read_outputs output ON output.effect_id = request.effect_id
        WHERE request.effect_id = NEW.effect_id
          AND output.project_id = NEW.project_id AND output.request_digest = NEW.request_digest
          AND m2_file_read_output_result_match_v1(request.request_json, NEW.result_json, output.metadata_json) = 1
      )) OR (NEW.terminal_status != 'succeeded' AND EXISTS (
        SELECT 1 FROM m2_file_read_outputs WHERE effect_id = NEW.effect_id
      ))
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_FILE_READ_RESULT_OUTPUT_MISMATCH');
    END;
    CREATE TABLE m2_file_read_output_tombstones (
      effect_id TEXT PRIMARY KEY REFERENCES m2_file_read_outputs(effect_id) ON DELETE RESTRICT,
      reason TEXT NOT NULL CHECK (reason IN ('CONVERSATION_REMOVED', 'PROJECT_REMOVED')),
      deleted_at_ms INTEGER NOT NULL CHECK (typeof(deleted_at_ms) = 'integer' AND deleted_at_ms >= 0)
    );
    CREATE TRIGGER trg_m2_file_read_tombstone_exact
    BEFORE INSERT ON m2_file_read_output_tombstones
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_file_read_outputs output WHERE output.effect_id = NEW.effect_id
        AND ((NEW.reason = 'CONVERSATION_REMOVED' AND NOT EXISTS (
          SELECT 1 FROM conversations WHERE id = output.conversation_id
        )) OR (NEW.reason = 'PROJECT_REMOVED' AND NOT EXISTS (
          SELECT 1 FROM projects WHERE id = output.project_id
        )))
    )
    BEGIN SELECT RAISE(ABORT, 'M2_FILE_READ_TOMBSTONE_SCOPE_NOT_REMOVED'); END;
    CREATE TRIGGER trg_m2_file_read_tombstone_no_update
    BEFORE UPDATE ON m2_file_read_output_tombstones
    BEGIN SELECT RAISE(ABORT, 'M2_FILE_READ_TOMBSTONE_IMMUTABLE'); END;
    CREATE TRIGGER trg_m2_file_read_tombstone_no_delete
    BEFORE DELETE ON m2_file_read_output_tombstones
    BEGIN SELECT RAISE(ABORT, 'M2_FILE_READ_TOMBSTONE_IMMUTABLE'); END;
    CREATE TRIGGER trg_m2_file_read_tombstone_purge
    AFTER INSERT ON m2_file_read_output_tombstones
    BEGIN UPDATE m2_file_read_outputs SET payload = NULL WHERE effect_id = NEW.effect_id; END;
    CREATE TRIGGER trg_m2_file_read_conversation_removed
    AFTER DELETE ON conversations
    BEGIN
      INSERT OR IGNORE INTO m2_file_read_output_tombstones(effect_id, reason, deleted_at_ms)
      SELECT effect_id, 'CONVERSATION_REMOVED', CAST(strftime('%s', 'now') AS INTEGER) * 1000
      FROM m2_file_read_outputs WHERE conversation_id = OLD.id;
    END;
    CREATE TRIGGER trg_m2_file_read_project_removed
    AFTER DELETE ON projects
    BEGIN
      INSERT OR IGNORE INTO m2_file_read_output_tombstones(effect_id, reason, deleted_at_ms)
      SELECT effect_id, 'PROJECT_REMOVED', CAST(strftime('%s', 'now') AS INTEGER) * 1000
      FROM m2_file_read_outputs WHERE project_id = OLD.id;
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
      LEFT JOIN m2_file_read_outputs output ON output.effect_id = link.effect_id
        AND output.project_id = effect_result.project_id
        AND output.request_digest = effect_result.request_digest
      WHERE link.request_id = NEW.request_id AND NEW.effect_request_id = link.effect_id
        AND CASE WHEN request.tool_id = 'file.read' AND request.tool_version = 2 THEN
          m2_tool_effect_projection_matches_v2(request.request_json, effect_request.request_json,
            effect_result.result_json, NEW.result_json, output.metadata_json)
        ELSE m2_tool_effect_projection_matches_v1(request.request_json, effect_request.request_json,
          effect_result.result_json, NEW.result_json) END = 1
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_TOOL_LINKED_TERMINAL_PROJECTION_MISMATCH');
    END;
  `);
  const after = computeM2FileReadOutputFingerprintV109(database);
  if (after !== EXPECTED_M2_FILE_READ_OUTPUT_FINGERPRINT_V109) {
    throw new Error(`M2_FILE_READ_OUTPUT_109_FINAL_SCHEMA_MISMATCH:${after}`);
  }
}

export default { version, description, up };
