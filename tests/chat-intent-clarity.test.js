#!/usr/bin/env node
import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { ChatController, ChatMode, ResponseSpeaker, ResponseTag, SessionState, TaggedResponse } from '../src/chat/controller.js';
import { conversationHandler } from '../src/chat/handlers/conversation.js';
import { creDecisionEngine, CREDecisionEngine, DecisionType, IntentType } from '../src/chat/cre-decision.js';
import { assessIntentClarity, getIntentEvidence } from '../src/chat/intent-clarity.js';
import { ToolExecutor } from '../src/executor/tool-executor.js';
import { llmGateway } from '../src/llm/gateway.js';
import { getConversationStore } from '../src/chat/conversation-store.js';
import { handleAnswerDecision } from '../src/chat/handlers/decisions.js';

const slot = (role, source, value = source, name = role) => ({ role, source, value, name });
const action = (slots, ambiguities = []) => ({ version: 1, kind: 'action', slots, ambiguities });
const information = () => ({ version: 1, kind: 'information', slots: [], ambiguities: [] });
const classified = understanding => ({ intent: IntentType.CONVERSATIONAL, confidence: 0.95, understanding });
const originalClassifier = creDecisionEngine._llmClassifyIntent;
let proposal = classified(information());
let classificationInputs = [];
creDecisionEngine._llmClassifyIntent = async input => { classificationInputs.push(input); return structuredClone(proposal); };
let nextId = 0;
function fixture() {
  const id = `intent-grounding-${++nextId}`;
  const state = new SessionState(id);
  const reached = [];
  const handler = async (input, context) => {
    reached.push({ input, proof: getIntentEvidence(context.intentEvidence) });
    return new TaggedResponse({ content: 'handler reached', tag: new ResponseTag({ speaker: ResponseSpeaker.SYSTEM, mode: ChatMode.CONVERSATION, confidence: 1, canExecute: false }) });
  };
  const controller = new ChatController({ sessionId: id, handlers: Object.fromEntries(Object.values(ChatMode).map(mode => [mode, handler])), config: { autoModeDetection: false } });
  return { state, reached, process: input => controller.process(input, { sessionState: state, sessionId: id, history: [] }) };
}

try {
  const changes = [
    ['Sniž GPU napětí na polovinu', action([slot('action', 'Sniž'), slot('target', 'GPU'), slot('quantity', 'napětí', 'příkon'), slot('value', 'na polovinu')])],
    ['Nastav port na 8080', action([slot('action', 'Nastav'), slot('quantity', 'port'), slot('value', '8080', '80')])],
    ['Nastav limit na 50 mW', action([slot('action', 'Nastav'), slot('quantity', 'limit'), slot('value', '50'), slot('unit', 'mW', 'MW')])],
    ['Ulož odpověď do notes.md', action([slot('action', 'Ulož'), slot('target', 'notes.md', 'wrong.md')])],
    ['Ulož odpověď do notes.md', action([slot('action', 'Ulož'), slot('target', 'notes.md', 'Notes.md')])],
    ['Pošli zprávu alice@example.test', action([slot('action', 'Pošli'), slot('recipient', 'alice@example.test', 'bob@example.test')])],
    ['Neulož nic do notes.md', action([slot('action', 'ulož'), slot('target', 'notes.md')])],
    ['zapni službu', action([slot('action', 'zapni', 'vypni'), slot('target', 'službu')])],
  ];
  for (const [input, understanding] of changes) {
    proposal = classified(understanding);
    const { state, reached, process } = fixture();
    const result = await process(input);
    assert.equal(result.tag.metadata.decision.type, DecisionType.ASK_USER, input);
    assert.equal(result.tag.canExecute, false);
    assert.deepEqual(state.awaitingSlots, ['intent_meaning']);
    assert.deepEqual(reached, [], `${input}: handler reached before semantic validation`);
  }

  for (const understanding of [null, {}, action([slot('action', 'invented')]), action([slot('action', 'Nastav')])]) {
    assert.equal(assessIntentClarity('Nastav port na 8080', understanding).kind, 'clarify');
  }
  assert.equal(assessIntentClarity('Nesmaž notes.md', action([slot('action', 'Nesmaž'), slot('negation', 'Nesmaž'), slot('target', 'notes.md')])).kind, 'no_effect');

  for (const input of ['vyzkousej lokalni modley jako hodnotitele', 'Můžeš mi říct, jak snížit napětí GPU?', 'Prosím napiš návod, jak snížit příkon GPU.']) {
    proposal = classified(information());
    const { reached, process } = fixture();
    await process(input);
    assert.equal(reached[0].input, input, 'informational text must remain unchanged');
  }
  {
    proposal = { intent: IntentType.FILE_WRITE, confidence: 0.95, fileTarget: 'notes.md', understanding: action([slot('action', 'ulzo'), slot('target', 'notes.md')]) };
    const { reached, process } = fixture();
    await process('ulzo odpoved do notes.md');
    assert.equal(reached[0].input, 'ulzo odpoved do notes.md');
  }
  {
    proposal = classified(action([slot('action', 'Sniž'), slot('target', 'GPU'), slot('quantity', 'napětí'), slot('value', 'na polovinu')], [{ slot: 'quantity', question: 'Myslíš napětí, nebo příkon?', options: ['napětí', 'příkon'] }]));
    const { state, reached, process } = fixture();
    await process('Sniž GPU napětí na polovinu');
    await process('ano');
    assert.deepEqual(reached, []);
    assert.equal(state.awaitingClarification, true);
    proposal = classified(action([slot('action', 'Sniž'), slot('target', 'GPU'), slot('quantity', 'příkon'), slot('value', 'na polovinu')]));
    const resolved = await process('příkon');
    assert.match(resolved.content, /nemám.*ověřenou spustitelnou cestu/);
    assert.deepEqual(reached, []);
    assert.equal(state.awaitingClarification, false);
    assert.match(classificationInputs.at(-1), /Výslovné upřesnění uživatele: příkon/);
  }
  {
    const id = 'grounding-durable-ingress';
    let handlerCalls = 0;
    ChatController.configure({ handlers: { [ChatMode.CONVERSATION]: async () => { handlerCalls++; throw new Error('unsafe handler reached'); } }, config: { autoModeDetection: false } });
    proposal = classified(changes[3][1]);
    const result = await ChatController.handle({ message: changes[3][0], sessionId: id, conversationId: id });
    assert.equal(result.metadata.decision.type, DecisionType.ASK_USER);
    assert.equal(handlerCalls, 0);
    assert.equal(getConversationStore().getAllTurns(id)[0].content, changes[3][0]);
  }
  {
    const id = 'grounding-attachment-data';
    let received;
    ChatController.configure({ handlers: { [ChatMode.CONVERSATION]: async (input, context) => { received = { input, proof: getIntentEvidence(context.intentEvidence) }; return new TaggedResponse({ content: 'attachment handled', tag: new ResponseTag({ speaker: ResponseSpeaker.SYSTEM, mode: ChatMode.CONVERSATION, confidence: 1, canExecute: false }) }); } }, config: { autoModeDetection: false } });
    proposal = classified(information());
    const result = await ChatController.handle({ message: 'Vysvětli přílohu', sessionId: id, conversationId: id, attachments: [{ name: 'notes.txt', type: 'text/plain', size: 28, content: 'Sniž GPU napětí na polovinu' }] });
    assert.equal(result.response, 'attachment handled');
    assert.match(received.input, /Sniž GPU/);
    assert.equal(received.proof.source, 'Vysvětli přílohu');
  }
  {
    const engine = new CREDecisionEngine();
    engine._llmClassifyIntent = async () => ({ intent: IntentType.FILE_WRITE, confidence: 0.99, fileTarget: 'wrong.md' });
    const result = await engine.decide('Ulož odpověď do notes.md');
    assert.equal(result.type, DecisionType.ASK_USER, 'direct CRE must also reject invented filename');
  }
  {
    const oldCall = llmGateway.call;
    const engine = new CREDecisionEngine();
    const understanding = action([slot('action', 'ulzo'), slot('target', 'notes.md')]);
    let calls = 0;
    try {
      llmGateway.call = async () => { calls++; return { content: JSON.stringify({ intent: IntentType.FILE_WRITE, confidence: 0.95, fileTarget: 'notes.md', understanding }), finishReason: 'stop' }; };
      const inspected = await engine.inspectRequest('ulzo odpoved do notes.md');
      assert.ok(inspected.token, 'real classifier/JSON bridge retains cited understanding');
      const result = await engine.decide('ulzo odpoved do notes.md', { intentEvidence: inspected.token, intentSourceText: 'ulzo odpoved do notes.md' });
      assert.equal(result.intent, IntentType.FILE_WRITE);
      assert.equal(result.metadata.filePath, 'notes.md');
      assert.equal(calls, 1, 'CRE reuses the validated classification');
      engine._llmClassifyIntent = async () => ({ intent: IntentType.CONVERSATIONAL, confidence: 1,
        understanding: action([slot('action', 'Nesmaž'), slot('negation', 'Nesmaž'), slot('target', 'notes.md')]) });
      const negation = await engine.decide('Nesmaž notes.md');
      const answer = await handleAnswerDecision('Nesmaž notes.md', negation, {});
      assert.match(answer.content, /zákaz akce/);
      assert.equal(calls, 1, 'negation does not reach answer synthesis');
    } finally { llmGateway.call = oldCall; }
  }
  {
    proposal = { intent: IntentType.FILE_READ, confidence: 0.95, fileTarget: '.', understanding: information() };
    const inspected = await creDecisionEngine.inspectRequest('vypiš soubory projektu', { project: { id: 7 }, hasActiveProject: true });
    assert.ok(inspected.token);
    let calls = 0;
    const executor = new ToolExecutor({ m2ToolBroker: { execute: async () => { calls++; return { state: 'controlled' }; } } });
    await executor.executeM2Tool({ toolId: 'file.list', input: { path: '.' }, context: { intentEvidence: inspected.token } });
    await assert.rejects(executor.executeM2Tool({ toolId: 'file.read', input: { path: '.' }, context: { intentEvidence: inspected.token } }), { code: 'M2_TOOL_INTENT_MISMATCH' });
    assert.equal(calls, 1, 'core root binding is only valid for project listing');
  }
  {
    proposal = { intent: IntentType.FILE_WRITE, confidence: 0.95, fileTarget: 'notes.md', understanding: action([slot('action', 'Ulož'), slot('target', 'notes.md')]) };
    const inspected = await creDecisionEngine.inspectRequest('Ulož odpověď do notes.md');
    let brokerCalls = 0;
    const executor = new ToolExecutor({ m2ToolBroker: { execute: async () => { brokerCalls++; return { state: 'controlled' }; } } });
    const context = { intentEvidence: inspected.token, input: 'Ulož odpověď do notes.md' };
    await assert.rejects(executor.executeM2Tool({ toolId: 'file.write', input: { path: 'wrong.md', content: 'report' }, context }), { code: 'M2_TOOL_INTENT_MISMATCH' });
    await assert.rejects(executor.executeM2Tool({ toolId: 'file.write', input: { path: 'Notes.md', content: 'report' }, context }), { code: 'M2_TOOL_INTENT_MISMATCH' });
    await assert.rejects(executor.executeM2Tool({ toolId: 'file.write', input: { path: 'notes.md', content: 'report' }, context: { intentEvidence: {} } }), { code: 'M2_TOOL_INTENT_MISMATCH' });
    const cyclic = {}; cyclic.nested = cyclic;
    await assert.rejects(executor.executeM2Tool({ toolId: 'file.write', input: cyclic, context }), { code: 'M2_TOOL_INTENT_MISMATCH' });
    const batch = await executor.execute({ type: DecisionType.TOOL_CALL, intent: IntentType.FILE_WRITE, tools: ['web.search', 'file.write'] }, { ...context, path: 'wrong.md' });
    assert.equal(batch.status, 'FAILED');
    assert.equal(brokerCalls, 0, 'whole batch must be checked before first broker call');
    await executor.executeM2Tool({ toolId: 'file.write', input: { path: 'notes.md', content: 'report' }, context });
    assert.equal(brokerCalls, 1, 'valid grounded input retains the existing approval broker');
  }
  {
    const oldDecide = creDecisionEngine.decide;
    const oldCall = llmGateway.call;
    let modelCalls = 0;
    try {
      creDecisionEngine.decide = async () => creDecisionEngine.overrideDecision({ type: DecisionType.ASK_USER, intent: IntentType.AMBIGUOUS, slots: ['intent_clarification'], source: 'controlled_classification', reason: 'first turn needs information', confidence: 0.5 });
      llmGateway.call = async () => { modelCalls++; throw new Error('ASK_USER must not become an answer'); };
      const state = new SessionState('grounding-first-turn');
      const result = await conversationHandler('nejasný požadavek', { sessionId: state.sessionId, sessionState: state, history: [], hasActiveProject: false, userPreferences: {} });
      assert.equal(result.tag.metadata.decision.type, DecisionType.ASK_USER);
      assert.equal(modelCalls, 0);
    } finally { creDecisionEngine.decide = oldDecide; llmGateway.call = oldCall; }
  }
  console.log('general chat intent grounding: PASS');
} finally { creDecisionEngine._llmClassifyIntent = originalClassifier; }
