// tests/e2e/88-concurrent-load.e2e.js — Concurrent Load & Isolation
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3+: Tests system behavior under concurrent requests. Validates that
// parallel conversations maintain isolation and don't mix responses.
// Limited to 3 parallel requests (GPU contention reality).
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary,
  api, waitForServer, chatWithTimeout, createConv, hasKeywords,
  cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();
const created = [];
const CONCURRENT_TIMEOUT = LLM_TIMEOUT * 3; // 180s for parallel waits
const SEQUENTIAL_TIMEOUT = LLM_TIMEOUT * 5;

try {
  // ═══════════════════════════════════════════════════════════════════════════
  suite('Concurrent — Parallel Conversations');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('3 parallel conversations maintain isolation', async () => {
    // Create 3 conversations with unique topics
    const conv1 = await createConv('concurrent-A');
    const conv2 = await createConv('concurrent-B');
    const conv3 = await createConv('concurrent-C');
    created.push(conv1, conv2, conv3);

    // Send all 3 in parallel — different unique topics
    const [r1, r2, r3] = await Promise.all([
      chatWithTimeout(
        conv1,
        'Vysvětli mi co je DNS a jak funguje překlad doménových jmen',
        LLM_TIMEOUT,
      ),
      chatWithTimeout(
        conv2,
        'Co je fotosyntéza a jakou roli hraje chlorofyl?',
        LLM_TIMEOUT,
      ),
      chatWithTimeout(
        conv3,
        'Vysvětli princip fungování elektromotoru',
        LLM_TIMEOUT,
      ),
    ]);

    // Each response should address its own topic
    assert(hasKeywords(r1.response, ['dns', 'doména', 'domain', 'překlad', 'server', 'ip', 'resolv'], 1),
      `conv1 should be about DNS: ${r1.response.substring(0, 200)}`);
    assert(hasKeywords(r2.response, ['fotosyntéz', 'chlorofyl', 'světl', 'rostlin', 'photosynthes', 'plant'], 1),
      `conv2 should be about photosynthesis: ${r2.response.substring(0, 200)}`);
    assert(hasKeywords(r3.response, ['elektro', 'motor', 'magnet', 'proud', 'cívk', 'rotor', 'stator'], 1),
      `conv3 should be about electric motors: ${r3.response.substring(0, 200)}`);

    // Cross-contamination check: no topic leaking
    assert(!hasKeywords(r1.response, ['fotosyntéz', 'chlorofyl', 'elektro', 'motor', 'cívk'], 1),
      `DNS response should not mention photosynthesis or motors`);
    assert(!hasKeywords(r2.response, ['dns', 'doména', 'elektro', 'motor', 'cívk'], 1),
      `photosynthesis response should not mention DNS or motors`);
    assert(!hasKeywords(r3.response, ['dns', 'doména', 'fotosyntéz', 'chlorofyl'], 1),
      `motor response should not mention DNS or photosynthesis`);
  }, CONCURRENT_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Concurrent — Sequential Integrity');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('alternating messages between 2 conversations', async () => {
    const convA = await createConv('alternate-A');
    const convB = await createConv('alternate-B');
    created.push(convA, convB);

    // Alternate: A1, B1, A2, B2
    const a1 = await chatWithTimeout(convA, 'Co je to TCP protokol?', LLM_TIMEOUT);
    const b1 = await chatWithTimeout(convB, 'Co je to gravitační síla?', LLM_TIMEOUT);
    const a2 = await chatWithTimeout(convA, 'A jak se liší od UDP?', LLM_TIMEOUT);
    const b2 = await chatWithTimeout(convB, 'A jaká je gravitační konstanta?', LLM_TIMEOUT);

    // A responses should be about networking
    assert(hasKeywords(a1.response, ['tcp', 'protokol', 'spojení', 'connection', 'přenos'], 1), 'A1: TCP topic');
    assert(hasKeywords(a2.response, ['udp', 'tcp', 'spolehli', 'rozdíl', 'nespolehli', 'connection'], 1), 'A2: TCP vs UDP');

    // B responses should be about physics
    assert(hasKeywords(b1.response, ['gravitac', 'síla', 'přitažli', 'těleso', 'hmotnost', 'newton', 'gravity'], 1), 'B1: gravity');
    assert(hasKeywords(b2.response, ['konstant', 'gravitac', 'newton', 'hodnot', 'síla', 'g'], 1), 'B2: gravitational constant');
  }, SEQUENTIAL_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Concurrent — Error Resilience');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('one failed request does not affect others', async () => {
    const convGood = await createConv('resilience-good');
    created.push(convGood);

    // Send a good request + deliberately bad request in parallel
    const [goodResult, badResult] = await Promise.all([
      chatWithTimeout(convGood, 'Co je to SQL databáze?', LLM_TIMEOUT),
      // Bad: empty message must retain the exact validation contract.
      api(
        'POST',
        '/api/chat',
        { conversation_id: 'nonexistent-999', message: '' },
        AbortSignal.timeout(LLM_TIMEOUT),
      ),
    ]);

    // Good request should still work
    assert(goodResult.response.length > 20, 'good request should produce response');
    assert(hasKeywords(goodResult.response, ['sql', 'databáz', 'database', 'tabulk', 'dotaz', 'query'], 1),
      `good request should be about SQL: ${goodResult.response.substring(0, 200)}`);

    // Bad request must retain the route's exact validation contract.
    assert(badResult.status === 400,
      `bad request should return 400, got ${badResult.status}`);
    assert(
      badResult.data
      && typeof badResult.data === 'object'
      && !Array.isArray(badResult.data)
      && Object.keys(badResult.data).length === 1
      && badResult.data.error === 'conversation_id and message are required',
      `bad request should return the validation error schema: ${JSON.stringify(badResult.data)}`,
    );
  }, CONCURRENT_TIMEOUT);

} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
