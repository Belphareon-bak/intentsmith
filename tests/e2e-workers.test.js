// C.3 Phase B — E2E Worker Tests (B8)
// ══════════════════════════════════════════════════════════════════════════════
//
// Creates all 3 real worker agents in an in-memory DB, runs them once,
// and verifies they produce expected output.
//
// Run: node tests/e2e-workers.test.js
//
// For real notifications, set: C3_TELEGRAM_BOT_TOKEN, C3_TELEGRAM_CHAT_ID
// ══════════════════════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { AgentRepository, initAgentTables } from '../src/agents/repository.js';
import { AgentRunner } from '../src/agents/runner.js';
import { createNotificationPipeline, createNotificationRouter } from '../src/notifications/index.js';
import { initNotificationTables } from '../src/notifications/db.js';
import { readFileSync } from 'fs';

let passed = 0;
let failed = 0;
let skipped = 0;
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

function skip(name, reason) {
  console.log(`  ⏭️  ${name}: SKIPPED (${reason})`);
  skipped++;
}

function assert(condition, name, detail = '') {
  if (condition) pass(name);
  else fail(name, detail || 'assertion failed');
}

const logger = {
  info: (...args) => console.log('    [INFO]', ...args),
  warn: (...args) => console.log('    [WARN]', ...args),
  error: (...args) => console.log('    [ERROR]', ...args),
  debug: () => {},
};

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════ B8: E2E Worker Tests ══════');

// Setup in-memory DB
const db = new Database(':memory:');
initAgentTables(db);
initNotificationTables(db);

const repo = new AgentRepository(db);
const { pipeline, router } = createNotificationPipeline({ db });

const runner = new AgentRunner({
  repository: repo,
  notificationRouter: router,
  notificationPipeline: pipeline,
  logger,
});

// ── 1. Worker 1: Weather Monitor → Telegram ──
console.log('\n── 1. Weather Monitor (OpenMeteo → Telegram) ──');

{
  const weatherDef = JSON.parse(readFileSync(
    new URL('../src/agents/examples/weather-monitor.json', import.meta.url), 'utf-8'
  ));

  try {
    repo.createAgent({
      id: weatherDef.id,
      name: weatherDef.name,
      description: weatherDef.description,
      icon: weatherDef.icon,
      definition: weatherDef,
      enabled: true,
    });
    pass('Weather agent created in DB');
  } catch (err) {
    fail('Weather agent created in DB', err.message);
  }

  try {
    const result = await runner.execute(weatherDef.id);
    assert(result !== null, 'Weather agent executed');
    assert(
      result.run_state !== 'ERROR_SOURCE' && result.run_state !== 'SKIP_SCHEMA_BROKEN',
      'Weather source fetched OK',
      `run_state=${result.run_state}, error=${result.error}`
    );

    // Log the temperature for visibility
    if (result.explain?.sources?.weather?.data?.current) {
      const temp = result.explain.sources.weather.data.current.temperature_2m;
      console.log(`    → Current temperature in Prague: ${temp}°C`);
      assert(typeof temp === 'number', 'Temperature is a number');
    }

    console.log(`    → Run state: ${result.run_state}`);
    if (result.run_state === 'SUCCESS_TRIGGERED') {
      console.log('    → FROST ALERT TRIGGERED! Temperature below 0°C.');
    }
  } catch (err) {
    fail('Weather agent execution', err.message);
  }
}

// ── 2. Worker 2: Realty Watcher → Email ──
console.log('\n── 2. Realty Watcher (HTTP → Email) ──');

{
  const realtyDef = JSON.parse(readFileSync(
    new URL('../src/agents/examples/realty-watcher.json', import.meta.url), 'utf-8'
  ));

  try {
    repo.createAgent({
      id: realtyDef.id,
      name: realtyDef.name,
      description: realtyDef.description,
      icon: realtyDef.icon,
      definition: realtyDef,
      enabled: true,
    });
    pass('Realty agent created in DB');
  } catch (err) {
    fail('Realty agent created in DB', err.message);
  }

  try {
    const result = await runner.execute(realtyDef.id);
    assert(result !== null, 'Realty agent executed');
    // Note: Sreality may block or rate-limit, so source error is acceptable
    console.log(`    → Run state: ${result.run_state}`);
    if (result.run_state === 'ERROR_SOURCE') {
      skip('Realty source fetch', 'Sreality API may be blocked/unavailable');
    } else {
      pass('Realty source fetched OK');
    }
  } catch (err) {
    fail('Realty agent execution', err.message);
  }
}

// ── 3. Worker 3: News RSS Digest → Telegram ──
console.log('\n── 3. News RSS Digest (RSS → Telegram) ──');

{
  const newsDef = JSON.parse(readFileSync(
    new URL('../src/agents/examples/news-rss-digest.json', import.meta.url), 'utf-8'
  ));

  try {
    repo.createAgent({
      id: newsDef.id,
      name: newsDef.name,
      description: newsDef.description,
      icon: newsDef.icon,
      definition: newsDef,
      enabled: true,
    });
    pass('News agent created in DB');
  } catch (err) {
    fail('News agent created in DB', err.message);
  }

  try {
    const result = await runner.execute(newsDef.id);
    assert(result !== null, 'News agent executed');
    console.log(`    → Run state: ${result.run_state}`);

    if (result.run_state === 'ERROR_SOURCE') {
      skip('News RSS fetch', 'RSS feeds may be blocked/unavailable');
    } else {
      pass('News RSS sources fetched OK');
      // Check how many items were found
      const src1 = result.explain?.sources?.['novinky-rss'];
      const src2 = result.explain?.sources?.['technet-rss'];
      if (src1) console.log(`    → novinky-rss: ${src1.filtered_count || 0} items (${src1.raw_count || 0} raw)`);
      if (src2) console.log(`    → technet-rss: ${src2.filtered_count || 0} items (${src2.raw_count || 0} raw)`);
    }
  } catch (err) {
    fail('News agent execution', err.message);
  }
}

// ── 4. Multi-source Realty (from B6) ──
console.log('\n── 4. Multi-Source Realty ──');

{
  const multiDef = JSON.parse(readFileSync(
    new URL('../src/agents/examples/realty-multi-source.json', import.meta.url), 'utf-8'
  ));

  try {
    repo.createAgent({
      id: multiDef.id,
      name: multiDef.name,
      description: multiDef.description,
      icon: multiDef.icon,
      definition: multiDef,
      enabled: true,
    });
    pass('Multi-source realty agent created in DB');
  } catch (err) {
    fail('Multi-source realty agent created', err.message);
  }

  try {
    const result = await runner.execute(multiDef.id);
    assert(result !== null, 'Multi-source agent executed');
    console.log(`    → Run state: ${result.run_state}`);
    if (result.run_state === 'ERROR_SOURCE') {
      skip('Multi-source fetch', 'APIs may be blocked/unavailable');
    } else {
      pass('Multi-source executed OK');
    }
  } catch (err) {
    fail('Multi-source execution', err.message);
  }
}

// ── 5. Agent listing ──
console.log('\n── 5. Agent Registry ──');

{
  const agents = repo.getAllAgents(true);
  assert(agents.length >= 3, `${agents.length} agents in DB`, `count=${agents.length}`);
  for (const a of agents) {
    console.log(`    → ${a.icon} ${a.name} (${a.id}) — enabled: ${a.enabled}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Summary
console.log(`\n${'═'.repeat(60)}`);
console.log(`E2E Workers: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ❌ ${f.name}: ${f.msg}`);
  }
}
console.log('');

db.close();
process.exit(failed > 0 ? 1 : 0);
