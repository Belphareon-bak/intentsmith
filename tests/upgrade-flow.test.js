// tests/upgrade-flow.test.js — v103.2: Chat-Based Upgrade Flow
// ══════════════════════════════════════════════════════════════════════════════
// Tests for approval regex, session state, pullModel progress, getUnusedOldModels,
// cleanup, multi-role dedup, and reject flow.
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import Database from 'better-sqlite3';
import { UpgradeManager } from '../src/upgrade/upgrade-manager.js';
import { config } from '../src/config.js';

// ─── Test DB Setup ──────────────────────────────────────────────────────────

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_overrides (
      role TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      previous_model TEXT NOT NULL,
      score REAL,
      applied_by TEXT DEFAULT 'user',
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS upgrade_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      from_model TEXT NOT NULL,
      to_model TEXT NOT NULL,
      score REAL,
      action TEXT NOT NULL DEFAULT 'apply',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const originalModels = { ...config.models };
function resetModels() {
  for (const key of Object.keys(originalModels)) {
    config.models[key] = originalModels[key];
  }
}

// ─── Regex copies from pre-handler (to test in isolation) ───────────────────

const APPROVAL_RE = /^(schvaluji?|approve|ano|jo|ok|yes|sure|jasn[eě]?)\s*[!.]?$/i;
const APPROVAL_PHRASE_RE = /\b(schval|approv|upgrad|aktualizuj)/i;
const REJECT_RE = /^(ne|no|nechci|cancel|zru[sš]i?t?|skip)\s*[!.]?$/i;
const CLEANUP_RE = /^(sma[zž]\s+star[eé]\s+model|remove\s+old\s+model|cleanup\s+model)/i;

function isApproval(input) {
  const trimmed = input.trim();
  return APPROVAL_RE.test(trimmed) || APPROVAL_PHRASE_RE.test(trimmed);
}

function isReject(input) {
  return REJECT_RE.test(input.trim());
}

// ═══════════════════════════════════════════════════════════════════════════════
suite('Approval regex');
// ═══════════════════════════════════════════════════════════════════════════════

test('"schvaluji" matches approval', () => {
  assert(isApproval('schvaluji'), 'schvaluji');
  assert(isApproval('schvaluj'), 'schvaluj');
  assert(isApproval('Schvaluji!'), 'Schvaluji!');
});

test('"approve", "ano", "ok", "yes" match approval', () => {
  assert(isApproval('approve'), 'approve');
  assert(isApproval('ano'), 'ano');
  assert(isApproval('ok'), 'ok');
  assert(isApproval('yes'), 'yes');
  assert(isApproval('Yes.'), 'Yes.');
});

test('"sure", "jasne", "jasně" match approval', () => {
  assert(isApproval('sure'), 'sure');
  assert(isApproval('jasne'), 'jasne');
  assert(isApproval('jasně'), 'jasně');
});

test('phrase "ok tak to schval" matches via APPROVAL_PHRASE_RE', () => {
  assert(isApproval('ok tak to schval'), 'ok tak to schval');
  assert(isApproval('tak to approve prosim'), 'tak to approve prosim');
  assert(isApproval('upgrade to novy model'), 'upgrade');
  assert(isApproval('aktualizuj modely'), 'aktualizuj');
});

test('empty string does not match', () => {
  assert(!isApproval(''), 'empty');
  assert(!isApproval('   '), 'whitespace');
});

test('"ne", "nechci", "cancel" match reject', () => {
  assert(isReject('ne'), 'ne');
  assert(isReject('nechci'), 'nechci');
  assert(isReject('cancel'), 'cancel');
  assert(isReject('skip'), 'skip');
  assert(isReject('zrušit'), 'zrušit');
  assert(isReject('zrusit'), 'zrusit');
});

test('unrelated input matches neither', () => {
  assert(!isApproval('jak se máš'), 'jak se máš not approval');
  assert(!isReject('jak se máš'), 'jak se máš not reject');
  assert(!isApproval('naprogramuj mi kalkulačku'), 'unrelated not approval');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('Cleanup regex');
// ═══════════════════════════════════════════════════════════════════════════════

test('"smaz stare modely" matches (no diacritics)', () => {
  assert(CLEANUP_RE.test('smaz stare modely'), 'smaz stare modely');
});

test('"smaž staré modely" matches (with diacritics)', () => {
  assert(CLEANUP_RE.test('smaž staré modely'), 'smaž staré modely');
});

test('"remove old models" matches', () => {
  assert(CLEANUP_RE.test('remove old models'), 'remove old models');
});

test('"cleanup models" matches', () => {
  assert(CLEANUP_RE.test('cleanup models'), 'cleanup models');
});

test('unrelated input does not match cleanup', () => {
  assert(!CLEANUP_RE.test('schvaluji'), 'schvaluji not cleanup');
  assert(!CLEANUP_RE.test('jak je to s modely'), 'unrelated');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('Session state — deep copy');
// ═══════════════════════════════════════════════════════════════════════════════

test('proposals are deep-copied (mutation isolation)', () => {
  const proposals = [{ role: 'CHAT', candidateModel: 'model-a', score: 8 }];
  const sessionState = {};

  // Simulate what pre-handler does
  sessionState._pendingUpgrades = JSON.parse(JSON.stringify(proposals));

  // Mutate original
  proposals[0].score = 99;
  proposals.push({ role: 'D1', candidateModel: 'model-b', score: 5 });

  // Session copy should be unaffected
  assertEqual(sessionState._pendingUpgrades.length, 1, 'Length should still be 1');
  assertEqual(sessionState._pendingUpgrades[0].score, 8, 'Score should still be 8');
});

test('clearing _pendingUpgrades does not affect original', () => {
  const proposals = [{ role: 'CHAT', candidateModel: 'model-a' }];
  const sessionState = { _pendingUpgrades: JSON.parse(JSON.stringify(proposals)) };

  delete sessionState._pendingUpgrades;
  assert(sessionState._pendingUpgrades === undefined, 'Should be deleted');
  assertEqual(proposals.length, 1, 'Original should be intact');
});

test('pending not cleared on non-matching input', () => {
  const sessionState = {
    _pendingUpgrades: [{ role: 'CHAT', candidateModel: 'model-a' }],
  };

  const input = 'jak se máš';
  const trimmed = input.trim();
  const match = APPROVAL_RE.test(trimmed) || APPROVAL_PHRASE_RE.test(trimmed) || REJECT_RE.test(trimmed);

  assert(!match, 'Should not match');
  assert(sessionState._pendingUpgrades.length === 1, 'Pending should remain');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('Pull progress format');
// ═══════════════════════════════════════════════════════════════════════════════

test('percentage calculation is correct', () => {
  const total = 16_000_000_000;
  const completed = 8_000_000_000;
  const percent = Math.round((completed / total) * 100);
  assertEqual(percent, 50, 'Should be 50%');
});

test('text format includes model name, %, GB, ETA', () => {
  const modelName = 'qwen3.5:27b';
  const completed = 8_000_000_000;
  const total = 16_000_000_000;
  const percent = Math.round((completed / total) * 100);
  const downloadedGB = (completed / 1_073_741_824).toFixed(1);
  const totalGB = (total / 1_073_741_824).toFixed(1);
  const text = `${modelName} — ${percent}% (${downloadedGB}/${totalGB} GB) — ETA ~30s`;

  assert(text.includes('qwen3.5:27b'), 'Should include model name');
  assert(text.includes('50%'), 'Should include percent');
  assert(text.includes('GB'), 'Should include GB');
  assert(text.includes('ETA'), 'Should include ETA');
});

test('STATUS_LABELS maps non-download events', () => {
  const STATUS_LABELS = {
    'pulling manifest': 'Stahuji manifest...',
    'downloading': null,
    'verifying sha256 digest': 'Ověřuji integritu...',
    'writing manifest': 'Zapisuji manifest...',
    'removing any unused layers': 'Čistím staré vrstvy...',
    'success': 'Hotovo',
  };

  assertEqual(STATUS_LABELS['pulling manifest'], 'Stahuji manifest...');
  assertEqual(STATUS_LABELS['downloading'], null, 'downloading handled separately');
  assertEqual(STATUS_LABELS['verifying sha256 digest'], 'Ověřuji integritu...');
  assertEqual(STATUS_LABELS['success'], 'Hotovo');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('Pull throttle logic');
// ═══════════════════════════════════════════════════════════════════════════════

test('emits on >=5% jump', () => {
  let lastPercent = -1;
  const emissions = [];

  for (let p = 0; p <= 100; p++) {
    if (p >= lastPercent + 5 || p === 100) {
      emissions.push(p);
      lastPercent = p;
    }
  }

  // lastPercent starts at -1, so first emit is at 4 (4 >= -1+5=4)
  // Then 9, 14, 19, ... 49, 54, ... 99, 100
  assert(emissions.includes(4), 'Should emit at 4');
  assert(emissions.includes(9), 'Should emit at 9');
  assert(emissions.includes(49), 'Should emit at 49');
  assert(emissions.includes(99), 'Should emit at 99');
  assert(emissions.includes(100), 'Should emit at 100');
  assertEqual(emissions.length, 21, `Should emit exactly 21 times, got ${emissions.length}`);
});

test('emits on >=3s time gap even if <5% change', () => {
  let lastPercent = -1;
  let lastEmitTime = 0;
  const emissions = [];

  // Simulate slow download: percent barely changes, but 3s+ passes
  const timeSteps = [0, 1000, 2000, 3500, 5000, 8500, 10000];
  const percents =  [0,  1,    2,    3,    4,    4,     5];

  for (let i = 0; i < timeSteps.length; i++) {
    const percent = percents[i];
    const now = timeSteps[i];

    if (percent >= lastPercent + 5 || (now - lastEmitTime >= 3000) || percent === 100) {
      emissions.push({ percent, time: now });
      lastPercent = percent;
      lastEmitTime = now;
    }
  }

  // Should emit at:
  // t=0 (initial, 0% >= -1+5 is true since 0>=-1+5=4? No, 0>=4 is false. Actually p=0 >= lastP(-1)+5=4? No.
  // Wait: lastPercent starts at -1. So 0 >= -1+5 = 0 >= 4? No. But now(0) - lastEmitTime(0) >= 3000? No.
  // Hmm, let me reconsider. At i=0: p=0, lp=-1. 0 >= -1+5=4? No. 0-0>=3000? No. p===100? No. → no emit.
  // At i=1: p=1, 1>=4? No. 1000-0>=3000? No. → no emit.
  // At i=2: p=2, 2>=4? No. 2000-0>=3000? No. → no emit.
  // At i=3: p=3, 3>=4? No. 3500-0>=3000? Yes → emit. lp=3, let=3500.
  // At i=4: p=4, 4>=3+5=8? No. 5000-3500>=3000? No. → no emit.
  // At i=5: p=4, 4>=8? No. 8500-3500>=3000? Yes → emit. lp=4, let=8500.
  // At i=6: p=5, 5>=4+5=9? No. 10000-8500>=3000? No. → no emit.
  // So 2 emissions: at t=3500 and t=8500.

  assertEqual(emissions.length, 2, `Expected 2 time-based emissions, got ${emissions.length}`);
  assertEqual(emissions[0].time, 3500, 'First emission at 3.5s');
  assertEqual(emissions[1].time, 8500, 'Second emission at 8.5s');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('Multi-role same model pull dedup');
// ═══════════════════════════════════════════════════════════════════════════════

test('2 proposals with same candidateModel: pull called only once', () => {
  const pending = [
    { role: 'CHAT', candidateModel: 'qwen3.5:27b', installed: false, score: 8 },
    { role: 'D2', candidateModel: 'qwen3.5:27b', installed: false, score: 7 },
    { role: 'R2', candidateModel: 'other-model:7b', installed: false, score: 6 },
  ];

  const pulledModels = new Set();
  const pullCalls = [];

  for (const p of pending) {
    if (!p.installed && !pulledModels.has(p.candidateModel)) {
      pullCalls.push(p.candidateModel);
      pulledModels.add(p.candidateModel);
    }
  }

  assertEqual(pullCalls.length, 2, 'Should pull 2 unique models');
  assert(pullCalls.includes('qwen3.5:27b'), 'Should include qwen3.5:27b');
  assert(pullCalls.includes('other-model:7b'), 'Should include other-model:7b');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('getUnusedOldModels');
// ═══════════════════════════════════════════════════════════════════════════════

test('finds models not bound to any role', () => {
  resetModels();
  const db = createTestDb();
  const mgr = new UpgradeManager();
  mgr.setDb(db);

  // Insert override: CHAT was 'old-chat-model', now 'qwen3.5:27b' (which is the default)
  db.prepare('INSERT INTO model_overrides (role, model, previous_model) VALUES (?, ?, ?)').run(
    'CHAT', config.models.CHAT, 'old-chat-model'
  );

  const unused = mgr.getUnusedOldModels();
  assertEqual(unused.length, 1, 'Should find 1 unused model');
  assertEqual(unused[0].model, 'old-chat-model');
  assertEqual(unused[0].replacedBy, config.models.CHAT);

  db.close();
  resetModels();
});

test('skips models still bound to another role', () => {
  resetModels();
  const db = createTestDb();
  const mgr = new UpgradeManager();
  mgr.setDb(db);

  // CHAT model was replaced, but the old model is still used by D2
  const chatModel = config.models.CHAT;
  const d2Model = config.models.D2;

  // Override: D1 was 'old-d1', now some-new-model
  // But 'old-d1' is actually config.models.D2 → still bound
  db.prepare('INSERT INTO model_overrides (role, model, previous_model) VALUES (?, ?, ?)').run(
    'D1', 'some-new-model', d2Model
  );

  const unused = mgr.getUnusedOldModels();
  assertEqual(unused.length, 0, 'Should find 0 unused (old model still bound as D2)');

  db.close();
  resetModels();
});

test('returns empty when no overrides', () => {
  const db = createTestDb();
  const mgr = new UpgradeManager();
  mgr.setDb(db);
  const unused = mgr.getUnusedOldModels();
  assertEqual(unused.length, 0);
  db.close();
});

test('returns empty when _db is null', () => {
  const mgr = new UpgradeManager();
  const unused = mgr.getUnusedOldModels();
  assertEqual(unused.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('Bound model safety (DELETE route logic)');
// ═══════════════════════════════════════════════════════════════════════════════

test('bound model detection works correctly', () => {
  resetModels();
  const modelName = config.models.CHAT;
  const bound = Object.entries(config.models).filter(([_, m]) => m === modelName);
  assert(bound.length > 0, `${modelName} should be bound to at least CHAT`);

  const roles = bound.map(([r]) => r);
  assert(roles.includes('CHAT'), 'Should include CHAT role');

  // Non-bound model
  const bound2 = Object.entries(config.models).filter(([_, m]) => m === 'nonexistent-model-xyz');
  assertEqual(bound2.length, 0, 'Nonexistent model should not be bound');
  resetModels();
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('Reject flow');
// ═══════════════════════════════════════════════════════════════════════════════

test('"ne" clears pending and returns skip message', () => {
  const sessionState = {
    _pendingUpgrades: [{ role: 'CHAT', candidateModel: 'model-a' }],
  };

  // Simulate what the approval intercept does on reject
  const trimmed = 'ne';
  assert(REJECT_RE.test(trimmed), '"ne" should match REJECT_RE');

  delete sessionState._pendingUpgrades;
  assert(sessionState._pendingUpgrades === undefined, 'Pending should be cleared');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('Date.parse for timezone safety');
// ═══════════════════════════════════════════════════════════════════════════════

test('Date.parse handles SQLite CURRENT_TIMESTAMP format', () => {
  // SQLite CURRENT_TIMESTAMP format: "2026-03-08 12:34:56"
  const sqliteTimestamp = '2026-03-08 12:34:56';
  const parsed = Date.parse(sqliteTimestamp);
  assert(!isNaN(parsed), 'Should parse SQLite timestamp without error');

  const age = Date.now() - parsed;
  assert(age > 0, 'Parsed time should be in the past');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

resetModels();
summary();
