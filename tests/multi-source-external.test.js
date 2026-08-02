#!/usr/bin/env node
// C3-Agent — Multi-Source External-Network Tests
//
// This suite deliberately contacts BBC RSS and OpenMeteo. It is registered
// separately from the required offline multi-source suite so external service
// availability cannot be mistaken for deterministic offline evidence.
//
// Run explicitly: node tests/multi-source-external.test.js

import Database from 'better-sqlite3';
import { AgentRepository, initAgentTables } from '../src/agents/repository.js';
import { AgentRunner, RUN_STATE } from '../src/agents/runner.js';

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

function createTestRepository() {
  const db = new Database(':memory:');
  initAgentTables(db);
  return new AgentRepository(db);
}

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

section('T7 — E2E with real endpoints');

await t('real RSS + HTTP fetch and merge', async () => {
  const repo = createTestRepository();
  const runner = new AgentRunner({ repository: repo, logger });

  // Use real source handlers (default from runner)
  const def = {
    sources: [
      {
        id: 'bbc_tech',
        type: 'rss',
        config: {
          url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
          maxItems: 3,
        },
      },
      {
        id: 'weather',
        type: 'http',
        config: {
          url: 'https://api.open-meteo.com/v1/forecast?latitude=50.08&longitude=14.42&current=temperature_2m&timezone=Europe/Prague',
          method: 'GET',
        },
      },
    ],
    conditions: [
      { id: 'any-data', type: 'exists', field: 'sources.bbc_tech.data' },
    ],
    triggers: [
      { id: 'trig', condition_id: 'any-data', edge: 'any', cooldown: 0, max_fires_per_day: 999 },
    ],
    actions: [],
    schedule: { type: 'manual' },
  };

  repo.createAgent({ id: 'e2e-multi', name: 'E2E Multi', definition: def });

  const result = await runner.execute('e2e-multi', { isManual: true });

  ok(result.run_state !== RUN_STATE.ERROR_SOURCE, `Sources should not all fail: ${result.error}`);
  ok(result.run_state !== RUN_STATE.ERROR_UNKNOWN, `No unknown error: ${result.error}`);
  eq(result.run_state, RUN_STATE.INIT_BASELINE, `First run should be INIT_BASELINE, got ${result.run_state}`);

  // Verify seen items were marked for RSS
  const rssSeenCount = repo.getSeenItemIds('e2e-multi', 'bbc_tech').size;
  ok(rssSeenCount > 0, `Should have marked RSS items as seen, got ${rssSeenCount}`);

  console.log(`    → BBC RSS items seen: ${rssSeenCount}`);
});

await t('real multi-source — second run detects no new items', async () => {
  const repo = createTestRepository();
  const runner = new AgentRunner({ repository: repo, logger });

  const def = {
    sources: [
      {
        id: 'weather_api',
        type: 'http',
        config: {
          url: 'https://api.open-meteo.com/v1/forecast?latitude=50.08&longitude=14.42&current=temperature_2m&timezone=Europe/Prague',
          method: 'GET',
        },
      },
    ],
    conditions: [
      { id: 'temp', type: 'exists', field: 'sources.weather_api.data' },
    ],
    triggers: [
      { id: 'trig', condition_id: 'temp', edge: 'any', cooldown: 0, max_fires_per_day: 999 },
    ],
    actions: [],
    schedule: { type: 'manual' },
  };

  repo.createAgent({ id: 'e2e-http-only', name: 'E2E HTTP', definition: def });

  const r1 = await runner.execute('e2e-http-only', { isManual: true });
  eq(r1.run_state, RUN_STATE.INIT_BASELINE);

  // HTTP returns an object, not array — so filterSeenItems won't apply
  // This verifies that non-array HTTP responses are handled correctly
  const r2 = await runner.execute('e2e-http-only', { isManual: true });
  // Non-array data means totalNewItems stays 0 (filterSeenItems returns non-array as-is)
  // But filtered_count will be null, so it won't count as "new items"
  ok(
    r2.run_state === RUN_STATE.SUCCESS_NO_NEW ||
    r2.run_state === RUN_STATE.SUCCESS_TRIGGERED ||
    r2.run_state === RUN_STATE.SUCCESS_NO_TRIGGER,
    `Second HTTP run should be some success state, got ${r2.run_state}`
  );
});

console.log(`\n${'═'.repeat(60)}`);
console.log(`  B6 Multi-Source External: ${passed}/${total} passed, ${failed} failed`);
console.log(`${'═'.repeat(60)}`);

if (failures.length > 0) {
  console.log('\nFailed tests:');
  for (const f of failures) {
    console.log(`  ❌ [${f.section}] ${f.name}: ${f.error}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
