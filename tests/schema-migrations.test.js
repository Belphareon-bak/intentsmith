// C3-Agent v135.0 — Schema Migration Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// T-SM0:  Migration identity manifest fails before the first DB mutation
// T-SM1:  Fresh DB — all migrations applied
// T-SM2:  Idempotent — running twice changes nothing
// T-SM3:  schema_migrations table tracks all versions
// T-SM4:  getCurrentVersion returns latest
// T-SM5:  listMigrations shows applied status
// T-SM6:  Migration ordering (lexicographic = chronological)
// T-SM7:  Baseline creates all expected tables
// T-SM8:  ALTER TABLE migrations are idempotent (column check)
// T-SM9:  Pre-seeded DB — all migrations skipped
// T-SM10: hasColumn / hasTable utilities
//
// Spuštění: node tests/schema-migrations.test.js
//
// ══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

import {
  runMigrations,
  getCurrentVersion,
  listMigrations,
  hasColumn,
  hasTable,
  _testInternals as migrationTestInternals,
} from '../src/db/migrate.js';

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

function assertManifestRejectedBeforeMutation(plan, expectedError, getUpCalls) {
  const db = freshDb();

  assert.throws(
    () => migrationTestInternals.runMigrationPlan(db, plan),
    expectedError
  );
  assert.strictEqual(
    hasTable(db, 'schema_migrations'),
    false,
    'schema_migrations must not exist after manifest rejection'
  );
  assert.deepStrictEqual(
    getTableNames(db),
    [],
    'invalid manifest must not create any user table'
  );
  assert.strictEqual(getUpCalls(), 0, 'no migration up() may run');
  db.close();
}

// All migration versions in order (as exported by each migration file, not filenames)
const ALL_MIGRATIONS = [
  '2026_02_14_001_baseline',
  '2026_02_14_002_v59_is_external',
  '2026_02_14_003_v62_active_session',
  '2026_02_14_004_v63_execution_trace',
  '2026_02_14_005_v64_cre_override_log',
  '2026_02_18_006',
  '2026_02_19_007',
  '2026_02_19_008',
  '2026_02_20_008',
  '2026_02_20_009',
  '2026_02_22_010',
  '2026_02_22_011',
  '2026_02_22_012',
  '2026_02_24_013',
  '2026_02_24_014',
  '2026_02_24_015',
  '2026_02_24_016',
  '2026_02_24_017',
  '2026_02_25_018',
  '2026_02_26_019',
  '2026_02_26_020',
  '2026_02_27_021',
  '2026_02_27_022',
  '2026_02_28_023',
  '2026_03_01_024',
  '2026_03_01_025',
  '2026_03_02_026',
  '2026_03_03_027_v91_feedback',
  '2026_03_03_028_v91_feedback_attachments',
  '2026_03_05_029_v98_architecture_governance',
  '2026_03_08_030_v103_model_overrides',
  '2026_03_08_030_v107_task_memory',
  '2026_03_10_031_v118_upgrade_proposals',
  '2026_03_11_032_v120_model_performance',
  '2026_03_11_033_v121_discovered_models',
  '2026_03_12_034_v123_validation_results',
  '2026_03_12_035_v124_marketplace',
  '2026_03_12_036_v125_model_verified',
  '2026_03_22_037_v130_media_generations',
  '2026_03_25_038_v132_benchmark_source',
  '2026_03_26_039_v133_model_usage',
  '2026_03_27_040_v135_governor',
  '2026_04_08_041_v136_model_universe',
  '2026_04_08_042_v137_universe_reconciliation',
  '2026_04_12_043_drafts_table',
  '2026_04_12_044_v138_runtime_guard',
  '2026_07_30_045_telemetry_aggregation_version',
  '2026_08_08_046_model_failover',
  '2026_08_08_047_model_failover_claim_expiry',
  '2026_08_08_048_model_binding_operations',
  '2026_08_08_049_model_binding_manual_supersede',
  '2026_08_09_050_model_binding_application_attempts',
  '2026_08_09_051_model_binding_runtime_generation',
  '2026_08_09_052_model_binding_provider_effects',
  '2026_08_09_053_model_binding_append_only_identity',
  '2026_08_09_054_model_binding_runtime_finalization',
  '2026_08_22_066_model_automation_policy',
  '2026_08_22_067_model_failover_proof_artifacts',
  '2026_08_22_069_model_failover_runtime_finalization',
  '2026_08_23_070_m2_effect_authority',
  '2026_08_24_071_m2_effect_authority_hardening',
  '2026_08_24_072_m2_effect_execution_claims',
  '2026_08_24_073_m2_effect_claim_truth',
];

const MIGRATION_COUNT = ALL_MIGRATIONS.length;
const LAST_MIGRATION = ALL_MIGRATIONS[ALL_MIGRATIONS.length - 1];
const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/db/migrations'
);

// Expected tables after all migrations
// NOTE: experts, expert_memory, conversation_experts, custom_experts are DROPPED by migration 014
const EXPECTED_TABLES = [
  'agents', 'agent_logs', 'api_contracts', 'api_tokens', 'architecture_state', 'attachments',
  'auto_expertise_log',
  'calculation_runs', 'capability_drift_log', 'change_requests', 'chat_fts', 'chat_messages', 'chat_sessions',
  'compliance_checks', 'conversation_expertises', 'conversations', 'cre_override_log', 'custom_expertises',
  'discovered_models', 'drafts', 'drift_checks',
  'entity_profiles', 'entry_history', 'expertise_bindings', 'expertise_memory', 'expertises',
  'feedback', 'feedback_attachments', 'financial_entries',
  'global_memory', 'governor_proposals', 'governor_reports',
  'knowledge_facts', 'knowledge_sources', 'knowledge_verification_log',
  'learned_patterns', 'lifecycle_handoff_state', 'llm_execution_log', 'logs',
  'marketplace_catalog_cache', 'marketplace_packages', 'media_generations',
  'memory', 'merge_audit_log', 'messages', 'messages_fts', 'milestones',
  'm2_approval_grants', 'm2_effect_authority_events', 'm2_effect_execution_claims',
  'm2_effect_requests', 'm2_effect_results', 'm2_pending_effect_payloads',
  'model_binding_application_attempts', 'model_binding_operations', 'model_binding_runtime_finalize_cutoffs', 'model_binding_runtime_finalize_receipts', 'model_catalog_cache', 'model_desired_bindings', 'model_failover_events', 'model_failover_proofs',
  'model_failover_health_events', 'model_failover_runtime_finalize_receipts', 'model_failover_state', 'model_overrides', 'model_performance', 'model_reconciliation_log',
  'model_runtime_guard',
  'model_signal_events', 'model_universe_derived', 'model_universe_raw',
  'model_usage', 'model_write_log',
  'period_locks', 'project_lifecycles', 'project_memory', 'projects',
  'quality_scores',
  'registry_delta', 'roadmap_versions',
  'schema_migrations', 'skill_executions', 'skill_steps', 'specialist_expertises',
  'specialist_memory', 'specialist_migrations', 'specialist_telemetry', 'specialists',
  'task_memory', 'tax_losses', 'telemetry_alerts', 'telemetry_improvements', 'telemetry_metrics',
  'telemetry_snapshots',
  'upgrade_history', 'upgrade_proposals', 'user_memory', 'user_settings',
  'validation_results', 'validation_suite_scores', 'vat_periods',
  'workflow_patterns', 'workflow_sessions',
];

// ══════════════════════════════════════════════════════════════════════════════
// T-SM0: MIGRATION IDENTITY PREFLIGHT — NO DB MUTATION ON INVALID MANIFEST
// ══════════════════════════════════════════════════════════════════════════════

describe('T-SM0: Migration identity preflight', async () => {
  await it('matches physical files, manual oracle, and discovered unique versions', async () => {
    const physicalFiles = fs.readdirSync(MIGRATIONS_DIR)
      .filter(file => file.endsWith('.js'))
      .sort();
    const discovered = await migrationTestInternals.discoverMigrations();
    migrationTestInternals.validateMigrationPlan(discovered);
    const discoveredVersions = discovered.map(migration => migration.version);

    assert.strictEqual(physicalFiles.length, ALL_MIGRATIONS.length);
    assert.strictEqual(new Set(ALL_MIGRATIONS).size, ALL_MIGRATIONS.length);
    assert.strictEqual(discovered.length, physicalFiles.length);
    assert.strictEqual(new Set(discoveredVersions).size, discovered.length);
    assert.deepStrictEqual(discoveredVersions, ALL_MIGRATIONS);
  });

  await it('rejects duplicate versions before schema_migrations or up()', () => {
    let upCalls = 0;
    const up = () => { upCalls++; };
    const version = '2026_08_08_900_duplicate';
    const plan = [
      { version, file: `${version}.js`, description: 'first', up },
      { version, file: `${version}_second.js`, description: 'second', up },
    ];

    assertManifestRejectedBeforeMutation(
      plan,
      /Duplicate migration version/,
      () => upCalls
    );
  });

  await it('rejects invalid version format before schema_migrations or up()', () => {
    let upCalls = 0;
    const plan = [{
      version: '008',
      file: '008.js',
      description: 'invalid format',
      up: () => { upCalls++; },
    }];

    assertManifestRejectedBeforeMutation(
      plan,
      /invalid version export/,
      () => upCalls
    );
  });

  await it('rejects basename/version mismatch before schema_migrations or up()', () => {
    let upCalls = 0;
    const plan = [{
      version: '2026_08_08_901_expected',
      file: '2026_08_08_902_other.js',
      description: 'mismatch',
      up: () => { upCalls++; },
    }];

    assertManifestRejectedBeforeMutation(
      plan,
      /does not match exported version/,
      () => upCalls
    );
  });

  await it('rejects non-delimited prefix collisions before schema_migrations or up()', () => {
    let upCalls = 0;
    const plan = [{
      version: '2026_08_08_008',
      file: '2026_08_08_0080_bad.js',
      description: 'prefix collision',
      up: () => { upCalls++; },
    }];

    assertManifestRejectedBeforeMutation(
      plan,
      /does not match exported version/,
      () => upCalls
    );
  });

  await it('rejects a missing version export before schema_migrations or up()', () => {
    let upCalls = 0;
    const plan = [{
      version: undefined,
      file: '2026_08_08_903_missing_version.js',
      description: 'missing version',
      up: () => { upCalls++; },
    }];

    assertManifestRejectedBeforeMutation(
      plan,
      /invalid version export/,
      () => upCalls
    );
  });

  await it('rejects a missing up export before schema_migrations', () => {
    let upCalls = 0;
    const version = '2026_08_08_904_missing_up';
    const plan = [{
      version,
      file: `${version}.js`,
      description: 'missing up',
      up: undefined,
    }];

    assertManifestRejectedBeforeMutation(
      plan,
      /missing an up\(\) export/,
      () => upCalls
    );
  });

  await it('rejects a missing file name before schema_migrations or up()', () => {
    let upCalls = 0;
    const plan = [{
      version: '2026_08_08_905_missing_file',
      file: undefined,
      description: 'missing file',
      up: () => { upCalls++; },
    }];

    assertManifestRejectedBeforeMutation(
      plan,
      /invalid file name/,
      () => upCalls
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-SM1: FRESH DB — ALL MIGRATIONS APPLIED
// ══════════════════════════════════════════════════════════════════════════════

describe('T-SM1: Fresh DB — all migrations applied', async () => {
  await it(`applies all ${MIGRATION_COUNT} migrations on empty DB`, async () => {
    const db = freshDb();
    const result = await runMigrations(db);
    assert.strictEqual(result.applied.length, MIGRATION_COUNT,
      `Expected ${MIGRATION_COUNT} applied, got ${result.applied.length}`);
    assert.strictEqual(result.skipped.length, 0, 'No skipped on fresh DB');
    db.close();
  });

  await it('migration versions are in correct order', async () => {
    const db = freshDb();
    const result = await runMigrations(db);
    assert.deepStrictEqual(result.applied, ALL_MIGRATIONS);
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
    assert.strictEqual(result2.skipped.length, MIGRATION_COUNT,
      `All ${MIGRATION_COUNT} skipped`);
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
    assert.strictEqual(rows.length, MIGRATION_COUNT);
    assert.strictEqual(rows[0].version, '2026_02_14_001_baseline');
    assert.strictEqual(rows[8].version, '2026_02_20_008');
    assert.strictEqual(rows[MIGRATION_COUNT - 1].version, LAST_MIGRATION);
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
    assert.strictEqual(ver, LAST_MIGRATION);
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
    assert.strictEqual(list.length, MIGRATION_COUNT);
    assert.ok(list.every(m => m.applied === false), 'All should be pending');
    db.close();
  });

  await it('shows all as applied after runMigrations', async () => {
    const db = freshDb();
    await runMigrations(db);
    const list = await listMigrations(db);
    assert.strictEqual(list.length, MIGRATION_COUNT);
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

  await it('manual binding application schema starts unverified and keeps exact provenance', async () => {
    const db = freshDb();
    await runMigrations(db);
    const columns = db.prepare("PRAGMA table_info('model_overrides')").all();
    const byName = Object.fromEntries(columns.map(column => [column.name, column]));
    assert.strictEqual(byName.verified.notnull, 1);
    assert.strictEqual(String(byName.verified.dflt_value), '0');
    assert.strictEqual(String(byName.verification_status.dflt_value), "'LEGACY_UNVERIFIED'");
    for (const name of [
      'binding_operation_id',
      'model_canonical_name',
      'model_digest_sha256',
      'verification_status',
    ]) {
      assert.ok(byName[name], `Missing model_overrides.${name}`);
    }
    const attemptColumns = getColumnNames(db, 'model_binding_application_attempts');
    assert.deepStrictEqual(attemptColumns, [
      'seq',
      'operation_id',
      'attempt_revision',
      'attempt_kind',
      'outcome',
      'observed_model_name',
      'observed_canonical_name',
      'observed_digest_sha256',
      'verification_method',
      'failure_code',
      'retryable',
      'created_at_ms',
      'runtime_changed',
    ]);
    assert.deepStrictEqual(getColumnNames(db, 'model_binding_runtime_finalize_receipts'), [
      'seq',
      'operation_id',
      'runtime_attempt_revision',
      'finalization_kind',
      'config_version',
      'recovered_by_attempt_revision',
      'created_at_ms',
    ]);
    assert.deepStrictEqual(getColumnNames(db, 'model_binding_runtime_finalize_cutoffs'), [
      'operation_id',
      'max_preexisting_runtime_attempt_revision',
    ]);
    db.close();
  });

  await it('migration 050 demotes every legacy override instead of inventing verification', async () => {
    const db = freshDb();
    const migrations = await migrationTestInternals.discoverMigrations();
    const pre050 = migrations.filter(migration => ![
      '2026_08_09_050_model_binding_application_attempts',
      '2026_08_09_051_model_binding_runtime_generation',
      '2026_08_09_052_model_binding_provider_effects',
      '2026_08_09_053_model_binding_append_only_identity',
      '2026_08_09_054_model_binding_runtime_finalization',
      '2026_08_22_066_model_automation_policy',
      '2026_08_22_067_model_failover_proof_artifacts',
      '2026_08_22_069_model_failover_runtime_finalization',
    ].includes(migration.version));
    migrationTestInternals.runMigrationPlan(db, pre050);
    db.prepare(`
      INSERT INTO model_overrides (
        role, model, previous_model, score, applied_by, verified
      ) VALUES ('CHAT', 'legacy-model', 'legacy-previous', 0.9, 'user', 1)
    `).run();

    migrationTestInternals.runMigrationPlan(db, migrations);
    const migrated = db.prepare(`
      SELECT * FROM model_overrides WHERE role = 'CHAT'
    `).get();
    assert.strictEqual(migrated.model, 'legacy-model');
    assert.strictEqual(migrated.previous_model, 'legacy-previous');
    assert.strictEqual(migrated.verified, 0);
    assert.strictEqual(migrated.verification_status, 'LEGACY_UNVERIFIED');
    assert.strictEqual(migrated.binding_operation_id, null);
    assert.strictEqual(migrated.model_canonical_name, null);
    assert.strictEqual(migrated.model_digest_sha256, null);
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

  await it('v70+ tables exist (period_locks, vat_periods, specialists, memory)', async () => {
    const db = freshDb();
    await runMigrations(db);
    for (const t of ['period_locks', 'vat_periods', 'specialists', 'memory', 'feedback', 'task_memory', 'discovered_models', 'drafts']) {
      assert.ok(hasTable(db, t), `Missing table: ${t}`);
    }
    db.close();
  });

  await it('old expert tables are dropped by migration 014', async () => {
    const db = freshDb();
    await runMigrations(db);
    const tables = getTableNames(db);
    for (const t of ['experts', 'expert_memory', 'conversation_experts', 'custom_experts']) {
      assert.ok(!tables.includes(t), `Table should be dropped: ${t}`);
    }
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
// T-SM9: PRE-SEEDED DB — ALL MIGRATIONS SKIPPED
// ══════════════════════════════════════════════════════════════════════════════

describe('T-SM9: Pre-seeded DB — all migrations skipped', async () => {
  await it('schema_migrations pre-seeded with all versions → runMigrations skips all', async () => {
    const db = freshDb();

    // Manually create schema_migrations and mark ALL migrations as applied
    db.exec(`CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    const insert = db.prepare(`INSERT INTO schema_migrations (version) VALUES (?)`);
    for (const version of ALL_MIGRATIONS) {
      insert.run(version);
    }

    // All migrations are already "applied" — runMigrations should skip all
    const result = await runMigrations(db);
    assert.strictEqual(result.applied.length, 0, 'All migrations already applied');
    assert.strictEqual(result.skipped.length, MIGRATION_COUNT,
      `All ${MIGRATION_COUNT} skipped`);
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
  console.log(`  C3-Agent v135.0 — Schema Migration Tests (${MIGRATION_COUNT} migrations)`);
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
