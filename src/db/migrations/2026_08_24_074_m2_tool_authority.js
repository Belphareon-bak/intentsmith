import { createHash } from 'node:crypto';

export const version = '2026_08_24_074_m2_tool_authority';
export const description = 'Persist exact M2 ToolRequest and terminal ToolResult authority';

export const EXPECTED_TOOL_V1_SCHEMA_FINGERPRINT = '911803bec668d306a9137aa41014601778e785c964fc81d831dfeac076ab0183';

export function computeToolV1SchemaFingerprint(db) {
  const rows = db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL
      AND (name GLOB 'tool_v1_*' OR name GLOB 'trg_tool_v1_*')
    ORDER BY type, name
  `).all().map(row => ({
    type: row.type,
    name: row.name,
    sql: row.sql.replace(/\s+/g, ' ').trim(),
  }));
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

export function up(db) {
  const currentFingerprint = computeToolV1SchemaFingerprint(db);
  if (currentFingerprint === EXPECTED_TOOL_V1_SCHEMA_FINGERPRINT) return;
  const existingObjects = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name GLOB 'tool_v1_*' OR name GLOB 'trg_tool_v1_*'
  `).get().count;
  if (existingObjects !== 0) {
    throw new Error('M2_TOOL_AUTHORITY_074_SOURCE_SCHEMA_FINGERPRINT_MISMATCH');
  }
  db.exec(`
    CREATE TABLE tool_v1_requests (
      request_id TEXT PRIMARY KEY CHECK (
        length(request_id) BETWEEN 1 AND 128
        AND substr(request_id, 1, 1) GLOB '[A-Za-z0-9]'
        AND request_id NOT GLOB '*[^A-Za-z0-9._:-]*'
      ),
      request_digest TEXT NOT NULL UNIQUE CHECK (
        length(request_digest) = 71
        AND substr(request_digest, 1, 7) = 'sha256:'
        AND substr(request_digest, 8) NOT GLOB '*[^0-9a-f]*'
      ),
      run_id TEXT NOT NULL CHECK (length(run_id) BETWEEN 1 AND 128),
      project_id INTEGER CHECK (
        project_id IS NULL OR (typeof(project_id) = 'integer' AND project_id > 0)
      ),
      actor_type TEXT NOT NULL CHECK (actor_type IN ('user','system','model','specialist')),
      actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 128),
      surface TEXT NOT NULL CHECK (surface IN ('http','ws','studio','skill','lifecycle')),
      session_id TEXT NOT NULL CHECK (length(session_id) BETWEEN 1 AND 128),
      conversation_id TEXT NOT NULL CHECK (length(conversation_id) BETWEEN 1 AND 128),
      tool_id TEXT NOT NULL CHECK (length(tool_id) BETWEEN 1 AND 128),
      tool_version INTEGER NOT NULL CHECK (typeof(tool_version) = 'integer' AND tool_version > 0),
      risk_class TEXT NOT NULL CHECK (
        risk_class IN ('pure','read','write','network','exec','destructive')
      ),
      input_schema TEXT NOT NULL CHECK (length(input_schema) BETWEEN 1 AND 192),
      input_digest TEXT NOT NULL CHECK (
        length(input_digest) = 71
        AND substr(input_digest, 1, 7) = 'sha256:'
        AND substr(input_digest, 8) NOT GLOB '*[^0-9a-f]*'
      ),
      required_effect_kind TEXT CHECK (
        required_effect_kind IS NULL OR required_effect_kind IN (
          'fs.read','fs.write','fs.delete','process.exec','network.request','git.commit','git.push'
        )
      ),
      timeout_ms INTEGER NOT NULL CHECK (
        typeof(timeout_ms) = 'integer' AND timeout_ms BETWEEN 1 AND 300000
      ),
      idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
      request_json TEXT NOT NULL CHECK (json_valid(request_json)),
      created_at_ms INTEGER NOT NULL CHECK (
        typeof(created_at_ms) = 'integer' AND created_at_ms >= 0
      ),
      UNIQUE (run_id, idempotency_key),
      CHECK (
        (risk_class = 'pure' AND required_effect_kind IS NULL)
        OR
        (risk_class <> 'pure' AND required_effect_kind IS NOT NULL
          AND project_id IS NOT NULL AND actor_type = 'user')
      ),
      CHECK (json_extract(request_json, '$.requestId') = request_id),
      CHECK (json_extract(request_json, '$.runId') = run_id),
      CHECK (json_extract(request_json, '$.origin.projectId') IS project_id),
      CHECK (json_extract(request_json, '$.actor.type') = actor_type),
      CHECK (json_extract(request_json, '$.actor.id') = actor_id),
      CHECK (json_extract(request_json, '$.origin.surface') = surface),
      CHECK (json_extract(request_json, '$.origin.sessionId') = session_id),
      CHECK (json_extract(request_json, '$.origin.conversationId') = conversation_id),
      CHECK (json_extract(request_json, '$.toolId') = tool_id),
      CHECK (json_extract(request_json, '$.toolVersion') = tool_version),
      CHECK (json_extract(request_json, '$.riskClass') = risk_class),
      CHECK (json_extract(request_json, '$.inputSchema') = input_schema),
      CHECK (json_extract(request_json, '$.inputDigest') = input_digest),
      CHECK (json_extract(request_json, '$.requiredEffectKind') IS required_effect_kind),
      CHECK (json_extract(request_json, '$.timeoutMs') = timeout_ms),
      CHECK (json_extract(request_json, '$.idempotencyKey') = idempotency_key)
    );

    CREATE TABLE tool_v1_results (
      request_id TEXT PRIMARY KEY REFERENCES tool_v1_requests(request_id) ON DELETE RESTRICT,
      request_digest TEXT NOT NULL,
      run_id TEXT NOT NULL,
      project_id INTEGER,
      tool_id TEXT NOT NULL,
      tool_version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ok','error','cancelled','timeout','orphaned')),
      output_schema TEXT NOT NULL CHECK (length(output_schema) BETWEEN 1 AND 192),
      output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
      output_digest TEXT CHECK (
        output_digest IS NULL OR (
          length(output_digest) = 71
          AND substr(output_digest, 1, 7) = 'sha256:'
          AND substr(output_digest, 8) NOT GLOB '*[^0-9a-f]*'
        )
      ),
      effect_request_id TEXT REFERENCES m2_effect_requests(effect_id) ON DELETE RESTRICT,
      error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
      started_at_ms INTEGER NOT NULL CHECK (typeof(started_at_ms) = 'integer' AND started_at_ms >= 0),
      completed_at_ms INTEGER NOT NULL CHECK (
        typeof(completed_at_ms) = 'integer' AND completed_at_ms >= started_at_ms
      ),
      evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
      late_completion_rejected INTEGER NOT NULL CHECK (late_completion_rejected IN (0,1)),
      result_json TEXT NOT NULL CHECK (json_valid(result_json)),
      CHECK (
        (status = 'ok' AND output_json IS NOT NULL AND output_digest IS NOT NULL AND error_json IS NULL)
        OR
        (status <> 'ok' AND output_json IS NULL AND output_digest IS NULL AND error_json IS NOT NULL)
      ),
      CHECK (json_extract(result_json, '$.requestId') = request_id),
      CHECK (json_extract(result_json, '$.requestDigest') = request_digest),
      CHECK (json_extract(result_json, '$.runId') = run_id),
      CHECK (json_extract(result_json, '$.projectId') IS project_id),
      CHECK (json_extract(result_json, '$.toolId') = tool_id),
      CHECK (json_extract(result_json, '$.toolVersion') = tool_version),
      CHECK (json_extract(result_json, '$.status') = status),
      CHECK (json_extract(result_json, '$.outputSchema') = output_schema),
      CHECK (json_extract(result_json, '$.outputDigest') IS output_digest),
      CHECK (json_extract(result_json, '$.effectRequestId') IS effect_request_id),
      CHECK (json_extract(result_json, '$.lateCompletionRejected') = late_completion_rejected)
    );

    CREATE TRIGGER trg_tool_v1_requests_append_only_update
    BEFORE UPDATE ON tool_v1_requests
    BEGIN
      SELECT RAISE(ABORT, 'tool_v1_requests is append-only');
    END;

    CREATE TRIGGER trg_tool_v1_requests_append_only_delete
    BEFORE DELETE ON tool_v1_requests
    BEGIN
      SELECT RAISE(ABORT, 'tool_v1_requests is append-only');
    END;

    CREATE TRIGGER trg_tool_v1_results_append_only_update
    BEFORE UPDATE ON tool_v1_results
    BEGIN
      SELECT RAISE(ABORT, 'tool_v1_results is append-only');
    END;

    CREATE TRIGGER trg_tool_v1_results_append_only_delete
    BEFORE DELETE ON tool_v1_results
    BEGIN
      SELECT RAISE(ABORT, 'tool_v1_results is append-only');
    END;

    CREATE TRIGGER trg_tool_v1_results_exact_request
    BEFORE INSERT ON tool_v1_results
    WHEN NOT EXISTS (
      SELECT 1 FROM tool_v1_requests request
      WHERE request.request_id = NEW.request_id
        AND request.request_digest = NEW.request_digest
        AND request.run_id = NEW.run_id
        AND request.project_id IS NEW.project_id
        AND request.tool_id = NEW.tool_id
        AND request.tool_version = NEW.tool_version
    )
    BEGIN
      SELECT RAISE(ABORT, 'TOOL_V1_RESULT_REQUEST_MISMATCH');
    END;

    CREATE TRIGGER trg_tool_v1_results_exact_effect
    BEFORE INSERT ON tool_v1_results
    WHEN NEW.effect_request_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM tool_v1_requests tool_request
      JOIN m2_effect_requests effect_request
        ON effect_request.effect_id = NEW.effect_request_id
      WHERE tool_request.request_id = NEW.request_id
        AND effect_request.run_id = tool_request.run_id
        AND effect_request.project_id = tool_request.project_id
        AND effect_request.kind = tool_request.required_effect_kind
        AND json_extract(effect_request.request_json, '$.actor.type')
          = json_extract(tool_request.request_json, '$.actor.type')
        AND json_extract(effect_request.request_json, '$.actor.id')
          = json_extract(tool_request.request_json, '$.actor.id')
    )
    BEGIN
      SELECT RAISE(ABORT, 'TOOL_V1_RESULT_EFFECT_MISMATCH');
    END;

    CREATE TRIGGER trg_tool_v1_results_success_authority
    BEFORE INSERT ON tool_v1_results
    WHEN NEW.status = 'ok'
      AND EXISTS (
        SELECT 1 FROM tool_v1_requests request
        WHERE request.request_id = NEW.request_id AND request.required_effect_kind IS NOT NULL
      )
      AND (
        NEW.effect_request_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM m2_effect_results effect_result
          WHERE effect_result.effect_id = NEW.effect_request_id
            AND json_extract(effect_result.result_json, '$.terminalStatus') = 'succeeded'
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'TOOL_V1_SUCCESS_EFFECT_AUTHORITY_MISSING');
    END;
  `);
  if (computeToolV1SchemaFingerprint(db) !== EXPECTED_TOOL_V1_SCHEMA_FINGERPRINT) {
    throw new Error('M2_TOOL_AUTHORITY_074_FINAL_SCHEMA_FINGERPRINT_MISMATCH');
  }
}

export default { version, description, up };
