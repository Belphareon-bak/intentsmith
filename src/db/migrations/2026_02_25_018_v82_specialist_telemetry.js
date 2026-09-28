// Migration v82: Specialist Telemetry
// ==============================================================================
//
// specialist_telemetry — passive observability for specialist execution layer.
// Tracks tool matches/success/fail, memory hits/misses, lifecycle events, API latency.
//
// Best-effort: data loss under load is acceptable.
// Telemetry must never affect runtime behavior.
//
// ==============================================================================

export const version = '2026_02_25_018';
export const description = 'Specialist telemetry (passive execution layer observability)';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS specialist_telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      specialist_id TEXT,
      tool_id TEXT,
      duration_ms INTEGER,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_specialist_telemetry_type ON specialist_telemetry(event_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_specialist_telemetry_specialist ON specialist_telemetry(specialist_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_specialist_telemetry_created ON specialist_telemetry(created_at)`);
}
