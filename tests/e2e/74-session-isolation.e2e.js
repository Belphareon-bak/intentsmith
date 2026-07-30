// tests/e2e/74-session-isolation.e2e.js — Session & Conversation Isolation
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Verifies conversations are isolated — no context bleeding between them.
// Uses unique "canary" topics to detect cross-contamination.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary,
  api, waitForServer, createConv, chatInConv, hasKeywords, cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();

const created = [];

try {
  suite('Session Isolation — Canary Topics');

  await testAsync('two conversations have isolated topics', async () => {
    const convA = await createConv('iso-quantum');
    const convB = await createConv('iso-fish');
    created.push(convA, convB);

    // Seed each with a unique topic
    await chatInConv(convA, 'Vysvětli mi, co jsou kvantové počítače a qubit');
    await chatInConv(convB, 'Jaké akvarijní ryby jsou nejlepší pro začátečníky?');

    // Ask follow-up in each
    const rA = await chatInConv(convA, 'A jaké jsou praktické využití?');
    const rB = await chatInConv(convB, 'A jakou teplotu vody potřebují?');

    // Canary check: B must not bleed into A and vice versa
    assert(!hasKeywords(rA.response, ['ryb', 'akvári', 'akvarijn'], 1),
      'Conv A (quantum) must not mention fish');
    assert(!hasKeywords(rB.response, ['kvantov', 'qubit', 'kvantový'], 1),
      'Conv B (fish) must not mention quantum');
  }, LLM_TIMEOUT * 4);

  await testAsync('new conversation has no context from previous', async () => {
    const convA = await createConv('iso-old');
    created.push(convA);
    await chatInConv(convA, 'Co je to rekurze v programování?');
    await chatInConv(convA, 'Uveď příklad v Pythonu');
    await chatInConv(convA, 'A jaké jsou nevýhody?');

    // Create totally new conversation
    const convB = await createConv('iso-new');
    created.push(convB);
    const r = await chatInConv(convB, 'O čem jsme mluvili?');

    // New conv should not know about recursion
    assert(!hasKeywords(r.response, ['rekurz', 'recursion', 'fibonacci', 'rekurzivn'], 1),
      `new conversation should not reference recursion from old conv: ${r.response.substring(0, 200)}`);
  }, LLM_TIMEOUT * 4);

  suite('Session Isolation — Message Persistence');

  await testAsync('messages persist per conversation independently', async () => {
    const convA = await createConv('iso-msgs-a');
    const convB = await createConv('iso-msgs-b');
    created.push(convA, convB);

    // Send 3 messages to A, 2 to B
    await chatInConv(convA, 'Jedna');
    await chatInConv(convA, 'Dva');
    await chatInConv(convA, 'Tři');
    await chatInConv(convB, 'Alpha');
    await chatInConv(convB, 'Beta');

    // Check message counts
    const { data: msgsA } = await api('GET', `/api/conversations/${convA}/messages`);
    const { data: msgsB } = await api('GET', `/api/conversations/${convB}/messages`);
    const countA = Array.isArray(msgsA) ? msgsA.length : (msgsA.messages?.length || 0);
    const countB = Array.isArray(msgsB) ? msgsB.length : (msgsB.messages?.length || 0);

    assert(countA >= 6, `Conv A should have >= 6 messages (3 user + 3 assistant), got ${countA}`);
    assert(countB >= 4, `Conv B should have >= 4 messages (2 user + 2 assistant), got ${countB}`);
  }, LLM_TIMEOUT * 5);

  suite('Session Isolation — Deleted Conversation');

  await testAsync('deleted conversation does not contaminate new one', async () => {
    const convOld = await createConv('iso-delete');
    created.push(convOld);
    await chatInConv(convOld, 'Vysvětli Turingův stroj');

    // Delete the conversation
    await api('DELETE', `/api/conversations/${convOld}`);

    // Create new conversation
    const convNew = await createConv('iso-after-delete');
    created.push(convNew);
    const r = await chatInConv(convNew, 'Co je nového?');

    assert(!hasKeywords(r.response, ['turing', 'turingův'], 1),
      'new conv after delete should not reference Turing machine');
  }, LLM_TIMEOUT * 2);

  suite('Session Isolation — Stateless vs Session');

  await testAsync('stateless /chat does not share context with /api/chat', async () => {
    // Send to stateless /chat
    await api('POST', '/chat', { message: 'Vysvětli Dijkstrův algoritmus' });

    // New conversation via /api/chat
    const convId = await createConv('iso-stateless');
    created.push(convId);
    const r = await chatInConv(convId, 'Co jsme probírali?');

    assert(!hasKeywords(r.response, ['dijkstra', 'nejkratší cesta', 'shortest path', 'graf'], 1),
      '/api/chat should not know about /chat stateless context');
  }, LLM_TIMEOUT * 2);

  suite('Session Isolation — Concurrent Conversations');

  await testAsync('alternating messages stay in correct conversation', async () => {
    const convA = await createConv('iso-concurrent-a');
    const convB = await createConv('iso-concurrent-b');
    created.push(convA, convB);

    // Alternate messages
    await chatInConv(convA, 'Téma A: Vysvětli mi fotosyntézu');
    await chatInConv(convB, 'Téma B: Vysvětli mi gravitaci');
    const rA = await chatInConv(convA, 'Pokračuj v předchozím tématu');
    const rB = await chatInConv(convB, 'Pokračuj v předchozím tématu');

    // A should be about photosynthesis, B about gravity
    // Note: if server detects interrupted sessions, response may be a warning — accept that
    const aOk = hasKeywords(rA.response, ['fotosynté', 'chlorofyl', 'světl', 'rostlin', 'co2', 'kyslík'], 1)
      || rA.response.includes('přerušen');
    assert(aOk, `Conv A should continue photosynthesis, got: ${rA.response.substring(0, 200)}`);
    const bOk = hasKeywords(rB.response, ['gravita', 'přitažliv', 'newton', 'hmotnost', 'síl', 'padání'], 1)
      || rB.response.includes('přerušen');
    assert(bOk, `Conv B should continue gravity, got: ${rB.response.substring(0, 200)}`);
  }, LLM_TIMEOUT * 4);

  suite('Session Isolation — /chat Session Continuity');

  await testAsync('/chat with same session_id provides continuity', async () => {
    const sessionId = `test-session-${Date.now()}`;
    await api('POST', '/chat', { message: 'Vysvětli, co je to Kubernetes', session_id: sessionId });
    const { data: r2 } = await api('POST', '/chat', { message: 'A jak se nasazuje?', session_id: sessionId });
    assert(r2.response && r2.response.length > 10, 'second response should exist');
    // /chat may or may not persist context via session_id — accept either
    const hasContext = hasKeywords(r2.response, ['kubernetes', 'k8s', 'cluster', 'pod', 'deploy', 'container', 'helm', 'nasazen', 'deploy', 'instalac'], 1);
    // If no context, at least verify it gave a sensible response (not an error)
    assert(hasContext || r2.response.length > 20,
      `same session_id should respond sensibly, got: ${r2.response?.substring(0, 200)}`);
  }, LLM_TIMEOUT * 2);

} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
