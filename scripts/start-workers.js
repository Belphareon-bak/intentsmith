#!/usr/bin/env node
// C.3 Phase B — Start Workers Script (B8)
// ══════════════════════════════════════════════════════════════════════════════
//
// Registers 3 worker agents in the DB (if not already present) and starts
// the scheduler for 24/7 operation.
//
// Usage:
//   node scripts/start-workers.js
//
// Required env vars for notifications:
//   C3_TELEGRAM_BOT_TOKEN, C3_TELEGRAM_CHAT_ID     (for Telegram)
//   C3_SMTP_HOST, C3_SMTP_USER, C3_SMTP_PASS       (for Email)
//   C3_NTFY_TOPIC                                   (for Push)
//
// ══════════════════════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { AgentRepository, initAgentTables } from '../src/agents/repository.js';
import { AgentRunner } from '../src/agents/runner.js';
import { AgentScheduler } from '../src/agents/scheduler.js';
import { createNotificationPipeline } from '../src/notifications/index.js';
import { initNotificationTables } from '../src/notifications/db.js';
import { logger } from '../src/core/logger.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../data/c3.db');

console.log('═══════════════════════════════════════════════════════════');
console.log(' C3 Worker Manager — Phase B');
console.log('═══════════════════════════════════════════════════════════\n');

// ── Database setup ───────────────────────────────────────────────────────────
console.log(`Database: ${DB_PATH}`);
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

initAgentTables(db);
initNotificationTables(db);

const repo = new AgentRepository(db);
const { pipeline, router } = createNotificationPipeline({ db });

// ── Check notification channels ──────────────────────────────────────────────
console.log('\nNotification channels:');
for (const name of router.getAvailableChannels()) {
  console.log(`  - ${name}`);
}

const hasTelegram = !!(process.env.C3_TELEGRAM_BOT_TOKEN && process.env.C3_TELEGRAM_CHAT_ID);
const hasEmail = !!(process.env.C3_SMTP_HOST && process.env.C3_SMTP_USER);
const hasPush = !!process.env.C3_NTFY_TOPIC;

console.log(`\n  Telegram: ${hasTelegram ? '✅ configured' : '❌ not configured'}`);
console.log(`  Email: ${hasEmail ? '✅ configured' : '❌ not configured'}`);
console.log(`  Push: ${hasPush ? '✅ configured' : '❌ not configured'}`);

if (!hasTelegram && !hasEmail && !hasPush) {
  console.log('\n⚠️  No notification channels configured. Agents will run but cannot deliver notifications.');
  console.log('   Set C3_TELEGRAM_BOT_TOKEN + C3_TELEGRAM_CHAT_ID for Telegram notifications.');
}

// ── Register worker agents ───────────────────────────────────────────────────
console.log('\n── Registering agents ──');

const agentFiles = [
  '../src/agents/examples/weather-monitor.json',
  '../src/agents/examples/realty-watcher.json',
  '../src/agents/examples/news-rss-digest.json',
];

for (const file of agentFiles) {
  try {
    const def = JSON.parse(readFileSync(resolve(__dirname, file), 'utf-8'));
    const existing = repo.getAgent(def.id);

    if (existing) {
      console.log(`  ✓ ${def.icon} ${def.name} (${def.id}) — already exists`);
    } else {
      repo.createAgent({
        id: def.id,
        name: def.name,
        description: def.description,
        icon: def.icon,
        definition: def,
        enabled: true,
      });
      console.log(`  + ${def.icon} ${def.name} (${def.id}) — created`);
    }
  } catch (err) {
    console.log(`  ✗ ${file}: ${err.message}`);
  }
}

// ── Create runner and scheduler ──────────────────────────────────────────────
const runner = new AgentRunner({
  repository: repo,
  notificationRouter: router,
  notificationPipeline: pipeline,
  logger,
});

const scheduler = new AgentScheduler({
  repository: repo,
  runner,
  logger,
});

// ── List all agents ──────────────────────────────────────────────────────────
console.log('\n── Active agents ──');
const agents = repo.getAllAgents();
for (const a of agents) {
  const schedule = a.definition?.schedule;
  const scheduleStr = schedule?.type === 'cron'
    ? `cron: ${schedule.value}`
    : `every ${schedule?.value || '?'}`;
  const channel = a.definition?.actions?.find(act => act.type === 'notify')?.config?.channel || 'in_app';
  console.log(`  ${a.icon} ${a.name} — ${scheduleStr} → ${channel}`);
}

// ── Run each agent once immediately ──────────────────────────────────────────
console.log('\n── Initial run ──');
for (const a of agents) {
  try {
    console.log(`\n  Running: ${a.icon} ${a.name}...`);
    const result = await runner.execute(a.id);
    console.log(`  → ${result.run_state}`);

    if (result.run_state === 'ERROR_SOURCE') {
      console.log(`    ⚠️ Source error: ${result.error}`);
    } else if (result.run_state === 'SUCCESS_TRIGGERED') {
      console.log(`    🔔 Triggers fired! Notifications sent.`);
    } else if (result.run_state === 'INIT_BASELINE') {
      console.log(`    📊 Baseline established (first run).`);
    }
  } catch (err) {
    console.log(`  → ERROR: ${err.message}`);
  }
}

// ── Start scheduler ──────────────────────────────────────────────────────────
console.log('\n── Starting scheduler ──');
scheduler.start();
console.log('  Scheduler running. Checking agents every 30 seconds.');
console.log('  Press Ctrl+C to stop.\n');

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down...');
  scheduler.stop();
  db.close();
  console.log('Bye! 👋');
  process.exit(0);
});

process.on('SIGTERM', () => {
  scheduler.stop();
  db.close();
  process.exit(0);
});
