#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';

import {
  createM7ConversationCommandExecutor,
  isGenuineM7ConversationCommandExecutor,
  M7_CONVERSATION_EXECUTOR_STAGE,
} from '../src/remote/m7-conversation-command-executor.js';
import { suite, summary, testAsync } from './harness.js';

function command(overrides = {}) {
  const value = {
    contract: 'ConversationCommand',
    version: 1,
    requestId: 'request:m7:conversation:001',
    conversationId: 'conversation:m7:001',
    turnId: 'turn:m7:001',
    action: 'send',
    input: 'hello',
    ...overrides,
  };
  if (value.input === undefined) delete value.input;
  return value;
}

function setup(handleRequest, overrides = {}) {
  const events = [];
  const executor = createM7ConversationCommandExecutor({
    handleRequest,
    observeCoreEvent(input) { events.push(input); return true; },
    resolveConversationProjectId: async () => 7,
    timeoutMs: 1_000,
    cancelConfirmationMs: 500,
    ...overrides,
  });
  return { events, executor };
}

const trusted = { deviceId: 'device:m7:001', subjectId: 'local-operator' };

suite('M7 production conversation command executor');

await testAsync('send uses the exact M1 identity and emits one valid terminal CoreEvent', async () => {
  let observed;
  const fixture = setup(async input => {
    observed = input;
    return { response: 'world', mode: 'conversation', confidence: 0.9 };
  });
  const terminal = await fixture.executor.execute(command(), trusted);
  assert.equal(M7_CONVERSATION_EXECUTOR_STAGE, 'IMPLEMENTED_NOT_ACTIVE');
  assert.equal(isGenuineM7ConversationCommandExecutor(fixture.executor), true);
  assert.equal(terminal.status, 'ok');
  assert.equal(terminal.response.content, 'world');
  assert.equal(observed.projectId, 7);
  assert.equal(observed.context.m2LifecycleOnly, true);
  assert.equal(observed.authenticatedSubject.actorId, 'local-operator');
  assert.equal(fixture.events.length, 1);
  assert.equal(fixture.events[0].event.phase, 'terminal');
  assert.equal(fixture.events[0].event.payload.result, terminal);
  assert.equal(fixture.events[0].subjectId, 'local-operator');
});

await testAsync('legacy effect metadata cannot become a false successful remote result', async () => {
  for (const [metadata, code] of [
    [{ shellCommand: 'touch forbidden' }, 'M1_EFFECT_AUTHORITY_REQUIRED'],
    [{ m2LifecycleRequired: true }, 'M2_LIFECYCLE_AUTHORITY_REQUIRED'],
    [{ approvalRequired: true }, 'M2_EFFECT_AUTHORITY_REQUIRED'],
  ]) {
    const fixture = setup(async () => ({
      response: 'unsafe', mode: 'conversation', confidence: 1, metadata,
    }));
    const terminal = await fixture.executor.execute(command({
      requestId: `request:m7:${code}`,
      turnId: `turn:m7:${code}`,
    }), trusted);
    assert.equal(terminal.status, 'error');
    assert.equal(terminal.error.code, code);
  }
});

await testAsync('second send is busy and independent signed cancel confirms target cancellation', async () => {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const fixture = setup(async input => {
    entered();
    await new Promise((resolve, reject) => {
      input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true });
    });
  });
  const pending = fixture.executor.execute(command(), trusted);
  await started;
  const busy = await fixture.executor.execute(command({
    requestId: 'request:m7:conversation:busy',
    turnId: 'turn:m7:busy',
  }), trusted);
  assert.equal(busy.status, 'error');
  assert.equal(busy.error.code, 'M1_CONVERSATION_BUSY');
  const cancelled = await fixture.executor.execute(command({
    requestId: 'request:m7:conversation:cancel',
    turnId: 'turn:m7:cancel',
    action: 'cancel',
    input: undefined,
  }), trusted);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal((await pending).status, 'cancelled');
  assert.equal(fixture.events.length, 3);
});

await testAsync('timeout is terminal and observer failure cannot falsify the committed result', async () => {
  const fixture = setup(async input => {
    await new Promise((resolve, reject) => {
      input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true });
    });
  }, {
    timeoutMs: 5,
    observeCoreEvent() { throw new Error('observer unavailable'); },
  });
  const terminal = await fixture.executor.execute(command(), trusted);
  assert.equal(terminal.status, 'timeout');
  assert.equal(terminal.error.code, 'CHAT_TIMEOUT');
});

summary();
