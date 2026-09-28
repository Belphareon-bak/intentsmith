// tests/e2e/81-conversation-lifecycle.e2e.js — Full Conversation Lifecycle
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3: create → chat → persist → retrieve → archive → restore → resume → delete.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite,
  testAsync,
  assert,
  assertEqual,
  summary,
  api,
  waitForServer,
  chatWithTimeout,
  hasKeywords,
  cleanupConversation,
  uniqueId,
  LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();

const MODEL_TIMEOUT = LLM_TIMEOUT * 3;
const MODEL_REQUEST_TIMEOUT = MODEL_TIMEOUT - 5_000;
const initialTitle = uniqueId('lifecycle');
const updatedTitle = uniqueId('lifecycle-updated');
const contextCanary = uniqueId('KONTEXTOVA-ZNACKA');
const firstPrompt = [
  'Ve 2-3 větách vysvětli rekurzi v programování.',
  `Kontrolní značka je ${contextCanary}.`,
  'Zapamatuj si ji a na konci odpovědi ji napiš přesně.',
].join(' ');
const followUpPrompt = [
  'Uveď jednoduchý příklad rekurze v kódu.',
  'Na konci zopakuj přesně kontrolní značku z mé první zprávy.',
].join(' ');
const resumedPrompt = [
  'Po obnovení této konverzace jednou větou připomeň původní téma.',
  'Pak znovu napiš přesně kontrolní značku z první zprávy.',
].join(' ');
const created = [];
let convId = null;
let firstResponse = null;
let secondResponse = null;
let resumedResponse = null;
let fourMessageSnapshot = null;

function assertExactKeys(value, expectedKeys, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  assertEqual(
    Object.keys(value).sort().join(','),
    [...expectedKeys].sort().join(','),
    `${label} must contain exactly: ${expectedKeys.join(', ')}`,
  );
}

function assertConversation(data, expectedState, expectedTitle, label) {
  assertExactKeys(data, ['conversation'], `${label} response`);
  assert(data.conversation && typeof data.conversation === 'object', `${label} must return conversation`);
  assertEqual(data.conversation.id, convId, `${label} must return the requested conversation`);
  assertEqual(data.conversation.title, expectedTitle, `${label} must preserve the exact title`);
  assertEqual(data.conversation.state, expectedState, `${label} must return state ${expectedState}`);
}

function assertMessages(data, expectedCount, label) {
  assertExactKeys(data, ['messages'], `${label} response`);
  assert(Array.isArray(data.messages), `${label} messages must be an array`);
  assertEqual(data.messages.length, expectedCount, `${label} must return exactly ${expectedCount} messages`);
  return data.messages;
}

function extractFencedCode(response) {
  return [...response.matchAll(/```(?:[\w.+-]+)?\s*\n([\s\S]*?)```/g)]
    .map(match => match[1])
    .join('\n');
}

function assertRecursiveCodeExample(response) {
  const code = extractFencedCode(response);
  assert(code.length > 0, 'follow-up must include a fenced code example');
  const definition = code.match(/\b(?:def|function)\s+([A-Za-z_]\w*)\s*\(/)
    || code.match(/\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:\([^)]*\)|[A-Za-z_]\w*)\s*=>/);
  assert(definition, `code example must define a function: ${code.substring(0, 240)}`);
  assert(/\breturn\b/.test(code), 'recursive code example must contain a return statement');
  const functionName = definition[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const references = code.match(new RegExp(`\\b${functionName}\\s*\\(`, 'g')) || [];
  assert(
    references.length >= 2,
    `function ${definition[1]} must call itself recursively`,
  );
}

try {
  suite('Lifecycle — Create');

  await testAsync('create conversation', async () => {
    const { status, data } = await api('POST', '/api/conversations', {
      title: initialTitle,
      mode: 'chat',
    });
    assertEqual(status, 201, 'create must return HTTP 201');
    assertExactKeys(data, ['conversation'], 'create response');
    assert(data.conversation && typeof data.conversation === 'object', 'create must return conversation');
    convId = data.conversation.id;
    assert(typeof convId === 'string' && convId.length > 0, 'create must return conversation ID');
    created.push(convId);
    assertEqual(data.conversation.title, initialTitle, 'create must return the requested title');
  });

  await testAsync('created conversation is retrievable as active', async () => {
    const { status, data } = await api('GET', `/api/conversations/${convId}`);
    assertEqual(status, 200, 'GET created conversation must return HTTP 200');
    assertConversation(data, 'active', initialTitle, 'created conversation');
  });

  suite('Lifecycle — Multi-Turn Chat');

  await testAsync('first turn: explain recursion', async () => {
    const result = await chatWithTimeout(
      convId,
      firstPrompt,
      MODEL_REQUEST_TIMEOUT,
    );
    assertEqual(result.status, 200);
    firstResponse = result.response;
    assert(
      hasKeywords(firstResponse, ['rekurz', 'volá sebe', 'sama sebe', 'zásobn', 'stack', 'base case'], 1),
      `response should explain recursion: ${firstResponse.substring(0, 240)}`,
    );
    assert(
      firstResponse.includes(contextCanary),
      `first response must repeat the exact context canary: ${firstResponse.substring(0, 240)}`,
    );
  }, MODEL_TIMEOUT);

  await testAsync('second turn: follow-up maintains context', async () => {
    assert(
      !followUpPrompt.includes(contextCanary),
      'follow-up prompt must not repeat the context canary',
    );
    const result = await chatWithTimeout(
      convId,
      followUpPrompt,
      MODEL_REQUEST_TIMEOUT,
    );
    assertEqual(result.status, 200);
    secondResponse = result.response;
    assertRecursiveCodeExample(secondResponse);
    assert(
      secondResponse.includes(contextCanary),
      `follow-up must recover the exact canary from context: ${secondResponse.substring(0, 240)}`,
    );
  }, MODEL_TIMEOUT);

  suite('Lifecycle — Retrieve Messages');

  await testAsync('GET messages returns persisted turns', async () => {
    const { status, data } = await api('GET', `/api/conversations/${convId}/messages`);
    assertEqual(status, 200, 'GET messages must return HTTP 200');
    const messages = assertMessages(data, 4, 'two-turn history');
    assertEqual(
      messages.map(message => message.role).join(','),
      'user,assistant,user,assistant',
      'two turns must persist in exact user/assistant order',
    );
    assertEqual(messages[0].content, firstPrompt, 'first user prompt must persist exactly');
    assertEqual(messages[1].content, firstResponse, 'first assistant response must persist exactly');
    assertEqual(messages[2].content, followUpPrompt, 'follow-up user prompt must persist exactly');
    assertEqual(messages[3].content, secondResponse, 'follow-up assistant response must persist exactly');
    assert(
      !messages[2].content.includes(contextCanary),
      'persisted follow-up prompt must not repeat the context canary',
    );
    fourMessageSnapshot = JSON.stringify(
      messages.map(message => ({ id: message.id, role: message.role, content: message.content })),
    );
  });

  suite('Lifecycle — Update');

  await testAsync('update conversation title', async () => {
    const { status, data } = await api('PUT', `/api/conversations/${convId}`, {
      title: updatedTitle,
    });
    assertEqual(status, 200, 'update must return HTTP 200');
    assertConversation(data, 'active', updatedTitle, 'updated conversation');
  });

  await testAsync('updated title is retrievable', async () => {
    const { status, data } = await api('GET', `/api/conversations/${convId}`);
    assertEqual(status, 200, 'GET updated conversation must return HTTP 200');
    assertConversation(data, 'active', updatedTitle, 'retrieved updated conversation');
  });

  suite('Lifecycle — Archive');

  await testAsync('archive conversation', async () => {
    const { status, data } = await api('PATCH', `/api/conversations/${convId}/archive`);
    assertEqual(status, 200, 'archive must return HTTP 200');
    assertExactKeys(data, ['success', 'status'], 'archive response');
    assertEqual(data.success, true, 'archive must report success');
    assertEqual(data.status, 'archived', 'archive must report archived state');
  });

  await testAsync('archived conversation is retrievable as archived', async () => {
    const { status, data } = await api('GET', `/api/conversations/${convId}`);
    assertEqual(status, 200, 'GET archived conversation must return HTTP 200');
    assertConversation(data, 'archived', updatedTitle, 'archived conversation');
  });

  await testAsync('archived conversation messages still readable', async () => {
    const { status, data } = await api('GET', `/api/conversations/${convId}/messages`);
    assertEqual(status, 200, 'GET archived messages must return HTTP 200');
    const messages = assertMessages(data, 4, 'archived history');
    const archivedSnapshot = JSON.stringify(
      messages.map(message => ({ id: message.id, role: message.role, content: message.content })),
    );
    assertEqual(
      archivedSnapshot,
      fourMessageSnapshot,
      'archive must preserve the exact four-message history',
    );
  });

  suite('Lifecycle — Restore');

  await testAsync('restore conversation', async () => {
    const { status, data } = await api('PATCH', `/api/conversations/${convId}/restore`);
    assertEqual(status, 200, 'restore must return HTTP 200');
    assertExactKeys(data, ['success', 'status'], 'restore response');
    assertEqual(data.success, true, 'restore must report success');
    assertEqual(data.status, 'active', 'restore must report active state');
  });

  await testAsync('restored conversation is retrievable as active', async () => {
    const { status, data } = await api('GET', `/api/conversations/${convId}`);
    assertEqual(status, 200, 'GET restored conversation must return HTTP 200');
    assertConversation(data, 'active', updatedTitle, 'restored conversation');
  });

  await testAsync('resumed conversation maintains context', async () => {
    assert(
      !resumedPrompt.includes(contextCanary),
      'resumed prompt must not repeat the context canary',
    );
    const result = await chatWithTimeout(
      convId,
      resumedPrompt,
      MODEL_REQUEST_TIMEOUT,
    );
    assertEqual(result.status, 200);
    resumedResponse = result.response;
    assert(
      hasKeywords(resumedResponse, ['rekurz', 'rekurziv', 'volání', 'funkc'], 1),
      `restored conversation should retain the recursion topic: ${resumedResponse.substring(0, 240)}`,
    );
    assert(
      resumedResponse.includes(contextCanary),
      `restored conversation must recover the exact canary: ${resumedResponse.substring(0, 240)}`,
    );
  }, MODEL_TIMEOUT);

  await testAsync('resumed turn adds exactly one user/assistant pair', async () => {
    const { status, data } = await api('GET', `/api/conversations/${convId}/messages`);
    assertEqual(status, 200, 'GET resumed messages must return HTTP 200');
    const messages = assertMessages(data, 6, 'resumed history');
    assertEqual(
      messages.map(message => message.role).join(','),
      'user,assistant,user,assistant,user,assistant',
      'three turns must persist in exact user/assistant order',
    );
    assertEqual(messages[0].content, firstPrompt, 'first user prompt must remain unchanged');
    assertEqual(messages[1].content, firstResponse, 'first assistant response must remain unchanged');
    assertEqual(messages[2].content, followUpPrompt, 'follow-up user prompt must remain unchanged');
    assertEqual(messages[3].content, secondResponse, 'follow-up assistant response must remain unchanged');
    assertEqual(messages[4].content, resumedPrompt, 'resumed user prompt must persist exactly');
    assertEqual(messages[5].content, resumedResponse, 'resumed assistant response must persist exactly');
    assert(
      !messages[2].content.includes(contextCanary) && !messages[4].content.includes(contextCanary),
      'follow-up user prompts must not repeat the context canary',
    );
  });

  suite('Lifecycle — Delete');

  await testAsync('soft delete conversation', async () => {
    const { status, data } = await api('DELETE', `/api/conversations/${convId}`);
    assertEqual(status, 200, 'soft delete must return HTTP 200');
    assertExactKeys(data, ['success', 'mode'], 'soft-delete response');
    assertEqual(data.success, true, 'soft delete must report success');
    assertEqual(data.mode, 'soft', 'default delete must report soft mode');
  });

  await testAsync('soft-deleted conversation remains retrievable as deleted', async () => {
    const { status, data } = await api('GET', `/api/conversations/${convId}`);
    assertEqual(status, 200, 'GET soft-deleted conversation must return HTTP 200');
    assertConversation(data, 'deleted', updatedTitle, 'soft-deleted conversation');
  });

  await testAsync('hard delete removes the soft-deleted conversation', async () => {
    const { status, data } = await api('DELETE', `/api/conversations/${convId}?hard=true`);
    assertEqual(status, 200, 'hard delete must return HTTP 200');
    assertExactKeys(data, ['success', 'mode'], 'hard-delete response');
    assertEqual(data.success, true, 'hard delete must report success');
    assertEqual(data.mode, 'hard', 'hard delete must report hard mode');
  });

  await testAsync('hard-deleted conversation returns 404', async () => {
    const { status, data } = await api('GET', `/api/conversations/${convId}`);
    assertEqual(status, 404, 'GET hard-deleted conversation must return HTTP 404');
    assertExactKeys(data, ['error'], 'hard-delete GET response');
    assertEqual(data.error, 'Conversation not found', 'hard-delete GET must report missing conversation');
  });

} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
