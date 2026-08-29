#!/usr/bin/env node

import assert from 'node:assert/strict';

import { validateMobileRemotePayload } from '../docs/mobile/contracts/remote-capability-payloads-v1.js';
import {
  consumeM7RunEventCoreAdapter,
  createM7RunEventCoreAdapter,
} from '../src/remote/m7-run-event-core-adapter.js';
import { createSessionAdapter } from '../src/ws-bridge/session-adapter.js';
import { suite, summary, test, testAsync } from './harness.js';

const SUBJECT = 'user:m7:event:owner';

function coreEvent(sequence, overrides = {}) {
  const phase = overrides.phase ?? 'progress';
  const value = {
    contract: 'CoreEvent',
    version: 1,
    requestId: 'run:event:001',
    conversationId: 'conversation:event:001',
    turnId: 'turn:event:001',
    sequence,
    phase,
    eventType: phase === 'terminal' ? 'result' : 'tool.progress',
    payload: phase === 'terminal'
      ? {
        result: {
          contract: 'ConversationResult', version: 1,
          requestId: 'run:event:001', conversationId: 'conversation:event:001',
          turnId: 'turn:event:001', status: overrides.terminalStatus ?? 'ok',
          response: { content: 'done' },
        },
      }
      : { progressPercent: sequence * 10, secret: 'must-not-cross-the-projection' },
    ...overrides,
  };
  if (phase === 'terminal') value.terminalStatus = overrides.terminalStatus ?? 'ok';
  return value;
}

function query(overrides = {}) {
  return {
    contract: 'RunEventQuery', version: 1,
    requestId: 'request:event:list:001', runId: 'run:event:001', limit: 25,
    afterSeq: 0, waitMs: 0,
    ...overrides,
  };
}

suite('M7 CoreEvent run projection');

test('only a genuine bounded adapter can be consumed by composition', () => {
  assert.throws(
    () => consumeM7RunEventCoreAdapter({ handlers: { 'run-event.list': () => {} } }),
    /genuine-adapter-required/u,
  );
  const adapter = createM7RunEventCoreAdapter();
  assert.equal(consumeM7RunEventCoreAdapter(adapter).handlers, adapter.handlers);
});

await testAsync('validated CoreEvent bytes map to a redacted subject-owned page', async () => {
  let now = Date.parse('2026-08-29T10:00:00.000Z');
  const adapter = createM7RunEventCoreAdapter({ now: () => ++now });
  assert.equal(adapter.observeCoreEvent({
    event: coreEvent(1), projectId: 7, subjectId: SUBJECT,
  }), true);
  assert.equal(adapter.observeCoreEvent({
    event: coreEvent(2, { phase: 'terminal' }), projectId: 7, subjectId: SUBJECT,
  }), true);

  const page = await adapter.listRunEvents(query(), { subjectId: SUBJECT });
  assert.equal(validateMobileRemotePayload('RunEventPage@1', page).valid, true);
  assert.deepEqual(page.events.map(event => event.sequence), [1, 2]);
  assert.equal(page.events[0].detail, null);
  assert.equal(JSON.stringify(page).includes('must-not-cross'), false);
  assert.equal(page.events[0].correlation.projectId, 7);
  assert.equal(page.terminal, true);
  assert.equal(page.caughtUp, true);
  assert.equal(Object.isFrozen(page.events[0].correlation), true);

  const foreign = await adapter.listRunEvents(query({ requestId: 'request:event:foreign' }), {
    subjectId: 'user:m7:event:foreign',
  });
  assert.equal(foreign.status, 'error');
  assert.equal(foreign.error.code, 'REMOTE_EVENT_RUN_NOT_AVAILABLE');
});

await testAsync('bounded retention reports window loss instead of a false empty page', async () => {
  let now = 1_000;
  const adapter = createM7RunEventCoreAdapter({
    maxEventsPerRun: 2,
    now: () => ++now,
  });
  for (let sequence = 1; sequence <= 3; sequence += 1) {
    adapter.observeCoreEvent({ event: coreEvent(sequence), subjectId: SUBJECT });
  }
  const gone = await adapter.listRunEvents(query(), { subjectId: SUBJECT });
  assert.equal(gone.status, 'error');
  assert.equal(gone.error.code, 'REMOTE_EVENT_WINDOW_GONE');

  const retained = await adapter.listRunEvents(query({
    requestId: 'request:event:retained', afterSeq: 1,
  }), { subjectId: SUBJECT });
  assert.deepEqual(retained.events.map(event => event.sequence), [2, 3]);
  assert.equal(retained.windowStartSeq, 2);
  assert.equal(retained.windowEndSeq, 3);
});

await testAsync('long poll wakes on the next event and terminal is page-relative', async () => {
  let now = 2_000;
  const adapter = createM7RunEventCoreAdapter({ now: () => ++now });
  adapter.observeCoreEvent({ event: coreEvent(1), subjectId: SUBJECT });
  const pending = adapter.listRunEvents(query({
    requestId: 'request:event:wait', afterSeq: 1, waitMs: 1_000,
  }), { subjectId: SUBJECT });
  await new Promise(resolve => setImmediate(resolve));
  adapter.observeCoreEvent({ event: coreEvent(2, { phase: 'terminal' }), subjectId: SUBJECT });
  const page = await pending;
  assert.deepEqual(page.events.map(event => event.sequence), [2]);
  assert.equal(page.terminal, true);
});

await testAsync('long poll remains exact with an immediately firing injected timer', async () => {
  let now = 2_500;
  const cleared = [];
  const timerHandle = Object.freeze({ id: 'timer:immediate' });
  const adapter = createM7RunEventCoreAdapter({
    clearTimeoutFn: handle => cleared.push(handle),
    now: () => ++now,
    setTimeoutFn: callback => {
      callback();
      return timerHandle;
    },
  });
  adapter.observeCoreEvent({ event: coreEvent(1), subjectId: SUBJECT });
  const page = await adapter.listRunEvents(query({
    requestId: 'request:event:immediate-timeout', afterSeq: 1, waitMs: 1,
  }), { subjectId: SUBJECT });
  assert.equal(page.status, 'ok');
  assert.equal(page.events.length, 0);
  assert.equal(page.caughtUp, true);
  assert.deepEqual(cleared, [timerHandle]);
});

await testAsync('the production M1 session emitter feeds the optional projection sink', async () => {
  let now = 3_000;
  const observed = createM7RunEventCoreAdapter({ now: () => ++now });
  const sent = [];
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const adapter = createSessionAdapter({
    authenticatedSubject: Object.freeze({ actorType: 'user', actorId: SUBJECT }),
    handleRequest: async request => {
      request.onToolCall?.({ tool: 'read_file', args: { path: 'authority.js' } });
      request.onToolResult?.({ tool: 'read_file', result: { ok: true } });
      return { response: 'Observed.', mode: 'conversation', confidence: 1, state: {} };
    },
    logger,
    observeCoreEvent: observed.observeCoreEvent,
    send: encoded => sent.push(JSON.parse(encoded)),
  });
  const frame = {
    command: {
      contract: 'ConversationCommand', version: 1,
      requestId: 'run:event:session', conversationId: 'conversation:event:session',
      turnId: 'turn:event:session', action: 'send', input: 'Observe this turn.',
    },
    context: { editMode: 'ask', agentId: null, projectId: null, attachments: [] },
  };
  try {
    await adapter.processM1Command(frame);
  } finally {
    adapter.cleanup();
  }
  const page = await observed.listRunEvents(query({
    requestId: 'request:event:session', runId: frame.command.requestId,
  }), { subjectId: SUBJECT });
  assert.equal(page.status, 'ok');
  assert.equal(page.events.at(-1).phase, 'terminal');
  assert.equal(page.events.every(event => event.runId === frame.command.requestId), true);
  assert.equal(sent.some(message => message.data?.contract === 'CoreEvent'), true);
});

test('conflicting duplicate sequence corrupts only that subject-run partition', () => {
  let now = 4_000;
  const adapter = createM7RunEventCoreAdapter({ now: () => ++now });
  assert.equal(adapter.observeCoreEvent({ event: coreEvent(1), subjectId: SUBJECT }), true);
  const conflict = coreEvent(1);
  conflict.payload.progressPercent = 99;
  assert.equal(adapter.observeCoreEvent({ event: conflict, subjectId: SUBJECT }), false);
});

summary();
