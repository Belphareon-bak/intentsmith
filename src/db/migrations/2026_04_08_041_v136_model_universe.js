// v136: Model Universe foundation — raw facts + derived state + signal/audit logs
// ══════════════════════════════════════════════════════════════════════════════

export const version = '2026_04_08_041_v136_model_universe';
export const description = 'Model universe raw/derived tables with idempotent writes and audit logs';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_universe_raw (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_name TEXT NOT NULL,
      tag TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'local',
      write_source TEXT NOT NULL DEFAULT 'universe',
      write_token TEXT,
      idempotency_key TEXT,
      idempotency_expires_at DATETIME,
      metadata_state TEXT NOT NULL DEFAULT 'PARTIAL',
      parameters REAL,
      context_length INTEGER,
      quantization TEXT,
      modality TEXT,
      metadata_json TEXT,
      last_verified_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(model_name, tag, source)
    );

    CREATE INDEX IF NOT EXISTS idx_universe_model ON model_universe_raw(model_name);
    CREATE INDEX IF NOT EXISTS idx_universe_state ON model_universe_raw(metadata_state);
    CREATE INDEX IF NOT EXISTS idx_universe_verified ON model_universe_raw(last_verified_at);
    CREATE INDEX IF NOT EXISTS idx_universe_idempotency ON model_universe_raw(idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_universe_idempotency_exp ON model_universe_raw(idempotency_expires_at);

    CREATE TABLE IF NOT EXISTS model_universe_derived (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_name TEXT NOT NULL,
      tag TEXT NOT NULL DEFAULT '',
      score_estimated REAL,
      confidence REAL,
      confidence_state TEXT DEFAULT 'LOW',
      score_state TEXT DEFAULT 'estimated',
      capability_vector_json TEXT,
      recompute_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(model_name, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_ud_model ON model_universe_derived(model_name);
    CREATE INDEX IF NOT EXISTS idx_ud_recompute ON model_universe_derived(recompute_at);

    CREATE TABLE IF NOT EXISTS model_signal_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_name TEXT NOT NULL,
      role TEXT,
      signal_type TEXT NOT NULL,
      success INTEGER,
      latency_ms INTEGER,
      error_type TEXT,
      payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_signals_model ON model_signal_events(model_name);
    CREATE INDEX IF NOT EXISTS idx_signals_time ON model_signal_events(created_at);

    CREATE TABLE IF NOT EXISTS registry_delta (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_key TEXT NOT NULL,
      delta_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_registry_delta_key ON registry_delta(snapshot_key);
    CREATE INDEX IF NOT EXISTS idx_registry_delta_exp ON registry_delta(expires_at);

    CREATE TABLE IF NOT EXISTS model_reconciliation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_name TEXT NOT NULL,
      tag TEXT NOT NULL DEFAULT '',
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      source TEXT NOT NULL,
      confidence REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_recon_model ON model_reconciliation_log(model_name);
    CREATE INDEX IF NOT EXISTS idx_recon_time ON model_reconciliation_log(created_at);

    CREATE TABLE IF NOT EXISTS model_write_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_name TEXT NOT NULL,
      tag TEXT NOT NULL DEFAULT '',
      write_token TEXT,
      write_source TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_write_model ON model_write_log(model_name);
    CREATE INDEX IF NOT EXISTS idx_write_token ON model_write_log(write_token);
    CREATE INDEX IF NOT EXISTS idx_write_time ON model_write_log(created_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS model_write_log;
    DROP TABLE IF EXISTS model_reconciliation_log;
    DROP TABLE IF EXISTS registry_delta;
    DROP TABLE IF EXISTS model_signal_events;
    DROP TABLE IF EXISTS model_universe_derived;
    DROP TABLE IF EXISTS model_universe_raw;
  `);
}
