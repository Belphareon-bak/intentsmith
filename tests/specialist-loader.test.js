// Specialist Loader Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests the specialist-loader MVP: discovery, validation, install, enable, disable.
// Uses a temp DB + the real accountant-cz package.
//
// ══════════════════════════════════════════════════════════════════════════════

import './helpers/isolated-test-db.js';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Read engine version from package.json (same as specialist-loader does at runtime)
const ENGINE_VERSION = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8')).version;

// ─── Test Harness ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    failures.push(msg);
    console.log(`  ❌ ${msg}`);
  }
}

function assertEq(a, b, msg) {
  assert(a === b, `${msg} (got ${a}, expected ${b})`);
}

// ─── Setup DB ────────────────────────────────────────────────────────────────

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create the specialists tables (migration 012)
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

// ─── Mock Runtime ────────────────────────────────────────────────────────────

function createMockRuntime() {
  const registered = new Map();
  return {
    registerSpecialist(config) {
      registered.set(config.id, config);
    },
    unregisterSpecialist(id) {
      registered.delete(id);
    },
    isSpecialist(id) {
      return registered.has(id);
    },
    getSpecialistIds() {
      return [...registered.keys()];
    },
    _registered: registered,
  };
}

// ─── Import loader ───────────────────────────────────────────────────────────

const { SpecialistLoader } = await import('../src/specialists/specialist-loader.js');

// ═════════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════════

console.log('\n══ Specialist Loader Tests ══\n');

// ── 1. Discovery ─────────────────────────────────────────────────────────────

console.log('── 1. Discovery ──');
{
  const db = createTestDb();
  const runtime = createMockRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  const manifests = loader.discoverAll();
  assert(manifests.length >= 1, 'discovers at least 1 specialist');
  assert(manifests.some(m => m.id === 'accountant-cz'), 'discovers accountant-cz');

  const accountant = manifests.find(m => m.id === 'accountant-cz');
  assertEq(accountant.version, '2.0.0', 'accountant-cz version is 2.0.0');
  assertEq(accountant.domain, 'finance', 'accountant-cz domain is finance');
  assert(accountant.tools.length === 5, 'accountant-cz has 5 tools in manifest');
  assertEq(accountant.enabledByDefault, true, 'accountant-cz enabledByDefault is true');

  db.close();
}

// ── 2. Discovery with no specialists dir ─────────────────────────────────────

console.log('\n── 2. Empty specialists dir ──');
{
  const db = createTestDb();
  const runtime = createMockRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: '/tmp/nonexistent-specialists-dir',
    engineVersion: ENGINE_VERSION,
  });

  const manifests = loader.discoverAll();
  assertEq(manifests.length, 0, 'no specialists found in empty dir');
  db.close();
}

// ── 3. Engine compatibility check ────────────────────────────────────────────

console.log('\n── 3. Engine compatibility ──');
{
  const db = createTestDb();
  const runtime = createMockRuntime();

  // Too old engine
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: '10.0.0',
  });

  const manifests = loader.discoverAll();
  assertEq(manifests.length, 0, 'incompatible engine version rejects specialist');
  db.close();
}

// ── 4. InstallPending ────────────────────────────────────────────────────────

console.log('\n── 4. InstallPending ──');
{
  const db = createTestDb();
  const runtime = createMockRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  loader.discoverAll();
  loader.installPending();

  const rows = loader.getInstalled();
  assert(rows.length >= 1, 'specialist installed in DB');

  const row = rows.find(r => r.id === 'accountant-cz');
  assert(row !== undefined, 'accountant-cz row exists in DB');
  assertEq(row.version, '2.0.0', 'version stored correctly');
  assertEq(row.domain, 'finance', 'domain stored correctly');
  assertEq(row.status, 'enabled', 'status is enabled (enabledByDefault)');

  // Idempotent — run again
  loader.installPending();
  const rows2 = loader.getInstalled();
  assertEq(rows2.length, rows.length, 'installPending is idempotent');

  db.close();
}

// ── 5. EnableAll (full boot) ─────────────────────────────────────────────────

console.log('\n── 5. EnableAll ──');
{
  const db = createTestDb();
  const runtime = createMockRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  loader.discoverAll();
  loader.installPending();
  await loader.enableAll();

  assert(runtime.isSpecialist('accountant'), 'accountant registered in runtime after enable');
  assert(runtime.getSpecialistIds().length >= 1, '>= 1 specialist registered');

  const config = runtime._registered.get('accountant');
  assert(config !== undefined, 'accountant config exists');
  assertEq(config.tools.length, 5, '5 tools registered');
  assertEq(config.domain, 'finance', 'domain is finance');

  // Verify tool IDs
  const toolIds = config.tools.map(t => t.id).sort();
  assert(toolIds.includes('accountant.tax_calculator'), 'tax_calculator tool registered');
  assert(toolIds.includes('accountant.vat_calculator'), 'vat_calculator tool registered');
  assert(toolIds.includes('accountant.salary_calculator'), 'salary_calculator tool registered');
  assert(toolIds.includes('accountant.deadline_checker'), 'deadline_checker tool registered');
  assert(toolIds.includes('accountant.compare_tax_entities'), 'compare_tax_entities tool registered');

  db.close();
}

// ── 6. Full boot() convenience method ────────────────────────────────────────

console.log('\n── 6. boot() convenience ──');
{
  const db = createTestDb();
  const runtime = createMockRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  await loader.boot();

  assert(runtime.isSpecialist('accountant'), 'boot() registers accountant');
  assert(loader.getEnabled().length >= 1, '>= 1 specialist enabled after boot');

  db.close();
}

// ── 7. Disable ───────────────────────────────────────────────────────────────

console.log('\n── 7. Disable ──');
{
  const db = createTestDb();
  const runtime = createMockRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  await loader.boot();
  assert(runtime.isSpecialist('accountant'), 'accountant enabled before disable');

  await loader.disable('accountant-cz');

  assert(!runtime.isSpecialist('accountant'), 'accountant NOT in runtime after disable');
  assert(!loader.getEnabled().some(r => r.id === 'accountant-cz'), 'accountant-cz not in enabled list');

  const row = loader.getInstalled().find(r => r.id === 'accountant-cz');
  assertEq(row.status, 'disabled', 'DB status is disabled');
  assert(row.disabled_at !== null, 'disabled_at timestamp set');

  db.close();
}

// ── 8. Re-enable after disable ───────────────────────────────────────────────

console.log('\n── 8. Re-enable ──');
{
  const db = createTestDb();
  const runtime = createMockRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  await loader.boot();
  await loader.disable('accountant-cz');
  assert(!runtime.isSpecialist('accountant'), 'disabled');

  await loader.enable('accountant-cz');
  assert(runtime.isSpecialist('accountant'), 'accountant back in runtime after re-enable');
  assert(loader.getEnabled().some(r => r.id === 'accountant-cz'), 'accountant-cz in enabled list after re-enable');

  db.close();
}

// ── 9. Manifest retrieval ────────────────────────────────────────────────────

console.log('\n── 9. Manifest retrieval ──');
{
  const db = createTestDb();
  const runtime = createMockRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  await loader.boot();

  const manifest = loader.getManifest('accountant-cz');
  assert(manifest !== null, 'getManifest returns manifest');
  assertEq(manifest.id, 'accountant-cz', 'manifest id correct');
  assert(Array.isArray(manifest.tools), 'manifest has tools array');
  assert(manifest.capabilities?.length > 0, 'manifest has capabilities');

  const missing = loader.getManifest('nonexistent');
  assertEq(missing, null, 'getManifest returns null for unknown id');

  db.close();
}

// ── 10. Tool modulePath resolves correctly ───────────────────────────────────

console.log('\n── 10. Tool paths ──');
{
  const db = createTestDb();
  const runtime = createMockRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  await loader.boot();

  const config = runtime._registered.get('accountant');
  const taxTool = config.tools.find(t => t.id === 'accountant.tax_calculator');

  assert(taxTool.modulePath.includes('specialists/accountant-cz/tools/tax-calc.js'),
    'tax_calculator modulePath points to package tools dir');

  // Verify the file actually exists at that path
  assert(fs.existsSync(taxTool.modulePath), 'modulePath file exists on disk');

  db.close();
}

// ═══════════════════════════════════════════════════════════════════════════
// Runtime Isolation Tests — Real SpecialistRuntime, real tool execution
// ═══════════════════════════════════════════════════════════════════════════

const { SpecialistRuntime } = await import('../src/expertises/specialist-runtime.js');

// ── 11. Runtime isolation: enable → detect → disable → detect → re-enable ──

console.log('\n── 11. Runtime isolation: full cycle ──');
{
  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  // Phase 1: Enable
  await loader.boot();
  assert(runtime.isSpecialist('accountant'), 'P1: accountant registered');

  // Phase 2: Detect tool (tax query)
  const match1 = await runtime.tryToolExecution('accountant', 'Kolik zaplatím daní z 850000 jako OSVČ za rok 2024?');
  assert(match1 !== null, 'P2: tool detected for tax query');
  assertEq(match1.toolType, 'accountant.tax_calculator', 'P2: correct tool matched');
  assert(match1.result !== null && match1.result !== undefined, 'P2: tool returned result');

  // Phase 3: Disable
  await loader.disable('accountant-cz');
  assert(!runtime.isSpecialist('accountant'), 'P3: accountant NOT in runtime');

  // Phase 4: Try to detect tool — MUST return null
  const match2 = await runtime.tryToolExecution('accountant', 'Kolik zaplatím daní z 850000?');
  assertEq(match2, null, 'P4: tool NOT detected after disable');

  // Phase 5: Re-enable
  await loader.enable('accountant-cz');
  assert(runtime.isSpecialist('accountant'), 'P5: accountant re-registered');

  // Phase 6: Detect tool again — MUST work (specify year for supported range)
  const match3 = await runtime.tryToolExecution('accountant', 'Kolik zaplatím daní z 1000000 jako OSVČ za rok 2024?');
  assert(match3 !== null, 'P6: tool detected after re-enable');
  assertEq(match3.toolType, 'accountant.tax_calculator', 'P6: correct tool after re-enable');

  db.close();
}

// ── 12. VAT tool lifecycle ──────────────────────────────────────────────────

console.log('\n── 12. VAT tool isolation ──');
{
  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  await loader.boot();

  // VAT tool works
  const vat1 = await runtime.tryToolExecution('accountant', 'DPH z 10000 Kč');
  assert(vat1 !== null, 'VAT tool detected before disable');
  assertEq(vat1.toolType, 'accountant.vat_calculator', 'VAT tool type correct');

  // Disable
  await loader.disable('accountant-cz');
  const vat2 = await runtime.tryToolExecution('accountant', 'DPH z 10000 Kč');
  assertEq(vat2, null, 'VAT tool NOT detected after disable');

  // Re-enable
  await loader.enable('accountant-cz');
  const vat3 = await runtime.tryToolExecution('accountant', 'DPH z 10000 Kč');
  assert(vat3 !== null, 'VAT tool detected after re-enable');

  db.close();
}

// ── 13. Integrity check ──────────────────────────────────────────────────────

console.log('\n── 13. Integrity check ──');
{
  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  await loader.boot();

  // After clean boot — integrity should be OK
  const check1 = loader.checkIntegrity();
  assert(check1.ok, 'integrity OK after clean boot');
  assertEq(check1.issues.length, 0, 'no integrity issues after boot');

  // After disable — integrity should be OK (disabled = not expected in runtime)
  await loader.disable('accountant-cz');
  const check2 = loader.checkIntegrity();
  assert(check2.ok, 'integrity OK after disable');

  // After re-enable — integrity should be OK
  await loader.enable('accountant-cz');
  const check3 = loader.checkIntegrity();
  assert(check3.ok, 'integrity OK after re-enable');

  db.close();
}

// ── 14. Double enable is idempotent ──────────────────────────────────────────

console.log('\n── 14. Idempotency ──');
{
  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  await loader.boot();
  const ids1 = runtime.getSpecialistIds();
  const countAfterBoot = ids1.length;
  assert(countAfterBoot >= 1, `>= 1 specialist after boot (got ${countAfterBoot})`);

  // Boot again — should not duplicate
  await loader.boot();
  const ids2 = runtime.getSpecialistIds();
  assertEq(ids2.length, countAfterBoot, `same count after double boot`);

  // Tools should still work
  const match = await runtime.tryToolExecution('accountant', 'DPH z 5000');
  assert(match !== null, 'tool still works after double boot');

  db.close();
}

// ── 15. Disable idempotent ───────────────────────────────────────────────────

console.log('\n── 15. Double disable is noop ──');
{
  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  await loader.boot();
  await loader.disable('accountant-cz');
  assert(!runtime.isSpecialist('accountant'), 'disabled once');

  // Disable again — should be noop, no error
  await loader.disable('accountant-cz');
  assert(!runtime.isSpecialist('accountant'), 'still disabled after double disable');
  assert(!loader.getEnabled().some(r => r.id === 'accountant-cz'), 'accountant-cz not in enabled after double disable');

  db.close();
}

// ── 16. Stress test: 200× enable/disable cycle ──────────────────────────────

console.log('\n── 16. Stress test: 200 enable/disable cycles ──');
{
  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  await loader.boot();

  const heapBefore = process.memoryUsage().heapUsed;
  const CYCLES = 200;

  for (let i = 0; i < CYCLES; i++) {
    await loader.disable('accountant-cz');
    await loader.enable('accountant-cz');
  }

  // Force GC if available
  if (global.gc) global.gc();

  const heapAfter = process.memoryUsage().heapUsed;
  const heapDeltaMB = (heapAfter - heapBefore) / 1024 / 1024;

  assert(runtime.isSpecialist('accountant'), `accountant registered after ${CYCLES} cycles`);
  const specialistCount = runtime.getSpecialistIds().length;
  assert(specialistCount >= 1, `>= 1 specialist after ${CYCLES} cycles (got ${specialistCount})`);

  // Heap growth should be minimal — closures from register() are overwritten by Map.set()
  // Allow max 10MB growth for 200 cycles (very generous threshold)
  assert(heapDeltaMB < 10, `heap grew ${heapDeltaMB.toFixed(2)}MB in ${CYCLES} cycles (< 10MB OK)`);

  // Tool still works
  const match = await runtime.tryToolExecution('accountant', 'DPH z 10000 Kč');
  assert(match !== null, `tool works after ${CYCLES} cycles`);

  // Integrity OK
  const check = loader.checkIntegrity();
  assert(check.ok, `integrity OK after ${CYCLES} cycles`);

  // Registry Map — accountant still present, no duplicates from cycling
  assert(runtime.registry._specialists.has('accountant'), 'accountant in registry after stress');

  // Module cache — accountant-cz present, no duplicates from cycling
  assert(loader._modules.has('accountant-cz'), 'accountant-cz module cached after stress');

  console.log(`  ℹ️  Heap delta: ${heapDeltaMB.toFixed(2)}MB for ${CYCLES} cycles`);

  db.close();
}

// ═══════════════════════════════════════════════════════════════════════════
// Multi-Specialist Integration Tests — 2 specialists, cross-isolation
// ═══════════════════════════════════════════════════════════════════════════

// ── 17. Discovery finds both specialists ─────────────────────────────────

console.log('\n── 17. Discovery: both specialists ──');
{
  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  const manifests = loader.discoverAll();
  assert(manifests.length >= 2, `discovers >= 2 specialists (got ${manifests.length})`);
  assert(manifests.some(m => m.id === 'accountant-cz'), 'discovers accountant-cz');
  assert(manifests.some(m => m.id === 'dummy-logger'), 'discovers dummy-logger');

  const logger = manifests.find(m => m.id === 'dummy-logger');
  assertEq(logger.version, '1.0.0', 'dummy-logger version');
  assertEq(logger.domain, 'utility', 'dummy-logger domain');
  assertEq(logger.type, 'utility', 'dummy-logger type');
  assert(logger.tools.length === 1, 'dummy-logger has 1 tool');
  assert(logger.migrations.length === 1, 'dummy-logger has 1 migration');

  db.close();
}

// ── 18. Boot installs both, runs migration ───────────────────────────────

console.log('\n── 18. Boot: both specialists + migration ──');
{
  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  await loader.boot();

  // Both installed
  const installed = loader.getInstalled();
  assert(installed.length >= 2, `>= 2 specialists installed (got ${installed.length})`);
  assert(installed.some(r => r.id === 'accountant-cz'), 'accountant-cz in DB');
  assert(installed.some(r => r.id === 'dummy-logger'), 'dummy-logger in DB');

  // Both enabled
  const enabled = loader.getEnabled();
  assert(enabled.length >= 2, `>= 2 specialists enabled (got ${enabled.length})`);

  // Both in runtime
  assert(runtime.isSpecialist('accountant'), 'accountant in runtime');
  assert(runtime.isSpecialist('logger'), 'logger in runtime');
  assert(runtime.getSpecialistIds().length >= 2, `>= 2 specialists in runtime (got ${runtime.getSpecialistIds().length})`);

  // Migration ran — event_log table exists
  const tableCheck = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='event_log'"
  ).get();
  assert(tableCheck !== undefined, 'event_log table created by migration');

  // Migration tracked
  const migRows = db.prepare(
    "SELECT * FROM specialist_migrations WHERE specialist_id = 'dummy-logger'"
  ).all();
  assertEq(migRows.length, 1, 'migration tracked in specialist_migrations');
  assertEq(migRows[0].migration_name, '001_create_event_log', 'correct migration name');

  db.close();
}

// ── 19. Both tools execute independently ─────────────────────────────────

console.log('\n── 19. Both tools execute ──');
{
  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  await loader.boot();

  // Accountant tool
  const tax = await runtime.tryToolExecution('accountant', 'DPH z 10000 Kč');
  assert(tax !== null, 'accountant VAT tool works');
  assertEq(tax.toolType, 'accountant.vat_calculator', 'accountant tool type correct');

  // Logger tool
  const log = await runtime.tryToolExecution('logger', 'zaloguj warn zprávu: server restarted');
  assert(log !== null, 'logger format_entry tool works');
  assertEq(log.toolType, 'logger.format_entry', 'logger tool type correct');
  assert(log.result.formatted.includes('server restarted'), 'logger result contains message');

  db.close();
}

// ── 20. Disable one — other still works ──────────────────────────────────

console.log('\n── 20. Cross-isolation: disable accountant, logger works ──');
{
  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  await loader.boot();
  const allCount20 = runtime.getSpecialistIds().length;
  assert(allCount20 >= 2, `>= 2 registered (got ${allCount20})`);

  // Disable accountant
  await loader.disable('accountant-cz');
  assert(!runtime.isSpecialist('accountant'), 'accountant disabled');
  assert(runtime.isSpecialist('logger'), 'logger still active');
  assertEq(runtime.getSpecialistIds().length, allCount20 - 1, '1 fewer in runtime');

  // Accountant tool MUST NOT work
  const tax = await runtime.tryToolExecution('accountant', 'DPH z 10000 Kč');
  assertEq(tax, null, 'accountant tool returns null');

  // Logger tool MUST still work
  const log = await runtime.tryToolExecution('logger', 'zaloguj info zprávu: still alive');
  assert(log !== null, 'logger tool still works');
  assertEq(log.toolType, 'logger.format_entry', 'logger tool type correct');

  // Integrity check
  const check = loader.checkIntegrity();
  assert(check.ok, 'integrity OK with 1 disabled');

  db.close();
}

// ── 21. Disable logger — accountant still works ──────────────────────────

console.log('\n── 21. Cross-isolation: disable logger, accountant works ──');
{
  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  await loader.boot();

  // Disable logger
  await loader.disable('dummy-logger');
  assert(runtime.isSpecialist('accountant'), 'accountant still active');
  assert(!runtime.isSpecialist('logger'), 'logger disabled');

  // Accountant MUST work
  const tax = await runtime.tryToolExecution('accountant', 'DPH z 5000 Kč');
  assert(tax !== null, 'accountant tool still works');

  // Logger MUST NOT work
  const log = await runtime.tryToolExecution('logger', 'zaloguj warn: test');
  assertEq(log, null, 'logger tool returns null');

  db.close();
}

// ── 22. Disable both — re-enable both ────────────────────────────────────

console.log('\n── 22. Full cycle: disable both, re-enable both ──');
{
  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  await loader.boot();
  const allCount22 = runtime.getSpecialistIds().length;
  assert(allCount22 >= 2, `>= 2 active (got ${allCount22})`);

  // Disable accountant + logger
  await loader.disable('accountant-cz');
  await loader.disable('dummy-logger');
  assertEq(runtime.getSpecialistIds().length, allCount22 - 2, '2 fewer in runtime after both disabled');

  // Re-enable both
  await loader.enable('accountant-cz');
  await loader.enable('dummy-logger');
  assertEq(runtime.getSpecialistIds().length, allCount22, 'all back in runtime after re-enable');

  // Both tools work
  const tax = await runtime.tryToolExecution('accountant', 'DPH z 8000 Kč');
  assert(tax !== null, 'accountant works after re-enable');

  const log = await runtime.tryToolExecution('logger', 'zaloguj error zprávu: critical failure');
  assert(log !== null, 'logger works after re-enable');

  // Integrity
  const check = loader.checkIntegrity();
  assert(check.ok, 'integrity OK after full cycle');

  db.close();
}

// ── 23. Selective re-enable — only one ───────────────────────────────────

console.log('\n── 23. Selective: disable both, re-enable only logger ──');
{
  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  await loader.boot();
  const allCount23 = runtime.getSpecialistIds().length;
  await loader.disable('accountant-cz');
  await loader.disable('dummy-logger');

  // Re-enable only logger
  await loader.enable('dummy-logger');
  assertEq(runtime.getSpecialistIds().length, allCount23 - 1, '1 fewer than full (accountant still disabled)');
  assert(runtime.isSpecialist('logger'), 'logger active');
  assert(!runtime.isSpecialist('accountant'), 'accountant still disabled');

  // Logger works
  const log = await runtime.tryToolExecution('logger', 'format log entry: partial re-enable');
  assert(log !== null, 'logger works');

  // Accountant does not
  const tax = await runtime.tryToolExecution('accountant', 'DPH z 1000');
  assertEq(tax, null, 'accountant still disabled');

  // Integrity OK — only 1 expected
  const check = loader.checkIntegrity();
  assert(check.ok, 'integrity OK with partial re-enable');

  db.close();
}

// ── 24. Migration idempotency — second boot doesn't re-run ──────────────

console.log('\n── 24. Migration idempotency ──');
{
  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  await loader.boot();

  const migCount1 = db.prepare(
    "SELECT COUNT(*) as cnt FROM specialist_migrations WHERE specialist_id = 'dummy-logger'"
  ).get().cnt;
  assertEq(migCount1, 1, '1 migration after first boot');

  // Second boot — same instance, should be noop
  await loader.boot();

  const migCount2 = db.prepare(
    "SELECT COUNT(*) as cnt FROM specialist_migrations WHERE specialist_id = 'dummy-logger'"
  ).get().cnt;
  assertEq(migCount2, 1, 'still 1 migration after second boot');

  db.close();
}

// ── 25. Cross-contamination stress: alternating enable/disable ───────────

console.log('\n── 25. Cross-contamination stress: 50 alternating cycles ──');
{
  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  await loader.boot();

  for (let i = 0; i < 50; i++) {
    // Alternate which one gets toggled
    if (i % 2 === 0) {
      await loader.disable('accountant-cz');
      assert(runtime.isSpecialist('logger'), `cycle ${i}: logger survives accountant disable`);
      await loader.enable('accountant-cz');
    } else {
      await loader.disable('dummy-logger');
      assert(runtime.isSpecialist('accountant'), `cycle ${i}: accountant survives logger disable`);
      await loader.enable('dummy-logger');
    }
  }

  // Both should be active after 50 cycles
  assert(runtime.getSpecialistIds().length >= 2, `>= 2 active after 50 alternating cycles (got ${runtime.getSpecialistIds().length})`);

  // Both tools work
  const tax = await runtime.tryToolExecution('accountant', 'DPH z 10000 Kč');
  assert(tax !== null, 'accountant works after alternating stress');

  const log = await runtime.tryToolExecution('logger', 'zaloguj info zprávu: stress test done');
  assert(log !== null, 'logger works after alternating stress');

  // Integrity
  const check = loader.checkIntegrity();
  assert(check.ok, 'integrity OK after alternating stress');

  // No ghosts — all specialists still registered
  assert(runtime.registry._specialists.size >= 2, `>= 2 entries in registry (got ${runtime.registry._specialists.size})`);

  db.close();
}

// ── 26. Manifest data isolation ──────────────────────────────────────────

console.log('\n── 26. Manifest data isolation ──');
{
  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });

  await loader.boot();

  const accManifest = loader.getManifest('accountant-cz');
  const logManifest = loader.getManifest('dummy-logger');

  assert(accManifest !== null, 'accountant manifest exists');
  assert(logManifest !== null, 'logger manifest exists');
  assertEq(accManifest.domain, 'finance', 'accountant domain = finance');
  assertEq(logManifest.domain, 'utility', 'logger domain = utility');
  assertEq(accManifest.tools.length, 5, 'accountant has 5 tools in manifest');
  assertEq(logManifest.tools.length, 1, 'logger has 1 tool in manifest');

  // Disable one — manifest still accessible (DB data persists)
  await loader.disable('dummy-logger');
  const logManifest2 = loader.getManifest('dummy-logger');
  assert(logManifest2 !== null, 'disabled specialist manifest still accessible');
  assertEq(logManifest2.id, 'dummy-logger', 'disabled manifest id correct');

  db.close();
}

// ═══════════════════════════════════════════════════════════════════════════
// Update Flow Tests — Version upgrade with ESM cache busting
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Write a minimal specialist package to a temp directory.
 * Tool returns a configurable value — used to verify cache busting works.
 */
function writeTempSpecialist(baseDir, name, version, outputValue, migrations = []) {
  const dir = path.join(baseDir, name);
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  if (migrations.length) {
    fs.mkdirSync(path.join(dir, 'migrations'), { recursive: true });
  }

  fs.writeFileSync(path.join(dir, 'specialist.json'), JSON.stringify({
    id: name,
    version,
    name: `Test ${name}`,
    domain: 'test',
    type: 'utility',
    engine: '>=65.0.0',
    entry: './index.js',
    tools: [{ id: `${name}.echo`, name: 'Echo', module: './tools/echo.js', function: 'echo' }],
    expertises: [name],
    knowledge_packs: [],
    migrations,
    enabledByDefault: true,
  }));

  fs.writeFileSync(path.join(dir, 'tools', 'echo.js'),
`export function echo(params) {
  return { success: true, result: { value: '${outputValue}', version: '${version}' } };
}
`);

  fs.writeFileSync(path.join(dir, 'index.js'),
`import { fileURLToPath } from 'url';
import path from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function register(ctx) {
  ctx.runtime.registerSpecialist({
    id: '${name}',
    domain: 'test',
    tools: [{
      id: '${name}.echo',
      name: 'Echo',
      description: 'Echo test tool',
      modulePath: path.join(__dirname, 'tools', 'echo.js'),
      functionName: 'echo',
      patterns: [{ priority: 5, patterns: [/echo .+/i] }],
      extractParams: (input) => ({ message: input }),
    }],
  });
}

export function unregister(ctx) {
  ctx.runtime.unregisterSpecialist('${name}');
}
`);

  return dir;
}

function writeMigrationFile(baseDir, name, migrationName, sql) {
  const dir = path.join(baseDir, name, 'migrations');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${migrationName}.js`),
`export function up(db) {
  db.exec(\`${sql}\`);
}
export function down(db) {}
`);
}

// ── 27. Basic update: v1 → v1.0.1, tool returns new value ───────────────

console.log('\n── 27. Update: v1.0.0 → v1.0.1 with cache bust ──');
{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-update-'));

  try {
    const db = createTestDb();
    const runtime = new SpecialistRuntime();

    // Write v1
    writeTempSpecialist(tempDir, 'updatable', '1.0.0', 'v1-output');

    const loader = new SpecialistLoader(db, runtime, {
      baseDir: tempDir,
      engineVersion: ENGINE_VERSION,
    });

    // Boot with v1
    await loader.boot();
    assert(runtime.isSpecialist('updatable'), 'v1 registered');

    // Execute tool — should return v1 output
    const r1 = await runtime.tryToolExecution('updatable', 'echo hello world');
    assert(r1 !== null, 'v1 tool executes');
    assertEq(r1.result.value, 'v1-output', 'v1 returns v1-output');
    assertEq(r1.result.version, '1.0.0', 'v1 reports version 1.0.0');

    // Overwrite with v2
    writeTempSpecialist(tempDir, 'updatable', '1.0.1', 'v2-output');

    // Re-discover + update
    loader.discoverAll();
    const result = await loader.update('updatable');

    assert(result !== null, 'update returned result');
    assertEq(result.oldVersion, '1.0.0', 'update old version');
    assertEq(result.newVersion, '1.0.1', 'update new version');
    assertEq(result.wasEnabled, true, 'update wasEnabled');

    // Execute tool — MUST return v2 output (cache bust verification)
    const r2 = await runtime.tryToolExecution('updatable', 'echo hello again');
    assert(r2 !== null, 'v2 tool executes');
    assertEq(r2.result.value, 'v2-output', 'v2 returns v2-output (CACHE BUSTED)');
    assertEq(r2.result.version, '1.0.1', 'v2 reports version 1.0.1');

    // DB version updated
    const row = loader.getInstalled().find(r => r.id === 'updatable');
    assertEq(row.version, '1.0.1', 'DB version is 1.0.1');
    assertEq(row.status, 'enabled', 'still enabled after update');

    // Integrity
    const check = loader.checkIntegrity();
    assert(check.ok, 'integrity OK after update');

    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ── 28. Update with new migration ─────────────────────────────────────────

console.log('\n── 28. Update with migration ──');
{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-update-'));

  try {
    const db = createTestDb();
    const runtime = new SpecialistRuntime();

    // Write v1 (no migrations)
    writeTempSpecialist(tempDir, 'migtest', '1.0.0', 'v1');

    const loader = new SpecialistLoader(db, runtime, {
      baseDir: tempDir,
      engineVersion: ENGINE_VERSION,
    });

    await loader.boot();
    assert(runtime.isSpecialist('migtest'), 'v1 registered');

    // Overwrite with v1.1.0 + migration
    writeTempSpecialist(tempDir, 'migtest', '1.1.0', 'v2', ['001_add_table']);
    writeMigrationFile(tempDir, 'migtest', '001_add_table',
      "CREATE TABLE IF NOT EXISTS migtest_data (id INTEGER PRIMARY KEY, value TEXT)");

    loader.discoverAll();
    const result = await loader.update('migtest');

    assert(result !== null, 'update returned result');
    assertEq(result.newVersion, '1.1.0', 'updated to 1.1.0');

    // Migration ran
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='migtest_data'"
    ).get();
    assert(table !== undefined, 'migration created migtest_data table');

    // Migration tracked
    const migRows = db.prepare(
      "SELECT * FROM specialist_migrations WHERE specialist_id = 'migtest'"
    ).all();
    assertEq(migRows.length, 1, 'migration tracked');

    // Tool returns v2
    const r2 = await runtime.tryToolExecution('migtest', 'echo test');
    assert(r2 !== null, 'v2 tool works');
    assertEq(r2.result.value, 'v2', 'v2 output after migration update');

    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ── 29. Update when disabled — updates DB, does NOT re-enable ────────────

console.log('\n── 29. Update when disabled ──');
{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-update-'));

  try {
    const db = createTestDb();
    const runtime = new SpecialistRuntime();

    writeTempSpecialist(tempDir, 'disupd', '1.0.0', 'v1');

    const loader = new SpecialistLoader(db, runtime, {
      baseDir: tempDir,
      engineVersion: ENGINE_VERSION,
    });

    await loader.boot();
    await loader.disable('disupd');
    assert(!runtime.isSpecialist('disupd'), 'disabled before update');

    // Overwrite with v2
    writeTempSpecialist(tempDir, 'disupd', '2.0.0', 'v2');

    loader.discoverAll();
    const result = await loader.update('disupd');

    assert(result !== null, 'update returned result');
    assertEq(result.wasEnabled, false, 'wasEnabled = false');

    // Still disabled — NOT re-enabled
    assert(!runtime.isSpecialist('disupd'), 'still disabled after update');
    const row = loader.getInstalled().find(r => r.id === 'disupd');
    assertEq(row.status, 'disabled', 'DB status still disabled');
    assertEq(row.version, '2.0.0', 'DB version updated to 2.0.0');

    // Manually enable — should get v2 code
    await loader.enable('disupd');
    const r2 = await runtime.tryToolExecution('disupd', 'echo test');
    assert(r2 !== null, 'v2 tool works after manual enable');
    assertEq(r2.result.value, 'v2', 'v2 output after enable');

    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ── 30. Update one specialist, other unaffected ──────────────────────────

console.log('\n── 30. Update one, other unaffected ──');
{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-update-'));

  try {
    const db = createTestDb();
    const runtime = new SpecialistRuntime();

    // Two specialists
    writeTempSpecialist(tempDir, 'alpha', '1.0.0', 'alpha-v1');
    writeTempSpecialist(tempDir, 'beta', '1.0.0', 'beta-v1');

    const loader = new SpecialistLoader(db, runtime, {
      baseDir: tempDir,
      engineVersion: ENGINE_VERSION,
    });

    await loader.boot();
    assert(runtime.getSpecialistIds().length >= 2, `>= 2 registered (got ${runtime.getSpecialistIds().length})`);

    // Update only alpha to v2
    writeTempSpecialist(tempDir, 'alpha', '1.1.0', 'alpha-v2');

    loader.discoverAll();
    await loader.update('alpha');

    // Alpha is v2
    const ra = await runtime.tryToolExecution('alpha', 'echo test');
    assert(ra !== null, 'alpha tool works');
    assertEq(ra.result.value, 'alpha-v2', 'alpha returns v2');

    // Beta unchanged
    const rb = await runtime.tryToolExecution('beta', 'echo test');
    assert(rb !== null, 'beta tool works');
    assertEq(rb.result.value, 'beta-v1', 'beta still returns v1');

    // Integrity
    const check = loader.checkIntegrity();
    assert(check.ok, 'integrity OK');

    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ── 31. Same version — update is noop ────────────────────────────────────

console.log('\n── 31. Same version = noop ──');
{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-update-'));

  try {
    const db = createTestDb();
    const runtime = new SpecialistRuntime();

    writeTempSpecialist(tempDir, 'noop', '1.0.0', 'v1');

    const loader = new SpecialistLoader(db, runtime, {
      baseDir: tempDir,
      engineVersion: ENGINE_VERSION,
    });

    await loader.boot();

    loader.discoverAll();
    const result = await loader.update('noop');
    assertEq(result, null, 'same version returns null (noop)');

    // Tool still works
    const r = await runtime.tryToolExecution('noop', 'echo test');
    assert(r !== null, 'tool still works after noop update');
    assertEq(r.result.value, 'v1', 'still v1');

    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ── 32. Downgrade rejected ───────────────────────────────────────────────

console.log('\n── 32. Downgrade rejected ──');
{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-update-'));

  try {
    const db = createTestDb();
    const runtime = new SpecialistRuntime();

    writeTempSpecialist(tempDir, 'nodown', '2.0.0', 'v2');

    const loader = new SpecialistLoader(db, runtime, {
      baseDir: tempDir,
      engineVersion: ENGINE_VERSION,
    });

    await loader.boot();

    // Execute tool to prime the module cache with v2
    const r1 = await runtime.tryToolExecution('nodown', 'echo prime cache');
    assertEq(r1.result.value, 'v2', 'v2 tool works before downgrade attempt');

    // Overwrite with older version
    writeTempSpecialist(tempDir, 'nodown', '1.0.0', 'v1');

    loader.discoverAll();
    const result = await loader.update('nodown');
    assertEq(result, null, 'downgrade returns null');

    // Still v2 — update was rejected, cache intact
    const r2 = await runtime.tryToolExecution('nodown', 'echo test');
    assertEq(r2.result.value, 'v2', 'still running v2 (cache intact)');

    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ── 33. Major version update ─────────────────────────────────────────────

console.log('\n── 33. Major version update ──');
{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-update-'));

  try {
    const db = createTestDb();
    const runtime = new SpecialistRuntime();

    writeTempSpecialist(tempDir, 'major', '1.0.0', 'v1');

    const loader = new SpecialistLoader(db, runtime, {
      baseDir: tempDir,
      engineVersion: ENGINE_VERSION,
    });

    await loader.boot();

    writeTempSpecialist(tempDir, 'major', '3.0.0', 'v3');

    loader.discoverAll();
    const result = await loader.update('major');

    assert(result !== null, 'major update succeeds');
    assertEq(result.oldVersion, '1.0.0', 'old = 1.0.0');
    assertEq(result.newVersion, '3.0.0', 'new = 3.0.0');

    const r = await runtime.tryToolExecution('major', 'echo test');
    assertEq(r.result.value, 'v3', 'running v3 after major update');

    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ── 34. Update + disable + re-enable — cache bust persists ───────────────

console.log('\n── 34. Update → disable → re-enable: still new code ──');
{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-update-'));

  try {
    const db = createTestDb();
    const runtime = new SpecialistRuntime();

    writeTempSpecialist(tempDir, 'persist', '1.0.0', 'old');

    const loader = new SpecialistLoader(db, runtime, {
      baseDir: tempDir,
      engineVersion: ENGINE_VERSION,
    });

    await loader.boot();

    // Update to v2
    writeTempSpecialist(tempDir, 'persist', '1.1.0', 'new');
    loader.discoverAll();
    await loader.update('persist');

    const r1 = await runtime.tryToolExecution('persist', 'echo test');
    assertEq(r1.result.value, 'new', 'new after update');

    // Disable
    await loader.disable('persist');
    assert(!runtime.isSpecialist('persist'), 'disabled');

    // Re-enable — should still be new code, not old
    await loader.enable('persist');
    const r2 = await runtime.tryToolExecution('persist', 'echo test');
    assert(r2 !== null, 'tool works after re-enable');
    assertEq(r2.result.value, 'new', 'still new after disable+re-enable');

    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ── 35. isSpecialistBusy guard ───────────────────────────────────────────

console.log('\n── 35. isSpecialistBusy ──');
{
  const runtime = new SpecialistRuntime();
  assert(!runtime.isSpecialistBusy('accountant'), 'not busy by default');

  // Simulate busy state
  runtime._executingCount.set('accountant', 1);
  assert(runtime.isSpecialistBusy('accountant'), 'busy when counter > 0');

  runtime._executingCount.delete('accountant');
  assert(!runtime.isSpecialistBusy('accountant'), 'not busy after clear');
}

// ═══════════════════════════════════════════════════════════════════════════
// Rollback-Ready Update Tests — DB commit after re-enable, migration rollback
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Write a migration file with both up() and down() for rollback testing.
 */
function writeReversibleMigration(baseDir, name, migrationName, upSql, downSql) {
  const dir = path.join(baseDir, name, 'migrations');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${migrationName}.js`),
`export function up(db) {
  db.exec(\`${upSql}\`);
}
export function down(db) {
  db.exec(\`${downSql}\`);
}
`);
}

/**
 * Write a migration file with only up() — no down() — irreversible.
 */
function writeIrreversibleMigration(baseDir, name, migrationName, sql) {
  const dir = path.join(baseDir, name, 'migrations');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${migrationName}.js`),
`export function up(db) {
  db.exec(\`${sql}\`);
}
`);
}

/**
 * Write a specialist whose index.js register() throws on enable.
 * Used to simulate re-enable failure after migration.
 */
function writeBrokenSpecialist(baseDir, name, version, migrations = []) {
  const dir = path.join(baseDir, name);
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  if (migrations.length) {
    fs.mkdirSync(path.join(dir, 'migrations'), { recursive: true });
  }

  fs.writeFileSync(path.join(dir, 'specialist.json'), JSON.stringify({
    id: name,
    version,
    name: `Broken ${name}`,
    domain: 'test',
    type: 'utility',
    engine: '>=65.0.0',
    entry: './index.js',
    tools: [{ id: `${name}.echo`, name: 'Echo', module: './tools/echo.js', function: 'echo' }],
    expertises: [name],
    knowledge_packs: [],
    migrations,
    enabledByDefault: true,
  }));

  fs.writeFileSync(path.join(dir, 'tools', 'echo.js'),
`export function echo(params) {
  return { success: true, result: { value: 'broken' } };
}
`);

  // index.js that throws on register — simulates broken v2
  fs.writeFileSync(path.join(dir, 'index.js'),
`export function register(ctx) {
  throw new Error('SIMULATED_REGISTER_FAILURE');
}
export function unregister(ctx) {}
`);

  return dir;
}

// ── 36. Update returns reversible=true when migrations have down() ────────

console.log('\n── 36. Reversibility check: migrations with down() ──');
{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-rollback-'));

  try {
    const db = createTestDb();
    const runtime = new SpecialistRuntime();

    writeTempSpecialist(tempDir, 'revcheck', '1.0.0', 'v1');

    const loader = new SpecialistLoader(db, runtime, {
      baseDir: tempDir,
      engineVersion: ENGINE_VERSION,
    });

    await loader.boot();

    // Update with reversible migration
    writeTempSpecialist(tempDir, 'revcheck', '1.1.0', 'v2', ['001_add_data']);
    writeReversibleMigration(tempDir, 'revcheck', '001_add_data',
      "CREATE TABLE IF NOT EXISTS revcheck_data (id INTEGER PRIMARY KEY, val TEXT)",
      "DROP TABLE IF EXISTS revcheck_data");

    loader.discoverAll();
    const result = await loader.update('revcheck');

    assert(result !== null, 'update succeeded');
    assertEq(result.reversible, true, 'reversible = true when down() exists');
    assertEq(result.newVersion, '1.1.0', 'updated to 1.1.0');

    // Table exists
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='revcheck_data'"
    ).get();
    assert(table !== undefined, 'migration table created');

    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ── 37. Update returns reversible=false when migration lacks down() ───────

console.log('\n── 37. Reversibility check: migration without down() ──');
{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-rollback-'));

  try {
    const db = createTestDb();
    const runtime = new SpecialistRuntime();

    writeTempSpecialist(tempDir, 'irrev', '1.0.0', 'v1');

    const loader = new SpecialistLoader(db, runtime, {
      baseDir: tempDir,
      engineVersion: ENGINE_VERSION,
    });

    await loader.boot();

    // Update with irreversible migration
    writeTempSpecialist(tempDir, 'irrev', '1.1.0', 'v2', ['001_no_down']);
    writeIrreversibleMigration(tempDir, 'irrev', '001_no_down',
      "CREATE TABLE IF NOT EXISTS irrev_data (id INTEGER PRIMARY KEY)");

    loader.discoverAll();
    const result = await loader.update('irrev');

    assert(result !== null, 'update succeeded');
    assertEq(result.reversible, false, 'reversible = false when no down()');

    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ── 38. Re-enable failure: reversible migration gets rolled back ──────────

console.log('\n── 38. Re-enable failure: migration rollback ──');
{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-rollback-'));

  try {
    const db = createTestDb();
    const runtime = new SpecialistRuntime();

    // Boot with working v1
    writeTempSpecialist(tempDir, 'failover', '1.0.0', 'v1-ok');

    const loader = new SpecialistLoader(db, runtime, {
      baseDir: tempDir,
      engineVersion: ENGINE_VERSION,
    });

    await loader.boot();
    assert(runtime.isSpecialist('failover'), 'v1 registered');

    const r1 = await runtime.tryToolExecution('failover', 'echo test');
    assertEq(r1.result.value, 'v1-ok', 'v1 tool works');

    // Prepare broken v2 with reversible migration
    writeBrokenSpecialist(tempDir, 'failover', '2.0.0', ['001_add_fail_table']);
    writeReversibleMigration(tempDir, 'failover', '001_add_fail_table',
      "CREATE TABLE IF NOT EXISTS fail_table (id INTEGER PRIMARY KEY, data TEXT)",
      "DROP TABLE IF EXISTS fail_table");

    loader.discoverAll();

    // Update should throw because register() fails
    let updateError = null;
    try {
      await loader.update('failover');
    } catch (err) {
      updateError = err;
    }

    assert(updateError !== null, 'update threw error');
    assert(updateError.message.includes('re-enable failed'), 'error mentions re-enable failure');
    assert(updateError.message.includes('Migrations rolled back'), 'error mentions rollback');

    // Migration should have been rolled back — table should NOT exist
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='fail_table'"
    ).get();
    assertEq(table, undefined, 'fail_table rolled back (does not exist)');

    // Migration tracking should be cleaned up
    const migRows = db.prepare(
      "SELECT * FROM specialist_migrations WHERE specialist_id = 'failover' AND migration_name = '001_add_fail_table'"
    ).all();
    assertEq(migRows.length, 0, 'rollback removed migration from tracking');

    // DB state: specialist should be disabled, version still v1
    const row = loader.getInstalled().find(r => r.id === 'failover');
    assertEq(row.status, 'disabled', 'specialist disabled after failed update');
    assertEq(row.version, '1.0.0', 'DB version still 1.0.0 (not committed)');

    // Specialist should NOT be in runtime
    assert(!runtime.isSpecialist('failover'), 'specialist not in runtime after failed update');

    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ── 39. Re-enable failure: irreversible migration NOT rolled back ─────────

console.log('\n── 39. Re-enable failure: irreversible migration stays ──');
{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-rollback-'));

  try {
    const db = createTestDb();
    const runtime = new SpecialistRuntime();

    writeTempSpecialist(tempDir, 'failirr', '1.0.0', 'v1-ok');

    const loader = new SpecialistLoader(db, runtime, {
      baseDir: tempDir,
      engineVersion: ENGINE_VERSION,
    });

    await loader.boot();

    // Broken v2 with irreversible migration
    writeBrokenSpecialist(tempDir, 'failirr', '2.0.0', ['001_irrev_table']);
    writeIrreversibleMigration(tempDir, 'failirr', '001_irrev_table',
      "CREATE TABLE IF NOT EXISTS irrev_table (id INTEGER PRIMARY KEY)");

    loader.discoverAll();

    let updateError = null;
    try {
      await loader.update('failirr');
    } catch (err) {
      updateError = err;
    }

    assert(updateError !== null, 'update threw error');
    assert(updateError.message.includes('NOT rolled back'), 'error mentions NOT rolled back');

    // Migration table SHOULD still exist (irreversible — not rolled back)
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='irrev_table'"
    ).get();
    assert(table !== undefined, 'irrev_table still exists (not rolled back)');

    // DB version still v1 (not committed)
    const row = loader.getInstalled().find(r => r.id === 'failirr');
    assertEq(row.version, '1.0.0', 'DB version still 1.0.0');
    assertEq(row.status, 'disabled', 'status is disabled');

    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ── 40. DB version committed ONLY after successful re-enable ──────────────

console.log('\n── 40. DB version committed after re-enable, not before ──');
{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-rollback-'));

  try {
    const db = createTestDb();
    const runtime = new SpecialistRuntime();

    writeTempSpecialist(tempDir, 'dborder', '1.0.0', 'v1');

    const loader = new SpecialistLoader(db, runtime, {
      baseDir: tempDir,
      engineVersion: ENGINE_VERSION,
    });

    await loader.boot();

    // Successful update to v2
    writeTempSpecialist(tempDir, 'dborder', '2.0.0', 'v2');
    loader.discoverAll();
    const result = await loader.update('dborder');

    assert(result !== null, 'update succeeded');
    assertEq(result.newVersion, '2.0.0', 'updated to 2.0.0');

    // DB version is 2.0.0 — committed after re-enable
    const row = loader.getInstalled().find(r => r.id === 'dborder');
    assertEq(row.version, '2.0.0', 'DB version is 2.0.0 after successful update');
    assertEq(row.status, 'enabled', 'status is enabled');

    // Tool returns v2 — re-enable happened before DB commit
    const r2 = await runtime.tryToolExecution('dborder', 'echo test');
    assertEq(r2.result.value, 'v2', 'tool returns v2');

    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ── 41. Recovery after failed update: can re-enable old v1 ────────────────

console.log('\n── 41. Recovery: re-enable old code after failed update ──');
{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-rollback-'));

  try {
    const db = createTestDb();
    const runtime = new SpecialistRuntime();

    // Boot with v1
    writeTempSpecialist(tempDir, 'recover', '1.0.0', 'v1-working');

    const loader = new SpecialistLoader(db, runtime, {
      baseDir: tempDir,
      engineVersion: ENGINE_VERSION,
    });

    await loader.boot();
    const r1 = await runtime.tryToolExecution('recover', 'echo test');
    assertEq(r1.result.value, 'v1-working', 'v1 works');

    // Write broken v2
    writeBrokenSpecialist(tempDir, 'recover', '2.0.0', ['001_temp']);
    writeReversibleMigration(tempDir, 'recover', '001_temp',
      "CREATE TABLE IF NOT EXISTS recover_temp (id INTEGER PRIMARY KEY)",
      "DROP TABLE IF EXISTS recover_temp");

    loader.discoverAll();

    let err = null;
    try { await loader.update('recover'); } catch (e) { err = e; }
    assert(err !== null, 'update failed as expected');

    // Specialist is now disabled, version still v1
    const row = loader.getInstalled().find(r => r.id === 'recover');
    assertEq(row.version, '1.0.0', 'version still 1.0.0');
    assertEq(row.status, 'disabled', 'status is disabled');

    // Restore working v1 files
    writeTempSpecialist(tempDir, 'recover', '1.0.0', 'v1-working');
    loader.discoverAll();

    // Re-enable should work — load the old (restored) code
    await loader.enable('recover');
    assert(runtime.isSpecialist('recover'), 'recovered: back in runtime');

    const r2 = await runtime.tryToolExecution('recover', 'echo test');
    assert(r2 !== null, 'recovered: tool works');

    // Integrity OK
    const check = loader.checkIntegrity();
    assert(check.ok, 'integrity OK after recovery');

    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// ═════════════════════════════════════════════════════════════════════════════

function writePreflightFixture(baseDir, name, {
  enabledByDefault = true,
  entrySource = null,
  extraFiles = {},
} = {}) {
  const dir = path.join(baseDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'specialist.json'), JSON.stringify({
    id: name,
    version: '1.0.0',
    name: `Preflight ${name}`,
    domain: 'test',
    type: 'utility',
    engine: '>=65.0.0',
    entry: './index.js',
    tools: [],
    expertises: [name],
    knowledge_packs: [],
    migrations: [],
    enabledByDefault,
  }));
  fs.writeFileSync(path.join(dir, 'index.js'), entrySource || `
export function register(ctx) {
  ctx.runtime.registerSpecialist({ id: '${name}', domain: 'test', tools: [] });
}
export function unregister(ctx) {
  ctx.runtime.unregisterSpecialist('${name}');
}
`);
  for (const [relativePath, contents] of Object.entries(extraFiles)) {
    const target = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  return dir;
}

function discoverPreflightFixture(baseDir, options = {}) {
  const db = createTestDb();
  const runtime = createMockRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir,
    engineVersion: ENGINE_VERSION,
    ...options,
  });
  let error = null;
  let manifests = null;
  try {
    manifests = loader.discoverAll();
  } catch (caught) {
    error = caught;
  }
  return { db, error, loader, manifests, runtime };
}

function computedPreflightSource({
  anchor = "path.join(__dirname, 'tools')",
  target = 'tool.modulePath',
} = {}) {
  return `
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function buildToolDefinitions(toolsDir) {
  return [{ modulePath: path.join(toolsDir, 'tool.js') }];
}
export async function register(input) {
  const toolsDir = ${anchor};
  const tools = buildToolDefinitions(toolsDir);
  for (const tool of tools) {
    await import(${target});
  }
}
`;
}

console.log('\n── 42. Strict package preflight ──');

{
  const db = createTestDb();
  const loader = new SpecialistLoader(db, createMockRuntime(), {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: ENGINE_VERSION,
  });
  const manifests = loader.discoverAll();
  assert(
    manifests.some(({ id }) => id === 'accountant-cz'),
    'computed-package-local proof accepts current accountant',
  );
  assert(
    manifests.some(({ id }) => id === 'code-reviewer'),
    'computed-package-local proof accepts current code-reviewer',
  );
  db.close();
}

const referenceVariants = [
  ['static-js', 'lib/deep.js', "import '../../src/core.js';\n"],
  ['dynamic-mjs', 'lib/deep.mjs', "await import('../../src/core.js');\n"],
  ['require-cjs', 'lib/deep.cjs', "require('../../src/core.cjs');\n"],
  ['reexport-js', 'lib/reexport.js', "export * from '../../src/core.js';\n"],
  [
    'jsdoc-js',
    'lib/types.js',
    "/** @type {import('../../src/core.js').Core} */\nexport const value = null;\n",
  ],
];
for (const [name, relativePath, source] of referenceVariants) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-preflight-ref-'));
  try {
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'src', 'core.js'), 'export const core = true;\n');
    fs.writeFileSync(path.join(tempDir, 'src', 'core.cjs'), 'module.exports = {};\n');
    writePreflightFixture(tempDir, name, { extraFiles: { [relativePath]: source } });
    const result = discoverPreflightFixture(tempDir);
    assertEq(
      result.error?.code,
      'SPECIALIST_PATH_ESCAPE',
      `${name} reference outside package fails closed`,
    );
    result.db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-preflight-effect-'));
  const marker = path.join(tempDir, 'entry-executed');
  try {
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'src', 'core.js'), 'export const core = true;\n');
    writePreflightFixture(tempDir, 'effect-blocked', {
      entrySource: `
import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(marker)}, 'executed');
export function register() {}
`,
      extraFiles: { 'nested/violation.js': "import '../../src/core.js';\n" },
    });
    const result = discoverPreflightFixture(tempDir);
    assertEq(result.error?.code, 'SPECIALIST_PATH_ESCAPE', 'nested violation rejects package');
    assert(!fs.existsSync(marker), 'nested violation blocks entry top-level side effect');
    result.db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const treeFailures = [
  ['parse-failure', 'lib/bad.js', 'export const = ;\n', null, 'SPECIALIST_SOURCE_PARSE_FAILED'],
  [
    'decode-failure',
    'lib/bad.mjs',
    Buffer.from([0xff]),
    null,
    'SPECIALIST_SOURCE_DECODE_FAILED',
  ],
  [
    'typescript',
    'lib/bad.ts',
    'export const bad = true;\n',
    null,
    'SPECIALIST_UNKNOWN_EXECUTABLE_EXTENSION',
  ],
  [
    'executable-text',
    'lib/run.txt',
    '#!/bin/sh\nexit 0\n',
    0o755,
    'SPECIALIST_UNKNOWN_EXECUTABLE_EXTENSION',
  ],
  [
    'unreadable',
    'lib/private.cjs',
    'module.exports = {};\n',
    0o000,
    'SPECIALIST_TREE_READ_FAILED',
  ],
];
for (const [name, relativePath, source, mode, expectedCode] of treeFailures) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-preflight-tree-'));
  try {
    const packageDir = writePreflightFixture(tempDir, name, {
      extraFiles: { [relativePath]: source },
    });
    if (mode !== null) fs.chmodSync(path.join(packageDir, relativePath), mode);
    const result = discoverPreflightFixture(tempDir);
    assertEq(result.error?.code, expectedCode, `${name} fails closed`);
    result.db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-preflight-link-'));
  try {
    const packageDir = writePreflightFixture(tempDir, 'link-escape');
    const external = path.join(tempDir, 'external.js');
    fs.writeFileSync(external, 'export const external = true;\n');
    fs.mkdirSync(path.join(packageDir, 'nested'), { recursive: true });
    fs.symlinkSync(external, path.join(packageDir, 'nested', 'escape.js'));
    const result = discoverPreflightFixture(tempDir);
    assertEq(
      result.error?.code,
      'SPECIALIST_UNSAFE_TREE_ENTRY',
      'symlinked package source fails closed',
    );
    result.db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-preflight-computed-'));
  try {
    writePreflightFixture(tempDir, 'computed-safe', {
      entrySource: computedPreflightSource(),
      extraFiles: { 'tools/tool.js': 'export const safe = true;\n' },
    });
    const result = discoverPreflightFixture(tempDir);
    assertEq(result.error, null, 'exact computed-package-local fixture passes');
    assertEq(result.manifests?.length, 1, 'safe computed fixture is discovered');
    result.db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

for (const [name, source] of [
  ['computed-anchor', computedPreflightSource({ anchor: "path.resolve(__dirname, 'tools')" })],
  ['computed-input', computedPreflightSource({ target: 'input.modulePath' })],
]) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-preflight-computed-bad-'));
  try {
    writePreflightFixture(tempDir, name, {
      entrySource: source,
      extraFiles: { 'tools/tool.js': 'export const unsafe = true;\n' },
    });
    const result = discoverPreflightFixture(tempDir);
    assertEq(
      result.error?.code,
      'SPECIALIST_UNPROVEN_COMPUTED_IMPORT',
      `${name} fails closed`,
    );
    result.db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-preflight-computed-link-'));
  try {
    const packageDir = writePreflightFixture(tempDir, 'computed-link', {
      entrySource: computedPreflightSource(),
    });
    const external = path.join(tempDir, 'external-tool.js');
    fs.writeFileSync(external, 'export const external = true;\n');
    fs.mkdirSync(path.join(packageDir, 'tools'), { recursive: true });
    fs.symlinkSync(external, path.join(packageDir, 'tools', 'tool.js'));
    const result = discoverPreflightFixture(tempDir);
    assertEq(
      result.error?.code,
      'SPECIALIST_UNSAFE_TREE_ENTRY',
      'computed target symlink fails closed',
    );
    result.db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-preflight-injection-'));
  const marker = path.join(tempDir, 'missing-adapter-executed');
  try {
    writePreflightFixture(tempDir, 'missing-adapter', {
      entrySource: `
import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(marker)}, 'executed');
export function register() {}
`,
    });
    const result = discoverPreflightFixture(tempDir, { ToolAdapter: null });
    let error = null;
    try {
      await result.loader._enableOne(
        'missing-adapter',
        result.loader._discovered.get('missing-adapter'),
      );
    } catch (caught) {
      error = caught;
    }
    assertEq(error?.message, 'SPECIALIST_TOOL_ADAPTER_REQUIRED', 'missing injection is named');
    assert(!fs.existsSync(marker), 'missing injection fails before entry import');
    result.db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-preflight-mutation-'));
  const marker = path.join(tempDir, 'mutated-entry-executed');
  try {
    const packageDir = writePreflightFixture(tempDir, 'mutated-after-discovery', {
      entrySource: `
import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(marker)}, 'executed');
export function register() {}
`,
    });
    const result = discoverPreflightFixture(tempDir);
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'src', 'core.js'), 'export const core = true;\n');
    fs.mkdirSync(path.join(packageDir, 'nested'), { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, 'nested', 'late.js'),
      "import '../../src/core.js';\n",
    );
    let error = null;
    try {
      await result.loader._enableOne(
        'mutated-after-discovery',
        result.loader._discovered.get('mutated-after-discovery'),
      );
    } catch (caught) {
      error = caught;
    }
    assertEq(error?.code, 'SPECIALIST_PATH_ESCAPE', 'changed tree is revalidated before import');
    assert(!fs.existsSync(marker), 'late violation blocks entry top-level side effect');
    result.db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-preflight-disabled-'));
  const marker = path.join(tempDir, 'disabled-entry-executed');
  try {
    writePreflightFixture(tempDir, 'disabled-safe', {
      enabledByDefault: false,
      entrySource: `
import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(marker)}, 'executed');
export function register() {}
`,
    });
    const db = createTestDb();
    const runtime = createMockRuntime();
    const loader = new SpecialistLoader(db, runtime, {
      baseDir: tempDir,
      engineVersion: ENGINE_VERSION,
    });
    await loader.boot();
    assert(!fs.existsSync(marker), 'disabled specialist has no entry side effect');
    assert(!runtime.isSpecialist('disabled-safe'), 'disabled specialist is not registered');
    assertEq(
      loader.getInstalled()[0]?.status,
      'installed',
      'disabled package remains installed only',
    );
    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const dynamicLoaderVariants = [
  "module['re' + 'quire']('../../src/core.cjs');\n",
  "Reflect.get(module, 'require').call(module, '../../src/core.cjs');\n",
  "globalThis['e' + 'val']('void 0');\n",
  "globalThis['Fun' + 'ction']('return 0')();\n",
  "globalThis['\\u0065val']('void 0');\n",
  "module.constructor._load('/tmp/core.cjs');\n",
  "require('node:module')._load('/tmp/core.cjs');\n",
  "process.getBuiltinModule('module')._load('/tmp/core.cjs');\n",
];
for (const [index, source] of dynamicLoaderVariants.entries()) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-preflight-loader-'));
  try {
    writePreflightFixture(tempDir, `dynamic-loader-${index}`, {
      extraFiles: { 'nested/loader.cjs': source },
    });
    const result = discoverPreflightFixture(tempDir);
    assertEq(
      result.error?.code,
      'SPECIALIST_UNPROVEN_DYNAMIC_CODE',
      `indirect loader variant ${index + 1} fails closed`,
    );
    result.db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-preflight-object-'));
  try {
    writePreflightFixture(tempDir, 'ordinary-computed-property', {
      extraFiles: {
        'nested/ordinary.js': `
const values = { safe: true };
const key = process.env.SPECIALIST_TEST_KEY || 'safe';
export const selected = values[key];
`,
        'nested/ordinary.cjs': 'module.exports = { safe: true };\n',
      },
    });
    const result = discoverPreflightFixture(tempDir);
    assertEq(result.error, null, 'ordinary obj[key], process.env, and module.exports pass');
    result.db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-preflight-entry-'));
  const marker = path.join(tempDir, 'outside-entry-executed');
  try {
    const packageDir = writePreflightFixture(tempDir, 'entry-escape');
    fs.writeFileSync(path.join(tempDir, 'outside.js'), `
import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(marker)}, 'executed');
export function register() {}
`);
    const manifestPath = path.join(packageDir, 'specialist.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.entry = '../outside.js';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const result = discoverPreflightFixture(tempDir);
    assertEq(result.error?.code, 'SPECIALIST_PATH_ESCAPE', 'manifest entry escape fails closed');
    assert(!fs.existsSync(marker), 'manifest entry escape has no top-level side effect');
    result.db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-preflight-encoded-'));
  try {
    writePreflightFixture(tempDir, 'encoded-traversal', {
      extraFiles: {
        'nested/encoded.js': "import '../%2e%2e/src/core.js';\n",
        '%2e%2e/src/core.js': 'export const core = true;\n',
      },
    });
    const result = discoverPreflightFixture(tempDir);
    assertEq(
      result.error?.code,
      'SPECIALIST_UNSUPPORTED_ESCAPED_SPECIFIER',
      'percent-encoded traversal fails closed',
    );
    result.db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-preflight-migration-'));
  const marker = path.join(tempDir, 'outside-migration-executed');
  try {
    const packageDir = writePreflightFixture(tempDir, 'migration-escape');
    fs.mkdirSync(path.join(packageDir, 'migrations'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'outside.js'), `
import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(marker)}, 'executed');
export function up() {}
`);
    const db = createTestDb();
    const loader = new SpecialistLoader(db, createMockRuntime(), {
      baseDir: tempDir,
      engineVersion: ENGINE_VERSION,
    });
    let error = null;
    try {
      loader._runMigrations('migration-escape', packageDir, {
        migrations: ['../outside'],
      });
    } catch (caught) {
      error = caught;
    }
    assertEq(
      error?.code,
      'SPECIALIST_MIGRATION_NAME_INVALID',
      'migration name escape fails closed',
    );
    assert(!fs.existsSync(marker), 'migration name escape has no top-level side effect');
    db.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

console.log(`\n══════════════════════════════════════════════════`);
console.log(`Specialist Loader: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════════════════`);

if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ❌ ${f}`));
  process.exit(1);
}
