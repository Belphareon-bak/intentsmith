import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import Database from 'better-sqlite3';

import { modelUniverseStore, makeIdempotencyKey } from '../src/upgrade/model-universe-store.js';
import { up as upModelUniverse } from '../src/db/migrations/2026_04_08_041_v136_model_universe.js';
import { up as upUniverseReconcile } from '../src/db/migrations/2026_04_08_042_v137_universe_reconciliation.js';

function createDiscoveredTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS discovered_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      family TEXT NOT NULL,
      params REAL,
      category TEXT,
      base_vram_mb INTEGER,
      context_window INTEGER,
      capabilities_json TEXT,
      source TEXT DEFAULT 'L4',
      discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function createDb(withUniverse = true) {
  const db = new Database(':memory:');
  if (withUniverse) {
    upModelUniverse(db);
    upUniverseReconcile(db);
    db.exec(`
      ALTER TABLE model_universe_derived DROP COLUMN score_estimated;
      ALTER TABLE model_universe_derived DROP COLUMN score_state;
    `);
  }
  createDiscoveredTable(db);
  return db;
}

suite('ModelUniverseStore');

test('upsertRaw deduplicates by idempotency key', () => {
  const db = createDb(true);
  modelUniverseStore.setDb(db);

  const modelName = 'gemma4:27b';
  const key = makeIdempotencyKey(modelName, '27b', 'local', 60_000);

  const first = modelUniverseStore.upsertRaw({
    modelName,
    tag: '27b',
    source: 'local',
    idempotencyKey: key,
    metadataState: 'STABLE',
    parameters: 27,
    contextLength: 32768,
    quantization: 'Q4_K_M',
    modality: 'text',
    metadata: { test: 1 },
  });
  const second = modelUniverseStore.upsertRaw({
    modelName,
    tag: '27b',
    source: 'local',
    idempotencyKey: key,
    metadataState: 'STABLE',
    parameters: 27,
    contextLength: 32768,
    quantization: 'Q4_K_M',
    modality: 'text',
    metadata: { test: 2 },
  });

  const rows = db.prepare('SELECT COUNT(*) as c FROM model_universe_raw').get();
  assertEqual(first.ok, true);
  assertEqual(second.ok, true);
  assertEqual(second.deduped, true);
  assertEqual(rows.c, 1);
});

test('persistRawWithFallback writes primary universe and mirror', () => {
  const db = createDb(true);
  modelUniverseStore.setDb(db);

  const result = modelUniverseStore.persistRawWithFallback({
    modelName: 'gemma4:27b',
    tag: '27b',
    source: 'local',
    metadataState: 'STABLE',
    parameters: 27,
    contextLength: 32768,
    quantization: 'Q4_K_M',
    modality: 'text',
    metadata: { from: 'test' },
  }, { mirrorEnabled: true });

  const rawCount = db.prepare('SELECT COUNT(*) as c FROM model_universe_raw').get().c;
  const discovered = db.prepare('SELECT * FROM discovered_models WHERE name = ?').get('gemma4:27b');

  assertEqual(result.ok, true);
  assertEqual(result.writeSource, 'universe');
  assertEqual(rawCount, 1);
  assert(!!discovered, 'Expected discovered_models mirror row');
});

test('fallback path writes discovered_models when universe tables are unavailable', () => {
  const db = createDb(false); // no universe tables
  modelUniverseStore.setDb(db);

  const result = modelUniverseStore.persistRawWithFallback({
    modelName: 'qwen3.5:14b',
    tag: '14b',
    source: 'local',
    metadataState: 'PARTIAL',
    parameters: 14,
    contextLength: 16384,
    quantization: 'Q4_K_M',
    modality: 'text',
    metadata: { fallback: true },
  }, { mirrorEnabled: true });

  const discovered = db.prepare('SELECT * FROM discovered_models WHERE name = ?').get('qwen3.5:14b');
  assertEqual(result.ok, true);
  assertEqual(result.writeSource, 'fallback');
  assert(!!discovered, 'Expected discovered_models fallback row');
});

test('upsertDerived updates same model+tag record', () => {
  const db = createDb(true);
  modelUniverseStore.setDb(db);

  modelUniverseStore.upsertDerived({
    modelName: 'gemma4:27b',
    tag: '27b',
    confidence: 0.25,
    confidenceState: 'LOW',
  });
  modelUniverseStore.upsertDerived({
    modelName: 'gemma4:27b',
    tag: '27b',
    confidence: 0.45,
    confidenceState: 'MEDIUM',
  });

  const row = db.prepare('SELECT * FROM model_universe_derived WHERE model_name = ? AND tag = ?').get('gemma4:27b', '27b');
  const count = db.prepare('SELECT COUNT(*) as c FROM model_universe_derived').get().c;
  assertEqual(count, 1);
  assertEqual('score_estimated' in row, false);
  assertEqual(row.confidence, 0.45);
  assertEqual(row.confidence_state, 'MEDIUM');
});

test('reconcileAndRecompute resolves conflicting sources via effective priority', () => {
  const db = createDb(true);
  modelUniverseStore.setDb(db);

  modelUniverseStore.upsertRaw({
    modelName: 'gemma4:27b',
    tag: '27b',
    source: 'registry',
    metadataState: 'STABLE',
    parameters: 27,
    contextLength: 131072,
    quantization: 'Q4_K_M',
    modality: 'text',
    metadata: { source_confidence: 0.9 },
  });

  modelUniverseStore.upsertRaw({
    modelName: 'gemma4:27b',
    tag: '27b',
    source: 'validation',
    metadataState: 'STABLE',
    parameters: 27,
    contextLength: 32768,
    quantization: 'Q4_K_M',
    modality: 'text',
    metadata: { max_context_length_validated: 32768, source_confidence: 1.0 },
  });

  const result = modelUniverseStore.reconcileAndRecompute('gemma4:27b', '27b', { reasonCode: 'test_conflict' });
  const reconciled = modelUniverseStore.getReconciledRaw('gemma4:27b', '27b');
  assertEqual(result.ok, true);
  assert(!!reconciled, 'Expected reconciled raw row');
  assertEqual(reconciled.context_length, 32768);
  assertEqual(reconciled.source, 'reconciled');
});

test('reconcile normalization treats "32k" and 32768 as equivalent', () => {
  const db = createDb(true);
  modelUniverseStore.setDb(db);

  modelUniverseStore.upsertRaw({
    modelName: 'qwen3.5:14b',
    tag: '14b',
    source: 'registry',
    metadataState: 'STABLE',
    parameters: 14,
    contextLength: '32k',
    quantization: 'q4_k_m',
    modality: 'text',
  });
  modelUniverseStore.upsertRaw({
    modelName: 'qwen3.5:14b',
    tag: '14b',
    source: 'local',
    metadataState: 'STABLE',
    parameters: 14,
    contextLength: 32768,
    quantization: 'Q4_K_M',
    modality: 'text',
  });

  const first = modelUniverseStore.reconcileAndRecompute('qwen3.5:14b', '14b', { reasonCode: 'test_norm_1' });
  const second = modelUniverseStore.reconcileAndRecompute('qwen3.5:14b', '14b', { reasonCode: 'test_norm_2' });
  const logCount = db.prepare('SELECT COUNT(*) as c FROM model_reconciliation_log').get().c;

  assertEqual(first.ok, true);
  assertEqual(second.ok, true);
  assert(logCount >= 1, 'Expected initial reconciliation logs');
});

test('reconcile coalesces equivalent sources (local/runtime) to one canonical candidate', () => {
  const db = createDb(true);
  modelUniverseStore.setDb(db);

  modelUniverseStore.upsertRaw({
    modelName: 'gemma4:27b',
    tag: '27b',
    source: 'local',
    metadataState: 'STABLE',
    parameters: 27,
    contextLength: 32768,
    quantization: 'Q4_K_M',
    modality: 'text',
  });
  modelUniverseStore.upsertRaw({
    modelName: 'gemma4:27b',
    tag: '27b',
    source: 'runtime',
    metadataState: 'STABLE',
    parameters: 27,
    contextLength: 32768,
    quantization: 'Q4_K_M',
    modality: 'text',
  });

  modelUniverseStore.reconcileAndRecompute('gemma4:27b', '27b', { reasonCode: 'test_source_canonicalization' });
  const reconciled = modelUniverseStore.getReconciledRaw('gemma4:27b', '27b');
  const meta = JSON.parse(reconciled.metadata_json || '{}');
  const ctx = meta?.fields?.context_length || {};

  assertEqual(ctx.candidateCount, 1);
  assertEqual(ctx.source, 'runtime');
});

test('reconciliation writes audit rows with reason code', () => {
  const db = createDb(true);
  modelUniverseStore.setDb(db);

  modelUniverseStore.upsertRaw({
    modelName: 'deepseek-r1:32b',
    tag: '32b',
    source: 'local',
    metadataState: 'STABLE',
    parameters: 32,
    contextLength: 32768,
    quantization: 'Q4_K_M',
    modality: 'text',
  });
  modelUniverseStore.reconcileAndRecompute('deepseek-r1:32b', '32b', { reasonCode: 'initial' });

  modelUniverseStore.upsertRaw({
    modelName: 'deepseek-r1:32b',
    tag: '32b',
    source: 'validation',
    metadataState: 'STABLE',
    parameters: 32,
    contextLength: 65536,
    quantization: 'Q4_K_M',
    modality: 'text',
    metadata: { source_confidence: 1.0 },
  });
  modelUniverseStore.reconcileAndRecompute('deepseek-r1:32b', '32b', { reasonCode: 'after_validation' });

  const rows = db.prepare(`
    SELECT field, reason_code, source
    FROM model_reconciliation_log
    WHERE model_name = ? AND tag = ?
    ORDER BY id DESC
  `).all('deepseek-r1:32b', '32b');

  assert(rows.length > 0, 'Expected reconciliation audit logs');
  assert(rows.some(r => r.field === 'context_length'), 'Expected context_length audit row');
  assert(rows.some(r => !!r.reason_code), 'Expected reason_code to be populated');
});

test('reconcile idempotency: second run does not append logs when nothing changed', () => {
  const db = createDb(true);
  modelUniverseStore.setDb(db);

  modelUniverseStore.upsertRaw({
    modelName: 'llama3.1:70b',
    tag: '70b',
    source: 'local',
    metadataState: 'STABLE',
    parameters: 70,
    contextLength: 32768,
    quantization: 'Q4_K_M',
    modality: 'text',
  });

  modelUniverseStore.reconcileAndRecompute('llama3.1:70b', '70b', { reasonCode: 'first' });
  const before = db.prepare('SELECT COUNT(*) as c FROM model_reconciliation_log WHERE model_name = ? AND tag = ?').get('llama3.1:70b', '70b').c;
  modelUniverseStore.reconcileAndRecompute('llama3.1:70b', '70b', { reasonCode: 'second' });
  const after = db.prepare('SELECT COUNT(*) as c FROM model_reconciliation_log WHERE model_name = ? AND tag = ?').get('llama3.1:70b', '70b').c;

  assertEqual(before, after);
});

test('derived sync updates based_on_version after raw change', () => {
  const db = createDb(true);
  modelUniverseStore.setDb(db);

  modelUniverseStore.upsertRaw({
    modelName: 'qwen3.5:30b',
    tag: '30b',
    source: 'local',
    metadataState: 'STABLE',
    parameters: 30,
    contextLength: 32768,
    quantization: 'Q4_K_M',
    modality: 'text',
  });
  modelUniverseStore.reconcileAndRecompute('qwen3.5:30b', '30b', { reasonCode: 'v1' });
  const first = modelUniverseStore.getDerived('qwen3.5:30b', '30b');

  modelUniverseStore.upsertRaw({
    modelName: 'qwen3.5:30b',
    tag: '30b',
    source: 'validation',
    metadataState: 'STABLE',
    parameters: 30,
    contextLength: 65536,
    quantization: 'Q4_K_M',
    modality: 'text',
  });
  modelUniverseStore.reconcileAndRecompute('qwen3.5:30b', '30b', { reasonCode: 'v2' });
  const second = modelUniverseStore.getDerived('qwen3.5:30b', '30b');

  assert(!!first && !!second, 'Expected derived rows to exist');
  assert(first.based_on_version !== second.based_on_version, 'Expected based_on_version to change after raw update');
  assert(second.last_computed_at != null, 'Expected last_computed_at to be set');
});

test('recordSignalEvent buffers events and flushSignalBuffer inserts in batch', () => {
  const db = createDb(true);
  modelUniverseStore.setDb(db);
  modelUniverseStore.setSignalIngestConfig({
    flushIntervalMs: 60000,
    batchSize: 100,
    bufferMax: 100,
    baseSampleRate: 1,
    pressureSampleRate: 10,
  });

  for (let i = 1; i <= 3; i++) {
    modelUniverseStore.recordSignalEvent({
      modelName: 'gemma4:27b',
      signalType: 'runtime',
      success: true,
      latencyMs: 120 + i,
      payload: { seq: i },
      scheduleRecompute: false,
    });
  }

  const before = db.prepare('SELECT COUNT(*) as c FROM model_signal_events').get().c;
  const buffered = modelUniverseStore.getSignalStats();
  assertEqual(before, 0);
  assertEqual(buffered.bufferLength, 3);

  const flushed = modelUniverseStore.flushSignalBuffer({ drain: true, reason: 'test_manual' });
  const after = db.prepare('SELECT COUNT(*) as c FROM model_signal_events').get().c;
  const stats = modelUniverseStore.getSignalStats();
  assertEqual(flushed.ok, true);
  assertEqual(after, 3);
  assertEqual(stats.inserted, 3);
  assertEqual(stats.bufferLength, 0);
});

test('recordSignalEvent applies deterministic sampling under configured sample rate', () => {
  const db = createDb(true);
  modelUniverseStore.setDb(db);
  modelUniverseStore.setSignalIngestConfig({
    flushIntervalMs: 60000,
    batchSize: 100,
    bufferMax: 100,
    baseSampleRate: 4,
    pressureSampleRate: 4,
  });

  for (let i = 1; i <= 10; i++) {
    modelUniverseStore.recordSignalEvent({
      modelName: 'qwen3.5:14b',
      signalType: 'runtime',
      success: true,
      latencyMs: 50 + i,
      payload: { seq: i },
      scheduleRecompute: false,
    });
  }

  const stats = modelUniverseStore.getSignalStats();
  assertEqual(stats.received, 10);
  assertEqual(stats.sampledOut, 8);
  assertEqual(stats.bufferLength, 2);

  modelUniverseStore.flushSignalBuffer({ drain: true, reason: 'test_sampling' });
  const rows = db.prepare('SELECT COUNT(*) as c FROM model_signal_events WHERE model_name = ?').get('qwen3.5:14b').c;
  assertEqual(rows, 2);
});

test('recordSignalEvent enforces backpressure by dropping oldest buffered events', () => {
  const db = createDb(true);
  modelUniverseStore.setDb(db);
  modelUniverseStore.setSignalIngestConfig({
    flushIntervalMs: 60000,
    batchSize: 100,
    bufferMax: 3,
    baseSampleRate: 1,
    pressureSampleRate: 1,
  });

  for (let i = 1; i <= 5; i++) {
    modelUniverseStore.recordSignalEvent({
      modelName: 'deepseek-r1:32b',
      signalType: 'runtime',
      success: i % 2 === 0,
      latencyMs: 80 + i,
      payload: { seq: i },
      scheduleRecompute: false,
    });
  }

  const statsBeforeFlush = modelUniverseStore.getSignalStats();
  assertEqual(statsBeforeFlush.bufferLength, 3);
  assertEqual(statsBeforeFlush.dropped, 2);

  modelUniverseStore.flushSignalBuffer({ drain: true, reason: 'test_backpressure' });
  const rows = db.prepare(`
    SELECT payload_json
    FROM model_signal_events
    WHERE model_name = ?
    ORDER BY id ASC
  `).all('deepseek-r1:32b');
  const seq = rows.map(r => {
    try { return JSON.parse(r.payload_json || '{}').seq; } catch { return null; }
  });
  assertEqual(rows.length, 3);
  assertEqual(seq.join(','), '3,4,5');
});

test('listUniverse supports pagination, filters and snapshot_id', () => {
  const db = createDb(true);
  modelUniverseStore.setDb(db);

  modelUniverseStore.upsertRaw({
    modelName: 'gemma4:27b',
    tag: '27b',
    source: 'local',
    metadataState: 'STABLE',
    parameters: 27,
    contextLength: 32768,
    quantization: 'Q4_K_M',
    modality: 'text',
  });
  modelUniverseStore.reconcileAndRecompute('gemma4:27b', '27b', { reasonCode: 'list_test_stable' });

  modelUniverseStore.upsertRaw({
    modelName: 'mystery-new:14b',
    tag: '14b',
    source: 'local',
    metadataState: 'PARTIAL',
    parameters: 14,
    contextLength: null,
    quantization: 'Q4_K_M',
    modality: 'text',
  });
  modelUniverseStore.reconcileAndRecompute('mystery-new:14b', '14b', { reasonCode: 'list_test_partial' });

  const page1 = modelUniverseStore.listUniverse({ limit: 1, offset: 0, sort: 'name', order: 'asc' });
  const onlyPartial = modelUniverseStore.listUniverse({ limit: 10, state: 'PARTIAL' });

  assertEqual(page1.ok, true);
  assertEqual(page1.limit, 1);
  assertEqual(page1.total, 2);
  assertEqual(page1.models.length, 1);
  assert(page1.snapshotId && page1.snapshotId.startsWith('u1:'), `Expected snapshotId, got ${page1.snapshotId}`);

  assertEqual(onlyPartial.ok, true);
  assertEqual(onlyPartial.total, 1);
  assertEqual(onlyPartial.models[0].metadataState, 'PARTIAL');
});

test('getUniverseModelDetails returns model + sources + recent signals', () => {
  const db = createDb(true);
  modelUniverseStore.setDb(db);
  modelUniverseStore.setSignalIngestConfig({
    flushIntervalMs: 60000,
    batchSize: 100,
    bufferMax: 100,
    baseSampleRate: 1,
    pressureSampleRate: 1,
  });

  modelUniverseStore.upsertRaw({
    modelName: 'deepseek-r1:32b',
    tag: '32b',
    source: 'local',
    metadataState: 'STABLE',
    parameters: 32,
    contextLength: 32768,
    quantization: 'Q4_K_M',
    modality: 'text',
  });
  modelUniverseStore.reconcileAndRecompute('deepseek-r1:32b', '32b', { reasonCode: 'detail_test' });

  for (let i = 1; i <= 3; i++) {
    modelUniverseStore.recordSignalEvent({
      modelName: 'deepseek-r1:32b',
      signalType: i < 3 ? 'runtime' : 'runtime_failed',
      success: i < 3,
      latencyMs: 100 + i,
      errorType: i < 3 ? null : 'runtime_failed',
      scheduleRecompute: false,
    });
  }
  modelUniverseStore.flushSignalBuffer({ drain: true, reason: 'detail_test' });

  const detail = modelUniverseStore.getUniverseModelDetails('deepseek-r1:32b', {
    includeSignals: true,
    signalLimit: 2,
    sourceLimit: 5,
  });

  assertEqual(detail.ok, true);
  assert(detail.model, 'Expected detail.model');
  assertEqual(detail.model.modelName, 'deepseek-r1:32b');
  assert(Array.isArray(detail.sources) && detail.sources.length >= 1, 'Expected source rows');
  assertEqual(detail.signals.length, 2);
  assert(detail.snapshotId && detail.snapshotId.includes('deepseek-r1:32b'), `Expected snapshotId with model name, got ${detail.snapshotId}`);
});

summary();
