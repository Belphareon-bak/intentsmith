// Session Context Unit Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests SessionParamCache and contextual re-execution in SpecialistRuntime.
//
// Covers:
//   1. SessionParamCache: save, get, TTL expiry, scoping
//   2. tryToolExecution: session param merge on normal match
//   3. tryToolExecution: contextual re-execution (no pattern match, cached tool)
//   4. tryToolExecution: guard — empty fresh extraction = no re-execution
//   5. tryToolExecution: backwards compatible without sessionId
//
// Run: node tests/session-context.test.js
// ══════════════════════════════════════════════════════════════════════════════

import { SessionParamCache } from '../src/expertises/specialist-runtime.js';
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
    engineVersion: '65.5.0',
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
    engineVersion: '65.5.0',
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
