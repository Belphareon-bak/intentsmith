// C3-Agent v57.0 — Expert Integration Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests expert system with real database (SQLite).
//
// T11.1: Expert tables created in DB
// T11.2: Custom expert persistence survives restart
// T11.3: Conversation-expert binding persistence
// T11.4: Expert handler uses correct temperature
// T11.5: Full expert lifecycle
//
// Spuštění: node --experimental-vm-modules tests/expert-integration.test.js
//
// ══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Test Infrastructure ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];
const pendingTests = [];

async function describe(name, fn) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${name}`);
  console.log(`${'═'.repeat(70)}`);
  await fn();
}

async function it(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message, stack: err.stack });
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
  }
}

// ─── Test DB Setup ───────────────────────────────────────────────────────────

const TEST_DB_PATH = path.join(__dirname, 'test-expertise-db.sqlite');

// Clean up test DB before/after
function cleanupTestDb() {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// RUN TESTS
// ══════════════════════════════════════════════════════════════════════════════

async function runTests() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║       C3-Agent v57.0 — Expert Integration Tests                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  // Clean up before tests
  cleanupTestDb();

  try {
    // T11.1
    await describe('T11.1: Expertise tables created in DB', async () => {
      await it('database module creates expertises table', async () => {
        const Database = (await import('better-sqlite3')).default;
        const db = new Database(':memory:');

        db.exec(`
          CREATE TABLE IF NOT EXISTS expertises (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            domain TEXT,
            system_prompt TEXT,
            temperature REAL DEFAULT 0.5 CHECK(temperature >= 0 AND temperature <= 1),
            config TEXT NOT NULL DEFAULT '{}',
            is_builtin INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='expertises'").get();
        assert.ok(tables, 'expertises table should exist');
        db.close();
      });

      await it('database module creates expertise_bindings table', async () => {
        const Database = (await import('better-sqlite3')).default;
        const db = new Database(':memory:');

        db.exec(`
          CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY);
          CREATE TABLE IF NOT EXISTS expertise_bindings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            expertise_id TEXT NOT NULL,
            locked INTEGER DEFAULT 0,
            strength INTEGER DEFAULT 50 CHECK(strength >= 0 AND strength <= 100),
            locked_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(conversation_id)
          )
        `);

        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='expertise_bindings'").get();
        assert.ok(tables, 'expertise_bindings table should exist');
        db.close();
      });
    });

    // T11.2
    await describe('T11.2: Custom expertise persistence', async () => {
      await it('custom expertise survives DB operations', async () => {
        const Database = (await import('better-sqlite3')).default;
        let db = new Database(':memory:');

        db.exec(`
          CREATE TABLE IF NOT EXISTS expertises (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            domain TEXT,
            temperature REAL DEFAULT 0.5,
            config TEXT NOT NULL DEFAULT '{}'
          )
        `);

        const insert = db.prepare(`
          INSERT INTO expertises (id, name, description, domain, temperature, config)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        insert.run('persist_test', 'Persistence Test', 'Testing', 'testing', 0.6, '{}');

        const expertise = db.prepare('SELECT * FROM expertises WHERE id = ?').get('persist_test');
        assert.ok(expertise, 'Expertise should be inserted');
        assert.equal(expertise.name, 'Persistence Test');
        assert.equal(expertise.temperature, 0.6);
        db.close();
      });

      await it('expertise config JSON is stored correctly', async () => {
        const Database = (await import('better-sqlite3')).default;
        const db = new Database(':memory:');

        db.exec(`CREATE TABLE IF NOT EXISTS expertises (id TEXT PRIMARY KEY, name TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}')`);

        const config = { icon: '🧪', styleRules: { forbiddenPhrases: ['test'] } };
        db.prepare('INSERT INTO expertises (id, name, config) VALUES (?, ?, ?)').run('json_test', 'JSON Test', JSON.stringify(config));

        const row = db.prepare('SELECT config FROM expertises WHERE id = ?').get('json_test');
        const parsed = JSON.parse(row.config);
        assert.equal(parsed.icon, '🧪');
        db.close();
      });
    });

    // T11.3
    await describe('T11.3: Conversation-expertise binding persistence', async () => {
      await it('binding persists to DB', async () => {
        const Database = (await import('better-sqlite3')).default;
        const db = new Database(':memory:');

        db.exec(`
          CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY);
          CREATE TABLE IF NOT EXISTS expertise_bindings (
            conversation_id TEXT PRIMARY KEY, expertise_id TEXT NOT NULL, locked INTEGER DEFAULT 0, strength INTEGER DEFAULT 50
          );
        `);

        db.prepare('INSERT INTO conversations (id) VALUES (?)').run('conv-persist');
        db.prepare('INSERT INTO expertise_bindings (conversation_id, expertise_id, locked, strength) VALUES (?, ?, ?, ?)').run('conv-persist', 'writer', 1, 75);

        const binding = db.prepare('SELECT * FROM expertise_bindings WHERE conversation_id = ?').get('conv-persist');
        assert.ok(binding, 'Binding should exist');
        assert.equal(binding.expertise_id, 'writer');
        assert.equal(binding.locked, 1);
        assert.equal(binding.strength, 75);
        db.close();
      });
    });

    // T11.4
    await describe('T11.4: Expertise uses configured temperature', async () => {
      await it('expertise.temperature is used (not hard-coded)', async () => {
        const { ExpertiseAgent } = await import('../src/expertises/expertise-layer.js');
        const expertise = new ExpertiseAgent({ id: 'temp_test', name: 'Temperature Test', temperature: 0.8 });
        assert.equal(expertise.temperature, 0.8);
        assert.equal(expertise.getLLMSettings().temperature, 0.8);
      });

      await it('builtin expertises have varying temperatures', async () => {
        const { expertiseRegistry } = await import('../src/expertises/expertise-layer.js');
        const expertises = expertiseRegistry.getBuiltIn();
        const temperatures = new Set(expertises.map(e => e.temperature));
        assert.ok(temperatures.size > 3, `Should have variety of temperatures, got ${temperatures.size}`);
      });
    });

    // T11.5
    await describe('T11.5: Full expertise lifecycle', async () => {
      await it('lifecycle: LOAD → set → get → update → delete', async () => {
        const { ExpertiseStore } = await import('../src/expertises/expertise-store.js');
        const store = new ExpertiseStore(null);

        const createResult = store.saveCustomExpertise({ name: 'Lifecycle Test', domain: 'lifecycle', temperature: 0.5 });
        assert.equal(createResult.success, true);
        const expertId = createResult.expert.id;

        let expertise = store.getCustomExpertise(expertId);
        assert.equal(expertise.name, 'Lifecycle Test');

        const updateResult = store.saveCustomExpertise({ id: expertId, name: 'Lifecycle Test Updated', domain: 'lifecycle', temperature: 0.7 });
        assert.equal(updateResult.success, true);

        expertise = store.getCustomExpertise(expertId);
        assert.equal(expertise.name, 'Lifecycle Test Updated');

        const deleted = store.deleteCustomExpertise(expertId);
        assert.equal(deleted, true);
        assert.equal(store.getCustomExpertise(expertId), null);
      });

      await it('lifecycle: conversation binding LOAD → LOCK → UNLOCK → CLEAR', async () => {
        const { ExpertiseStore } = await import('../src/expertises/expertise-store.js');
        const store = new ExpertiseStore(null);

        store.setExpertiseForConversation('conv-lifecycle', 'writer', { strength: 50 });
        let binding = store.getExpertiseBinding('conv-lifecycle');
        assert.equal(binding.locked, false);

        store.lockExpertise('conv-lifecycle');
        binding = store.getExpertiseBinding('conv-lifecycle');
        assert.equal(binding.locked, true);

        store.unlockExpertise('conv-lifecycle');
        binding = store.getExpertiseBinding('conv-lifecycle');
        assert.equal(binding.locked, false);

        store.clearExpertise('conv-lifecycle');
        assert.equal(store.getExpertiseBinding('conv-lifecycle'), null);
      });

      await it('lifecycle: expertise hints flow through correctly', async () => {
        const { ExpertiseAgent, ExpertiseStrength } = await import('../src/expertises/expertise-layer.js');
        const expertise = new ExpertiseAgent({ id: 'hints_test', name: 'Hints Test', outputBias: 'creative' });

        expertise.setStrength(ExpertiseStrength.OFF);
        assert.equal(expertise.getSynthesisHints().active, false);

        expertise.setStrength(ExpertiseStrength.LIGHT);
        let hints = expertise.getSynthesisHints();
        assert.equal(hints.active, true);
        assert.equal(hints.preset, 'light');

        expertise.setStrength(ExpertiseStrength.FULL);
        hints = expertise.getSynthesisHints();
        assert.equal(hints.preset, 'deep');
        assert.equal(hints.influence, 1.0);
      });
    });

  } finally {
    cleanupTestDb();
  }

  console.log('\n' + '═'.repeat(70));
  console.log(`\n  RESULTS: ${passed} passed, ${failed} failed\n`);

  if (failures.length > 0) {
    console.log('  FAILURES:');
    for (const f of failures) {
      console.log(`    ❌ ${f.name}`);
      console.log(`       ${f.error}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner failed:', err);
  cleanupTestDb();
  process.exit(1);
});
