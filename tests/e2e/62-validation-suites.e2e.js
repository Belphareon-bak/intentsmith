// tests/e2e/62-validation-suites.e2e.js — Model validation trigger & results
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Triggers the bound CHAT model validation and verifies terminal evidence.
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer, createWsClient } from './_helpers.js';

await waitForServer();

const VALIDATION_TIMEOUT = 6 * 60 * 1000;
const CHAT_TEST_COUNT = 8;

// ── Get Current Model ───────────────────────────────────────────────────────
suite('Validation Suites — Setup');

let currentModel = null;

await testAsync('get current model from bindings', async () => {
  const { status, data } = await api('GET', '/api/system/upgrades/bindings');
  assertEqual(status, 200);
  assert(data.bindings && typeof data.bindings === 'object', 'bindings object required');
  currentModel = data.bindings.CHAT;
  assert(
    typeof currentModel === 'string' && currentModel.trim().length > 0,
    'CHAT must have an exact non-empty bound model',
  );
});

// ── Trigger Validation ──────────────────────────────────────────────────────
suite('Validation Suites — Trigger');

let terminalEvent = null;

await testAsync('trigger returns started and WS reaches done for the same model and suite', async () => {
  const client = await createWsClient();
  try {
    const { status, data } = await api('POST', '/api/system/models/validate', {
      model: currentModel,
      suite: 'chat',
    });
    assertEqual(status, 200);
    assertEqual(data.ok, true);
    assertEqual(data.model, currentModel);
    assertEqual(data.status, 'started');
    assert(
      Array.isArray(data.suites)
        && data.suites.length === 1
        && data.suites[0] === 'chat',
      'trigger must start only the chat suite',
    );

    const starting = await client.waitForMessage(
      m => m.channel === 'control'
        && m.data?.action === 'model_validation_progress'
        && m.data?.model === currentModel
        && m.data?.status === 'starting',
      VALIDATION_TIMEOUT,
    );
    assertEqual(starting.data.percent, 0);

    terminalEvent = await client.waitForMessage(
      m => m.channel === 'control'
        && m.data?.action === 'model_validation_progress'
        && m.data?.model === currentModel
        && (m.data?.status === 'done' || m.data?.status === 'error'),
      VALIDATION_TIMEOUT,
    );
    assertEqual(terminalEvent.data.status, 'done');
    assertEqual(terminalEvent.data.percent, 100);
    assert(
      Number.isFinite(terminalEvent.data.overallScore)
        && terminalEvent.data.overallScore > 0
        && terminalEvent.data.overallScore <= 1,
      'completed validation must contain a non-zero score from actual inference',
    );
    assert(
      Array.isArray(terminalEvent.data.results) && terminalEvent.data.results.length === 1,
      'terminal event must contain exactly one suite result',
    );
    const [result] = terminalEvent.data.results;
    assertEqual(result.suite, 'chat');
    assertEqual(result.total, CHAT_TEST_COUNT);
    assert(Number.isInteger(result.passed) && result.passed > 0, 'at least one chat validation must pass');
    assert(Number.isFinite(result.score) && result.score > 0 && result.score <= 1, 'chat score range');

    const progress = client.messages.filter(
      m => m.channel === 'control'
        && m.data?.action === 'model_validation_progress'
        && m.data?.model === currentModel,
    );
    assert(
      progress.some(m => m.data?.suite === 'chat' && m.data?.status === 'running'),
      'WS must emit at least one running chat test event',
    );
    assert(
      progress.some(m => m.data?.suite === 'chat' && m.data?.status === 'complete'),
      'WS must emit the chat suite completion event',
    );
  } finally {
    client.close();
  }
}, VALIDATION_TIMEOUT);

// ── Check Results ───────────────────────────────────────────────────────────
suite('Validation Suites — Results');

await testAsync('get validation results for model', async () => {
  const { status, data } = await api('GET', `/api/system/models/validate?model=${encodeURIComponent(currentModel)}`);
  assertEqual(status, 200);
  assertEqual(data.model, currentModel);
  assert(data.suites && typeof data.suites === 'object', 'suites object required');
  const chat = data.suites.chat;
  assert(chat && typeof chat === 'object', 'chat suite result required');
  assertEqual(chat.total, CHAT_TEST_COUNT);
  assert(Number.isInteger(chat.passed) && chat.passed > 0, 'persisted passed count required');
  assert(Number.isFinite(chat.score) && chat.score > 0 && chat.score <= 1, 'persisted score range');
  assert(
    Array.isArray(chat.tests) && chat.tests.length === CHAT_TEST_COUNT,
    'all chat test results must be persisted',
  );
  for (const result of chat.tests) {
    assert(typeof result.name === 'string' && result.name.length > 0, 'test name required');
    assert(typeof result.passed === 'boolean', 'test passed flag required');
    assert(Number.isFinite(result.score) && result.score >= 0 && result.score <= 1, 'test score range');
    assert(Number.isFinite(result.durationMs) && result.durationMs >= 0, 'test duration required');
  }
});

await testAsync('get all validation scores', async () => {
  const { status, data } = await api('GET', '/api/system/models/validation-scores');
  assertEqual(status, 200);
  assert(data.scores && typeof data.scores === 'object', 'scores object required');
  const score = data.scores[currentModel]?.chat;
  assert(score && typeof score === 'object', 'bound model chat score required');
  assert(Number.isFinite(score.score) && score.score > 0 && score.score <= 1, 'aggregate score range');
  assert(typeof score.validatedAt === 'string' && score.validatedAt.length > 0, 'validatedAt required');
  assertEqual(score.score, terminalEvent.data.results[0].score);
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
