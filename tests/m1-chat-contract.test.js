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
  ChatContextCapacityError,
  ChatTurnErrorCode,
  LLMProviderUnavailableError,
  ModelResponseTruncatedError,
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
  buildAnswerContext,
  isAnswerExpansion,
  handleAnswerDecision,
} from '../src/chat/handlers/decisions.js';
import {
  ConversationStore,
  TurnRole,
  getConversationStore,
  resetConversationStore,
} from '../src/chat/conversation-store.js';
import { config } from '../src/config.js';
import { clearNumCtxCache, setNumCtx } from '../src/llm/model-ctx.js';
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
import { llmGateway } from '../src/llm/gateway.js';
import { conversationHandler } from '../src/chat/handlers/conversation.js';
import { creDecisionEngine } from '../src/chat/cre-decision.js';
import { windowFillMessage } from '../scripts/chat85-window-values.js';

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
  result = makeResult(),
  signal = null,
  persistAssistantTurn,
  scoreResponse = async () => ({ total: 100, dimensions: {}, issues: [] }),
} = {}) {
  return finalizeChatResponse({
    result,
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
    /generateChatResponse\(currentPrompt, systemPrompt, \{[\s\S]*?maxTokens: answerContext\.maxTokens,[\s\S]*?signal: context\.signal \|\| null,[\s\S]*?\}\);/u,
  );
});

test('ANSWER token budgets bound short chat without constraining richer intents below authority', () => {
  assert.equal(selectAnswerTokenBudget('OK', 'CONVERSATIONAL'), 64);
  assert.equal(selectAnswerTokenBudget('Jak se máš?', 'CONVERSATIONAL'), 128);
  assert.equal(selectAnswerTokenBudget('Co si myslíš o Pythonu?', 'CONVERSATIONAL'), 1200);
  for (const topic of ['Python', '?', 'DNS', 'Co je AI?']) {
    assert.equal(selectAnswerTokenBudget(topic, 'CONVERSATIONAL'), 1200);
    assert.doesNotMatch(buildStandardConversationInstruction(topic, 'en', 'CONVERSATIONAL'), /45 words|2–3 sentences/u);
    assert.equal(buildBriefReplyInstruction(topic, 'en'), '');
  }
  assert.equal(selectAnswerTokenBudget('Thanks', 'CONVERSATIONAL'), 64);
  assert.equal(selectAnswerTokenBudget('How are you?', 'CONVERSATIONAL'), 128);
  assert.equal(selectAnswerTokenBudget('x'.repeat(10), 'CONVERSATIONAL'), 1200);
  assert.equal(selectAnswerTokenBudget('x'.repeat(160), 'CONVERSATIONAL'), 1200);
  assert.equal(selectAnswerTokenBudget('x'.repeat(161), 'CONVERSATIONAL'), 2048);
  assert.equal(selectAnswerTokenBudget('Napiš haiku o kávě', 'CREATIVE'), 256);
  assert.equal(selectAnswerTokenBudget('Pomoz mi napsat email', 'CREATIVE'), 768);
  assert.equal(selectAnswerTokenBudget('Vymysli název pro knihovnu.', 'CREATIVE'), 128);
  assert.equal(selectAnswerTokenBudget('Téma bude námořní dobrodružství.', 'CREATIVE'), 128);
  assert.equal(selectAnswerTokenBudget('Vymysli itinerář na 3 dny.', 'CREATIVE'), 768);
  assert.equal(selectAnswerTokenBudget('Napiš úvodní scénu povídky.', 'CREATIVE'), 768);
  assert.equal(selectAnswerTokenBudget('Napiš finální verzi celého textu písně.', 'CREATIVE'), 1024);
  assert.equal(selectAnswerTokenBudget('Napiš mi funkci pro faktoriál.', 'CODE'), 512);
  assert.equal(selectAnswerTokenBudget('Napiš mi kompletní produkční API.', 'CODE'), 768);
  assert.equal(selectAnswerTokenBudget('Help me write an e-mail', 'CREATIVE'), 768);
  assert.equal(selectAnswerTokenBudget('napiš příběh', 'CREATIVE'), 768);
  assert.match(buildBriefReplyInstruction('Díky', 'cs'), /právě jednou krátkou/u);
  assert.match(buildBriefReplyInstruction('Thanks', 'en'), /exactly one short/u);
  assert.equal(buildBriefReplyInstruction('Co si myslíš o Pythonu?', 'cs'), '');
  assert.match(
    buildStandardConversationInstruction('Co si myslíš o Pythonu?', 'cs', 'CONVERSATIONAL'),
    /Přizpůsob hloubku požadavku/u,
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
  assert.match(buildStandardCreativeInstruction('Pomoz mi napsat email', 'cs', 'CREATIVE'), /nejvýše 150 slov/u);
  assert.match(buildStandardCreativeInstruction('Help me write an e-mail', 'en', 'CREATIVE'), /at most 150 words/u);
  assert.equal(buildStandardCreativeInstruction('Napiš haiku o kávě', 'cs', 'CREATIVE'), '');
  assert.equal(buildStandardCreativeInstruction('Napiš úvodní scénu povídky.', 'cs', 'CREATIVE'), '');
  assert.match(buildLongCreativeInstruction('Napiš úvodní scénu povídky.', 'cs', 'CREATIVE'), /nejvýše 180 slov/u);
  assert.equal(buildLongCreativeInstruction('Napiš finální verzi celého textu písně.', 'cs', 'CREATIVE'), '');
  assert.match(buildFullCreativeDeliverableInstruction('Napiš finální verzi celého textu písně.', 'cs', 'CREATIVE'), /nejvýše 280 slov/u);
  assert.match(buildFullCodeDeliverableInstruction('Napiš mi kompletní produkční API.', 'cs', 'CODE'), /nejvýše 260 slov/u);
});

test('detail requests retain headroom and cannot replay effects as presentation changes', () => {
  for (const input of ['vic detailu', 'více detailů', 'chci vic detailu', 'podrobneji', 'please explain more', 'muzes mi detailne popsat jak to funguje']) {
    assert.equal(selectAnswerTokenBudget(input, 'CONVERSATIONAL'), 2048, input);
  }
  for (const input of ['vic detailu', 'více detailů', 'chci vic detailu', 'vid detailu', 'rozved to']) assert.equal(isAnswerExpansion(input), true, input);
  for (const input of ['smaz projekt a dej vic detailu', 'najdi podrobnosti o počasí', 'schválit web abc', 'víc detailů o jiném tématu', '']) assert.equal(isAnswerExpansion(input), false, input);
});

test('history preserves complete useful turns within the effective model context', () => {
  const previous = 'Konkrétní vysvětlení. '.repeat(24) + 'CONCLUSION_BEYOND_200_CHARS';
  const history = [
    { response: { tag: { speaker: 'user' }, content: 'Co je Docker a Kubernetes?' } },
    { response: { tag: { speaker: 'system' }, content: previous } },
    { response: { tag: { speaker: 'user' }, content: 'vic detailu' } },
  ];
  const result = buildAnswerContext('vic detailu', history, 'Odpovídej česky.', 2048, 4096);
  assert.match(result.prompt, /CONCLUSION_BEYOND_200_CHARS/);
  assert.equal(result.prompt.match(/vic detailu/g).length, 1);
  assert.match(result.prompt, /"role":"assistant"/);
  assert.equal(result.historyTurns, 2);
  assert.equal(result.maxTokens, 2048);
  const huge = buildAnswerContext('Celý aktuální požadavek', [{response:{content:'x'.repeat(50000)+'TAIL_MARKER',tag:{speaker:'system'}}}], 'Instrukce', 2048, 4096);
  assert.match(huge.prompt, /TAIL_MARKER/);
  assert.match(huge.prompt, /část historie vynechána/);
  assert.match(huge.prompt, /Celý aktuální požadavek$/);
  assert(Buffer.byteLength(huge.prompt+'Instrukce')/2+huge.maxTokens+384 <= 4096);
  assert.throws(() => buildAnswerContext('x'.repeat(20000), [], 'Instrukce', 2048, 4096), /nevejde/);
});

test('the full summary including its middle fact is retained when it fits beside the answer budget', () => {
  const summaryContent = '[Souhrn předchozí konverzace]\nSUMMARY_HEAD '
    + 'x'.repeat(1_000) + ' SUMMARY_MIDDLE_FACT_RIGEL_731 '
    + 'y'.repeat(1_000) + ' SUMMARY_TAIL';
  const history = [
    { isSummary: true, response: { tag: { speaker: 'system' }, content: summaryContent } },
    { response: { tag: { speaker: 'user' }, content: 'Antecedent.' } },
    { response: { tag: { speaker: 'user' }, content: 'nový dotaz' } },
  ];
  const result = buildAnswerContext('nový dotaz', history, 'I'.repeat(1_200), 1_200, 4_096);
  assert.match(result.prompt, /SUMMARY_MIDDLE_FACT_RIGEL_731/u);
  assert.match(result.prompt, /Antecedent\./u);
  assert(result.prompt.includes(JSON.stringify({ role: 'summary', content: summaryContent })));
  assert.equal(result.maxTokens, 1_200);
  assert(Buffer.byteLength(result.prompt + 'I'.repeat(1_200)) / 2 + result.maxTokens + 384 <= 4_096);
});

test('a long conversational turn reserves a compact output to fit the complete summary', () => {
  const input = 'q'.repeat(2_499);
  const summaryContent = '[Souhrn předchozí konverzace]\nHEAD '
    + 'x'.repeat(450) + ' MIDDLE_FACT_ALTAIR_612 '
    + 'y'.repeat(450) + ' TAIL';
  const history = [
    { isSummary: true, response: { tag: { speaker: 'system' }, content: summaryContent } },
    { response: { tag: { speaker: 'user' }, content: input } },
  ];
  const systemPrompt = 'I'.repeat(3_149);
  assert.throws(() => buildAnswerContext(input, history, systemPrompt, 2_048, 4_096),
    /Souhrn konverzace se nevejde/u);
  const result = buildAnswerContext(input, history, systemPrompt, 2_048, 4_096,
    { allowSummaryOutputTradeoff: true });
  assert(result.prompt.includes(JSON.stringify({ role: 'summary', content: summaryContent })));
  assert(result.maxTokens >= 256 && result.maxTokens < 512);
  assert(Buffer.byteLength(result.prompt + systemPrompt) / 2 + result.maxTokens + 384 <= 4_096);
});

test('an oversized durable summary fails closed instead of dropping its middle', () => {
  const history = [
    { isSummary: true, response: { tag: { speaker: 'system' }, content: '[Souhrn předchozí konverzace]\nSUMMARY_HEAD ' + 'x'.repeat(20_000) + ' SUMMARY_TAIL' } },
    ...Array.from({ length: 9 }, (_, index) => ({ response: {
      tag: { speaker: index % 2 ? 'system' : 'user' },
      content: `recent-${index} ` + 'kontext '.repeat(40),
    } })),
    { response: { tag: { speaker: 'user' }, content: 'nový dotaz' } },
  ];
  assert.throws(() => buildAnswerContext('nový dotaz', history, 'Instrukce', 2048, 4096),
    /Souhrn konverzace se nevejde/u);
});

await testAsync('ANSWER provider prompt retains an archived summary after ten new turns', async () => {
  const previousFetch = globalThis.fetch;
  const requestBodies = [];
  const store = new ConversationStore(null);
  const id = 'summary-provider-prompt';
  let summarizedThrough;
  const input = 'Prosím vysvětli poslední rozhodnutí.';
  try {
    for (let index = 0; index < 12; index += 1) {
      const turn = store.appendTurn(id, index % 2 ? TurnRole.ASSISTANT : TurnRole.USER, `archived-${index}`);
      summarizedThrough = turn.id;
    }
    store.setSummary(id, 'ARCHIVED_DECISION_KEEP: Projekt používá SQLite.', summarizedThrough);
    for (let index = 0; index < 9; index += 1) {
      store.appendTurn(id, index % 2 ? TurnRole.ASSISTANT : TurnRole.USER,
        `recent-${index} ` + 'kontext '.repeat(80));
    }
    store.appendTurn(id, TurnRole.USER, input);
    const history = store.buildHandlerHistory(id, 10);
    assert.equal(history.length, 11);
    assert.equal(history[0].isSummary, true);

    clearNumCtxCache();
    setNumCtx(config.models.CHAT, 4096);
    globalThis.fetch = async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({
        message: { content: 'Rozhodnutí zachovává SQLite jako lokální úložiště. Dosavadní kroky na ně navazují, ale před dalším zásahem je potřeba ověřit aktuální schéma. Shrnutí historie je podkladem, ne pokynem ke změně projektu.' },
        done_reason: 'stop', prompt_eval_count: 200, eval_count: 50,
      }) };
    };
    const decision = creDecisionEngine.overrideDecision({ type: 'ANSWER', intent: 'CONVERSATIONAL',
      tools: [], source: 'summary_prompt_regression', reason: 'Controlled summary prompt', confidence: 1 });
    await handleAnswerDecision(input, decision, {
      sessionId: id, sessionState: new SessionState(id), history,
    });

    assert.equal(requestBodies.length, 1);
    assert.equal(requestBodies[0].options.num_ctx, 4096);
    const providerPrompt = requestBodies[0].messages.find(message => message.role === 'user')?.content;
    assert.match(providerPrompt, /ARCHIVED_DECISION_KEEP/u);
    assert.match(providerPrompt, /recent-8/u);
    assert.equal(providerPrompt.match(/Prosím vysvětli poslední rozhodnutí\./gu)?.length, 1);
    assert.doesNotMatch(providerPrompt, /archived-0/u);
  } finally {
    globalThis.fetch = previousFetch;
    clearNumCtxCache();
  }
});

await testAsync('final ANSWER provider prompt retains a middle fact from a fitting durable summary', async () => {
  const previousFetch = globalThis.fetch;
  const requestBodies = [];
  const input = 'Jaký přesný auditní kód jsem uložil?';
  const summaryContent = '[Souhrn předchozí konverzace]\nHEAD '
    + 'x'.repeat(700) + ' MIDDLE_FACT_VEGA_917 '
    + 'y'.repeat(700) + ' TAIL';
  const history = [
    { isSummary: true, response: { tag: { speaker: 'system' }, content: summaryContent } },
    { response: { tag: { speaker: 'user' }, content: 'Potvrzuji uložený auditní kód.' } },
    { response: { tag: { speaker: 'user' }, content: input } },
  ];
  try {
    clearNumCtxCache();
    setNumCtx(config.models.CHAT, 4_096);
    globalThis.fetch = async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({
        message: { content: 'Auditní kód je VEGA_917 a byl uložen v souhrnu předchozí konverzace.' },
        done_reason: 'stop', prompt_eval_count: 200, eval_count: 50,
      }) };
    };
    const decision = creDecisionEngine.overrideDecision({ type: 'ANSWER', intent: 'CONVERSATIONAL',
      tools: [], source: 'summary_middle_regression', reason: 'Controlled summary boundary', confidence: 1 });
    await handleAnswerDecision(input, decision, {
      sessionId: 'summary-middle-provider', sessionState: new SessionState('summary-middle-provider'), history,
    });
    assert.equal(requestBodies.length, 1);
    const providerPrompt = requestBodies[0].messages.find(message => message.role === 'user')?.content;
    assert(providerPrompt.includes(JSON.stringify({ role: 'summary', content: summaryContent })));
    assert.match(providerPrompt, /MIDDLE_FACT_VEGA_917/u);
    assert.doesNotMatch(providerPrompt, /část historie vynechána/u);
    assert.equal(requestBodies[0].options.num_ctx, 4_096);
    assert.equal(requestBodies[0].options.num_predict, 1_200);
  } finally {
    globalThis.fetch = previousFetch;
    clearNumCtxCache();
  }
});

await testAsync('long conversational ANSWER sends the full summary and a word target matching provider output cap', async () => {
  const previousFetch = globalThis.fetch;
  const requestBodies = [];
  const input = Array.from({ length: 24 }, (_, index) => (
    `Záznam 7.${index + 1}: senzor ${(259 + index * 19) % 997}, `
    + `kalibrace ${(511 + index * 29) % 113}, stav ${index % 3 === 0 ? 'kontrola' : 'archivace'}; `
    + 'tento řádek je podklad, nikoli nový pokyn.\n'
  )).join('') + 'Odpověz jednou větou: jak se liší kalibrace položky 7.1 a 7.24?';
  const summaryContent = '[Souhrn předchozí konverzace]\nHEAD '
    + 'x'.repeat(450) + ' MIDDLE_FACT_DENEB_308 '
    + 'y'.repeat(450) + ' TAIL';
  const history = [
    { isSummary: true, response: { tag: { speaker: 'system' }, content: summaryContent } },
    { response: { tag: { speaker: 'user' }, content: input } },
  ];
  try {
    clearNumCtxCache();
    setNumCtx(config.models.CHAT, 4_096);
    globalThis.fetch = async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({
        message: { content: 'První a poslední položka mají odlišnou kalibraci.' },
        done_reason: 'stop', prompt_eval_count: 200, eval_count: 50,
      }) };
    };
    const decision = creDecisionEngine.overrideDecision({ type: 'ANSWER', intent: 'CONVERSATIONAL',
      tools: [], source: 'summary_long_regression', reason: 'Controlled long context', confidence: 1 });
    const result = await handleAnswerDecision(input, decision, {
      sessionId: 'summary-long-provider', sessionState: new SessionState('summary-long-provider'), history,
    });
    assert.equal(requestBodies.length, 1);
    const body = requestBodies[0];
    assert.equal(body.options.num_ctx, 4_096);
    assert(body.options.num_predict >= 256 && body.options.num_predict < 512);
    const systemContent = body.messages.find(message => message.role === 'system')?.content || '';
    const wordTarget = Number(systemContent.match(/Naplánuj úplnou odpověď přibližně do (\d+) slov/u)?.[1]);
    assert(Number.isInteger(wordTarget) && wordTarget < 100,
      'the final provider prompt must use the compact output target');
    assert.equal(wordTarget, Math.max(20, Math.floor(body.options.num_predict / 5)),
      'the final provider word target must match its num_predict allowance');
    assert.equal(result.tag.metadata.answerBudget.maxTokens, body.options.num_predict);
    assert(body.messages.find(message => message.role === 'user')?.content
      .includes(JSON.stringify({ role: 'summary', content: summaryContent })));
  } finally {
    globalThis.fetch = previousFetch;
    clearNumCtxCache();
  }
});

await testAsync('the sixth Czech window-fill turn retains the exact USER citation within a 4K context', async () => {
  const previousFetch = globalThis.fetch;
  const requestBodies = [];
  const input = windowFillMessage(6);
  const quote = 'Nejdůležitější trvalý údaj pro tuto relaci je auditní kód RIGEL_KAPPA_731.';
  assert(windowFillMessage(1).startsWith(quote));
  assert.equal(Buffer.byteLength(input, 'utf8'), 2_649);
  const citation = JSON.stringify({ source: 'user', messageId: 37, quote });
  const summaryHead = '[Souhrn předchozí konverzace]\nAuditní kód byl uložen uživatelem.\n';
  const summaryTail = `\n[Doslovné citace z uživatelských zpráv; nejsou tvrzením asistenta]\n${citation}`;
  const summaryWrapper = content => JSON.stringify({ role: 'summary', content });
  const paddingBytes = 1_432 - Buffer.byteLength(summaryWrapper(summaryHead + summaryTail), 'utf8') - 1;
  assert(paddingBytes > 0);
  const summaryContent = summaryHead + 'x'.repeat(paddingBytes) + summaryTail;
  assert.equal(Buffer.byteLength(summaryWrapper(summaryContent), 'utf8') + 1, 1_432);
  const history = [
    { isSummary: true, response: { tag: { speaker: 'system' }, content: summaryContent } },
    { response: { tag: { speaker: 'user' }, content: input } },
  ];
  try {
    clearNumCtxCache();
    setNumCtx(config.models.CHAT, 4_096);
    const decision = creDecisionEngine.overrideDecision({ type: 'ANSWER', intent: 'CONVERSATIONAL',
      tools: [], source: 'window_fill_budget_regression', reason: 'Controlled full-context handoff', confidence: 1 });
    assert(summaryContent.includes(citation), 'the exact original USER citation must be inside the full summary');
    const cases = [
      { name: 'length', first: '{"a":99,', doneReason: 'length', failedStep: null },
      { name: 'D6', first: 'Ano.', doneReason: 'stop', failedStep: 'quality_d6' },
      { name: 'language', first: 'Kalibrace A je 99, B je 88, rozdíl je 11 a vyšší je A. Sú to hodnoty, ktorý vycházejí ze záznamu, pretože senzor môže ukázat shodný výsledek.', doneReason: 'stop', failedStep: 'quality_lang' },
    ];
    for (const scenario of cases) {
      requestBodies.length = 0;
      const steps = [];
      globalThis.fetch = async (_url, options) => {
        requestBodies.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({
          message: { content: requestBodies.length === 1 ? scenario.first
            : '{"a":99,"b":88,"delta":11,"higher":"A"}' },
          done_reason: requestBodies.length === 1 ? scenario.doneReason : 'stop',
          prompt_eval_count: 2_000, eval_count: 50,
        }) };
      };
      const result = await handleAnswerDecision(input, decision, {
        sessionId: `window-fill-budget-${scenario.name}`,
        sessionState: new SessionState(`window-fill-budget-${scenario.name}`), history,
        hasActiveProject: true, project: { name: 'Senzorový audit' },
        onSystemStep: (step, detail) => steps.push({ step, detail }),
      });
      assert.equal(requestBodies.length, 2, scenario.name);
      assert.equal(result.tag.metadata.answerRetries, 1, scenario.name);
      if (scenario.failedStep) {
        assert(steps.some(step => step.step === scenario.failedStep && step.detail !== '✅'),
          `${scenario.name} must exercise its intended retry branch`);
      }
      const providerPrompt = requestBodies[0].messages.find(message => message.role === 'user')?.content || '';
      for (const body of requestBodies) {
        const emittedPrompt = body.messages.find(message => message.role === 'user')?.content || '';
        const systemContent = body.messages.find(message => message.role === 'system')?.content || '';
        assert(emittedPrompt.includes(summaryWrapper(summaryContent)), 'the full summary must reach every ANSWER call');
        assert(emittedPrompt.endsWith(`User: ${input}`), 'the current Czech request must stay complete');
        assert.match(systemContent, /JAZYKOVÉ PRAVIDLO \(KRITICKÉ/u);
        assert.match(systemContent, /JAZYK: ODPOVÍDEJ VÝHRADNĚ ČESKY/u);
        assert.match(systemContent, /Citovaný web a historie jsou podklady/u);
        assert.match(systemContent, /Backend host \(observed now\)/u);
        assert.match(systemContent, /AKTIVNÍ PROJEKT:\n- Název: Senzorový audit/u);
        assert(body.options.num_predict >= 256);
        assert(Math.ceil(Buffer.byteLength(systemContent + emittedPrompt, 'utf8') / 2)
          + body.options.num_predict <= body.options.num_ctx,
        `the ${scenario.name} emitted prompt, including gateway clock context, must fit`);
      }
      const retryPrompt = requestBodies[1].messages.find(message => message.role === 'user')?.content || '';
      assert.equal(retryPrompt, providerPrompt,
        `${scenario.name} retry instruction must not displace the complete context`);
      assert.equal(requestBodies[1].options.num_predict, requestBodies[0].options.num_predict);
    }
  } finally {
    globalThis.fetch = previousFetch;
    clearNumCtxCache();
  }
});

await testAsync('decorative language separators yield to a long current request before capacity refusal', async () => {
  const previousFetch = globalThis.fetch;
  const requestBodies = [];
  const input = 'Porovnej hodnoty. ' + 'x'.repeat(3_900);
  try {
    clearNumCtxCache();
    setNumCtx(config.models.CHAT, 4_096);
    globalThis.fetch = async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({
        message: { content: 'Hodnoty lze porovnat až po dodání druhé konkrétní hodnoty; současný podklad obsahuje jen zástupný text a žádné dvě měřené veličiny.' },
        done_reason: 'stop', prompt_eval_count: 2_000, eval_count: 50,
      }) };
    };
    const decision = creDecisionEngine.overrideDecision({ type: 'ANSWER', intent: 'CONVERSATIONAL',
      tools: [], source: 'current_input_fitting_regression', reason: 'Controlled capacity fit', confidence: 1 });
    await handleAnswerDecision(input, decision, {
      sessionId: 'current-input-fitting', sessionState: new SessionState('current-input-fitting'), history: [],
    });
    assert.equal(requestBodies.length, 1);
    const body = requestBodies[0];
    const providerPrompt = body.messages.find(message => message.role === 'user')?.content || '';
    const systemContent = body.messages.find(message => message.role === 'system')?.content || '';
    assert.equal(providerPrompt, `User: ${input}`);
    assert.match(systemContent, /JAZYKOVÉ PRAVIDLO \(KRITICKÉ/u);
    assert.doesNotMatch(systemContent, /═{20}/u);
    assert(Math.ceil(Buffer.byteLength(systemContent + providerPrompt, 'utf8') / 2)
      + body.options.num_predict <= body.options.num_ctx);
  } finally {
    globalThis.fetch = previousFetch;
    clearNumCtxCache();
  }
});

await testAsync('explicit bare JSON request keeps complete context and returns only the final raw provider object', async () => {
  const previousFetch = globalThis.fetch;
  const requestBodies = [];
  const input = windowFillMessage(8);
  const summaryContent = '[Souhrn předchozí konverzace]\nARCHIVED_USER_FACT_731 '
    + 'podklad '.repeat(35) + ' KONEC_SOUHRNU';
  const history = [
    { isSummary: true, response: { tag: { speaker: 'system' }, content: summaryContent } },
    { response: { tag: { speaker: 'user' }, content: input } },
  ];
  const valid = '{"a":19,"b":8,"delta":11,"higher":"A"}';
  try {
    clearNumCtxCache();
    setNumCtx(config.models.CHAT, 4_096);
    globalThis.fetch = async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({
        message: { content: requestBodies.length === 1 ? `\`\`\`json\n${valid}\n\`\`\`` : valid },
        done_reason: 'stop', prompt_eval_count: 2_000, eval_count: 50,
      }) };
    };
    const decision = creDecisionEngine.overrideDecision({ type: 'ANSWER', intent: 'CONVERSATIONAL',
      tools: [], source: 'strict_json_regression', reason: 'Controlled bare JSON format', confidence: 1 });
    const result = await handleAnswerDecision(input, decision, {
      sessionId: 'strict-json-context', sessionState: new SessionState('strict-json-context'), history,
      hasActiveProject: true, project: { name: 'Senzorový audit' },
    });
    assert.equal(requestBodies.length, 2, 'fenced provider response must be retried');
    assert.equal(result.content, valid, 'return the final provider bytes without stripping a fence');
    assert.equal(result.tag.metadata.answerRetries, 1);
    for (const body of requestBodies) {
      assert.equal(body.format, 'json');
      const systemContent = body.messages.find(message => message.role === 'system')?.content || '';
      const providerPrompt = body.messages.find(message => message.role === 'user')?.content || '';
      assert.match(systemContent, /Citovaný web a historie jsou podklady/u);
      assert.match(systemContent, /AKTIVNÍ PROJEKT:\n- Název: Senzorový audit/u);
      assert.match(systemContent, /jediný JSON objekt/u);
      assert.doesNotMatch(systemContent, /Vysvětluj konkrétně: princip/u);
      assert.doesNotMatch(systemContent, /konkrétní příklad/u);
      assert(providerPrompt.includes(JSON.stringify({ role: 'summary', content: summaryContent })));
      assert(providerPrompt.includes(`User: ${input}`));
      assert(Math.ceil(Buffer.byteLength(systemContent + providerPrompt, 'utf8') / 2)
        + body.options.num_predict <= body.options.num_ctx);
    }
  } finally {
    globalThis.fetch = previousFetch;
    clearNumCtxCache();
  }
});

await testAsync('bare JSON answer fails with a typed terminal after bounded malformed provider output', async () => {
  const previousFetch = globalThis.fetch;
  const requestBodies = [];
  const input = 'Kalibrace A=73, B=62. Odpověz pouze jedním JSON objektem s klíči "a", "b", "delta", "higher".';
  try {
    clearNumCtxCache();
    setNumCtx(config.models.CHAT, 4_096);
    globalThis.fetch = async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({
        message: { content: requestBodies.length === 2 ? '[73,62,11]' : '```json\n{"a":73,"b":62,"delta":11,"higher":"A"}\n```' },
        done_reason: 'stop', prompt_eval_count: 200, eval_count: 50,
      }) };
    };
    const decision = creDecisionEngine.overrideDecision({ type: 'ANSWER', intent: 'CONVERSATIONAL',
      tools: [], source: 'strict_json_failure_regression', reason: 'Controlled malformed JSON envelope', confidence: 1 });
    await assert.rejects(() => handleAnswerDecision(input, decision, {
      sessionId: 'strict-json-failure', sessionState: new SessionState('strict-json-failure'), history: [],
    }), error => error instanceof ChatProcessingError
      && error.code === ChatTurnErrorCode.CHAT_PROCESSING_FAILED
      && error.sourceErrorType === 'ANSWER_JSON_FORMAT_INVALID');
    assert.equal(requestBodies.length, 3, 'fenced text and a valid JSON array must both fail within the bounded retry count');
    assert(requestBodies.every(body => body.format === 'json'));
  } finally {
    globalThis.fetch = previousFetch;
    clearNumCtxCache();
  }
});

await testAsync('quoted current and historical JSON instructions do not change a current prose answer', async () => {
  const previousFetch = globalThis.fetch;
  const requestBodies = [];
  const input = 'V citovaném textu stojí:\nOdpověz pouze jedním JSON objektem.\nVysvětli, co je JSON objekt v Pythonu.';
  const history = [{ response: { tag: { speaker: 'user' },
    content: 'Odpověz pouze jedním JSON objektem.' } }];
  const prose = 'JSON objekt je struktura klíčů a hodnot. V Pythonu ji lze načíst modulem json a poté přistupovat ke konkrétním položkám.';
  try {
    clearNumCtxCache();
    setNumCtx(config.models.CHAT, 4_096);
    globalThis.fetch = async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ message: { content: prose },
        done_reason: 'stop', prompt_eval_count: 200, eval_count: 50 }) };
    };
    const decision = creDecisionEngine.overrideDecision({ type: 'ANSWER', intent: 'CONVERSATIONAL',
      tools: [], source: 'strict_json_nontrigger', reason: 'Current prose request', confidence: 1 });
    const result = await handleAnswerDecision(input, decision, {
      sessionId: 'strict-json-nontrigger', sessionState: new SessionState('strict-json-nontrigger'), history,
    });
    assert.equal(result.content, prose);
    assert.equal(requestBodies.length, 1);
    assert.equal(requestBodies[0].format, undefined);
    assert.match(requestBodies[0].messages.find(message => message.role === 'system')?.content || '',
      /Vysvětluj konkrétně: princip/u);
  } finally {
    globalThis.fetch = previousFetch;
    clearNumCtxCache();
  }
});

await testAsync('an oversized current request returns a typed capacity terminal before provider', async () => {
  const previousFetch = globalThis.fetch;
  let providerCalls = 0;
  const input = 'Porovnej tyto hodnoty: ' + 'x'.repeat(20_000);
  try {
    clearNumCtxCache();
    setNumCtx(config.models.CHAT, 4_096);
    globalThis.fetch = async () => { providerCalls++; throw new Error('provider must not be called'); };
    const decision = creDecisionEngine.overrideDecision({ type: 'ANSWER', intent: 'CONVERSATIONAL',
      tools: [], source: 'current_input_capacity_regression', reason: 'Controlled capacity limit', confidence: 1 });
    await assert.rejects(() => handleAnswerDecision(input, decision, {
      sessionId: 'current-input-capacity', sessionState: new SessionState('current-input-capacity'), history: [],
    }), error => error instanceof ChatContextCapacityError
      && error.code === ChatTurnErrorCode.CHAT_CONTEXT_CAPACITY_EXCEEDED
      && error.statusCode === 413
      && error.sourceErrorType === 'ANSWER_CURRENT_USER_CONTEXT_TOO_LARGE');
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    clearNumCtxCache();
  }
});

await testAsync('oversized durable summary stops ANSWER before a provider request', async () => {
  const previousFetch = globalThis.fetch;
  const requestBodies = [];
  const input = 'Jaký auditní kód?';
  const history = [
    { isSummary: true, response: { tag: { speaker: 'system' },
      content: '[Souhrn předchozí konverzace]\nHEAD ' + 'x'.repeat(20_000) + ' MIDDLE_FACT_MUST_NOT_DISAPPEAR ' + 'y'.repeat(20_000) + ' TAIL' } },
    { response: { tag: { speaker: 'user' }, content: input } },
  ];
  try {
    clearNumCtxCache();
    setNumCtx(config.models.CHAT, 4_096);
    globalThis.fetch = async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      throw new Error('provider must not receive an incomplete summary');
    };
    const decision = creDecisionEngine.overrideDecision({ type: 'ANSWER', intent: 'CONVERSATIONAL',
      tools: [], source: 'summary_too_large_regression', reason: 'Controlled summary boundary', confidence: 1 });
    await assert.rejects(() => handleAnswerDecision(input, decision, {
      sessionId: 'summary-too-large-provider', sessionState: new SessionState('summary-too-large-provider'), history,
    }), error => error instanceof ChatContextCapacityError
      && error.code === ChatTurnErrorCode.CHAT_CONTEXT_CAPACITY_EXCEEDED
      && error.statusCode === 413
      && error.sourceErrorType === 'ANSWER_CONTEXT_SUMMARY_TOO_LARGE'
      && /Souhrn konverzace se nevejde/u.test(error.cause?.message));
    assert.equal(requestBodies.length, 0);
  } finally {
    globalThis.fetch = previousFetch;
    clearNumCtxCache();
  }
});

await testAsync('CODE retries keep their output budget and the complete fitting summary', async () => {
  const previousFetch = globalThis.fetch;
  const requestBodies = [];
  const input = 'A co list comprehension?';
  const summaryContent = '[Souhrn předchozí konverzace]\n'
    + 'Začátek projektu. ' + 'x'.repeat(300)
    + ' CODE_MIDDLE_FACT_417 ' + 'y'.repeat(300) + ' Konec souhrnu.';
  const history = [
    { isSummary: true, response: { tag: { speaker: 'system' }, content: summaryContent } },
    { response: { tag: { speaker: 'user' }, content: input } },
  ];
  try {
    clearNumCtxCache();
    setNumCtx(config.models.CHAT, 4_096);
    globalThis.fetch = async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({
        message: { content: requestBodies.length === 1 ? 'Nedokončená ukázka'
          : 'List comprehension vytvoří seznam: `squares = [x * x for x in range(5)]`. Výsledek je `[0, 1, 4, 9, 16]`. Volitelný filtr je `[x for x in range(5) if x % 2 == 0]`.' },
        done_reason: requestBodies.length === 1 ? 'length' : 'stop',
        prompt_eval_count: 200, eval_count: 50,
      }) };
    };
    const decision = creDecisionEngine.overrideDecision({ type: 'ANSWER', intent: 'CODE',
      tools: [], source: 'summary_code_regression', reason: 'Controlled CODE retry', confidence: 1 });
    const result = await handleAnswerDecision(input, decision, {
      sessionId: 'summary-code-retry', sessionState: new SessionState('summary-code-retry'), history,
    });
    assert.equal(requestBodies.length, 2);
    for (const body of requestBodies) {
      assert.equal(body.options.num_ctx, 4_096);
      assert.equal(body.options.num_predict, 1_200);
      assert.doesNotMatch(body.messages.find(message => message.role === 'system')?.content || '',
        /Naplánuj úplnou odpověď přibližně do/u);
      assert(body.messages.find(message => message.role === 'user')?.content
        .includes(JSON.stringify({ role: 'summary', content: summaryContent })));
    }
    assert.equal(result.tag.metadata.answerRetries, 1);
    assert.equal(result.tag.metadata.finishReason, 'stop');
  } finally {
    globalThis.fetch = previousFetch;
    clearNumCtxCache();
  }
});

test('a verbose answer cannot evict earlier user facts from a three-turn conversation', () => {
  const systemPrompt = 'Systémová instrukce. '.repeat(145);
  const history = [
    { userInput: 'Skupina A má 3 z 10; skupina B má 90 ze 100.' },
    { response: { content: 'Dlouhá odpověď. '.repeat(120), tag: { speaker: 'system' } } },
    { userInput: 'Oprava: skupina A má 4 z 10, skupina B zůstává 90 ze 100.' },
    { response: { content: 'Další dlouhá odpověď. '.repeat(120), tag: { speaker: 'system' } } },
  ];
  const result = buildAnswerContext('Napiš opravený vážený průměr.', history, systemPrompt, 2048, 4096);
  assert.match(result.prompt, /Skupina A má 3 z 10; skupina B má 90 ze 100/);
  assert.match(result.prompt, /Oprava: skupina A má 4 z 10, skupina B zůstává 90 ze 100/);
  assert(result.prompt.indexOf('Skupina A má 3 z 10') < result.prompt.indexOf('Oprava: skupina A'));
  assert(result.maxTokens < 2048);
  assert(result.maxTokens >= 384);
  assert(Buffer.byteLength(result.prompt + systemPrompt) / 2 + result.maxTokens + 384 <= 4096);
});

test('the latest user turn is protected through 512 serialized bytes, with longer history still bounded', () => {
  const serializedBytes = content => Buffer.byteLength(JSON.stringify({ role: 'user', content }), 'utf8') + 1;
  const protectedContent = 'x'.repeat(512 - serializedBytes(''));
  const longerContent = protectedContent + 'x';
  assert.equal(serializedBytes(protectedContent), 512);
  assert.equal(serializedBytes(longerContent), 513);
  const history = content => [{ response: { tag: { speaker: 'user' }, content } }];
  const systemPrompt = 'I'.repeat(5_200);
  const protectedResult = buildAnswerContext('dotaz', history(protectedContent), systemPrompt,
    2_048, 4_096, { allowSummaryOutputTradeoff: true });
  assert(protectedResult.prompt.includes(JSON.stringify({ role: 'user', content: protectedContent })));
  const longerResult = buildAnswerContext('dotaz', history(longerContent), systemPrompt,
    2_048, 4_096, { allowSummaryOutputTradeoff: true });
  assert(!longerResult.prompt.includes(JSON.stringify({ role: 'user', content: longerContent })));
  assert.match(longerResult.prompt, /část historie vynechána/u);
  assert(protectedResult.maxTokens < longerResult.maxTokens);
});

await testAsync('final ANSWER provider request retains a concise correction after the durable summary', async () => {
  const previousFetch = globalThis.fetch;
  const requestBodies = [];
  const input = 'Podklad ' + 'x'.repeat(2_200)
    + ' Jaká je podle mé poslední opravy hodnota skupiny A?';
  const summaryContent = '[Souhrn předchozí konverzace]\nPůvodní hodnota skupiny A byla 3 z 10. '
    + 'x'.repeat(850) + ' Konec původního souhrnu.';
  const correction = 'Oprava předchozí hodnoty: skupina A má 4 z 10, skupina B zůstává 90 ze 100.';
  const history = [
    { isSummary: true, response: { tag: { speaker: 'system' }, content: summaryContent } },
    { response: { tag: { speaker: 'user' }, content: correction } },
    { response: { tag: { speaker: 'system' }, content: 'Rozumím opravě; použiji čtyři z deseti.' } },
    { response: { tag: { speaker: 'user' }, content: input } },
  ];
  try {
    clearNumCtxCache();
    setNumCtx(config.models.CHAT, 4_096);
    globalThis.fetch = async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({
        message: { content: 'Podle poslední opravy je hodnota skupiny A 4 z 10. Tato oprava má přednost před starším údajem v souhrnu.' },
        done_reason: 'stop', prompt_eval_count: 200, eval_count: 50,
      }) };
    };
    const decision = creDecisionEngine.overrideDecision({ type: 'ANSWER', intent: 'CONVERSATIONAL',
      tools: [], source: 'recent_user_correction_regression', reason: 'Controlled recent correction', confidence: 1 });
    const result = await handleAnswerDecision(input, decision, {
      sessionId: 'recent-user-correction', sessionState: new SessionState('recent-user-correction'), history,
    });
    assert.equal(requestBodies.length, 1);
    const body = requestBodies[0];
    const providerPrompt = body.messages.find(message => message.role === 'user')?.content || '';
    const wholeSummary = JSON.stringify({ role: 'summary', content: summaryContent });
    const wholeCorrection = JSON.stringify({ role: 'user', content: correction });
    assert(providerPrompt.includes(wholeSummary));
    assert(providerPrompt.includes(wholeCorrection), 'the corrected value must reach the final model request');
    assert(providerPrompt.indexOf(wholeSummary) < providerPrompt.indexOf(wholeCorrection));
    assert(providerPrompt.endsWith(`User: ${input}`));
    assert(body.options.num_predict >= 256 && body.options.num_predict < 512);
    const systemContent = body.messages.find(message => message.role === 'system')?.content || '';
    const wordTarget = Number(systemContent.match(/Naplánuj úplnou odpověď přibližně do (\d+) slov/u)?.[1]);
    assert.equal(wordTarget, Math.max(20, Math.floor(body.options.num_predict / 5)));
    assert.equal(result.tag.metadata.answerBudget.maxTokens, body.options.num_predict);
  } finally {
    globalThis.fetch = previousFetch;
    clearNumCtxCache();
  }
});

await testAsync('a concise correction that cannot fit beside the full summary fails before provider', async () => {
  const previousFetch = globalThis.fetch;
  const requestBodies = [];
  const input = 'Podklad ' + 'x'.repeat(2_441)
    + ' Jaká je podle mé poslední opravy hodnota skupiny A?';
  const summaryContent = '[Souhrn předchozí konverzace]\nPůvodní hodnota skupiny A byla 3 z 10. '
    + 'x'.repeat(1_350) + ' Konec původního souhrnu.';
  const correction = 'Oprava předchozí hodnoty: skupina A má 4 z 10, skupina B zůstává 90 ze 100. '
    + 'x'.repeat(300);
  const history = [
    { isSummary: true, response: { tag: { speaker: 'system' }, content: summaryContent } },
    { response: { tag: { speaker: 'user' }, content: correction } },
    { response: { tag: { speaker: 'system' }, content: 'Rozumím opravě; použiji čtyři z deseti.' } },
    { response: { tag: { speaker: 'user' }, content: input } },
  ];
  try {
    clearNumCtxCache();
    setNumCtx(config.models.CHAT, 4_096);
    globalThis.fetch = async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      throw new Error('provider must not receive a prompt missing the correction');
    };
    const decision = creDecisionEngine.overrideDecision({ type: 'ANSWER', intent: 'CONVERSATIONAL',
      tools: [], source: 'recent_user_boundary_regression', reason: 'Controlled correction limit', confidence: 1 });
    await assert.rejects(() => handleAnswerDecision(input, decision, {
      sessionId: 'recent-user-boundary', sessionState: new SessionState('recent-user-boundary'), history,
    }), error => error instanceof ChatContextCapacityError
      && error.code === ChatTurnErrorCode.CHAT_CONTEXT_CAPACITY_EXCEEDED
      && error.statusCode === 413
      && error.sourceErrorType === 'ANSWER_RECENT_USER_CONTEXT_TOO_LARGE');
    assert.equal(requestBodies.length, 0);
  } finally {
    globalThis.fetch = previousFetch;
    clearNumCtxCache();
  }
});

await testAsync('actual ANSWER continuation bypasses ambiguous classification and retains context and cancellation', async () => {
  const previousCall = llmGateway.call; const previousDecide = creDecisionEngine.decide;
  const calls = []; const abort = new AbortController();
  const response = 'Kontejner sdílí jádro hostitele. Kubernetes používá řídicí smyčku: porovnává požadovaný stav se skutečným a vytváří chybějící pody. Například Deployment se třemi replikami nahradí pod, který skončil. Dostupnost však závisí na kapacitě uzlů a správném nastavení aplikace.';
  try {
    llmGateway.call = async (prompt, options) => { calls.push({prompt,options}); return {content:response,model:'controlled-chat',finishReason:'stop'}; };
    creDecisionEngine.decide = async () => { throw new Error('Expansion must not be reclassified as an ambiguous new task'); };
    const state = new SessionState('detail-regression');
    state.recordDecision({type:'ANSWER',intent:'CONVERSATIONAL',tools:[]}, 'co je docker?');
    const history = [{response:{content:'Docker: '+ 'vysvětlení '.repeat(30)+'Kubernetes používá Deployment.',tag:{speaker:'system'}}}];
    const result = await conversationHandler('vic detailu', {sessionId:'detail-regression', sessionState:state, history, signal:abort.signal});
    assert.equal(calls.length,1);
    assert.equal(result.content,response);
    assert.match(calls[0].prompt,/Deployment/);
    assert.doesNotMatch(calls[0].options.systemPrompt,/45 slov|2–3 vět/);
    assert(calls[0].options._authToken.maxTokens >= 1024 && calls[0].options._authToken.maxTokens <= 2048);
    assert.match(calls[0].options.systemPrompt, /Backend host \(observed now\)/);
    assert.match(calls[0].options.systemPrompt, /Host OS is not project target/);
    assert.equal(calls[0].options.signal,abort.signal);
    assert.equal(result.tag.metadata.decision.metadata.overrideSource,'answer_expansion');
    assert.equal(result.tag.canExecute,false);
    assert.equal(state.awaitingClarification,false);
  } finally {llmGateway.call=previousCall;creDecisionEngine.decide=previousDecide;}
});

await testAsync('truncated conversational and CODE answers retry within authority and fail closed after exhaustion', async () => {
  const previousCall = llmGateway.call;
  const complete = 'Kontejner sdílí jádro hostitele. Kubernetes používá řídicí smyčku: porovnává požadovaný stav se skutečným a vytváří chybějící pody. Například Deployment se třemi replikami nahradí pod, který skončil. Dostupnost však závisí na kapacitě uzlů a správném nastavení aplikace.';
  const completeCode = 'List comprehension vytvoří nový seznam z iterovatelného zdroje. Například `squares = [number * number for number in range(5)]` vrátí `[0, 1, 4, 9, 16]`. Volitelný filtr se píše za cyklus: `[number for number in range(5) if number % 2 == 0]` vrátí `[0, 2, 4]`.';
  try {
    for (const intent of ['CONVERSATIONAL', 'CODE']) for (const recover of [true, false]) {
      const calls = []; const abort = new AbortController();
      const expectedContent = intent === 'CODE' ? completeCode : complete;
      llmGateway.call = async (prompt, options) => {
        calls.push({ prompt, options });
        return { content: recover && calls.length > 1 ? expectedContent : 'Nedokončené vysvětlení, které',
          model: 'controlled-chat', finishReason: recover && calls.length > 1 ? 'stop' : 'length' };
      };
      const decision = creDecisionEngine.overrideDecision({ type: 'ANSWER', intent,
        tools: [], source: 'completion_regression', reason: 'Controlled incomplete generation', confidence: 1 });
      const result = await handleAnswerDecision(intent === 'CODE' ? 'A co list comprehension?' : 'co je docker?', decision,
        { sessionId: 'completion-regression', sessionState: new SessionState('completion-regression'), history: [], signal: abort.signal });
      assert.equal(calls.length, recover ? 2 : 3);
      assert(calls.every(call => call.options._authToken.maxTokens === 1200 && call.options.signal === abort.signal));
      assert.match(calls[1].prompt, /technický limit/);
      assert.equal(result.tag.metadata.answerRetries, recover ? 1 : 2);
      if (recover) { assert.equal(result.content, expectedContent); assert.equal(result.tag.metadata.finishReason, 'stop'); }
      else {
        let writes = 0;
        await assert.rejects(() => finalize({ result, persistAssistantTurn: async () => { writes++; } }),
          error => error.code === 'MODEL_RESPONSE_TRUNCATED');
        assert.equal(writes, 0);
      }
    }
  } finally { llmGateway.call = previousCall; }
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

await testAsync('token-limited model output is terminal before scoring, persistence and success', async () => {
  let scored = 0;
  let persisted = 0;
  const truncated = Object.freeze({
    ...makeResult('This answer ends halfway'),
    tag: Object.freeze({
      metadata: Object.freeze({
        model: 'fixture-model',
        finishReason: 'length',
        decision: Object.freeze({ intent: 'CONVERSATIONAL' }),
      }),
    }),
  });
  await assert.rejects(
    finalize({
      result: truncated,
      scoreResponse: async () => {
        scored += 1;
        return { total: 100, dimensions: {}, issues: [] };
      },
      persistAssistantTurn: () => { persisted += 1; },
    }),
    error => {
      assert.equal(error instanceof ModelResponseTruncatedError, true);
      assert.equal(error.code, ChatTurnErrorCode.MODEL_RESPONSE_TRUNCATED);
      assert.equal(error.statusCode, 502);
      assert.equal(error.recoverable, true);
      return true;
    },
  );
  assert.equal(scored, 0);
  assert.equal(persisted, 0);
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

await testAsync('handler truncation cannot cross the controller persistence boundary', async () => {
  resetConversationStore();
  const store = getConversationStore(null);
  const conversationId = 'm1-truncated-handler';
  ChatController.configure({
    handlers: {
      [ChatMode.CONVERSATION]: async () => new TaggedResponse({
        content: 'This answer ends halfway',
        tag: new ResponseTag({
          speaker: ResponseSpeaker.SYSTEM,
          mode: ChatMode.CONVERSATION,
          confidence: 0.9,
          metadata: {
            model: 'fixture-model',
            finishReason: 'length',
            decision: { intent: 'CONVERSATIONAL' },
          },
        }),
      }),
    },
    config: { autoModeDetection: false },
  });
  try {
    await assert.rejects(
      ChatController.handle({
        message: 'return a complete answer',
        sessionId: conversationId,
        conversationId,
      }),
      error => error instanceof ModelResponseTruncatedError
        && error.code === ChatTurnErrorCode.MODEL_RESPONSE_TRUNCATED,
    );
    assert.deepEqual(store.getAllTurns(conversationId).map(turn => turn.role), ['user']);
  } finally {
    ChatController.removeSession(conversationId);
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
      m2LifecycleOnly: true,
      projectId: null,
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
      error: new ModelResponseTruncatedError(),
      statusCode: 502,
      code: 'MODEL_RESPONSE_TRUNCATED',
    },
    {
      error: new ChatContextCapacityError('ANSWER_CONTEXT_SUMMARY_TOO_LARGE', new Error('private summary detail')),
      statusCode: 413,
      code: 'CHAT_CONTEXT_CAPACITY_EXCEEDED',
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
