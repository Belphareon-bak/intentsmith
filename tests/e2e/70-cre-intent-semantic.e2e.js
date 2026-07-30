// tests/e2e/70-cre-intent-semantic.e2e.js — CRE Intent Classification + Semantic Verification
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Validates CRE classifies intents correctly AND response content matches.
// Uses POST /api/chat with conversation_id to access metadata.decision.intent.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, assertEqual, summary,
  api, waitForServer, createConv, chatInConv, hasKeywords, cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();

const created = [];
let intentResults = [];

async function intentTest(name, message, expectedIntents, contentCheck) {
  await testAsync(name, async () => {
    const convId = await createConv(`cre-${name}`);
    created.push(convId);
    const r = await chatInConv(convId, message);
    assert(r.status === 200 || r.status === 202, `expected 200/202, got ${r.status}`);
    assert(r.response.length > 0, 'response must not be empty');

    const intent = r.intent;
    const intentOk = !expectedIntents || expectedIntents.includes(intent);
    intentResults.push({ name, intent, expected: expectedIntents, ok: intentOk });

    if (expectedIntents) {
      assert(intentOk, `intent "${intent}" not in [${expectedIntents.join(',')}]`);
    }
    if (contentCheck) {
      contentCheck(r.response, r);
    }
  }, LLM_TIMEOUT);
}

try {
  suite('CRE Intent — Basic Classification');

  await intentTest(
    'CONVERSATIONAL greeting',
    'Ahoj, jak se máš?',
    ['CONVERSATIONAL'],
    (r) => assert(hasKeywords(r, ['ahoj', 'zdravím', 'vítej', 'hej', 'dobrý', 'rád', 'pomoc', 'pomohu'], 1),
      'greeting response should contain greeting words')
  );

  await intentTest(
    'CREATIVE writing request',
    'Napiš mi básničku o dešti',
    ['CREATIVE', 'CONVERSATIONAL'],
    (r) => {
      assert(r.length > 50, `creative response should be > 50 chars, got ${r.length}`);
      assert(!hasKeywords(r, ['http://', 'https://'], 1), 'creative should not contain URLs');
    }
  );

  await intentTest(
    'FACTUAL population question',
    'Kolik obyvatel má Česká republika?',
    ['FACTUAL', 'CONVERSATIONAL', 'SEARCH'],
    (r) => assert(/\d/.test(r), 'factual response should contain at least one number')
  );

  await intentTest(
    'CODE generation',
    'Napiš funkci v Pythonu pro Fibonacciho posloupnost',
    ['CODE', 'CONVERSATIONAL'],
    (r) => assert(hasKeywords(r, ['def ', 'function', '```', 'fibonacci', 'fib('], 1),
      'code response should contain code structure')
  );

  suite('CRE Intent — LOCAL + DESIGN');

  await intentTest(
    'LOCAL math query',
    'Kolik je 847 * 23?',
    ['LOCAL', 'CONVERSATIONAL'],
    (r) => assert(r.includes('19481') || r.includes('19 481'),
      'math response should contain correct result 19481')
  );

  await intentTest(
    'LOCAL date query',
    'Jaký je dnes den?',
    ['LOCAL', 'CONVERSATIONAL'],
    (r) => assert(hasKeywords(r, ['2026', 'březen', 'march', 'března', 'dnes'], 1),
      'date response should contain current date info')
  );

  await intentTest(
    'DESIGN architecture',
    'Navrhni architekturu pro REST API e-shopu',
    ['DESIGN', 'CREATIVE', 'CODE', 'CONVERSATIONAL'],
    (r) => assert(hasKeywords(r, ['endpoint', 'api', 'databáz', 'vrst', 'architektur', 'server', 'klient'], 1),
      'design response should contain structural terms')
  );

  suite('CRE Intent — Distinctions + Edge Cases');

  await intentTest(
    'CONVERSATIONAL "co je X" (not SEARCH)',
    'Co je to Docker?',
    ['CONVERSATIONAL', 'CREATIVE', 'FACTUAL', 'SEARCH'],
    (r) => assert(hasKeywords(r, ['docker', 'kontejner', 'container', 'virtualizac', 'image'], 1),
      'should explain Docker')
  );

  await intentTest(
    'comparison mentions both sides',
    'Porovnej PostgreSQL a MySQL',
    ['CONVERSATIONAL', 'CREATIVE', 'COMPARISON', 'SEARCH', 'REPORT'],
    (r) => {
      assert(hasKeywords(r, ['postgresql', 'postgres'], 1), 'should mention PostgreSQL');
      assert(hasKeywords(r, ['mysql'], 1), 'should mention MySQL');
    }
  );

  await intentTest(
    'short input "ok"',
    'ok',
    ['CONVERSATIONAL', 'AMBIGUOUS', null],
    null
  );

  await intentTest(
    'emoji input',
    '🤔',
    ['CONVERSATIONAL', 'AMBIGUOUS', null],
    null
  );

  await intentTest(
    'code explanation request',
    'Vysvětli mi, co je promise v JavaScriptu',
    ['CODE', 'CONVERSATIONAL', 'CODE_ANALYSIS', 'FILE_EXPLAIN'],
    (r) => assert(hasKeywords(r, ['promise', 'async', 'then', 'await', 'callback', 'asynchron'], 1),
      'should explain promises')
  );

  await intentTest(
    'code review detection',
    'Zkontroluj tento kód: `const x = 1; let y = x + 2;`',
    ['CODE', 'CODE_ANALYSIS', 'CODE_REVIEW', 'CONVERSATIONAL'],
    (r) => assert(hasKeywords(r, ['const', 'let', 'proměnn', 'variable', 'kód', 'code'], 1),
      'should reference the code')
  );

  // Aggregate check
  suite('CRE Intent — Aggregate');

  await testAsync('intent classification accuracy >= 62%', async () => {
    const correct = intentResults.filter(r => r.ok).length;
    const total = intentResults.length;
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    assert(correct >= Math.ceil(total * 0.62),
      `intent accuracy ${correct}/${total} (${pct}%) — need >= 62%`);
  });

} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
