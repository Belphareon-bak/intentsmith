// tests/e2e/08-agents.e2e.js — Agent platform read and retirement surface
// ═════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer, uniqueId } from './_helpers.js';

await waitForServer();

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
  actions: [{
    id: 'action-1',
    type: 'webhook',
    config: { url: '{{sources.source-1.data.redirect}}' },
  }],
};

suite('GET /api/agents — list');

await testAsync('returns agents list', async () => {
  const { status, data } = await api('GET', '/api/agents');
  assertEqual(status, 200);
  assert(Array.isArray(data.agents), 'agents must be array');
});

suite('Legacy agent mutation retirement');

for (const [method, path, body] of [
  ['POST', '/api/agents', { definition, enabled: false }],
  ['POST', '/api/agents/dry-run', { definition }],
  ['DELETE', `/api/agents/${agentId}`, undefined],
]) {
  await testAsync(`${method} ${path} returns the typed retirement terminal`, async () => {
    const { status, data } = await api(method, path, body);
    assertEqual(status, 410);
    assertEqual(data.code, 'LEGACY_AGENT_MUTATION_RETIRED');
    assertEqual(data.replacement, '/api/agent-extensions');
  });
}

suite('Read-only legacy agent surfaces');

await testAsync('GET nonexistent agent returns 404', async () => {
  const { status } = await api('GET', '/api/agents/nonexistent-agent-xyz');
  assertEqual(status, 404);
});

suite('Trust Metrics');

await testAsync('GET /api/trust/metrics returns data', async () => {
  const { status, data } = await api('GET', '/api/trust/metrics');
  assertEqual(status, 200);
  assert(Array.isArray(data.agents), 'trust agents must be array');
  assert(data.summary && typeof data.summary === 'object', 'trust summary required');
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
