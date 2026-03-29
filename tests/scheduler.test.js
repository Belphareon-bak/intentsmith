import { strict as assert } from 'assert';
import { AgentScheduler } from '../src/agents/scheduler.js';

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

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Scheduler Tests: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(60)}\n`);

process.exit(failed > 0 ? 1 : 0);
