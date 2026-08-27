#!/usr/bin/env node

import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';

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
  buildBriefReplyInstruction,
  buildCompactCodeInstruction,
  buildCompactNamingInstruction,
  buildCreativeContextUpdateInstruction,
  buildCountedCreativeInstruction,
  buildCreativeDescriptionInstruction,
  buildFullCodeDeliverableInstruction,
  buildFullCreativeDeliverableInstruction,
  buildLongCreativeInstruction,
  buildStandardCreativeInstruction,
  buildStandardConversationInstruction,
  selectAnswerTokenBudget,
} from '../src/chat/handlers/decisions.js';
import {
  getConversationStore,
  resetConversationStore,
} from '../src/chat/conversation-store.js';
import {
  assertCompletedExpertiseGeneration,
  buildExpertiseScopeInstruction,
  selectExpertiseTokenBudget,
} from '../src/chat/handlers/expertise.js';
import {
  getLanguageContext,
  inferUserLanguageFromHistory,
} from '../src/chat/handlers/utils/language.js';
import { recordDecision as recordWorkflowIntent } from '../src/skills/detector.js';
import { inspectChatJourneyResult } from './helpers/chat-journey-response.js';
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

function createHistoryRouteProbe(db, {
  safeError = () => ({ error: 'Internal server error' }),
} = {}) {
  const responses = [];
  const routes = createChatRoutes({
    db,
    parseBody: async request => request.body,
    sendJSON: (response, statusCode, body) => {
      responses.push({ statusCode, body });
      response.writableEnded = true;
    },
    sendStaticFile() {},
    safeError,
    safeParseInt: value => Number.parseInt(value, 10),
    logger: silentLog,
    ChatController: { handle: async () => { throw new Error('not used'); } },
    config: {},
    expertiseLayer: null,
  });
  return {
    responses,
    route: routes['GET /api/conversations/:id/messages'],
  };
}

function createHistorySqliteFixture() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      archived_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
  `);
  const findConversation = sqlite.prepare(
    'SELECT * FROM conversations WHERE id = ?',
  );
  const listMessages = sqlite.prepare(`
    SELECT id, conversation_id, role, content, metadata, created_at
    FROM messages
    WHERE conversation_id = ?
    ORDER BY id ASC
  `);
  const transactionObservations = [];
  const adapter = {
    conversations: {
      findById: {
        get(id) {
          transactionObservations.push(['conversation', sqlite.inTransaction]);
          return findConversation.get(id);
        },
      },
    },
    messages: {
      listByConversation: {
        all(id) {
          transactionObservations.push(['messages', sqlite.inTransaction]);
          return listMessages.all(id);
        },
      },
    },
    transaction(fn) {
      return sqlite.transaction(fn)();
    },
  };
  return { adapter, sqlite, transactionObservations };
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

test('ANSWER model generation receives the request cancellation signal', () => {
  const source = readFileSync(
    new URL('../src/chat/handlers/decisions.js', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /generateChatResponse\(currentPrompt, systemPrompt, \{[\s\S]*?maxTokens: selectAnswerTokenBudget\(input, decision\.intent\),[\s\S]*?signal: context\.signal \|\| null,[\s\S]*?\}\);/u,
  );
});

test('ANSWER token budgets bound short chat without constraining richer intents below authority', () => {
  assert.equal(selectAnswerTokenBudget('OK', 'CONVERSATIONAL'), 64);
  assert.equal(selectAnswerTokenBudget('Jak se máš?', 'CONVERSATIONAL'), 128);
  assert.equal(selectAnswerTokenBudget('Co si myslíš o Pythonu?', 'CONVERSATIONAL'), 128);
  assert.equal(selectAnswerTokenBudget('x'.repeat(161), 'CONVERSATIONAL'), 1200);
  assert.equal(selectAnswerTokenBudget('Napiš haiku o kávě', 'CREATIVE'), 256);
  assert.equal(selectAnswerTokenBudget('Pomoz mi napsat email', 'CREATIVE'), 256);
  assert.equal(selectAnswerTokenBudget('Vymysli název pro knihovnu.', 'CREATIVE'), 128);
  assert.equal(selectAnswerTokenBudget('Téma bude námořní dobrodružství.', 'CREATIVE'), 128);
  assert.equal(selectAnswerTokenBudget('Vymysli itinerář na 3 dny.', 'CREATIVE'), 768);
  assert.equal(selectAnswerTokenBudget('Napiš úvodní scénu povídky.', 'CREATIVE'), 768);
  assert.equal(selectAnswerTokenBudget('Napiš finální verzi celého textu písně.', 'CREATIVE'), 1024);
  assert.equal(selectAnswerTokenBudget('Napiš mi funkci pro faktoriál.', 'CODE'), 512);
  assert.equal(selectAnswerTokenBudget('Napiš mi kompletní produkční API.', 'CODE'), 768);
  assert.equal(selectAnswerTokenBudget('Help me write an e-mail', 'CREATIVE'), 256);
  assert.equal(selectAnswerTokenBudget('napiš příběh', 'CREATIVE'), 768);
  assert.match(buildBriefReplyInstruction('Díky', 'cs'), /právě jednou krátkou/u);
  assert.match(buildBriefReplyInstruction('Thanks', 'en'), /exactly one short/u);
  assert.equal(buildBriefReplyInstruction('Co si myslíš o Pythonu?', 'cs'), '');
  assert.match(
    buildStandardConversationInstruction('Co si myslíš o Pythonu?', 'cs', 'CONVERSATIONAL'),
    /nejvýše 45 slovy/u,
  );
  assert.equal(buildStandardConversationInstruction('Díky', 'cs', 'CONVERSATIONAL'), '');
  assert.equal(buildStandardConversationInstruction('Co je Python?', 'cs', 'CODE'), '');
  assert.match(buildCompactCodeInstruction('Napiš mi jednoduchý HTTP server.', 'cs', 'CODE'), /jedním code blockem/u);
  assert.equal(buildCompactCodeInstruction('Napiš mi kompletní produkční API.', 'cs', 'CODE'), '');
  assert.match(buildCompactNamingInstruction('Vymysli název pro knihovnu.', 'cs', 'CREATIVE'), /nejvýše 5/u);
  assert.match(buildCreativeContextUpdateInstruction('Téma bude námořní dobrodružství.', 'cs', 'CREATIVE'), /právě ve 2 větách/u);
  assert.equal(buildCreativeContextUpdateInstruction('Vytvoř hlavní quest.', 'cs', 'CREATIVE'), '');
  assert.match(buildCountedCreativeInstruction('Jaké encountery mohou potkat? Navrhni 3.', 'cs', 'CREATIVE'), /Každá má nejvýše 35 slov/u);
  assert.match(buildCreativeDescriptionInstruction('Popiš prostředí temného lesa.', 'cs', 'CREATIVE'), /nejvýše 120 slovy/u);
  assert.match(buildStandardCreativeInstruction('Vymysli itinerář na 3 dny.', 'cs', 'CREATIVE'), /nejvýše 150 slov/u);
  assert.equal(buildStandardCreativeInstruction('Napiš úvodní scénu povídky.', 'cs', 'CREATIVE'), '');
  assert.match(buildLongCreativeInstruction('Napiš úvodní scénu povídky.', 'cs', 'CREATIVE'), /nejvýše 180 slov/u);
  assert.equal(buildLongCreativeInstruction('Napiš finální verzi celého textu písně.', 'cs', 'CREATIVE'), '');
  assert.match(buildFullCreativeDeliverableInstruction('Napiš finální verzi celého textu písně.', 'cs', 'CREATIVE'), /nejvýše 280 slov/u);
  assert.match(buildFullCodeDeliverableInstruction('Napiš mi kompletní produkční API.', 'cs', 'CODE'), /nejvýše 260 slov/u);
});

test('expertise generation pairs bounded budgets with complete terminal output', () => {
  assert.equal(selectExpertiseTokenBudget('Ahoj, pomůžeš mi?'), 128);
  assert.equal(selectExpertiseTokenBudget('Porovnej tři možnosti a doporuč jednu.'), 384);
  assert.equal(selectExpertiseTokenBudget('Napiš úvodní scénu povídky.'), 512);
  assert.equal(selectExpertiseTokenBudget('Napiš middleware pro JWT.'), 640);
  assert.equal(selectExpertiseTokenBudget('Napiš finální verzi celého textu písně.'), 1024);
  assert.match(buildExpertiseScopeInstruction('Ahoj, pomůžeš mi?'), /at most 45 words/u);
  assert.match(buildExpertiseScopeInstruction('Porovnej tři možnosti.'), /at most 120 words/u);
  assert.match(buildExpertiseScopeInstruction('Napiš úvodní scénu povídky.'), /at most 170 words/u);
  assert.match(buildExpertiseScopeInstruction('Napiš middleware pro JWT.'), /close the final code block/u);
  assert.match(buildExpertiseScopeInstruction('Napiš finální verzi celého textu písně.'), /finish the final section/u);
  assert.throws(
    () => assertCompletedExpertiseGeneration({ finishReason: 'length' }, 'Expert'),
    error => error?.code === 'EXPERT_RESPONSE_TRUNCATED',
  );
  assert.equal(
    assertCompletedExpertiseGeneration({ finishReason: 'stop', content: 'complete' }, 'Expert').content,
    'complete',
  );
});

test('model journey harness distinguishes answers from expected live-authority terminals', () => {
  assert.deepEqual(
    inspectChatJourneyResult('Co je Python?', { response: 'Programovací jazyk.', metadata: {} }),
    { kind: 'answer', response: 'Programovací jazyk.' },
  );

  assert.throws(
    () => inspectChatJourneyResult('Jaký dopad má AI?', {
      response: 'authority denied',
      metadata: {
        handler: 'tool.authority',
        securityBlocked: true,
        fallbackSuppressed: true,
        error: 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE',
      },
    }),
    /Unexpected authority terminal/u,
  );

  assert.throws(
    () => inspectChatJourneyResult('Co je algoritmus?', {
      response: 'Algoritmus je přesný postup, který',
      metadata: { finishReason: 'length' },
    }),
    /Truncated model response/u,
  );

  assert.throws(
    () => inspectChatJourneyResult('Kolik tam žije lidí?', {
      response: 'Chcete najít informace, nebo vytvořit přehled?',
      metadata: { awaitingClarification: true },
    }),
    /Unexpected clarification/u,
  );

  assert.deepEqual(
    inspectChatJourneyResult('What are the current trends in IT business?', {
      response: 'authority denied',
      metadata: {
        handler: 'tool.authority',
        securityBlocked: true,
        fallbackSuppressed: true,
        error: 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE',
      },
    }),
    {
      kind: 'expected_authority_terminal',
      response: 'authority denied',
      errorCode: 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE',
    },
  );

  assert.throws(
    () => inspectChatJourneyResult('Review the current implementation.', {
      response: 'authority denied',
      metadata: {
        handler: 'tool.authority',
        securityBlocked: true,
        fallbackSuppressed: true,
        error: 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE',
      },
    }),
    /Unexpected authority terminal/u,
  );

  assert.throws(
    () => inspectChatJourneyResult('What are the current trends in IT business?', {
      response: 'Unverified current trends from the model.',
      metadata: {},
    }),
    /Expected live-authority terminal/u,
  );

  assert.throws(
    () => inspectChatJourneyResult('10 * 9 * 8', {
      response: 'Výsledek výpočtu je 720. Jedná se o součin tří čísel.',
      metadata: {},
    }, { expectedLanguage: 'en' }),
    /Expected English response but received Czech content/u,
  );

  assert.throws(
    () => inspectChatJourneyResult('2050 - 2026', {
      response: 'Mám z toho vytvořit skill? (ano/ne)',
      metadata: { proposalShown: true },
    }, { expectedLanguage: 'en' }),
    /Unexpected skill proposal/u,
  );
});

test('language-neutral follow-up inherits only the latest durable user language', () => {
  const history = [
    { response: { tag: { speaker: 'user' }, content: 'Please explain artificial intelligence.' } },
    { response: { tag: { speaker: 'system' }, content: 'Umělá inteligence je obor informatiky.' } },
    { response: { tag: { speaker: 'user' }, content: '10 * 9 * 8' } },
  ];
  const language = inferUserLanguageFromHistory(history);
  assert.equal(language, 'en');
  assert.equal(getLanguageContext('10 * 9 * 8', language).language, 'en');

  assert.equal(inferUserLanguageFromHistory([
    { response: { tag: { speaker: 'system' }, content: 'This assistant output is English.' } },
    { response: { tag: { speaker: 'user' }, content: '12345' } },
  ]), 'cs');
});

test('workflow detector records semantic productive intents, not transport decisions', () => {
  const state = {};
  recordWorkflowIntent(state, 'TOOL_CALL', 'transport-session');
  recordWorkflowIntent(state, 'LOCAL', 'transport-session');
  assert.equal(state._workflowSequence, undefined);

  recordWorkflowIntent(state, 'SEARCH', 'semantic-session');
  recordWorkflowIntent(state, 'CODE', 'semantic-session');
  assert.deepEqual(state._workflowSequence, ['SEARCH', 'CODE']);
});

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

suite('M1 chat — atomic history snapshot authority');

await testAsync('existing empty and non-empty conversations are read in one SQLite transaction', async () => {
  const fixture = createHistorySqliteFixture();
  try {
    fixture.sqlite.prepare(
      'INSERT INTO conversations (id, archived_at, deleted_at) VALUES (?, ?, ?)',
    ).run('history-empty', null, null);
    fixture.sqlite.prepare(
      'INSERT INTO conversations (id, archived_at, deleted_at) VALUES (?, ?, ?)',
    ).run('history-archived', '2026-08-08T00:00:00.000Z', null);
    fixture.sqlite.prepare(`
      INSERT INTO messages (conversation_id, role, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'history-archived',
      'assistant',
      'durable answer',
      JSON.stringify({ mode: 'conversation' }),
      '2026-08-08T00:00:01.000Z',
    );
    const probe = createHistoryRouteProbe(fixture.adapter);

    await probe.route({}, openResponse(), { id: 'history-empty' });
    assert.equal(probe.responses[0].statusCode, 200);
    assert.deepEqual(probe.responses[0].body, { messages: [] });
    assert.deepEqual(fixture.transactionObservations, [
      ['conversation', true],
      ['messages', true],
    ]);

    fixture.transactionObservations.length = 0;
    await probe.route({}, openResponse(), { id: 'history-archived' });
    assert.equal(probe.responses[1].statusCode, 200);
    assert.equal(probe.responses[1].body.messages.length, 1);
    assert.equal(probe.responses[1].body.messages[0].content, 'durable answer');
    assert.deepEqual(fixture.transactionObservations, [
      ['conversation', true],
      ['messages', true],
    ]);
  } finally {
    fixture.sqlite.close();
  }
});

await testAsync('missing conversation is typed 404 without reading orphan messages', async () => {
  const fixture = createHistorySqliteFixture();
  try {
    fixture.sqlite.prepare(`
      INSERT INTO messages (conversation_id, role, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'history-missing',
      'assistant',
      'orphan row must not create existence',
      null,
      '2026-08-08T00:00:01.000Z',
    );
    const probe = createHistoryRouteProbe(fixture.adapter);
    await probe.route({}, openResponse(), { id: 'history-missing' });

    assert.deepEqual(probe.responses, [{
      statusCode: 404,
      body: {
        error: 'Conversation not found',
        code: 'CONVERSATION_NOT_FOUND',
      },
    }]);
    assert.deepEqual(fixture.transactionObservations, [['conversation', true]]);
  } finally {
    fixture.sqlite.close();
  }
});

await testAsync('missing transaction, DB failure, and malformed snapshot stay sanitized 500', async () => {
  const fixtures = [
    {
      conversations: { findById: { get: () => ({ id: 'unsafe' }) } },
      messages: { listByConversation: { all: () => [] } },
    },
    {
      transaction() {
        throw new Error('private database transaction failure');
      },
    },
    {
      transaction() {
        return { found: true, messages: 'not-an-array' };
      },
    },
  ];

  for (const db of fixtures) {
    const probe = createHistoryRouteProbe(db);
    await probe.route({}, openResponse(), { id: 'history-failure' });
    assert.deepEqual(probe.responses, [{
      statusCode: 500,
      body: { error: 'Internal server error' },
    }]);
    assert.equal(JSON.stringify(probe.responses).includes('private'), false);
  }
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

await testAsync('invalid command and inactive HTTP cancel never reach the controller', async () => {
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
    'M1_HTTP_CANCEL_NOT_ACTIVE',
  );
});

await testAsync('HTTP cancel targets one conversation and keeps its own operation identity', async () => {
  const pending = new Map();
  let startA;
  let startB;
  let releaseAbortA;
  const startedA = new Promise(resolve => { startA = resolve; });
  const startedB = new Promise(resolve => { startB = resolve; });
  const abortAReleased = new Promise(resolve => { releaseAbortA = resolve; });
  const probe = createRouteProbe(request => {
    if (request.requestId === 'm1-http-send-A-after-cancel') {
      return {
        response: 'conversation A accepted a new turn',
        mode: 'conversation',
        confidence: 1,
      };
    }
    return new Promise((resolve, reject) => {
      pending.set(request.conversationId, { request, resolve });
      request.signal.addEventListener('abort', () => {
        if (request.conversationId === 'm1-http-conversation-A') {
          abortAReleased.then(() => reject(request.signal.reason));
        } else {
          reject(request.signal.reason);
        }
      }, { once: true });
      if (request.conversationId === 'm1-http-conversation-A') startA();
      if (request.conversationId === 'm1-http-conversation-B') startB();
    });
  });
  const commandA = {
    ...httpCommand,
    requestId: 'm1-http-send-A',
    conversationId: 'm1-http-conversation-A',
    turnId: 'm1-http-turn-A',
  };
  const duplicateA = {
    ...commandA,
    requestId: 'm1-http-send-A-duplicate',
    turnId: 'm1-http-turn-A-duplicate',
  };
  const commandB = {
    ...httpCommand,
    requestId: 'm1-http-send-B',
    conversationId: 'm1-http-conversation-B',
    turnId: 'm1-http-turn-B',
  };
  const cancelA = {
    contract: httpCommand.contract,
    version: httpCommand.version,
    requestId: 'm1-http-cancel-A',
    conversationId: commandA.conversationId,
    turnId: 'm1-http-cancel-turn-A',
    action: 'cancel',
  };
  const secondCancelA = {
    ...cancelA,
    requestId: 'm1-http-cancel-A-second',
    turnId: 'm1-http-cancel-turn-A-second',
  };

  const responseA = openResponse();
  const responseB = openResponse();
  const activeA = probe.route(requestFor(commandA), responseA);
  await startedA;
  await probe.route(requestFor(duplicateA), openResponse());
  const activeB = probe.route(requestFor(commandB), responseB);
  await startedB;

  const identityConflict = {
    ...cancelA,
    requestId: commandA.requestId,
    turnId: 'm1-http-conflicting-cancel-turn-A',
  };
  await probe.route(requestFor(identityConflict), openResponse());
  const conflictTerminal = probe.responses.at(-1);
  assert.equal(conflictTerminal.statusCode, 409);
  assert.equal(conflictTerminal.body.error.code, 'M1_HTTP_CANCEL_IDENTITY_CONFLICT');
  assert.equal(pending.get(commandA.conversationId).request.signal.aborted, false);

  const cancelOperation = probe.route(requestFor(cancelA), openResponse());
  const repeatedCancelOperation = probe.route(requestFor(secondCancelA), openResponse());
  await new Promise(resolve => setImmediate(resolve));
  releaseAbortA();
  await Promise.all([activeA, cancelOperation, repeatedCancelOperation]);

  assert.equal(pending.get(commandA.conversationId).request.signal.aborted, true);
  assert.equal(pending.get(commandB.conversationId).request.signal.aborted, false);
  pending.get(commandB.conversationId).resolve({
    response: 'conversation B remains independent',
    mode: 'conversation',
    confidence: 1,
  });
  await activeB;

  const resumedA = {
    ...commandA,
    requestId: 'm1-http-send-A-after-cancel',
    turnId: 'm1-http-turn-A-after-cancel',
  };
  await probe.route(requestFor(resumedA), openResponse());
  const cancelAfterCompletion = {
    ...cancelA,
    requestId: 'm1-http-cancel-A-after-completion',
    turnId: 'm1-http-cancel-turn-A-after-completion',
  };
  await probe.route(requestFor(cancelAfterCompletion), openResponse());

  const byRequestId = new Map(probe.responses.map(entry => [entry.body.requestId, entry]));
  assert.equal(probe.calls.length, 3, 'only A, B, and resumed A may reach the controller');
  assert.equal(byRequestId.get(duplicateA.requestId).statusCode, 409);
  assert.equal(byRequestId.get(duplicateA.requestId).body.error.code, 'M1_CONVERSATION_BUSY');

  const targetTerminal = byRequestId.get(commandA.requestId);
  assert.equal(targetTerminal.statusCode, 409);
  assert.equal(targetTerminal.body.status, 'cancelled');
  assert.equal(targetTerminal.body.error.code, 'CHAT_CANCELLED');
  assert.equal(Object.hasOwn(targetTerminal.body, 'response'), false);

  const cancelTerminal = byRequestId.get(cancelA.requestId);
  assert.equal(cancelTerminal.statusCode, 200);
  assert.equal(cancelTerminal.body.status, 'cancelled');
  assert.equal(cancelTerminal.body.conversationId, commandA.conversationId);
  assert.equal(cancelTerminal.body.turnId, cancelA.turnId);
  assert.equal(cancelTerminal.body.error.code, 'CHAT_CANCELLED');
  assert.equal(Object.hasOwn(cancelTerminal.body, 'response'), false);
  assert.equal(byRequestId.get(secondCancelA.requestId).statusCode, 200);
  assert.equal(byRequestId.get(secondCancelA.requestId).body.status, 'cancelled');

  const independentTerminal = byRequestId.get(commandB.requestId);
  assert.equal(independentTerminal.statusCode, 200);
  assert.equal(independentTerminal.body.status, 'ok');
  assert.equal(independentTerminal.body.response.content, 'conversation B remains independent');
  assert.equal(byRequestId.get(resumedA.requestId).statusCode, 200);
  assert.equal(byRequestId.get(resumedA.requestId).body.status, 'ok');
  assert.equal(byRequestId.get(cancelAfterCompletion.requestId).statusCode, 409);
  assert.equal(
    byRequestId.get(cancelAfterCompletion.requestId).body.error.code,
    'M1_HTTP_CANCEL_NOT_ACTIVE',
  );
});

await testAsync('non-cooperative handler cannot turn an aborted request into late success', async () => {
  let start;
  let resolveLate;
  let activeSignal;
  const started = new Promise(resolve => { start = resolve; });
  const probe = createRouteProbe(request => new Promise(resolve => {
    activeSignal = request.signal;
    resolveLate = resolve;
    start();
  }), { timeoutMs: 10 });
  const send = {
    ...httpCommand,
    requestId: 'm1-http-ignore-abort-send',
    conversationId: 'm1-http-ignore-abort-conversation',
    turnId: 'm1-http-ignore-abort-turn',
  };
  const cancel = {
    contract: httpCommand.contract,
    version: httpCommand.version,
    requestId: 'm1-http-ignore-abort-cancel',
    conversationId: send.conversationId,
    turnId: 'm1-http-ignore-abort-cancel-turn',
    action: 'cancel',
  };

  const sendPending = probe.route(requestFor(send), openResponse());
  await started;
  await probe.route(requestFor(cancel), openResponse());
  assert.equal(activeSignal.aborted, true);

  const cancelTerminal = probe.responses.find(entry => entry.body.requestId === cancel.requestId);
  assert.equal(cancelTerminal.statusCode, 504);
  assert.equal(cancelTerminal.body.status, 'timeout');
  assert.equal(cancelTerminal.body.error.code, 'CHAT_TIMEOUT');

  resolveLate({ response: 'late false success', mode: 'conversation', confidence: 1 });
  await sendPending;
  const targetTerminal = probe.responses.find(entry => entry.body.requestId === send.requestId);
  assert.equal(targetTerminal.statusCode, 409);
  assert.equal(targetTerminal.body.status, 'cancelled');
  assert.equal(Object.hasOwn(targetTerminal.body, 'response'), false);
});

await testAsync('timeout that precedes cancel is never relabelled as confirmed cancellation', async () => {
  let start;
  let releaseTimeout;
  const started = new Promise(resolve => { start = resolve; });
  const release = new Promise(resolve => { releaseTimeout = resolve; });
  let observeTimeout;
  const timeoutObserved = new Promise(resolve => { observeTimeout = resolve; });
  const probe = createRouteProbe(request => new Promise((resolve, reject) => {
    request.signal.addEventListener('abort', () => {
      observeTimeout(abortSourceOf(request.signal.reason, request.signal));
      release.then(() => reject(request.signal.reason));
    }, { once: true });
    start();
  }), { timeoutMs: 5 });
  const send = {
    ...httpCommand,
    requestId: 'm1-http-timeout-first-send',
    conversationId: 'm1-http-timeout-first-conversation',
    turnId: 'm1-http-timeout-first-turn',
  };
  const cancel = {
    contract: httpCommand.contract,
    version: httpCommand.version,
    requestId: 'm1-http-timeout-first-cancel',
    conversationId: send.conversationId,
    turnId: 'm1-http-timeout-first-cancel-turn',
    action: 'cancel',
  };

  const sendPending = probe.route(requestFor(send), openResponse());
  await started;
  assert.equal(await timeoutObserved, AbortSource.TIMEOUT);
  const cancelPending = probe.route(requestFor(cancel), openResponse());
  await new Promise(resolve => setImmediate(resolve));
  releaseTimeout();
  await Promise.all([sendPending, cancelPending]);

  const byRequestId = new Map(probe.responses.map(entry => [entry.body.requestId, entry]));
  assert.equal(byRequestId.get(send.requestId).statusCode, 504);
  assert.equal(byRequestId.get(send.requestId).body.status, 'timeout');
  assert.equal(byRequestId.get(cancel.requestId).statusCode, 409);
  assert.equal(byRequestId.get(cancel.requestId).body.status, 'error');
  assert.equal(
    byRequestId.get(cancel.requestId).body.error.code,
    'M1_HTTP_CANCEL_NOT_CONFIRMED',
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
