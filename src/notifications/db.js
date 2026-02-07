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
  // Delivery log — tracks every send attempt across all channels
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_log_v57 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      channel TEXT NOT NULL,
      recipient TEXT,
      title TEXT,
      delivered INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Index for querying by agent and time
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_notif_log_agent
    ON notification_log_v57(agent_id, created_at DESC)
  `);

  // Channel configuration — stored per-agent overrides
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

  logger.info('Notifications', 'DB tables initialized (notification_log_v57, notification_channels_v57)');
}
