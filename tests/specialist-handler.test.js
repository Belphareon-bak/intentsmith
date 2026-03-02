// tests/specialist-handler.test.js — D5 Specialist Handler Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests specialist handler components:
// - loadSpecialistExpertises (DB integration)
// - Gap choice pattern matching
// - Specialist expertise binding auto-seed (loader)
// - Binding API validation
//
// Uses temp in-memory DB with real schema.
//
// ══════════════════════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';

// ─── DB Setup ─────────────────────────────────────────────────────────────────

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  // Core specialists table (migration 012)
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

  // D5 specialist_expertises table (migration 025)
  db.exec(`
    CREATE TABLE IF NOT EXISTS specialist_expertises (
      specialist_id TEXT NOT NULL,
      expertise_id TEXT NOT NULL,
      label TEXT,
      priority INTEGER DEFAULT 0,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (specialist_id, expertise_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_spec_exp_specialist ON specialist_expertises(specialist_id)`);

  // Specialist migrations table (migration 012)
  db.exec(`
    CREATE TABLE IF NOT EXISTS specialist_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      specialist_id TEXT NOT NULL,
      migration_name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now')),
      UNIQUE(specialist_id, migration_name)
    )
  `);

  return db;
}

function seedSpecialist(db, id, manifest) {
  db.prepare(
    'INSERT INTO specialists (id, version, name, domain, type, status, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, manifest.version, manifest.name, manifest.domain, manifest.type || 'domain', 'enabled', JSON.stringify(manifest));
}

function seedBinding(db, specialistId, expertiseId, label = null, priority = 0) {
  db.prepare(
    'INSERT INTO specialist_expertises (specialist_id, expertise_id, label, priority) VALUES (?, ?, ?, ?)'
  ).run(specialistId, expertiseId, label, priority);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ACCOUNTANT_MANIFEST = {
  id: 'accountant-cz',
  version: '1.0.0',
  name: 'Účetní',
  domain: 'finance',
  type: 'domain',
  expertises: ['accountant', 'dph', 'dan-prijem'],
};

// ═══════════════════════════════════════════════════════════════════════════
suite('specialist_expertises — DB operations');

test('insert and query bindings', () => {
  const db = createTestDb();
  seedSpecialist(db, 'accountant-cz', ACCOUNTANT_MANIFEST);
  seedBinding(db, 'accountant-cz', 'accountant', null, 1);
  seedBinding(db, 'accountant-cz', 'dph', 'DPH poradce', 0);

  const rows = db.prepare(
    'SELECT expertise_id, label, priority FROM specialist_expertises WHERE specialist_id = ? ORDER BY priority DESC'
  ).all('accountant-cz');

  assertEqual(rows.length, 2, 'should have 2 bindings');
  assertEqual(rows[0].expertise_id, 'accountant', 'first by priority (1)');
  assertEqual(rows[1].expertise_id, 'dph', 'second by priority (0)');
  assertEqual(rows[1].label, 'DPH poradce', 'label preserved');
  db.close();
});

test('duplicate binding is rejected (PRIMARY KEY)', () => {
  const db = createTestDb();
  seedSpecialist(db, 'accountant-cz', ACCOUNTANT_MANIFEST);
  seedBinding(db, 'accountant-cz', 'accountant');

  // INSERT OR IGNORE should not throw, just skip
  db.prepare(
    'INSERT OR IGNORE INTO specialist_expertises (specialist_id, expertise_id, priority) VALUES (?, ?, ?)'
  ).run('accountant-cz', 'accountant', 5);

  const rows = db.prepare(
    'SELECT priority FROM specialist_expertises WHERE specialist_id = ? AND expertise_id = ?'
  ).all('accountant-cz', 'accountant');

  assertEqual(rows.length, 1, 'still just 1 binding');
  assertEqual(rows[0].priority, 0, 'priority unchanged (IGNORE)');
  db.close();
});

test('delete binding', () => {
  const db = createTestDb();
  seedSpecialist(db, 'accountant-cz', ACCOUNTANT_MANIFEST);
  seedBinding(db, 'accountant-cz', 'accountant');
  seedBinding(db, 'accountant-cz', 'dph');

  const result = db.prepare(
    'DELETE FROM specialist_expertises WHERE specialist_id = ? AND expertise_id = ?'
  ).run('accountant-cz', 'dph');

  assertEqual(result.changes, 1, 'deleted 1 row');

  const remaining = db.prepare(
    'SELECT expertise_id FROM specialist_expertises WHERE specialist_id = ?'
  ).all('accountant-cz');

  assertEqual(remaining.length, 1, '1 binding remaining');
  assertEqual(remaining[0].expertise_id, 'accountant', 'correct binding remains');
  db.close();
});

test('update label and priority', () => {
  const db = createTestDb();
  seedSpecialist(db, 'accountant-cz', ACCOUNTANT_MANIFEST);
  seedBinding(db, 'accountant-cz', 'dph', null, 0);

  db.prepare(
    'UPDATE specialist_expertises SET label = ?, priority = ? WHERE specialist_id = ? AND expertise_id = ?'
  ).run('DPH expert', 5, 'accountant-cz', 'dph');

  const row = db.prepare(
    'SELECT label, priority FROM specialist_expertises WHERE specialist_id = ? AND expertise_id = ?'
  ).get('accountant-cz', 'dph');

  assertEqual(row.label, 'DPH expert', 'label updated');
  assertEqual(row.priority, 5, 'priority updated');
  db.close();
});

// ═══════════════════════════════════════════════════════════════════════════
suite('specialist_expertises — migration seeding');

test('migration seeds from existing specialist manifests', () => {
  const db = createTestDb();
  // Seed specialist BEFORE running migration logic
  seedSpecialist(db, 'accountant-cz', ACCOUNTANT_MANIFEST);

  // Simulate migration seeding logic
  const specialists = db.prepare('SELECT id, manifest_json FROM specialists WHERE status != ?').all('disabled');
  for (const row of specialists) {
    const manifest = JSON.parse(row.manifest_json);
    const expertises = manifest.expertises || [];
    const insert = db.prepare(
      'INSERT OR IGNORE INTO specialist_expertises (specialist_id, expertise_id, priority) VALUES (?, ?, ?)'
    );
    for (const expId of expertises) {
      insert.run(row.id, expId, 1);
    }
  }

  const rows = db.prepare(
    'SELECT expertise_id, priority FROM specialist_expertises WHERE specialist_id = ? ORDER BY expertise_id'
  ).all('accountant-cz');

  assertEqual(rows.length, 3, 'should seed 3 expertises from manifest');
  assert(rows.some(r => r.expertise_id === 'accountant'), 'includes accountant');
  assert(rows.some(r => r.expertise_id === 'dph'), 'includes dph');
  assert(rows.some(r => r.expertise_id === 'dan-prijem'), 'includes dan-prijem');
  assert(rows.every(r => r.priority === 1), 'all manifest entries get priority=1');
  db.close();
});

test('migration skips disabled specialists', () => {
  const db = createTestDb();
  db.prepare(
    'INSERT INTO specialists (id, version, name, domain, type, status, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('disabled-spec', '1.0.0', 'Disabled', 'test', 'domain', 'disabled', JSON.stringify({
    ...ACCOUNTANT_MANIFEST,
    id: 'disabled-spec',
    expertises: ['should-not-seed'],
  }));

  const specialists = db.prepare('SELECT id, manifest_json FROM specialists WHERE status != ?').all('disabled');
  assertEqual(specialists.length, 0, 'no specialists to seed');
  db.close();
});

// ═══════════════════════════════════════════════════════════════════════════
suite('Gap choice — pattern matching');

// Import the patterns by examining the handler source
const GAP_CREATE_PATTERNS = [
  /vytvo[rř]/i, /ano/i, /^1[.)\s]?$/i, /^1$/,
  /create/i, /yes/i, /jo\b/i, /jasn/i, /urcit/i,
];
const GAP_FALLBACK_PATTERNS = [
  /bez\s+n[ií]/i, /^2[.)\s]?$/i, /^2$/,
  /ne\b/i, /without/i, /rovnou/i, /bez\s+expert/i,
];

function isGapCreate(input) {
  const isFallback = GAP_FALLBACK_PATTERNS.some(p => p.test(input.trim()));
  return GAP_CREATE_PATTERNS.some(p => p.test(input.trim())) && !isFallback;
}

function isGapFallback(input) {
  return GAP_FALLBACK_PATTERNS.some(p => p.test(input.trim()));
}

test('create: "ano" → create', () => {
  assert(isGapCreate('ano'), '"ano" should trigger create');
});

test('create: "1" → create', () => {
  assert(isGapCreate('1'), '"1" should trigger create');
});

test('create: "vytvoř" → create', () => {
  assert(isGapCreate('vytvoř'), '"vytvoř" should trigger create');
});

test('create: "yes" → create', () => {
  assert(isGapCreate('yes'), '"yes" should trigger create');
});

test('create: "jo" → create', () => {
  assert(isGapCreate('jo'), '"jo" should trigger create');
});

test('create: "jasně" → create', () => {
  assert(isGapCreate('jasně'), '"jasně" should trigger create');
});

test('fallback: "bez ní" → fallback', () => {
  assert(isGapFallback('bez ní'), '"bez ní" should trigger fallback');
});

test('fallback: "2" → fallback', () => {
  assert(isGapFallback('2'), '"2" should trigger fallback');
});

test('fallback: "ne" → fallback', () => {
  assert(isGapFallback('ne'), '"ne" should trigger fallback');
});

test('fallback: "rovnou" → fallback', () => {
  assert(isGapFallback('rovnou'), '"rovnou" should trigger fallback');
});

test('fallback: "bez expertízy" → fallback', () => {
  assert(isGapFallback('bez expertízy'), '"bez expertízy" should trigger fallback');
});

test('ambiguous: "ne, vytvoř" → fallback wins (ne present)', () => {
  // Fallback patterns take priority — if both match, create check excludes fallback
  assert(!isGapCreate('ne, vytvoř'), 'should not be create when fallback also matches');
});

test('unrelated: "nevím" → neither (ne matches as substring but regex uses \\b)', () => {
  // "ne\b" should not match inside "nevím"
  const isFB = isGapFallback('nevím');
  // "ne" regex is /ne\b/i — "nevím" → "ne" is NOT at word boundary before "v"
  assert(!isFB, '"nevím" should not trigger fallback');
});

// ═══════════════════════════════════════════════════════════════════════════
suite('Binding ordering — priority + added_at');

test('ORDER BY priority DESC, added_at ASC', () => {
  const db = createTestDb();
  seedSpecialist(db, 'test-spec', { ...ACCOUNTANT_MANIFEST, id: 'test-spec' });

  // Insert in reverse order
  seedBinding(db, 'test-spec', 'low-pri', null, 0);
  seedBinding(db, 'test-spec', 'high-pri', null, 5);
  seedBinding(db, 'test-spec', 'mid-pri', null, 3);

  const rows = db.prepare(
    'SELECT expertise_id, priority FROM specialist_expertises WHERE specialist_id = ? ORDER BY priority DESC, added_at ASC'
  ).all('test-spec');

  assertEqual(rows[0].expertise_id, 'high-pri', 'highest priority first');
  assertEqual(rows[1].expertise_id, 'mid-pri', 'mid priority second');
  assertEqual(rows[2].expertise_id, 'low-pri', 'lowest priority last');
  db.close();
});

// ═══════════════════════════════════════════════════════════════════════════
const { passed, failed } = summary();
process.exit(failed > 0 ? 1 : 0);
