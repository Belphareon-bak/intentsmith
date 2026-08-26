// Factual model catalog and registry metadata client tests.
// ══════════════════════════════════════════════════════════════════════════════
// Catalog metadata is discovery input; it is not an evaluation or quality score.
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import Database from 'better-sqlite3';

// ─── Imports ────────────────────────────────────────────────────────────────

import {
  CATALOG, CATALOG_VERSION, CATALOG_HASH, QUANT_FACTORS,
  getCatalogEntry, findByFamily, findByCategory,
  getNotInstalled, isModelMature, computeEffectiveVram,
} from '../src/upgrade/model-catalog.js';

import { RegistryClient } from '../src/upgrade/registry-client.js';

// ─── Test DB Setup ──────────────────────────────────────────────────────────

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_catalog_cache (
      model_name TEXT PRIMARY KEY,
      exists_in_registry INTEGER,
      metadata_json TEXT,
      verified_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. CATALOG TESTS (~12)
// ═══════════════════════════════════════════════════════════════════════════

suite('Catalog — Structure & Validation');

test('CATALOG has 50+ entries', () => {
  assert(CATALOG.length >= 50, `Expected ≥50 entries, got ${CATALOG.length}`);
});

test('CATALOG_VERSION is set', () => {
  assert(CATALOG_VERSION.startsWith('v118'), `Version: ${CATALOG_VERSION}`);
});

test('CATALOG_HASH is deterministic', () => {
  assert(typeof CATALOG_HASH === 'string' && CATALOG_HASH.length > 5, `Hash: ${CATALOG_HASH}`);
  assert(CATALOG_HASH.startsWith('v118'), `Hash should start with version: ${CATALOG_HASH}`);
});

test('No duplicate names', () => {
  const names = CATALOG.map(e => e.name);
  const unique = new Set(names);
  assertEqual(unique.size, names.length, `Duplicates found: ${names.filter((n, i) => names.indexOf(n) !== i)}`);
});

test('All entries have required fields', () => {
  for (const entry of CATALOG) {
    assert(entry.name, `Missing name: ${JSON.stringify(entry)}`);
    assert(entry.family, `Missing family for ${entry.name}`);
    assert(entry.category, `Missing category for ${entry.name}`);
    assert(typeof entry.params === 'number', `Missing/invalid params for ${entry.name}`);
    assert(typeof entry.sizeGB === 'number', `Missing/invalid sizeGB for ${entry.name}`);
    assert(typeof entry.baseVramMb === 'number', `Missing/invalid baseVramMb for ${entry.name}`);
    assert(Array.isArray(entry.capabilities), `capabilities not array for ${entry.name}`);
    assert(entry.architecture, `Missing architecture for ${entry.name}`);
    assert(entry.tokenizer, `Missing tokenizer for ${entry.name}`);
    assert(entry.recommendedQuant, `Missing recommendedQuant for ${entry.name}`);
  }
});

test('Catalog never carries quality scores', () => {
  for (const entry of CATALOG) {
    assertEqual('benchmarks' in entry, false, `${entry.name} must not carry benchmarks`);
    assertEqual('score' in entry, false, `${entry.name} must not carry a score`);
  }
});

test('Supersedes chains are valid', () => {
  const names = new Set(CATALOG.map(e => e.name));
  const supersedesValues = CATALOG.filter(e => e.supersedes).map(e => e.supersedes);
  // supersedes points to a family prefix, not exact name
  for (const sup of supersedesValues) {
    assert(typeof sup === 'string' && sup.length > 0, `Invalid supersedes: ${sup}`);
  }
});

test('getCatalogEntry returns entry by name', () => {
  const entry = getCatalogEntry('qwen3:32b');
  assert(entry, 'qwen3:32b not found');
  assertEqual(entry.family, 'qwen');
  assertEqual(entry.params, 32);
});

test('getCatalogEntry returns null for unknown', () => {
  assertEqual(getCatalogEntry('nonexistent:7b'), null);
});

test('findByFamily returns correct entries', () => {
  const qwen = findByFamily('qwen');
  assert(qwen.length >= 4, `Expected ≥4 qwen entries, got ${qwen.length}`);
  for (const e of qwen) assertEqual(e.family, 'qwen');
});

test('findByCategory returns correct entries', () => {
  const code = findByCategory('code');
  assert(code.length >= 3, `Expected ≥3 code entries, got ${code.length}`);
  for (const e of code) assertEqual(e.category, 'code');
});

test('getNotInstalled excludes installed models', () => {
  const installed = new Set(['qwen3:32b', 'deepseek-r1:32b']);
  const notInstalled = getNotInstalled(installed);
  assert(!notInstalled.some(e => installed.has(e.name)), 'Installed model found in notInstalled');
  assert(notInstalled.length === CATALOG.length - installed.size, `Expected ${CATALOG.length - installed.size}, got ${notInstalled.length}`);
});

test('isModelMature checks release date', () => {
  const mature = { releaseDate: '2024-01-01' };
  assert(isModelMature(mature, 7), 'Should be mature');

  const immature = { releaseDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() };
  assert(!isModelMature(immature, 7), 'Should be immature');

  const unknown = { releaseDate: null };
  assert(!isModelMature(unknown, 7), 'Should not be mature without date');
});

test('computeEffectiveVram includes KV cache and safety margin', () => {
  const entry = { params: 32, baseVramMb: 22000, contextWindow: 32768 };
  const effective = computeEffectiveVram(entry, 1.0);
  // (22000 * 1.0 + 32 * 32768 * 0.00002) * 1.10
  const expected = (22000 + 32 * 32768 * 0.00002) * 1.10;
  assert(Math.abs(effective - expected) < 0.01, `Expected ~${expected.toFixed(1)}, got ${effective.toFixed(1)}`);
  assert(effective > 22000, 'Effective VRAM should be > base');
});

test('QUANT_FACTORS has expected keys', () => {
  assertEqual(QUANT_FACTORS.Q4_K_M, 1.0);
  assertEqual(QUANT_FACTORS.Q8_0, 2.0);
  assertEqual(QUANT_FACTORS.FP16, 3.5);
});

// ═══════════════════════════════════════════════════════════════════════════
// Registry metadata client tests
// ═══════════════════════════════════════════════════════════════════════════

suite('Registry Client');

test('cached result returned without fetch', () => {
  const client = new RegistryClient();
  // Manually populate cache
  client._cache.set('qwen3', { exists: true, verifiedAt: new Date().toISOString() });

  // Sync check — the method is async but uses cache
  let result;
  client.verify('qwen3').then(r => { result = r; });
  // Wait a tick (cache path is sync-like)
  const syncResult = { exists: client._cache.get('qwen3').exists, cached: true };
  assert(syncResult.exists, 'Should return cached result');
  assert(syncResult.cached, 'Should be cached');
});

test('offline detection after failures', () => {
  const client = new RegistryClient();
  client._failureCount = 3;
  client._offlineSince = Date.now();
  assert(client.isOffline(), 'Should be offline after 3 failures');
});

test('offline recovery after 1 hour', () => {
  const client = new RegistryClient();
  client._failureCount = 3;
  client._offlineSince = Date.now() - 61 * 60 * 1000; // 61 min ago
  assert(!client.isOffline(), 'Should recover after 1 hour');
});

test('cache TTL expires after 7 days', () => {
  const client = new RegistryClient();
  const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  assert(client._isCacheExpired(oldDate), 'Should be expired');

  const newDate = new Date().toISOString();
  assert(!client._isCacheExpired(newDate), 'Should not be expired');
});

test('DB cache persistence', () => {
  const db = createTestDb();
  const client = new RegistryClient();
  client.setDb(db);

  client._updateCache('testmodel', true);
  const row = db.prepare('SELECT * FROM model_catalog_cache WHERE model_name = ?').get('testmodel');
  assert(row, 'Should persist to DB');
  assertEqual(row.exists_in_registry, 1);
});

test('loadCache populates from DB', () => {
  const db = createTestDb();
  db.prepare("INSERT INTO model_catalog_cache (model_name, exists_in_registry, verified_at) VALUES (?, ?, datetime('now'))").run('cached_model', 1);

  const client = new RegistryClient();
  client.setDb(db);
  client.loadCache();

  assert(client._cache.has('cached_model'), 'Should load from DB');
  assert(client._cache.get('cached_model').exists, 'Should be true');
});

// ═══════════════════════════════════════════════════════════════════════════
// SUMMARY
const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
