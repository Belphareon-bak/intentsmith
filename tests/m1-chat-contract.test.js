#!/usr/bin/env node

import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';

import { finalizeChatResponse } from '../src/chat/response-finalizer.js';
import {
  AbortSource,
  abortSourceOf,
  abortWithReason,
  createAbortError,
  isAbortError,
} from '../src/core/abort-error.js';
import {
  ChatPersistenceError,
  ChatProcessingError,
  ChatTurnErrorCode,
} from '../src/core/chat-turn-error.js';
import {
  ChatController,
  ChatMode,
  ResponseSpeaker,
  ResponseTag,
  SessionState,
  TaggedResponse,
} from '../src/chat/controller.js';
import {
  getConversationStore,
  resetConversationStore,
} from '../src/chat/conversation-store.js';
import { suite, summary, test, testAsync } from './harness.js';

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

function localHandlerResponse(content) {
  return new TaggedResponse({
    content,
    tag: new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION,
      confidence: 1,
      metadata: {
        semanticScore: { total: 100 },
        decision: { intent: 'LOCAL' },
      },
    }),
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

suite('M1 chat — conversation-owned state and terminal handler failures');

await testAsync('two conversations sharing one transport cannot share state or turns', async () => {
  resetConversationStore();
  const store = getConversationStore(null);
  const observed = [];

  ChatController.configure({
    handlers: {
      [ChatMode.CONVERSATION]: async (input, context) => {
        observed.push({
          conversationId: context.conversationId,
          owner: context.sessionState.preferences.owner ?? null,
        });
        if (input === 'set owner A') {
          context.sessionState.setPreference('owner', 'conversation-A');
        }
        return localHandlerResponse(`handled:${context.conversationId}`);
      },
    },
    config: { autoModeDetection: false },
  });

  try {
    await ChatController.handle({
      message: 'set owner A',
      sessionId: 'shared-transport',
      conversationId: 'm1-conversation-A',
    });
    await ChatController.handle({
      message: 'read owner B',
      sessionId: 'shared-transport',
      conversationId: 'm1-conversation-B',
    });

    assert.deepEqual(observed, [
      { conversationId: 'm1-conversation-A', owner: null },
      { conversationId: 'm1-conversation-B', owner: null },
    ]);
    assert.deepEqual(
      store.getAllTurns('m1-conversation-A').map(turn => turn.content),
      ['set owner A', 'handled:m1-conversation-A'],
    );
    assert.deepEqual(
      store.getAllTurns('m1-conversation-B').map(turn => turn.content),
      ['read owner B', 'handled:m1-conversation-B'],
    );
  } finally {
    ChatController.removeSession('m1-conversation-A');
    ChatController.removeSession('m1-conversation-B');
    // Also removes the legacy transport-keyed owner during the negative
    // mutation check, so one failed isolation assertion cannot contaminate
    // the independent terminal-error tests below.
    ChatController.removeSession('shared-transport');
    resetConversationStore();
  }
});

await testAsync('typed timeout from a handler stays terminal and creates no assistant turn', async () => {
  resetConversationStore();
  const store = getConversationStore(null);
  const conversationId = 'm1-handler-timeout';
  const timeout = createAbortError(AbortSource.TIMEOUT, 'fixture handler timeout');
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;

  ChatController.configure({
    handlers: {
      [ChatMode.CONVERSATION]: async () => { throw timeout; },
    },
    config: { autoModeDetection: false },
  });
  globalThis.fetch = async () => {
    modelCalls++;
    return {
      ok: true,
      json: async () => ({ message: { content: 'mutation-only response' } }),
    };
  };

  try {
    await assert.rejects(
      ChatController.handle({
        message: 'time out truthfully',
        sessionId: 'shared-transport',
        conversationId,
      }),
      error => error === timeout
        && isAbortError(error)
        && abortSourceOf(error) === AbortSource.TIMEOUT,
    );
    assert.deepEqual(
      store.getAllTurns(conversationId).map(turn => turn.role),
      ['user'],
    );
    assert.equal(modelCalls, 0, 'terminal timeout must not enter refinement');
  } finally {
    globalThis.fetch = originalFetch;
    ChatController.removeSession(conversationId);
    ChatController.removeSession('shared-transport');
    resetConversationStore();
  }
});

await testAsync('generic handler exception is typed terminal failure, not assistant content', async () => {
  resetConversationStore();
  const store = getConversationStore(null);
  const conversationId = 'm1-handler-failure';
  const handlerFailure = new Error('private fixture detail');
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;

  ChatController.configure({
    handlers: {
      [ChatMode.CONVERSATION]: async () => { throw handlerFailure; },
    },
    config: { autoModeDetection: false },
  });
  globalThis.fetch = async () => {
    modelCalls++;
    return {
      ok: true,
      json: async () => ({ message: { content: 'mutation-only response' } }),
    };
  };

  try {
    await assert.rejects(
      ChatController.handle({
        message: 'fail truthfully',
        sessionId: 'shared-transport',
        conversationId,
      }),
      error => error instanceof ChatProcessingError
        && error.code === ChatTurnErrorCode.CHAT_PROCESSING_FAILED
        && error.sourceErrorType === 'HANDLER_EXCEPTION'
        && error.cause === handlerFailure,
    );
    assert.deepEqual(
      store.getAllTurns(conversationId).map(turn => turn.role),
      ['user'],
    );
    assert.equal(modelCalls, 0, 'terminal handler failure must not enter refinement');
  } finally {
    globalThis.fetch = originalFetch;
    ChatController.removeSession(conversationId);
    ChatController.removeSession('shared-transport');
    resetConversationStore();
  }
});

test('serialized conversation fields survive a SessionState round-trip', () => {
  const original = new SessionState('m1-state-round-trip');
  const decision = {
    type: 'CONTINUE',
    intent: 'SEARCH',
    tools: ['web_search'],
  };
  original.recordDecision(decision, 'find the current source');

  const restored = SessionState.fromJSON(original.toJSON());
  assert.equal(restored.lastIntent, 'SEARCH');
  assert.deepEqual(restored.lastDecision, decision);
  assert.equal(restored.lastUserInput, 'find the current source');
});

summary();
