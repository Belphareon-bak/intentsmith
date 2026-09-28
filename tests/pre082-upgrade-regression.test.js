import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import Database from 'better-sqlite3';

import { suite, testAsync, assert, assertEqual, summary } from './harness.js';
import { runMigrations } from '../src/db/migrate.js';

const FIXTURE_URL = new URL('./fixtures/pre082-schema-8a2c98e2.sql', import.meta.url);
const FIXTURE_SHA256 = '0868564a855baf315abe20a4f61ac9d9818fa80d6c263043d355aabc14e31e3f';

suite('Sanitized real pre-082 upgrade regression');

await testAsync('migration runner repairs historical triggers and removes obsolete authorities', async () => {
  const sql = readFileSync(FIXTURE_URL, 'utf8');
  assertEqual(createHash('sha256').update(sql).digest('hex'), FIXTURE_SHA256);

  const db = new Database(':memory:');
  db.exec(sql);
  db.pragma('foreign_keys = ON');

  assertEqual(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 62);
  assertEqual(db.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'trigger' AND name IN (
      'trg_model_automation_policy_events_sequence',
      'trg_model_failover_proofs_require_artifacts'
    )
  `).get().count, 2);
  assertEqual(db.prepare('SELECT COUNT(*) AS count FROM conversations').get().count, 0);
  assertEqual(db.prepare('SELECT COUNT(*) AS count FROM validation_suite_scores').get().count, 0);

  const result = await runMigrations(db);
  assert(result.applied.includes('2026_08_24_076_m2_tool_authority_truth'));
  assert(result.applied.includes('2026_08_24_081_model_policy_trigger_compatibility'));
  assert(result.applied.includes('2026_08_27_097_model_evaluation_role_identity'));
  assert(result.applied.includes('2026_08_27_099_remove_model_runtime_guard'));
  assertEqual(db.pragma('quick_check', { simple: true }), 'ok');
  assertEqual(db.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'table' AND name IN (
      'validation_results', 'validation_suite_scores', 'model_runtime_guard'
    )
  `).get().count, 0);
  assertEqual(db.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'trigger' AND name IN (
      'trg_model_automation_policy_events_sequence',
      'trg_model_failover_proofs_require_artifacts'
    )
  `).get().count, 0);
  assertEqual(db.prepare(
    'SELECT COUNT(*) AS count FROM model_evaluation_decision_quarantine'
  ).get().count, 0);

  const second = await runMigrations(db);
  assertEqual(second.applied.length, 0);
  db.close();
});

summary();
