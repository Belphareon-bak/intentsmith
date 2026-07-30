// Telemetry aggregation version — migration, persistence, and baseline isolation
// ==============================================================================
//
// Uses a disposable file-backed SQLite database seeded with a pre-migration
// telemetry_metrics row. No project or user database is opened.
//
// ==============================================================================

import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-telemetry-version-'));
const dbPath = path.join(testDir, 'telemetry.sqlite');

const legacyDb = new Database(dbPath);
legacyDb.exec(`
  CREATE TABLE telemetry_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    window_start DATETIME NOT NULL,
    window_end DATETIME NOT NULL,
    total_turns INTEGER NOT NULL,
    ambiguous_count INTEGER NOT NULL,
    ask_user_count INTEGER NOT NULL,
    break_count INTEGER NOT NULL,
    override_count INTEGER NOT NULL,
    avg_confidence REAL,
    override_threshold_at_time REAL,
    rule_distribution TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  INSERT INTO telemetry_metrics (
    window_start, window_end, total_turns, ambiguous_count,
    ask_user_count, break_count, override_count, avg_confidence,
    override_threshold_at_time, rule_distribution, created_at
  ) VALUES (
    '2026-07-29T00:00:00.000Z', '2026-07-29T00:15:00.000Z',
    100, 12, 80, 70, 4, 0.61, 0.85, '{"legacy":100}',
    '2026-07-29T00:16:00.000Z'
  );
`);
legacyDb.close();

process.env.C3_DB_PATH = dbPath;
process.env.C3_LOG_LEVEL = 'warn';
process.env.C3_AUTONOMY_INTERVAL = '900000';
process.env.C3_AUTONOMY_MIN_TURNS = '10';

let db;
let close;
let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    failures.push({ name, error: error.message });
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.stack || error.message}`);
  }
}

try {
  const databaseModule = await import('../src/db/database.js');
  ({ db, close } = databaseModule);
  const { telemetryMetrics } = databaseModule;
  const {
    aggregate,
    TELEMETRY_AGGREGATION_VERSION,
  } = await import('../src/autonomy/aggregator.js');
  const { detectDrift } = await import('../src/autonomy/drift-detector.js');

  console.log('\n═══ Telemetry Aggregation Version ═══');

  await test('migration labels legacy rows as v1 without changing their data', () => {
    const column = db.prepare(`PRAGMA table_info('telemetry_metrics')`)
      .all()
      .find(candidate => candidate.name === 'aggregation_version');
    assert.ok(column, 'aggregation_version column must exist');
    assert.equal(column.notnull, 1);
    assert.equal(Number(column.dflt_value), 1);

    const row = db.prepare(`
      SELECT * FROM telemetry_metrics WHERE id = 1
    `).get();
    assert.deepEqual(
      {
        id: row.id,
        window_start: row.window_start,
        window_end: row.window_end,
        total_turns: row.total_turns,
        ambiguous_count: row.ambiguous_count,
        ask_user_count: row.ask_user_count,
        break_count: row.break_count,
        override_count: row.override_count,
        avg_confidence: row.avg_confidence,
        override_threshold_at_time: row.override_threshold_at_time,
        rule_distribution: row.rule_distribution,
        created_at: row.created_at,
        aggregation_version: row.aggregation_version,
      },
      {
        id: 1,
        window_start: '2026-07-29T00:00:00.000Z',
        window_end: '2026-07-29T00:15:00.000Z',
        total_turns: 100,
        ambiguous_count: 12,
        ask_user_count: 80,
        break_count: 70,
        override_count: 4,
        avg_confidence: 0.61,
        override_threshold_at_time: 0.85,
        rule_distribution: '{"legacy":100}',
        created_at: '2026-07-29T00:16:00.000Z',
        aggregation_version: 1,
      },
    );
  });

  await test('aggregator persists the current aggregation version', () => {
    const windowEnd = new Date(Date.now() + 1000);
    db.prepare(`
      INSERT INTO telemetry_snapshots (turn_id, snapshot_json)
      VALUES (?, ?)
    `).run(
      'versioned-turn',
      JSON.stringify({
        version: 2,
        classification: {
          diag: {
            initialIntent: 'AMBIGUOUS',
            finalIntent: 'AMBIGUOUS',
            isIntentBreak: false,
            followUp: null,
            overrides: null,
          },
        },
      }),
    );

    const result = aggregate({
      db,
      telemetryMetrics,
      telemetryAlerts: { add: { run: () => {} } },
      creEngine: { getOverrideThreshold: () => 0.85 },
      logger: { debug: () => {} },
    }, windowEnd);

    assert.ok(result);
    assert.equal(result.metrics.totalTurns, 1);

    const persisted = db.prepare(`
      SELECT total_turns, ask_user_count, aggregation_version
      FROM telemetry_metrics
      WHERE window_end = ?
    `).get(windowEnd.toISOString());
    assert.deepEqual(persisted, {
      total_turns: 1,
      ask_user_count: 1,
      aggregation_version: TELEMETRY_AGGREGATION_VERSION,
    });
  });

  await test('aggregation uses half-open windows at SQLite second precision', () => {
    const snapshotJson = ({
      initialIntent,
      finalIntent,
      isIntentBreak = false,
    }) => JSON.stringify({
      version: 2,
      classification: {
        diag: {
          initialIntent,
          finalIntent,
          isIntentBreak,
          followUp: null,
          overrides: null,
        },
      },
    });
    const insert = db.prepare(`
      INSERT INTO telemetry_snapshots (turn_id, snapshot_json, created_at)
      VALUES (?, ?, ?)
    `);

    insert.run(
      'window-start',
      snapshotJson({ initialIntent: 'AMBIGUOUS', finalIntent: 'AMBIGUOUS' }),
      '2026-07-30 00:00:00',
    );
    insert.run(
      'window-interior',
      snapshotJson({ initialIntent: 'LOCAL', finalIntent: 'LOCAL' }),
      '2026-07-30 00:05:00',
    );
    insert.run(
      'window-end',
      snapshotJson({ initialIntent: 'LOCAL', finalIntent: 'LOCAL', isIntentBreak: true }),
      '2026-07-30 00:15:00',
    );

    const windowEnd = new Date('2026-07-30T00:15:00.999Z');
    const result = aggregate({
      db,
      telemetryMetrics,
      telemetryAlerts: { add: { run: () => {} } },
      creEngine: { getOverrideThreshold: () => 0.85 },
      logger: { debug: () => {} },
    }, windowEnd);

    assert.ok(result);
    assert.equal(result.metrics.observedTurns, 2);
    assert.equal(result.metrics.totalTurns, 2);
    assert.equal(result.metrics.ambiguousCount, 1);
    assert.equal(result.metrics.askUserCount, 1);
    assert.equal(result.metrics.breakCount, 0);
  });

  await test('baseline and drift detection use only compatible aggregation rows', () => {
    const addMetric = ({
      start,
      end,
      totalTurns,
      askUserCount,
      breakCount,
      version,
    }) => telemetryMetrics.add.run(
      start,
      end,
      totalTurns,
      0,
      askUserCount,
      breakCount,
      0,
      null,
      0.85,
      '{}',
      version,
    );

    addMetric({
      start: '2026-07-30T01:00:00.000Z',
      end: '2026-07-30T01:15:00.000Z',
      totalTurns: 10,
      askUserCount: 4,
      breakCount: 1,
      version: TELEMETRY_AGGREGATION_VERSION,
    });
    addMetric({
      start: '2026-07-30T02:00:00.000Z',
      end: '2026-07-30T02:15:00.000Z',
      totalTurns: 20,
      askUserCount: 10,
      breakCount: 4,
      version: TELEMETRY_AGGREGATION_VERSION,
    });
    addMetric({
      start: '2026-07-30T03:00:00.000Z',
      end: '2026-07-30T03:15:00.000Z',
      totalTurns: 100,
      askUserCount: 100,
      breakCount: 100,
      version: 1,
    });
    const currentWindowEnd = '2026-07-30T04:15:00.000Z';
    addMetric({
      start: '2026-07-30T04:00:00.000Z',
      end: currentWindowEnd,
      totalTurns: 20,
      askUserCount: 11,
      breakCount: 3,
      version: TELEMETRY_AGGREGATION_VERSION,
    });

    const baseline = telemetryMetrics.baseline.get(
      TELEMETRY_AGGREGATION_VERSION,
      10,
      currentWindowEnd,
      6,
    );
    assert.ok(Math.abs(baseline.avg_ask_user_rate - 0.45) < 1e-12);
    assert.ok(Math.abs(baseline.avg_break_rate - 0.15) < 1e-12);

    let baselineArgs;
    const alerts = [];
    const result = detectDrift({
      telemetryMetrics: {
        baseline: {
          get: (...args) => {
            baselineArgs = args;
            return telemetryMetrics.baseline.get(...args);
          },
        },
      },
      telemetryAlerts: {
        add: { run: (...args) => alerts.push(args) },
        recentByType: { all: () => [] },
      },
      logger: { debug: () => {} },
    }, {
      totalTurns: 20,
      askUserCount: 11,
      breakCount: 3,
      thresholdAtTime: 0.85,
      windowEnd: currentWindowEnd,
    });

    assert.deepEqual(
      baselineArgs,
      [TELEMETRY_AGGREGATION_VERSION, 10, currentWindowEnd, 6],
    );
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0][0], 'ask_user_spike');
    assert.deepEqual(result, {
      drifted: false,
      alerts: [{ type: 'ask_user_spike', severity: 'warning' }],
    });
  });
} finally {
  try {
    close?.();
  } catch {
    // Cleanup must continue even if the connection already closed.
  }
  fs.rmSync(testDir, { recursive: true, force: true });
}

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed}\n`);
if (failures.length > 0) {
  for (const failure of failures) {
    console.log(`  ✗ ${failure.name}: ${failure.error}`);
  }
  process.exitCode = 1;
}
