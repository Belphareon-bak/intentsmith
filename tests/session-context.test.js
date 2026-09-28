import './helpers/isolated-test-db.js';

// Session Context Unit Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests SessionParamCache and contextual re-execution in SpecialistRuntime.
//
// Covers:
//   1-4.  SessionParamCache: save, get, TTL expiry, scoping, isolation
//   5.    tryToolExecution: contextual re-execution (no pattern match, cached tool)
//   6.    tryToolExecution: backwards compatible without sessionId
//   7.    Session merge priority
//   8.    Cross-tool isolation (daň → DPH → year follow-up)
//   9.    Cache expiration integration (TTL → fresh fallback)
//   10.   Clarify loop guard (clarify → "Nevím" → no cycle)
//   11.   Validation false positive (low income, high rate OK)
//
// Run: node tests/session-context.test.js
// ══════════════════════════════════════════════════════════════════════════════

import { SessionParamCache } from '../src/expertises/specialist-runtime.js';
import { ToolAdapter } from '../src/expertises/tool-adapter.js';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];

function pass(name) {
  console.log(`  ✅ ${name}`);
  passed++;
}

function fail(name, msg) {
  console.log(`  ❌ ${name}: ${msg}`);
  failed++;
  failures.push({ name, msg });
}

function assert(condition, name, detail = '') {
  if (condition) pass(name);
  else fail(name, detail || 'assertion failed');
}

function assertEq(actual, expected, name) {
  if (actual === expected) pass(name);
  else fail(name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════ Session Context Tests ══════');

// ── 1. SessionParamCache basics ─────────────────────────────────────────────
console.log('\n── 1. SessionParamCache basics ──');

{
  const cache = new SessionParamCache();

  // Empty cache returns null
  assertEq(cache.get('session1', 'accountant'), null, 'cache: empty → null');

  // Save and retrieve
  cache.save('session1', 'accountant', 'accountant.tax_calculator', { gross_income: 850000, year: 2025 });
  const entry = cache.get('session1', 'accountant');
  assert(entry !== null, 'cache: save → retrievable');
  assertEq(entry.toolId, 'accountant.tax_calculator', 'cache: correct toolId');
  assertEq(entry.params.gross_income, 850000, 'cache: correct params.gross_income');
  assertEq(entry.params.year, 2025, 'cache: correct params.year');

  // Different session → isolated
  assertEq(cache.get('session2', 'accountant'), null, 'cache: different session → null');

  // Different specialist → isolated
  assertEq(cache.get('session1', 'lawyer'), null, 'cache: different specialist → null');

  // Overwrite
  cache.save('session1', 'accountant', 'accountant.salary_calculator', { gross_salary: 50000 });
  const updated = cache.get('session1', 'accountant');
  assertEq(updated.toolId, 'accountant.salary_calculator', 'cache: overwrite → new toolId');
  assertEq(updated.params.gross_salary, 50000, 'cache: overwrite → new params');
  assertEq(updated.params.gross_income, undefined, 'cache: overwrite → old params gone');

  // Clear
  cache.clear('session1', 'accountant');
  assertEq(cache.get('session1', 'accountant'), null, 'cache: clear → null');
}

// ── 2. SessionParamCache TTL ────────────────────────────────────────────────
console.log('\n── 2. SessionParamCache TTL ──');

{
  // 100ms TTL for testing
  const cache = new SessionParamCache(100);

  cache.save('s1', 'acc', 'acc.tax', { gross_income: 500000 });
  assert(cache.get('s1', 'acc') !== null, 'ttl: immediately after save → present');

  // Wait 150ms
  await new Promise(r => setTimeout(r, 150));
  assertEq(cache.get('s1', 'acc'), null, 'ttl: after expiry → null');
}

// ── 3. SessionParamCache null sessionId guard ───────────────────────────────
console.log('\n── 3. SessionParamCache null sessionId guard ──');

{
  const cache = new SessionParamCache();

  // save with null sessionId → no-op
  cache.save(null, 'accountant', 'acc.tax', { x: 1 });
  assertEq(cache.get(null, 'accountant'), null, 'cache: null sessionId → null');

  cache.save(undefined, 'accountant', 'acc.tax', { x: 1 });
  assertEq(cache.get(undefined, 'accountant'), null, 'cache: undefined sessionId → null');
}

// ── 4. SessionParamCache param isolation (deep copy) ────────────────────────
console.log('\n── 4. SessionParamCache param isolation ──');

{
  const cache = new SessionParamCache();
  const original = { gross_income: 850000 };

  cache.save('s1', 'acc', 'acc.tax', original);

  // Mutate original — should NOT affect cache
  original.gross_income = 0;
  const cached = cache.get('s1', 'acc');
  assertEq(cached.params.gross_income, 850000, 'cache: params are copied (not referenced)');
}

// ── 5. Contextual re-execution via SpecialistRuntime ────────────────────────
console.log('\n── 5. Contextual re-execution (real specialist) ──');

{
  // Boot real accountant specialist
  const { SpecialistRuntime } = await import('../src/expertises/specialist-runtime.js');
  const { SpecialistLoader } = await import('../src/specialists/specialist-loader.js');

  function createTestDb() {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS specialists (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        name TEXT NOT NULL,
        domain TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'domain',
        status TEXT NOT NULL DEFAULT 'installed'
          CHECK (status IN ('installed', 'enabled', 'disabled')),
        manifest_json TEXT NOT NULL,
        installed_at TEXT DEFAULT (datetime('now')),
        enabled_at TEXT,
        disabled_at TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_specialists_status ON specialists(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_specialists_domain ON specialists(domain)`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS specialist_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        specialist_id TEXT NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
        migration_name TEXT NOT NULL,
        applied_at TEXT DEFAULT (datetime('now')),
        UNIQUE(specialist_id, migration_name)
      )
    `);
    return db;
  }

  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
  });

  await loader.boot();

  if (!runtime.isSpecialist('accountant')) {
    console.error('FATAL: accountant specialist not registered after boot');
    process.exit(1);
  }

  const SESSION = 'test-session-ctx-1';

  // Turn 1: Direct tax query — should match pattern and execute
  const turn1 = await runtime.tryToolExecution('accountant', 'Kolik zaplatím daní z příjmu 850000 Kč?', { sessionId: SESSION });
  assert(turn1 !== null, 'turn1: matched');
  assert(turn1.status !== 'clarify', 'turn1: not clarify');
  assertEq(turn1.toolType, 'accountant.tax_calculator', 'turn1: correct tool');
  assert(turn1.result?.net_income > 0, 'turn1: has result');

  // Turn 2: Follow-up "A co jako s.r.o.?" — no "daň" keyword, but session context
  const turn2 = await runtime.tryToolExecution('accountant', 'A co jako s.r.o.?', { sessionId: SESSION });
  // This should contextually re-execute tax_calculator with merged params
  if (turn2 !== null && turn2.status !== 'clarify') {
    pass('turn2: contextual re-execution succeeded');
    assertEq(turn2.toolType, 'accountant.tax_calculator', 'turn2: same tool');
    // The entity_type should be 'sro' (from fresh extraction)
    assert(turn2.result?.entity_type === 'sro', 'turn2: entity_type = sro');
    // gross_income should be preserved from session
    assert(turn2.result?.gross_income > 0, 'turn2: gross_income preserved from session');
  } else if (turn2 !== null && turn2.status === 'clarify') {
    pass('turn2: contextual match found (clarify is acceptable)');
  } else {
    fail('turn2: contextual re-execution', 'expected match from session context, got null');
  }

  // Turn 3: "A za rok 2024?" — should also contextually re-execute
  const turn3 = await runtime.tryToolExecution('accountant', 'A za rok 2024?', { sessionId: SESSION });
  if (turn3 !== null && turn3.status !== 'clarify') {
    pass('turn3: year override via session context');
    assertEq(turn3.result?.year, 2024, 'turn3: year = 2024');
  } else if (turn3 !== null && turn3.status === 'clarify') {
    pass('turn3: contextual match found (clarify acceptable)');
  } else {
    fail('turn3: year override', 'expected match from session context, got null');
  }

  // Turn 4: "Díky" — no meaningful extraction, should NOT re-execute
  const turn4 = await runtime.tryToolExecution('accountant', 'Díky', { sessionId: SESSION });
  assertEq(turn4, null, 'turn4: "Díky" → null (no re-execution)');

  // Turn 5: "ok" — same, no re-execution
  const turn5 = await runtime.tryToolExecution('accountant', 'ok', { sessionId: SESSION });
  assertEq(turn5, null, 'turn5: "ok" → null (too short, < 5 chars)');

  db.close();
}

// ── 6. Backwards compatibility (no sessionId) ──────────────────────────────
console.log('\n── 6. Backwards compatibility ──');

{
  const { SpecialistRuntime } = await import('../src/expertises/specialist-runtime.js');
  const { SpecialistLoader } = await import('../src/specialists/specialist-loader.js');

  function createTestDb() {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS specialists (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        name TEXT NOT NULL,
        domain TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'domain',
        status TEXT NOT NULL DEFAULT 'installed'
          CHECK (status IN ('installed', 'enabled', 'disabled')),
        manifest_json TEXT NOT NULL,
        installed_at TEXT DEFAULT (datetime('now')),
        enabled_at TEXT,
        disabled_at TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_specialists_status ON specialists(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_specialists_domain ON specialists(domain)`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS specialist_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        specialist_id TEXT NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
        migration_name TEXT NOT NULL,
        applied_at TEXT DEFAULT (datetime('now')),
        UNIQUE(specialist_id, migration_name)
      )
    `);
    return db;
  }

  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
  });

  await loader.boot();

  // Without sessionId — works exactly as before
  const result = await runtime.tryToolExecution('accountant', 'Kolik zaplatím daní z příjmu 500000 Kč?');
  assert(result !== null, 'compat: without sessionId → still works');
  assertEq(result.toolType, 'accountant.tax_calculator', 'compat: correct tool');

  // Empty options object
  const result2 = await runtime.tryToolExecution('accountant', 'Vypočítej DPH z 10000 Kč', {});
  assert(result2 !== null, 'compat: empty options → still works');

  db.close();
}

// ── 7. Session merge priority ───────────────────────────────────────────────
console.log('\n── 7. Session merge priority ──');

{
  // Verify that fresh extraction overrides session cache
  const cache = new SessionParamCache();
  cache.save('s1', 'acc', 'acc.tax', {
    gross_income: 850000,
    entity_type: 'osvc',
    year: 2025,
  });

  const cached = cache.get('s1', 'acc');

  // Simulate merge: fresh params override cached
  const freshParams = { entity_type: 'sro' };
  const merged = { ...cached.params, ...freshParams };

  assertEq(merged.gross_income, 850000, 'merge priority: cached gross_income preserved');
  assertEq(merged.entity_type, 'sro', 'merge priority: fresh entity_type overrides cached');
  assertEq(merged.year, 2025, 'merge priority: cached year preserved');

  // Simulate merge with explicit year override
  const freshWithYear = { entity_type: 'sro', year: 2024 };
  const merged2 = { ...cached.params, ...freshWithYear };
  assertEq(merged2.year, 2024, 'merge priority: fresh year overrides cached');
  assertEq(merged2.gross_income, 850000, 'merge priority: cached income still preserved');
}

// ── 8. Cross-tool isolation (daň → DPH → year follow-up) ────────────────────
console.log('\n── 8. Cross-tool isolation ──');

{
  const { SpecialistRuntime } = await import('../src/expertises/specialist-runtime.js');
  const { SpecialistLoader } = await import('../src/specialists/specialist-loader.js');

  function createTestDb() {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS specialists (
        id TEXT PRIMARY KEY, version TEXT NOT NULL, name TEXT NOT NULL,
        domain TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'domain',
        status TEXT NOT NULL DEFAULT 'installed'
          CHECK (status IN ('installed', 'enabled', 'disabled')),
        manifest_json TEXT NOT NULL,
        installed_at TEXT DEFAULT (datetime('now')), enabled_at TEXT,
        disabled_at TEXT, updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_specialists_status ON specialists(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_specialists_domain ON specialists(domain)`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS specialist_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        specialist_id TEXT NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
        migration_name TEXT NOT NULL, applied_at TEXT DEFAULT (datetime('now')),
        UNIQUE(specialist_id, migration_name)
      )
    `);
    return db;
  }

  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
  });
  await loader.boot();

  const SESSION = 'test-cross-tool-1';

  // Turn 1: Tax query — caches tax_calculator params
  const t1 = await runtime.tryToolExecution('accountant', 'Kolik zaplatím daní z příjmu 850000 Kč?', { sessionId: SESSION });
  assert(t1 !== null, 'cross-tool: turn1 tax matched');
  assertEq(t1.toolType, 'accountant.tax_calculator', 'cross-tool: turn1 is tax');

  // Turn 2: DPH query — should match DPH, NOT re-execute tax
  const t2 = await runtime.tryToolExecution('accountant', 'Vypočítej DPH z 10000 Kč', { sessionId: SESSION });
  assert(t2 !== null, 'cross-tool: turn2 DPH matched');
  assertEq(t2.toolType, 'accountant.vat_calculator', 'cross-tool: turn2 is VAT (not tax)');

  // Turn 3: "A za rok 2024?" — cache now holds VAT tool, should contextually re-execute VAT
  const t3 = await runtime.tryToolExecution('accountant', 'A za rok 2024?', { sessionId: SESSION });
  if (t3 !== null) {
    // If it matched, it MUST be VAT (the last cached tool), NOT tax
    assertEq(t3.toolType, 'accountant.vat_calculator', 'cross-tool: turn3 year follow-up → VAT (not tax)');
  } else {
    // null is also acceptable — extractParams for VAT found year but no amount might
    // cause validation to fail. The critical thing is it didn't ghost-execute tax.
    pass('cross-tool: turn3 year follow-up → null (no ghost tax execution)');
  }

  // Verify: cache should NOT hold tax params after DPH execution
  const cached = runtime._sessionCache.get(SESSION, 'accountant');
  assert(cached !== null, 'cross-tool: cache has entry after turn2+3');
  assertEq(cached.toolId, 'accountant.vat_calculator', 'cross-tool: cache holds VAT (not tax)');
  assertEq(cached.params.gross_income, undefined, 'cross-tool: no tax params leaked into cache');

  db.close();
}

// ── 9. Cache expiration integration (TTL → fresh fallback) ──────────────────
console.log('\n── 9. Cache expiration integration ──');

{
  const { SpecialistRuntime } = await import('../src/expertises/specialist-runtime.js');
  const { SpecialistLoader } = await import('../src/specialists/specialist-loader.js');

  function createTestDb() {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS specialists (
        id TEXT PRIMARY KEY, version TEXT NOT NULL, name TEXT NOT NULL,
        domain TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'domain',
        status TEXT NOT NULL DEFAULT 'installed'
          CHECK (status IN ('installed', 'enabled', 'disabled')),
        manifest_json TEXT NOT NULL,
        installed_at TEXT DEFAULT (datetime('now')), enabled_at TEXT,
        disabled_at TEXT, updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_specialists_status ON specialists(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_specialists_domain ON specialists(domain)`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS specialist_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        specialist_id TEXT NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
        migration_name TEXT NOT NULL, applied_at TEXT DEFAULT (datetime('now')),
        UNIQUE(specialist_id, migration_name)
      )
    `);
    return db;
  }

  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  // Override session cache with very short TTL (100ms)
  runtime._sessionCache = new SessionParamCache(100);
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
  });
  await loader.boot();

  const SESSION = 'test-ttl-integration-1';

  // Turn 1: Tax query — caches params
  const t1 = await runtime.tryToolExecution('accountant', 'Kolik zaplatím daní z příjmu 850000 Kč?', { sessionId: SESSION });
  assert(t1 !== null, 'ttl-int: turn1 matched');

  // Turn 2: Immediate follow-up — should contextually re-execute
  const t2 = await runtime.tryToolExecution('accountant', 'A co jako s.r.o.?', { sessionId: SESSION });
  if (t2 !== null) {
    pass('ttl-int: turn2 immediate follow-up works');
  } else {
    fail('ttl-int: turn2 immediate follow-up', 'expected contextual match');
  }

  // Wait for TTL to expire
  await new Promise(r => setTimeout(r, 150));

  // Turn 3: Same follow-up after TTL — cache expired, should return null
  const t3 = await runtime.tryToolExecution('accountant', 'A co jako s.r.o.?', { sessionId: SESSION });
  assertEq(t3, null, 'ttl-int: turn3 after TTL expiry → null (no stale re-execution)');

  db.close();
}

// ── 10. Clarify loop guard ──────────────────────────────────────────────────
console.log('\n── 10. Clarify loop guard ──');

{
  const { SpecialistRuntime } = await import('../src/expertises/specialist-runtime.js');
  const { SpecialistLoader } = await import('../src/specialists/specialist-loader.js');

  function createTestDb() {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS specialists (
        id TEXT PRIMARY KEY, version TEXT NOT NULL, name TEXT NOT NULL,
        domain TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'domain',
        status TEXT NOT NULL DEFAULT 'installed'
          CHECK (status IN ('installed', 'enabled', 'disabled')),
        manifest_json TEXT NOT NULL,
        installed_at TEXT DEFAULT (datetime('now')), enabled_at TEXT,
        disabled_at TEXT, updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_specialists_status ON specialists(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_specialists_domain ON specialists(domain)`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS specialist_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        specialist_id TEXT NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
        migration_name TEXT NOT NULL, applied_at TEXT DEFAULT (datetime('now')),
        UNIQUE(specialist_id, migration_name)
      )
    `);
    return db;
  }

  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
  });
  await loader.boot();

  const SESSION = 'test-clarify-loop-1';

  // Turn 1: "Kdy je termín podání daňového přiznání?" — matches deadline but needs entity_type
  const t1 = await runtime.tryToolExecution('accountant', 'Kdy je termín podání daňového přiznání?', { sessionId: SESSION });
  // This returns clarify, which does NOT cache params (clarify ≠ success)
  if (t1 !== null && t1.status === 'clarify') {
    pass('clarify-loop: turn1 → clarify');
  } else if (t1 !== null) {
    pass('clarify-loop: turn1 → matched (ok too)');
  } else {
    fail('clarify-loop: turn1', 'expected clarify or match');
  }

  // Turn 2: "Nevím" — should NOT trigger contextual re-execution
  // Because clarify doesn't save to cache, there's nothing to re-execute
  const t2 = await runtime.tryToolExecution('accountant', 'Nevím co to je', { sessionId: SESSION });
  assertEq(t2, null, 'clarify-loop: "Nevím" after clarify → null (no cycle)');

  // Turn 3: "To neřeším" — same, no re-execution
  const t3 = await runtime.tryToolExecution('accountant', 'To neřeším, díky', { sessionId: SESSION });
  assertEq(t3, null, 'clarify-loop: "To neřeším" after clarify → null');

  // Turn 4: Now a successful execution — should cache
  const t4 = await runtime.tryToolExecution('accountant', 'Kolik zaplatím daní z příjmu 500000 Kč?', { sessionId: SESSION });
  assert(t4 !== null && t4.status !== 'clarify', 'clarify-loop: turn4 successful execution');

  // Turn 5: After success, follow-up should work via cache
  const t5 = await runtime.tryToolExecution('accountant', 'A co jako s.r.o.?', { sessionId: SESSION });
  if (t5 !== null) {
    pass('clarify-loop: turn5 follow-up after success works');
  } else {
    fail('clarify-loop: turn5 follow-up after success', 'expected contextual match');
  }

  db.close();
}

// ── 11. Validation false positive — low income high rate ────────────────────
console.log('\n── 11. Validation false positive — low income ──');

{
  // These tests verify that validateResult does NOT produce false negatives
  // for legitimate low-income tax calculations where minimums dominate.
  const { createAdapters } = await import('../specialists/accountant-cz/adapters.js');
  const { TaxCalculatorAdapter } = createAdapters(ToolAdapter);
  const tax = new TaxCalculatorAdapter();

  // 200k income — effective rate will be very high due to minimums
  const r200k = tax.run({ gross_income: 200000 });
  assertEq(r200k.status, 'ok', 'false-pos: 200k income → ok (not blocked)');
  assert(r200k.data?.effective_rate > 40, 'false-pos: 200k rate is legitimately high');
  assertEq(r200k.meta, undefined, 'false-pos: 200k → no warnings (income < 300k)');

  // 150k income — even higher effective rate
  const r150k = tax.run({ gross_income: 150000 });
  assertEq(r150k.status, 'ok', 'false-pos: 150k income → ok');
  assertEq(r150k.meta, undefined, 'false-pos: 150k → no warnings');

  // 100k income — ~85-95% effective rate is normal here
  const r100k = tax.run({ gross_income: 100000 });
  assertEq(r100k.status, 'ok', 'false-pos: 100k income → ok');
  assertEq(r100k.meta, undefined, 'false-pos: 100k → no warnings');

  // 50k income — extreme rate, still should pass (minimums > income almost)
  const r50k = tax.run({ gross_income: 50000 });
  assertEq(r50k.status, 'ok', 'false-pos: 50k income → ok');
  assertEq(r50k.meta, undefined, 'false-pos: 50k → no warnings');

  // Contrast: 500k income with normal rate — should also pass cleanly
  const r500k = tax.run({ gross_income: 500000 });
  assertEq(r500k.status, 'ok', 'false-pos: 500k income → ok');
  assert(r500k.data?.effective_rate < 60, 'false-pos: 500k rate is reasonable');
  assertEq(r500k.meta, undefined, 'false-pos: 500k → no warnings');

  // 1M income — should pass cleanly
  const r1m = tax.run({ gross_income: 1000000 });
  assertEq(r1m.status, 'ok', 'false-pos: 1M income → ok');
  assertEq(r1m.meta, undefined, 'false-pos: 1M → no warnings');
}

// ══════════════════════════════════════════════════════════════════════════════
// Summary
console.log(`\n${'═'.repeat(60)}`);
console.log(`Session Context Tests: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ❌ ${f.name}: ${f.msg}`);
  }
}
console.log('');

process.exit(failed > 0 ? 1 : 0);
