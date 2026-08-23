import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import { finalizeChatResponse } from '../src/chat/response-finalizer.js';
import { scoreResponse } from '../src/chat/quality/response-scorer.js';

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
console.log('\n═══ M1 quality Decision 024/C contract ════════════════════════');

await test('production has no model-backed post-answer refinement owner', async () => {
  const synthesis = readFileSync('src/chat/handlers/utils/synthesis.js', 'utf8');
  const finalizer = readFileSync('src/chat/response-finalizer.js', 'utf8');
  assert.equal(/\bselfRefine\b/.test(synthesis), false, 'synthesis must not own selfRefine');
  assert.equal(/\bimproveResponse\b/.test(finalizer), false, 'finalizer must not call refinement');
  assert.equal(/\bgenerateChatResponse\b/.test(finalizer), false, 'finalizer must not call a model');
});

await test('a low-scored model response makes zero post-answer model calls', async () => {
  const calls = { improve: 0, generate: 0 };
  const persisted = [];
  const finalized = await finalizeChatResponse({
    result: responseResult(dockerOriginal),
    message: dockerQuery,
    sessionId: 'm1-quality-accepted',
    conversationId: 'm1-quality-accepted',
    persistAssistantTurn: (content) => persisted.push(content),
    dependencies: {
      improveResponse: async () => { calls.improve += 1; },
      generateChatResponse: async () => { calls.generate += 1; },
    },
  });
  assert.deepEqual(calls, { improve: 0, generate: 0 });
  assert.deepEqual(persisted, [dockerOriginal]);
  assert.equal(finalized.response, dockerOriginal);
  assert.equal(finalized.quality.refinementDisposition, 'removed');
  assert.equal(finalized.quality.refinementOwner, null);
  assert.equal(finalized.quality.attempted, false);
  assert.equal(finalized.quality.accepted, false);
  assert.equal(finalized.quality.outcome, 'removed_by_decision_024');
  assert.deepEqual(finalized.quality.usage, {});
  assert.equal(finalized.quality.latencyMs, 0);
  assert(finalized.quality.finalScore);
});

await test('pre-cancelled finalization never persists an assistant turn', async () => {
  const controller = new AbortController();
  controller.abort();
  let persisted = false;
  await assert.rejects(
    finalizeChatResponse({
      result: responseResult(dockerOriginal),
      message: dockerQuery,
      sessionId: 'm1-quality-cancel',
      conversationId: 'm1-quality-cancel',
      signal: controller.signal,
      persistAssistantTurn: () => { persisted = true; },
    }),
    error => error?.name === 'AbortError',
  );
  assert.equal(persisted, false);
});

await test('all answer intents use the same removed refinement disposition', async () => {
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
  assert.equal(finalized.quality.outcome, 'removed_by_decision_024');
  assert.equal(finalized.quality.attempted, false);
});

await test('short correct FACTUAL response remains untouched while scorer defect stays visible', async () => {
  const response = 'Praha je hlavním městem České republiky.';
  const scored = scoreResponse(response, {
    query: 'Odpověz jednou větou: Jaké je hlavní město České republiky?',
    intent: 'FACTUAL',
    lang: 'cs',
  });
  assert.equal(scored.total, 59, 'Finding 011 calibration baseline changed');

  const persisted = [];
  const finalized = await finalizeChatResponse({
    result: responseResult(response, scored.total, 'FACTUAL'),
    message: 'Odpověz jednou větou: Jaké je hlavní město České republiky?',
    sessionId: 'm1-quality-short-factual',
    conversationId: 'm1-quality-short-factual',
    persistAssistantTurn: content => persisted.push(content),
  });
  assert.equal(finalized.response, response);
  assert.deepEqual(persisted, [response]);
  assert.equal(finalized.quality.finalScore.total, 59);
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

console.log(`\nM1 quality Decision 024/C contract: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
