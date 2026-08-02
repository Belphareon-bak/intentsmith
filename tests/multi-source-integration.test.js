#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent — B6: Multi-Source Integration Tests
// ═══════════════════════════════════════════════════════════════════════════════
//
// Tests the actual AgentRunner with multi-source agent definitions using
// mixed source types (RSS + HTTP), verifying:
//
//  T1: Runner handles mixed source types (RSS + HTTP) in one agent
//  T2: _merged view correctly combines items from different source types
//  T3: Per-source mark_seen tracks independently across types
//  T4: Partial failure — one source fails, others succeed
//  T5: Conditions evaluate across merged multi-type data
//  T6: HUNTER pattern (no new items after mark_seen)
//  T7: Example definition validation
//
// Real-endpoint coverage lives in multi-source-external.test.js so this
// required offline suite never depends on BBC or OpenMeteo availability.
//
// Run: node tests/multi-source-integration.test.js
//
// ═══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';
import Database from 'better-sqlite3';
import { AgentRunner, RUN_STATE } from '../src/agents/runner.js';

// ─── Test Infrastructure ─────────────────────────────────────────────────────

let total = 0, passed = 0, failed = 0;
const failures = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${'─'.repeat(60)}`);
}

async function t(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
    failures.push({ section: currentSection, name, error: err.message });
  }
}

function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function ok(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

// ─── Mock Repository ─────────────────────────────────────────────────────────

function createMockRepository() {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents_v33 (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      definition TEXT NOT NULL,
      state TEXT DEFAULT '{}',
      params TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS agent_runs_v33 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      status TEXT DEFAULT 'running'
    );
    CREATE TABLE IF NOT EXISTS agent_notifications_v33 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      run_id INTEGER,
      title TEXT NOT NULL,
      body TEXT,
      priority TEXT DEFAULT 'normal',
      data TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_seen_items_v57 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      item_hash TEXT,
      seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, source_id, item_id)
    );
    CREATE TABLE IF NOT EXISTS agent_schedule_v33 (
      agent_id TEXT PRIMARY KEY,
      next_run DATETIME,
      last_run DATETIME,
      interval_ms INTEGER,
      cron_expression TEXT
    );
  `);

  return {
    db,
    getAgent(id) {
      const row = db.prepare('SELECT * FROM agents_v33 WHERE id = ?').get(id);
      if (!row) return null;
      return {
        id: row.id, name: row.name,
        definition: JSON.parse(row.definition),
        state: JSON.parse(row.state || '{}'),
        params: JSON.parse(row.params || '{}'),
        enabled: row.enabled === 1,
      };
    },
    createAgent(agent) {
      db.prepare(`INSERT INTO agents_v33 (id, name, definition, state, params, enabled) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(agent.id, agent.name, JSON.stringify(agent.definition), JSON.stringify(agent.state || {}), JSON.stringify(agent.params || {}), 1);
      return this.getAgent(agent.id);
    },
    updateAgentState(id, state) {
      db.prepare('UPDATE agents_v33 SET state = ? WHERE id = ?').run(JSON.stringify(state), id);
    },
    updateAgent(id, updates) {
      if (updates.enabled !== undefined) {
        db.prepare('UPDATE agents_v33 SET enabled = ? WHERE id = ?').run(updates.enabled ? 1 : 0, id);
      }
    },
    createRun(agentId) {
      return db.prepare('INSERT INTO agent_runs_v33 (agent_id) VALUES (?)').run(agentId).lastInsertRowid;
    },
    completeRun(runId, data) {
      db.prepare('UPDATE agent_runs_v33 SET status = ? WHERE id = ?').run(data.status, runId);
    },
    createNotification(agentId, data) {
      return db.prepare('INSERT INTO agent_notifications_v33 (agent_id, run_id, title, body, priority, data) VALUES (?, ?, ?, ?, ?, ?)')
        .run(agentId, data.run_id, data.title, data.content, data.priority, null).lastInsertRowid;
    },
    isItemSeen(agentId, sourceId, itemId) {
      return !!db.prepare('SELECT 1 FROM agent_seen_items_v57 WHERE agent_id = ? AND source_id = ? AND item_id = ?').get(agentId, sourceId, itemId);
    },
    markItemSeen(agentId, sourceId, itemId, itemHash = null) {
      try {
        db.prepare('INSERT INTO agent_seen_items_v57 (agent_id, source_id, item_id, item_hash) VALUES (?, ?, ?, ?)').run(agentId, sourceId, itemId, itemHash);
        return true;
      } catch (err) {
        if (err.message.includes('UNIQUE constraint')) return false;
        throw err;
      }
    },
    markItemsSeenBatch(agentId, sourceId, items) {
      const newlyMarked = [], alreadySeen = [];
      const insert = db.prepare('INSERT INTO agent_seen_items_v57 (agent_id, source_id, item_id, item_hash) VALUES (?, ?, ?, ?)');
      const check = db.prepare('SELECT 1 FROM agent_seen_items_v57 WHERE agent_id = ? AND source_id = ? AND item_id = ?');
      const batch = db.transaction((items) => {
        for (const item of items) {
          const itemId = typeof item === 'string' ? item : item.id;
          const itemHash = typeof item === 'object' ? item.hash : null;
          if (check.get(agentId, sourceId, itemId)) { alreadySeen.push(itemId); continue; }
          try { insert.run(agentId, sourceId, itemId, itemHash); newlyMarked.push(itemId); }
          catch (err) { if (err.message.includes('UNIQUE')) alreadySeen.push(itemId); else throw err; }
        }
      });
      batch(items);
      return { newlyMarked, alreadySeen };
    },
    getSeenItemIds(agentId, sourceId) {
      return new Set(db.prepare('SELECT item_id FROM agent_seen_items_v57 WHERE agent_id = ? AND source_id = ?').all(agentId, sourceId).map(r => r.item_id));
    },
    clearSeenItems(agentId, sourceId = null) {
      if (sourceId) db.prepare('DELETE FROM agent_seen_items_v57 WHERE agent_id = ? AND source_id = ?').run(agentId, sourceId);
      else db.prepare('DELETE FROM agent_seen_items_v57 WHERE agent_id = ?').run(agentId);
    },
    getSeenItemsCount(agentId) {
      return db.prepare('SELECT COUNT(*) as count FROM agent_seen_items_v57 WHERE agent_id = ?').get(agentId)?.count || 0;
    },
  };
}

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

// ─── Multi-Source Agent Definition (RSS + HTTP) ──────────────────────────────

function createMixedSourceDefinition() {
  return {
    sources: [
      {
        id: 'rss_feed',
        type: 'rss',
        config: {
          url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
          maxItems: 5,
        },
      },
      {
        id: 'http_api',
        type: 'http',
        config: {
          url: 'https://api.open-meteo.com/v1/forecast?latitude=50.08&longitude=14.42&current=temperature_2m&timezone=Europe/Prague',
          method: 'GET',
        },
      },
    ],
    conditions: [
      { id: 'has-data', type: 'exists', field: 'sources._merged.data' },
    ],
    triggers: [
      { id: 'data-trigger', condition_id: 'has-data', edge: 'any', cooldown: 0, max_fires_per_day: 999 },
    ],
    actions: [
      { type: 'notify', trigger_id: 'data-trigger', config: { channel: 'in_app', title: 'Multi-source test', message: 'Data received', priority: 'normal' } },
    ],
    schedule: { type: 'manual' },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  T1: Runner with mixed source types (mock)
// ═══════════════════════════════════════════════════════════════════════════════

section('T1 — Runner handles mixed source types (RSS + HTTP)');

await t('runner accepts definition with rss + http sources', async () => {
  const repo = createMockRepository();
  const runner = new AgentRunner({ repository: repo, logger });

  // Override source handlers with mocks
  runner.sourceHandlers.rss = async (config) => {
    return [
      { id: 'rss-1', title: 'Article 1', link: 'https://bbc.co.uk/1' },
      { id: 'rss-2', title: 'Article 2', link: 'https://bbc.co.uk/2' },
    ];
  };
  runner.sourceHandlers.http = async (config) => {
    return { current: { temperature_2m: 5.3 } };
  };

  repo.createAgent({
    id: 'mixed-1',
    name: 'Mixed Test',
    definition: createMixedSourceDefinition(),
  });

  const result = await runner.execute('mixed-1', { isManual: true });
  eq(result.run_state, RUN_STATE.INIT_BASELINE, `Expected INIT_BASELINE on first run, got ${result.run_state}`);
  ok(!result.error, `No error expected: ${result.error}`);
});

await t('second run processes both source types', async () => {
  const repo = createMockRepository();
  const runner = new AgentRunner({ repository: repo, logger });

  runner.sourceHandlers.rss = async () => [
    { id: 'a1', title: 'Tech news', link: 'https://bbc.co.uk/a1' },
  ];
  runner.sourceHandlers.http = async () => ({ temp: 10 });

  const def = createMixedSourceDefinition();
  repo.createAgent({ id: 'mixed-2', name: 'Mixed', definition: def });

  // First run — baseline
  await runner.execute('mixed-2', { isManual: true });

  // Second run — should process
  runner.sourceHandlers.rss = async () => [
    { id: 'a2', title: 'New article', link: 'https://bbc.co.uk/a2' },
  ];

  const r2 = await runner.execute('mixed-2', { isManual: true });
  ok(r2.run_state !== RUN_STATE.ERROR_SOURCE, `Should not error: ${r2.run_state}`);
  ok(r2.run_state !== RUN_STATE.ERROR_UNKNOWN, `Should not error: ${r2.error}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  T2: _merged view combines items from different source types
// ═══════════════════════════════════════════════════════════════════════════════

section('T2 — _merged view combines different source types');

await t('_merged contains items from both rss and http sources', async () => {
  const repo = createMockRepository();
  const runner = new AgentRunner({ repository: repo, logger });

  let capturedContext = null;
  runner.sourceHandlers.rss = async () => [
    { id: 'rss-item-1', title: 'RSS Item' },
    { id: 'rss-item-2', title: 'RSS Item 2' },
  ];
  runner.sourceHandlers.http = async () => [
    { id: 'http-item-1', title: 'HTTP Item' },
  ];

  // Intercept condition evaluation to capture context
  const origEvalAll = runner.conditions.evaluateAll.bind(runner.conditions);
  runner.conditions.evaluateAll = (conditions, ctx) => {
    capturedContext = ctx;
    return origEvalAll(conditions, ctx);
  };

  const def = {
    ...createMixedSourceDefinition(),
    conditions: [{ id: 'merged-check', type: 'exists', field: 'sources._merged.data' }],
    triggers: [{ id: 'trig', condition_id: 'merged-check', edge: 'any', cooldown: 0, max_fires_per_day: 999 }],
    actions: [],
  };

  repo.createAgent({ id: 'merged-test', name: 'Merged', definition: def });
  await runner.execute('merged-test', { isManual: true });

  ok(capturedContext, 'Context should be captured');
  ok(capturedContext.sources._merged, '_merged should exist');
  eq(capturedContext.sources._merged.data.length, 3, 'Should have 3 merged items (2 RSS + 1 HTTP)');

  // Check _source field
  const rssItems = capturedContext.sources._merged.data.filter(i => i._source === 'rss_feed');
  const httpItems = capturedContext.sources._merged.data.filter(i => i._source === 'http_api');
  eq(rssItems.length, 2, 'Should have 2 RSS items in merged');
  eq(httpItems.length, 1, 'Should have 1 HTTP item in merged');
});

// ═══════════════════════════════════════════════════════════════════════════════
//  T3: Per-source mark_seen tracks independently
// ═══════════════════════════════════════════════════════════════════════════════

section('T3 — Per-source mark_seen tracks independently');

await t('mark_seen tracks RSS and HTTP sources separately', async () => {
  const repo = createMockRepository();
  const runner = new AgentRunner({ repository: repo, logger });

  runner.sourceHandlers.rss = async () => [
    { id: 'rss-a', title: 'RSS A' },
    { id: 'rss-b', title: 'RSS B' },
  ];
  runner.sourceHandlers.http = async () => [
    { id: 'http-x', title: 'HTTP X' },
  ];

  const def = createMixedSourceDefinition();
  repo.createAgent({ id: 'seen-test', name: 'Seen', definition: def });

  // First run (baseline)
  await runner.execute('seen-test', { isManual: true });

  // Check seen items per source
  const rssSeenIds = repo.getSeenItemIds('seen-test', 'rss_feed');
  const httpSeenIds = repo.getSeenItemIds('seen-test', 'http_api');

  eq(rssSeenIds.size, 2, `RSS should have 2 seen items, got ${rssSeenIds.size}`);
  ok(rssSeenIds.has('rss-a'), 'RSS should have rss-a');
  ok(rssSeenIds.has('rss-b'), 'RSS should have rss-b');
  eq(httpSeenIds.size, 1, `HTTP should have 1 seen item, got ${httpSeenIds.size}`);
  ok(httpSeenIds.has('http-x'), 'HTTP should have http-x');
});

await t('seen items from one source do not affect other source', async () => {
  const repo = createMockRepository();
  const runner = new AgentRunner({ repository: repo, logger });

  // Pre-mark some RSS items as seen
  repo.markItemSeen('cross-test', 'rss_feed', 'rss-1');

  runner.sourceHandlers.rss = async () => [
    { id: 'rss-1', title: 'Already seen' },
    { id: 'rss-2', title: 'New RSS' },
  ];
  runner.sourceHandlers.http = async () => [
    { id: 'rss-1', title: 'Same ID different source' }, // Same ID but different source
  ];

  const def = createMixedSourceDefinition();
  repo.createAgent({ id: 'cross-test', name: 'Cross', definition: def });

  let capturedContext = null;
  const origEvalAll = runner.conditions.evaluateAll.bind(runner.conditions);
  runner.conditions.evaluateAll = (conditions, ctx) => {
    capturedContext = ctx;
    return origEvalAll(conditions, ctx);
  };

  await runner.execute('cross-test', { isManual: true });

  // RSS should have filtered out rss-1 (already seen in rss_feed)
  eq(capturedContext.sources.rss_feed.filtered_count, 1, 'RSS should have 1 new item (rss-1 already seen)');
  // HTTP should NOT filter rss-1 (seen in rss_feed, not http_api)
  eq(capturedContext.sources.http_api.filtered_count, 1, 'HTTP should have 1 item (not filtered by RSS seen)');
});

// ═══════════════════════════════════════════════════════════════════════════════
//  T4: Partial failure — one source fails, others succeed
// ═══════════════════════════════════════════════════════════════════════════════

section('T4 — Partial failure isolation');

await t('one failing source does not block other sources', async () => {
  const repo = createMockRepository();
  const runner = new AgentRunner({ repository: repo, logger });

  runner.sourceHandlers.rss = async () => {
    throw new Error('Network timeout');
  };
  runner.sourceHandlers.http = async () => [
    { id: 'ok-1', title: 'HTTP OK' },
  ];

  const def = createMixedSourceDefinition();
  repo.createAgent({ id: 'partial-fail', name: 'Partial', definition: def });

  const result = await runner.execute('partial-fail', { isManual: true });
  // Should NOT be ERROR_SOURCE (not all sources failed)
  ok(result.run_state !== RUN_STATE.ERROR_SOURCE, `Should not be ERROR_SOURCE, got ${result.run_state}`);
});

await t('all sources failing returns ERROR_SOURCE', async () => {
  const repo = createMockRepository();
  const runner = new AgentRunner({ repository: repo, logger });

  runner.sourceHandlers.rss = async () => { throw new Error('RSS down'); };
  runner.sourceHandlers.http = async () => { throw new Error('HTTP down'); };

  const def = createMixedSourceDefinition();
  repo.createAgent({ id: 'all-fail', name: 'AllFail', definition: def });

  const result = await runner.execute('all-fail', { isManual: true });
  eq(result.run_state, RUN_STATE.ERROR_SOURCE, 'All sources failing should be ERROR_SOURCE');
});

await t('partial failure still creates _merged from successful sources', async () => {
  const repo = createMockRepository();
  const runner = new AgentRunner({ repository: repo, logger });

  runner.sourceHandlers.rss = async () => { throw new Error('RSS error'); };
  runner.sourceHandlers.http = async () => [
    { id: 'http-ok', title: 'Working' },
  ];

  let capturedContext = null;
  const origEvalAll = runner.conditions.evaluateAll.bind(runner.conditions);
  runner.conditions.evaluateAll = (conditions, ctx) => {
    capturedContext = ctx;
    return origEvalAll(conditions, ctx);
  };

  const def = createMixedSourceDefinition();
  repo.createAgent({ id: 'partial-merged', name: 'PartialMerged', definition: def });

  await runner.execute('partial-merged', { isManual: true });

  ok(capturedContext.sources.rss_feed.status === 'error', 'RSS should be errored');
  ok(capturedContext.sources.http_api.status === 'ok', 'HTTP should be OK');
  ok(capturedContext.sources._merged, '_merged should still exist');
  eq(capturedContext.sources._merged.data.length, 1, '_merged should have 1 item from HTTP');
});

// ═══════════════════════════════════════════════════════════════════════════════
//  T5: Conditions evaluate across merged multi-type data
// ═══════════════════════════════════════════════════════════════════════════════

section('T5 — Conditions on merged data');

await t('condition on _merged.data evaluates correctly', async () => {
  const repo = createMockRepository();
  const runner = new AgentRunner({ repository: repo, logger });

  runner.sourceHandlers.rss = async () => [{ id: 'r1', title: 'RSS' }];
  runner.sourceHandlers.http = async () => [{ id: 'h1', title: 'HTTP' }];

  const def = {
    ...createMixedSourceDefinition(),
    conditions: [
      { id: 'merged-exists', type: 'exists', field: 'sources._merged.data' },
    ],
    triggers: [
      { id: 'merged-trig', condition_id: 'merged-exists', edge: 'any', cooldown: 0, max_fires_per_day: 999 },
    ],
    actions: [],
  };

  repo.createAgent({ id: 'cond-merged', name: 'CondMerged', definition: def });

  // First run — baseline
  await runner.execute('cond-merged', { isManual: true });

  // Second run with new items
  runner.sourceHandlers.rss = async () => [{ id: 'r2', title: 'New RSS' }];
  runner.sourceHandlers.http = async () => [{ id: 'h2', title: 'New HTTP' }];

  const r2 = await runner.execute('cond-merged', { isManual: true });
  // Should have processed successfully (not no_new since there are new items)
  ok(
    r2.run_state === RUN_STATE.SUCCESS_TRIGGERED ||
    r2.run_state === RUN_STATE.SUCCESS_NO_TRIGGER,
    `Expected success state, got ${r2.run_state}`
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
//  T6: HUNTER pattern — no new items after mark_seen
// ═══════════════════════════════════════════════════════════════════════════════

section('T6 — HUNTER pattern across source types');

await t('second run with same items returns SUCCESS_NO_NEW', async () => {
  const repo = createMockRepository();
  const runner = new AgentRunner({ repository: repo, logger });

  const items = {
    rss: [{ id: 'rss-1', title: 'RSS Item' }],
    http: [{ id: 'http-1', title: 'HTTP Item' }],
  };

  runner.sourceHandlers.rss = async () => items.rss;
  runner.sourceHandlers.http = async () => items.http;

  const def = createMixedSourceDefinition();
  repo.createAgent({ id: 'hunter-multi', name: 'Hunter', definition: def });

  // Run 1: INIT_BASELINE (marks all items as seen)
  const r1 = await runner.execute('hunter-multi', { isManual: true });
  eq(r1.run_state, RUN_STATE.INIT_BASELINE, `First run should be INIT_BASELINE, got ${r1.run_state}`);

  // Run 2: Same items → SUCCESS_NO_NEW (all filtered by mark_seen)
  const r2 = await runner.execute('hunter-multi', { isManual: true });
  eq(r2.run_state, RUN_STATE.SUCCESS_NO_NEW, `Second run should be SUCCESS_NO_NEW, got ${r2.run_state}`);

  // Run 3: New item in ONE source → should process
  runner.sourceHandlers.rss = async () => [
    { id: 'rss-1', title: 'Old' },
    { id: 'rss-new', title: 'New RSS Item' },
  ];

  const r3 = await runner.execute('hunter-multi', { isManual: true });
  ok(r3.run_state !== RUN_STATE.SUCCESS_NO_NEW, `Third run should have new items, got ${r3.run_state}`);
});

await t('mark_seen idempotent across mixed sources', async () => {
  const repo = createMockRepository();
  const runner = new AgentRunner({ repository: repo, logger });

  runner.sourceHandlers.rss = async () => [{ id: 'same-id', title: 'RSS' }];
  runner.sourceHandlers.http = async () => [{ id: 'same-id', title: 'HTTP' }];

  const def = createMixedSourceDefinition();
  repo.createAgent({ id: 'idem-test', name: 'Idempotent', definition: def });

  await runner.execute('idem-test', { isManual: true });

  // Both sources should track 'same-id' independently
  ok(repo.isItemSeen('idem-test', 'rss_feed', 'same-id'), 'RSS should have same-id seen');
  ok(repo.isItemSeen('idem-test', 'http_api', 'same-id'), 'HTTP should have same-id seen');

  // Total count should be 2 (one per source)
  eq(repo.getSeenItemsCount('idem-test'), 2, 'Total seen should be 2');
});

// ═══════════════════════════════════════════════════════════════════════════════
//  T7: Example definition validation
// ═══════════════════════════════════════════════════════════════════════════════

section('T7 — Example definition validation');

await t('morning-briefing.json definition is valid for runner', async () => {
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const __dir = dirname(fileURLToPath(import.meta.url));
  const defPath = join(__dir, '..', 'src', 'agents', 'examples', 'morning-briefing.json');
  const def = JSON.parse(readFileSync(defPath, 'utf-8'));

  // Verify structure
  ok(Array.isArray(def.sources), 'Has sources array');
  eq(def.sources.length, 3, 'Has 3 sources');
  eq(def.sources[0].type, 'rss', 'First source is RSS');
  eq(def.sources[1].type, 'http', 'Second source is HTTP');
  eq(def.sources[2].type, 'http', 'Third source is HTTP');
  ok(def.conditions.length > 0, 'Has conditions');
  ok(def.triggers.length > 0, 'Has triggers');
  ok(def.actions.length > 0, 'Has actions');

  // Verify source IDs are unique
  const ids = def.sources.map(s => s.id);
  eq(new Set(ids).size, ids.length, 'Source IDs should be unique');

  // Verify all source types are supported
  const supportedTypes = ['http', 'rss', 'scraper', 'database'];
  for (const s of def.sources) {
    ok(supportedTypes.includes(s.type), `Source type '${s.type}' should be supported`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`  B6 Multi-Source Integration: ${passed}/${total} passed, ${failed} failed`);
console.log(`${'═'.repeat(60)}`);

if (failures.length > 0) {
  console.log('\nFailed tests:');
  for (const f of failures) {
    console.log(`  ❌ [${f.section}] ${f.name}: ${f.error}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
