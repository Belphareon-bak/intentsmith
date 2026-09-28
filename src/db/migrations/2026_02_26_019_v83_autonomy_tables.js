// Migration v83: Autonomy Tables
// ==============================================================================
//
// Guarded Autonomy MVP v1 — self-tuning CRE override threshold.
//
// Three tables:
//   telemetry_metrics      — aggregated per-window metrics (15-min windows)
//   telemetry_alerts       — drift alerts (ask_user_spike, break_spike, low_volume)
//   telemetry_improvements — threshold change proposals + history
//
// ==============================================================================

export const version = '2026_02_26_019';
export const description = 'Autonomy tables (metrics, alerts, improvements)';

export function up(db) {
  // ── Aggregated metrics per window ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      window_start DATETIME NOT NULL,
      window_end DATETIME NOT NULL,
      total_turns INTEGER NOT NULL,
      ambiguous_count INTEGER NOT NULL,
      ask_user_count INTEGER NOT NULL,
      break_count INTEGER NOT NULL,
      override_count INTEGER NOT NULL,
      avg_confidence REAL,
      override_threshold_at_time REAL,
      rule_distribution TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_telemetry_metrics_window ON telemetry_metrics(window_start)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_telemetry_metrics_end ON telemetry_metrics(window_end)`);

  // ── Drift alerts ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      metric_value REAL NOT NULL,
      baseline_value REAL,
      threshold_at_time REAL,
      message TEXT,
      acknowledged INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_telemetry_alerts_type ON telemetry_alerts(alert_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_telemetry_alerts_ack ON telemetry_alerts(acknowledged)`);

  // ── Improvement proposals + history ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry_improvements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parameter TEXT NOT NULL,
      old_value REAL NOT NULL,
      new_value REAL NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      trust_level INTEGER NOT NULL DEFAULT 0,
      auto_applied INTEGER NOT NULL DEFAULT 0,
      rollback_trigger TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      applied_at DATETIME
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_telemetry_improvements_status ON telemetry_improvements(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_telemetry_improvements_param ON telemetry_improvements(parameter)`);
}
