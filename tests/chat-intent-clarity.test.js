#!/usr/bin/env node

import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import {
  ChatController, ChatMode, ResponseSpeaker, ResponseTag, SessionState, TaggedResponse,
} from '../src/chat/controller.js';
import { conversationHandler } from '../src/chat/handlers/conversation.js';
import { creDecisionEngine, DecisionType, IntentType } from '../src/chat/cre-decision.js';
import { llmGateway } from '../src/llm/gateway.js';
import { getConversationStore } from '../src/chat/conversation-store.js';

let nextId = 0;
function fixture() {
  const id = `intent-clarity-${++nextId}`;
  const state = new SessionState(id);
  const reached = [];
  const handler = async input => {
    reached.push(input);
    return new TaggedResponse({
      content: `handler saw: ${input}`,
      tag: new ResponseTag({ speaker: ResponseSpeaker.SYSTEM, mode: ChatMode.CONVERSATION, confidence: 1, canExecute: false }),
    });
  };
  const handlers = Object.fromEntries(Object.values(ChatMode).map(mode => [mode, handler]));
  const controller = new ChatController({ sessionId: id, handlers, config: { autoModeDetection: false } });
  const process = input => controller.process(input, { sessionState: state, sessionId: id, history: [] });
  return { state, reached, process };
}

for (const input of [
  'sniž GPU napětí na polovinu',
  'sniz gpu napeti o 50 %',
  'sniz gup napeti o 50 %',
  'sniž GPU napětí o 10 %',
  'sniž GPU napětí a příkon',
  'sniž GPU na polovinu',
  'vyzkoušej místní modely a sniž GPU napětí na polovinu',
  'vyzkousej localni modley jako hodnotitele a sniz gup napeti na polovinu',
]) {
  const { state, reached, process } = fixture();
  const result = await process(input);
  assert.equal(result.tag.metadata.decision.type, DecisionType.ASK_USER, input);
  assert.equal(result.tag.metadata.awaitingClarification, true, input);
  assert.equal(result.tag.canExecute, false, input);
  assert.match(result.content, /Napětí GPU a limit příkonu/, input);
  assert.doesNotMatch(result.content, /hluk|stabilit/u, `${input}: invented motivation`);
  assert.deepEqual(reached, [], `${input}: handler or tool reached before clarification`);
  assert.deepEqual(state.awaitingSlots, ['gpu_quantity'], input);
}

{
  const { state, reached, process } = fixture();
  const invalid = await process('Sniž GPU příkon na -10 %');
  assert.equal(invalid.tag.metadata.decision.type, DecisionType.ASK_USER);
  assert.deepEqual(state.awaitingSlots, ['gpu_value']);
  assert.match(invalid.content, /Procentní hodnota musí být/);
  const stillInvalid = await process('-5 %');
  assert.equal(stillInvalid.tag.metadata.decision.type, DecisionType.ASK_USER);
  const valid = await process('50 %');
  assert.match(valid.content, /Nic jsem nenastavil/);
  assert.equal(state.awaitingClarification, false);
  assert.deepEqual(reached, []);
}

{
  const id = 'intent-clarity-durable-ingress';
  let handlerCalls = 0;
  ChatController.configure({
    handlers: {
      [ChatMode.CONVERSATION]: async () => { handlerCalls++; throw new Error('unsafe handler reached'); },
    },
    config: { autoModeDetection: false },
  });
  const result = await ChatController.handle({
    message: 'sniž GPU napětí na polovinu', sessionId: id, conversationId: id,
  });
  assert.equal(result.metadata.decision.type, DecisionType.ASK_USER);
  assert.equal(result.metadata.awaitingClarification, true);
  assert.equal(handlerCalls, 0);
  assert.match(result.response, /Napětí GPU a limit příkonu/);
  const turns = getConversationStore().getAllTurns(id);
  assert.equal(turns[0].content, 'sniž GPU napětí na polovinu', 'original bytes must be persisted');
  assert.equal(turns.length, 2, 'the clarification is a persisted assistant turn');
}

{
  const id = 'intent-clarity-attachment-data';
  let handlerInput = null;
  ChatController.configure({
    handlers: {
      [ChatMode.CONVERSATION]: async input => {
        handlerInput = input;
        return new TaggedResponse({
          content: 'attachment handled',
          tag: new ResponseTag({ speaker: ResponseSpeaker.SYSTEM, mode: ChatMode.CONVERSATION, confidence: 1, canExecute: false }),
        });
      },
    },
    config: { autoModeDetection: false },
  });
  const result = await ChatController.handle({
    message: 'Vysvětli přílohu', sessionId: id, conversationId: id,
    attachments: [{ name: 'notes.txt', type: 'text/plain', size: 28, content: 'sniž GPU napětí na polovinu' }],
  });
  assert.equal(result.response, 'attachment handled');
  assert.match(handlerInput, /sniž GPU napětí na polovinu/);
}

{
  const { state, reached, process } = fixture();
  await process('sniž GPU napětí na polovinu');
  const generic = await process('ano');
  assert.equal(generic.tag.metadata.decision.type, DecisionType.ASK_USER);
  assert.deepEqual(reached, [], 'generic confirmation must not become hardware authority');
  const explicit = await process('příkon');
  assert.match(explicit.content, /myslíš příkon GPU/);
  assert.match(explicit.content, /Nic jsem nenastavil/);
  assert.equal(state.awaitingClarification, false);
  assert.deepEqual(reached, [], 'clarification itself must not execute the changed operation');
}

for (const input of [
  'sniž GPU příkon na polovinu',
  'sniž GPU napětí na 1 volt',
  'nesnižuj GPU napětí',
  'nezměň GPU napětí',
  'Nechci snižovat GPU napětí.',
]) {
  const { reached, process } = fixture();
  const result = await process(input);
  assert.equal(result.tag.canExecute, false, input);
  assert.deepEqual(reached, [], `${input}: unsupported or negated control reached handler`);
  assert.match(result.content, /GPU|Nic jsem nenastavil/, input);
}

for (const input of [
  'vyzkousej lokalni modley jako hodnotitele',
  'Jaké je napětí GPU?',
  'Jak snížit napětí GPU?',
  'Napiš kód, který sníží napětí GPU',
  'Napiš návod: sniž GPU napětí na polovinu',
  'Můžeš mi říct, jak snížit napětí GPU?',
  'Prosím napiš návod, jak snížit příkon GPU.',
]) {
  const { reached, process } = fixture();
  const result = await process(input);
  assert.deepEqual(reached, [input], `${input}: clear non-effect request was blocked or rewritten`);
  assert.match(result.content, /handler saw:/);
}

{
  const oldDecide = creDecisionEngine.decide;
  const oldCall = llmGateway.call;
  let modelCalls = 0;
  try {
    creDecisionEngine.decide = async () => creDecisionEngine.overrideDecision({
      type: DecisionType.ASK_USER, intent: IntentType.AMBIGUOUS,
      slots: ['intent_clarification'], source: 'controlled_classification',
      reason: 'first turn needs information', confidence: 0.5,
    });
    llmGateway.call = async () => { modelCalls++; throw new Error('model must not answer an ASK_USER decision'); };
    const state = new SessionState('intent-first-turn');
    const result = await conversationHandler('nejasný požadavek', {
      sessionId: 'intent-first-turn', sessionState: state, history: [], hasActiveProject: false, userPreferences: {},
    });
    assert.equal(result.tag.metadata.decision.type, DecisionType.ASK_USER);
    assert.equal(state.awaitingClarification, true);
    assert.equal(modelCalls, 0);
  } finally {
    creDecisionEngine.decide = oldDecide;
    llmGateway.call = oldCall;
  }
}

console.log('chat intent clarity: PASS');
