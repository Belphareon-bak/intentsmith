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

// ═════════════════════════════════════════════════════════════════════════════

console.log(`\n══════════════════════════════════════════════════`);
console.log(`Specialist Loader: ${passed} passed, ${failed} failed`);
console.log(`══════════════════════════════════════════════════`);

if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ❌ ${f}`));
  process.exit(1);
}
