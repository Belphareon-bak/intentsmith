import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import { finalizeChatResponse } from '../src/chat/response-finalizer.js';
import {
  improveResponse,
  REFINEMENT_OWNER,
  selfRefine,
} from '../src/chat/quality/improvement-loops.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ❌ ${name}: ${error.stack || error.message}`);
  }
}

function responseResult(content, semanticScore = 60, intent = 'CONVERSATIONAL') {
  return {
    content,
    mode: 'conversation',
    confidence: 0.9,
    canExecute: false,
    tag: {
      metadata: {
        semanticScore: { total: semanticScore },
        decision: { intent },
        model: 'test-model',
      },
    },
  };
}

const dockerQuery = 'Co je Docker a proč se používá?';
const dockerOriginal = 'Docker je kontejnerová platforma pro aplikace a jejich nasazení.';
const dockerRefined = [
  '## Docker',
  '',
  'Docker je kontejnerová platforma pro aplikace a jejich nasazení.',
  '',
  'Používá se pro izolaci a reprodukovatelnost.',
].join('\n');

console.log('\n═══ M1 quality owner and telemetry contract ═══════════════════');

await test('response finalizer is the only model-backed refinement owner', async () => {
  const synthesis = readFileSync('src/chat/handlers/utils/synthesis.js', 'utf8');
  const finalizer = readFileSync('src/chat/response-finalizer.js', 'utf8');
  assert.equal(REFINEMENT_OWNER, 'response-finalizer');
  assert.equal(/\bselfRefine\b/.test(synthesis), false, 'synthesis must not own selfRefine');
  assert.equal((finalizer.match(/await improveResponse\(/g) || []).length, 1);
});

await test('high score skips without a provider call', async () => {
  let calls = 0;
  const result = await improveResponse(
    dockerOriginal,
    { query: dockerQuery, intent: 'CONVERSATIONAL', lang: 'cs' },
    async () => { calls += 1; },
    { mode: 'balanced', scoreBefore: { total: 80 } },
  );
  assert.equal(calls, 0);
  assert.equal(result.telemetry.attempted, false);
  assert.equal(result.telemetry.outcome, 'skipped_high_score');
});

await test('one eligible response makes exactly one accepted refinement call', async () => {
  let calls = 0;
  const persisted = [];
  const finalized = await finalizeChatResponse({
    result: responseResult(dockerOriginal),
    message: dockerQuery,
    sessionId: 'm1-quality-accepted',
    conversationId: 'm1-quality-accepted',
    persistAssistantTurn: (content) => persisted.push(content),
    dependencies: {
      improveResponse,
      generateChatResponse: async () => {
        calls += 1;
        return {
          content: dockerRefined,
          duration: 17,
          promptEvalCount: 40,
          evalCount: 25,
        };
      },
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(persisted, [dockerRefined]);
  assert.equal(finalized.response, dockerRefined);
  assert.equal(finalized.quality.refinementOwner, 'response-finalizer');
  assert.equal(finalized.quality.attempted, true);
  assert.equal(finalized.quality.accepted, true);
  assert.equal(finalized.quality.outcome, 'accepted');
  assert.equal(finalized.quality.usage.totalTokens, 65);
  assert.equal(finalized.quality.providerDurationMs, 17);
  assert(finalized.quality.scoreAfter.total > finalized.quality.scoreBefore.total);
});

await test('semantic drift is measured and rejected', async () => {
  const result = await selfRefine(
    dockerOriginal,
    { query: dockerQuery, intent: 'CONVERSATIONAL', lang: 'cs' },
    async () => ({
      content: 'Svíčková je české jídlo z hovězího masa, kořenové zeleniny, smetany a knedlíků.',
      promptEvalCount: 30,
      evalCount: 20,
    }),
    { scoreBefore: { total: 60 } },
  );
  assert.equal(result.outcome, 'rejected_semantic_drift');
  assert.equal(result.improved, false);
  assert(result.scoreAfter);
  assert(result.similarity < 0.35);
});

await test('worse candidate is measured and rejected', async () => {
  const result = await selfRefine(
    dockerOriginal,
    { query: dockerQuery, intent: 'CONVERSATIONAL', lang: 'cs' },
    async () => ({ content: dockerOriginal }),
    { scoreBefore: { total: 74 } },
  );
  assert.equal(result.outcome, 'rejected_not_improved');
  assert.equal(result.improved, false);
  assert(result.scoreAfter.total <= 74);
});

await test('empty candidate has its own rejection outcome', async () => {
  const result = await selfRefine(
    dockerOriginal,
    { query: dockerQuery, intent: 'CONVERSATIONAL', lang: 'cs' },
    async () => ({ content: '', promptEvalCount: 22, evalCount: 0 }),
    { scoreBefore: { total: 60 } },
  );
  assert.equal(result.outcome, 'rejected_empty_or_short');
  assert.equal(result.usage.promptTokens, 22);
});

await test('provider error is non-fatal and distinguishable', async () => {
  const result = await selfRefine(
    dockerOriginal,
    { query: dockerQuery, intent: 'CONVERSATIONAL', lang: 'cs' },
    async () => { throw Object.assign(new Error('offline'), { code: 'MODEL_PROVIDER_UNAVAILABLE' }); },
    { scoreBefore: { total: 60 } },
  );
  assert.equal(result.outcome, 'provider_error');
  assert.equal(result.errorCode, 'MODEL_PROVIDER_UNAVAILABLE');
  assert.equal(result.response, dockerOriginal);
});

await test('cancel is distinguishable and finalizer never persists it', async () => {
  const controller = new AbortController();
  let persisted = false;
  await assert.rejects(
    finalizeChatResponse({
      result: responseResult(dockerOriginal),
      message: dockerQuery,
      sessionId: 'm1-quality-cancel',
      conversationId: 'm1-quality-cancel',
      signal: controller.signal,
      persistAssistantTurn: () => { persisted = true; },
      dependencies: {
        improveResponse,
        generateChatResponse: async () => {
          controller.abort();
          throw controller.signal.reason;
        },
      },
    }),
    error => error?.name === 'AbortError',
  );
  assert.equal(persisted, false);
});

await test('non-model answer records skip and cannot call refinement provider', async () => {
  let calls = 0;
  const finalized = await finalizeChatResponse({
    result: responseResult('391', null, 'LOCAL'),
    message: 'Kolik je 17 krát 23?',
    sessionId: 'm1-quality-local',
    conversationId: 'm1-quality-local',
    persistAssistantTurn() {},
    dependencies: {
      improveResponse: async () => { calls += 1; },
    },
  });
  assert.equal(calls, 0);
  assert.equal(finalized.quality.outcome, 'skipped_not_synthesized');
  assert.equal(finalized.quality.attempted, false);
});

await test('fixed corpus pins accepted behaviors for the GPU A/B report', async () => {
  const corpus = JSON.parse(readFileSync('tests/fixtures/m1-quality-corpus.json', 'utf8'));
  assert.equal(corpus.schemaVersion, 1);
  assert.equal(corpus.modelRole, 'CHAT');
  assert(corpus.cases.length >= 4);
  for (const entry of corpus.cases) {
    assert.match(entry.id, /^[a-z0-9-]+$/);
    assert(entry.query.length >= 20);
    assert(entry.intent.length > 0);
    assert(entry.requiredTerms.length >= 2);
    assert(entry.acceptedBehavior.length >= 30);
  }
});

console.log(`\nM1 quality contract: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
