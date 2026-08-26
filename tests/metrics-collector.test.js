// Raw runtime model telemetry recorder tests.
// Operational events are not model evaluation or recommendation evidence.

import { suite, testAsync, assert, assertEqual, summary } from './harness.js';
import Database from 'better-sqlite3';
import { MetricsCollector } from '../src/upgrade/metrics-collector.js';

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE model_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      model TEXT NOT NULL,
      task_type TEXT NOT NULL,
      success INTEGER NOT NULL,
      iterations INTEGER DEFAULT 1,
      tokens INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      errors_fixed INTEGER DEFAULT 0,
      errors_remaining INTEGER DEFAULT 0,
      stop_reason TEXT,
      lifecycle_id TEXT,
      milestone_id TEXT,
      detail_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  return db;
}

function event(overrides = {}) {
  return {
    role: 'CODE',
    model: 'test-model:7b',
    taskType: 'patch',
    success: 1,
    iterations: 3,
    tokens: 2000,
    durationMs: 5000,
    errorsFixed: 2,
    errorsRemaining: 0,
    stopReason: 'success',
    lifecycleId: 'lc-1',
    milestoneId: 'ms-1',
    detail: { source: 'test' },
    ...overrides,
  };
}

suite('Metrics Collector — raw recording only');

await testAsync('flush persists the complete raw event', async () => {
  const db = createTestDb();
  const collector = new MetricsCollector();
  collector.setDb(db);
  collector.recordEvent(event());
  collector.flush();

  const row = db.prepare('SELECT * FROM model_performance').get();
  assertEqual(row.role, 'CODE');
  assertEqual(row.model, 'test-model:7b');
  assertEqual(row.success, 1);
  assertEqual(JSON.parse(row.detail_json).source, 'test');
});

await testAsync('ten buffered events trigger a transaction flush', async () => {
  const db = createTestDb();
  const collector = new MetricsCollector();
  collector.setDb(db);
  for (let index = 0; index < 10; index++) collector.recordEvent(event({ tokens: index }));
  assertEqual(db.prepare('SELECT COUNT(*) AS count FROM model_performance').get().count, 10);
});

await testAsync('recording without a database is a no-op', async () => {
  const collector = new MetricsCollector();
  collector.recordEvent(event());
  collector.flush();
  assertEqual(collector._buffer.length, 0);
});

await testAsync('database failures never escape telemetry', async () => {
  const collector = new MetricsCollector();
  collector._db = { prepare: () => { throw new Error('DB error'); } };
  collector.recordEvent(event());
  collector.flush();
  assertEqual(collector._consecutiveFailures, 1);
  assertEqual(collector._buffer.length, 1);
});

await testAsync('five consecutive failures temporarily disable recording', async () => {
  const collector = new MetricsCollector();
  collector._db = { prepare: () => { throw new Error('DB error'); } };
  for (let index = 0; index < 5; index++) {
    collector._buffer = [event()];
    collector.flush();
  }
  assert(collector._disabledUntil > Date.now(), 'failure circuit must be open');
  collector._buffer = [];
  collector.recordEvent(event());
  assertEqual(collector._buffer.length, 0);
});

await testAsync('twenty rapid events are not lost across automatic flushes', async () => {
  const db = createTestDb();
  const collector = new MetricsCollector();
  collector.setDb(db);
  for (let index = 0; index < 20; index++) collector.recordEvent(event({ tokens: index }));
  collector.flush();
  assertEqual(db.prepare('SELECT COUNT(*) AS count FROM model_performance').get().count, 20);
});

const results = summary();
if (results.failed > 0) process.exit(1);
