// tests/e2e/08-agents.e2e.js — Agent platform CRUD
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer, uniqueId, cleanupAgent } from './_helpers.js';

await waitForServer();

const created = [];
const agentId = uniqueId('test-agent');
const definition = {
  id: agentId,
  name: 'E2E Test Agent',
  description: 'Deterministic E2E fixture',
  schedule: { type: 'manual' },
  sources: [{
    id: 'source-1',
    type: 'http',
    config: { url: 'https://example.com', method: 'GET' },
  }],
  conditions: [],
  triggers: [],
  actions: [],
};

try {
  // ── List ────────────────────────────────────────────────────────────────
  suite('GET /api/agents — list');

  await testAsync('returns agents list', async () => {
    const { status, data } = await api('GET', '/api/agents');
    assertEqual(status, 200);
    assert(Array.isArray(data.agents), 'agents must be array');
  });

  // ── Create ──────────────────────────────────────────────────────────────
  suite('POST /api/agents — create');

  await testAsync('creates a disabled agent from a valid definition', async () => {
    const { status, data } = await api('POST', '/api/agents', {
      definition,
      enabled: false,
    });
    assertEqual(status, 201);
    assertEqual(data.id, agentId);
    created.push(data.id);
  });

  // ── Get Single ──────────────────────────────────────────────────────────
  suite('GET /api/agents/:id');

  await testAsync('returns 404 for nonexistent', async () => {
    const { status } = await api('GET', '/api/agents/nonexistent-agent-xyz');
    assertEqual(status, 404);
  });

  // ── Dry Run ─────────────────────────────────────────────────────────────
  suite('Agent Dry Run');

  await testAsync('dry-run validates config without executing sources', async () => {
    const { status, data } = await api('POST', '/api/agents/dry-run', { definition });
    assertEqual(status, 200);
    assertEqual(data.valid, true);
    assert(Array.isArray(data.errors) && data.errors.length === 0, 'dry-run errors must be empty');
    assertEqual(data.preview?.sources?.length, 1);
  });

  // ── Trust Metrics ──────────────────────────────────────────────────────
  suite('Trust Metrics');

  await testAsync('GET /api/trust/metrics returns data', async () => {
    const { status, data } = await api('GET', '/api/trust/metrics');
    assertEqual(status, 200);
    assert(Array.isArray(data.agents), 'trust agents must be array');
    assert(data.summary && typeof data.summary === 'object', 'trust summary required');
  });

  // ── Delete ──────────────────────────────────────────────────────────────
  suite('DELETE /api/agents/:id');

  await testAsync('delete existing agent', async () => {
    const { status, data } = await api('DELETE', `/api/agents/${created[0]}`);
    assertEqual(status, 200);
    assertEqual(data.success, true);
    created.shift();
  });

} finally {
  for (const id of created) {
    await cleanupAgent(id);
  }
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
