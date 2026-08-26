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
import { up as up066ModelPolicy } from '../src/db/migrations/2026_08_22_066_model_automation_policy.js';
import { up as repairModelPolicyTriggers } from '../src/db/migrations/2026_08_24_081_model_policy_trigger_compatibility.js';
import { up as repairModelProofTriggers } from '../src/db/migrations/2026_08_24_081_model_proof_trigger_compatibility.js';

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
  '2026_08_22_070_model_evaluation_history',
  '2026_08_24_081_model_policy_trigger_compatibility',
  '2026_08_24_081_model_proof_trigger_compatibility',
  '2026_08_24_082_model_evaluation_consolidation',
  '2026_08_26_096_model_evaluation_import_audit',
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
  'model_binding_application_attempts', 'model_binding_operations', 'model_binding_runtime_finalize_cutoffs', 'model_binding_runtime_finalize_receipts', 'model_catalog_cache', 'model_desired_bindings', 'model_failover_events', 'model_failover_proofs',
  'model_failover_state', 'model_overrides', 'model_performance', 'model_reconciliation_log',
  'model_evaluation_decisions', 'model_evaluation_import_audits', 'model_evaluation_import_evidence', 'model_evaluation_runs',
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
  'upgrade_history', 'user_memory', 'user_settings',
  'vat_periods',
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

  await it('rejects reused numeric slots with different version strings before mutation', () => {
    let upCalls = 0;
    const up = () => { upCalls++; };
    const plan = [
      {
        version: '2026_08_24_081_first_owner',
        file: '2026_08_24_081_first_owner.js',
        description: 'first',
        up,
      },
      {
        version: '2026_08_25_081_second_owner',
        file: '2026_08_25_081_second_owner.js',
        description: 'second',
        up,
      },
    ];

    assertManifestRejectedBeforeMutation(
      plan,
      /Duplicate migration numeric slot 081/,
      () => upCalls
    );
  });

  await it('accepts only the three exact grandfathered numeric-slot sets', () => {
    const up = () => {};
    assert.doesNotThrow(() => migrationTestInternals.validateMigrationPlan([
      {
        version: '2026_02_19_008',
        file: '2026_02_19_008_v69_ledger_core.js',
        description: 'historical first',
        up,
      },
      {
        version: '2026_02_20_008',
        file: '2026_02_20_008_v69_expert_to_expertise.js',
        description: 'historical second',
        up,
      },
    ]));
    assert.throws(() => migrationTestInternals.validateMigrationPlan([
      {
        version: '2026_02_19_008',
        file: '2026_02_19_008_v69_ledger_core.js',
        description: 'historical first',
        up,
      },
      {
        version: '2026_08_26_008_new_reuse',
        file: '2026_08_26_008_new_reuse.js',
        description: 'not grandfathered',
        up,
      },
    ]), /Duplicate migration numeric slot 008/);
    assert.doesNotThrow(() => migrationTestInternals.validateMigrationPlan([
      {
        version: '2026_08_24_081_model_policy_trigger_compatibility',
        file: '2026_08_24_081_model_policy_trigger_compatibility.js',
        description: 'immutable model policy repair',
        up,
      },
      {
        version: '2026_08_24_081_model_proof_trigger_compatibility',
        file: '2026_08_24_081_model_proof_trigger_compatibility.js',
        description: 'immutable model proof repair',
        up,
      },
    ]));
  });

  await it('adopts the retired 084-086 identities atomically and preserves timestamps', async () => {
    const db = freshDb();
    await runMigrations(db);
    const replacements = [
      ['2026_08_24_081_model_policy_trigger_compatibility', '2026_08_26_084_model_policy_trigger_compatibility', '2026-08-25 20:14:48'],
      ['2026_08_24_081_model_proof_trigger_compatibility', '2026_08_26_085_model_proof_trigger_compatibility', '2026-08-25 20:17:55'],
      ['2026_08_24_082_model_evaluation_consolidation', '2026_08_26_086_model_evaluation_consolidation', '2026-08-25 20:17:55'],
    ];
    for (const [canonical, retired, appliedAt] of replacements) {
      db.prepare(`
        UPDATE schema_migrations SET version = ?, applied_at = ? WHERE version = ?
      `).run(retired, appliedAt, canonical);
    }

    const result = await runMigrations(db);
    assert.strictEqual(result.applied.length, 0);
    assert.strictEqual(result.skipped.length, MIGRATION_COUNT);
    for (const [canonical, retired, appliedAt] of replacements) {
      assert.deepStrictEqual(
        db.prepare('SELECT applied_at FROM schema_migrations WHERE version = ?').get(canonical),
        { applied_at: appliedAt }
      );
      assert.strictEqual(
        db.prepare('SELECT 1 AS ok FROM schema_migrations WHERE version = ?').get(retired),
        undefined
      );
    }
    assert.strictEqual(hasTable(db, 'validation_results'), false);
    assert.strictEqual(hasTable(db, 'validation_suite_scores'), false);
    db.close();
  });

  await it('removes redundant retired stamps from a 96c762db-style history without rerunning 082', async () => {
    const db = freshDb();
    await runMigrations(db);
    const canonicalTimestamp = db.prepare(`
      SELECT applied_at FROM schema_migrations
      WHERE version = '2026_08_24_082_model_evaluation_consolidation'
    `).get().applied_at;
    db.prepare(`
      INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)
    `).run('2026_08_26_084_model_policy_trigger_compatibility', '2026-08-26 10:00:00');
    db.prepare(`
      INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)
    `).run('2026_08_26_085_model_proof_trigger_compatibility', '2026-08-26 10:01:00');

    const result = await runMigrations(db);
    assert.strictEqual(result.applied.length, 0);
    assert.strictEqual(result.skipped.length, MIGRATION_COUNT);
    assert.strictEqual(db.prepare(`
      SELECT applied_at FROM schema_migrations
      WHERE version = '2026_08_24_082_model_evaluation_consolidation'
    `).get().applied_at, canonicalTimestamp);
    assert.strictEqual(db.prepare(`
      SELECT COUNT(*) AS count FROM schema_migrations
      WHERE version IN (
        '2026_08_26_084_model_policy_trigger_compatibility',
        '2026_08_26_085_model_proof_trigger_compatibility'
      )
    `).get().count, 0);
    assert.strictEqual(hasTable(db, 'validation_results'), false);
    db.close();
  });

  await it('rolls back every identity adoption when a canonical target is absent', () => {
    const db = freshDb();
    db.exec(`
      CREATE TABLE schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO schema_migrations(version, applied_at) VALUES
        ('2026_08_26_084_model_policy_trigger_compatibility', '2026-08-26 10:00:00'),
        ('2026_08_26_085_model_proof_trigger_compatibility', '2026-08-26 10:01:00');
    `);
    const plan = [{
      version: '2026_08_24_081_model_policy_trigger_compatibility',
      file: '2026_08_24_081_model_policy_trigger_compatibility.js',
      description: 'only one canonical target',
      up: () => {},
    }];

    assert.throws(
      () => migrationTestInternals.runMigrationPlan(db, plan),
      /canonical identity 2026_08_24_081_model_proof_trigger_compatibility is absent/
    );
    assert.deepStrictEqual(
      db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => row.version),
      [
        '2026_08_26_084_model_policy_trigger_compatibility',
        '2026_08_26_085_model_proof_trigger_compatibility',
      ]
    );
    db.close();
  });

  await it('rejects a numeric-slot collision split across DB history and the manifest before up()', () => {
    const db = freshDb();
    let upCalls = 0;
    db.exec(`
      CREATE TABLE schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO schema_migrations(version, applied_at) VALUES
        ('2026_08_23_070_m2_effect_authority', '2026-08-25 19:02:00');
    `);
    const plan = [{
      version: '2026_08_22_070_model_evaluation_history',
      file: '2026_08_22_070_model_evaluation_history.js',
      description: 'model evaluation history',
      up: () => { upCalls++; },
    }];
    assert.throws(
      () => migrationTestInternals.runMigrationPlan(db, plan),
      /Duplicate migration numeric slot 070 in migration manifest \+ schema_migrations/
    );
    assert.strictEqual(upCalls, 0);
    assert.deepStrictEqual(
      db.prepare('SELECT version, applied_at FROM schema_migrations').all(),
      [{
        version: '2026_08_23_070_m2_effect_authority',
        applied_at: '2026-08-25 19:02:00',
      }],
    );
    db.close();
  });

  await it('leaves retired stamps unchanged when their hypothetical adoption would collide', () => {
    const db = freshDb();
    db.exec(`
      CREATE TABLE schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO schema_migrations(version, applied_at) VALUES
        ('2026_08_24_081_m2_effect_result_semantic_authority_v2', '2026-08-25 18:00:00'),
        ('2026_08_26_084_model_policy_trigger_compatibility', '2026-08-25 20:14:48');
    `);
    const plan = [{
      version: '2026_08_24_081_model_policy_trigger_compatibility',
      file: '2026_08_24_081_model_policy_trigger_compatibility.js',
      description: 'model policy repair',
      up: () => {},
    }];

    assert.throws(
      () => migrationTestInternals.runMigrationPlan(db, plan),
      /Duplicate migration numeric slot 081 in migration manifest \+ schema_migrations/
    );
    assert.deepStrictEqual(
      db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all(),
      [
        {
          version: '2026_08_24_081_m2_effect_result_semantic_authority_v2',
          applied_at: '2026-08-25 18:00:00',
        },
        {
          version: '2026_08_26_084_model_policy_trigger_compatibility',
          applied_at: '2026-08-25 20:14:48',
        },
      ],
    );
    db.close();
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
      '2026_08_24_081_model_policy_trigger_compatibility',
      '2026_08_24_081_model_proof_trigger_compatibility',
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

// ══════════════════════════════════════════════════════════════════════════════
// T-SM11: NARROW COMPATIBILITY REPAIR FOR HISTORICAL 066/067 COLLISIONS
// ══════════════════════════════════════════════════════════════════════════════

const POLICY_LEGACY_TRIGGERS = [
  'trg_model_automation_policy_events_no_update',
  'trg_model_automation_policy_events_no_delete',
  'trg_model_automation_policy_events_sequence',
  'trg_model_automation_policy_projection_event',
  'trg_model_automation_policy_projection_event_update',
];

const POLICY_M1_TRIGGERS = [
  'trg_model_automation_event_identity_conflict',
  'trg_model_automation_event_revision',
  'trg_model_automation_event_lineage',
  'trg_model_automation_event_projection',
  'trg_model_automation_event_append_only_update',
  'trg_model_automation_event_append_only_delete',
  'trg_model_automation_projection_replace',
  'trg_model_automation_projection_revision',
  'trg_model_automation_projection_new_event',
  'trg_model_automation_projection_current_event',
  'trg_model_automation_projection_append_only_delete',
];

const PROOF_COLUMNS = [
  'proof_id', 'validation_run_id', 'role', 'suite', 'role_contract_sha256',
  'model_name', 'model_canonical_name', 'model_digest_sha256',
  'validation_version', 'policy_version', 'score', 'required_score',
  'passed_count', 'required_passed_count', 'total_count', 'duration_ms',
  'result', 'inventory_before_name', 'inventory_before_digest',
  'inventory_after_name', 'inventory_after_digest', 'started_at_ms',
  'completed_at_ms', 'expires_at_ms', 'created_at_ms',
  'measurement_artifact_sha256', 'acceptance_artifact_sha256', 'source_revision',
];

const PROOF_ARTIFACT_COLUMNS = [
  'proof_id', 'validation_run_id', 'parent_run_id', 'source_revision',
  'measurement_artifact_sha256', 'measurement_artifact_byte_length',
  'acceptance_artifact_sha256', 'acceptance_artifact_byte_length', 'role',
  'suite', 'role_contract_sha256', 'model_name', 'model_canonical_name',
  'model_digest_sha256', 'validation_version', 'policy_version', 'score',
  'required_score', 'passed_count', 'required_passed_count', 'total_count',
  'duration_ms', 'result', 'inventory_before_name', 'inventory_before_digest',
  'inventory_after_name', 'inventory_after_digest', 'measurement_started_at_ms',
  'measurement_completed_at_ms', 'acceptance_completed_at_ms', 'proof_ttl_ms',
  'expires_at_ms', 'issued_at_ms',
];

const PROOF_M1_TRIGGERS = [
  'trg_model_failover_proof_artifacts_append_only_delete',
  'trg_model_failover_proof_artifacts_append_only_update',
  'trg_model_failover_proof_artifacts_historical_attach',
  'trg_model_failover_proof_artifacts_identity_conflict',
  'trg_model_failover_proofs_append_only_delete',
  'trg_model_failover_proofs_append_only_insert_conflict',
  'trg_model_failover_proofs_append_only_update',
  'trg_model_failover_proofs_artifact_companion',
  'trg_model_failover_proofs_identity_required',
  'trg_model_failover_proofs_rowid_authority',
  'trg_model_failover_proofs_rowid_positive',
];

function selectedTriggerNames(db, predicate = () => true) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
    .all().map(row => row.name).filter(predicate);
}

function installM1PolicyFixture(db) {
  db.exec(`
    CREATE TABLE model_automation_policy_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL UNIQUE, schema_version INTEGER NOT NULL,
      previous_revision INTEGER NOT NULL, committed_revision INTEGER NOT NULL UNIQUE,
      event_kind TEXT NOT NULL, actor TEXT NOT NULL, source TEXT NOT NULL,
      before_auto_failover_enabled INTEGER NOT NULL,
      before_auto_cleanup_enabled INTEGER NOT NULL,
      before_auto_cleanup_days INTEGER NOT NULL,
      after_auto_failover_enabled INTEGER NOT NULL,
      after_auto_cleanup_enabled INTEGER NOT NULL,
      after_auto_cleanup_days INTEGER NOT NULL, legacy_quarantine_json TEXT,
      created_at_ms INTEGER NOT NULL
    );
    CREATE TABLE model_automation_policy (
      id INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL,
      revision INTEGER NOT NULL, auto_failover_enabled INTEGER NOT NULL,
      auto_cleanup_enabled INTEGER NOT NULL, auto_cleanup_days INTEGER NOT NULL,
      last_event_id TEXT NOT NULL, updated_at_ms INTEGER NOT NULL
    );
    INSERT INTO model_automation_policy_events (
      event_id, request_id, schema_version, previous_revision, committed_revision,
      event_kind, actor, source, before_auto_failover_enabled,
      before_auto_cleanup_enabled, before_auto_cleanup_days,
      after_auto_failover_enabled, after_auto_cleanup_enabled,
      after_auto_cleanup_days, created_at_ms
    ) VALUES (
      'policy-event-migration-061', 'policy-request-migration-061', 1, 0, 1,
      'MIGRATION_DEFAULT_OFF', 'system:migration-061', 'MIGRATION', 0, 0, 14,
      0, 0, 14, 1
    );
    INSERT INTO model_automation_policy VALUES (
      1, 1, 1, 0, 0, 14, 'policy-event-migration-061', 1
    );
  `);
  for (const name of POLICY_M1_TRIGGERS) {
    const table = name.startsWith('trg_model_automation_event_')
      ? 'model_automation_policy_events'
      : 'model_automation_policy';
    db.exec(`CREATE TRIGGER ${name} BEFORE UPDATE ON ${table} BEGIN SELECT 1; END`);
  }
}

function createTextTable(db, name, columns) {
  db.exec(`CREATE TABLE ${name} (${columns.map(column => `${column} TEXT`).join(',')})`);
}

function installM1ProofFixture(db) {
  createTextTable(db, 'model_failover_proofs', PROOF_COLUMNS);
  createTextTable(db, 'model_failover_proof_artifacts', PROOF_ARTIFACT_COLUMNS);
  for (const name of PROOF_M1_TRIGGERS) {
    const table = name.startsWith('trg_model_failover_proof_artifacts_')
      ? 'model_failover_proof_artifacts'
      : 'model_failover_proofs';
    db.exec(`CREATE TRIGGER ${name} BEFORE UPDATE ON ${table} BEGIN SELECT 1; END`);
  }
  db.exec(`
    CREATE TRIGGER trg_model_failover_proofs_require_artifacts
    BEFORE INSERT ON model_failover_proofs
    BEGIN
      SELECT RAISE(ABORT, 'proof requires a durable measurement artifact')
      WHERE NEW.measurement_artifact_sha256 IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM model_failover_proof_artifacts artifact
          WHERE artifact.artifact_sha256 = NEW.measurement_artifact_sha256
            AND artifact.kind = 'MEASUREMENT'
        );
      SELECT RAISE(ABORT, 'proof requires a durable parent acceptance artifact')
      WHERE NEW.acceptance_artifact_sha256 IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM model_failover_proof_artifacts artifact
          WHERE artifact.artifact_sha256 = NEW.acceptance_artifact_sha256
            AND artifact.kind = 'PARENT_ACCEPTANCE'
        );
      SELECT RAISE(ABORT, 'proof requires the source revision of both artifacts')
      WHERE NEW.source_revision IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM model_failover_proof_artifacts artifact
          WHERE artifact.artifact_sha256 = NEW.measurement_artifact_sha256
            AND artifact.source_revision = NEW.source_revision
        )
        OR NOT EXISTS (
          SELECT 1 FROM model_failover_proof_artifacts artifact
          WHERE artifact.artifact_sha256 = NEW.acceptance_artifact_sha256
            AND artifact.source_revision = NEW.source_revision
        );
    END
  `);
}

describe('T-SM11: historical model trigger compatibility repairs', async () => {
  await it('leaves native legacy 066 policy storage unchanged', async () => {
    const db = freshDb();
    up066ModelPolicy(db);
    const before = selectedTriggerNames(db, name => name.startsWith('trg_model_automation_'));
    repairModelPolicyTriggers(db);
    assert.deepStrictEqual(
      selectedTriggerNames(db, name => name.startsWith('trg_model_automation_')),
      before
    );
    db.close();
  });

  await it('removes only complete 066 triggers from exact M1 policy storage', async () => {
    const db = freshDb();
    installM1PolicyFixture(db);
    up066ModelPolicy(db);
    const beforeRows = JSON.stringify(db.prepare('SELECT * FROM model_automation_policy_events').all());
    repairModelPolicyTriggers(db);
    const after = selectedTriggerNames(db);
    assert.ok(POLICY_LEGACY_TRIGGERS.every(name => !after.includes(name)));
    assert.ok(POLICY_M1_TRIGGERS.every(name => after.includes(name)));
    assert.strictEqual(
      JSON.stringify(db.prepare('SELECT * FROM model_automation_policy_events').all()),
      beforeRows
    );
    db.exec('CREATE TABLE schema_reparse_probe (id INTEGER PRIMARY KEY)');
    repairModelPolicyTriggers(db);
    db.close();
  });

  await it('fails closed on incomplete M1 policy protection', async () => {
    const db = freshDb();
    installM1PolicyFixture(db);
    up066ModelPolicy(db);
    db.exec('DROP TRIGGER trg_model_automation_event_lineage');
    assert.throws(() => repairModelPolicyTriggers(db), /trigger set is incomplete/);
    assert.ok(POLICY_LEGACY_TRIGGERS.every(name => selectedTriggerNames(db).includes(name)));
    db.close();
  });

  await it('fails closed on a partial 066 policy collision', async () => {
    const db = freshDb();
    installM1PolicyFixture(db);
    up066ModelPolicy(db);
    db.exec(`DROP TRIGGER ${POLICY_LEGACY_TRIGGERS[0]}`);
    assert.throws(() => repairModelPolicyTriggers(db), /partially present/);
    assert.ok(POLICY_LEGACY_TRIGGERS.slice(1).every(
      name => selectedTriggerNames(db).includes(name)
    ));
    db.close();
  });

  await it('leaves native 067 artifact storage unchanged', async () => {
    const db = freshDb();
    createTextTable(db, 'model_failover_proof_artifacts', [
      'artifact_sha256', 'kind', 'byte_length', 'source_revision', 'created_at_ms',
    ]);
    const before = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table'").get().sql;
    repairModelProofTriggers(db);
    assert.strictEqual(
      db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table'").get().sql,
      before
    );
    db.close();
  });

  await it('removes only the exact 067 trigger from M1 proof storage', async () => {
    const db = freshDb();
    installM1ProofFixture(db);
    const beforeColumns = db.prepare('PRAGMA table_info(model_failover_proofs)').all();
    repairModelProofTriggers(db);
    const after = selectedTriggerNames(db);
    assert.ok(!after.includes('trg_model_failover_proofs_require_artifacts'));
    assert.ok(PROOF_M1_TRIGGERS.every(name => after.includes(name)));
    assert.deepStrictEqual(db.prepare('PRAGMA table_info(model_failover_proofs)').all(), beforeColumns);
    db.exec('CREATE TABLE schema_reparse_probe (id INTEGER PRIMARY KEY)');
    repairModelProofTriggers(db);
    db.close();
  });

  await it('fails closed on incomplete M1 proof protection', async () => {
    const db = freshDb();
    installM1ProofFixture(db);
    db.exec(`DROP TRIGGER ${PROOF_M1_TRIGGERS[0]}`);
    assert.throws(() => repairModelProofTriggers(db), /trigger set is incomplete/);
    assert.ok(selectedTriggerNames(db).includes('trg_model_failover_proofs_require_artifacts'));
    db.close();
  });

  await it('fails closed on drifted 067 trigger SQL', async () => {
    const db = freshDb();
    installM1ProofFixture(db);
    db.exec('DROP TRIGGER trg_model_failover_proofs_require_artifacts');
    db.exec(`
      CREATE TRIGGER trg_model_failover_proofs_require_artifacts
      BEFORE INSERT ON model_failover_proofs BEGIN SELECT RAISE(ABORT, 'drifted'); END
    `);
    assert.throws(() => repairModelProofTriggers(db), /trigger SQL drifted/);
    assert.ok(selectedTriggerNames(db).includes('trg_model_failover_proofs_require_artifacts'));
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
