// tests/storage-architecture.test.js — v92 Storage Architecture tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests: history-drain, data-retention (config + autoClean), db-backup
// Run: node tests/storage-architecture.test.js

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-storage-test-'));
  return dir;
}

function cleanDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

function createTestDb(dataDir) {
  const dbPath = path.join(dataDir, 'c3.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Minimal schema for storage tests
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      id INTEGER PRIMARY KEY,
      data TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      project_id INTEGER,
      deleted_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      tokens INTEGER DEFAULT 0,
      metadata TEXT DEFAULT '{}',
      archived INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      path TEXT,
      description TEXT,
      status TEXT DEFAULT 'active',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS project_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      key TEXT,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT,
      key TEXT,
      value TEXT,
      confidence REAL DEFAULT 0.5,
      ttl INTEGER,
      access_count INTEGER DEFAULT 0,
      last_accessed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS llm_execution_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS telemetry_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO schema_migrations (version) VALUES ('001'), ('002'), ('003');
  `);

  return db;
}

function insertMessage(db, convId, role, content, ageHours = 0) {
  return db.prepare(`
    INSERT INTO messages (conversation_id, role, content, created_at)
    VALUES (?, ?, ?, datetime('now', ?))
  `).run(convId, role, content, `-${ageHours} hours`);
}

function insertOldLog(db, table, content, ageDays) {
  db.prepare(`
    INSERT INTO ${table} (content, created_at) VALUES (?, datetime('now', ?))
  `).run(content, `-${ageDays} days`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORT MODULES UNDER TEST
// ═══════════════════════════════════════════════════════════════════════════════

const { drainMessages, getHistoryStats, pruneHistory, deleteConversationHistory, validateHistoryIntegrity } =
  await import('../src/core/history-drain.js');

const { DEFAULT_STORAGE_CONFIG, getStorageConfig, validateStorageConfig, pruneAllData, autoClean, compactDatabase, getDbSizeMB } =
  await import('../src/db/data-retention.js');

const { createStateBackup, listBackups, pruneBackups, getBackupStats } =
  await import('../src/core/db-backup.js');

// ═══════════════════════════════════════════════════════════════════════════════
// 1. HISTORY DRAIN TESTS
// ═══════════════════════════════════════════════════════════════════════════════

suite('History Drain — drainMessages');

test('drainMessages: no messages → stats zero', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);
    const result = drainMessages(db, dir, { cutoffHours: 24 });
    assertEqual(result.drained, 0);
    assertEqual(result.files, 0);
    assertEqual(result.errors.length, 0);
    db.close();
  } finally { cleanDir(dir); }
});

test('drainMessages: recent messages not drained', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);
    db.prepare("INSERT INTO conversations (id, title) VALUES ('conv-1', 'Test')").run();
    insertMessage(db, 'conv-1', 'user', 'Hello', 0); // now — should NOT be drained
    const result = drainMessages(db, dir, { cutoffHours: 24 });
    assertEqual(result.drained, 0);
    // Message still in DB
    const cnt = db.prepare('SELECT COUNT(*) as cnt FROM messages').get().cnt;
    assertEqual(cnt, 1);
    db.close();
  } finally { cleanDir(dir); }
});

test('drainMessages: old messages drained to JSONL', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);
    db.prepare("INSERT INTO conversations (id, title) VALUES ('conv-abc', 'Test')").run();
    insertMessage(db, 'conv-abc', 'user', 'Old message 1', 48);
    insertMessage(db, 'conv-abc', 'assistant', 'Old reply', 47);
    insertMessage(db, 'conv-abc', 'user', 'Recent', 0);

    const result = drainMessages(db, dir, { cutoffHours: 24 });
    assertEqual(result.drained, 2);
    assertEqual(result.files, 1);

    // Only recent message remains
    const cnt = db.prepare('SELECT COUNT(*) as cnt FROM messages').get().cnt;
    assertEqual(cnt, 1);

    // JSONL file exists
    const jsonlPath = path.join(dir, 'history', 'conversations', 'co', 'conv-abc.jsonl');
    assert(fs.existsSync(jsonlPath), 'JSONL file should exist');

    // Parse JSONL
    const lines = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n');
    assertEqual(lines.length, 2);
    const msg1 = JSON.parse(lines[0]);
    assertEqual(msg1.conv_id, 'conv-abc');
    assertEqual(msg1.role, 'user');
    assertEqual(msg1.content, 'Old message 1');

    db.close();
  } finally { cleanDir(dir); }
});

test('drainMessages: soft-deleted conversations excluded', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);
    db.prepare("INSERT INTO conversations (id, title, deleted_at) VALUES ('conv-del', 'Deleted', datetime('now', '-1 hour'))").run();
    insertMessage(db, 'conv-del', 'user', 'Should not drain', 48);

    const result = drainMessages(db, dir, { cutoffHours: 24 });
    assertEqual(result.drained, 0);
    assertEqual(result.files, 0);

    db.close();
  } finally { cleanDir(dir); }
});

test('drainMessages: multiple conversations to separate JSONL files', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);
    db.prepare("INSERT INTO conversations (id, title) VALUES ('conv-aaa', 'Conv A')").run();
    db.prepare("INSERT INTO conversations (id, title) VALUES ('conv-bbb', 'Conv B')").run();
    insertMessage(db, 'conv-aaa', 'user', 'Msg A', 48);
    insertMessage(db, 'conv-bbb', 'user', 'Msg B', 48);

    const result = drainMessages(db, dir, { cutoffHours: 24 });
    assertEqual(result.drained, 2);
    assertEqual(result.files, 2);

    assert(fs.existsSync(path.join(dir, 'history', 'conversations', 'co', 'conv-aaa.jsonl')));
    assert(fs.existsSync(path.join(dir, 'history', 'conversations', 'co', 'conv-bbb.jsonl')));

    db.close();
  } finally { cleanDir(dir); }
});

suite('History Drain — getHistoryStats');

test('getHistoryStats: empty → all zeros', () => {
  const dir = tmpDir();
  try {
    const stats = getHistoryStats(dir);
    assertEqual(stats.totalBytes, 0);
    assertEqual(stats.conversations, 0);
  } finally { cleanDir(dir); }
});

test('getHistoryStats: counts JSONL files', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);
    db.prepare("INSERT INTO conversations (id, title) VALUES ('conv-xyz', 'Test')").run();
    insertMessage(db, 'conv-xyz', 'user', 'Test', 48);
    drainMessages(db, dir, { cutoffHours: 24 });

    const stats = getHistoryStats(dir);
    assertEqual(stats.conversations, 1);
    assert(stats.totalBytes > 0, 'totalBytes should be > 0');

    db.close();
  } finally { cleanDir(dir); }
});

suite('History Drain — pruneHistory');

test('pruneHistory: no files → nothing deleted', () => {
  const dir = tmpDir();
  try {
    const stats = pruneHistory(dir, { conversations: 365 });
    assertEqual(stats.deleted, 0);
  } finally { cleanDir(dir); }
});

suite('History Drain — deleteConversationHistory');

test('deleteConversationHistory: deletes specific JSONL', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);
    db.prepare("INSERT INTO conversations (id, title) VALUES ('conv-del2', 'Delete me')").run();
    insertMessage(db, 'conv-del2', 'user', 'Data', 48);
    drainMessages(db, dir, { cutoffHours: 24 });

    const jsonlPath = path.join(dir, 'history', 'conversations', 'co', 'conv-del2.jsonl');
    assert(fs.existsSync(jsonlPath), 'JSONL should exist before delete');

    const result = deleteConversationHistory(dir, 'conv-del2');
    assert(result === true, 'Should return true');
    assert(!fs.existsSync(jsonlPath), 'JSONL should be deleted');

    db.close();
  } finally { cleanDir(dir); }
});

test('deleteConversationHistory: non-existent → false', () => {
  const dir = tmpDir();
  try {
    const result = deleteConversationHistory(dir, 'conv-nonexistent');
    assert(result === false, 'Should return false for non-existent');
  } finally { cleanDir(dir); }
});

suite('History Drain — validateHistoryIntegrity');

test('validateHistoryIntegrity: empty dir → 0 fixed', () => {
  const dir = tmpDir();
  try {
    const fixed = validateHistoryIntegrity(dir);
    assertEqual(fixed, 0);
  } finally { cleanDir(dir); }
});

test('validateHistoryIntegrity: truncates incomplete last line', () => {
  const dir = tmpDir();
  try {
    const convDir = path.join(dir, 'history', 'conversations', 'ab');
    fs.mkdirSync(convDir, { recursive: true });
    const jsonlPath = path.join(convDir, 'abc123.jsonl');

    // Write valid line + incomplete line (no trailing newline)
    fs.writeFileSync(jsonlPath, '{"id":1}\n{"id":2,"incomp');

    const fixed = validateHistoryIntegrity(dir);
    assertEqual(fixed, 1);

    // Only the complete first line should remain
    const content = fs.readFileSync(jsonlPath, 'utf-8');
    assertEqual(content, '{"id":1}\n');
  } finally { cleanDir(dir); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. DATA RETENTION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

suite('Data Retention — validateStorageConfig');

test('validateStorageConfig: empty input → defaults', () => {
  const result = validateStorageConfig({});
  assertEqual(result.retention.conversations, 365);
  assertEqual(result.retention.llm_logs, 5);
  assertEqual(result.drain.cutoff_hours, 24);
  assertEqual(result.clean.enabled, true);
  assertEqual(result.backup.on_shutdown, true);
});

test('validateStorageConfig: valid values preserved', () => {
  const result = validateStorageConfig({
    retention: { llm_logs: 10, conversations: 100 },
    drain: { cutoff_hours: 12 },
  });
  assertEqual(result.retention.llm_logs, 10);
  assertEqual(result.retention.conversations, 100);
  assertEqual(result.drain.cutoff_hours, 12);
});

test('validateStorageConfig: values clamped to min/max', () => {
  const result = validateStorageConfig({
    retention: { llm_logs: 0, conversations: 10000 },
    drain: { cutoff_hours: 999 },
  });
  assertEqual(result.retention.llm_logs, 1); // min 1
  assertEqual(result.retention.conversations, 3650); // max 3650
  assertEqual(result.drain.cutoff_hours, 168); // max 168
});

test('validateStorageConfig: boolean fields', () => {
  const result = validateStorageConfig({
    drain: { enabled: false },
    backup: { on_shutdown: false, periodic: true },
  });
  assertEqual(result.drain.enabled, false);
  assertEqual(result.backup.on_shutdown, false);
  assertEqual(result.backup.periodic, true);
});

test('validateStorageConfig: unknown keys ignored', () => {
  const result = validateStorageConfig({
    retention: { unknown_key: 999 },
    bogus_section: { foo: 'bar' },
  });
  assert(!('unknown_key' in result.retention), 'Unknown key should not appear');
  assert(!('bogus_section' in result), 'Unknown section should not appear');
});

suite('Data Retention — getStorageConfig');

test('getStorageConfig: no user_settings → defaults', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);
    const config = getStorageConfig(db);
    assertEqual(config.retention.conversations, 365);
    assertEqual(config.drain.cutoff_hours, 24);
    db.close();
  } finally { cleanDir(dir); }
});

test('getStorageConfig: reads from user_settings', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);
    db.prepare("INSERT INTO user_settings (id, data) VALUES (1, ?)").run(JSON.stringify({
      storage: { retention: { llm_logs: 3 }, drain: { cutoff_hours: 6 } },
    }));

    const config = getStorageConfig(db);
    assertEqual(config.retention.llm_logs, 3);
    assertEqual(config.drain.cutoff_hours, 6);
    assertEqual(config.retention.conversations, 365); // default preserved
    db.close();
  } finally { cleanDir(dir); }
});

suite('Data Retention — pruneAllData');

test('pruneAllData: prunes old logs', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);
    // Insert old agent_logs (default retention: 7 days)
    insertOldLog(db, 'agent_logs', 'old log 1', 10);
    insertOldLog(db, 'agent_logs', 'old log 2', 15);
    insertOldLog(db, 'agent_logs', 'recent log', 1);

    const stats = pruneAllData(db);
    assertEqual(stats.tables['agent_logs'], 2); // 2 old logs pruned
    const cnt = db.prepare('SELECT COUNT(*) as cnt FROM agent_logs').get().cnt;
    assertEqual(cnt, 1); // 1 recent remains

    db.close();
  } finally { cleanDir(dir); }
});

test('pruneAllData: hard-deletes soft-deleted conversations', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);
    db.prepare(`
      INSERT INTO conversations (id, title, deleted_at) VALUES ('conv-sd', 'Soft deleted', datetime('now', '-30 days'))
    `).run();
    insertMessage(db, 'conv-sd', 'user', 'Message in deleted conv', 0);

    const stats = pruneAllData(db);
    assert(stats.deletedConvIds.includes('conv-sd'), 'Should include deleted conv ID');

    const conv = db.prepare("SELECT * FROM conversations WHERE id = 'conv-sd'").get();
    assert(!conv, 'Conversation should be hard-deleted');

    const msgs = db.prepare("SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = 'conv-sd'").get().cnt;
    assertEqual(msgs, 0);

    db.close();
  } finally { cleanDir(dir); }
});

test('pruneAllData: respects configurable retention', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);
    insertOldLog(db, 'agent_logs', 'log 1', 5);  // 5 days old
    insertOldLog(db, 'agent_logs', 'log 2', 3);  // 3 days old
    insertOldLog(db, 'agent_logs', 'log 3', 1);  // 1 day old

    // Custom config: agent_logs retention = 2 days
    const config = validateStorageConfig({ retention: { agent_logs: 2 } });
    const stats = pruneAllData(db, { config });

    // Logs older than 2 days should be pruned (5d and 3d old)
    assertEqual(stats.tables['agent_logs'], 2);

    db.close();
  } finally { cleanDir(dir); }
});

suite('Data Retention — autoClean');

test('autoClean: orchestrates DB prune + JSONL cleanup', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);

    // Create a soft-deleted conversation with JSONL history
    db.prepare("INSERT INTO conversations (id, title) VALUES ('conv-ac', 'Auto-clean test')").run();
    insertMessage(db, 'conv-ac', 'user', 'Old msg', 48);
    drainMessages(db, dir, { cutoffHours: 24 });

    // Verify JSONL exists
    const jsonlPath = path.join(dir, 'history', 'conversations', 'co', 'conv-ac.jsonl');
    assert(fs.existsSync(jsonlPath), 'JSONL should exist after drain');

    // Now soft-delete and run autoClean
    db.prepare("UPDATE conversations SET deleted_at = datetime('now', '-30 days') WHERE id = 'conv-ac'").run();

    const stats = autoClean(db, dir);
    assert(stats.db !== null, 'DB stats should exist');
    assert(stats.db.deletedConvIds.includes('conv-ac'), 'Should include deleted conv');
    assertEqual(stats.jsonlCleaned, 1);
    assert(!fs.existsSync(jsonlPath), 'JSONL should be cleaned after autoClean');

    db.close();
  } finally { cleanDir(dir); }
});

suite('Data Retention — utilities');

test('getDbSizeMB: returns number', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);
    const size = getDbSizeMB(db);
    assert(typeof size === 'number', 'Should return number');
    assert(size >= 0, 'Should be >= 0');
    db.close();
  } finally { cleanDir(dir); }
});

test('compactDatabase: runs without error', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);
    compactDatabase(db); // Should not throw
    db.close();
  } finally { cleanDir(dir); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. DB BACKUP TESTS
// ═══════════════════════════════════════════════════════════════════════════════

suite('DB Backup — createStateBackup');

test('createStateBackup: creates backup directory with DB', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);
    const result = createStateBackup(db, dir);

    assert(!result.error, `Should not have error: ${result.error}`);
    assert(result.files > 0, 'Should have files');
    assert(result.size > 0, 'Should have size');
    assert(result.name.startsWith('c3-state-'), 'Name should start with c3-state-');

    // Verify DB copy exists
    const dbBackup = path.join(result.path, 'c3.db');
    assert(fs.existsSync(dbBackup), 'Backup DB should exist');

    // Verify metadata.json
    const metadata = JSON.parse(fs.readFileSync(path.join(result.path, 'metadata.json'), 'utf-8'));
    assertEqual(metadata.type, 'state');
    assertEqual(metadata.contract, 'IntentSmithStateBackup');
    assertEqual(metadata.format_version, 2);
    assert(metadata.created_at, 'Should have created_at');
    assertEqual(metadata.schema_version, 3); // We inserted 3 migrations
    assertEqual(metadata.migration_versions.join(','), '001,002,003');
    assert(metadata.migration_fingerprint.startsWith('sha256:'), 'Should pin migrations');
    assert(metadata.content_fingerprint.startsWith('sha256:'), 'Should pin payload');
    assert(metadata.db_size_bytes > 0, 'Should have db_size_bytes');

    db.close();
  } finally { cleanDir(dir); }
});

test('createStateBackup: same-day backups are immutable and distinct', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);
    const result1 = createStateBackup(db, dir);
    const result2 = createStateBackup(db, dir);

    // Both should succeed without deleting or overwriting the first snapshot.
    assert(result1.name !== result2.name, 'Backups must receive distinct immutable names');
    assert(!result2.error, 'Second backup should succeed');

    // Both backup directories survive.
    const backups = listBackups(dir);
    assertEqual(backups.length, 2);

    db.close();
  } finally { cleanDir(dir); }
});

suite('DB Backup — listBackups');

test('listBackups: empty → empty array', () => {
  const dir = tmpDir();
  try {
    const backups = listBackups(dir);
    assertEqual(backups.length, 0);
  } finally { cleanDir(dir); }
});

test('listBackups: returns backup metadata', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);
    createStateBackup(db, dir);

    const backups = listBackups(dir);
    assertEqual(backups.length, 1);
    assert(backups[0].name.startsWith('c3-state-'), 'Should have correct name');
    assert(backups[0].created_at, 'Should have created_at');
    assertEqual(backups[0].format_version, 2);
    assertEqual(backups[0].restorable, true);
    assert(backups[0].total_size_bytes > 0, 'Should have size');

    db.close();
  } finally { cleanDir(dir); }
});

suite('DB Backup — pruneBackups');

test('pruneBackups: keeps within limits', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);
    const backupsDir = path.join(dir, 'backups');

    // Create fake backup dirs with different dates
    for (const date of ['2026-02-20', '2026-02-21', '2026-02-22', '2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01']) {
      const bp = path.join(backupsDir, `c3-state-${date}.backup`);
      fs.mkdirSync(bp, { recursive: true });
      fs.writeFileSync(path.join(bp, 'metadata.json'), JSON.stringify({
        created_at: `${date}T12:00:00Z`,
        version: '92.0.0',
        schema_version: 3,
        type: 'state',
      }));
      fs.writeFileSync(path.join(bp, 'c3.db'), 'fake');
    }

    const before = listBackups(dir);
    assertEqual(before.length, 8);

    // Prune: keep 3 daily + 2 weekly
    const stats = pruneBackups(dir, { maxDaily: 3, maxWeekly: 2 });
    assert(stats.deleted > 0, 'Should delete some');

    const after = listBackups(dir);
    assert(after.length <= 5, `Should keep at most 5 (3 daily + 2 weekly), got ${after.length}`);

    db.close();
  } finally { cleanDir(dir); }
});

suite('DB Backup — getBackupStats');

test('getBackupStats: returns summary', () => {
  const dir = tmpDir();
  try {
    const db = createTestDb(dir);
    createStateBackup(db, dir);

    const stats = getBackupStats(dir);
    assertEqual(stats.count, 1);
    assert(stats.total_mb >= 0, 'Should have total_mb');
    assert(stats.last_at, 'Should have last_at');

    db.close();
  } finally { cleanDir(dir); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. DEFAULT CONFIG TESTS
// ═══════════════════════════════════════════════════════════════════════════════

suite('Default Config — structure');

test('DEFAULT_STORAGE_CONFIG has all sections', () => {
  assert('retention' in DEFAULT_STORAGE_CONFIG);
  assert('backup' in DEFAULT_STORAGE_CONFIG);
  assert('drain' in DEFAULT_STORAGE_CONFIG);
  assert('clean' in DEFAULT_STORAGE_CONFIG);
});

test('DEFAULT_STORAGE_CONFIG retention has all keys', () => {
  const r = DEFAULT_STORAGE_CONFIG.retention;
  assertEqual(r.conversations, 365);
  assertEqual(r.lifecycle, 365);
  assertEqual(r.memory_changes, 180);
  assertEqual(r.llm_logs, 5);
  assertEqual(r.agent_logs, 7);
  assertEqual(r.cre_logs, 7);
  assertEqual(r.telemetry, 14);
  assertEqual(r.specialist_telemetry, 30);
  assertEqual(r.workflow_patterns, 30);
  assertEqual(r.drift_checks, 30);
  assertEqual(r.expertise_logs, 30);
  assertEqual(r.skill_steps, 30);
  assertEqual(r.audit_events, 90);
  assertEqual(r.quality_scores, 90);
  assertEqual(r.soft_delete_grace, 14);
});

test('DEFAULT_STORAGE_CONFIG backup defaults', () => {
  const b = DEFAULT_STORAGE_CONFIG.backup;
  assertEqual(b.on_shutdown, true);
  assertEqual(b.on_startup, true);
  assertEqual(b.periodic, false);
  assertEqual(b.periodic_hours, 24);
  assertEqual(b.max_daily, 7);
  assertEqual(b.max_weekly, 4);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
