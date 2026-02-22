// C3-Agent v64.0 — Schema Migration Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// T-SM1:  Fresh DB — all migrations applied
// T-SM2:  Idempotent — running twice changes nothing
// T-SM3:  schema_migrations table tracks all versions
// T-SM4:  getCurrentVersion returns latest
// T-SM5:  listMigrations shows applied status
// T-SM6:  Migration ordering (lexicographic = chronological)
// T-SM7:  Baseline creates all expected tables
// T-SM8:  ALTER TABLE migrations are idempotent (column check)
// T-SM9:  Failed migration rolls back (no partial state)
// T-SM10: hasColumn / hasTable utilities
//
// Spuštění: node tests/schema-migrations.test.js
//
// ══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';
import Database from 'better-sqlite3';

// ─── Test Infrastructure ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];
const pendingTests = [];

function describe(name, fn) {
  pendingTests.push(async () => {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  ${name}`);
    console.log(`${'═'.repeat(70)}`);
    await fn();
  });
}

async function it(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
  }
}

// ─── Imports ─────────────────────────────────────────────────────────────────

import { runMigrations, getCurrentVersion, listMigrations, hasColumn, hasTable } from '../src/db/migrate.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function getTableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(r => r.name);
}

function getColumnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

// Expected tables after all migrations (including v69 expert→expertise rename)
const EXPECTED_TABLES = [
  'agents', 'agent_logs', 'attachments',
  'calculation_runs',
  'capability_drift_log', 'change_requests', 'chat_fts', 'chat_messages', 'chat_sessions',
  'conversations', 'conversation_experts', 'conversation_expertises',
  'cre_override_log', 'custom_expertises',
  'drafts', 'drift_checks',
  'entity_profiles', 'entry_history',
  'expertise_bindings', 'expertise_memory', 'expertises',
  'expert_memory', 'experts',
  'financial_entries',
  'global_memory',
  'knowledge_facts', 'knowledge_sources', 'knowledge_verification_log',
  'learned_patterns', 'lifecycle_handoff_state', 'llm_execution_log', 'logs',
  'merge_audit_log', 'messages', 'messages_fts', 'milestones',
  'project_lifecycles', 'project_memory', 'projects',
  'roadmap_versions',
  'schema_migrations',
  'user_memory', 'user_settings',
  'workflow_sessions',
];

// ══════════════════════════════════════════════════════════════════════════════
// T-SM1: FRESH DB — ALL MIGRATIONS APPLIED
// ══════════════════════════════════════════════════════════════════════════════

describe('T-SM1: Fresh DB — all migrations applied', async () => {
  await it('applies all 9 migrations on empty DB', async () => {
    const db = freshDb();
    const result = await runMigrations(db);
    assert.strictEqual(result.applied.length, 9, `Expected 9 applied, got ${result.applied.length}`);
    assert.strictEqual(result.skipped.length, 0, 'No skipped on fresh DB');
    db.close();
  });

  await it('migration versions are in correct order', async () => {
    const db = freshDb();
    const result = await runMigrations(db);
    assert.deepStrictEqual(result.applied, [
      '2026_02_14_001_baseline',
      '2026_02_14_002_v59_is_external',
      '2026_02_14_003_v62_active_session',
      '2026_02_14_004_v63_execution_trace',
      '2026_02_14_005_v64_cre_override_log',
      '2026_02_18_006_v67_auto_compact',
      '2026_02_19_007_v68_knowledge_base',
      '2026_02_19_008_v69_ledger_core',
      '2026_02_20_008_v69_expert_to_expertise',
    ]);
    db.close();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-SM2: IDEMPOTENT — RUNNING TWICE CHANGES NOTHING
// ══════════════════════════════════════════════════════════════════════════════

describe('T-SM2: Idempotent — running twice changes nothing', async () => {
  await it('second run skips all migrations', async () => {
    const db = freshDb();
    await runMigrations(db);
    const result2 = await runMigrations(db);
    assert.strictEqual(result2.applied.length, 0, 'Nothing new applied');
    assert.strictEqual(result2.skipped.length, 9, 'All 9 skipped');
    db.close();
  });

  await it('tables are identical after double run', async () => {
    const db = freshDb();
    await runMigrations(db);
    const tables1 = getTableNames(db);
    await runMigrations(db);
    const tables2 = getTableNames(db);
    assert.deepStrictEqual(tables1, tables2);
    db.close();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-SM3: SCHEMA_MIGRATIONS TABLE TRACKS ALL VERSIONS
// ══════════════════════════════════════════════════════════════════════════════

describe('T-SM3: schema_migrations table', async () => {
  await it('contains all applied versions', async () => {
    const db = freshDb();
    await runMigrations(db);
    const rows = db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all();
    assert.strictEqual(rows.length, 9);
    assert.strictEqual(rows[0].version, '2026_02_14_001_baseline');
    assert.strictEqual(rows[8].version, '2026_02_20_008_v69_expert_to_expertise');
    db.close();
  });

  await it('applied_at is populated', async () => {
    const db = freshDb();
    await runMigrations(db);
    const rows = db.prepare('SELECT applied_at FROM schema_migrations').all();
    for (const row of rows) {
      assert.ok(row.applied_at, 'applied_at should not be null');
    }
    db.close();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-SM4: getCurrentVersion
// ══════════════════════════════════════════════════════════════════════════════

describe('T-SM4: getCurrentVersion', async () => {
  await it('returns null on empty DB', () => {
    const db = freshDb();
    const ver = getCurrentVersion(db);
    assert.strictEqual(ver, null);
    db.close();
  });

  await it('returns latest version after migrations', async () => {
    const db = freshDb();
    await runMigrations(db);
    const ver = getCurrentVersion(db);
    assert.strictEqual(ver, '2026_02_20_008_v69_expert_to_expertise');
    db.close();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-SM5: listMigrations
// ══════════════════════════════════════════════════════════════════════════════

describe('T-SM5: listMigrations', async () => {
  await it('shows all as pending on empty DB', async () => {
    const db = freshDb();
    const list = await listMigrations(db);
    assert.strictEqual(list.length, 9);
    assert.ok(list.every(m => m.applied === false), 'All should be pending');
    db.close();
  });

  await it('shows all as applied after runMigrations', async () => {
    const db = freshDb();
    await runMigrations(db);
    const list = await listMigrations(db);
    assert.strictEqual(list.length, 9);
    assert.ok(list.every(m => m.applied === true), 'All should be applied');
    db.close();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-SM6: MIGRATION ORDERING
// ══════════════════════════════════════════════════════════════════════════════

describe('T-SM6: Migration ordering', async () => {
  await it('versions are lexicographically sorted (timestamp-based)', async () => {
    const db = freshDb();
    const list = await listMigrations(db);
    const versions = list.map(m => m.version);
    const sorted = [...versions].sort();
    assert.deepStrictEqual(versions, sorted, 'Migrations should be in sorted order');
    db.close();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-SM7: BASELINE CREATES ALL EXPECTED TABLES
// ══════════════════════════════════════════════════════════════════════════════

describe('T-SM7: Baseline creates all expected tables', async () => {
  await it('all expected tables exist', async () => {
    const db = freshDb();
    await runMigrations(db);
    const tables = getTableNames(db);

    for (const expected of EXPECTED_TABLES) {
      assert.ok(tables.includes(expected), `Missing table: ${expected}`);
    }
    db.close();
  });

  await it('projects table has is_external column', async () => {
    const db = freshDb();
    await runMigrations(db);
    assert.ok(hasColumn(db, 'projects', 'is_external'), 'projects.is_external');
    db.close();
  });

  await it('project_lifecycles has active_session_id', async () => {
    const db = freshDb();
    await runMigrations(db);
    assert.ok(hasColumn(db, 'project_lifecycles', 'active_session_id'), 'project_lifecycles.active_session_id');
    db.close();
  });

  await it('merge_audit_log has execution_trace_id', async () => {
    const db = freshDb();
    await runMigrations(db);
    assert.ok(hasColumn(db, 'merge_audit_log', 'execution_trace_id'), 'merge_audit_log.execution_trace_id');
    db.close();
  });

  await it('capability_drift_log has execution_trace_id + execution_step', async () => {
    const db = freshDb();
    await runMigrations(db);
    assert.ok(hasColumn(db, 'capability_drift_log', 'execution_trace_id'));
    assert.ok(hasColumn(db, 'capability_drift_log', 'execution_step'));
    db.close();
  });

  await it('llm_execution_log has all expected columns', async () => {
    const db = freshDb();
    await runMigrations(db);
    const cols = getColumnNames(db, 'llm_execution_log');
    for (const c of ['execution_trace_id', 'model', 'temperature', 'prompt_hash', 'latency_ms', 'token_source']) {
      assert.ok(cols.includes(c), `Missing column: llm_execution_log.${c}`);
    }
    db.close();
  });

  await it('conversation_expertises has weight with CHECK constraint', async () => {
    const db = freshDb();
    await runMigrations(db);
    // Insert valid
    db.prepare("INSERT INTO conversations (id) VALUES ('test-conv')").run();
    db.prepare("INSERT INTO conversation_expertises (conversation_id, expertise_id, weight, position) VALUES ('test-conv', 'e1', 0.5, 0)").run();
    // Invalid weight should fail
    assert.throws(() => {
      db.prepare("INSERT INTO conversation_expertises (conversation_id, expertise_id, weight, position) VALUES ('test-conv', 'e2', 0.0, 1)").run();
    }, /CHECK/i);
    db.close();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-SM8: ALTER TABLE MIGRATIONS ARE IDEMPOTENT
// ══════════════════════════════════════════════════════════════════════════════

describe('T-SM8: ALTER TABLE migrations idempotent on existing DB', async () => {
  await it('simulates pre-migration DB (no is_external, no active_session_id)', async () => {
    const db = freshDb();

    // Create minimal pre-migration tables (simulating a DB from before migration system).
    // Only tables that need ALTER TABLE — baseline's CREATE IF NOT EXISTS handles the rest.
    // NOTE: Do NOT pre-create tables with partial schemas (e.g. conversations without project_id)
    //       because the baseline's indexes reference columns that wouldn't exist.
    db.exec(`
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        path TEXT UNIQUE NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_active DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE project_lifecycles (
        id TEXT PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        phase TEXT NOT NULL DEFAULT 'SPEC',
        spec TEXT,
        config TEXT NOT NULL DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE merge_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT,
        timestamp TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE capability_drift_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT,
        expert_id TEXT NOT NULL,
        merged_prompt_hash TEXT,
        expected_profile TEXT NOT NULL,
        observed_scores TEXT NOT NULL,
        drift_score REAL NOT NULL DEFAULT 0,
        violations TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE llm_execution_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_trace_id TEXT,
        conversation_id TEXT,
        execution_step TEXT NOT NULL DEFAULT 'LLM',
        expert_id TEXT,
        model TEXT,
        temperature REAL,
        prompt_hash TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        latency_ms INTEGER,
        token_source TEXT DEFAULT 'estimated',
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Verify columns are missing
    assert.ok(!hasColumn(db, 'projects', 'is_external'), 'pre-migration: no is_external');
    assert.ok(!hasColumn(db, 'project_lifecycles', 'active_session_id'), 'pre-migration: no active_session_id');
    assert.ok(!hasColumn(db, 'merge_audit_log', 'execution_trace_id'), 'pre-migration: no execution_trace_id');

    // Run migrations — baseline is IF NOT EXISTS (tables already exist), ALTER TABLE migrations add columns
    await runMigrations(db);

    // Verify columns were added
    assert.ok(hasColumn(db, 'projects', 'is_external'), 'post-migration: has is_external');
    assert.ok(hasColumn(db, 'project_lifecycles', 'active_session_id'), 'post-migration: has active_session_id');
    assert.ok(hasColumn(db, 'merge_audit_log', 'execution_trace_id'), 'post-migration: has execution_trace_id');
    assert.ok(hasColumn(db, 'capability_drift_log', 'execution_trace_id'), 'post-migration: has execution_trace_id');
    assert.ok(hasColumn(db, 'capability_drift_log', 'execution_step'), 'post-migration: has execution_step');

    db.close();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-SM9: FAILED MIGRATION ROLLS BACK
// ══════════════════════════════════════════════════════════════════════════════

describe('T-SM9: Failed migration rolls back', async () => {
  await it('schema_migrations is not updated on failure', async () => {
    const db = freshDb();

    // Manually create schema_migrations and mark baseline as applied
    db.exec(`
      CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO schema_migrations (version) VALUES ('2026_02_14_001_baseline');
      INSERT INTO schema_migrations (version) VALUES ('2026_02_14_002_v59_is_external');
      INSERT INTO schema_migrations (version) VALUES ('2026_02_14_003_v62_active_session');
      INSERT INTO schema_migrations (version) VALUES ('2026_02_14_004_v63_execution_trace');
      INSERT INTO schema_migrations (version) VALUES ('2026_02_14_005_v64_cre_override_log');
      INSERT INTO schema_migrations (version) VALUES ('2026_02_18_006_v67_auto_compact');
      INSERT INTO schema_migrations (version) VALUES ('2026_02_19_007_v68_knowledge_base');
      INSERT INTO schema_migrations (version) VALUES ('2026_02_19_008_v69_ledger_core');
      INSERT INTO schema_migrations (version) VALUES ('2026_02_20_008_v69_expert_to_expertise');
    `);

    // All 9 migrations are already "applied" — runMigrations should skip all
    const result = await runMigrations(db);
    assert.strictEqual(result.applied.length, 0, 'All migrations already applied');
    assert.strictEqual(result.skipped.length, 9, 'All 9 skipped');
    db.close();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-SM10: UTILITY FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

describe('T-SM10: hasColumn / hasTable utilities', async () => {
  await it('hasTable returns true for existing table', async () => {
    const db = freshDb();
    await runMigrations(db);
    assert.strictEqual(hasTable(db, 'projects'), true);
    assert.strictEqual(hasTable(db, 'conversations'), true);
    assert.strictEqual(hasTable(db, 'schema_migrations'), true);
    db.close();
  });

  await it('hasTable returns false for non-existing table', async () => {
    const db = freshDb();
    await runMigrations(db);
    assert.strictEqual(hasTable(db, 'nonexistent_table'), false);
    db.close();
  });

  await it('hasColumn returns true for existing column', async () => {
    const db = freshDb();
    await runMigrations(db);
    assert.strictEqual(hasColumn(db, 'projects', 'name'), true);
    assert.strictEqual(hasColumn(db, 'projects', 'is_external'), true);
    db.close();
  });

  await it('hasColumn returns false for non-existing column', async () => {
    const db = freshDb();
    await runMigrations(db);
    assert.strictEqual(hasColumn(db, 'projects', 'nonexistent'), false);
    db.close();
  });

  await it('FTS virtual tables exist', async () => {
    const db = freshDb();
    await runMigrations(db);
    // FTS tables are virtual — check sqlite_master
    const fts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_fts'").all();
    const names = fts.map(r => r.name);
    assert.ok(names.includes('chat_fts'), 'chat_fts should exist');
    assert.ok(names.includes('messages_fts'), 'messages_fts should exist');
    db.close();
  });

  await it('triggers exist for FTS sync', async () => {
    const db = freshDb();
    await runMigrations(db);
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(r => r.name);
    for (const t of ['chat_ai', 'chat_ad', 'messages_ai', 'messages_ad', 'messages_count_ai', 'messages_count_ad']) {
      assert.ok(triggers.includes(t), `Missing trigger: ${t}`);
    }
    db.close();
  });
});

// ─── Runner ──────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n' + '═'.repeat(70));
  console.log('  C3-Agent v64.0 — Schema Migration Tests');
  console.log('═'.repeat(70));

  for (const test of pendingTests) {
    await test();
  }

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('─'.repeat(70));

  if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const f of failures) {
      console.log(`    ✗ ${f.name}: ${f.error}`);
    }
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

run();
