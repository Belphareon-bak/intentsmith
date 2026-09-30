#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  assertEqual,
  suite,
  summary,
  test,
  testAsync,
} from './harness.js';
import { awaitPendingCompaction, ensureCompactionBeforeNextTurn, getCompactionBudget, maybeCompact } from '../src/chat/context-compact.js';
import { ConversationStore, TurnRole } from '../src/chat/conversation-store.js';
import { config } from '../src/config.js';
import { logger } from '../src/core/logger.js';
import {
  clearNumCtxCache,
  setNumCtx,
} from '../src/llm/model-ctx.js';

suite('Context compaction uses effective model context');

await testAsync('registered num_ctx controls the compaction threshold', async () => {
  const model = config.compact.summaryModel || config.models.CHAT;
  let getAllTurnsCalls = 0;
  const store = {
    getEffectiveHistoryTokens: () => 0,
    getAllTurns: () => {
      getAllTurnsCalls += 1;
      return [];
    },
  };

  clearNumCtxCache();
  maybeCompact('ctx-default-window', store, 'gate0-test');
  await new Promise(resolve => setImmediate(resolve));
  assertEqual(getAllTurnsCalls, 0, 'default context must stay below threshold');

  setNumCtx(model, 1024);
  maybeCompact('ctx-effective-window', store, 'gate0-test');
  await new Promise(resolve => setImmediate(resolve));
  assertEqual(getAllTurnsCalls, 1, 'effective context must trigger compaction');

  clearNumCtxCache();
});

await testAsync('one context snapshot controls source budget, provider wire, and post-fill evidence', async () => {
  const model = config.compact.summaryModel || config.models.CHAT;
  const originalSummaryModel = config.compact.summaryModel;
  const originalFetch = globalThis.fetch;
  const originalInfo = logger.info;
  const originalWarn = logger.warn;
  const requestBodies = [];
  const infoEvents = [];
  const warnEvents = [];
  let tokenRead = 0;
  let storedSummary = null;
  const tokenValues = [0, 0, 100];
  const turns = Array.from({ length: config.compact.keepTurns + 2 }, (_, index) => ({
    id: index + 1,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `turn-${index}-${'x'.repeat(800)}`,
  }));
  const store = {
    getEffectiveHistoryTokens: () => tokenValues[Math.min(tokenRead++, tokenValues.length - 1)],
    getAllTurns: () => {
      config.compact.summaryModel = 'race-after-budget:1b';
      return turns;
    },
    getSummary: () => null,
    setSummary: (_conversationId, summaryText, upToMsgId) => {
      storedSummary = { summaryText, upToMsgId };
    },
  };

  globalThis.fetch = async (_url, options = {}) => {
    requestBodies.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({
        message: { content: 'bounded summary' },
        prompt_eval_count: 10,
        eval_count: 3,
        done_reason: 'stop',
      }),
    };
  };
  logger.info = (component, message, data) => infoEvents.push({ component, message, data });
  logger.warn = (component, message, data) => warnEvents.push({ component, message, data });

  try {
    clearNumCtxCache();
    setNumCtx(model, 1024);
    maybeCompact('ctx-one-budget-snapshot', store, 'profile-test');
    for (let attempt = 0; attempt < 10 && !storedSummary; attempt += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }

    assertEqual(requestBodies.length, 1);
    assertEqual(requestBodies[0].model, model);
    assertEqual(requestBodies[0].options.num_ctx, 1024);
    assertEqual(requestBodies[0].options.num_predict, 256);
    assertEqual(requestBodies[0].messages[0].content.includes('turn-0-'), true);
    assertEqual(getCompactionBudget(model).safetyMaxChars, Math.floor(1024 * 0.6) * 4);
    assertEqual(warnEvents.length, 0);
    const complete = infoEvents.find(event => event.message === 'Compaction complete');
    assertEqual(complete?.data?.newFillPercent, Math.round(((100 + 1500) / 1024) * 100));
    assertEqual(storedSummary?.summaryText, 'bounded summary');
    assertEqual(storedSummary?.upToMsgId, 2);
  } finally {
    globalThis.fetch = originalFetch;
    logger.info = originalInfo;
    logger.warn = originalWarn;
    config.compact.summaryModel = originalSummaryModel;
    clearNumCtxCache();
  }
});

test('effective history excludes archived turns and includes the emitted summary', () => {
  const store = new ConversationStore(null);
  const id = 'effective-history';
  for (let index = 0; index < 12; index += 1) {
    store.appendTurn(id, index % 2 ? TurnRole.ASSISTANT : TurnRole.USER, 'x'.repeat(800));
  }

  const rawTokens = store.getEstimatedTokens(id);
  const before = store.getEffectiveHistoryTokens(id);
  assertEqual(rawTokens, 12 * 200);
  assertEqual(before, 10 * 200);

  store.setSummary(id, 'Krátký souhrn.', 6);
  const expectedAfter = Math.ceil('[Souhrn předchozí konverzace]\nKrátký souhrn.'.length / 4) + 6 * 200;
  assertEqual(store.getEffectiveHistoryTokens(id), expectedAfter);
  assertEqual(store.getEstimatedTokens(id), rawTokens, 'archived turns must remain durable');
  assertEqual(store.getEffectiveHistoryTokens(id), store.buildHandlerHistory(id)
    .reduce((sum, turn) => sum + Math.ceil(turn.response.content.length / 4), 0));
});

await testAsync('durable unsummarized count ignores archived and other conversation turns', async () => {
  const Database = (await import('better-sqlite3')).default;
  const raw = new Database(':memory:');
  try {
    raw.exec(`
      CREATE TABLE conversations (id TEXT PRIMARY KEY, summary TEXT, summary_up_to_msg_id INTEGER);
      CREATE TABLE messages (id INTEGER PRIMARY KEY, conversation_id TEXT, content TEXT);
      INSERT INTO conversations (id) VALUES ('target'), ('other');
      INSERT INTO messages (id, conversation_id, content) VALUES
        (1, 'target', 'first'), (2, 'target', 'second'),
        (3, 'other', 'foreign'), (4, 'target', 'third'), (5, 'target', 'fourth');
    `);
    const store = new ConversationStore({ db: raw });
    assertEqual(store.getUnsummarizedTurnCount('target'), 4);
    raw.prepare('UPDATE conversations SET summary = ?, summary_up_to_msg_id = ? WHERE id = ?')
      .run('First two saved.', 2, 'target');
    assertEqual(store.getUnsummarizedTurnCount('target'), 2);
    assertEqual(store.getUnsummarizedTurnCount('other'), 1);
  } finally {
    raw.close();
  }
});

await testAsync('completion reports real savings and archived turns do not re-trigger', async () => {
  const model = config.compact.summaryModel || config.models.CHAT;
  const originalFetch = globalThis.fetch;
  const originalInfo = logger.info;
  const originalThreshold = config.compact.threshold;
  const originalKeepTurns = config.compact.keepTurns;
  const infoEvents = [];
  const requests = [];
  const store = new ConversationStore(null);
  const id = 'effective-compact-regression';

  for (let index = 0; index < 12; index += 1) {
    store.appendTurn(id, index % 2 ? TurnRole.ASSISTANT : TurnRole.USER, 'x'.repeat(800));
  }

  globalThis.fetch = async (_url, options = {}) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({ message: { content: 'Krátký souhrn.' }, prompt_eval_count: 10, eval_count: 3, done_reason: 'stop' }),
    };
  };
  logger.info = (component, message, data) => infoEvents.push({ component, message, data });

  try {
    config.compact.threshold = 0.75;
    config.compact.keepTurns = 6;
    clearNumCtxCache();
    setNumCtx(model, 4096);

    maybeCompact(id, store, 'profile-test');
    for (let attempt = 0; attempt < 10 && !infoEvents.some(event => event.message === 'Compaction complete'); attempt += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }

    const complete = infoEvents.find(event => event.message === 'Compaction complete');
    assertEqual(requests.length, 1);
    assertEqual(complete?.data?.tokensBefore, 2000);
    assertEqual(complete?.data?.tokensAfter, store.getEffectiveHistoryTokens(id));
    assertEqual(complete?.data?.savedTokens, complete.data.tokensBefore - complete.data.tokensAfter);
    assertEqual(complete.data.savedTokens > 0, true);
    assertEqual(complete.data.newFillPercent, Math.round(((complete.data.tokensAfter + 1500) / 4096) * 100));
    assertEqual(complete.data.newFillPercent < 75, true);

    // A second conversation with the same archived turns has no cooldown state.
    // Its stored summary must keep the trigger below threshold on its own.
    const archivedId = 'effective-compact-already-summarized';
    let archivedUpToId;
    for (let index = 0; index < 12; index += 1) {
      const turn = store.appendTurn(archivedId, index % 2 ? TurnRole.ASSISTANT : TurnRole.USER, 'x'.repeat(800));
      if (index === 5) archivedUpToId = turn.id;
    }
    store.setSummary(archivedId, 'Krátký souhrn.', archivedUpToId);
    maybeCompact(archivedId, store, 'profile-test');
    await new Promise(resolve => setImmediate(resolve));
    assertEqual(requests.length, 1, 'archived raw tokens must not trigger another LLM call');
  } finally {
    globalThis.fetch = originalFetch;
    logger.info = originalInfo;
    config.compact.threshold = originalThreshold;
    config.compact.keepTurns = originalKeepTurns;
    clearNumCtxCache();
  }
});

await testAsync('short turns compact before the handler evicts an unsummarized turn', async () => {
  const model = config.compact.summaryModel || config.models.CHAT;
  const originalFetch = globalThis.fetch;
  const originalThreshold = config.compact.threshold;
  const originalKeepTurns = config.compact.keepTurns;
  const store = new ConversationStore(null);
  const id = 'short-turn-retention';
  const requests = [];

  globalThis.fetch = async (_url, options = {}) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({
        message: { content: 'Stored first anchor ORION.' },
        prompt_eval_count: 10,
        eval_count: 4,
        done_reason: 'stop',
      }),
    };
  };

  const appendExchange = (index, trigger = true) => {
    store.appendTurn(id, TurnRole.USER, index === 1 ? 'First raw anchor ORION.' : `Short question ${index}`);
    store.appendTurn(id, TurnRole.ASSISTANT, `Short answer ${index}`);
    if (trigger) maybeCompact(id, store, 'retention-test');
  };
  const waitForSummary = async upToMsgId => {
    for (let attempt = 0; attempt < 20 && store.getSummary(id)?.upToMsgId !== upToMsgId; attempt += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assertEqual(store.getSummary(id)?.upToMsgId, upToMsgId);
  };

  try {
    config.compact.threshold = 0.75;
    config.compact.keepTurns = 6;
    clearNumCtxCache();
    setNumCtx(model, 4096);

    for (let index = 1; index <= 4; index += 1) appendExchange(index);
    assertEqual(store.getUnsummarizedTurnCount(id), 8);
    assertEqual(requests.length, 0, 'eight short turns should stay verbatim');
    assertEqual(store.getEffectiveHistoryTokens(id) + 1500 < Math.floor(4096 * 0.75), true);

    appendExchange(5, false);
    assertEqual(store.getUnsummarizedTurnCount(id), 10);
    assertEqual(store.getEffectiveHistoryTokens(id) + 1500 < Math.floor(4096 * 0.75), true);
    maybeCompact(id, store, 'retention-test');
    await waitForSummary(4);
    assertEqual(requests.length, 1, 'the tenth short turn must trigger a summary below 75%');
    assertEqual(requests[0].messages[0].content.includes('First raw anchor ORION.'), true);
    assertEqual(store.getUnsummarizedTurnCount(id), 6);
    assertEqual(store.buildHandlerHistory(id)[0].response.content.includes('Stored first anchor ORION.'), true);

    appendExchange(6);
    assertEqual(requests.length, 1, 'eight new turns still fit beside the summary');
    appendExchange(7);
    await waitForSummary(8);
    assertEqual(requests.length, 2, 'retention must bypass the token cooldown before old turns fall out');
    assertEqual(requests[1].messages[0].content.includes('[Předchozí souhrn]'), true);
    assertEqual(requests[1].messages[0].content.includes('Short question 3'), true);
    assertEqual(store.getUnsummarizedTurnCount(id), 6);
    assertEqual(store.buildHandlerHistory(id)[0].response.content.includes('Stored first anchor ORION.'), true);
  } finally {
    globalThis.fetch = originalFetch;
    config.compact.threshold = originalThreshold;
    config.compact.keepTurns = originalKeepTurns;
    clearNumCtxCache();
  }
});

await testAsync('pending summary blocks the next snapshot, respects cancellation, and keepTurns 10 still retains the first fact', async () => {
  const model = config.compact.summaryModel || config.models.CHAT;
  const previousFetch = globalThis.fetch;
  const previousKeepTurns = config.compact.keepTurns;
  const previousThreshold = config.compact.threshold;
  const store = new ConversationStore(null);
  const id = 'pending-summary-retention';
  const requests = [];
  let release;
  const provider = new Promise(resolve => { release = resolve; });
  for (let index = 0; index < 10; index += 1) {
    store.appendTurn(id, index % 2 ? TurnRole.ASSISTANT : TurnRole.USER,
      index === 0 ? 'Initial durable fact VEGA_431.' : `Short turn ${index}`);
  }
  globalThis.fetch = async (_url, options = {}) => {
    requests.push(JSON.parse(options.body));
    await provider;
    return { ok: true, json: async () => ({
      message: { content: 'Initial durable fact VEGA_431.' }, done_reason: 'stop',
      prompt_eval_count: 40, eval_count: 20,
    }) };
  };
  try {
    config.compact.keepTurns = 10;
    config.compact.threshold = 0.75;
    clearNumCtxCache(); setNumCtx(model, 4096);
    maybeCompact(id, store, 'pending-test');
    const abort = new AbortController();
    const cancelledWait = ensureCompactionBeforeNextTurn(id, store, 'pending-test', abort.signal);
    let completed = false;
    const waiting = ensureCompactionBeforeNextTurn(id, store, 'pending-test').then(() => { completed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assertEqual(completed, false, 'the next turn must not snapshot uncompressed history while the model is pending');
    abort.abort();
    await assert.rejects(cancelledWait, error => error.name === 'AbortError');
    assertEqual(completed, false, 'aborting one request must not cancel the shared summary');
    release();
    await waiting;
    assertEqual(requests.length, 1);
    assertEqual(requests[0].options.num_predict, 1000);
    assertEqual(requests[0].messages[0].content.includes('Initial durable fact VEGA_431.'), true);
    assertEqual(store.getSummary(id)?.upToMsgId, 2);
    assertEqual(store.getUnsummarizedTurnCount(id), 8);
    const history = store.buildHandlerHistory(id);
    assertEqual(history[0].isSummary, true);
    assertEqual(history[0].response.content.includes('VEGA_431'), true);
    assertEqual(history.length, 9);
    store.appendTurn(id, TurnRole.USER, 'Next question after the pending summary.');
    const nextHistory = store.buildHandlerHistory(id);
    assertEqual(nextHistory.length, 10);
    assertEqual(nextHistory[0].isSummary, true);
    assertEqual(nextHistory[1].response.content, 'Short turn 2');
    assertEqual(nextHistory.at(-1).response.content, 'Next question after the pending summary.');
  } finally {
    release();
    globalThis.fetch = previousFetch;
    config.compact.keepTurns = previousKeepTurns;
    config.compact.threshold = previousThreshold;
    clearNumCtxCache();
  }
});

await testAsync('a token-pressure summary is followed by one fresh compaction when an exchange leaves ten raw turns', async () => {
  const model = config.compact.summaryModel || config.models.CHAT;
  const previousFetch = globalThis.fetch;
  const previousKeepTurns = config.compact.keepTurns;
  const previousThreshold = config.compact.threshold;
  const store = new ConversationStore(null);
  const id = 'token-pressure-followed-by-retention';
  const requests = [];
  let releaseFirst;
  const firstResponse = new Promise(resolve => { releaseFirst = resolve; });
  for (let index = 0; index < 9; index += 1) {
    store.appendTurn(id, index % 2 ? TurnRole.USER : TurnRole.ASSISTANT,
      index === 0 ? 'Old fact ALTAIR_769.' : `Short turn ${index}`);
  }
  globalThis.fetch = async (_url, options = {}) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) await firstResponse;
    return { ok: true, json: async () => ({ message: { content: 'Old fact ALTAIR_769.' },
      done_reason: 'stop', prompt_eval_count: 40, eval_count: 20 }) };
  };
  try {
    config.compact.keepTurns = 10;
    config.compact.threshold = 0.1;
    clearNumCtxCache(); setNumCtx(model, 4096);
    maybeCompact(id, store, 'token-pressure-race');
    for (let attempt = 0; attempt < 10 && requests.length === 0; attempt += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assertEqual(requests.length, 1, 'nine raw turns should start a token-pressure summary');
    store.appendTurn(id, TurnRole.USER, 'Question while summary runs');
    store.appendTurn(id, TurnRole.ASSISTANT, 'Answer while summary runs');
    assertEqual(store.getUnsummarizedTurnCount(id), 11);
    const waiting = ensureCompactionBeforeNextTurn(id, store, 'token-pressure-race');
    releaseFirst();
    await waiting;
    assertEqual(requests.length, 2, 'the new range needs a second bounded compaction');
    assertEqual(requests[0].messages[0].content.includes('Old fact ALTAIR_769.'), true);
    assertEqual(requests[1].messages[0].content.includes('[Předchozí souhrn]'), true);
    assertEqual(requests[1].messages[0].content.includes('Short turn 1'), true);
    assertEqual(store.getUnsummarizedTurnCount(id), 8);
    assertEqual(store.buildHandlerHistory(id)[0].response.content.includes('ALTAIR_769'), true);
  } finally {
    releaseFirst();
    globalThis.fetch = previousFetch;
    config.compact.keepTurns = previousKeepTurns;
    config.compact.threshold = previousThreshold;
    clearNumCtxCache();
  }
});

await testAsync('failed fresh compaction keeps the first completed summary and blocks the lossy turn', async () => {
  const model = config.compact.summaryModel || config.models.CHAT;
  const previousFetch = globalThis.fetch;
  const previousKeepTurns = config.compact.keepTurns;
  const previousThreshold = config.compact.threshold;
  const store = new ConversationStore(null);
  const id = 'failed-fresh-compaction';
  let calls = 0;
  for (let index = 0; index < 9; index += 1) {
    store.appendTurn(id, index % 2 ? TurnRole.USER : TurnRole.ASSISTANT,
      index === 0 ? 'Old fact VEGA_904.' : `Short turn ${index}`);
  }
  globalThis.fetch = async () => {
    calls += 1;
    const doneReason = calls === 1 ? 'stop' : 'length';
    return { ok: true, json: async () => ({ message: { content: 'Old fact VEGA_904.' },
      done_reason: doneReason, prompt_eval_count: 40, eval_count: 20 }) };
  };
  try {
    config.compact.keepTurns = 10;
    config.compact.threshold = 0.1;
    clearNumCtxCache(); setNumCtx(model, 4096);
    maybeCompact(id, store, 'failed-fresh-test');
    await awaitPendingCompaction(id);
    assertEqual(store.getSummary(id)?.upToMsgId, 1);
    store.appendTurn(id, TurnRole.USER, 'Question after the first summary');
    store.appendTurn(id, TurnRole.ASSISTANT, 'Answer after the first summary');
    assertEqual(store.getUnsummarizedTurnCount(id), 10);
    await assert.rejects(ensureCompactionBeforeNextTurn(id, store, 'failed-fresh-test'),
      /CONTEXT_SUMMARY_INCOMPLETE:length/);
    assertEqual(calls, 3, 'the fresh summary has one bounded retry');
    assertEqual(store.getSummary(id)?.upToMsgId, 1, 'incomplete output must not advance the summary cursor');
    assertEqual(store.getUnsummarizedTurnCount(id), 10, 'raw turns remain durable for later retry');
  } finally {
    globalThis.fetch = previousFetch;
    config.compact.keepTurns = previousKeepTurns;
    config.compact.threshold = previousThreshold;
    clearNumCtxCache();
  }
});

await testAsync('two truncated summaries never replace raw history and the next turn fails closed', async () => {
  const model = config.compact.summaryModel || config.models.CHAT;
  const previousFetch = globalThis.fetch;
  const previousKeepTurns = config.compact.keepTurns;
  const previousThreshold = config.compact.threshold;
  const store = new ConversationStore(null);
  const id = 'truncated-summary-retention';
  const requests = [];
  for (let index = 0; index < 10; index += 1) {
    store.appendTurn(id, index % 2 ? TurnRole.ASSISTANT : TurnRole.USER,
      index === 0 ? 'Initial durable fact POLARIS_819.' : `Short turn ${index}`);
  }
  globalThis.fetch = async (_url, options = {}) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ message: { content: 'Partial POLARIS_819' },
      done_reason: 'length', prompt_eval_count: 40, eval_count: 1000 }) };
  };
  try {
    config.compact.keepTurns = 6;
    config.compact.threshold = 0.75;
    clearNumCtxCache(); setNumCtx(model, 4096);
    maybeCompact(id, store, 'incomplete-test');
    await assert.rejects(awaitPendingCompaction(id), /CONTEXT_SUMMARY_INCOMPLETE:length/);
    assertEqual(requests.length, 2);
    assertEqual(requests[1].messages[0].content.includes('úsporněji'), true);
    assertEqual(store.getSummary(id), null);
    await assert.rejects(ensureCompactionBeforeNextTurn(id, store, 'incomplete-test'), /CONTEXT_SUMMARY_INCOMPLETE:length/);
    assertEqual(requests.length, 4, 'one bounded retry is permitted for each compaction attempt');
    assertEqual(store.getUnsummarizedTurnCount(id), 10);
    assertEqual(store.getSummary(id), null);
  } finally {
    globalThis.fetch = previousFetch;
    config.compact.keepTurns = previousKeepTurns;
    config.compact.threshold = previousThreshold;
    clearNumCtxCache();
  }
});

await testAsync('a completed concise retry replaces the truncated draft without increasing the output cap', async () => {
  const model = config.compact.summaryModel || config.models.CHAT;
  const previousFetch = globalThis.fetch;
  const previousKeepTurns = config.compact.keepTurns;
  const store = new ConversationStore(null);
  const id = 'completed-summary-retry';
  const requests = [];
  for (let index = 0; index < 10; index += 1) {
    store.appendTurn(id, index % 2 ? TurnRole.ASSISTANT : TurnRole.USER,
      index === 0 ? 'Initial durable fact SIRIUS_228.' : `Short turn ${index}`);
  }
  globalThis.fetch = async (_url, options = {}) => {
    requests.push(JSON.parse(options.body));
    const recovered = requests.length === 2;
    return { ok: true, json: async () => ({ message: { content: recovered
      ? 'Initial durable fact SIRIUS_228.' : 'Partial and unfinished' },
    done_reason: recovered ? 'stop' : 'length', prompt_eval_count: 40,
    eval_count: recovered ? 50 : 1000 }) };
  };
  try {
    config.compact.keepTurns = 6;
    clearNumCtxCache(); setNumCtx(model, 4096);
    maybeCompact(id, store, 'retry-test');
    await awaitPendingCompaction(id);
    assertEqual(requests.length, 2);
    assertEqual(requests.every(request => request.options.num_predict === 1000), true);
    assertEqual(store.getSummary(id)?.summary, 'Initial durable fact SIRIUS_228.');
    assertEqual(store.getSummary(id)?.upToMsgId, 4);
    assertEqual(store.getUnsummarizedTurnCount(id), 6);
  } finally {
    globalThis.fetch = previousFetch;
    config.compact.keepTurns = previousKeepTurns;
    clearNumCtxCache();
  }
});

await testAsync('oversized summary source fails before provider call instead of marking dropped turns as covered', async () => {
  const model = config.compact.summaryModel || config.models.CHAT;
  const previousFetch = globalThis.fetch;
  const previousKeepTurns = config.compact.keepTurns;
  const store = new ConversationStore(null);
  const id = 'oversized-summary-source';
  let calls = 0;
  for (let index = 0; index < 10; index += 1) {
    store.appendTurn(id, index % 2 ? TurnRole.ASSISTANT : TurnRole.USER,
      index === 0 ? 'Initial durable fact NOVA_521.' + 'x'.repeat(11000) : `Short turn ${index}`);
  }
  globalThis.fetch = async () => { calls += 1; throw new Error('Provider must not be called'); };
  try {
    config.compact.keepTurns = 6;
    clearNumCtxCache(); setNumCtx(model, 4096);
    maybeCompact(id, store, 'oversize-test');
    await assert.rejects(awaitPendingCompaction(id), /CONTEXT_SUMMARY_INPUT_TOO_LARGE/);
    assertEqual(calls, 0);
    assertEqual(store.getSummary(id), null);
    assertEqual(store.getUnsummarizedTurnCount(id), 10);
  } finally {
    globalThis.fetch = previousFetch;
    config.compact.keepTurns = previousKeepTurns;
    clearNumCtxCache();
  }
});

await testAsync('more than fifty new turns cannot be marked summarized after dropping their prefix', async () => {
  const model = config.compact.summaryModel || config.models.CHAT;
  const previousFetch = globalThis.fetch;
  const previousKeepTurns = config.compact.keepTurns;
  const store = new ConversationStore(null);
  const id = 'too-many-summary-turns';
  let calls = 0;
  for (let index = 0; index < 60; index += 1) {
    store.appendTurn(id, index % 2 ? TurnRole.ASSISTANT : TurnRole.USER, `Short turn ${index}`);
  }
  globalThis.fetch = async () => { calls += 1; throw new Error('Provider must not be called'); };
  try {
    config.compact.keepTurns = 6;
    clearNumCtxCache(); setNumCtx(model, 4096);
    maybeCompact(id, store, 'too-many-test');
    await assert.rejects(awaitPendingCompaction(id), /CONTEXT_SUMMARY_INPUT_TOO_MANY_TURNS/);
    assertEqual(calls, 0);
    assertEqual(store.getSummary(id), null);
    assertEqual(store.getUnsummarizedTurnCount(id), 60);
  } finally {
    globalThis.fetch = previousFetch;
    config.compact.keepTurns = previousKeepTurns;
    clearNumCtxCache();
  }
});

summary();
