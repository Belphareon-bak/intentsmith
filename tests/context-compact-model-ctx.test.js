#!/usr/bin/env node

import {
  assertEqual,
  suite,
  summary,
  testAsync,
} from './harness.js';
import { maybeCompact } from '../src/chat/context-compact.js';
import { config } from '../src/config.js';
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

summary();
