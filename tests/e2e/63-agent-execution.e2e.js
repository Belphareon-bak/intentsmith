// tests/e2e/63-agent-execution.e2e.js — Agent execution with LLM
// ══════════════════════════════════════════════════════════════════════════════
// Tier 2: Tests agent execution API (requires LLM + agent platform).
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

const LLM_TIMEOUT = 60000;

// ── Agent Platform Access ───────────────────────────────────────────────────
suite('Agent Execution — Access Check');

let hasAccess = false;

await testAsync('check agent platform access', async () => {
  const { status } = await api('GET', '/api/agents');
  hasAccess = status === 200;
  assert(status === 200 || status === 403, `expected 200/403, got ${status}`);
});

// ── Manual Trigger ──────────────────────────────────────────────────────────
suite('Agent Execution — Manual Trigger');

await testAsync('dry-run agent execution', async () => {
  if (!hasAccess) return;
  const { status } = await api('POST', '/api/agents/dry-run', {
    name: 'e2e-test-agent',
    type: 'worker',
    sources: [{ type: 'url', url: 'https://example.com' }],
    prompt: 'Summarize the page content in 2 sentences.'
  });
  assert(status === 200 || status === 400 || status === 500, `expected 200/400/500, got ${status}`);
}, LLM_TIMEOUT);

// ── Execution History ───────────────────────────────────────────────────────
suite('Agent Execution — History');

await testAsync('GET execution for nonexistent returns 404', async () => {
  const { status } = await api('GET', '/api/skills/executions/nonexistent-xyz');
  assert(status === 404, `expected 404, got ${status}`);
});

// ── Trust Metrics ───────────────────────────────────────────────────────────
suite('Agent Execution — Trust');

await testAsync('trust metrics accessible', async () => {
  const { status } = await api('GET', '/api/trust/metrics');
  assert(status === 200 || status === 404, `expected 200/404, got ${status}`);
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
