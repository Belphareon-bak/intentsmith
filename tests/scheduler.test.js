import { strict as assert } from 'assert';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { AgentRepository, initAgentTables } from '../src/agents/repository.js';
import { AgentRunner } from '../src/agents/runner.js';
import { AgentScheduler } from '../src/agents/scheduler.js';
import { validateAgentDefinition } from '../src/agents/schema.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mockLogger = {
  info() {},
  warn() {},
  error() {},
};

console.log('\n⏱️ Scheduler');

await asyncTest('T1: triggerAgent marks manual runs as in-flight and clears them', async () => {
  const gate = deferred();
  const calls = [];
  const repo = {
    getDueAgents: () => [],
    getAllAgents: () => [],
    getSchedule: () => null,
  };
  const runner = {
    execute: async (agentId, opts) => {
      calls.push({ agentId, opts });
      await gate.promise;
      return { ok: true };
    },
  };

  const scheduler = new AgentScheduler({ repository: repo, runner, logger: mockLogger });
  const firstRun = scheduler.triggerAgent('agent-1');
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.deepEqual(scheduler.getStatus().runningAgents, ['agent-1']);
  await assert.rejects(() => scheduler.triggerAgent('agent-1'), /already running/);

  gate.resolve();
  await firstRun;

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].opts, { isManual: true });
  assert.equal(scheduler.getStatus().runningAgents.length, 0);
});

await asyncTest('T2: checkDue skips scheduled execution while manual run is active', async () => {
  const gate = deferred();
  let executeCalls = 0;
  const dueSchedule = { agent_id: 'agent-2', interval_ms: 60000 };
  const repo = {
    getDueAgents: () => [dueSchedule],
    getAllAgents: () => [],
    getSchedule: () => null,
    updateLastRun() {},
  };
  const runner = {
    execute: async () => {
      executeCalls++;
      await gate.promise;
      return { ok: true };
    },
  };

  const scheduler = new AgentScheduler({ repository: repo, runner, logger: mockLogger });
  scheduler.running = true;

  const manualRun = scheduler.triggerAgent('agent-2');
  await new Promise(resolve => setTimeout(resolve, 10));
  await scheduler.checkDue();

  assert.equal(executeCalls, 1, 'scheduled run should be skipped while manual run is active');

  gate.resolve();
  await manualRun;
});

test('T3: getStatus reports running agents from the in-flight guard', () => {
  const repo = {
    getAllAgents: () => [],
    getSchedule: () => null,
  };
  const runner = { execute: async () => ({ ok: true }) };
  const scheduler = new AgentScheduler({ repository: repo, runner, logger: mockLogger });

  scheduler.runningAgents.add('agent-3');
  const status = scheduler.getStatus();

  assert.deepEqual(status.runningAgents, ['agent-3']);
});

await asyncTest('T4: real SQLite repository selects only enabled due ISO schedules', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    initAgentTables(db);
    const repo = new AgentRepository(db);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 86_400_000);
    for (const [id, enabled, nextRun] of [
      ['due', true, today],
      ['future', true, tomorrow],
      ['disabled', false, today],
    ]) {
      repo.createAgent({ id, name: id,
        definition: { schedule: { type: 'interval', value: '5m' } }, enabled });
      repo.setSchedule(id, { nextRun: nextRun.toISOString(), intervalMs: 300_000 });
    }
    repo.createAgent({ id: 'malformed', name: 'malformed',
      definition: { schedule: { type: 'interval', value: '5m' } }, enabled: true });
    repo.setSchedule('malformed', { nextRun: 'not-a-timestamp', intervalMs: 300_000 });

    assert.deepEqual(repo.getDueAgents().map(row => row.agent_id), ['due']);
    const calls = [];
    const scheduler = new AgentScheduler({ repository: repo,
      runner: { execute: async id => { calls.push(id); } }, logger: mockLogger });
    scheduler.running = true;
    await scheduler.checkDue();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['due']);
    assert.equal(repo.getSchedule('due').interval_ms, 300_000);
  } finally {
    db.close();
  }
});

await asyncTest('T5: runner uses the validated schedule value for preview and cooldown', async () => {
  const now = new Date('2026-09-30T12:02:00.000Z');
  const runner = new AgentRunner({ repository: {}, logger: mockLogger, clock: () => now });
  const schedule = { type: 'interval', value: '5m' };
  const agent = { definition: { schedule }, state: { _last_run: '2026-09-30T12:00:00.000Z' } };
  const definition = JSON.parse(readFileSync(
    new URL('../agent-extensions/project-health/agent.json', import.meta.url), 'utf8'))
    .payload.definition;
  definition.schedule = schedule;
  const schemaValidation = validateAgentDefinition(definition);
  assert.equal(schemaValidation.valid, true, JSON.stringify(schemaValidation.errors));
  const preview = await runner.dryRun(definition);
  assert.equal(preview.errors.some(error => error.field === 'schedule'), false,
    JSON.stringify(preview.errors));
  assert.deepEqual(preview.preview.schedule,
    { type: 'interval', interval: '5m', description: 'Run every 5m' });
  assert.deepEqual(runner.validateSchedule(schedule), { valid: true });
  assert.equal(runner.validateSchedule({ type: 'interval', value: '1m' }).valid, false);
  assert.deepEqual(runner.validateSchedule({ type: 'cron', value: '0 8 * * *' }), { valid: true });
  assert.equal(runner.validateSchedule({ type: 'cron', value: '0 8 *' }).valid, false);
  assert.equal(runner.describeSchedule(schedule), 'Run every 5m');
  assert.equal(runner.describeSchedule({ type: 'cron', value: '0 8 * * *' }), 'Cron: 0 8 * * *');
  assert.equal(runner.checkCooldown(agent), false);
  assert.equal(runner.calculateNextRun(agent), '2026-09-30T12:05:00.000Z');
  now.setUTCMinutes(5);
  assert.equal(runner.checkCooldown(agent), true);
});

await asyncTest('T6: a new scheduler instance recovers an overdue interval from real SQLite', async () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    initAgentTables(db);
    const repo = new AgentRepository(db);
    const agent = repo.createAgent({ id: 'restart-due', name: 'Restart due',
      definition: { schedule: { type: 'interval', value: '5m' } },
      state: { _last_run: new Date(Date.now() - 600_000).toISOString() },
      enabled: true });
    const initial = new AgentScheduler({ repository: repo,
      runner: { execute: async () => {} }, logger: mockLogger });
    assert.equal(initial.scheduleAgent(agent), true);
    assert.equal(repo.getSchedule(agent.id).interval_ms, 300_000);

    const calls = [];
    const recovered = new AgentScheduler({ repository: new AgentRepository(db),
      runner: { execute: async id => { calls.push(id); } }, logger: mockLogger });
    recovered.running = true;
    await recovered.checkDue();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [agent.id]);
    assert.deepEqual(repo.getDueAgents().map(row => row.agent_id), []);
  } finally {
    db.close();
  }
});

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Scheduler Tests: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(60)}\n`);

process.exit(failed > 0 ? 1 : 0);
