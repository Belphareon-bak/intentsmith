// tests/e2e/53-long-conversation.e2e.js — Long multi-turn conversation
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Requires Ollama. Verifies ten complete user/assistant turns, retained
// context in the final summary, and exact persistence counts.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite,
  testAsync,
  assert,
  assertEqual,
  summary,
  api,
  waitForServer,
  createConv,
  chatWithTimeout,
  hasKeywords,
  cleanupConversation,
} from './_helpers.js';

await waitForServer();

const TURN_TIMEOUT = 180_000;
const created = [];
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

let convId = null;
const responseTimes = [];
const responses = [];

try {
  suite('Long Conversation — Setup');

  await testAsync('create conversation', async () => {
    convId = await createConv('long-conv');
    created.push(convId);
    assert(typeof convId === 'string' && convId.length > 0, 'conversation id required');
  });

  suite('Long Conversation — Ten Complete Turns');

  for (let index = 0; index < questions.length; index++) {
    await testAsync(`turn ${index + 1}: ${questions[index].substring(0, 40)}`, async () => {
      const startedAt = Date.now();
      const result = await chatWithTimeout(convId, questions[index], TURN_TIMEOUT - 5_000);
      responseTimes.push(Date.now() - startedAt);
      responses.push(result.response);

      assertEqual(result.status, 200);
      assert(
        result.response.length > 10,
        `turn ${index + 1} response should be substantive`,
      );
    }, TURN_TIMEOUT);
  }

  suite('Long Conversation — Context and Persistence');

  await testAsync('final summary references at least three earlier topics', async () => {
    assertEqual(responses.length, questions.length, 'all ten responses must be present');
    const summaryResponse = responses.at(-1);
    assert(
      hasKeywords(
        summaryResponse,
        ['proměnn', 'variable', 'pole', 'array', 'objekt', 'object', 'funkc', 'function',
          'const', 'let', 'scope', 'closure', 'callback'],
        3,
      ),
      `summary should retain earlier context: ${summaryResponse.substring(0, 320)}`,
    );
  });

  await testAsync('ten turns persist exactly ten user and ten assistant messages', async () => {
    const { status, data } = await api('GET', `/api/conversations/${convId}/messages`);
    assertEqual(status, 200);
    assert(Array.isArray(data.messages), 'messages must be an array');
    assertEqual(data.messages.length, 20, 'ten turns must persist exactly twenty messages');
    assertEqual(
      data.messages.filter(message => message.role === 'user').length,
      10,
      'ten user messages must be persisted',
    );
    assertEqual(
      data.messages.filter(message => message.role === 'assistant').length,
      10,
      'ten assistant messages must be persisted',
    );
  });

  await testAsync('all ten measured turns stay within the per-turn timeout', async () => {
    assertEqual(responseTimes.length, questions.length, 'all ten turn durations must be measured');
    const maxTime = Math.max(...responseTimes);
    assert(
      maxTime < TURN_TIMEOUT,
      `max response time ${maxTime}ms exceeds ${TURN_TIMEOUT}ms limit`,
    );
  });
} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
