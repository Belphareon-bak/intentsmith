// tests/online-discovery.test.js — v121.1: L4 Online Model Discovery
// ══════════════════════════════════════════════════════════════════════════════
// Factual metadata, online discovery, and persistence pipeline.
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import Database from 'better-sqlite3';

// ─── Imports ────────────────────────────────────────────────────────────────

import {
  normalizeFamily, estimateVram,
  buildFamilyMetadataModels, inheritFromNearest,
  extractLibraryName,
} from '../src/upgrade/model-metadata-estimator.js';

import {
  OnlineDiscovery, parseTagsFromHtml,
} from '../src/upgrade/online-discovery.js';

import { CATALOG } from '../src/upgrade/model-catalog.js';

import { RegistryClient } from '../src/upgrade/registry-client.js';

const ASYNC_TEST_TIMEOUT_MS = 10_000;

// ─── Test DB Setup ──────────────────────────────────────────────────────────

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
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
    CREATE INDEX IF NOT EXISTS idx_dm_family ON discovered_models(family);
    CREATE INDEX IF NOT EXISTS idx_dm_name ON discovered_models(name);
  `);
  return db;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL METADATA HELPERS

suite("Model metadata helpers");

test("normalizes family names", () => {
  assertEqual(normalizeFamily("deepseek-r1"), "deepseekr1");
  assertEqual(normalizeFamily("qwen3.5"), "qwen3");
});

test("estimates VRAM without claiming quality", () => {
  assertEqual(estimateVram(14), 620 * 14 + 420);
  assertEqual(estimateVram(0), 0);
});

test("inherits only descriptive metadata from nearest family entry", () => {
  const models = buildFamilyMetadataModels(CATALOG);
  const result = inheritFromNearest("qwen", 20, models);
  assert(result.category !== null);
  assert(Array.isArray(result.capabilities));
  assert(result.contextWindow !== null);
  assertEqual("benchmarks" in result, false);
});

// HTML TAG PARSING
// ═══════════════════════════════════════════════════════════════════════════

suite('Online Discovery — parseTagsFromHtml');

test('extracts tags from href links', () => {
  const html = `
    <a href="/library/gemma3:2b">2b</a>
    <a href="/library/gemma3:9b">9b</a>
    <a href="/library/gemma3:27b">27b</a>
  `;
  const tags = parseTagsFromHtml(html, 'gemma3');
  assertEqual(tags.length, 3);
  assertEqual(tags[0].tag, '2b');
  assertEqual(tags[0].params, 2);
  assertEqual(tags[2].tag, '27b');
  assertEqual(tags[2].params, 27);
});

test('fallback regex when no href links found', () => {
  const html = `Model sizes: 7b 14b 32b available`;
  const tags = parseTagsFromHtml(html, 'qwen');
  assert(tags.length >= 3, `Expected >= 3 tags, got ${tags.length}`);
});

test('deduplicates tags', () => {
  const html = `
    <a href="/library/test:7b">7b</a>
    <a href="/library/test:7b">7b again</a>
  `;
  const tags = parseTagsFromHtml(html, 'test');
  assertEqual(tags.length, 1);
});

test('handles empty/null HTML', () => {
  assertEqual(parseTagsFromHtml('', 'test').length, 0);
  assertEqual(parseTagsFromHtml(null, 'test').length, 0);
});

test('parses params from tag', () => {
  const html = `<a href="/library/qwen:30b-a3b">30b-a3b</a>`;
  const tags = parseTagsFromHtml(html, 'qwen');
  assertEqual(tags.length, 1);
  assertEqual(tags[0].tag, '30b-a3b');
  assertEqual(tags[0].params, 30);
});

// ═══════════════════════════════════════════════════════════════════════════
// ONLINE DISCOVERY
// ═══════════════════════════════════════════════════════════════════════════

suite('Online Discovery — Core');

await testAsync('discoverForFamilies returns empty for empty input', async () => {
  const od = new OnlineDiscovery();
  const results = await od.discoverForFamilies([]);
  assertEqual(results.length, 0);
}, ASYNC_TEST_TIMEOUT_MS);

await testAsync('discoverForFamilies returns empty for null input', async () => {
  const od = new OnlineDiscovery();
  const results = await od.discoverForFamilies(null);
  assertEqual(results.length, 0);
}, ASYNC_TEST_TIMEOUT_MS);

await testAsync('no-op without setDb for getDiscoveredModels', async () => {
  const od = new OnlineDiscovery();
  const results = await od.getDiscoveredModels();
  assertEqual(results.length, 0);
}, ASYNC_TEST_TIMEOUT_MS);

await testAsync('no-op without setDb for persistEntries', async () => {
  const od = new OnlineDiscovery();
  // Should not throw
  await od.persistEntries([{ name: 'test:7b', family: 'test' }]);
}, ASYNC_TEST_TIMEOUT_MS);

await testAsync('no-op without setDb for pruneStale', async () => {
  const od = new OnlineDiscovery();
  const pruned = await od.pruneStale();
  assertEqual(pruned, 0);
}, ASYNC_TEST_TIMEOUT_MS);

suite('Online Discovery — DB operations');

await testAsync('persistEntries stores to DB and getDiscoveredModels reads back', async () => {
  const db = createTestDb();
  const od = new OnlineDiscovery();
  od.setDb(db);

  const entry = {
    name: 'testfamily:20b',
    family: 'testfamily',
    params: 20,
    category: 'general',
    baseVramMb: 12820,
    contextWindow: 32768,
    capabilities: ['json_mode'],
    source: 'L4',
  };

  await od.persistEntries([entry]);
  const models = await od.getDiscoveredModels();
  assertEqual(models.length, 1);
  assertEqual(models[0].name, 'testfamily:20b');
  assertEqual(models[0].params, 20);
  assert(models[0].provisional === true, 'Should be marked provisional');
  assertEqual('benchmarks' in models[0], false);
  assert(models[0].capabilities.includes('json_mode'), 'Capabilities should round-trip');
  db.close();
}, ASYNC_TEST_TIMEOUT_MS);

await testAsync('duplicate persist does upsert (UPDATE)', async () => {
  const db = createTestDb();
  const od = new OnlineDiscovery();
  od.setDb(db);

  await od.persistEntries([{
    name: 'dup:7b', family: 'dup', params: 7, category: 'general',
    baseVramMb: 5000, contextWindow: 8192,
    capabilities: ['first'], source: 'L4',
  }]);

  // Update factual metadata.
  await od.persistEntries([{
    name: 'dup:7b', family: 'dup', params: 7, category: 'general',
    baseVramMb: 5000, contextWindow: 8192,
    capabilities: ['updated'], source: 'L4',
  }]);

  const models = await od.getDiscoveredModels();
  assertEqual(models.length, 1);
  assertEqual(models[0].capabilities[0], 'updated');
  assertEqual('benchmarks' in models[0], false);
  db.close();
}, ASYNC_TEST_TIMEOUT_MS);

await testAsync('pruneStale removes old entries', async () => {
  const db = createTestDb();
  const od = new OnlineDiscovery();
  od.setDb(db);

  // Insert entry with old timestamp
  db.prepare(`
    INSERT INTO discovered_models (name, family, params, updated_at)
    VALUES ('old:7b', 'old', 7, datetime('now', '-40 days'))
  `).run();

  db.prepare(`
    INSERT INTO discovered_models (name, family, params, updated_at)
    VALUES ('new:14b', 'new', 14, datetime('now'))
  `).run();

  const pruned = await od.pruneStale();
  assertEqual(pruned, 1);

  const models = await od.getDiscoveredModels();
  assertEqual(models.length, 1);
  assertEqual(models[0].name, 'new:14b');
  db.close();
}, ASYNC_TEST_TIMEOUT_MS);

suite('Online Discovery — Entry Building');

test('_buildProvisionalEntry creates correct shape', () => {
  const od = new OnlineDiscovery();
  od._familyMetadata = buildFamilyMetadataModels(CATALOG);
  od._catalogNames = new Set(CATALOG.map(e => e.name));

  const entry = od._buildProvisionalEntry('qwen', { tag: '20b', params: 20 }, 24000);
  assert(entry !== null, 'Entry should not be null');
  assertEqual(entry.name, 'qwen:20b');
  assertEqual(entry.family, 'qwen');
  assertEqual(entry.params, 20);
  assertEqual(entry.provisional, true);
  assertEqual(entry.source, 'L4');
  assertEqual(entry.baseVramMb, estimateVram(20));
  assertEqual('benchmarks' in entry, false);
  assertEqual('benchmarkConfidence' in entry, false);
  assert(entry.capabilities !== null, 'Should inherit capabilities');
  assert(entry.contextWindow !== null, 'Should inherit contextWindow');
});

test('_buildProvisionalEntry returns null for 0 params', () => {
  const od = new OnlineDiscovery();
  const entry = od._buildProvisionalEntry('qwen', { tag: 'latest', params: 0 }, 0);
  assertEqual(entry, null);
});

test('_buildProvisionalEntry returns null for params < MIN_USEFUL_PARAMS (3B)', () => {
  const od = new OnlineDiscovery();
  od._familyMetadata = buildFamilyMetadataModels(CATALOG);
  const entry1 = od._buildProvisionalEntry('qwen', { tag: '0.5b', params: 0.5 }, 24000);
  assertEqual(entry1, null);
  const entry2 = od._buildProvisionalEntry('qwen', { tag: '1.8b', params: 1.8 }, 24000);
  assertEqual(entry2, null);
  const entry3 = od._buildProvisionalEntry('qwen', { tag: '4b', params: 4 }, 24000);
  assert(entry3 !== null, '4B should pass min params filter');
});

test('_buildProvisionalEntry returns null when VRAM exceeds GPU limit', () => {
  const od = new OnlineDiscovery();
  od._familyMetadata = buildFamilyMetadataModels(CATALOG);
  // 72B → 620*72+420 = 45060 MB, 90% of 24000 = 21600 → too large
  const entry72 = od._buildProvisionalEntry('qwen', { tag: '72b', params: 72 }, 24000);
  assertEqual(entry72, null);
  // 27B → 620*27+420 = 17160 MB, 90% of 24000 = 21600 → fits
  const entry27 = od._buildProvisionalEntry('qwen', { tag: '27b', params: 27 }, 24000);
  assert(entry27 !== null, '27B should fit in 24GB');
});

test('_buildProvisionalEntry skips VRAM check when gpuVramMb=0', () => {
  const od = new OnlineDiscovery();
  od._familyMetadata = buildFamilyMetadataModels(CATALOG);
  const entry = od._buildProvisionalEntry('qwen', { tag: '72b', params: 72 }, 0);
  assert(entry !== null, 'Should not filter when GPU info unavailable');
});

test('_filterNewTags excludes catalog entries', () => {
  const od = new OnlineDiscovery();
  od._catalogNames = new Set(['qwen3:14b', 'qwen3:32b']);

  const tags = [
    { tag: '14b', params: 14 },   // In catalog → filtered
    { tag: '20b', params: 20 },   // Not in catalog → kept
    { tag: '32b', params: 32 },   // In catalog → filtered
  ];

  const filtered = od._filterNewTags('qwen3', tags);
  assertEqual(filtered.length, 1);
  assertEqual(filtered[0].tag, '20b');
});

test('_filterNewTags excludes already discovered entries', () => {
  const db = createTestDb();
  const od = new OnlineDiscovery();
  od.setDb(db);
  od._catalogNames = new Set();

  // Pre-insert a discovered model
  db.prepare(`INSERT INTO discovered_models (name, family, params) VALUES ('testf:7b', 'testf', 7)`).run();

  const tags = [
    { tag: '7b', params: 7 },   // Already discovered → filtered
    { tag: '14b', params: 14 }, // New → kept
  ];

  const filtered = od._filterNewTags('testf', tags);
  assertEqual(filtered.length, 1);
  assertEqual(filtered[0].tag, '14b');
  db.close();
});

test('_filterNewTags excludes tags without params', () => {
  const od = new OnlineDiscovery();
  od._catalogNames = new Set();

  const tags = [
    { tag: 'latest', params: null },
    { tag: '7b', params: 7 },
  ];

  const filtered = od._filterNewTags('testf', tags);
  assertEqual(filtered.length, 1);
  assertEqual(filtered[0].tag, '7b');
});

suite('Online Discovery — Rate Limit');

await testAsync('max 8 families fetched per cycle', async () => {
  let fetchCount = 0;
  const od = new OnlineDiscovery();
  od._familyMetadata = buildFamilyMetadataModels(CATALOG);
  od._catalogNames = new Set(CATALOG.map(e => e.name));

  // Override fetch to count calls
  od._fetchFamilyPage = async () => {
    fetchCount++;
    return '<a href="/library/fam:99b">99b</a>';
  };

  const families = Array.from({ length: 12 }, (_, i) => `fam${i}`);
  await od.discoverForFamilies(families);
  assert(fetchCount <= 8, `Expected max 8 fetches, got ${fetchCount}`);
  assert(fetchCount > 3, `Expected more than 3 fetches, got ${fetchCount}`);
}, ASYNC_TEST_TIMEOUT_MS);

await testAsync('guided discovery works without installed families when seed families are provided', async () => {
  const od = new OnlineDiscovery();
  od._familyMetadata = buildFamilyMetadataModels(CATALOG);
  od._catalogNames = new Set(CATALOG.map(e => e.name));
  od._fetchFamilyPage = async () => '<a href="/library/gemma4:27b">27b</a>';

  const results = await od.discoverForFamilies([], {
    seedFamilies: ['gemma4'],
    maxFamilies: 2,
  });
  assert(results.some(r => r.name === 'gemma4:27b'), 'Expected seeded family to be discovered');
}, ASYNC_TEST_TIMEOUT_MS);

await testAsync('guided discovery reserves diversity slot for registry seeds', async () => {
  const fetchedFamilies = [];
  const od = new OnlineDiscovery();
  od._familyMetadata = buildFamilyMetadataModels(CATALOG);
  od._catalogNames = new Set(CATALOG.map(e => e.name));
  od._registryClient = {
    fetchLibraryIndexFamilies: async () => ['regalpha', 'regbeta', 'reggamma'],
  };
  od._fetchFamilyPage = async (family) => {
    fetchedFamilies.push(family);
    return `<a href="/library/${family}:14b">14b</a>`;
  };

  await od.discoverForFamilies(['installedA'], {
    seedFamilies: ['seedA', 'seedB'],
    maxFamilies: 4,
    highPriorityRatio: 0.75, // 3 high-priority + 1 diversity slot
  });

  const hasRegistryFamily = fetchedFamilies.some(f => f.startsWith('reg'));
  assert(hasRegistryFamily, `Expected at least one registry family in diversity slot, got: ${fetchedFamilies.join(', ')}`);
  assert(fetchedFamilies.length <= 4, `Expected <= 4 fetched families, got ${fetchedFamilies.length}`);
}, ASYNC_TEST_TIMEOUT_MS);

await testAsync('highPriorityRatio zero selects entirely from diversity ranking', async () => {
  const fetchedFamilies = [];
  const od = new OnlineDiscovery();
  od._familyMetadata = buildFamilyMetadataModels(CATALOG);
  od._catalogNames = new Set(CATALOG.map(e => e.name));
  od._fetchFamilyPage = async (family) => {
    fetchedFamilies.push(family);
    return `<a href="/library/${family}:14b">14b</a>`;
  };

  await od.discoverForFamilies(['installed'], {
    registrySeedFamilies: ['registry-a', 'registry-b'],
    maxFamilies: 1,
    highPriorityRatio: 0,
  });

  assertEqual(fetchedFamilies.length, 1);
  assertEqual(fetchedFamilies[0], 'registry-a');
}, ASYNC_TEST_TIMEOUT_MS);

await testAsync('maxVariantsPerFamily limits parsed variants', async () => {
  const od = new OnlineDiscovery();
  od._familyMetadata = buildFamilyMetadataModels(CATALOG);
  od._catalogNames = new Set(CATALOG.map(e => e.name));
  od._fetchFamilyPage = async () => `
    <a href="/library/limfam:7b">7b</a>
    <a href="/library/limfam:14b">14b</a>
    <a href="/library/limfam:27b">27b</a>
    <a href="/library/limfam:32b">32b</a>
  `;

  const results = await od.discoverForFamilies(['limfam'], {
    maxFamilies: 1,
    maxVariantsPerFamily: 2,
  });
  assertEqual(results.length, 2);
}, ASYNC_TEST_TIMEOUT_MS);

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

suite('Pipeline Integration');

await testAsync('L4 entries merged into discovery candidates', async () => {
  const db = createTestDb();
  const od = new OnlineDiscovery();
  od.setDb(db);

  await od.persistEntries([{
    name: 'newmodel:20b', family: 'newmodel', params: 20,
    category: 'general', baseVramMb: 12820, contextWindow: 32768,
    capabilities: ['json_mode'], source: 'L4',
  }]);

  const models = await od.getDiscoveredModels();
  assertEqual(models.length, 1);
  assertEqual(models[0].provisional, true);
  assertEqual(models[0].source, 'L4');
  db.close();
}, ASYNC_TEST_TIMEOUT_MS);

test('registryClient fetchLibraryPage method exists', () => {
  const client = new RegistryClient();
  assert(typeof client.fetchLibraryPage === 'function',
    'fetchLibraryPage should be a method');
});

test('registryClient parses bounded, unique library index families', () => {
  const client = new RegistryClient();
  const families = client._parseLibraryIndexFamilies(`
    <a href="/library/Qwen3">Qwen</a>
    <a href="/library/qwen3:8b">Qwen tag</a>
    <a href="/library/gemma3">Gemma</a>
    <a href="/library/not%2Fsafe">Invalid decoded path</a>
  `, 2);

  assertEqual(families.length, 2);
  assertEqual(families[0], 'qwen3');
  assertEqual(families[1], 'gemma3');
});

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACT LIBRARY NAME
// ═══════════════════════════════════════════════════════════════════════════

suite('extractLibraryName');

test('extracts prefix before colon', () => {
  assertEqual(extractLibraryName('qwen3.5:27b'), 'qwen3.5');
  assertEqual(extractLibraryName('deepseek-r1:32b'), 'deepseek-r1');
  assertEqual(extractLibraryName('llava:13b'), 'llava');
  assertEqual(extractLibraryName('qwen2.5-coder:32b'), 'qwen2.5-coder');
});

test('strips trailing param-size suffix for models without colon', () => {
  assertEqual(extractLibraryName('deepseek-r1-32b'), 'deepseek-r1');
  assertEqual(extractLibraryName('qwen3-30b-a3b'), 'qwen3');
});

test('handles latest tag', () => {
  assertEqual(extractLibraryName('deepseek-r1-32b:latest'), 'deepseek-r1');
  assertEqual(extractLibraryName('qwen3:latest'), 'qwen3');
});

test('handles empty/null', () => {
  assertEqual(extractLibraryName(''), '');
  assertEqual(extractLibraryName(null), '');
  assertEqual(extractLibraryName(undefined), '');
});

test('preserves version numbers in name', () => {
  assertEqual(extractLibraryName('qwen2.5:32b'), 'qwen2.5');
  assertEqual(extractLibraryName('llama3.1:70b'), 'llama3.1');
  assertEqual(extractLibraryName('gemma3:27b'), 'gemma3');
});

test('lowercases the result', () => {
  assertEqual(extractLibraryName('Qwen3.5:27b'), 'qwen3.5');
  assertEqual(extractLibraryName('DeepSeek-R1:32b'), 'deepseek-r1');
});

// ═══════════════════════════════════════════════════════════════════════════

summary();
