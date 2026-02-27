// v86: Data Retention — tiered pruning with archive-before-delete.
//
// Retention tiers:
//   HOT:    0–30d   — full data, no pruning
//   WARM:   30–90d  — telemetry + logs pruned
//   COLD:   90–180d — messages archived (summarized), conversation_memory pruned
//   FROZEN: 180+d   — hard-deleted (except LTM which uses its own decay/TTL)
//
// Soft-deleted items: hard-deleted after 14 days.
// Messages: archived (summarized) before deletion — never lose semantic content.
//
// Must never throw — must not block startup or crash the server.

import { logger } from '../core/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Retention Policies
// ─────────────────────────────────────────────────────────────────────────────

const RETENTION_POLICIES = [
  // Telemetry — 30 days (HOT→WARM boundary)
  { table: 'telemetry_snapshots',    maxDays: 30,  dateCol: 'created_at' },
  { table: 'llm_execution_log',     maxDays: 30,  dateCol: 'created_at' },
  { table: 'quality_scores',        maxDays: 30,  dateCol: 'created_at' },
  { table: 'capability_drift_log',  maxDays: 30,  dateCol: 'created_at' },
  { table: 'specialist_telemetry',  maxDays: 30,  dateCol: 'created_at' },

  // Operational logs — 60 days (WARM)
  { table: 'agent_logs',            maxDays: 60,  dateCol: 'created_at' },
  { table: 'execution_trace',       maxDays: 60,  dateCol: 'created_at' },
  { table: 'cre_override_log',      maxDays: 60,  dateCol: 'created_at' },

  // Conversation metadata — 90 days (COLD)
  { table: 'conversation_memory',   maxDays: 90,  dateCol: 'created_at' },
];

const ROW_COUNT_WARNING_THRESHOLD = 200_000;
const SOFT_DELETE_GRACE_DAYS = 14;
const MESSAGE_CAP_PER_CONVERSATION = 200;

// DB size thresholds for pressure control (bytes)
const DB_SIZE_WARNING_MB = 500;
const DB_SIZE_AGGRESSIVE_MB = 2000;

// ─────────────────────────────────────────────────────────────────────────────
// Core: Prune All Data
// ─────────────────────────────────────────────────────────────────────────────

export function pruneAllData(db, opts = {}) {
  const stats = { totalDeleted: 0, tables: {}, dbSizeMB: 0, pressure: 'normal' };

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

  // Pressure multiplier: aggressive = 50% shorter retention
  const pressureMultiplier = stats.pressure === 'aggressive' ? 0.5
    : stats.pressure === 'elevated' ? 0.75
    : 1.0;

  // ── 1. Time-based table pruning ──
  for (const policy of RETENTION_POLICIES) {
    try {
      const effectiveDays = Math.max(7, Math.round(policy.maxDays * pressureMultiplier));
      const result = db.prepare(`
        DELETE FROM ${policy.table}
        WHERE ${policy.dateCol} < datetime('now', ?)
      `).run(`-${effectiveDays} days`);

      if (result.changes > 0) {
        stats.tables[policy.table] = result.changes;
        stats.totalDeleted += result.changes;
      }

      // Row count warning
      try {
        const { cnt } = db.prepare(`SELECT COUNT(*) as cnt FROM ${policy.table}`).get();
        if (cnt > ROW_COUNT_WARNING_THRESHOLD) {
          logger.warn('Retention', `${policy.table} has ${cnt} rows — consider shorter retention`);
        }
      } catch (_) {}
    } catch (_) {
      // Table may not exist yet — skip silently
    }
  }

  // ── 2. Hard-delete soft-deleted conversations (14 days grace) ──
  try {
    const deletedConvos = db.prepare(`
      SELECT id FROM conversations
      WHERE deleted_at IS NOT NULL
      AND deleted_at < datetime('now', ?)
    `).all(`-${SOFT_DELETE_GRACE_DAYS} days`);

    for (const conv of deletedConvos) {
      db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conv.id);
      db.prepare('DELETE FROM conversations WHERE id = ?').run(conv.id);
      stats.totalDeleted += 1;
    }
    if (deletedConvos.length > 0) {
      stats.tables['_soft_deleted_convos'] = deletedConvos.length;
    }
  } catch (_) {}

  // ── 3. Hard-delete soft-deleted projects (14 days grace) ──
  try {
    const deletedProjects = db.prepare(`
      SELECT id FROM projects
      WHERE status = 'deleted'
      AND updated_at < datetime('now', ?)
    `).all(`-${SOFT_DELETE_GRACE_DAYS} days`);

    for (const proj of deletedProjects) {
      db.prepare('DELETE FROM project_memory WHERE project_id = ?').run(proj.id);
      // Cascade to conversations and their messages
      const convos = db.prepare('SELECT id FROM conversations WHERE project_id = ?').all(proj.id);
      for (const c of convos) {
        db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(c.id);
      }
      db.prepare('DELETE FROM conversations WHERE project_id = ?').run(proj.id);
      db.prepare('DELETE FROM projects WHERE id = ?').run(proj.id);
      stats.totalDeleted += 1;
    }
    if (deletedProjects.length > 0) {
      stats.tables['_soft_deleted_projects'] = deletedProjects.length;
    }
  } catch (_) {}

  // ── 4. Archive old messages (summarize → mark archived → allow future delete) ──
  // Cap at MESSAGE_CAP_PER_CONVERSATION: archive messages beyond cap
  try {
    const bigConvos = db.prepare(`
      SELECT conversation_id, COUNT(*) as cnt
      FROM messages WHERE archived = 0
      GROUP BY conversation_id HAVING cnt > ?
    `).all(MESSAGE_CAP_PER_CONVERSATION);

    let archived = 0;
    for (const { conversation_id, cnt } of bigConvos) {
      // Mark oldest messages beyond cap as archived
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

  // ── 5. Hard-delete archived messages older than 180 days (FROZEN tier) ──
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

  if (stats.totalDeleted > 0) {
    logger.info('Retention', `Pruned ${stats.totalDeleted} rows (DB: ${stats.dbSizeMB}MB, pressure: ${stats.pressure})`, stats.tables);
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

// ─────────────────────────────────────────────────────────────────────────────
// Backward compat: pruneTelemetry alias
// ─────────────────────────────────────────────────────────────────────────────

export const pruneTelemetry = pruneAllData;
