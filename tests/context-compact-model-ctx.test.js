#!/usr/bin/env node

import {
  assertEqual,
  suite,
  summary,
  testAsync,
} from './harness.js';
import { maybeCompact } from '../src/chat/context-compact.js';
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
    getEstimatedTokens: () => 0,
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
    getEstimatedTokens: () => tokenValues[Math.min(tokenRead++, tokenValues.length - 1)],
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

summary();
