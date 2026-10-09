export const version = '2026_10_09_123_ide_management';
export const description = 'Durable IDE management documents and exact-artifact runtime telemetry';
export function up(db) {
  db.exec(`
    CREATE TABLE ide_documents (
      kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
      data_json TEXT NOT NULL CHECK(json_valid(data_json)), updated_at INTEGER NOT NULL,
      PRIMARY KEY(kind,id)
    );
    CREATE TABLE ide_events (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL, document_id TEXT NOT NULL,
      actor_id TEXT NOT NULL, action TEXT NOT NULL, occurred_at INTEGER NOT NULL
    );
    CREATE TABLE ide_document_tombstones (
      kind TEXT NOT NULL, id TEXT NOT NULL, deleted_at INTEGER NOT NULL, PRIMARY KEY(kind,id)
    );
    CREATE TRIGGER ide_events_no_update BEFORE UPDATE ON ide_events BEGIN SELECT RAISE(ABORT,'IDE_AUDIT_APPEND_ONLY'); END;
    CREATE TRIGGER ide_events_no_delete BEFORE DELETE ON ide_events BEGIN SELECT RAISE(ABORT,'IDE_AUDIT_APPEND_ONLY'); END;
    CREATE TABLE model_runtime_telemetry (
      id INTEGER PRIMARY KEY, model TEXT NOT NULL, digest_sha256 TEXT,
      role TEXT, caller_role TEXT, occurred_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL, output_characters INTEGER NOT NULL,
      prompt_tokens INTEGER, output_tokens INTEGER, generation_ns INTEGER,
      context_tokens INTEGER NOT NULL, output_limit INTEGER NOT NULL
    );
    CREATE INDEX model_runtime_telemetry_artifact ON model_runtime_telemetry(digest_sha256,occurred_at);
  `);
}
