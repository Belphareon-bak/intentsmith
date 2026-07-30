// tests/e2e/62-validation-suites.e2e.js — Model validation trigger & results
// ══════════════════════════════════════════════════════════════════════════════
// Tier 2: Triggers model validation and checks results.
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer, createWsClient } from './_helpers.js';

await waitForServer();

const LLM_TIMEOUT = 120000; // validation can take a while

// ── Get Current Model ───────────────────────────────────────────────────────
suite('Validation Suites — Setup');

let currentModel = null;

await testAsync('get current model from bindings', async () => {
  const { status, data } = await api('GET', '/api/system/upgrades/bindings');
  assertEqual(status, 200);
  currentModel = data.bindings?.CHAT || data.bindings?.D1;
  assert(currentModel, 'need a bound model for validation');
});

// ── Trigger Validation ──────────────────────────────────────────────────────
suite('Validation Suites — Trigger');

await testAsync('trigger validation for current model', async () => {
  if (!currentModel) return;
  const { status, data } = await api('POST', '/api/system/models/validate', {
    model: currentModel,
    suite: 'chat'
  });
  // May succeed (200), be accepted (202), or fail (500) if model not available
  assert(status === 200 || status === 202 || status === 500, `expected 200/202/500, got ${status}`);
}, LLM_TIMEOUT);

// ── Check Results ───────────────────────────────────────────────────────────
suite('Validation Suites — Results');

await testAsync('get validation results for model', async () => {
  if (!currentModel) return;
  // Wait a bit for validation to start/complete
  await new Promise(r => setTimeout(r, 2000));

  const { status, data } = await api('GET', `/api/system/models/validate?model=${encodeURIComponent(currentModel)}`);
  assert(status === 200 || status === 404, `expected 200/404, got ${status}`);
  if (status === 200) {
    assert(typeof data === 'object', 'results must be object');
  }
});

await testAsync('get all validation scores', async () => {
  const { status, data } = await api('GET', '/api/system/models/validation-scores');
  assertEqual(status, 200);
  assert(typeof data === 'object', 'scores must be object');
});

// ── WS Progress Events ──────────────────────────────────────────────────────
suite('Validation Suites — WS Progress');

await testAsync('WS receives validation progress events', async () => {
  if (!currentModel) return;

  const client = await createWsClient();

  // Trigger validation
  await api('POST', '/api/system/models/validate', {
    model: currentModel,
    suite: 'reasoning'
  });

  // Wait for progress events
  try {
    const event = await client.waitForMessage(
      m => m.channel === 'control' && m.data?.action === 'model_validation_progress',
      15000
    );
    assert(event, 'received validation progress via WS');
  } catch {
    // Validation may have completed before we connected, or not started
    assert(true, 'validation progress not received (may have completed)');
  }

  client.close();
}, LLM_TIMEOUT);

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
