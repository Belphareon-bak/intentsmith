#!/usr/bin/env node

import {
  assertEqual,
  suite,
  summary,
  test,
  testAsync,
} from './harness.js';
import { maybeCompact } from '../src/chat/context-compact.js';
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

await testAsync('one context snapshot controls truncate, provider wire, and post-fill evidence', async () => {
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
    content: `turn-${index}-${'x'.repeat(4000)}`,
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
    assertEqual(requestBodies[0].messages[0].content.includes('...[zkráceno]'), true);
    const truncate = warnEvents.find(event => event.message === 'Turn-limited text still exceeds char limit, truncating');
    assertEqual(truncate?.data?.maxChars, Math.floor(1024 * 0.6) * 4);
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
      json: async () => ({ message: { content: 'Krátký souhrn.' }, prompt_eval_count: 10, eval_count: 3 }),
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

summary();
