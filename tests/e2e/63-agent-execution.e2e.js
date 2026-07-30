// tests/e2e/63-agent-execution.e2e.js — Agent control-plane contracts
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Local deterministic API, dry-run, error, and trust contracts.
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

const definition = {
  id: 'e2e-agent-control-plane',
  name: 'E2E Agent Control Plane',
  description: 'Local deterministic dry-run fixture',
  schedule: { type: 'manual' },
  sources: [{
    id: 'inventory',
    type: 'database',
    config: { table: 'user_inventory' },
  }],
  conditions: [],
  triggers: [],
  actions: [],
};

// ── Agent Platform Access ───────────────────────────────────────────────────
suite('Agent Execution — Access Check');

await testAsync('check agent platform access', async () => {
  const { status, data } = await api('GET', '/api/agents');
  assertEqual(status, 200);
  assert(Array.isArray(data.agents), 'agents must be an array');
});

// ── Manual Trigger ──────────────────────────────────────────────────────────
suite('Agent Execution — Manual Trigger');

await testAsync('dry-run agent execution', async () => {
  const { status, data } = await api('POST', '/api/agents/dry-run', { definition });
  assertEqual(status, 200);
  assertEqual(data.valid, true);
  assert(Array.isArray(data.errors) && data.errors.length === 0, 'dry-run errors must be empty');
  assert(Array.isArray(data.warnings) && data.warnings.length === 0, 'dry-run warnings must be empty');
  assertEqual(data.preview?.sources?.length, 1);
  assertEqual(data.preview.sources[0].id, 'src-1');
  assertEqual(data.preview.sources[0].type, 'database');
  assertEqual(data.preview.sources[0].valid, true);
  assertEqual(data.preview.sources[0].description, 'Database query');
  assertEqual(data.preview.conditions.length, 0);
  assertEqual(data.preview.triggers.length, 0);
  assertEqual(data.preview.actions.length, 0);
  assertEqual(data.preview.schedule.type, 'manual');
  assertEqual(data.preview.schedule.description, 'Manual trigger only');
});

// ── Execution History ───────────────────────────────────────────────────────
suite('Agent Execution — History');

await testAsync('GET nonexistent agent returns exact 404', async () => {
  const { status, data } = await api('GET', '/api/agents/nonexistent-agent-xyz');
  assertEqual(status, 404);
  assert(typeof data.error === 'string' && data.error.length > 0, 'agent error required');
});

await testAsync('GET execution for nonexistent returns 404', async () => {
  const { status, data } = await api('GET', '/api/skills/executions/nonexistent-xyz');
  assertEqual(status, 404);
  assert(typeof data.error === 'string' && data.error.length > 0, 'execution error required');
});

// ── Trust Metrics ───────────────────────────────────────────────────────────
suite('Agent Execution — Trust');

await testAsync('trust metrics accessible', async () => {
  const { status, data } = await api('GET', '/api/trust/metrics');
  assertEqual(status, 200);
  assert(Array.isArray(data.agents), 'trust agents must be an array');
  assert(data.summary && typeof data.summary === 'object', 'trust summary required');
  for (const key of ['total', 'healthy', 'degraded', 'critical', 'insufficient']) {
    assert(
      Number.isInteger(data.summary[key]) && data.summary[key] >= 0,
      `trust summary ${key} must be a non-negative integer`,
    );
  }
  assertEqual(data.summary.total, data.agents.length);
  assertEqual(
    data.summary.healthy
      + data.summary.degraded
      + data.summary.critical
      + data.summary.insufficient,
    data.summary.total,
  );
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
