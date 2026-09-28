#!/usr/bin/env node
import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { ChatController, ChatMode, ResponseSpeaker, ResponseTag, SessionState, TaggedResponse } from '../src/chat/controller.js';
import { conversationHandler } from '../src/chat/handlers/conversation.js';
import { creDecisionEngine, CREDecisionEngine, DecisionType, IntentType } from '../src/chat/cre-decision.js';
import { assessIntentClarity, getIntentEvidence, prepareClarificationInput, issueIntentEvidence, literalFileTargets, latestAssistantContent } from '../src/chat/intent-clarity.js';
import { ToolExecutor } from '../src/executor/tool-executor.js';
import { llmGateway } from '../src/llm/gateway.js';
import { getConversationStore } from '../src/chat/conversation-store.js';
import { config } from '../src/config.js';
import { projectHandler } from '../src/chat/handlers/project.js';
import { handleFileDecision } from '../src/chat/handlers/file.js';
import { toolExecutor } from '../src/executor/tool-executor.js';
import { handleAnswerDecision, handleAskUserDecision } from '../src/chat/handlers/decisions.js';
import { projects } from '../src/db/database.js';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

config.ollama.baseUrl = 'invalid://intent-grounding-no-provider';
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Live network forbidden by intent test'); };

const slot = (role, source, value = source, name = role) => ({ role, source, value, name });
const action = (slots, ambiguities = []) => ({ version: 1, kind: 'action', slots, ambiguities });
const information = (slots = []) => ({ version: 1, kind: 'information', slots, ambiguities: [] });
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
  for (const [input, roles] of [
    ['Nefunguje mi Wi-Fi. Jaké tři věci mám zkontrolovat?', [slot('quantity', 'tři věci', 'tři')]],
    ['Napiš krátkou funkci v Pythonu. Nepoužívej rekurzi.', [slot('unit', 'v Pythonu', 'Pythonu'), slot('negation', 'Nepoužívej rekurzi')]],
  ]) assert.equal(assessIntentClarity(input, information(roles)), null, 'content wording is not effect authority');
  assert.equal(assessIntentClarity('Přečti notes.md', information([slot('target', 'notes.md', 'other.md')])).reason, 'material_meaning_changed');
  const changes = [
    ['Sniž GPU napětí na polovinu', action([slot('action', 'Sniž'), slot('target', 'GPU'), slot('quantity', 'napětí', 'příkon'), slot('value', 'na polovinu')])],
    ['Nastav port na 8080', action([slot('action', 'Nastav'), slot('quantity', 'port'), slot('value', '8080', '80')])],
    ['Nastav limit na 50 mW', action([slot('action', 'Nastav'), slot('quantity', 'limit'), slot('value', '50'), slot('unit', 'mW', 'MW')])],
    ['Ulož odpověď do notes.md', action([slot('action', 'Ulož'), slot('target', 'notes.md', 'wrong.md')])],
    ['Ulož odpověď do notes.md', action([slot('action', 'Ulož'), slot('target', 'notes.md', 'Notes.md')])],
    ['Pošli zprávu alice@example.test', action([slot('action', 'Pošli'), slot('recipient', 'alice@example.test', 'bob@example.test')])],
    ['Neulož nic do notes.md', action([slot('action', 'ulož'), slot('target', 'notes.md')])],
    ['Nesmaž notes.md', action([slot('action', 'Nesmaž'), slot('target', 'notes.md')])],
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
  assert.equal(assessIntentClarity('Nesmaž notes.md', action([slot('action', 'Nesmaž'), slot('negation', 'Nesmaž'), slot('target', 'notes.md')])).kind, 'clarify');

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
    assert.match(resolved.content, /nemám ověřený nástroj/);
    assert.deepEqual(reached, []);
    assert.equal(state.awaitingClarification, false);
    assert.equal(resolved.tag.metadata.intentClarityReason, 'gpu_control_unavailable');
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
      assert.equal(negation.type, DecisionType.ASK_USER);
      const answer = await handleAskUserDecision('Nesmaž notes.md', negation, {});
      assert.match(answer.content, /Je „Nesmaž“/);
      assert.equal(calls, 1, 'negation does not reach answer synthesis');
      delete engine._llmClassifyIntent;
      llmGateway.call = async () => { throw new Error('controlled provider failure'); };
      await assert.rejects(engine.inspectRequest('ulzo odpoved do notes.md'), { code: 'LLM_PROVIDER_UNAVAILABLE' });
      llmGateway.call = async () => ({ content: '' });
      await assert.rejects(engine.inspectRequest('ulzo odpoved do notes.md'), { code: 'LLM_PROVIDER_UNAVAILABLE' });
      llmGateway.call = async () => ({ content: JSON.stringify({ intent: IntentType.FILE_WRITE, confidence: 0.95, fileTarget: 'notes.md', understanding }), finishReason: 'length' });
      await assert.rejects(engine.inspectRequest('ulzo odpoved do notes.md'), { code: 'MODEL_RESPONSE_TRUNCATED' });
      llmGateway.call = async () => ({ content: 'invalid JSON', finishReason: 'stop' });
      assert.equal((await engine.inspectRequest('ulzo odpoved do notes.md')).clarity.kind, 'clarify');
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
    const inspected = await creDecisionEngine.inspectRequest('Ulož odpověď do notes.md', { history: [{ role: 'assistant', content: 'report', metadata: { intentContentEligible: true } }] });
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
  // Reviewed failures: all negative citations and generated parameter changes.
  for (const [input, verb, suffix] of [
    ['Nezapisuj do notes.md', 'Nezapisuj', 'notes.md'],
    ['Nevypínej server', 'Nevypínej', 'server'],
    ['Nespouštěj build', 'Nespouštěj', 'build'],
    ['Nerestartuj službu', 'Nerestartuj', 'službu'],
    ["Don't delete notes.md", 'delete', 'notes.md'],
    ['dont delete notes.md', 'delete', 'notes.md'],
  ]) {
    const omitted = action([slot('action', verb), slot('target', suffix)]);
    assert.equal(assessIntentClarity(input, omitted).kind, 'clarify', input);
    assert.equal(assessIntentClarity(input, information()), null, `${input}: an informational interpretation has no effect authority`);
    proposal = classified(information());
    const controller = fixture();
    const reply = await controller.process(input);
    assert.equal(reply.content, 'handler reached');
    assert.equal(controller.reached.length, 1, 'information may reach synthesis; effectful tools independently reject it');
    const stripped = verb.startsWith('Ne') ? verb.slice(2) : verb;
    if (stripped !== verb) assert.equal(assessIntentClarity(input, action([slot('action', stripped), slot('target', suffix)])).reason, 'source_not_grounded');
    const unsafe = issueIntentEvidence(input, { intent: 'FILE_WRITE' }, omitted);
    const executor = new ToolExecutor({ m2ToolBroker: { execute: async () => { throw new Error('prohibition reached broker'); } } });
    await assert.rejects(executor.executeM2Tool({ toolId: 'file.write', input: { path: suffix, content: 'report' }, context: { intentEvidence: unsafe } }), { code: 'M2_TOOL_INTENT_MISMATCH' });
  }
  // Content constraints and troubleshooting negatives are ordinary information.
  for (const input of [
    'Napiš funkci v Pythonu. Nepoužívej rekurzi.',
    'Write a sort function without recursion',
    "Why doesn't my nginx start?", 'Nefunguje mi Wi-Fi, co s tím?',
    'Ne, tak jsem to nemyslel. Vysvětli to znovu.', 'Nextcloud: jak nastavit zálohy?',
    'Nevím, jak nastavit server', 'Nechápu příklad',
  ]) {
    for (const slots of [[], [slot('scope', input)], [slot('negation', input)]]) {
      const understanding = { ...information(), slots };
      assert.equal(assessIntentClarity(input, understanding), null, input);
      proposal = classified(understanding);
      const controller = fixture();
      await controller.process(input);
      assert.equal(controller.reached.length, 1, input);
      let calls = 0;
      const executor = new ToolExecutor({ m2ToolBroker: { execute: async () => { calls++; return { state: 'controlled' }; } } });
      const searchToken = issueIntentEvidence(input, { intent: 'SEARCH' }, understanding);
      await executor.executeM2Tool({ toolId: 'web.search', input: { query: input }, context: { intentEvidence: searchToken } });
      const readToken = issueIntentEvidence(input, { intent: 'FILE_READ' }, understanding, { 'file.read': { path: 'notes.md' } });
      await executor.executeM2Tool({ toolId: 'file.read', input: { path: 'notes.md' }, context: { intentEvidence: readToken } });
      const writeToken = issueIntentEvidence(input, { intent: 'FILE_WRITE' }, understanding, { 'file.write': { path: 'notes.md', content: 'report' } });
      await assert.rejects(executor.executeM2Tool({ toolId: 'file.write', input: { path: 'notes.md', content: 'report' }, context: { intentEvidence: writeToken } }), { code: 'M2_TOOL_INTENT_MISMATCH' });
      assert.equal(calls, 2, 'read/search proceed; state change never reaches broker');
    }
  }
  for (const [input, verb, negative] of [
    ['Ulož to do notes.md, ale nepřepisuj ho', 'Ulož', 'nepřepisuj'],
    ['Soubor notes.md nemaž, jen ho přečti', 'přečti', 'nemaž'],
    ['Ulož to do notes.md ale neprepisuj ho', 'Ulož', 'neprepisuj'],
  ]) {
    const omitted = action([slot('action', verb), slot('target', 'notes.md')]);
    assert.equal(assessIntentClarity(input, omitted).reason, 'negation_unverified');
    assert.equal(assessIntentClarity(input, action([...omitted.slots, slot('negation', negative)])).kind, 'clarify');
    proposal = { intent: 'FILE_WRITE', confidence: 0.95, fileTarget: 'notes.md', understanding: omitted };
    const controller = fixture();
    assert.equal((await controller.process(input)).tag.metadata.decision.type, DecisionType.ASK_USER);
    assert.equal(controller.reached.length, 0);
    const token = issueIntentEvidence(input, { intent: 'FILE_WRITE' }, omitted, { 'file.write': { content: 'report' } });
    const executor = new ToolExecutor({ m2ToolBroker: { execute: async () => { throw new Error('middle prohibition reached broker'); } } });
    await assert.rejects(executor.executeM2Tool({ toolId: 'file.write', input: { path: 'notes.md', content: 'report' }, context: { intentEvidence: token } }), { code: 'M2_TOOL_INTENT_MISMATCH' });
  }
  for (const suffix of ['nebo report', 'nejlepší report', 'než report', 'nez report']) {
    assert.equal(assessIntentClarity(`Ulož ${suffix} do notes.md`, action([slot('action', 'Ulož'), slot('target', 'notes.md')])), null);
  }
  // Reviewed false positives: neither literal targets nor affirmative words
  // become prohibitions, including a model's incorrect negation label.
  for (const target of ['new-notes.md', 'next.config.js', 'network.md', 'never.md', 'neon.2', 'notes-nepřepisuj.md']) {
    const input = `Ulož report do ${target}`;
    for (const extra of [[], [slot('negation', target)]]) {
      const understanding = action([slot('action', 'Ulož'), slot('target', target), slot('value', 'report'), ...extra]);
      assert.equal(assessIntentClarity(input, understanding), null, input);
      proposal = { intent: 'FILE_WRITE', confidence: 0.95, fileTarget: target, understanding };
      const controller = fixture();
      await controller.process(input);
      assert.equal(controller.reached.length, 1);
      const executor = new ToolExecutor({ m2ToolBroker: { execute: async ({ input: args }) => { assert.deepEqual(args, { path: target, content: 'report' }); return { state: 'controlled' }; } } });
      await executor.executeM2Tool({ toolId: 'file.write', input: { path: target, content: 'report' }, context: { intentEvidence: issueIntentEvidence(input, { intent: 'FILE_WRITE' }, understanding) } });
    }
  }
  for (const word of ['neboť', 'nebot', 'necham', 'nechám', 'nekdo', 'neco', 'new', 'next', 'need', 'network', 'net']) {
    const input = `Ulož report do notes.md, ${word} ji potřebuju`;
    for (const extra of [[], [slot('negation', word)]]) {
      const understanding = action([slot('action', 'Ulož'), slot('target', 'notes.md'), slot('value', 'report'), ...extra]);
      assert.equal(assessIntentClarity(input, understanding), null, input);
      const token = issueIntentEvidence(input, { intent: 'FILE_WRITE' }, understanding);
      const executor = new ToolExecutor({ m2ToolBroker: { execute: async () => ({ state: 'controlled' }) } });
      await executor.executeM2Tool({ toolId: 'file.write', input: { path: 'notes.md', content: 'report' }, context: { intentEvidence: token } });
    }
  }
  for (const target of ['https://example.test/nepis/new', 'never@example.test']) {
    const input = `Ulož report o ${target} do notes.md`;
    const understanding = action([slot('action', 'Ulož'), slot('target', target), slot('target', 'notes.md'), slot('value', 'report'), slot('negation', target)]);
    assert.equal(assessIntentClarity(input, understanding), null);
    const executor = new ToolExecutor({ m2ToolBroker: { execute: async () => ({ state: 'controlled' }) } });
    await executor.executeM2Tool({ toolId: 'file.write', input: { path: 'notes.md', content: 'report' }, context: { intentEvidence: issueIntentEvidence(input, { intent: 'FILE_WRITE' }, understanding) } });
  }
  // An explicit choice is bound to one occurrence and survives into tool proof.
  for (const cited of [false, true]) {
    const source = 'Ulož report pro neon do notes.md';
    const understanding = action([slot('action', 'Ulož'), slot('target', 'notes.md'), slot('value', 'report'), ...(cited ? [slot('negation', 'neon')] : [])]);
    proposal = { intent: 'FILE_WRITE', confidence: 0.95, fileTarget: 'notes.md', understanding };
    const controller = fixture();
    const first = await controller.process(source);
    assert.deepEqual(first.tag.metadata.decision.metadata.clarificationOptions, ['je to zákaz', 'není to zákaz']);
    const span = controller.state.pendingDecision.metadata.unresolvedSpan;
    assert.equal(span.source, 'neon');
    const fakeModelChoice = structuredClone(understanding);
    fakeModelChoice.negationDecisions = [{ ...span, prohibited: false }];
    assert.equal(assessIntentClarity(source, fakeModelChoice).reason, 'negation_unverified', 'model JSON cannot issue the user decision');
    const otherConversation = fixture();
    assert.equal((await otherConversation.process('není to zákaz')).tag.metadata.decision.type, DecisionType.ASK_USER);
    assert.equal(otherConversation.reached.length, 0, 'a bare choice in another conversation has no original span');
    await controller.process('ano');
    assert.equal(controller.reached.length, 0);
    await controller.process('není to zákaz');
    assert.equal(controller.reached.length, 1, 'even a model-cited false prohibition can be resolved');
    const proof = controller.reached[0].proof;
    assert.equal(proof.source, source, 'choice text is not inserted as a new negation into the source');
    assert.deepEqual(proof.negationDecisions, [{ ...span, prohibited: false }]);
    const inspected = await creDecisionEngine.inspectRequest(source, {}, { negationDecisions: proof.negationDecisions });
    const executor = new ToolExecutor({ m2ToolBroker: { execute: async () => ({ state: 'controlled' }) } });
    await executor.executeM2Tool({ toolId: 'file.write', input: { path: 'notes.md', content: 'report' }, context: { intentEvidence: inspected.token } });
    await assert.rejects(executor.executeM2Tool({ toolId: 'file.write', input: { path: 'backup.md', content: 'report' }, context: { intentEvidence: inspected.token } }), { code: 'M2_TOOL_INTENT_MISMATCH' });
    await assert.rejects(executor.executeM2Tool({ toolId: 'file.write', input: { path: 'notes.md', content: 'report' }, context: { intentEvidence: issueIntentEvidence(source, { intent: 'FILE_WRITE' }, understanding) } }), { code: 'M2_TOOL_INTENT_MISMATCH' });
    const prohibited = fixture();
    await prohibited.process(source);
    assert.equal((await prohibited.process('je to zákaz')).tag.metadata.intentClarityReason, 'explicit_negation');
    assert.equal(prohibited.reached.length, 0);
  }
  for (const second of ['neon', 'nepřepisuj']) {
    const source = `Ulož report pro neon do notes.md, ale ${second} ho`;
    proposal = { intent: 'FILE_WRITE', confidence: 0.95, fileTarget: 'notes.md', understanding: action([slot('action', 'Ulož'), slot('target', 'notes.md'), slot('value', 'report')]) };
    const controller = fixture();
    await controller.process(source);
    const firstSpan = controller.state.pendingDecision.metadata.unresolvedSpan;
    await controller.process('není to zákaz');
    const secondSpan = controller.state.pendingDecision.metadata.unresolvedSpan;
    assert.ok(secondSpan.start > firstSpan.start);
    assert.equal(secondSpan.source, second);
    if (second === 'neon') assert.match(controller.state.pendingDecision.metadata.clarificationText, /2\. výskyt/);
    assert.equal(controller.reached.length, 0, 'one choice cannot exempt a later occurrence/prohibition');
    await controller.process('ano');
    assert.equal(controller.reached.length, 0);
    assert.equal((await controller.process('je to zákaz')).tag.metadata.intentClarityReason, 'explicit_negation');
    assert.equal(controller.reached.length, 0);
  }
  for (const forbidden of ['nechci', 'netiskni', 'nemaž', 'nepřepisuj', "don't"]) {
    const source = `Ulož report do notes.md, ale ${forbidden}`;
    assert.equal(assessIntentClarity(source, action([slot('action', 'Ulož'), slot('target', 'notes.md'), slot('value', 'report')])).reason, 'negation_unverified');
  }
  for (const literal of ['3.12', 'qwen3.5', 'v3.12.0']) assert.deepEqual(literalFileTargets(literal), []);
  for (const literal of ['src/app.js', '.env', 'report.2026.md', 'folder/3.12', 'folder/qwen3.5']) assert.equal(literalFileTargets(literal)[0].source, literal);
  assert.equal(latestAssistantContent([
    { role: 'assistant', content: 'answer', metadata: { intentContentEligible: true } },
    { role: 'assistant', content: 'question', metadata: { decision: { type: 'ASK_USER' } } },
    { role: 'assistant', content: 'refusal', metadata: { decision: { type: 'REFUSE' } } },
    { isSummary: true, response: { tag: { speaker: 'system', metadata: { intentContentEligible: true } }, content: 'summary' } },
  ]), 'answer');
  assert.equal(latestAssistantContent([{ role: 'assistant', content: 'legacy answer' }]), null, 'unmarked historical content is ineligible');
  {
    // Real ingress persists the answer, clarification/refusal and subsequent
    // command. No history is injected into inspectRequest or the file handler.
    const root = mkdtempSync(path.join(tmpdir(), 'intent-save-ingress-'));
    const registered = projects.registerExternal('intent-save-ingress', root).project;
    const originalCall = llmGateway.call;
    const oldBroker = toolExecutor.m2ToolBroker;
    const answer = 'Původní odpověď: přesné bajty a nový řádek.\nDruhý řádek.';
    let writes = 0;
    let expectedPath = 'notes.md';
    try {
      llmGateway.call = async () => ({ content: answer, finishReason: 'stop' });
      ChatController.configure({ handlers: { [ChatMode.CONVERSATION]: conversationHandler, [ChatMode.PROJECT]: projectHandler }, config: { autoModeDetection: false } });
      toolExecutor.m2ToolBroker = { execute: async ({ toolId, input, context }) => {
        writes++;
        assert.equal(toolId, 'file.write');
        assert.deepEqual(input, { path: expectedPath, content: answer });
        assert.equal(context.intentEvidence !== undefined, true);
        return { state: 'approval_required', effectRequestId: `controlled-write-${writes}`, request: { requestId: `controlled-request-${writes}` } };
      } };
      for (const journey of ['direct', 'clarified', 'refused', 'empty', 'backup', 'authority', 'legacy', 'nonnegative', 'resolved']) {
        const id = `intent-save-ingress-${journey}`;
        ChatController.setProject(id, { id: Number(registered.id), name: registered.name, path: root });
        let requestProjectId = Number(registered.id);
        const send = message => ChatController.handle({ message, sessionId: id, conversationId: id, context: { m2LifecycleOnly: true, ...(requestProjectId ? { projectId: requestProjectId } : {}) }, authenticatedSubject: { actorType: 'user', actorId: 'operator' } });
        expectedPath = 'notes.md';
        if (!['empty', 'legacy'].includes(journey)) {
          proposal = classified(information());
          const response = await send('Vysvětli možnosti');
          assert.equal(response.response, answer);
        }
        if (journey === 'legacy') getConversationStore().appendTurn(id, 'assistant', 'Historická odpověď bez pozitivní značky.', { model: 'historical-model' });
        const before = writes;
        if (journey === 'refused') {
          proposal = classified(action([slot('action', 'Nemaž'), slot('negation', 'Nemaž'), slot('target', 'notes.md')]));
          const refused = await send('Nemaž notes.md');
          assert.equal(refused.metadata.decision.type, DecisionType.ASK_USER);
          assert.equal((await send('je to zákaz')).metadata.intentClarityReason, 'explicit_negation');
        }
        const needsChoice = ['clarified', 'empty'].includes(journey);
        proposal = { intent: 'FILE_WRITE', confidence: 0.95, fileTarget: needsChoice ? 'wrong.md' : 'notes.md', understanding: action([slot('action', 'Ulož'), slot('target', 'notes.md', needsChoice ? 'wrong.md' : 'notes.md')]) };
        if (journey === 'authority') { requestProjectId = null; ChatController.setProject(id, null); }
        if (journey === 'nonnegative') {
          expectedPath = 'new-notes.md';
          proposal.fileTarget = expectedPath;
          proposal.understanding.slots[1] = slot('target', expectedPath);
          proposal.understanding.slots.push(slot('negation', expectedPath));
        }
        if (journey === 'resolved') proposal.understanding.slots.push(slot('negation', 'neon'));
        let saved = await send(journey === 'resolved' ? 'Ulož odpověď pro neon do notes.md' : `Ulož odpověď do ${expectedPath}`);
        if (journey === 'resolved') {
          assert.equal(saved.metadata.decision.type, DecisionType.ASK_USER);
          assert.equal((await send('ano')).metadata.decision.type, DecisionType.ASK_USER);
          assert.equal(writes, before);
          saved = await send('není to zákaz');
        }
        if (journey === 'authority') {
          assert.equal(saved.metadata.decision.type, 'ASK_USER');
          assert.equal(saved.metadata.decision.reason, 'PROJECT_REQUIRED');
          assert.equal(getConversationStore().getAllTurns(id).at(-1).metadata.intentContentEligible, false);
          assert.equal(writes, before);
          ChatController.setProject(id, { id: Number(registered.id), name: registered.name, path: root });
          requestProjectId = Number(registered.id);
          saved = await send('Ulož odpověď do notes.md');
        }
        if (needsChoice) {
          assert.equal(saved.metadata.decision.type, DecisionType.ASK_USER);
          assert.equal((await send('ano')).metadata.decision.type, DecisionType.ASK_USER);
          assert.equal(writes, before);
          const history = getConversationStore().buildHandlerHistory(id);
          assert.equal(history.filter(entry => entry.response.tag.speaker === 'system' && entry.response.tag.metadata?.intentContentEligible === false).length, 2, 'only model content remains eligible after persistence and history projection');
          proposal.fileTarget = 'notes.md';
          proposal.understanding.slots[1] = slot('target', 'notes.md');
          saved = await send('notes.md');
        }
        if (['empty', 'legacy'].includes(journey)) {
          assert.equal(saved.metadata.error, 'no_content', 'clarification is never substitute content');
          assert.equal(writes, before);
        } else {
          assert.equal(saved.metadata.approvalRequired, true, JSON.stringify(saved));
          assert.equal(writes, before + 1, `${journey}: original answer reaches existing write approval`);
        }
        if (journey === 'backup') {
          expectedPath = 'backup.md';
          proposal.fileTarget = expectedPath;
          proposal.understanding.slots[1] = slot('target', expectedPath);
          const backup = await send('Ulož ji i do backup.md');
          assert.equal(backup.metadata.approvalRequired, true);
          assert.equal(writes, before + 2, 'save after approval notice still uses the original model answer');
        }
        if (journey === 'nonnegative') {
          for (const target of ['next.config.js', 'network.md']) {
            expectedPath = target;
            proposal.fileTarget = target;
            proposal.understanding.slots[1] = slot('target', target);
            proposal.understanding.slots[2] = slot('negation', target);
            assert.equal((await send(`Ulož ji i do ${target}`)).metadata.approvalRequired, true);
          }
          assert.equal(writes, before + 3);
        }
        assert.equal(existsSync(path.join(root, 'notes.md')), false, 'approval request does not perform a write');
        assert.equal(existsSync(path.join(root, 'backup.md')), false);
      }
    } finally {
      llmGateway.call = originalCall;
      toolExecutor.m2ToolBroker = oldBroker;
      rmSync(root, { recursive: true, force: true });
    }
  }
  {
    const input = 'Nemaž notes.md';
    const understanding = action([slot('action', 'Nemaž', 'Nemaž', 'same'), slot('negation', 'Nemaž', 'Nemaž', 'same'), slot('target', 'notes.md', 'wrong.md', 'same')]);
    const pending = { metadata: { intentSource: input, intentUnderstanding: understanding, clarificationText: 'Který soubor?', clarificationOptions: ['notes.md', 'wrong.md'], unresolvedSpan: { start: 0, end: 5, source: 'Nemaž', role: 'target', index: 0 } } };
    const prepared = prepareClarificationInput('wrong.md', pending);
    assert.deepEqual(prepared.supersededSpans, [], 'even an incorrectly labelled negative span cannot be exempted');
    assert.equal(assessIntentClarity(prepared.source, action([slot('action', 'Nemaž'), slot('target', 'wrong.md')]), prepared).reason, 'negation_unverified');
    assert.equal(assessIntentClarity(input, understanding).kind, 'clarify', 'duplicate slot names cannot lift prohibition');
    const dupe = action([slot('action', 'Ulož'), slot('target', 'notes.md', 'notes.md', 'same'), slot('value', 'report', 'report', 'same')], [{ slot: 'same', question: 'Co myslíš?', options: ['notes.md', 'wrong.md'] }]);
    assert.equal(assessIntentClarity('Ulož report do notes.md', dupe).unresolvedSpan, null);
    const changed = action([slot('action', 'Ulož'), slot('target', 'notes.md', 'wrong.md', 'same'), slot('value', 'report', 'report', 'same')]);
    const check = assessIntentClarity('Ulož report do notes.md', changed);
    assert.equal(check.unresolvedSpan.index, 1, 'a changed value identifies exactly one slot');
  }
  {
    const engine = new CREDecisionEngine();
    let calls = 0;
    engine._llmClassifyIntent = async () => { calls++; return classified(information()); };
    for (const input of ['Díky moc, a teď sniž napětí GPU na polovinu', 'Sniž GPU napětí na polovinu']) {
      const check = await engine.inspectRequest(input);
      assert.equal(check.clarity.reason, 'gpu_quantity_ambiguous');
    }
    assert.equal(calls, 0, 'GPU guard runs independently of the model');
    await engine.inspectRequest('Díky moc, a teď vysvětli soubor');
    assert.equal(calls, 1, 'gratitude prefix cannot bypass classification');
    await engine.inspectRequest('Díky moc!');
    assert.equal(calls, 1, 'whole gratitude remains deterministic');
    await engine.inspectRequest('Thanks for the info. What do you think about the future of AI?');
    assert.equal(calls, 2, 'mixed English gratitude also requires classification');
  }
  {
    const engine = new CREDecisionEngine();
    engine._llmClassifyIntent = async () => ({ intent: 'FILE_EXPLAIN', confidence: 0.95, fileTarget: 'src/app.js', understanding: information() });
    for (const input of ['Vysvětli mi src/app.js', 'Vysvětli mi src/app.js.', 'Vysvětli mi „src/app.js“.']) {
      assert.equal(literalFileTargets(input)[0].source, 'src/app.js');
      const inspected = await engine.inspectRequest(input);
      assert.ok(inspected.token, input);
      const decision = await engine.decide(input, { intentEvidence: inspected.token, hasActiveProject: true });
      assert.equal(decision.metadata.filePath, 'src/app.js');
      let calls = 0;
      const executor = new ToolExecutor({ m2ToolBroker: { execute: async ({ input }) => { calls++; assert.equal(input.path, 'src/app.js'); return { state: 'approval_required' }; } } });
      await executor.executeM2Tool({ toolId: 'file.read', input: { path: 'src/app.js' }, context: { intentEvidence: inspected.token } });
      await assert.rejects(executor.executeM2Tool({ toolId: 'file.read', input: { path: 'wrong.js' }, context: { intentEvidence: inspected.token } }), { code: 'M2_TOOL_INTENT_MISMATCH' });
      assert.equal(calls, 1);
      // Real file handler reaches exact read approval without loading contents.
      const response = await handleFileDecision(input, decision, { project: { id: 1, path: process.cwd() }, authenticatedSubject: { actorType: 'user', actorId: 'operator' }, intentEvidence: inspected.token }, { toolExecutor: executor });
      assert.equal(calls, 2);
      assert.equal(response.tag.metadata.error, 'TOOL_EFFECT_AUTHORITY_REQUIRED');
    }
    proposal = classified(information());
    const input = 'Co za soubory je v tomto projektu?';
    const inspected = await creDecisionEngine.inspectRequest(input, { project: { id: 7, path: process.cwd() } });
    let calls = 0;
    const oldBroker = toolExecutor.m2ToolBroker;
    try {
      toolExecutor.m2ToolBroker = { execute: async ({ toolId, input }) => { calls++; assert.equal(toolId, 'file.list'); assert.equal(input.path, '.'); return { state: 'approval_required' }; } };
      const response = await projectHandler(input, { sessionId: 'real-listing', history: [], project: { id: 7, path: process.cwd() }, intentEvidence: inspected.token });
      assert.equal(calls, 1, 'same core listing grammar reaches real project handler');
      assert.equal(response.tag.metadata.error, 'TOOL_EFFECT_AUTHORITY_REQUIRED');
    } finally { toolExecutor.m2ToolBroker = oldBroker; }
  }
  {
    const engine = new CREDecisionEngine();
    engine._llmClassifyIntent = async input => ({ intent: 'SHELL', confidence: 0.95, understanding: action([slot('action', 'Spusť'), slot('value', input.slice(6))]) });
    const inspected = await engine.inspectRequest('Spusť ls');
    let calls = 0;
    const executor = new ToolExecutor({ m2ToolBroker: { execute: async () => { calls++; return { state: 'controlled' }; } } });
    await assert.rejects(executor.executeM2Tool({ toolId: 'code.execute', input: { code: 'rm -rf ~', language: null }, context: { intentEvidence: inspected.token } }), { code: 'M2_TOOL_INTENT_MISMATCH' });
    await assert.rejects(executor.executeM2Tool({ toolId: 'code.execute', input: { code: 'ls', language: 'python' }, context: { intentEvidence: inspected.token } }), { code: 'M2_TOOL_INTENT_MISMATCH' });
    await executor.executeM2Tool({ toolId: 'code.execute', input: { code: 'ls', language: null }, context: { intentEvidence: inspected.token } });
    assert.equal(calls, 1);
    const cases = [
      ['file.write', 'Ulož report do notes.md', { path: 'notes.md', content: 'report' }, { content: 'modified' }, 'FILE_WRITE', [slot('action', 'Ulož'), slot('target', 'notes.md'), slot('value', 'report')]],
      ['web.search', 'Najdi port 8080', { query: 'Najdi port 8080' }, { query: 'Najdi port 80' }, 'SEARCH', [slot('action', 'Najdi'), slot('value', '8080')]],
      ['web.search', 'Najdi 50 mW', { query: 'Najdi 50 mW' }, { query: 'Najdi 50 MW' }, 'SEARCH', [slot('action', 'Najdi'), slot('value', '50'), slot('unit', 'mW')]],
      ['web.scrape', 'Čti https://example.test/a alice@example.test', { url: 'https://example.test/a', query: 'alice@example.test', maxLength: 10000 }, { url: 'https://example.test/b' }, 'SEARCH', [slot('action', 'Čti'), slot('target', 'https://example.test/a'), slot('value', 'alice@example.test')]],
      ['web.scrape', 'Čti https://example.test/a alice@example.test', { url: 'https://example.test/a', query: 'alice@example.test', maxLength: 10000 }, { query: 'bob@example.test' }, 'SEARCH', [slot('action', 'Čti'), slot('target', 'https://example.test/a'), slot('value', 'alice@example.test')]],
      ['database.query', 'Spusť SELECT 1 v main.db', { query: 'SELECT 1', database: 'main.db' }, { query: 'DROP TABLE users' }, 'REPORT', [slot('action', 'Spusť'), slot('value', 'SELECT 1'), slot('target', 'main.db')]],
      ['database.query', 'Spusť SELECT 1 v main.db', { query: 'SELECT 1', database: 'main.db' }, { database: 'other.db' }, 'REPORT', [slot('action', 'Spusť'), slot('value', 'SELECT 1'), slot('target', 'main.db')]],
    ];
    for (const [toolId, source, good, delta, intent, slots] of cases) {
      const token = issueIntentEvidence(source, { intent }, action(slots));
      const before = calls;
      await assert.rejects(executor.executeM2Tool({ toolId, input: { ...good, ...delta }, context: { intentEvidence: token } }), { code: 'M2_TOOL_INTENT_MISMATCH' });
      assert.equal(calls, before);
      await executor.executeM2Tool({ toolId, input: good, context: { intentEvidence: token } });
      assert.equal(calls, before + 1, `${toolId}: literal parameters still reach authority`);
    }
    const batch = await executor.execute({ type: DecisionType.TOOL_CALL, intent: 'SHELL', tools: ['web.search', 'code.execute'] }, { input: 'Spusť ls', code: 'rm -rf ~', intentEvidence: inspected.token });
    assert.equal(batch.status, 'FAILED');
    const batchSource = 'Hledej info a spusť SELECT 1 v main.db';
    const batchToken = issueIntentEvidence(batchSource, { intent: 'REPORT' }, action([slot('action', 'spusť'), slot('value', 'SELECT 1'), slot('target', 'main.db')]));
    await executor.executeM2Tool({ toolId: 'web.search', input: { query: batchSource }, context: { intentEvidence: batchToken } });
    const beforeBatch = calls;
    const laterBad = await executor.execute({ type: DecisionType.TOOL_CALL, intent: 'REPORT', tools: ['web.search', 'database.query'] }, { input: batchSource, query: 'DROP TABLE users', database: 'main.db', intentEvidence: batchToken });
    assert.equal(laterBad.status, 'FAILED');
    assert.equal(calls, beforeBatch, 'valid first tool is held back when later SQL does not match');
    // Stale context hint never permits reuse of another source's interpretation.
    let classifyCalls = 0;
    engine._llmClassifyIntent = async () => { classifyCalls++; return { intent: 'FILE_WRITE', confidence: 0.95, fileTarget: 'wrong.md', understanding: action([slot('action', 'Ulož'), slot('target', 'notes.md', 'wrong.md')]) }; };
    const different = await engine.decide('Ulož odpověď do notes.md', { intentEvidence: inspected.token, intentSourceText: 'Spusť ls' });
    assert.equal(classifyCalls, 1);
    assert.equal(different.type, DecisionType.ASK_USER);
  }
  {
    const engine = new CREDecisionEngine();
    let body;
    const oldCall = llmGateway.call;
    try {
      globalThis.fetch = async (_url, options) => { body = JSON.parse(options.body); return { ok: true, json: async () => ({ message: { content: JSON.stringify(classified(information())) }, done_reason: 'stop' }) }; };
      await engine.inspectRequest('Vysvětli rozdíl mezi dvěma možnostmi');
      assert.equal(body.think, false, 'actual classifier wire disables thinking');
      assert.equal(body.options.num_predict, 500, 'effective classifier authority budget');
    } finally { llmGateway.call = oldCall; globalThis.fetch = async () => { throw new Error('Live network forbidden by intent test'); }; }
  }
  {
    const source = 'ulzo odpoved do notes.md';
    proposal = { intent: 'FILE_WRITE', confidence: 0.95, fileTarget: 'notes.md', understanding: action([slot('action', 'ulzo'), slot('target', 'notes.md')]) };
    const history = [{ role: 'assistant', content: 'report', metadata: { intentContentEligible: true } }];
    const inspected = await creDecisionEngine.inspectRequest(source, { history });
    const before = classificationInputs.length;
    const oldBroker = toolExecutor.m2ToolBroker;
    let brokerCalls = 0;
    try {
      toolExecutor.m2ToolBroker = { execute: async ({ toolId, input }) => { brokerCalls++; assert.equal(toolId, 'file.write'); assert.deepEqual(input, { path: 'notes.md', content: 'report' }); return { state: 'approval_required', effectRequestId: 'controlled-effect-write', request: { requestId: 'controlled-tool-write' } }; } };
      const reply = await conversationHandler(source, { intentEvidence: inspected.token, intentSourceText: source, sessionId: 'project-hint-cache', userMessageId: 101, sessionState: new SessionState('project-hint-cache'), history, project: { id: 7, name: 'Demo', path: process.cwd() }, hasActiveProject: true, authenticatedSubject: { actorType: 'user', actorId: 'operator' }, userPreferences: {} });
      assert.equal(reply.tag.metadata.approvalRequired, true);
      assert.equal(classificationInputs.length, before, 'core project hint cannot trigger a second ungrounded classification');
      assert.equal(brokerCalls, 1, 'history-bound content reaches existing write approval');
    } finally { toolExecutor.m2ToolBroker = oldBroker; }
  }
  console.log('general chat intent grounding: PASS');
} finally { creDecisionEngine._llmClassifyIntent = originalClassifier; globalThis.fetch = originalFetch; }
