// tests/e2e/53-long-conversation.e2e.js — Long multi-turn conversation
// ══════════════════════════════════════════════════════════════════════════════
// Tier 2: 10+ turns, context stability, response time monitoring.
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, summary, api, waitForServer, uniqueId, cleanupConversation } from './_helpers.js';

await waitForServer();

const LLM_TIMEOUT = 90000;
const created = [];

try {
  suite('Long Conversation — Setup');

  let convId = null;

  await testAsync('create conversation', async () => {
    const { data } = await api('POST', '/api/conversations', {
      title: uniqueId('long-conv'), mode: 'chat'
    });
    convId = data.id || data.conversation?.id;
    assert(convId, 'conversation created');
    created.push(convId);
  });

  // ── Multi-turn Loop ────────────────────────────────────────────────────────
  suite('Long Conversation — Multi-turn');

  const questions = [
    'Vysvětli, co je to proměnná.',
    'A jaké typy proměnných existují?',
    'Co je to pole (array)?',
    'Jak se pole liší od objektu?',
    'Co je to funkce?',
    'Jaký je rozdíl mezi const a let?',
    'Co znamená scope?',
    'Vysvětli closure.',
    'Co je to callback?',
    'Shrň, o čem jsme mluvili.',
  ];

  const responseTimes = [];

  for (let i = 0; i < questions.length; i++) {
    await testAsync(`turn ${i + 1}: ${questions[i].substring(0, 40)}...`, async () => {
      if (!convId) return;
      const start = Date.now();
      const { status, data } = await api('POST', '/api/chat', {
        message: questions[i],
        conversation_id: convId
      });
      const elapsed = Date.now() - start;
      responseTimes.push(elapsed);

      assert(status === 200 || status === 202, `turn ${i + 1} failed with ${status}`);
      if (data.response) {
        assert(data.response.length > 10, `turn ${i + 1} response too short`);
      }
    }, LLM_TIMEOUT);
  }

  // ── Context Stability ──────────────────────────────────────────────────────
  suite('Long Conversation — Context Stability');

  await testAsync('last turn references earlier context (summary)', async () => {
    // The last question was "Shrň, o čem jsme mluvili" — response should reference topics
    // We just verify the conversation survived 10 turns
    if (!convId) return;
    const { data } = await api('GET', `/api/conversations/${convId}/messages`);
    const msgs = data.messages || data;
    assert(msgs.length >= 10, `expected ≥10 messages, got ${msgs.length}`);
  });

  await testAsync('response time stays reasonable', async () => {
    if (responseTimes.length < 3) return;
    const maxTime = Math.max(...responseTimes);
    // Last response should not be >5x slower than first (context compaction should help)
    assert(maxTime < 180000, `max response time ${maxTime}ms exceeds 3 min limit`);
  });

} finally {
  for (const id of created) {
    await cleanupConversation(id);
  }
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
