#!/usr/bin/env node

import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';

import { finalizeChatResponse } from '../src/chat/response-finalizer.js';
import {
  AbortSource,
  abortSourceOf,
  abortWithReason,
  isAbortError,
} from '../src/core/abort-error.js';
import {
  ChatPersistenceError,
  ChatTurnErrorCode,
} from '../src/core/chat-turn-error.js';
import { suite, summary, testAsync } from './harness.js';

const silentLog = Object.freeze({
  debug() {},
  error() {},
  info() {},
  warn() {},
});

function makeResult(content = 'Deterministic answer') {
  return Object.freeze({
    content,
    mode: 'conversation',
    confidence: 1,
    canExecute: false,
    tag: Object.freeze({
      metadata: Object.freeze({
        decision: Object.freeze({ intent: 'LOCAL' }),
      }),
    }),
  });
}

function finalize({
  signal = null,
  persistAssistantTurn,
  scoreResponse = async () => ({ total: 100, dimensions: {}, issues: [] }),
} = {}) {
  return finalizeChatResponse({
    result: makeResult(),
    message: 'kolik je 2 + 2?',
    sessionId: 'm1-chat-session',
    conversationId: 'm1-chat-conversation',
    signal,
    persistAssistantTurn,
    dependencies: {
      improveResponse: async () => {
        throw new Error('LOCAL response must not enter refinement');
      },
      generateChatResponse: async () => {
        throw new Error('LOCAL response must not call a model');
      },
      scoreResponse,
    },
    log: silentLog,
  });
}

suite('M1 chat — fail-closed assistant persistence boundary');

await testAsync('successful result is returned only after the assistant turn persists', async () => {
  const order = [];
  const response = await finalize({
    persistAssistantTurn: () => order.push('persisted'),
  }).then(value => {
    order.push('returned');
    return value;
  });

  assert.deepEqual(order, ['persisted', 'returned']);
  assert.equal(response.response, 'Deterministic answer');
});

await testAsync('persistence exception is a typed terminal error, never false-success', async () => {
  const storageFailure = new Error('fixture database is read-only');
  await assert.rejects(
    finalize({
      persistAssistantTurn: () => {
        throw storageFailure;
      },
    }),
    error => {
      assert.equal(error instanceof ChatPersistenceError, true);
      assert.equal(error.code, ChatTurnErrorCode.CHAT_PERSISTENCE_FAILED);
      assert.equal(error.statusCode, 500);
      assert.equal(error.recoverable, false);
      assert.equal(error.cause, storageFailure);
      return true;
    },
  );
});

await testAsync('pre-cancelled request cannot persist an assistant turn', async () => {
  const controller = new AbortController();
  abortWithReason(controller, AbortSource.USER);
  let persisted = 0;

  await assert.rejects(
    finalize({
      signal: controller.signal,
      persistAssistantTurn: () => { persisted++; },
    }),
    error => isAbortError(error) && abortSourceOf(error) === AbortSource.USER,
  );
  assert.equal(persisted, 0);
});

await testAsync('cancellation during request processing cannot persist an assistant turn', async () => {
  const controller = new AbortController();
  let persisted = 0;

  await assert.rejects(
    finalize({
      signal: controller.signal,
      persistAssistantTurn: () => { persisted++; },
      scoreResponse: async () => {
        abortWithReason(controller, AbortSource.USER);
        await Promise.resolve();
        return { total: 100, dimensions: {}, issues: [] };
      },
    }),
    error => isAbortError(error) && abortSourceOf(error) === AbortSource.USER,
  );
  assert.equal(persisted, 0);
});

await testAsync('timeout at the last pre-persistence seam stays timeout and cannot persist', async () => {
  const controller = new AbortController();
  let persisted = 0;

  await assert.rejects(
    finalize({
      signal: controller.signal,
      persistAssistantTurn: () => { persisted++; },
      scoreResponse: async () => {
        abortWithReason(controller, AbortSource.TIMEOUT, 'fixture request timeout');
        return { total: 100, dimensions: {}, issues: [] };
      },
    }),
    error => isAbortError(error) && abortSourceOf(error) === AbortSource.TIMEOUT,
  );
  assert.equal(persisted, 0);
});

summary();
