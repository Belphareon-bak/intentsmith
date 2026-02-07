// C.3 v57.0 — Notification DB Tables
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

/**
 * Initialize notification-related tables.
 * Called once at startup. Safe to call multiple times (IF NOT EXISTS).
 *
 * @param {import('better-sqlite3').Database} db - Raw better-sqlite3 instance
 */
export function initNotificationTables(db) {
  // ─── 1. Delivery log — tracks every send attempt + context (why-chain) ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_log_v57 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      channel TEXT NOT NULL,
      recipient TEXT,
      title TEXT,
      priority TEXT DEFAULT 'normal',
      delivered INTEGER NOT NULL DEFAULT 0,
      policy_decision TEXT,
      error TEXT,
      context_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Index for querying by agent and time (used by escalation + history)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_notif_log_agent
    ON notification_log_v57(agent_id, created_at DESC)
  `);

  // ─── 2. Channel configuration — stored per-agent overrides ───────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_channels_v57 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      recipient TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      config TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, channel)
    )
  `);

  // ─── 3. Notification state — per-agent runtime state (mute, cooldown) ────
  //    Separate from agent config (deklarativní) — this is runtime state.
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_state_v57 (
      agent_id TEXT PRIMARY KEY,
      muted_until TEXT,
      last_sent_at TEXT,
      last_effective_priority TEXT,
      last_body_hash TEXT,
      escalation_counter INTEGER DEFAULT 0,
      escalation_window_start TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ─── 4. Digest buffer — notifications waiting for scheduled digest ───────
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_digest_buffer_v57 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      recipient TEXT,
      title TEXT,
      body TEXT,
      priority TEXT DEFAULT 'normal',
      context_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_digest_buffer_agent
    ON notification_digest_buffer_v57(agent_id, created_at ASC)
  `);

  // Migrate: add columns to notification_log_v57 if upgrading from older schema
  _migrateLogTable(db);

  logger.info('Notifications',
    'DB tables initialized (notification_log_v57, notification_channels_v57, notification_state_v57, notification_digest_buffer_v57)'
  );
}

/**
 * Add new columns to existing notification_log_v57 (safe, idempotent).
 */
function _migrateLogTable(db) {
  const columns = db.pragma('table_info(notification_log_v57)').map(c => c.name);

  const migrations = [
    { col: 'priority', sql: "ALTER TABLE notification_log_v57 ADD COLUMN priority TEXT DEFAULT 'normal'" },
    { col: 'policy_decision', sql: 'ALTER TABLE notification_log_v57 ADD COLUMN policy_decision TEXT' },
    { col: 'context_json', sql: 'ALTER TABLE notification_log_v57 ADD COLUMN context_json TEXT' },
  ];

  for (const m of migrations) {
    if (!columns.includes(m.col)) {
      try { db.exec(m.sql); } catch { /* already exists or other benign error */ }
    }
  }
}
