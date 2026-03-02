// v92: History Drain — move old messages from DB to append-only JSONL files.
//
// Hybrid model: DB holds recent messages, daily drain moves older to JSONL.
// JSONL files are append-only, crash-safe (fsync), and immutable once written.
//
// Must never throw — must not block startup or crash the server.

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function shardDir(convId) {
  return convId.slice(0, 2);
}

function convJsonlPath(historyDir, convId) {
  const shard = shardDir(convId);
  return path.join(historyDir, 'conversations', shard, `${convId}.jsonl`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Drain Messages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Drain messages older than cutoffHours from DB to JSONL files.
 * @param {import('better-sqlite3').Database} db - raw better-sqlite3 instance
 * @param {string} dataDir - base data directory (contains c3.db)
 * @param {{ cutoffHours?: number }} opts
 * @returns {{ drained: number, files: number, errors: string[] }}
 */
export function drainMessages(db, dataDir, opts = {}) {
  const cutoffHours = opts.cutoffHours ?? 24;
  const stats = { drained: 0, files: 0, errors: [] };

  try {
    const historyDir = path.join(dataDir, 'history');

    // Select messages older than cutoff, excluding soft-deleted conversations
    const rows = db.prepare(`
      SELECT m.id, m.conversation_id, m.role, m.content, m.tokens, m.metadata, m.created_at
      FROM messages m
      WHERE m.created_at < datetime('now', ?)
        AND m.conversation_id NOT IN (
          SELECT id FROM conversations WHERE deleted_at IS NOT NULL
        )
      ORDER BY m.conversation_id, m.created_at ASC
    `).all(`-${cutoffHours} hours`);

    if (rows.length === 0) return stats;

    // Group by conversation_id
    const byConv = {};
    for (const row of rows) {
      if (!byConv[row.conversation_id]) byConv[row.conversation_id] = [];
      byConv[row.conversation_id].push(row);
    }

    // Track successfully written message IDs for deletion
    const drainedIds = [];

    // Write JSONL files (outside transaction for crash safety — dedup on read)
    for (const [convId, messages] of Object.entries(byConv)) {
      const filePath = convJsonlPath(historyDir, convId);
      const dir = path.dirname(filePath);

      try {
        fs.mkdirSync(dir, { recursive: true });

        const lines = messages.map(m => JSON.stringify({
          id: m.id,
          conv_id: m.conversation_id,
          role: m.role,
          content: m.content,
          tokens: m.tokens,
          metadata: m.metadata,
          created_at: m.created_at,
        }));

        const fd = fs.openSync(filePath, 'a');
        try {
          fs.writeSync(fd, lines.join('\n') + '\n');
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }

        for (const m of messages) drainedIds.push(m.id);
        stats.files++;
      } catch (err) {
        stats.errors.push(`Write failed for ${convId}: ${err.message}`);
        // Skip this conversation — data stays in DB
      }
    }

    if (drainedIds.length === 0) return stats;

    // Delete drained messages from DB in a transaction
    const deleteStmt = db.prepare('DELETE FROM messages WHERE id = ?');
    const txn = db.transaction(() => {
      for (const id of drainedIds) {
        deleteStmt.run(id);
      }

      // Clean orphaned FTS rows
      try {
        db.prepare(`
          DELETE FROM messages_fts WHERE rowid NOT IN (SELECT id FROM messages)
        `).run();
        db.prepare(`
          INSERT INTO messages_fts(messages_fts) VALUES('optimize')
        `).run();
      } catch (_) {
        // FTS table may not exist
      }
    });

    txn();
    stats.drained = drainedIds.length;

    if (stats.drained > 0) {
      logger.info('Drain', `Drained ${stats.drained} messages to ${stats.files} JSONL files`);
    }
  } catch (err) {
    stats.errors.push(err.message);
    logger.error('Drain', `Drain failed: ${err.message}`);
  }

  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// History Stats
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get history stats: count of JSONL files, total size, per-type breakdown.
 */
export function getHistoryStats(dataDir) {
  const historyDir = path.join(dataDir, 'history');
  const stats = { totalBytes: 0, conversations: 0, lifecycle: 0, memory: 0 };

  try {
    // Conversations (sharded)
    const convDir = path.join(historyDir, 'conversations');
    if (fs.existsSync(convDir)) {
      for (const shard of fs.readdirSync(convDir)) {
        const shardPath = path.join(convDir, shard);
        try {
          const st = fs.statSync(shardPath);
          if (!st.isDirectory()) continue;
          for (const f of fs.readdirSync(shardPath)) {
            if (!f.endsWith('.jsonl')) continue;
            const fst = fs.statSync(path.join(shardPath, f));
            stats.conversations++;
            stats.totalBytes += fst.size;
          }
        } catch (_) {}
      }
    }

    // Lifecycle
    const lcDir = path.join(historyDir, 'lifecycle');
    if (fs.existsSync(lcDir)) {
      for (const f of fs.readdirSync(lcDir)) {
        if (!f.endsWith('.jsonl')) continue;
        const fst = fs.statSync(path.join(lcDir, f));
        stats.lifecycle++;
        stats.totalBytes += fst.size;
      }
    }

    // Memory
    const memDir = path.join(historyDir, 'memory');
    if (fs.existsSync(memDir)) {
      for (const f of fs.readdirSync(memDir)) {
        if (!f.endsWith('.jsonl')) continue;
        const fst = fs.statSync(path.join(memDir, f));
        stats.memory++;
        stats.totalBytes += fst.size;
      }
    }
  } catch (_) {}

  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prune Old History
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prune old JSONL files beyond retention.
 * @param {string} dataDir
 * @param {{ conversations?: number, lifecycle?: number, memory_changes?: number }} retentionDays
 */
export function pruneHistory(dataDir, retentionDays = {}) {
  const historyDir = path.join(dataDir, 'history');
  const stats = { deleted: 0, freedBytes: 0 };
  const now = Date.now();

  const policies = [
    { dir: path.join(historyDir, 'conversations'), days: retentionDays.conversations ?? 365, sharded: true },
    { dir: path.join(historyDir, 'lifecycle'), days: retentionDays.lifecycle ?? 365, sharded: false },
    { dir: path.join(historyDir, 'memory'), days: retentionDays.memory_changes ?? 180, sharded: false },
  ];

  for (const policy of policies) {
    try {
      if (!fs.existsSync(policy.dir)) continue;
      const cutoff = now - policy.days * 24 * 60 * 60 * 1000;

      if (policy.sharded) {
        // Walk shard directories
        for (const shard of fs.readdirSync(policy.dir)) {
          const shardPath = path.join(policy.dir, shard);
          try {
            if (!fs.statSync(shardPath).isDirectory()) continue;
            for (const f of fs.readdirSync(shardPath)) {
              if (!f.endsWith('.jsonl')) continue;
              const fp = path.join(shardPath, f);
              const st = fs.statSync(fp);
              if (st.mtimeMs < cutoff) {
                stats.freedBytes += st.size;
                fs.unlinkSync(fp);
                stats.deleted++;
              }
            }
            // Remove empty shard dir
            try {
              const remaining = fs.readdirSync(shardPath);
              if (remaining.length === 0) fs.rmdirSync(shardPath);
            } catch (_) {}
          } catch (_) {}
        }
      } else {
        for (const f of fs.readdirSync(policy.dir)) {
          if (!f.endsWith('.jsonl')) continue;
          const fp = path.join(policy.dir, f);
          const st = fs.statSync(fp);
          if (st.mtimeMs < cutoff) {
            stats.freedBytes += st.size;
            fs.unlinkSync(fp);
            stats.deleted++;
          }
        }
      }
    } catch (_) {}
  }

  if (stats.deleted > 0) {
    logger.info('Drain', `Pruned ${stats.deleted} old history files (${Math.round(stats.freedBytes / 1024)}KB freed)`);
  }

  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete Conversation History (for hard-delete cleanup)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete JSONL file for a specific conversation (called during hard-delete).
 */
export function deleteConversationHistory(dataDir, convId) {
  try {
    const filePath = convJsonlPath(path.join(dataDir, 'history'), convId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      // Clean empty shard dir
      const dir = path.dirname(filePath);
      try {
        if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
      } catch (_) {}
      return true;
    }
  } catch (_) {}
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Integrity Check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate JSONL integrity — truncate incomplete last lines (crash recovery).
 * Should run at startup before drain/clean.
 */
export function validateHistoryIntegrity(dataDir) {
  const historyDir = path.join(dataDir, 'history');
  let fixed = 0;

  try {
    if (!fs.existsSync(historyDir)) return fixed;

    // Walk all JSONL files
    const dirs = [
      { dir: path.join(historyDir, 'conversations'), sharded: true },
      { dir: path.join(historyDir, 'lifecycle'), sharded: false },
      { dir: path.join(historyDir, 'memory'), sharded: false },
    ];

    for (const { dir, sharded } of dirs) {
      if (!fs.existsSync(dir)) continue;

      const jsonlFiles = [];
      if (sharded) {
        for (const shard of fs.readdirSync(dir)) {
          const sp = path.join(dir, shard);
          try {
            if (!fs.statSync(sp).isDirectory()) continue;
            for (const f of fs.readdirSync(sp)) {
              if (f.endsWith('.jsonl')) jsonlFiles.push(path.join(sp, f));
            }
          } catch (_) {}
        }
      } else {
        for (const f of fs.readdirSync(dir)) {
          if (f.endsWith('.jsonl')) jsonlFiles.push(path.join(dir, f));
        }
      }

      for (const fp of jsonlFiles) {
        try {
          const content = fs.readFileSync(fp, 'utf-8');
          if (content.length === 0) continue;

          // Check if last character is newline
          if (content[content.length - 1] !== '\n') {
            // Find last complete line
            const lastNewline = content.lastIndexOf('\n');
            if (lastNewline === -1) {
              // Entire file is one incomplete line — truncate to empty
              fs.writeFileSync(fp, '');
            } else {
              // Truncate after last newline
              fs.truncateSync(fp, Buffer.byteLength(content.slice(0, lastNewline + 1), 'utf-8'));
            }
            fixed++;
            logger.warn('Drain', `Fixed incomplete JSONL: ${fp}`);
          }
        } catch (_) {}
      }
    }
  } catch (_) {}

  if (fixed > 0) {
    logger.info('Drain', `Integrity check: fixed ${fixed} JSONL file(s)`);
  }

  return fixed;
}
