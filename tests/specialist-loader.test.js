// Specialist Loader Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests the specialist-loader MVP: discovery, validation, install, enable, disable.
// Uses a temp DB + the real accountant-cz package.
//
// ══════════════════════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

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
    engineVersion: '65.5.0',
  });

  const manifests = loader.discoverAll();
  assert(manifests.length >= 1, 'discovers at least 1 specialist');
  assert(manifests.some(m => m.id === 'accountant-cz'), 'discovers accountant-cz');

  const accountant = manifests.find(m => m.id === 'accountant-cz');
  assertEq(accountant.version, '1.0.0', 'accountant-cz version is 1.0.0');
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
    engineVersion: '65.5.0',
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
    engineVersion: '65.5.0',
  });

  loader.discoverAll();
  loader.installPending();

  const rows = loader.getInstalled();
  assert(rows.length >= 1, 'specialist installed in DB');

  const row = rows.find(r => r.id === 'accountant-cz');
  assert(row !== undefined, 'accountant-cz row exists in DB');
  assertEq(row.version, '1.0.0', 'version stored correctly');
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
    engineVersion: '65.5.0',
  });

  loader.discoverAll();
  loader.installPending();
  await loader.enableAll();

  assert(runtime.isSpecialist('accountant'), 'accountant registered in runtime after enable');
  assertEq(runtime.getSpecialistIds().length, 1, '1 specialist registered');

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
    engineVersion: '65.5.0',
  });

  await loader.boot();

  assert(runtime.isSpecialist('accountant'), 'boot() registers accountant');
  assertEq(loader.getEnabled().length, 1, '1 specialist enabled after boot');

  db.close();
}

// ── 7. Disable ───────────────────────────────────────────────────────────────

console.log('\n── 7. Disable ──');
{
  const db = createTestDb();
  const runtime = createMockRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: '65.5.0',
  });

  await loader.boot();
  assert(runtime.isSpecialist('accountant'), 'accountant enabled before disable');

  loader.disable('accountant-cz');

  assert(!runtime.isSpecialist('accountant'), 'accountant NOT in runtime after disable');
  assertEq(loader.getEnabled().length, 0, '0 specialists enabled after disable');

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
    engineVersion: '65.5.0',
  });

  await loader.boot();
  loader.disable('accountant-cz');
  assert(!runtime.isSpecialist('accountant'), 'disabled');

  await loader.enable('accountant-cz');
  assert(runtime.isSpecialist('accountant'), 'accountant back in runtime after re-enable');
  assertEq(loader.getEnabled().length, 1, '1 specialist enabled after re-enable');

  db.close();
}

// ── 9. Manifest retrieval ────────────────────────────────────────────────────

console.log('\n── 9. Manifest retrieval ──');
{
  const db = createTestDb();
  const runtime = createMockRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: '65.5.0',
  });

  await loader.boot();

  const manifest = loader.getManifest('accountant-cz');
  assert(manifest !== null, 'getManifest returns manifest');
  assertEq(manifest.id, 'accountant-cz', 'manifest id correct');
  assert(Array.isArray(manifest.tools), 'manifest has tools array');
  assert(manifest.future?.capabilities?.length > 0, 'manifest has future capabilities');

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
    engineVersion: '65.5.0',
  });

  await loader.boot();

  const config = runtime._registered.get('accountant');
  const taxTool = config.tools.find(t => t.id === 'accountant.tax_calculator');

  assert(taxTool.modulePath.includes('specialists/accountant-cz/tools/tax-calc.js'),
    'tax_calculator modulePath points to package tools dir');

  // Verify the file actually exists at that path
  const fs = await import('fs');
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
    engineVersion: '65.5.0',
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
  loader.disable('accountant-cz');
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
    engineVersion: '65.5.0',
  });

  await loader.boot();

  // VAT tool works
  const vat1 = await runtime.tryToolExecution('accountant', 'DPH z 10000 Kč');
  assert(vat1 !== null, 'VAT tool detected before disable');
  assertEq(vat1.toolType, 'accountant.vat_calculator', 'VAT tool type correct');

  // Disable
  loader.disable('accountant-cz');
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
    engineVersion: '65.5.0',
  });

  await loader.boot();

  // After clean boot — integrity should be OK
  const check1 = loader.checkIntegrity();
  assert(check1.ok, 'integrity OK after clean boot');
  assertEq(check1.issues.length, 0, 'no integrity issues after boot');

  // After disable — integrity should be OK (disabled = not expected in runtime)
  loader.disable('accountant-cz');
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
    engineVersion: '65.5.0',
  });

  await loader.boot();
  const ids1 = runtime.getSpecialistIds();
  assertEq(ids1.length, 1, 'one specialist after boot');

  // Boot again — should not duplicate
  await loader.boot();
  const ids2 = runtime.getSpecialistIds();
  assertEq(ids2.length, 1, 'still one specialist after double boot');

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
    engineVersion: '65.5.0',
  });

  await loader.boot();
  loader.disable('accountant-cz');
  assert(!runtime.isSpecialist('accountant'), 'disabled once');

  // Disable again — should be noop, no error
  loader.disable('accountant-cz');
  assert(!runtime.isSpecialist('accountant'), 'still disabled after double disable');
  assertEq(loader.getEnabled().length, 0, '0 enabled after double disable');

  db.close();
}

// ── 16. Stress test: 200× enable/disable cycle ──────────────────────────────

console.log('\n── 16. Stress test: 200 enable/disable cycles ──');
{
  const db = createTestDb();
  const runtime = new SpecialistRuntime();
  const loader = new SpecialistLoader(db, runtime, {
    baseDir: path.join(PROJECT_ROOT, 'specialists'),
    engineVersion: '65.5.0',
  });

  await loader.boot();

  const heapBefore = process.memoryUsage().heapUsed;
  const CYCLES = 200;

  for (let i = 0; i < CYCLES; i++) {
    loader.disable('accountant-cz');
    await loader.enable('accountant-cz');
  }

  // Force GC if available
  if (global.gc) global.gc();

  const heapAfter = process.memoryUsage().heapUsed;
  const heapDeltaMB = (heapAfter - heapBefore) / 1024 / 1024;

  assert(runtime.isSpecialist('accountant'), `accountant registered after ${CYCLES} cycles`);
  assertEq(runtime.getSpecialistIds().length, 1, `still exactly 1 specialist after ${CYCLES} cycles`);

  // Heap growth should be minimal — closures from register() are overwritten by Map.set()
  // Allow max 10MB growth for 200 cycles (very generous threshold)
  assert(heapDeltaMB < 10, `heap grew ${heapDeltaMB.toFixed(2)}MB in ${CYCLES} cycles (< 10MB OK)`);

  // Tool still works
  const match = await runtime.tryToolExecution('accountant', 'DPH z 10000 Kč');
  assert(match !== null, `tool works after ${CYCLES} cycles`);

  // Integrity OK
  const check = loader.checkIntegrity();
  assert(check.ok, `integrity OK after ${CYCLES} cycles`);

  // Registry Map size = 1 (no ghost entries)
  assertEq(runtime.registry._specialists.size, 1, 'registry Map has exactly 1 entry');

  // Module cache didn't explode
  assertEq(loader._modules.size, 1, 'loader modules Map has exactly 1 entry');

  console.log(`  ℹ️  Heap delta: ${heapDeltaMB.toFixed(2)}MB for ${CYCLES} cycles`);

  db.close();
}

// ═════════════════════════════════════════════════════════════════════════════

console.log(`\n══════════════════════════════════════════════════`);
console.log(`Specialist Loader: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════════════════`);

if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ❌ ${f}`));
  process.exit(1);
}
