// Test: Proposal Stale Cleanup v126
// ══════════════════════════════════════════════════════════════════════════════
//
// Scenario:
//   1. Create pending proposals for D2 → qwen3:14b
//   2. Apply upgrade D2 → qwen3:14b
//   3. Verify the selected proposal is approved and competing proposals expire
//   4. Verify GET /api/system/proposals doesn't return expired proposals
//
// Bug fix:
//   - applyUpgrade() resolves the selected proposal and expires stale competitors
//   - getActiveProposals() filters out candidates == active model
//   - startPeriodicCheck() cleans stale proposals on startup
//
// ══════════════════════════════════════════════════════════════════════════════

import { suite, testAsync, assertEqual, assert, summary } from './harness.js';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

suite('Proposal Stale Cleanup v126');

await testAsync('UpgradeManager approves the selected proposal and expires competitors', async () => {
  const db = new Database(':memory:');

  // Setup schema (simplified)
  db.exec(`
    CREATE TABLE upgrade_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      current_model TEXT NOT NULL,
      candidate_model TEXT NOT NULL,
      score REAL,
      current_score REAL,
      improvement REAL,
      score_breakdown TEXT,
      reason TEXT,
      risk_level TEXT,
      installed INTEGER DEFAULT 0,
      size_gb REAL DEFAULT 0,
      source TEXT DEFAULT 'local',
      status TEXT DEFAULT 'pending',
      catalog_hash TEXT,
      evaluation_version INTEGER,
      detected_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    CREATE TABLE model_overrides (
      role TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      previous_model TEXT,
      score REAL,
      applied_by TEXT,
      applied_at TEXT DEFAULT (datetime('now')),
      verified INTEGER DEFAULT 1
    );

    CREATE TABLE upgrade_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      from_model TEXT NOT NULL,
      to_model TEXT NOT NULL,
      score REAL,
      action TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Insert 3 pending proposals for D2
  db.prepare(`
    INSERT INTO upgrade_proposals (role, current_model, candidate_model, score, status)
    VALUES
      ('D2', 'qwen3-30b-a3b', 'qwen3:14b', 7.2, 'pending'),
      ('D2', 'qwen3-30b-a3b', 'qwen3.5:27b', 6.8, 'pending'),
      ('D2', 'qwen3-30b-a3b', 'qwen2.5:32b', 5.5, 'pending')
  `).run();

  // Verify 3 pending proposals exist
  const beforeCount = db.prepare(`SELECT COUNT(*) as cnt FROM upgrade_proposals WHERE status = 'pending'`).get();
  assertEqual(beforeCount.cnt, 3, 'Should have 3 pending proposals');

  // Import and setup UpgradeManager
  const { UpgradeManager } = await import('../src/upgrade/upgrade-manager.js');
  const { config } = await import('../src/config.js');
  const originalD2Model = config.models.D2;
  config.models.D2 = 'qwen3-30b-a3b';

  const manager = new UpgradeManager();
  manager.setDb(db);

  // Process-local Ollama tags fixture. ESM exports are intentionally immutable,
  // so patch the actual I/O boundary and restore it before assertions continue.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert(String(url).endsWith('/api/tags'), `Unexpected network request: ${url}`);
    return {
      ok: true,
      status: 200,
      json: async () => ({ models: [{ name: 'qwen3:14b' }] }),
    };
  };

  try {
    await manager.applyUpgrade('D2', 'qwen3:14b', { skipVerify: true, score: 7.2 });
  } finally {
    globalThis.fetch = originalFetch;
    config.models.D2 = originalD2Model;
  }

  // The selected proposal is the durable decision; only competitors expire.
  const afterCount = db.prepare(`SELECT COUNT(*) as cnt FROM upgrade_proposals WHERE status = 'pending'`).get();
  assertEqual(afterCount.cnt, 0, 'All pending proposals should be resolved');

  const approved = db.prepare(`
    SELECT role, candidate_model, status
    FROM upgrade_proposals
    WHERE status = 'approved'
  `).all();
  assertEqual(approved.length, 1, 'Exactly one proposal should be approved');
  assertEqual(approved[0].role, 'D2', 'Approved proposal should belong to D2');
  assertEqual(approved[0].candidate_model, 'qwen3:14b', 'Applied candidate should be approved');

  const expiredCount = db.prepare(`SELECT COUNT(*) as cnt FROM upgrade_proposals WHERE status = 'expired'`).get();
  assertEqual(expiredCount.cnt, 2, 'Only competing proposals should expire');

  db.close();
});

await testAsync('ProposalStore.getActiveProposals() filters out active models', async () => {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE upgrade_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      current_model TEXT NOT NULL,
      candidate_model TEXT NOT NULL,
      score REAL,
      status TEXT DEFAULT 'pending',
      detected_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Insert proposals: 2 for D2, 1 for CODE
  db.prepare(`
    INSERT INTO upgrade_proposals (role, current_model, candidate_model, score, status)
    VALUES
      ('D2', 'qwen3-30b-a3b', 'qwen3:14b', 7.2, 'pending'),
      ('D2', 'qwen3-30b-a3b', 'qwen3.5:27b', 6.8, 'pending'),
      ('CODE', 'qwen2.5:14b', 'qwen3:14b', 5.5, 'pending')
  `).run();

  const { ProposalStore } = await import('../src/upgrade/proposal-store.js');
  const store = new ProposalStore();
  store.setDb(db);

  // Case 1: No filter (old behavior)
  const allProposals = store.getActiveProposals();
  assertEqual(allProposals.length, 3, 'Should return all 3 proposals without filter');

  // Case 2: Filter with D2 = qwen3:14b (candidate matches active)
  const currentModels = { D2: 'qwen3:14b', CODE: 'qwen2.5:14b' };
  const filtered = store.getActiveProposals(currentModels);
  assertEqual(filtered.length, 2, 'Should filter out qwen3:14b for D2');

  // Verify filtered proposals
  const d2Proposals = filtered.filter(p => p.role === 'D2');
  assertEqual(d2Proposals.length, 1, 'Should have 1 D2 proposal left');
  assertEqual(d2Proposals[0].candidate_model, 'qwen3.5:27b', 'Should be qwen3.5:27b');

  db.close();
});

await testAsync('startPeriodicCheck() cleans stale proposals on startup', async () => {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE upgrade_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      current_model TEXT NOT NULL,
      candidate_model TEXT NOT NULL,
      score REAL,
      status TEXT DEFAULT 'pending',
      detected_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT
    );
  `);

  // Insert proposals where candidate == active model
  db.prepare(`
    INSERT INTO upgrade_proposals (role, current_model, candidate_model, score, status)
    VALUES
      ('D2', 'qwen3-30b-a3b', 'qwen3:14b', 7.2, 'pending'),
      ('D2', 'qwen3-30b-a3b', 'qwen3.5:27b', 6.8, 'pending')
  `).run();

  const { UpgradeManager } = await import('../src/upgrade/upgrade-manager.js');
  const { config } = await import('../src/config.js');
  const originalD2Model = config.models.D2;
  config.models.D2 = 'qwen3:14b'; // Active model matches first proposal

  const manager = new UpgradeManager();
  manager.setDb(db);
  manager.checkForUpgrades = async () => [];

  try {
    // Call startPeriodicCheck (will trigger cleanup)
    manager.startPeriodicCheck({ recheckMs: 999999, pollMs: 999999 });

    // Verify stale proposal expired
    const pending = db.prepare(`SELECT COUNT(*) as cnt FROM upgrade_proposals WHERE status = 'pending'`).get();
    assertEqual(pending.cnt, 1, 'Should have 1 pending proposal (qwen3.5:27b)');

    const expired = db.prepare(`SELECT COUNT(*) as cnt FROM upgrade_proposals WHERE status = 'expired'`).get();
    assertEqual(expired.cnt, 1, 'Should have 1 expired proposal (qwen3:14b)');
  } finally {
    manager.stopPeriodicCheck();
    config.models.D2 = originalD2Model;
    db.close();
  }
});

summary();
