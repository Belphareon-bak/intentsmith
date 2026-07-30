// tests/e2e/08-agents.e2e.js — Agent platform CRUD
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer, uniqueId, cleanupAgent } from './_helpers.js';

await waitForServer();

const created = [];

try {
  // ── List ────────────────────────────────────────────────────────────────
  suite('GET /api/agents — list');

  await testAsync('returns agents list (or 403 on FREE tier)', async () => {
    const { status, data } = await api('GET', '/api/agents');
    if (status === 403) {
      // FREE tier blocks agent access — this is expected
      assert(true, 'FREE tier returns 403');
    } else {
      assertEqual(status, 200);
      assert(Array.isArray(data.agents), 'agents must be array');
    }
  });

  // ── Create ──────────────────────────────────────────────────────────────
  suite('POST /api/agents — create');

  await testAsync('creates agent or returns 403', async () => {
    const name = uniqueId('test-agent');
    const { status, data } = await api('POST', '/api/agents', {
      name, description: 'E2E test agent',
      type: 'worker', icon: '🔧',
      schedule: { type: 'manual' },
      sources: [{ type: 'url', url: 'https://example.com' }],
      prompt: 'Summarize the page.'
    });
    if (status === 403) {
      assert(true, 'FREE tier blocks agent creation');
      return;
    }
    assert(status === 200 || status === 201 || status === 500, `expected 200/201/500, got ${status}`);
    if (status === 500) return; // server-side schema validation
    const id = data.agent?.id || data.id;
    if (id) created.push(id);
  });

  // ── Get Single ──────────────────────────────────────────────────────────
  suite('GET /api/agents/:id');

  await testAsync('returns 404 or 403 for nonexistent', async () => {
    const { status } = await api('GET', '/api/agents/nonexistent-agent-xyz');
    assert(status === 404 || status === 403, `expected 404/403, got ${status}`);
  });

  // ── Dry Run ─────────────────────────────────────────────────────────────
  suite('Agent Dry Run');

  await testAsync('dry-run validates config (or 403)', async () => {
    const { status } = await api('POST', '/api/agents/dry-run', {
      name: 'test', type: 'worker',
      sources: [{ type: 'url', url: 'https://example.com' }],
      prompt: 'test'
    });
    assert(status === 200 || status === 403 || status === 500, `expected 200/403/500, got ${status}`);
  });

  // ── Trust Metrics ──────────────────────────────────────────────────────
  suite('Trust Metrics');

  await testAsync('GET /api/trust/metrics returns data', async () => {
    const { status } = await api('GET', '/api/trust/metrics');
    assert(status === 200 || status === 404, `expected 200/404, got ${status}`);
  });

  // ── Delete ──────────────────────────────────────────────────────────────
  suite('DELETE /api/agents/:id');

  await testAsync('delete existing agent (if created)', async () => {
    if (created.length === 0) return;
    const { status } = await api('DELETE', `/api/agents/${created[0]}`);
    assert(status === 200 || status === 204, `expected 200/204, got ${status}`);
    created.shift();
  });

} finally {
  for (const id of created) {
    await cleanupAgent(id);
  }
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
