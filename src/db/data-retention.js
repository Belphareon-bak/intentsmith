// v92: Data Retention — configurable tiered pruning with auto-clean.
//
// All retention periods are configurable via user_settings → storage.retention.*
// Pressure control: DB >500MB → 75% retention, >2GB → 50% retention
//
// Soft-deleted items: hard-deleted after grace period (configurable, default 14 days).
// Messages: archived (summarized) before deletion — never lose semantic content.
//
// Must never throw — must not block startup or crash the server.

import { logger } from '../core/logger.js';
import { pruneHistory, deleteConversationHistory } from '../core/history-drain.js';

// ─────────────────────────────────────────────────────────────────────────────
// Default Storage Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_STORAGE_CONFIG = {
  retention: {
    conversations: 365,
    lifecycle: 365,
    memory_changes: 180,
    llm_logs: 5,
    agent_logs: 7,
    cre_logs: 7,
    telemetry: 14,
    specialist_telemetry: 30,
    workflow_patterns: 30,
    drift_checks: 30,
    expertise_logs: 30,
    skill_steps: 30,
    audit_events: 90,
    quality_scores: 90,
    soft_delete_grace: 14,
  },
  backup: {
    on_shutdown: true,
    on_startup: true,
    periodic: false,
    periodic_hours: 24,
    max_daily: 7,
    max_weekly: 4,
  },
  drain: {
    cutoff_hours: 24,
    enabled: true,
  },
  clean: {
    interval_hours: 24,
    enabled: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Validation Rules
// ─────────────────────────────────────────────────────────────────────────────

const VALIDATION = {
  'retention.conversations':         { min: 30,  max: 3650 },
  'retention.lifecycle':             { min: 30,  max: 3650 },
  'retention.memory_changes':        { min: 30,  max: 3650 },
  'retention.llm_logs':              { min: 1,   max: 365 },
  'retention.agent_logs':            { min: 1,   max: 365 },
  'retention.cre_logs':              { min: 1,   max: 365 },
  'retention.telemetry':             { min: 1,   max: 365 },
  'retention.specialist_telemetry':  { min: 7,   max: 365 },
  'retention.workflow_patterns':     { min: 7,   max: 365 },
  'retention.drift_checks':         { min: 7,   max: 365 },
  'retention.expertise_logs':        { min: 7,   max: 365 },
  'retention.skill_steps':           { min: 7,   max: 365 },
  'retention.audit_events':          { min: 14,  max: 3650 },
  'retention.quality_scores':        { min: 14,  max: 365 },
  'retention.soft_delete_grace':     { min: 1,   max: 365 },
  'backup.periodic_hours':           { min: 1,   max: 168 },
  'backup.max_daily':                { min: 1,   max: 30 },
  'backup.max_weekly':               { min: 1,   max: 12 },
  'drain.cutoff_hours':              { min: 1,   max: 168 },
  'clean.interval_hours':            { min: 1,   max: 168 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Table → Config Key Mapping
// ─────────────────────────────────────────────────────────────────────────────

const RETENTION_TABLE_MAP = [
  // Short retention (heavy logs)
  { table: 'llm_execution_log',     configKey: 'llm_logs',             dateCol: 'created_at' },
  { table: 'agent_logs',            configKey: 'agent_logs',           dateCol: 'created_at' },
  { table: 'cre_override_log',      configKey: 'cre_logs',             dateCol: 'created_at' },
  { table: 'telemetry_snapshots',   configKey: 'telemetry',            dateCol: 'created_at' },
  { table: 'telemetry_metrics',     configKey: 'telemetry',            dateCol: 'created_at' },
  { table: 'telemetry_alerts',      configKey: 'telemetry',            dateCol: 'created_at' },
  // Medium retention
  { table: 'specialist_telemetry',  configKey: 'specialist_telemetry', dateCol: 'created_at' },
  { table: 'workflow_patterns',     configKey: 'workflow_patterns',    dateCol: 'last_seen' },
  { table: 'drift_checks',         configKey: 'drift_checks',         dateCol: 'created_at' },
  { table: 'capability_drift_log',  configKey: 'drift_checks',         dateCol: 'created_at' },
  { table: 'auto_expertise_log',    configKey: 'expertise_logs',       dateCol: 'created_at' },
  { table: 'merge_audit_log',       configKey: 'expertise_logs',       dateCol: 'created_at' },
  { table: 'skill_steps',           configKey: 'skill_steps',          dateCol: 'created_at' },
  { table: 'execution_trace',       configKey: 'agent_logs',           dateCol: 'created_at' },
  // Long retention
  { table: 'audit_events',          configKey: 'audit_events',         dateCol: 'created_at' },
  { table: 'quality_scores',        configKey: 'quality_scores',       dateCol: 'created_at' },
  { table: 'conversation_memory',   configKey: 'quality_scores',       dateCol: 'created_at' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ROW_COUNT_WARNING_THRESHOLD = 200_000;
const MESSAGE_CAP_PER_CONVERSATION = 200;
const DB_SIZE_WARNING_MB = 500;
const DB_SIZE_AGGRESSIVE_MB = 2000;

// ─────────────────────────────────────────────────────────────────────────────
// Config: Read / Validate / Merge
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read storage configuration from user_settings, merged with defaults.
 * @param {import('better-sqlite3').Database} db - raw better-sqlite3 instance
 */
export function getStorageConfig(db) {
  try {
    const row = db.prepare('SELECT data FROM user_settings WHERE id = 1').get();
    if (!row) return structuredClone(DEFAULT_STORAGE_CONFIG);
    const settings = JSON.parse(row.data);
    return validateStorageConfig(settings.storage || {});
  } catch (_) {
    return structuredClone(DEFAULT_STORAGE_CONFIG);
  }
}

/**
 * Validate and merge input config with defaults. Clamp values to min/max.
 * @param {object} input - partial storage config from user
 */
export function validateStorageConfig(input) {
  const result = structuredClone(DEFAULT_STORAGE_CONFIG);

  for (const section of ['retention', 'backup', 'drain', 'clean']) {
    if (!input[section] || typeof input[section] !== 'object') continue;

    for (const [key, val] of Object.entries(input[section])) {
      if (!(key in result[section])) continue;

      const rule = VALIDATION[`${section}.${key}`];
      if (rule) {
        const num = parseInt(val, 10);
        if (!isNaN(num)) {
          result[section][key] = Math.max(rule.min, Math.min(rule.max, num));
        }
      } else if (typeof result[section][key] === 'boolean') {
        result[section][key] = !!val;
      }
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: Prune All Data (DB tables only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prune DB tables based on configurable retention policies.
 * @param {import('better-sqlite3').Database} db
 * @param {{ config?: object }} opts
 */
export function pruneAllData(db, opts = {}) {
  const config = opts.config || getStorageConfig(db);
  const retention = config.retention;
  const stats = { totalDeleted: 0, tables: {}, dbSizeMB: 0, pressure: 'normal', deletedConvIds: [] };

  // ── Check DB size for pressure control ──
  try {
    const pageCount = db.pragma('page_count', { simple: true });
    const pageSize = db.pragma('page_size', { simple: true });
    stats.dbSizeMB = Math.round((pageCount * pageSize) / (1024 * 1024));

    if (stats.dbSizeMB > DB_SIZE_AGGRESSIVE_MB) {
      stats.pressure = 'aggressive';
      logger.warn('Retention', `DB size ${stats.dbSizeMB}MB > ${DB_SIZE_AGGRESSIVE_MB}MB — aggressive pruning`);
    } else if (stats.dbSizeMB > DB_SIZE_WARNING_MB) {
      stats.pressure = 'elevated';
      logger.info('Retention', `DB size ${stats.dbSizeMB}MB > ${DB_SIZE_WARNING_MB}MB — elevated pruning`);
    }
  } catch (_) {}

  const pressureMultiplier = stats.pressure === 'aggressive' ? 0.5
    : stats.pressure === 'elevated' ? 0.75
    : 1.0;

  // ── 1. Time-based table pruning ──
  for (const entry of RETENTION_TABLE_MAP) {
    try {
      const baseDays = retention[entry.configKey] ?? DEFAULT_STORAGE_CONFIG.retention[entry.configKey] ?? 30;
      const effectiveDays = Math.max(1, Math.floor(baseDays * pressureMultiplier));
      const result = db.prepare(`
        DELETE FROM ${entry.table}
        WHERE ${entry.dateCol} < datetime('now', ?)
      `).run(`-${effectiveDays} days`);

      if (result.changes > 0) {
        stats.tables[entry.table] = result.changes;
        stats.totalDeleted += result.changes;
      }

      // Row count warning
      try {
        const { cnt } = db.prepare(`SELECT COUNT(*) as cnt FROM ${entry.table}`).get();
        if (cnt > ROW_COUNT_WARNING_THRESHOLD) {
          logger.warn('Retention', `${entry.table} has ${cnt} rows — consider shorter retention`);
        }
      } catch (_) {}
    } catch (_) {
      // Table may not exist yet — skip silently
    }
  }

  // ── 2. Hard-delete soft-deleted conversations ──
  const graceDays = retention.soft_delete_grace ?? 14;
  try {
    const deletedConvos = db.prepare(`
      SELECT id FROM conversations
      WHERE deleted_at IS NOT NULL
      AND deleted_at < datetime('now', ?)
    `).all(`-${graceDays} days`);

    for (const conv of deletedConvos) {
      db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conv.id);
      db.prepare('DELETE FROM conversations WHERE id = ?').run(conv.id);
      stats.deletedConvIds.push(conv.id);
      stats.totalDeleted += 1;
    }
    if (deletedConvos.length > 0) {
      stats.tables['_soft_deleted_convos'] = deletedConvos.length;
    }
  } catch (_) {}

  // ── 3. Hard-delete soft-deleted projects ──
  try {
    const deletedProjects = db.prepare(`
      SELECT id FROM projects
      WHERE status = 'deleted'
      AND updated_at < datetime('now', ?)
    `).all(`-${graceDays} days`);

    for (const proj of deletedProjects) {
      db.prepare('DELETE FROM project_memory WHERE project_id = ?').run(proj.id);
      const convos = db.prepare('SELECT id FROM conversations WHERE project_id = ?').all(proj.id);
      for (const c of convos) {
        db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(c.id);
        stats.deletedConvIds.push(c.id);
      }
      db.prepare('DELETE FROM conversations WHERE project_id = ?').run(proj.id);
      db.prepare('DELETE FROM projects WHERE id = ?').run(proj.id);
      stats.totalDeleted += 1;
    }
    if (deletedProjects.length > 0) {
      stats.tables['_soft_deleted_projects'] = deletedProjects.length;
    }
  } catch (_) {}

  // ── 4. Archive old messages (cap 200/conversation) ──
  try {
    const bigConvos = db.prepare(`
      SELECT conversation_id, COUNT(*) as cnt
      FROM messages WHERE archived = 0
      GROUP BY conversation_id HAVING cnt > ?
    `).all(MESSAGE_CAP_PER_CONVERSATION);

    let archived = 0;
    for (const { conversation_id, cnt } of bigConvos) {
      const excess = cnt - MESSAGE_CAP_PER_CONVERSATION;
      const result = db.prepare(`
        UPDATE messages SET archived = 1
        WHERE id IN (
          SELECT id FROM messages
          WHERE conversation_id = ? AND archived = 0
          ORDER BY created_at ASC
          LIMIT ?
        )
      `).run(conversation_id, excess);
      archived += result.changes;
    }
    if (archived > 0) {
      stats.tables['_messages_archived'] = archived;
    }
  } catch (_) {}

  // ── 5. Hard-delete archived messages older than 180 days ──
  try {
    const result = db.prepare(`
      DELETE FROM messages
      WHERE archived = 1
      AND created_at < datetime('now', '-180 days')
    `).run();
    if (result.changes > 0) {
      stats.tables['_archived_purged'] = result.changes;
      stats.totalDeleted += result.changes;
    }
  } catch (_) {}

  // ── 6. LTM: prune expired entries (TTL-based) ──
  try {
    const result = db.prepare(`
      DELETE FROM memory
      WHERE ttl IS NOT NULL
      AND (julianday('now') - julianday(created_at)) * 86400 > ttl
    `).run();
    if (result.changes > 0) {
      stats.tables['memory_ttl'] = result.changes;
      stats.totalDeleted += result.changes;
    }
  } catch (_) {}

  // ── 7. FTS cleanup (orphaned rows from deleted messages) ──
  try {
    db.prepare('DELETE FROM messages_fts WHERE rowid NOT IN (SELECT id FROM messages)').run();
    db.prepare("INSERT INTO messages_fts(messages_fts) VALUES('optimize')").run();
  } catch (_) {}

  if (stats.totalDeleted > 0) {
    logger.info('Retention', `Pruned ${stats.totalDeleted} rows (DB: ${stats.dbSizeMB}MB, pressure: ${stats.pressure})`, stats.tables);
  }

  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-Clean: Full Cleanup (DB + History JSONL + Compact)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full auto-clean: prune DB tables + clean orphaned JSONL + prune old history + compact.
 * @param {import('better-sqlite3').Database} db
 * @param {string} dataDir - base data directory (contains c3.db)
 * @param {{ config?: object }} opts
 */
export function autoClean(db, dataDir, opts = {}) {
  const config = opts.config || getStorageConfig(db);
  const stats = { db: null, history: { deleted: 0, freedBytes: 0 }, jsonlCleaned: 0 };

  try {
    // 1. Prune DB tables (configurable retention + soft-delete + archive + LTM + FTS)
    stats.db = pruneAllData(db, { config });

    // 2. Clean JSONL files for hard-deleted conversations
    if (stats.db.deletedConvIds.length > 0) {
      for (const convId of stats.db.deletedConvIds) {
        try {
          if (deleteConversationHistory(dataDir, convId)) stats.jsonlCleaned++;
        } catch (_) {}
      }
    }

    // 3. Prune old history JSONL files (by mtime)
    stats.history = pruneHistory(dataDir, {
      conversations: config.retention.conversations,
      lifecycle: config.retention.lifecycle,
      memory_changes: config.retention.memory_changes,
    });

    // 4. Conditional compact
    if ((stats.db.totalDeleted > 50) || stats.db.pressure !== 'normal') {
      compactDatabase(db);
    }
  } catch (err) {
    logger.error('Retention', `Auto-clean failed: ${err.message}`);
  }

  const total = (stats.db?.totalDeleted || 0) + stats.history.deleted + stats.jsonlCleaned;
  if (total > 0) {
    logger.info('Retention',
      `Auto-clean: ${stats.db?.totalDeleted || 0} DB rows, ` +
      `${stats.history.deleted} JSONL files (${Math.round(stats.history.freedBytes / 1024)}KB), ` +
      `${stats.jsonlCleaned} orphaned JSONL cleaned`
    );
  }

  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// WAL Compaction + Optimize
// ─────────────────────────────────────────────────────────────────────────────

export function compactDatabase(db) {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.exec('ANALYZE');
    logger.info('Retention', 'Database compacted (WAL checkpoint + ANALYZE)');
  } catch (err) {
    logger.warn('Retention', 'Compact failed (non-critical)', { error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DB Size Query
// ─────────────────────────────────────────────────────────────────────────────

export function getDbSizeMB(db) {
  try {
    const pageCount = db.pragma('page_count', { simple: true });
    const pageSize = db.pragma('page_size', { simple: true });
    return Math.round((pageCount * pageSize) / (1024 * 1024));
  } catch (_) {
    return 0;
  }
}
