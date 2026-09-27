#!/usr/bin/env node

import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ChatController, ChatMode } from '../src/chat/controller.js';
import { createChatRoutes } from '../src/routes/chat.js';
import { getConversationStore } from '../src/chat/conversation-store.js';
import { validateConversationResult } from '../contracts/m1/index.js';
import { llmGateway } from '../src/llm/gateway.js';

let handlerCalls = 0;
let modelCalls = 0;
const originalModelCall = llmGateway.call;
llmGateway.call = async () => { modelCalls++; throw new Error('model reached before clarification'); };
ChatController.configure({
  handlers: {
    [ChatMode.CONVERSATION]: async () => { handlerCalls++; throw new Error('unsafe handler reached'); },
  },
  config: { autoModeDetection: false },
});

const routes = createChatRoutes({
  db: {},
  parseBody: async req => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    return JSON.parse(raw);
  },
  sendJSON: (res, status, value) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  },
  sendStaticFile() {},
  safeError: error => ({ error: error.message }),
  safeParseInt: value => Number.parseInt(value, 10),
  logger: { info() {}, warn() {}, error() {} },
  ChatController,
  config: {},
  expertiseLayer: null,
});

const server = createServer((req, res) => routes['POST /api/chat'](req, res));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const conversationId = 'intent-clarity-http-conversation';

async function send(input, number) {
  const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contract: 'ConversationCommand', version: 1, requestId: `intent-http-request-${number}`,
      conversationId, turnId: `intent-http-turn-${number}`, action: 'send', input,
    }),
    signal: AbortSignal.timeout(5000),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(validateConversationResult(result).valid, true);
  return result;
}

try {
  const first = await send('vyzkoušej místní modely a sniž GPU napětí na polovinu', 1);
  assert.equal(first.status, 'ok');
  assert.equal(first.response.metadata.decision.type, 'ASK_USER');
  assert.equal(first.response.metadata.awaitingClarification, true);
  assert.match(first.response.content, /Napětí GPU a limit příkonu/);

  const generic = await send('ano', 2);
  assert.equal(generic.response.metadata.decision.type, 'ASK_USER');

  const resolved = await send('příkon', 3);
  assert.equal(resolved.response.metadata.decision.type, 'ANSWER');
  assert.match(resolved.response.content, /Nic jsem nenastavil/);
  assert.equal(handlerCalls, 0);
  assert.equal(modelCalls, 0);

  const turns = getConversationStore().getAllTurns(conversationId);
  assert.deepEqual(turns.filter(turn => turn.role === 'user').map(turn => turn.content), [
    'vyzkoušej místní modely a sniž GPU napětí na polovinu', 'ano', 'příkon',
  ]);
  console.log('chat intent clarity HTTP: PASS');
} finally {
  llmGateway.call = originalModelCall;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
