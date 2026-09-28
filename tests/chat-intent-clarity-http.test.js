#!/usr/bin/env node
import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ChatController, ChatMode, ResponseSpeaker, ResponseTag, TaggedResponse } from '../src/chat/controller.js';
import { createChatRoutes } from '../src/routes/chat.js';
import { getConversationStore } from '../src/chat/conversation-store.js';
import { getIntentEvidence } from '../src/chat/intent-clarity.js';
import { creDecisionEngine } from '../src/chat/cre-decision.js';
import { validateConversationResult } from '../contracts/m1/index.js';
import { llmGateway } from '../src/llm/gateway.js';

import { config } from '../src/config.js';
config.ollama.baseUrl = 'invalid://intent-http-no-provider';

const slot = (role, source, value = source) => ({ role, source, value, name: role });
let handlerCalls = 0;
let modelCalls = 0;
let classificationCalls = 0;
let lastProof;
const originalModelCall = llmGateway.call;
const originalClassifier = creDecisionEngine._llmClassifyIntent;
llmGateway.call = async () => { modelCalls++; throw new Error('unapproved synthesis'); };
creDecisionEngine._llmClassifyIntent = async source => {
  classificationCalls++;
  if (source.includes('GPU')) return {
    intent: 'CONVERSATIONAL', confidence: 0.95,
    understanding: { version: 1, kind: 'action', slots: [slot('action', 'Sniž'), slot('target', 'GPU'), slot('quantity', 'napětí'), slot('value', 'na polovinu')], ambiguities: [{ slot: 'quantity', question: 'Myslíš napětí, nebo příkon?', options: ['napětí', 'příkon'] }] },
  };
  const corrected = source.includes('Výslovné upřesnění uživatele: notes.md');
  return {
    intent: 'FILE_WRITE', confidence: 0.95, fileTarget: corrected ? 'notes.md' : 'wrong.md',
    understanding: { version: 1, kind: 'action', slots: [slot('action', 'Ulož'), slot('target', 'notes.md', corrected ? 'notes.md' : 'wrong.md')], ambiguities: [] },
  };
};
ChatController.configure({
  handlers: { [ChatMode.CONVERSATION]: async (input, context) => {
    handlerCalls++;
    lastProof = getIntentEvidence(context.intentEvidence);
    return new TaggedResponse({ content: 'Ověřený návrh pokračuje k běžnému schválení.', tag: new ResponseTag({ speaker: ResponseSpeaker.SYSTEM, mode: ChatMode.CONVERSATION, confidence: 1, canExecute: false }) });
  } }, config: { autoModeDetection: false },
});

const routes = createChatRoutes({
  db: {}, parseBody: async req => { let raw = ''; for await (const chunk of req) raw += chunk; return JSON.parse(raw); },
  sendJSON: (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); },
  sendStaticFile() {}, safeError: error => ({ error: error.message }), safeParseInt: value => Number.parseInt(value, 10),
  logger: { info() {}, warn() {}, error() {} }, ChatController, config: {}, expertiseLayer: null,
});
const server = createServer((req, res) => routes['POST /api/chat'](req, res));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const conversationId = 'general-intent-http';
async function send(input, number, id = conversationId) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contract: 'ConversationCommand', version: 1, requestId: `intent-request-${number}`, conversationId: id, turnId: `intent-turn-${number}`, action: 'send', input }),
    signal: AbortSignal.timeout(5000),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(validateConversationResult(result).valid, true);
  return result;
}
try {
  const first = await send('Ulož odpověď do notes.md', 1);
  assert.equal(first.response.metadata.decision.type, 'ASK_USER');
  assert.match(first.response.content, /notes.md.*wrong.md/);
  const generic = await send('ano', 2);
  assert.equal(generic.response.metadata.decision.type, 'ASK_USER');
  assert.equal(handlerCalls, 0);
  assert.equal(classificationCalls, 1, 'generic yes must not invite a model to invent a choice');
  const clarified = await send('notes.md', 3);
  assert.equal(clarified.response.content, 'Ověřený návrh pokračuje k běžnému schválení.');
  assert.equal(handlerCalls, 1);
  assert.match(lastProof.source, /Ulož odpověď do notes.md\n\nVýslovné upřesnění uživatele: notes.md/);
  assert.equal(lastProof.classification.fileTarget, 'notes.md');
  const hardware = await send('Sniž GPU napětí na polovinu', 4, 'general-intent-hardware');
  assert.equal(hardware.response.metadata.decision.type, 'ASK_USER');
  assert.match(hardware.response.content, /napětí, nebo limit příkonu/);
  const prefixed = await send('Díky moc, a teď sniž napětí GPU na polovinu', 5, 'prefixed-hardware');
  assert.equal(prefixed.response.metadata.decision.type, 'ASK_USER');
  assert.equal(prefixed.response.metadata.decision.reason, 'gpu_quantity_ambiguous');
  const acknowledged = await send('ano', 6, 'prefixed-hardware');
  assert.equal(acknowledged.response.metadata.decision.type, 'ASK_USER');
  const quantity = await send('příkon', 7, 'prefixed-hardware');
  assert.equal(quantity.response.metadata.decision.reason, 'gpu_control_unavailable');
  assert.equal(classificationCalls, 2, 'hardware never reaches classifier');
  assert.equal(handlerCalls, 1);
  assert.equal(modelCalls, 0);
  assert.deepEqual(getConversationStore().getAllTurns(conversationId).filter(turn => turn.role === 'user').map(turn => turn.content), ['Ulož odpověď do notes.md', 'ano', 'notes.md']);
  console.log('general intent grounding HTTP: PASS');
} finally {
  llmGateway.call = originalModelCall;
  creDecisionEngine._llmClassifyIntent = originalClassifier;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
