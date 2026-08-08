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
  LLMProviderUnavailableError,
} from '../src/core/chat-turn-error.js';
import {
  createChatRoutes,
  mapM1ConversationFailure,
} from '../src/routes/chat.js';
import { validateConversationResult } from '../contracts/m1/index.js';
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

const httpCommand = Object.freeze({
  contract: 'ConversationCommand',
  version: 1,
  requestId: 'm1-http-request-001',
  conversationId: 'm1-http-conversation-001',
  turnId: 'm1-http-turn-001',
  action: 'send',
  input: 'kolik je 17 * 23?',
});

function createRouteProbe(handle, { timeoutMs = 1000 } = {}) {
  const calls = [];
  const responses = [];
  const routes = createChatRoutes({
    db: {},
    parseBody: async request => request.body,
    sendJSON: (response, statusCode, body) => {
      responses.push({ statusCode, body });
      response.writableEnded = true;
    },
    sendStaticFile() {},
    safeError: error => ({ error: error.message }),
    safeParseInt: value => Number.parseInt(value, 10),
    logger: silentLog,
    ChatController: {
      handle: async request => {
        calls.push(request);
        return handle(request);
      },
    },
    config: {},
    expertiseLayer: null,
    m1ChatTimeoutMs: timeoutMs,
  });
  return { calls, responses, route: routes['POST /api/chat'] };
}

function requestFor(body) {
  return {
    body,
    once() {},
    off() {},
  };
}

function openResponse() {
  return {
    writableEnded: false,
    once() {},
    off() {},
  };
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

suite('M1 chat — HTTP ConversationCommand adapter');

await testAsync('exact send returns a validated durable ConversationResult with unchanged identity', async () => {
  const order = [];
  const probe = createRouteProbe(async request => {
    order.push('controller-complete');
    assert.equal(request.requestId, httpCommand.requestId);
    assert.equal(request.conversationId, httpCommand.conversationId);
    assert.equal(request.turnId, httpCommand.turnId);
    assert.deepEqual(request.context, {
      requestId: httpCommand.requestId,
      conversationId: httpCommand.conversationId,
      turnId: httpCommand.turnId,
    });
    return {
      response: '391',
      mode: 'conversation',
      confidence: 1,
    };
  });
  const response = openResponse();
  const originalSend = probe.responses.push.bind(probe.responses);
  probe.responses.push = value => {
    order.push('http-send');
    return originalSend(value);
  };

  await probe.route(requestFor(httpCommand), response);

  assert.deepEqual(order, ['controller-complete', 'http-send']);
  assert.equal(probe.calls.length, 1);
  assert.equal(probe.responses.length, 1);
  assert.equal(probe.responses[0].statusCode, 200);
  assert.equal(validateConversationResult(probe.responses[0].body).valid, true);
  assert.deepEqual(
    {
      requestId: probe.responses[0].body.requestId,
      conversationId: probe.responses[0].body.conversationId,
      turnId: probe.responses[0].body.turnId,
    },
    {
      requestId: httpCommand.requestId,
      conversationId: httpCommand.conversationId,
      turnId: httpCommand.turnId,
    },
  );
  assert.equal(probe.responses[0].body.response.content, '391');
});

await testAsync('invalid command and unresolved HTTP cancel never reach the controller', async () => {
  const probe = createRouteProbe(async () => {
    throw new Error('invalid command reached controller');
  });

  const invalid = { ...httpCommand };
  delete invalid.input;
  await probe.route(requestFor(invalid), openResponse());
  await probe.route(requestFor({
    ...httpCommand,
    action: 'cancel',
    input: undefined,
  }), openResponse());

  assert.equal(probe.calls.length, 0);
  assert.equal(probe.responses[0].statusCode, 400);
  assert.equal(probe.responses[0].body.code, 'M1_CONVERSATION_COMMAND_INVALID');
  // Exact-key validation rejects the lingering input before target semantics.
  assert.equal(probe.responses[1].statusCode, 400);

  const cancelProbe = createRouteProbe(async () => {
    throw new Error('cancel reached controller');
  });
  const { input: _input, ...cancelCommand } = { ...httpCommand, action: 'cancel' };
  await cancelProbe.route(requestFor(cancelCommand), openResponse());
  assert.equal(cancelProbe.calls.length, 0);
  assert.equal(cancelProbe.responses[0].statusCode, 409);
  assert.equal(validateConversationResult(cancelProbe.responses[0].body).valid, true);
  assert.equal(cancelProbe.responses[0].body.status, 'error');
  assert.equal(
    cancelProbe.responses[0].body.error.code,
    'M1_HTTP_CANCEL_TARGET_UNRESOLVED',
  );
});

await testAsync('provider, persistence, and generic failures are valid non-success terminals', async () => {
  const fixtures = [
    {
      error: new LLMProviderUnavailableError(),
      statusCode: 503,
      code: 'LLM_PROVIDER_UNAVAILABLE',
    },
    {
      error: new ChatPersistenceError(new Error('private database detail')),
      statusCode: 500,
      code: 'CHAT_PERSISTENCE_FAILED',
    },
    {
      error: new Error('private generic detail'),
      statusCode: 500,
      code: 'CHAT_PROCESSING_FAILED',
    },
  ];

  for (const fixture of fixtures) {
    const probe = createRouteProbe(async () => { throw fixture.error; });
    await probe.route(requestFor(httpCommand), openResponse());
    const terminal = probe.responses[0];
    assert.equal(terminal.statusCode, fixture.statusCode);
    assert.equal(validateConversationResult(terminal.body).valid, true);
    assert.equal(terminal.body.status, 'error');
    assert.equal(terminal.body.error.code, fixture.code);
    assert.equal(Object.hasOwn(terminal.body, 'response'), false);
    assert.equal(JSON.stringify(terminal.body).includes('private'), false);
  }
});

await testAsync('request deadline produces timeout instead of an assistant response', async () => {
  const probe = createRouteProbe(request => new Promise((resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(request.signal.reason), {
      once: true,
    });
  }), { timeoutMs: 10 });

  await probe.route(requestFor(httpCommand), openResponse());

  assert.equal(probe.responses.length, 1);
  assert.equal(probe.responses[0].statusCode, 504);
  assert.equal(validateConversationResult(probe.responses[0].body).valid, true);
  assert.equal(probe.responses[0].body.status, 'timeout');
  assert.equal(probe.responses[0].body.error.code, 'CHAT_TIMEOUT');
  assert.equal(Object.hasOwn(probe.responses[0].body, 'response'), false);
});

test('typed user abort maps to cancelled without inventing assistant content', () => {
  const terminal = mapM1ConversationFailure(
    httpCommand,
    createAbortError(AbortSource.USER),
  );
  assert.equal(terminal.statusCode, 409);
  assert.equal(validateConversationResult(terminal.result).valid, true);
  assert.equal(terminal.result.status, 'cancelled');
  assert.equal(terminal.result.error.code, 'CHAT_CANCELLED');
  assert.equal(Object.hasOwn(terminal.result, 'response'), false);
});

await testAsync('empty controller output fails closed as a contract error terminal', async () => {
  const probe = createRouteProbe(async () => ({
    response: '   ',
    mode: 'conversation',
    confidence: 1,
  }));
  await probe.route(requestFor(httpCommand), openResponse());
  assert.equal(probe.responses[0].statusCode, 500);
  assert.equal(validateConversationResult(probe.responses[0].body).valid, true);
  assert.equal(probe.responses[0].body.status, 'error');
  assert.equal(probe.responses[0].body.error.code, 'CHAT_PROCESSING_FAILED');
});

summary();
