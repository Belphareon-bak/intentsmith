// Migration v81: Telemetry Snapshots
// ==============================================================================
//
// telemetry_snapshots — per-turn resilience telemetry persistence.
// Hybrid schema: indexable columns for fast aggregation + JSON blob for detail.
//
// Append-only. Never blocks turn execution. Fire-and-forget INSERT.
//
// ==============================================================================

export const version = '2026_02_24_017';
export const description = 'Resilience telemetry snapshots (per-turn observability)';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

      turn_id TEXT NOT NULL,
      session_id TEXT,
      conversation_id TEXT,

      intent TEXT,
      classified_by TEXT,
      execution_status TEXT,

      total_turn_time_ms INTEGER,
      classification_time_ms INTEGER,
      execution_time_ms INTEGER,

      retry_count INTEGER DEFAULT 0,
      partial_failure INTEGER DEFAULT 0,
      was_cancelled INTEGER DEFAULT 0,
      circuit_opened INTEGER DEFAULT 0,

      snapshot_json TEXT NOT NULL
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_telemetry_created_at ON telemetry_snapshots(created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_telemetry_intent ON telemetry_snapshots(intent)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_telemetry_classified_by ON telemetry_snapshots(classified_by)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_telemetry_session ON telemetry_snapshots(session_id)`);
}
