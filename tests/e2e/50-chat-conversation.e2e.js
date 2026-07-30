// tests/e2e/50-chat-conversation.e2e.js — Multi-turn chat with LLM
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: Requires Ollama with a loaded model. Sequential execution required.
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
  LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();

const MODEL_TIMEOUT = LLM_TIMEOUT * 3;
const MODEL_REQUEST_TIMEOUT = MODEL_TIMEOUT - 5_000;
const created = [];
let convId = null;

try {
  suite('Chat Conversation — Setup');

  await testAsync('create conversation for chat', async () => {
    convId = await createConv('llm-chat');
    created.push(convId);
    assert(typeof convId === 'string' && convId.length > 0, 'conversation id required');
  });

  suite('Chat — Multi-turn Context');

  await testAsync('first turn explains recursion', async () => {
    const result = await chatWithTimeout(
      convId,
      'Řekni mi krátce, co je to rekurze v programování. Stačí 2-3 věty.',
      MODEL_REQUEST_TIMEOUT,
    );
    assertEqual(result.status, 200);
    assert(
      hasKeywords(result.response, ['rekurz', 'sama sebe', 'volá sebe', 'base case', 'základní případ'], 1),
      `response should explain recursion: ${result.response.substring(0, 240)}`,
    );
  }, MODEL_TIMEOUT);

  await testAsync('follow-up uses recursion context', async () => {
    const result = await chatWithTimeout(
      convId,
      'Uveď jednoduchý příklad.',
      MODEL_REQUEST_TIMEOUT,
    );
    assertEqual(result.status, 200);
    assert(
      hasKeywords(
        result.response,
        ['rekurz', 'faktoriál', 'factorial', 'odpočet', 'countdown', 'volá sebe', 'base case'],
        1,
      ),
      `follow-up should remain about recursion: ${result.response.substring(0, 240)}`,
    );
  }, MODEL_TIMEOUT);

  suite('Chat — Persistence');

  await testAsync('two turns persist as two user/assistant pairs', async () => {
    const { status, data } = await api('GET', `/api/conversations/${convId}/messages`);
    assertEqual(status, 200);
    assert(Array.isArray(data.messages), 'messages must be an array');
    assertEqual(data.messages.length, 4, 'two chat turns must persist exactly four messages');
    assertEqual(
      data.messages.map(message => message.role).join(','),
      'user,assistant,user,assistant',
      'persisted roles must alternate user/assistant',
    );
  });

  suite('Chat — Language Switch');

  await testAsync('English turn returns an English binary-tree explanation', async () => {
    const result = await chatWithTimeout(
      convId,
      'Now answer in English: what is a binary tree?',
      MODEL_REQUEST_TIMEOUT,
    );
    assertEqual(result.status, 200);
    assert(
      hasKeywords(result.response, ['binary tree', 'node', 'child', 'root', 'left', 'right'], 2),
      `English response should explain a binary tree: ${result.response.substring(0, 240)}`,
    );
  }, MODEL_TIMEOUT);

  await testAsync('third turn adds one persisted user/assistant pair', async () => {
    const { status, data } = await api('GET', `/api/conversations/${convId}/messages`);
    assertEqual(status, 200);
    assert(Array.isArray(data.messages), 'messages must be an array');
    assertEqual(data.messages.length, 6, 'three chat turns must persist exactly six messages');
    assertEqual(
      data.messages.filter(message => message.role === 'user').length,
      3,
      'three user turns must be persisted',
    );
    assertEqual(
      data.messages.filter(message => message.role === 'assistant').length,
      3,
      'three assistant turns must be persisted',
    );
  });
} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
